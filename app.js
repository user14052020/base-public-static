(() => {
  const DB_KEY = 'offers-base-static-db-v1';
  const SESSION_KEY = 'offers-base-static-session-v2';
  const ADMIN = {
    username: 'admin',
    salt: 'snwdPP34s/2j99J7Sm3VkA==',
    hash: 'pcDnecfCBTLHKnb3NH5cHwx/d0ylk765Irk4gZjEnAs=',
    iterations: 250000
  };
  const DEFAULT_IP_REGISTRATION_DETAILS = 'ОГРНИП 324665800143783, 02.07.2024 г.';
  const { normalizeUpdAmount, getOrderAmount, getInvoiceAmount, getUpdAmount, getUpdItems, getInvoiceItems, migrateInvoiceAmount } = window.OffersWorkAmounts;
  const ledger = window.OffersPaymentLedger;
  const { paymentDate, paymentTime, paymentDateTime, normalizePaymentFields } = window.OffersWorkPayments;
  const paymentDateText = (value) => {
    const date = paymentDate(value);
    if (!date) return '';
    const [year, month, day] = date.split('-');
    const time = paymentTime(value);
    const zone = time ? /(Z|[+-]\d{2}:\d{2})$/.exec(String(value))?.[1] || '' : '';
    return `${day}.${month}.${year}${time ? ` ${time}${zone}` : ''}`;
  };

  const app = document.getElementById('app');
  const state = {
    db: null,
    view: 'works',
    editingWorkId: null,
    editingClientId: null,
    query: '',
    workFilters: { clientId: '', dateFrom: '', dateTo: '' },
    paidOnly: true,
    message: null,
    password: null
  };

  const money = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  const html = (value) =>
    String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');
  const cellLines = (items) => {
    const text = items.map((item) => normalizeText(item)).filter(Boolean).join('\n');
    return text ? html(text).replace(/\n/g, '<br>') : '—';
  };

  const normalizeText = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const toNumber = (value, fallback = 0) => {
    const parsed = Number(String(value ?? '').replace(',', '.'));
    return Number.isFinite(parsed) ? parsed : fallback;
  };
  const formatMoney = (value) => money.format(Number(value) || 0);
  const todayInput = () => new Date().toISOString().slice(0, 10);
  const dateInput = (value) => {
    const date = parseDate(value);
    return date ? date.toISOString().slice(0, 10) : '';
  };
  const displayDate = (value) => {
    const date = parseDate(value);
    return date ? date.toLocaleDateString('ru-RU') : '—';
  };
  const parseDate = (value) => {
    if (!value) return null;
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'object') {
      if (value.$date) return parseDate(value.$date);
      return null;
    }
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
  };
  const sameDay = (left, right) => dateInput(left) === dateInput(right);
  const idOf = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    if (value.$oid) return value.$oid;
    if (value._id) return idOf(value._id);
    return String(value);
  };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);

  const reviveMongo = (value) => {
    if (Array.isArray(value)) return value.map(reviveMongo);
    if (!value || typeof value !== 'object') return value;
    if (Object.keys(value).length === 1 && value.$oid) return value.$oid;
    if (Object.keys(value).length === 1 && value.$date) return value.$date;
    if (value.$binary) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, reviveMongo(item)]));
  };

  const dateFieldsByCollection = {
    clients: ['createdAt', 'updatedAt'],
    files: ['createdAt', 'updatedAt'],
    organizations: ['createdAt', 'updatedAt'],
    sequences: ['createdAt', 'updatedAt'],
    users: ['createdAt', 'updatedAt'],
    works: ['actDate', 'invoiceDate', 'createdAt', 'updatedAt'],
    'uploads.files': ['uploadDate']
  };
  const idFieldsByCollection = {
    clients: ['_id', 'files'],
    files: ['_id', 'bucketId'],
    organizations: ['_id', 'files'],
    users: ['_id'],
    works: ['_id', 'executorOrganizationId', 'clientId'],
    'uploads.files': ['_id'],
    'uploads.chunks': ['_id', 'files_id']
  };
  const mongoId = (value) => ({ $oid: idOf(value) || uid() });
  const mongoDate = (value) => {
    const date = parseDate(value) || new Date();
    return { $date: date.toISOString() };
  };
  const serializeBackupValue = (value) => {
    if (Array.isArray(value)) return value.map(serializeBackupValue);
    if (!value || typeof value !== 'object') return value;
    if (value.$oid || value.$date || value.$binary) return value;
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, serializeBackupValue(item)]));
  };
  const serializeBackupDocument = (collectionName, document) => {
    const serialized = serializeBackupValue(document);
    if (!serialized || typeof serialized !== 'object' || Array.isArray(serialized)) return serialized;

    for (const field of idFieldsByCollection[collectionName] || []) {
      if (!(field in serialized)) continue;
      serialized[field] = Array.isArray(serialized[field])
        ? serialized[field].filter(Boolean).map(mongoId)
        : mongoId(serialized[field]);
    }

    for (const field of dateFieldsByCollection[collectionName] || []) {
      if (field in serialized) serialized[field] = mongoDate(serialized[field]);
    }

    if (collectionName === 'uploads.chunks' && typeof serialized.data === 'string') {
      serialized.data = { $binary: serialized.data, $type: '0' };
    }

    return serialized;
  };

  const normalizeItem = (item) => {
    const quantity = Math.max(0, toNumber(item.quantity, 1));
    const price = Math.max(0, toNumber(item.price, 0));
    return {
      name: normalizeText(item.name),
      quantity,
      price,
      amount: quantity * price
    };
  };

  const normalizeWork = (work) => {
    work = normalizePaymentFields(work);
    const normalizedItems = Array.isArray(work.items) ? work.items.map(normalizeItem).filter((item) => item.name) : [];
    work = migrateInvoiceAmount({ ...work, items: normalizedItems, amount: normalizedItems.reduce((sum, item) => sum + item.amount, 0) });
    const { items, amount } = work;
    const actDate = parseDate(work.actDate) || parseDate(work.invoiceDate) || new Date();
    const invoiceDate = parseDate(work.invoiceDate) || actDate;
    const source = work.source === 'kwork' ? 'kwork' : 'document';
    return {
      ...work,
      _id: idOf(work._id) || uid(),
      executorOrganizationId: idOf(work.executorOrganizationId),
      clientId: idOf(work.clientId),
      items,
      amount,
      orderAmount: normalizeUpdAmount(work.orderAmount),
      updAmount: normalizeUpdAmount(work.updAmount),
      creditedAmount: Math.max(0, toNumber(work.creditedAmount, amount)),
      paymentDate: paymentDateTime(work.paymentDate),
      isPayed: Boolean(work.isPayed),
      currency: work.currency || 'RUB',
      source,
      sourceName: work.sourceName || (source === 'kwork' ? 'Kwork' : 'Счет/акт'),
      platformCommission: Math.max(0, toNumber(work.platformCommission, 0)),
      payoutCommission: Math.max(0, toNumber(work.payoutCommission, 0)),
      actNumber: source === 'kwork' ? '' : String(work.actNumber || ''),
      invoiceNumber: source === 'kwork' ? '' : String(work.invoiceNumber || ''),
      actDate: actDate.toISOString(),
      invoiceDate: invoiceDate.toISOString(),
      actYear: actDate.getFullYear(),
      invoiceYear: invoiceDate.getFullYear()
    };
  };

  const normalizeClient = (client) => ({
    ...client,
    _id: idOf(client._id) || uid(),
    name: normalizeText(client.name),
    isPhysicalPerson: Boolean(client.isPhysicalPerson)
  });

  const normalizeOrganization = (organization) => ({
    ...organization,
    _id: idOf(organization._id) || uid(),
    name: normalizeText(organization.name),
    registrationDetails: normalizeText(organization.registrationDetails) || DEFAULT_IP_REGISTRATION_DETAILS
  });

  const collectionsFromDb = (db) => ({
    organizations: db.organizations || [], clients: db.clients || [], works: db.works || [], files: db.files || [],
    sequences: db.sequences || [], users: db.users || [], 'uploads.files': db.uploadsFiles || [], 'uploads.chunks': db.uploadsChunks || [],
    ...(Object.hasOwn(db, 'payments') ? { payments: db.payments } : {}), ...(Object.hasOwn(db, 'paymentAllocations') ? { paymentAllocations: db.paymentAllocations } : {})
  });
  const dbFromCollections = (source, meta = {}) => {
    const collections = ledger.normalize({ ...source,
      organizations: (source.organizations || []).map(normalizeOrganization), clients: (source.clients || []).map(normalizeClient), works: (source.works || []).map(normalizeWork) });
    return {
    meta: {
      ...meta
    },
    organizations: (collections.organizations || []).map(normalizeOrganization),
    clients: (collections.clients || []).map(normalizeClient),
    works: (collections.works || []).map(normalizeWork),
    payments: collections.payments,
    paymentAllocations: collections.paymentAllocations,
    sequences: collections.sequences || [],
    users: collections.users || [],
    files: collections.files || [],
    uploadsFiles: collections['uploads.files'] || collections.uploadsFiles || [],
    uploadsChunks: collections['uploads.chunks'] || collections.uploadsChunks || []
    };
  };
  const replaceCollections = (collections) => { state.db = dbFromCollections(collections, state.db.meta); };

  const decryptSeed = async (password) => {
    const encrypted = window.__OFFERS_SEED_ENCRYPTED__;
    if (!encrypted) throw new Error('Стартовый бэкап не найден');
    return window.OffersSeedCodec.decrypt(encrypted, password);
  };

  const seedDb = async (password) => {
    const seed = reviveMongo(await decryptSeed(password));
    const collections = seed.collections || {};
    return dbFromCollections(collections, {
      ...seed.meta,
      createdAt: new Date().toISOString(), source: 'seed', seedRevision: window.__OFFERS_SEED_ENCRYPTED__?.revision || null
    });
  };

  const loadStoredDb = () => {
    const stored = localStorage.getItem(DB_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        const normalized = dbFromCollections(collectionsFromDb(parsed), parsed.meta);
        if (normalized.meta?.pendingPublication?.revision === window.__OFFERS_SEED_ENCRYPTED__?.revision) normalized.meta.pendingPublication = null;
        localStorage.setItem(DB_KEY, JSON.stringify(normalized));
        return normalized;
      } catch (error) {
        state.message = { text: `Локальная база не изменена: ${error.message}`, type: 'error' };
      }
    }
    return null;
  };

  const loadDb = async (password) => {
    const seed = reviveMongo(await decryptSeed(password));
    const raw = localStorage.getItem(DB_KEY);
    if (raw) {
      const stored = JSON.parse(raw);
      const revisions = [...new Map([...(stored.meta?.dataRevisions || []), ...(seed.meta?.dataRevisions || [])].map((revision) => [revision.id, revision])).values()];
      const revised = window.OffersDataRevisions.apply({ collections: collectionsFromDb(stored), meta: stored.meta }, revisions);
      const db = dbFromCollections(revised.collections, revised.meta);
      saveDb(db, { markChanged: false });
      if (db.meta.dataRevisionConflicts?.length) state.message = { text: 'Локальные изменения отличаются от опубликованного исправления. Проверьте журнал платежей.', type: 'error' };
      return db;
    }
    const seeded = await seedDb(password);
    saveDb(seeded, { markChanged: false });
    return seeded;
  };

  const saveDb = (db = state.db, { markChanged = true } = {}) => {
    db.meta = { ...(db.meta || {}), updatedAt: new Date().toISOString(), ...(markChanged ? { localChanges: true } : {}) };
    localStorage.setItem(DB_KEY, JSON.stringify(db));
  };

  const showMessage = (text, type = 'ok') => {
    state.message = { text, type };
    render();
  };

  const clearMessage = () => {
    state.message = null;
  };

  const base64ToBytes = (value) => Uint8Array.from(atob(value), (char) => char.charCodeAt(0));
  const bytesToBase64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
  const verifyPassword = async (password) => {
    const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
    const bits = await crypto.subtle.deriveBits(
      {
        name: 'PBKDF2',
        salt: base64ToBytes(ADMIN.salt),
        iterations: ADMIN.iterations,
        hash: 'SHA-256'
      },
      key,
      256
    );
    return bytesToBase64(bits) === ADMIN.hash;
  };

  const isLoggedIn = () => sessionStorage.getItem(SESSION_KEY) === 'ok';
  const setLoggedIn = (value) => {
    if (value) sessionStorage.setItem(SESSION_KEY, 'ok');
    else sessionStorage.removeItem(SESSION_KEY);
  };

  const organizationName = (id) => state.db.organizations.find((item) => item._id === id)?.name || '—';
  const clientName = (id) => state.db.clients.find((item) => item._id === id)?.name || '—';
  const workTitle = (work) => work.items.map((item) => item.name).join('; ') || '—';
  const workDate = (work) => parseDate(work.actDate) || parseDate(work.invoiceDate) || new Date(0);
  const sortedWorks = () =>
    [...state.db.works].sort((left, right) => workDate(right).getTime() - workDate(left).getTime());
  const filteredWorks = () => {
    const query = normalizeText(state.query).toLowerCase();
    const { clientId, dateFrom, dateTo } = state.workFilters;
    return sortedWorks().filter((work) => {
      if (clientId && work.clientId !== clientId) return false;
      const date = dateInput(workDate(work));
      if (dateFrom && date < dateFrom || dateTo && date > dateTo) return false;
      return !query || [workTitle(work), clientName(work.clientId), organizationName(work.executorOrganizationId), work.actNumber, work.invoiceNumber]
        .join(' ').toLowerCase().includes(query);
    });
  };

  const nextNumber = (year, field) => {
    const max = state.db.works
      .filter((work) => Number(work[`${field}Year`]) === year)
      .reduce((current, work) => Math.max(current, Number.parseInt(work[`${field}Number`] || '0', 10) || 0), 0);
    return String(max + 1);
  };

  const totalWorkAmount = (items) => items.reduce((sum, item) => sum + normalizeItem(item).amount, 0);
  const workItemAmountFromRow = (row) => {
    const quantity = Math.max(0, toNumber(row.querySelector('[name="itemQuantity"]')?.value, 0));
    const price = Math.max(0, toNumber(row.querySelector('[name="itemPrice"]')?.value, 0));
    return quantity * price;
  };
  const updateWorkItemAmount = (row) => {
    const amountInput = row?.querySelector('[data-item-amount]');
    if (amountInput) amountInput.value = formatMoney(workItemAmountFromRow(row));
  };
  const workFormAmount = (form) => Array.from(form.querySelectorAll('[data-item-row]'))
      .filter((row) => normalizeText(row.querySelector('[name="itemName"]').value))
      .reduce((sum, row) => sum + workItemAmountFromRow(row), 0);
  const updateWorkTotals = (form) => {
    if (!form) return;
    const amount = workFormAmount(form);
    form.querySelector('[data-work-total]').value = formatMoney(amount);
    if (form.orderAmount?.dataset.auto === 'true') form.orderAmount.value = String(amount);
    if (form.updAmount.dataset.auto === 'true') form.updAmount.value = String(getUpdAmount({ amount, orderAmount: form.orderAmount?.value }));
  };
  const getOrganization = (id) => state.db.organizations.find((item) => item._id === id);
  const getClient = (id) => state.db.clients.find((item) => item._id === id);
  const quantityText = (value) =>
    (Number(value) || 0).toLocaleString('ru-RU', { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  const dateForFilename = (value) => {
    const date = parseDate(value);
    if (!date) return 'без-даты';
    return [String(date.getDate()).padStart(2, '0'), String(date.getMonth() + 1).padStart(2, '0'), date.getFullYear()].join('.');
  };
  const sanitizeDocumentPart = (value) =>
    normalizeText(value || 'без номера')
      .replace(/[<>:"/\\|?*\u0000-\u001F]/g, '-')
      .replace(/\s+/g, '')
      .replace(/-+/g, '-')
      .replace(/^[.\-\s]+|[.\-\s]+$/g, '')
      .toLowerCase() || 'без-значения';
  const documentTitle = (kind, work) => {
    const type = kind === 'act' ? 'акт' : kind === 'upd' ? 'упд' : 'счет';
    const number = kind === 'act' ? work.actNumber : work.invoiceNumber;
    const date = kind === 'act' ? work.actDate : work.invoiceDate;
    return `${type}№${sanitizeDocumentPart(number)}от${dateForFilename(date)}`;
  };
  const innKpp = (party) =>
    [party?.inn ? `ИНН ${party.inn}` : '', party?.kpp ? `КПП ${party.kpp}` : ''].filter(Boolean).join(', ');
  const rawInnKpp = (party) => {
    const inn = normalizeText(party?.inn);
    const kpp = normalizeText(party?.kpp);
    return inn && kpp ? `${inn} / ${kpp}` : inn || kpp || '-';
  };
  const partyLine = (party) =>
    [party?.name, innKpp(party), party?.address].map(normalizeText).filter(Boolean).join(', ') || '-';
  const signerName = (party) => party?.signerName || party?.shortName || party?.name || '';
  const personShortName = (value) => {
    const cleaned = normalizeText(value).replace(/^ИП\s+/iu, '');
    if (!cleaned) return '';
    const match = /^([А-ЯЁA-Z][а-яёa-z-]+)\s+([А-ЯЁA-Z])\.\s*([А-ЯЁA-Z])\.?$/u.exec(cleaned);
    if (match) return `${match[1]} ${match[2]}.${match[3]}.`;
    const parts = cleaned.split(' ').filter(Boolean);
    if (parts.length < 2 || !/^[А-ЯЁA-Z][а-яёa-z-]+$/u.test(parts[0])) return cleaned;
    const initials = parts
      .slice(1, 3)
      .map((part) => part.charAt(0).toUpperCase())
      .filter(Boolean)
      .map((letter) => `${letter}.`)
      .join('');
    return initials ? `${parts[0]} ${initials}` : cleaned;
  };
  const documentBasis = (work) => `Счет № ${work.invoiceNumber || work.actNumber || '-'} от ${displayDate(work.invoiceDate || work.actDate)}`;
  const shipmentDocumentLine = (work) =>
    `Универсальный передаточный документ, № ${work.invoiceNumber || work.actNumber || '-'} от ${displayDate(work.invoiceDate || work.actDate)}`;
  const updDateText = (value) => {
    const date = parseDate(value);
    if (!date) return '';
    const months = [
      'января',
      'февраля',
      'марта',
      'апреля',
      'мая',
      'июня',
      'июля',
      'августа',
      'сентября',
      'октября',
      'ноября',
      'декабря'
    ];
    return `"${String(date.getDate()).padStart(2, '0')}" ${months[date.getMonth()]} ${date.getFullYear()} г.`;
  };
  const plural = (value, forms) => {
    const number = Math.abs(value) % 100;
    const last = number % 10;
    if (number > 10 && number < 20) return forms[2];
    if (last > 1 && last < 5) return forms[1];
    if (last === 1) return forms[0];
    return forms[2];
  };
  const integerToWords = (value) => {
    const units = [
      ['', 'одна', 'две', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять'],
      ['', 'один', 'два', 'три', 'четыре', 'пять', 'шесть', 'семь', 'восемь', 'девять']
    ];
    const teens = ['десять', 'одиннадцать', 'двенадцать', 'тринадцать', 'четырнадцать', 'пятнадцать', 'шестнадцать', 'семнадцать', 'восемнадцать', 'девятнадцать'];
    const tens = ['', '', 'двадцать', 'тридцать', 'сорок', 'пятьдесят', 'шестьдесят', 'семьдесят', 'восемьдесят', 'девяносто'];
    const hundreds = ['', 'сто', 'двести', 'триста', 'четыреста', 'пятьсот', 'шестьсот', 'семьсот', 'восемьсот', 'девятьсот'];
    const groups = [
      { value: 1000000000, forms: ['миллиард', 'миллиарда', 'миллиардов'], gender: 1 },
      { value: 1000000, forms: ['миллион', 'миллиона', 'миллионов'], gender: 1 },
      { value: 1000, forms: ['тысяча', 'тысячи', 'тысяч'], gender: 0 }
    ];
    const chunkWords = (chunk, gender) => {
      const words = [hundreds[Math.floor(chunk / 100)]];
      const rest = chunk % 100;
      if (rest >= 10 && rest < 20) words.push(teens[rest - 10]);
      else words.push(tens[Math.floor(rest / 10)], units[gender][rest % 10]);
      return words.filter(Boolean);
    };
    if (!value) return 'ноль';
    let rest = Math.floor(Math.abs(value));
    const words = [];
    for (const group of groups) {
      const count = Math.floor(rest / group.value);
      if (count) {
        words.push(...chunkWords(count, group.gender), plural(count, group.forms));
        rest %= group.value;
      }
    }
    words.push(...chunkWords(rest, 1));
    return words.filter(Boolean).join(' ');
  };
  const amountToWords = (value) => {
    const totalKopecks = Math.round((Number(value) || 0) * 100);
    const rubles = Math.floor(totalKopecks / 100);
    const kopecks = totalKopecks % 100;
    const words = integerToWords(rubles);
    return `${words.charAt(0).toUpperCase()}${words.slice(1)} ${plural(rubles, ['рубль', 'рубля', 'рублей'])} ${String(kopecks).padStart(2, '0')} ${plural(kopecks, ['копейка', 'копейки', 'копеек'])}`;
  };
  const documentsCell = (work) =>
    work.source === 'kwork'
      ? '<span class="muted">—</span>'
      : `
    <div class="doc-actions">
      <button class="secondary" data-action="print-doc" data-doc="act" data-id="${html(work._id)}">АКТ ${html(work.actNumber || '')}</button>
      <button class="secondary" data-action="print-doc" data-doc="invoice" data-id="${html(work._id)}">СЧЕТ ${html(work.invoiceNumber || '')}</button>
      <button class="secondary" data-action="print-doc" data-doc="upd" data-id="${html(work._id)}">УПД ${html(work.invoiceNumber || '')}</button>
    </div>
  `;
  const printableRows = (work, mode = 'full') =>
    work.items
      .map(
        (item, index) => `
      <tr>
        <td class="center">${index + 1}</td>
        <td>${html(item.name)}</td>
        ${mode === 'simple' ? '' : `<td class="right">${quantityText(item.quantity)}</td><td class="right">${formatMoney(item.price)}</td>`}
        <td class="right">${formatMoney(item.amount)}</td>
      </tr>
    `
      )
      .join('');
  const printableShell = (title, body, layout = 'portrait', options = {}) => {
    const pageSize = layout === 'landscape' ? 'A4 landscape' : 'A4 portrait';
    const pageWidth = layout === 'landscape' ? '297mm' : '210mm';
    const pageHeight = layout === 'landscape' ? '210mm' : '297mm';
    const assetBase = new URL('.', window.location.href).href;
    const filename = `${title}.pdf`;
    const actionButton = options.pdf
      ? '<button data-pdf-button onclick="generatePdf()">Скачать PDF</button>'
      : '<button onclick="window.print()">Печать / сохранить PDF</button>';
    const outputScript = options.pdf
      ? `
    <script src="${html(assetBase)}html2pdf.bundle.min.js"></script>
    <script>
      const pdfFilename = ${JSON.stringify(filename)};
      const pdfLayout = ${JSON.stringify(layout)};
      async function generatePdf() {
        const button = document.querySelector('[data-pdf-button]');
        if (button?.disabled) return;
        if (button) {
          button.disabled = true;
          button.textContent = 'Готовлю PDF...';
        }
        try {
          if (!window.html2pdf) {
            ${options.parentDownload ? "throw new Error('Не удалось загрузить библиотеку PDF. Обновите страницу и повторите попытку.');" : ''}
            window.print();
            return;
          }
          const root = document.querySelector('[data-print-root]');
          document.body.classList.add('pdf-render');
          const worker = window.html2pdf()
            .set({
              filename: pdfFilename,
              margin: 0,
              image: { type: 'jpeg', quality: 0.98 },
              html2canvas: { scale: 2, useCORS: true, backgroundColor: '#ffffff', scrollX: 0, scrollY: 0 },
              jsPDF: { unit: 'mm', format: 'a4', orientation: pdfLayout },
              pagebreak: { mode: ['css'], before: '.doc-page + .doc-page', avoid: '.doc-page' }
            })
            .from(root);
          ${options.parentDownload ? `const blob = await worker.outputPdf('blob');
          window.parent.postMessage({ type: 'offers-base-pdf', filename: pdfFilename, blob }, ${JSON.stringify(new URL(assetBase).origin)});` : 'await worker.save();'}
        } catch (error) {
          let message = document.querySelector('[data-pdf-error]');
          if (!message) {
            message = document.createElement('p');
            message.dataset.pdfError = '';
            message.setAttribute('role', 'alert');
            document.querySelector('.no-print').appendChild(message);
          }
          message.textContent = error.message || 'Не удалось сформировать PDF';
        } finally {
          document.body.classList.remove('pdf-render');
          if (button) {
            button.disabled = false;
            button.textContent = 'Скачать PDF';
          }
        }
      }
      window.addEventListener('load', () => setTimeout(generatePdf, 300));
    </script>`
      : "<script>window.addEventListener('load', () => setTimeout(() => window.print(), 300));</script>";

    return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>${html(title)}</title>
    <style>
      @page { size: ${pageSize}; margin: 0; }
      * { box-sizing: border-box; }
      html, body { width: ${pageWidth}; min-width: ${pageWidth}; min-height: ${pageHeight}; }
      body { margin: 0; color: #111; background: #fff; font: 10pt/1.28 Arial, sans-serif; }
      h1, h2, h3, p { margin: 0; }
      .no-print { position: sticky; top: 0; display: flex; gap: 8px; justify-content: flex-end; padding: 8px; background: #fff; border-bottom: 1px solid #ddd; }
      .no-print button { border: 1px solid #222; background: #222; color: #fff; border-radius: 6px; padding: 7px 10px; cursor: pointer; }
      .doc-page { position: relative; width: 210mm; min-height: 297mm; margin: 0 auto; padding: 17mm 15mm; background: #fff; page-break-after: always; }
      .doc-page:last-child { page-break-after: auto; }
      .pdf-render .doc-page { page-break-after: auto; break-after: auto; }
      .pdf-render .doc-page + .doc-page { page-break-before: always; break-before: page; }
      .landscape { width: 297mm; min-height: 210mm; padding: 7mm 6.3mm 8mm; }
      .org-title { margin-bottom: 3mm; text-align: center; font-size: 16pt; font-weight: 700; white-space: nowrap; }
      .org-address { margin-bottom: 5mm; }
      .doc-title { margin: 5mm 0 4mm; text-align: center; font-size: 12pt; font-weight: 700; }
      .act-title { margin: 4mm 0 5mm; text-align: center; font-size: 16pt; font-weight: 700; white-space: nowrap; }
      .labeled { margin: 2mm 0; }
      table { width: 100%; border-collapse: collapse; table-layout: fixed; }
      .bank-table, .work-table { outline: 1px solid #111; outline-offset: -1px; }
      th, td { border: 1px solid #111; padding: 2.7mm 2.8mm; vertical-align: top; }
      th { text-align: center; font-weight: 700; background: #fff; }
      .right { text-align: right; }
      .center { text-align: center; }
      .bold { font-weight: 700; }
      .bank-table td { height: 8.5mm; padding: 1.8mm 2mm; font-size: 9pt; }
      .work-table th, .work-table td { height: 10.5mm; }
      .work-table .name { overflow-wrap: anywhere; }
      .totals td { font-weight: 700; }
      .summary { margin-top: 5mm; }
      .sign-grid { display: grid; grid-template-columns: 1fr 1fr; margin-top: 14mm; border: 1px solid #111; min-height: 22mm; }
      .sign-grid > div { padding: 3mm; }
      .sign-grid > div + div { border-left: 1px solid #111; }
      .sign-row { margin-top: 8mm; }
      .upd { font-size: 6.1pt; line-height: 1.08; }
      .upd-top { position: relative; display: grid; grid-template-columns: 24.5mm 1fr; align-items: stretch; }
      .doc-page.landscape.upd { height: 210mm; min-height: 0; overflow: hidden; }
      .pdf-render .doc-page.landscape.upd { height: 209.5mm; }
      .upd-side { min-height: 63mm; margin-bottom: -0.5px; padding: 1mm 2mm 0 1mm; border-right: 0.6px solid #111; }
      .upd-side-title { display: block; margin-bottom: 6mm; font-weight: 700; font-size: 6.1pt; }
      .upd-status { display: inline-grid; place-items: center; width: 7mm; height: 5.5mm; margin-left: 2mm; border: 1px solid #111; font-size: 8pt; font-weight: 700; }
      .upd-legend { margin-top: 5mm; }
      .upd-note { position: absolute; top: 5mm; right: 0; width: 78mm; text-align: right; }
      .upd-lines { padding: 21mm 1.5mm 0 4mm; }
      .upd-invoice-lines { width: 88mm; }
      .upd-party-grid { display: grid; grid-template-columns: 1fr 1fr; column-gap: 5mm; margin-top: 1.2mm; }
      .upd-line { display: grid; grid-template-columns: 38mm 1fr 8mm; align-items: end; min-height: 3.35mm; }
      .upd-line.wide-label { grid-template-columns: 49mm 1fr 8mm; }
      .upd-line.tall { min-height: 6.5mm; }
      .upd-line.extra-tall { min-height: 8.4mm; }
      .upd-line b { font-weight: 700; }
      .upd-value { min-height: 3mm; border-bottom: 1px solid #111; padding-left: 1mm; }
      .upd-code { text-align: right; }
      .upd-prepayment-line { display: grid; grid-template-columns: 1fr 8mm; align-items: end; min-height: 7mm; margin-top: 1mm; border-bottom: 1px solid #111; font-size: 5.5pt; }
      .upd-items { margin-top: 0; }
      .upd-items th, .upd-items td { border-width: 0.5px; padding: 0.8mm 0.7mm; font-size: 5pt; line-height: 1.06; overflow-wrap: anywhere; }
      .upd-items th { overflow-wrap: normal; word-break: normal; hyphens: manual; }
      .upd-items thead th { text-align: center; vertical-align: middle; font-size: 4.55pt; line-height: 0.96; font-weight: 700; }
      .upd-items .upd-header-main > th:nth-child(8),
      .upd-items .upd-header-main > th:nth-child(11),
      .upd-items .upd-header-main > th:nth-child(12),
      .upd-items .upd-header-main > th:nth-child(16),
      .upd-items .upd-header-main > th:nth-child(17) { font-size: 4.2pt; line-height: 0.94; padding-left: 0.35mm; padding-right: 0.35mm; }
      .upd-items .upd-header-main > th:nth-child(14) { font-size: 4.25pt; }
      .upd-items .upd-header-main > th:nth-child(15) { font-size: 4.35pt; }
      .upd-items .upd-header-sub > th { font-size: 4.35pt; line-height: 0.95; }
      .upd-items .upd-header-main > th { height: 21.7mm; min-height: 21.7mm; }
      .upd-items .upd-header-sub > th { height: 26.2mm; min-height: 26.2mm; }
      .upd-items .code-row th, .upd-items .code-row td { height: 4.5mm; font-size: 5.2pt; text-align: center; vertical-align: middle; font-weight: 700; }
      .upd-items .item-row td { height: 19.1mm; vertical-align: middle; }
      .upd-items .item-row td:nth-child(3) { font-size: 5.6pt; }
      .upd-items .total-row td { height: 9mm; vertical-align: middle; font-weight: 700; }
      .upd-footer { position: absolute; left: 6.3mm; right: 6.3mm; bottom: 6.5mm; display: grid; grid-template-columns: 1fr 1fr 1fr; font-size: 6pt; }
      .upd-footer span:nth-child(2) { text-align: center; }
      .upd-footer span:nth-child(3) { text-align: right; }
      .upd-transfer-page { font-size: 5.8pt; line-height: 1.08; padding-top: 0; }
      .upd-transfer-head { margin-left: 24.3mm; border-left: 0.5px solid #111; border-bottom: 0.5px solid #111; min-height: 22mm; padding: 4mm 0 2mm 4mm; }
      .upd-sign-grid { display: grid; grid-template-columns: 48mm 1.5mm 53.7mm 73.3mm 3.3mm 43mm 1.2mm 17.2mm 14.4mm; row-gap: 3mm; align-items: end; }
      .upd-sign-label { align-self: center; font-size: 5.8pt; font-weight: 700; }
      .upd-sign-field { position: relative; min-height: 4mm; border-bottom: 1px solid #111; text-align: center; }
      .upd-sign-field span { display: block; min-height: 3.5mm; }
      .upd-sign-field small { position: absolute; top: 4.2mm; left: 0; right: 0; font-size: 4.4pt; font-weight: 400; line-height: 1; }
      .line-label { font-weight: 700; }
      .transfer-line { display: grid; grid-template-columns: 68mm 1fr 9mm; align-items: end; min-height: 7.2mm; }
      .transfer-line .value { border-bottom: 1px solid #111; min-height: 4mm; text-align: center; }
      .transfer-hint { font-size: 4.5pt; text-align: center; }
      .transfer-sides { display: grid; grid-template-columns: 1fr 1fr; gap: 12mm; margin-top: 8mm; }
      .transfer-sides > section + section { border-left: 1px solid #111; padding-left: 4mm; }
      .mini-line { display: grid; grid-template-columns: 30mm 1fr 9mm; align-items: end; min-height: 12mm; }
      .mini-line .value { border-bottom: 1px solid #111; min-height: 4mm; text-align: center; }
      .stamp { margin-top: 2mm; text-align: center; }
      ${options.styles || ''}
      @media print {
        @page { size: ${pageSize}; margin: 0; }
        .no-print { display: none; }
        html, body { width: ${pageWidth}; min-width: ${pageWidth}; min-height: ${pageHeight}; }
        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      }
    </style>
  </head>
  <body>
    <div class="no-print">${actionButton}</div>
    <div data-print-root>${body}</div>
    ${outputScript}
  </body>
</html>`;
  };
  const invoiceDocument = (work, organization, client) => {
    work = { ...work, items: getInvoiceItems(work), amount: getInvoiceAmount(work) };
    const total = totalWorkAmount(work.items);
    const signer = signerName(organization);
    const accountant = organization.chiefAccountant || '';
    return printableShell(
      documentTitle('invoice', work),
      `<main class="doc-page">
        <h1 class="org-title">${html(organization.shortName || organization.name || '-')}</h1>
        <p class="org-address"><b>Адрес:</b> ${html(organization.address || '-')}</p>
        <table class="bank-table">
          <colgroup><col style="width:24%"><col style="width:24%"><col style="width:20%"><col></colgroup>
          <tr><td>ИНН ${html(organization.inn || '')}</td><td>КПП ${html(organization.kpp || '')}</td><td></td><td></td></tr>
          <tr><td colspan="2">Получатель</td><td>Сч.№</td><td>${html(organization.bankAccount || '')}</td></tr>
          <tr><td colspan="2">${html(organization.name || '')}</td><td></td><td></td></tr>
          <tr><td colspan="2">Банк получателя</td><td>БИК</td><td>${html(organization.bik || '')}</td></tr>
          <tr><td colspan="2">${html(organization.bankName || '')}</td><td>Сч.№</td><td>${html(organization.correspondentAccount || '')}</td></tr>
        </table>
        <h2 class="doc-title">Счет № ${html(work.invoiceNumber || '-')} от ${displayDate(work.invoiceDate)}</h2>
        <p class="labeled"><b>Плательщик:</b> ${html(client.name || '-')}</p>
        <p class="labeled"><b>Адрес:</b> ${html(client.address || '-')}</p>
        <p class="labeled"><b>Валюта (наименование, код):</b> Российский рубль, 643</p>
        <table class="work-table">
          <colgroup><col style="width:9mm"><col><col style="width:45mm"></colgroup>
          <thead><tr><th>№</th><th>Наименование товара/услуги</th><th>Сумма</th></tr></thead>
          <tbody>
            ${work.items
              .map(
                (item, index) => `<tr><td class="center">${index + 1}</td><td class="name">${html(item.name)}</td><td class="right">${formatMoney(item.amount)}</td></tr>`
              )
              .join('')}
          </tbody>
          <tfoot class="totals">
            <tr><td colspan="2" class="right">Итого:</td><td class="right">${formatMoney(total)}</td></tr>
            <tr><td colspan="2" class="right">Итого НДС:</td><td class="right">0,00</td></tr>
            <tr><td colspan="2" class="right">Всего к оплате:</td><td class="right">${formatMoney(total)}</td></tr>
          </tfoot>
        </table>
        <p class="summary">Всего наименований ${work.items.length}, на сумму ${formatMoney(total)}</p>
        <section class="sign-grid">
          <div><b>Руководитель предприятия</b><div class="sign-row">_____________ ${html(signer)}</div></div>
          <div><b>Главный бухгалтер</b><div class="sign-row">_____________ ${html(accountant)}</div></div>
        </section>
      </main>`,
      'portrait',
      { pdf: true }
    );
  };
  const actDocument = (work, organization, client) => {
    work = { ...work, items: getInvoiceItems(work), amount: getInvoiceAmount(work) };
    const total = totalWorkAmount(work.items);
    const totalQuantity = work.items.reduce((sum, item) => sum + toNumber(item.quantity, 0), 0);
    const executorSigner = signerName(organization);
    const clientSigner = signerName(client);
    return printableShell(
      documentTitle('act', work),
      `<main class="doc-page">
        <h1 class="act-title">Акт выполненных работ (оказанных услуг) № ${html(work.actNumber || '-')} от ${displayDate(work.actDate)} г.</h1>
        <p class="labeled"><b>Исполнитель:</b> ${html(partyLine(organization))}</p>
        <p class="labeled"><b>Заказчик:</b> ${html(partyLine(client))}</p>
        <p class="labeled"><b>Договор:</b> ${html(work.contract || client.contract || '-')}</p>
        <table class="work-table" style="margin-top:7mm">
          <colgroup><col><col style="width:32mm"><col style="width:30mm"><col style="width:31mm"></colgroup>
          <thead><tr><th>Наименование услуги</th><th>Количество</th><th>Цена</th><th>Сумма</th></tr></thead>
          <tbody>
            ${work.items
              .map(
                (item) =>
                  `<tr><td class="name">${html(item.name)}</td><td class="right">${quantityText(item.quantity)}</td><td class="right">${formatMoney(item.price)}</td><td class="right">${formatMoney(item.amount)}</td></tr>`
              )
              .join('')}
          </tbody>
          <tfoot class="totals">
            <tr><td colspan="3" class="right">Итого:</td><td class="right">${formatMoney(total)}</td></tr>
            <tr><td colspan="3" class="right">Без налога (НДС):</td><td class="right">-</td></tr>
          </tfoot>
        </table>
        <p class="summary">Всего оказано услуг: ${quantityText(totalQuantity)}, на сумму: ${formatMoney(total)} руб.</p>
        <p class="summary bold">Всего к оплате: ${html(amountToWords(total))}</p>
        <p class="summary">Вышеперечисленные услуги выполнены полностью и в срок. Заказчик претензий по объему, качеству и срокам оказания услуг не имеет.</p>
        <section class="sign-grid">
          <div><b>Исполнитель:</b><div class="sign-row">_____________ ${html(executorSigner)}</div></div>
          <div><b>Заказчик:</b><div class="sign-row">_____________ ${html(clientSigner)}</div></div>
        </section>
      </main>`,
      'portrait',
      { pdf: true }
    );
  };
  const updDocument = (work, organization, client) => {
    const total = getUpdAmount(work);
    const items = getUpdItems(work);
    const invoiceNumber = work.invoiceNumber || work.actNumber || '-';
    const invoiceDate = displayDate(work.invoiceDate || work.actDate);
    const seller = organization.shortName || organization.name || '-';
    const buyer = client.name || '-';
    const sellerSigner = personShortName(signerName(organization)) || seller;
    const buyerSigner = personShortName(client.signerName) || (client.isPhysicalPerson ? personShortName(client.name) : '');
    const registrationDetails = organization.registrationDetails || DEFAULT_IP_REGISTRATION_DETAILS;
    const updColumns = [24.3, 6.3, 26.4, 11.6, 11.6, 11.6, 11.6, 11.6, 11.6, 11.6, 11.6, 11.6, 12, 12, 12, 21.1, 15.8, 12, 23.6, 13.4];
    const updColGroup = `<colgroup>${updColumns.map((width) => `<col style="width:${width}mm">`).join('')}</colgroup>`;
    const updCodes = ['Б', '1', '1а', '1б', '2', '2а', '3', '4', '5', '6', '7', '8', '9', '10', '10а', '11', '12', '12а', '13', '14'];
    const updItemRows = items
      .map(
        (item, index) => `<tr class="item-row">
          <td>-</td><td class="center">${index + 1}</td><td>${html(item.name)}</td><td class="center">-</td>
          <td class="center">796</td><td class="center">шт</td><td class="right">${quantityText(item.quantity)}</td>
          <td class="right">${formatMoney(item.price)}</td><td class="right">${formatMoney(item.amount)}</td>
          <td class="center">без акциза</td><td class="center">без НДС</td><td class="center">без НДС</td>
          <td class="right">${formatMoney(item.amount)}</td><td class="center">-</td><td class="center">-</td><td class="center">-</td>
          <td class="center">-</td><td class="center">-</td><td class="right">-</td><td class="right">-</td>
        </tr>`
      )
      .join('');
    const renderUpdLine = ([label, value, code, className = '']) =>
      `<div class="upd-line ${className}"><b>${html(label)}</b><span class="upd-value">${html(value)}</span><span class="upd-code">${html(code)}</span></div>`;
    const invoiceRows = [
      ['Счет-фактура N', `${invoiceNumber} от ${invoiceDate}`, '(1)', ''],
      ['Исправление N', '- от -', '(1а)', '']
    ];
    const sellerRows = [
      ['Продавец:', seller, '(2)', ''],
      ['Адрес:', organization.address || '-', '(2а)', ''],
      ['ИНН/КПП продавца:', rawInnKpp(organization), '(2б)', ''],
      ['Грузоотправитель и его адрес:', 'он же', '(3)', ''],
      ['Грузополучатель и его адрес:', '-', '(4)', ''],
      ['К платежно-расчетному документу №', '', '(5)', 'wide-label'],
      ['Документ об отгрузке:', shipmentDocumentLine(work), '(5а)', 'wide-label']
    ];
    const buyerRows = [
      ['Покупатель:', buyer, '(6)', 'wide-label'],
      ['Адрес:', client.address || '-', '(6а)', 'wide-label tall'],
      ['ИНН/КПП покупателя:', rawInnKpp(client), '(6б)', 'wide-label'],
      ['Валюта: наименование, код', 'Российский рубль, 643', '(7)', 'wide-label'],
      ['Идентификатор государственного контракта, договора (соглашения) (при наличии):', '', '(8)', 'wide-label extra-tall']
    ];
    const prepaymentInvoiceLabel =
      'К счету-фактуре (счетам-фактурам), выставленному (выставленным) при получении оплаты, частичной оплаты или иных платежей в счет предстоящих поставок товаров (выполнения работ, оказания услуг), передачи имущественных прав';
    return printableShell(
      documentTitle('upd', work),
      `<main class="doc-page landscape upd">
        <section class="upd-top">
          <div class="upd-side">
            <span class="upd-side-title">Универсальный<br>передаточный<br>документ</span>
            Статус <span class="upd-status">2</span>
            <div class="upd-legend">
              1 - счет-фактура<br>и передаточный<br>документ (акт)<br>
              2 - передаточный<br>документ (акт)<br>
              3 - счет-фактура
            </div>
          </div>
          <div class="upd-lines">
            <div class="upd-invoice-lines">${invoiceRows.map(renderUpdLine).join('')}</div>
            <div class="upd-party-grid">
              <div>${sellerRows.map(renderUpdLine).join('')}</div>
              <div>${buyerRows.map(renderUpdLine).join('')}</div>
            </div>
            <div class="upd-prepayment-line"><b>${html(prepaymentInvoiceLabel)}</b><span class="upd-code">(5б)</span></div>
          </div>
          <div class="upd-note">
            Приложение № 1 к постановлению Правительства Российской Федерации<br>
            от 26 декабря 2011 года № 1137<br>
            (в ред. Постановления Правительства РФ от 23.01.2026 № 26)
          </div>
        </section>
        <table class="upd-items">
          ${updColGroup}
          <thead>
            <tr class="upd-header-main">
              <th rowspan="2">Код товара/<br>работ,<br>услуг</th><th rowspan="2">№<br>п/п</th>
              <th rowspan="2">Наименование товара<br>(описание выполненных<br>работ, оказанных услуг),<br>имущественного права</th>
              <th rowspan="2">Код<br>вида<br>товара</th><th colspan="2">Единица<br>измерения</th>
              <th rowspan="2">Количе-<br>ство<br>(объем)</th><th rowspan="2">Цена<br>(тариф)<br>за единицу<br>измерения</th>
              <th rowspan="2">Стоимость товаров<br>(работ, услуг),<br>имущественных прав<br>без налога - всего</th>
              <th rowspan="2">В том<br>числе<br>сумма<br>акциза</th><th rowspan="2">Налоговая<br>ставка</th>
              <th rowspan="2">Сумма<br>налога,<br>предъявляе&shy;мая<br>покупателю</th>
              <th rowspan="2">Стоимость товаров<br>(работ, услуг),<br>имущественных прав<br>с налогом - всего</th>
              <th colspan="2">Страна происхождения<br>товара</th>
              <th rowspan="2">Регистрационный<br>номер декларации<br>на товары или<br>регистрационный<br>номер партии<br>товара,<br>подлежащего<br>прослеживае&shy;мости</th>
              <th colspan="2">Единица<br>измерения товара,<br>используемая<br>в целях осуществления<br>прослеживаемости</th>
              <th rowspan="2">Количество товара,<br>подлежащего<br>прослеживае&shy;мости</th>
              <th rowspan="2">Стоимость товара,<br>подлежащего<br>прослеживае&shy;мости,<br>без НДС</th>
            </tr>
            <tr class="upd-header-sub">
              <th>код</th><th>услов-<br>ное<br>обозна-<br>чение<br>(нацио-<br>наль-<br>ное)</th>
              <th>цифровой<br>код</th><th>краткое<br>наиме-<br>нование</th>
              <th>код</th><th>условное<br>обозначение</th>
            </tr>
          </thead>
          <tbody>
            <tr class="code-row">${updCodes.map((code) => `<td>${html(code)}</td>`).join('')}</tr>
            ${updItemRows}
            <tr class="total-row"><td></td><td colspan="7" class="center">Всего к оплате (9)</td><td class="right">${formatMoney(total)}</td><td class="center">Х</td><td class="center">Х</td><td class="center">без<br>НДС</td><td class="right">${formatMoney(total)}</td><td colspan="7"></td></tr>
          </tbody>
        </table>
        <div class="upd-footer"><span>Номер документа: ${html(invoiceNumber)}</span><span>1 / 2</span><span></span></div>
      </main>
      <main class="doc-page landscape upd upd-transfer-page">
        <section class="upd-transfer-head">
          <div class="upd-sign-grid">
            <div class="upd-sign-label" style="grid-column:1;grid-row:1">Руководитель организации<br>или иное уполномоченное лицо</div>
            <div class="upd-sign-field" style="grid-column:3;grid-row:1"><span></span><small>(подпись)</small></div>
            <div class="upd-sign-field" style="grid-column:4;grid-row:1"><span></span><small>(ф.и.о.)</small></div>
            <div class="upd-sign-label" style="grid-column:6;grid-row:1">Главный бухгалтер<br>или иное уполномоченное лицо</div>
            <div class="upd-sign-field" style="grid-column:8;grid-row:1"><span></span><small>(подпись)</small></div>
            <div class="upd-sign-field" style="grid-column:9;grid-row:1"><span></span><small>(ф.и.о.)</small></div>
            <div class="upd-sign-label" style="grid-column:1;grid-row:2">Индивидуальный предприниматель<br>или иное уполномоченное лицо</div>
            <div class="upd-sign-field" style="grid-column:3;grid-row:2"><span></span><small>(подпись)</small></div>
            <div class="upd-sign-field" style="grid-column:4;grid-row:2"><span>${html(sellerSigner)}</span><small>(ф.и.о.)</small></div>
            <div class="upd-sign-field" style="grid-column:5 / 10;grid-row:2"><span>${html(registrationDetails)}</span><small>(реквизиты свидетельства о государственной регистрации индивидуального предпринимателя)</small></div>
          </div>
        </section>
        <div class="transfer-line"><span class="line-label">Основание передачи (сдачи) / получения (приемки)</span><span class="value">${html(documentBasis(work))}</span><span class="upd-code">(10)</span></div>
        <div class="transfer-hint" style="margin-left:68mm">(договор; доверенность и др.)</div>
        <div class="transfer-line"><span class="line-label">Данные о транспортировке и грузе</span><span class="value">Услуги оказаны, груз и транспортировка отсутствуют</span><span class="upd-code">(11)</span></div>
        <div class="transfer-hint" style="margin-left:68mm">(транспортная накладная, поручение экспедитору, экспедиторская / складская расписка и др.)</div>
        <section class="transfer-sides">
          <section>
            <div class="mini-line"><span class="line-label">Товар (груз) передал / услуги,<br>результаты работ, права сдал</span><span class="value">${html(sellerSigner)}</span><span class="upd-code">(12)</span></div>
            <div class="transfer-hint">(должность, подпись, ф.и.о.)</div>
            <div class="mini-line"><span class="line-label">Дата отгрузки,<br>передачи</span><span class="value">${updDateText(work.actDate || work.invoiceDate)}</span><span class="upd-code">(13)</span></div>
            <div class="transfer-hint">(дата)</div>
            <div class="mini-line"><span class="line-label">Иные сведения<br>об отгрузке, передаче</span><span class="value">Услуги оказаны в полном объеме</span><span class="upd-code">(14)</span></div>
            <div class="mini-line"><span class="line-label">Ответственный за правильность<br>оформления факта<br>хозяйственной жизни</span><span class="value">${html(sellerSigner)}</span><span class="upd-code">(15)</span></div>
            <div class="transfer-hint">(должность, подпись, ф.и.о.)</div>
            <div class="mini-line"><span class="line-label">Наименование экономического<br>субъекта - составителя<br>документа</span><span class="value">${html(`${seller}, ИНН ${organization.inn || '-'}`)}</span><span class="upd-code">(16)</span></div>
            <div class="stamp">(М.П.)</div>
          </section>
          <section>
            <div class="mini-line"><span class="line-label">Товар (груз) получил / услуги,<br>результаты работ, права принял</span><span class="value">${html(buyerSigner)}</span><span class="upd-code">(17)</span></div>
            <div class="transfer-hint">(должность, подпись, ф.и.о.)</div>
            <div class="mini-line"><span class="line-label">Дата получения<br>(приемки)</span><span class="value"></span><span class="upd-code">(18)</span></div>
            <div class="transfer-hint">(дата)</div>
            <div class="mini-line"><span class="line-label">Иные сведения<br>о получении, приемке</span><span class="value"></span><span class="upd-code">(19)</span></div>
            <div class="mini-line"><span class="line-label">Ответственный за правильность<br>оформления факта<br>хозяйственной жизни</span><span class="value">${html(buyerSigner)}</span><span class="upd-code">(20)</span></div>
            <div class="transfer-hint">(должность, подпись, ф.и.о.)</div>
            <div class="mini-line"><span class="line-label">Наименование экономического<br>субъекта - составителя<br>документа</span><span class="value">${html(`${buyer}, ИНН ${client.inn || '-'}`)}</span><span class="upd-code">(21)</span></div>
            <div class="stamp">(М.П.)</div>
          </section>
        </section>
        <div class="upd-footer"><span>Номер документа: ${html(invoiceNumber)}</span><span>2 / 2</span><span></span></div>
      </main>`,
      'landscape',
      { pdf: true }
    );
  };
  const openPrintWindow = (htmlDocument) => {
    const printWindow = window.open('', '_blank');
    if (!printWindow) throw new Error('Браузер заблокировал окно печати');
    printWindow.document.open();
    printWindow.document.write(htmlDocument);
    printWindow.document.close();
  };

  const openSettlementDocument = (htmlDocument) => {
    const dialog = document.createElement('dialog');
    dialog.className = 'document-preview';
    dialog.setAttribute('aria-label', 'Предварительный просмотр акта сверки');
    dialog.innerHTML = '<header><h2>Акт сверки</h2><button class="secondary" type="button" data-close-preview aria-label="Закрыть предварительный просмотр">Закрыть</button></header><iframe title="Акт сверки для печати"></iframe>';
    const frame = dialog.querySelector('iframe');
    const origin = new URL(window.location.href).origin;
    const receivePdf = (event) => {
      if (event.source !== frame.contentWindow || event.origin !== origin || event.data?.type !== 'offers-base-pdf') return;
      const { blob, filename } = event.data;
      if (!(blob instanceof Blob) || blob.type !== 'application/pdf' || !blob.size || typeof filename !== 'string' || !filename.endsWith('.pdf') || /[\\/\u0000-\u001f]/.test(filename)) return;
      download(blob, filename);
    };
    window.addEventListener('message', receivePdf);
    frame.srcdoc = htmlDocument;
    dialog.querySelector('[data-close-preview]').addEventListener('click', () => dialog.close());
    dialog.addEventListener('close', () => { window.removeEventListener('message', receivePdf); dialog.remove(); });
    document.body.appendChild(dialog);
    dialog.showModal();
  };

  const openPrintDocument = (kind, workId) => {
    const work = state.db.works.find((item) => item._id === workId);
    if (!work) throw new Error('Работа не найдена');
    const organization = getOrganization(work.executorOrganizationId);
    const client = getClient(work.clientId);
    if (!organization || !client) throw new Error('Для печати нужно выбрать организацию и клиента');
    const normalizedWork = normalizeWork(work);
    const htmlDocument =
      kind === 'act'
        ? actDocument(normalizedWork, organization, client)
        : kind === 'upd'
          ? updDocument(normalizedWork, organization, client)
          : invoiceDocument(normalizedWork, organization, client);
    openPrintWindow(htmlDocument);
  };

  const shell = (content) => `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          Offers Base
          <span class="badge">static</span>
          <span class="badge dark">admin</span>
        </div>
        <nav class="nav">
          ${navButton('works', 'Работы')}
          ${navButton('clients', 'Клиенты')}
          ${navButton('report', 'Отчет')}
          ${navButton('settlement', 'Сверка')}
          ${navButton('payments', 'Платежи')}
          ${navButton('github', 'GitHub')}
          ${navButton('backup', 'Бэкапы')}
          <button class="secondary" data-action="logout">Выйти</button>
        </nav>
      </header>
      <main class="content">
        ${state.message ? `<div class="message ${state.message.type}">${html(state.message.text)}</div>` : ''}
        ${content}
      </main>
    </div>
  `;

  const navButton = (view, label) =>
    `<button class="secondary ${state.view === view ? 'active' : ''}" data-view="${view}">${label}</button>`;

  const renderLogin = () => {
    app.innerHTML = `
      <div class="login-shell">
        <form class="login-card stack" data-form="login">
          <div>
            <h1>Offers Base</h1>
          ${state.message ? `<p class="message ${state.message.type}" role="alert">${html(state.message.text)}</p>` : ''}
          <p class="muted">Статичная версия учета на GitHub Pages. Стартовые данные зашифрованы паролем.</p>
          </div>
          <label>Логин<input name="username" autocomplete="username" value="admin" /></label>
          <label>Пароль<input name="password" type="password" autocomplete="current-password" /></label>
          <button type="submit">Войти</button>
          <p class="muted">Данные сохраняются в браузере этого устройства. Экспортируйте бэкап после важных изменений.</p>
        </form>
      </div>
    `;
  };

  const workPaymentHistory = (work) => {
    if (work.source === 'kwork') return '';
    const entries = ledger.workPayments(state.db, work._id);
    return entries.length ? `<details class="work-payment-history"><summary>Платежей: ${entries.length}</summary>${entries.map((entry) => `<div>${html(paymentDateText(entry.payment.date) || 'Без даты')} · ${formatMoney(entry.amount)}</div>`).join('')}</details>` : '';
  };
  const workPaymentOptions = (clientId, organizationId, workId, selected = '') => `<option value="">Выберите платеж</option>${state.db.payments.filter((payment) => payment.clientId === clientId && payment.organizationId === organizationId
    && (ledger.availableAmount(state.db, payment._id, workId) > 0 || payment._id === selected)).map((payment) => `<option value="${html(payment._id)}" ${payment._id === selected ? 'selected' : ''}>${html(`${paymentDateText(payment.date) || 'Без даты'} · № ${payment.documentNumber || '—'} · ${formatMoney(payment.amount)} · доступно ${formatMoney(ledger.availableAmount(state.db, payment._id, workId))}`)}</option>`).join('')}`;
  const workPaymentRow = (entry, work) => `<div class="payment-allocation-row" data-work-payment-row>
    <label>Платеж<select name="linkedPaymentId">${workPaymentOptions(work.clientId, work.executorOrganizationId, work._id, entry.paymentId)}</select></label>
    <label>Сумма привязки<input name="linkedPaymentAmount" type="number" min="0.01" step="0.01" value="${html(entry.amount ?? '')}" /></label>
    <label>Назначение<select name="linkedPaymentKind"><option value="payment">Оплата</option><option value="advance" ${entry.kind === 'advance' ? 'selected' : ''}>Аванс</option></select></label>
    <button type="button" class="danger" data-action="remove-work-payment">Отвязать</button></div>`;
  const renderWorks = () => {
    app.innerHTML = shell(`
      <section class="panel stack">
        <div class="row between">
          <div>
            <h2>Работы</h2>
            <p class="muted">Текущие работы загружены из серверного бэкапа. Новые изменения хранятся в браузере.</p>
          </div>
          <button data-action="new-work">Новая работа</button>
        </div>
        <div class="work-filters">
          <label>Поиск<input data-input="work-search" placeholder="Поиск по работам, клиентам, номерам" value="${html(state.query)}" /></label>
          <label>Клиент<select data-input="work-client">
            <option value="">Все клиенты</option>
            ${[...state.db.clients].sort((left, right) => left.name.localeCompare(right.name, 'ru')).map((client) => `<option value="${html(client._id)}" ${client._id === state.workFilters.clientId ? 'selected' : ''}>${html(client.name)}</option>`).join('')}
          </select></label>
          <label>Дата документа с<input type="date" data-input="work-date-from" value="${html(state.workFilters.dateFrom)}" max="${html(state.workFilters.dateTo)}" /></label>
          <label>Дата документа по<input type="date" data-input="work-date-to" value="${html(state.workFilters.dateTo)}" min="${html(state.workFilters.dateFrom)}" /></label>
          <button class="secondary" data-action="reset-search">Сброс</button>
        </div>
      </section>
      ${renderWorkForm()}
      <section class="panel" data-work-results>${renderWorkResults()}</section>
    `);
  };

  const renderWorkResults = () => {
    const works = filteredWorks();
    const { dateFrom, dateTo } = state.workFilters;
    const invalidPeriod = dateFrom && dateTo && dateFrom > dateTo;
    return `
        ${invalidPeriod ? '<p class="message error" role="alert">Начало периода не может быть позже окончания.</p>' : `<p class="muted" role="status">Найдено: ${works.length} из ${state.db.works.length}</p>`}
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th><th>Позиции</th><th>Организация</th><th>Клиент</th><th>Документы</th>
                <th>Источник</th><th>Сумма</th><th>Сумма платежа</th><th>Дата платежа</th><th>Оплачено</th><th>Действия</th>
              </tr>
            </thead>
            <tbody>
              ${works
                .map(
                  (work) => `
                <tr>
                  <td>${displayDate(work.actDate || work.invoiceDate)}</td>
                  <td>${html(workTitle(work))}</td>
                  <td>${html(organizationName(work.executorOrganizationId))}</td>
                  <td>${html(clientName(work.clientId))}</td>
                  <td>${documentsCell(work)}</td>
                  <td><span class="badge ${work.source === 'kwork' ? 'source-kwork' : 'source-document'}">${work.source === 'kwork' ? 'Kwork' : 'Счет/акт'}</span></td>
                  <td class="work-money"><div>Заказ: ${formatMoney(getOrderAmount(work))}</div><div>Счет: ${formatMoney(getInvoiceAmount(work))}</div><div>УПД: ${formatMoney(getUpdAmount(work))}</div><small>${html(work.currency || 'RUB')}</small></td>
                  <td>${formatMoney(work.creditedAmount)} ${html(work.currency || 'RUB')}</td>
                  <td>${html(paymentDateText(work.paymentDate) || '—')}${workPaymentHistory(work)}</td>
                  <td><label class="switch" title="Статус рассчитывается по привязанным платежам"><input type="checkbox" disabled ${work.isPayed ? 'checked' : ''}/> ${work.isPayed ? 'Да' : work.creditedAmount > 0 ? 'Частично' : 'Нет'}</label></td>
                  <td>
                    <div class="row">
                      <button class="secondary" data-action="edit-work" data-id="${html(work._id)}">Редактировать</button>
                      <button class="danger" data-action="delete-work" data-id="${html(work._id)}">Удалить</button>
                    </div>
                  </td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
        ${works.length || invalidPeriod ? '' : '<p class="muted">Работы не найдены.</p>'}
    `;
  };

  const updateWorkResults = () => {
    const results = document.querySelector('[data-work-results]');
    if (results) results.innerHTML = renderWorkResults();
    const dateFrom = document.querySelector('[data-input="work-date-from"]');
    const dateTo = document.querySelector('[data-input="work-date-to"]');
    if (dateFrom) dateFrom.max = state.workFilters.dateTo;
    if (dateTo) dateTo.min = state.workFilters.dateFrom;
  };

  const emptyWork = () => ({
    _id: '',
    items: [{ name: '', quantity: 1, price: 0 }],
    creditedAmount: 0,
    orderAmount: null,
    updAmount: null,
    paymentDate: null,
    isPayed: false,
    currency: 'RUB',
    source: 'document',
    executorOrganizationId: state.db.organizations[0]?._id || '',
    clientId: state.db.clients[0]?._id || '',
    actNumber: '',
    invoiceNumber: '',
    actDate: new Date().toISOString(),
    invoiceDate: new Date().toISOString()
  });

  const renderWorkForm = () => {
    if (state.editingWorkId === null) return '';
    const work = state.editingWorkId ? state.db.works.find((item) => item._id === state.editingWorkId) || emptyWork() : emptyWork();
    const items = work.items.length ? work.items : [{ name: '', quantity: 1, price: 0 }];
    const amount = totalWorkAmount(items);
    return `
      <section class="panel stack">
        <div class="row between">
          <div>
            <h2>${state.editingWorkId ? 'Редактирование работы' : 'Новая работа'}</h2>
            <p class="muted">Номера можно оставить пустыми, они заполнятся автоматически по году даты документа.</p>
          </div>
          <button class="secondary" data-action="cancel-work">Закрыть</button>
        </div>
        <form class="stack" data-form="work">
          <input type="hidden" name="_id" value="${html(work._id)}" />
          <div class="grid">
            <label>Дата документа<input type="date" name="documentDate" value="${html(dateInput(work.actDate || work.invoiceDate) || todayInput())}" /></label>
            <label>Организация<select name="executorOrganizationId">${state.db.organizations
              .map((org) => `<option value="${html(org._id)}" ${org._id === work.executorOrganizationId ? 'selected' : ''}>${html(org.name)}</option>`)
              .join('')}</select></label>
            <label>Клиент<select name="clientId">${state.db.clients
              .map((client) => `<option value="${html(client._id)}" ${client._id === work.clientId ? 'selected' : ''}>${html(client.name)}</option>`)
              .join('')}</select></label>
            <label>Источник<select name="source">
              <option value="document" ${work.source !== 'kwork' ? 'selected' : ''}>Счет/акт</option>
              <option value="kwork" ${work.source === 'kwork' ? 'selected' : ''}>Kwork</option>
            </select></label>
            <label>Номер акта<input name="actNumber" value="${html(work.actNumber)}" /></label>
            <label>Номер счета<input name="invoiceNumber" value="${html(work.invoiceNumber)}" /></label>
            <label>Сумма счета<input data-work-total readonly value="${html(formatMoney(amount))}" /></label>
            <label>Стоимость заказа<input name="orderAmount" type="number" min="0" step="0.01" data-auto="${work.orderAmount == null}" value="${html(getOrderAmount(work))}" /></label>
            <label>Сумма УПД<input name="updAmount" type="number" min="0" step="0.01" data-auto="${work.updAmount == null}" value="${html(getUpdAmount({ ...work, amount }))}" /></label>
            <label>Договор / заказ<input name="workContract" value="${html(work.contract || '')}" /></label>
          </div>
          <div data-work-kwork-payments ${work.source === 'kwork' ? '' : 'hidden'} class="grid two">
            <label>Сумма платежа Kwork<input name="creditedAmount" type="number" min="0" step="0.01" value="${html(work.creditedAmount ?? 0)}" /></label>
            <label>Дата операции Kwork<input name="paymentDate" placeholder="ДД.ММ.ГГГГ ЧЧ:ММ:СС" value="${html(paymentDateText(work.paymentDate))}" /></label>
          </div>
          <div data-work-direct-payments ${work.source !== 'kwork' ? '' : 'hidden'} class="stack">
            <div class="row between"><h3>Привязанные платежи</h3><button type="button" class="secondary" data-action="add-work-payment">Выбрать платеж</button></div>
            <div class="stack" data-work-payment-rows>${(work._id ? ledger.workPayments(state.db, work._id) : []).map((entry) => workPaymentRow(entry, work)).join('')}</div>
          </div>
          <div class="stack">
            <div class="row between">
              <h3>Позиции работ</h3>
              <button class="secondary" type="button" data-action="add-item">Добавить позицию</button>
            </div>
            <div class="work-items">
              ${items
                .map(
                  (item, index) => `
                <div class="work-item-row" data-item-row>
                  <label>Наименование<input name="itemName" value="${html(item.name)}" /></label>
                  <label>Кол-во<input name="itemQuantity" type="number" min="0.001" step="0.001" value="${html(item.quantity || 1)}" /></label>
                  <label>Цена<input name="itemPrice" type="number" min="0" step="0.01" value="${html(item.price || 0)}" /></label>
                  <label>Сумма<input data-item-amount readonly value="${html(formatMoney((item.quantity || 0) * (item.price || 0)))}" /></label>
                  <button class="danger" type="button" data-action="remove-item" ${items.length === 1 ? 'disabled' : ''}>Удалить</button>
                </div>
              `
                )
                .join('')}
            </div>
          </div>
          <div class="row">
            <button type="submit">Сохранить</button>
            <button class="secondary" type="button" data-action="cancel-work">Отмена</button>
          </div>
        </form>
      </section>
    `;
  };

  const saveWorkFromForm = (form) => {
    const documentDate = parseDate(form.documentDate.value) || new Date();
    const items = Array.from(form.querySelectorAll('[data-item-row]'))
      .map((row) =>
        normalizeItem({
          name: row.querySelector('[name="itemName"]').value,
          quantity: row.querySelector('[name="itemQuantity"]').value,
          price: row.querySelector('[name="itemPrice"]').value
        })
      )
      .filter((item) => item.name && item.quantity > 0);
    if (!items.length) throw new Error('Добавьте хотя бы одну позицию');
    const amount = totalWorkAmount(items);
    const existingId = form._id.value;
    const year = documentDate.getFullYear();
    const source = form.source.value === 'kwork' ? 'kwork' : 'document';
    const existingWork = state.db.works.find((work) => work._id === existingId);
    if (source === 'kwork' && state.db.paymentAllocations.some((entry) => entry.workId === existingId)) throw new Error('Сначала снимите привязки платежей, прежде чем менять источник работы на Kwork');
    for (const name of ['orderAmount', 'updAmount']) {
      const input = form[name];
      if (input && input.dataset.auto !== 'true' && normalizeUpdAmount(input.value) === null) throw new Error('Суммы заказа, счета и УПД должны быть неотрицательными числами');
    }
    const enteredPaymentDate = form.paymentDate.value.trim();
    if (enteredPaymentDate && !paymentDateTime(enteredPaymentDate)) throw new Error('Укажите дату платежа в формате ДД.ММ.ГГГГ, при наличии времени — ДД.ММ.ГГГГ ЧЧ:ММ:СС');
    const payload = normalizeWork({
      ...existingWork,
      _id: existingId || uid(),
      items,
      amount,
      orderAmount: !form.orderAmount || form.orderAmount.dataset.auto === 'true' ? null : normalizeUpdAmount(form.orderAmount.value),
      contract: normalizeText(form.workContract?.value || ''),
      updAmount: form.updAmount.dataset.auto === 'true' ? null : normalizeUpdAmount(form.updAmount.value),
      paymentDate: paymentDateTime(enteredPaymentDate),
      creditedAmount: form.creditedAmount.value === '' ? amount : toNumber(form.creditedAmount.value, amount),
      isPayed: source === 'kwork',
      currency: 'RUB',
      source,
      sourceName: source === 'kwork' ? 'Kwork' : 'Счет/акт',
      platformCommission: source === 'kwork' ? Math.max(0, amount - toNumber(form.creditedAmount.value, amount)) : 0,
      payoutCommission: 0,
      executorOrganizationId: form.executorOrganizationId.value,
      clientId: form.clientId.value,
      actNumber: source === 'kwork' ? '' : normalizeText(form.actNumber.value) || nextNumber(year, 'act'),
      invoiceNumber: source === 'kwork' ? '' : normalizeText(form.invoiceNumber.value) || nextNumber(year, 'invoice'),
      actDate: documentDate.toISOString(),
      invoiceDate: documentDate.toISOString()
    });
    const collections = { ...state.db, works: [...state.db.works.filter((work) => work._id !== payload._id), payload] };
    const entries = source === 'kwork' ? [] : [...form.querySelectorAll('[data-work-payment-row]')].map((row) => ({
      paymentId: row.querySelector('[name="linkedPaymentId"]').value, amount: row.querySelector('[name="linkedPaymentAmount"]').value, kind: row.querySelector('[name="linkedPaymentKind"]').value
    })).filter((entry) => entry.paymentId || entry.amount);
    replaceCollections(ledger.setWorkAllocations(collections, payload._id, entries));
    saveDb();
    state.editingWorkId = null;
    showMessage('Работа сохранена');
  };

  const renderClients = () => {
    app.innerHTML = shell(`
      <section class="panel stack">
        <div class="row between">
          <div>
            <h2>Клиенты</h2>
            <p class="muted">Для импорта Kwork используется первый клиент с признаком физлица.</p>
          </div>
          <button data-action="new-client">Новый клиент</button>
        </div>
      </section>
      ${renderClientForm()}
      <section class="panel">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Название</th>
                <th>Тип</th>
                <th>ИНН / КПП</th>
                <th>Банк</th>
                <th>Счета</th>
                <th>Адрес</th>
                <th>Контакты</th>
                <th>Договор</th>
                <th>Подписант</th>
                <th>Действия</th>
              </tr>
            </thead>
            <tbody>
              ${state.db.clients
                .map(
                  (client) => `
                <tr>
                  <td>${html(client.name)}</td>
                  <td>${client.isPhysicalPerson ? 'Физлицо' : 'Организация'}</td>
                  <td>${cellLines([client.inn, client.kpp])}</td>
                  <td>${cellLines([client.bankName, client.bik ? `БИК ${client.bik}` : ''])}</td>
                  <td>${cellLines([
                    client.bankAccount ? `р/с ${client.bankAccount}` : '',
                    client.correspondentAccount ? `к/с ${client.correspondentAccount}` : ''
                  ])}</td>
                  <td>${cellLines([client.address])}</td>
                  <td>${cellLines([client.email, client.phone])}</td>
                  <td>${cellLines([client.contract])}</td>
                  <td>${cellLines([client.signerName])}</td>
                  <td><div class="row">
                    <button class="secondary" data-action="edit-client" data-id="${html(client._id)}">Редактировать</button>
                    <button class="danger" data-action="delete-client" data-id="${html(client._id)}">Удалить</button>
                  </div></td>
                </tr>
              `
                )
                .join('')}
            </tbody>
          </table>
        </div>
      </section>
    `);
  };

  const renderClientForm = () => {
    if (state.editingClientId === null) return '';
    const client =
      state.editingClientId === ''
        ? {
            _id: '',
            name: '',
            isPhysicalPerson: false,
            inn: '',
            kpp: '',
            bankAccount: '',
            bankName: '',
            bik: '',
            correspondentAccount: '',
            address: '',
            email: '',
            phone: '',
            contract: '',
            signerName: ''
          }
        : state.db.clients.find((item) => item._id === state.editingClientId);
    if (!client) return '';
    return `
      <section class="panel stack">
        <div class="row between"><h2>${client._id ? 'Редактирование клиента' : 'Новый клиент'}</h2><button class="secondary" data-action="cancel-client">Закрыть</button></div>
        <form class="stack" data-form="client">
          <input type="hidden" name="_id" value="${html(client._id)}" />
          <div class="grid two">
            <label>Название<input name="name" required value="${html(client.name)}" /></label>
            <label>ИНН<input name="inn" value="${html(client.inn || '')}" /></label>
            <label>КПП<input name="kpp" value="${html(client.kpp || '')}" /></label>
            <label>Расчетный счет<input name="bankAccount" value="${html(client.bankAccount || '')}" /></label>
            <label>Банк<input name="bankName" value="${html(client.bankName || '')}" /></label>
            <label>БИК<input name="bik" value="${html(client.bik || '')}" /></label>
            <label>Корр. счет<input name="correspondentAccount" value="${html(client.correspondentAccount || '')}" /></label>
            <label>Email<input name="email" value="${html(client.email || '')}" /></label>
            <label>Телефон<input name="phone" value="${html(client.phone || '')}" /></label>
            <label>Договор<input name="contract" value="${html(client.contract || '')}" /></label>
            <label>Подписант<input name="signerName" value="${html(client.signerName || '')}" /></label>
            <label>Физлицо<span class="switch"><input name="isPhysicalPerson" type="checkbox" ${client.isPhysicalPerson ? 'checked' : ''}/> Это физлицо</span></label>
          </div>
          <label>Адрес<textarea name="address">${html(client.address || '')}</textarea></label>
          <div class="row"><button type="submit">Сохранить</button><button class="secondary" type="button" data-action="cancel-client">Отмена</button></div>
        </form>
      </section>
    `;
  };

  const saveClientFromForm = (form) => {
    const payload = normalizeClient({
      _id: form._id.value || uid(),
      name: form.name.value,
      isPhysicalPerson: form.isPhysicalPerson.checked,
      inn: normalizeText(form.inn.value),
      kpp: normalizeText(form.kpp.value),
      bankAccount: normalizeText(form.bankAccount.value),
      bankName: normalizeText(form.bankName.value),
      bik: normalizeText(form.bik.value),
      correspondentAccount: normalizeText(form.correspondentAccount.value),
      email: normalizeText(form.email.value),
      phone: normalizeText(form.phone.value),
      contract: normalizeText(form.contract.value),
      signerName: normalizeText(form.signerName.value),
      address: normalizeText(form.address.value)
    });
    if (!payload.name) throw new Error('Укажите название клиента');
    const index = state.db.clients.findIndex((client) => client._id === payload._id);
    if (index >= 0) state.db.clients[index] = { ...state.db.clients[index], ...payload };
    else state.db.clients.push(payload);
    saveDb();
    state.editingClientId = null;
    showMessage('Клиент сохранен');
  };

  const aggregateReport = () => window.OffersIncomeReport.aggregate(state.db, state.paidOnly);

  const renderReport = () => {
    const report = aggregateReport();
    app.innerHTML = shell(`
      <section class="panel stack">
        <div class="row between">
          <div>
            <h2>Отчет</h2>
            <p class="muted">Книга доходов по работам в локальной базе браузера.</p>
          </div>
          <label class="switch"><input type="checkbox" data-action="toggle-report-paid" ${state.paidOnly ? 'checked' : ''}/> Работы: только оплаченные</label>
        </div>
        <div class="totals">
          ${metric('Записей', report.summary.totalWorks)}
          ${metric('Оплачено', report.summary.paidWorksCount)}
          ${metric('Доход', `${formatMoney(report.summary.totalAmount)} ₽`)}
          ${metric('На счет', `${formatMoney(report.summary.totalCreditedAmount)} ₽`)}
          ${metric('Комиссия', `${formatMoney(report.summary.totalCommission)} ₽`)}
        </div>
      </section>
      ${report.months
        .map(
          (month) => `
        <section class="panel stack">
          <div class="row between">
            <h3>${html(month.label)}</h3>
            <div class="row">
              <span class="badge">Записей: ${month.totalWorks}</span>
              <span class="badge dark">Доход: ${formatMoney(month.totalAmount)} ₽</span>
            </div>
          </div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Источник</th><th>Клиент</th><th>Записей</th><th>Оплачено</th><th>Доход</th><th>На счет</th><th>Комиссия</th></tr></thead>
              <tbody>
                ${month.rows
                  .map(
                    (row) => `
                  <tr>
                    <td>${row.source === 'kwork' ? 'Kwork' : 'Счет/акт'}</td>
                    <td>${html(row.clientName)}</td>
                    <td>${row.worksCount}</td>
                    <td>${row.paidWorksCount}</td>
                    <td>${formatMoney(row.totalAmount)} ₽</td>
                    <td>${formatMoney(row.totalCreditedAmount)} ₽</td>
                    <td>${formatMoney(row.totalCommission)} ₽</td>
                  </tr>
                `
                  )
                  .join('')}
              </tbody>
            </table>
          </div>
        </section>
      `
        )
        .join('')}
    `);
  };

  const metric = (label, value) => `<div class="metric"><span class="muted">${html(label)}</span><strong>${html(value)}</strong></div>`;

  const renderBackup = () => {
    app.innerHTML = shell(`
      <section class="panel stack">
        <h2>Импорт Kwork</h2>
        <p class="muted">Поддерживаются листы "Операции вне баланса" и "Пополнение баланса". Импорт создает оплаченные работы Kwork.</p>
        <div class="row">
          <input style="max-width:420px" type="file" accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" data-input="kwork-file" />
          <button data-action="import-kwork">Импортировать работы Kwork</button>
        </div>
      </section>
      <section class="panel stack">
        <h2>Бэкапы</h2>
        <p class="muted">Экспорт сохраняет все локальные данные из этого браузера. Импорт заменяет локальную базу.</p>
        <div class="row">
          <button data-action="export-backup">Скачать бэкап</button>
          <input style="max-width:420px" type="file" accept=".json,.gz,application/json,application/gzip" data-input="backup-file" />
          <button class="secondary" data-action="import-backup">Восстановить из бэкапа</button>
          <button class="danger" data-action="reset-seed">Сбросить к стартовым данным</button>
        </div>
      </section>
    `);
  };

  const backupPayload = () => {
    const collections = ledger.exportCompatible({
      clients: state.db.clients,
      files: state.db.files || [],
      organizations: state.db.organizations,
      sequences: state.db.sequences || [],
      users: state.db.users || [],
      works: state.db.works,
      payments: state.db.payments,
      paymentAllocations: state.db.paymentAllocations,
      'uploads.chunks': state.db.uploadsChunks || [],
      'uploads.files': state.db.uploadsFiles || []
    });
    const collectionNames = ['clients', 'files', 'organizations', 'sequences', 'users', 'works', 'payments', 'paymentAllocations', 'uploads.chunks', 'uploads.files'];

    return {
      meta: {
        createdAt: new Date().toISOString(),
        database: 'offers-base-static',
        schemaVersion: 2,
        dataRevisions: state.db.meta?.dataRevisions || [],
        appliedDataRevisions: state.db.meta?.appliedDataRevisions || [],
        collections: collectionNames
      },
      collections: Object.fromEntries(
        collectionNames.map((name) => [
          name,
          (collections[name] || []).map((document) => serializeBackupDocument(name, document))
        ])
      )
    };
  };

  const download = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const exportBackup = async () => {
    const text = JSON.stringify(backupPayload(), null, 2);
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 15);
    if ('CompressionStream' in window) {
      const stream = new Blob([text], { type: 'application/json' }).stream().pipeThrough(new CompressionStream('gzip'));
      const blob = await new Response(stream).blob();
      download(blob, `offers-base-static-backup-${stamp}.json.gz`);
      return;
    }
    download(new Blob([text], { type: 'application/json' }), `offers-base-static-backup-${stamp}.json`);
  };

  const readBackupFile = async (file) => {
    if (!file) throw new Error('Выберите файл бэкапа');
    if (file.name.endsWith('.gz')) {
      if (!('DecompressionStream' in window)) throw new Error('Этот браузер не умеет распаковывать gzip. Загрузите JSON-бэкап.');
      const stream = file.stream().pipeThrough(new DecompressionStream('gzip'));
      return new Response(stream).text();
    }
    return file.text();
  };

  const restoreBackup = async (file) => {
    const text = await readBackupFile(file);
    const payload = reviveMongo(JSON.parse(text));
    if (!['organizations', 'clients', 'works'].every((name) => Array.isArray(payload.collections?.[name]))) throw new Error('В бекапе отсутствуют обязательные коллекции');
    const revisions = [...new Map([...(state.db.meta?.dataRevisions || []), ...(payload.meta?.dataRevisions || [])].map((revision) => [revision.id, revision])).values()];
    const revised = window.OffersDataRevisions.apply(payload, revisions);
    state.db = dbFromCollections(revised.collections, { ...revised.meta, restoredAt: new Date().toISOString() });
    saveDb();
    showMessage('Бэкап восстановлен');
  };

  const parseMoney = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value >= 0 ? value : null;
    const normalized = String(value ?? '')
      .replace(/\s/g, '')
      .replace(',', '.')
      .replace(/[^\d.-]/g, '');
    const parsed = Number(normalized);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  };

  const parseSheetDate = (value) => {
    if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
    if (typeof value === 'number' && window.XLSX) {
      const parsed = XLSX.SSF.parse_date_code(value);
      if (parsed) return new Date(Date.UTC(parsed.y, parsed.m - 1, parsed.d, parsed.H, parsed.M, Math.floor(parsed.S)));
    }
    const text = String(value ?? '').trim();
    let match = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
    if (match) {
      const [, year, month, day, hour = '00', minute = '00', second = '00'] = match;
      return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
    }
    match = /^(\d{2})\.(\d{2})\.(\d{4})(?:\s+(\d{2}):(\d{2})(?::(\d{2}))?)?/.exec(text);
    if (match) {
      const [, day, month, year, hour = '00', minute = '00', second = '00'] = match;
      return new Date(Date.UTC(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)));
    }
    return null;
  };

  const importKwork = async (file) => {
    if (!window.XLSX) throw new Error('Библиотека XLSX не загрузилась. Обновите страницу и попробуйте снова.');
    if (!file) throw new Error('Выберите XLSX файл');
    const workbook = XLSX.read(await file.arrayBuffer(), { type: 'array', cellDates: true });
    const sheets = ['Операции вне баланса', 'Пополнение баланса'];
    const rows = [];
    const warnings = [];
    let totalRows = 0;
    for (const sheetName of sheets) {
      const sheet = workbook.Sheets[sheetName];
      if (!sheet) {
        warnings.push(`${sheetName}: лист не найден`);
        continue;
      }
      const matrix = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: null, raw: false });
      const header = matrix[0] || [];
      const columns = new Map();
      header.forEach((cell, index) => {
        const name = normalizeText(cell);
        if (name) columns.set(name, index);
      });
      const required = ['Дата', 'Описание', 'Сумма', 'Сумма чека самозанятого', 'Статус'];
      const missing = required.filter((item) => columns.get(item) === undefined);
      if (missing.length) {
        warnings.push(`${sheetName}: нет колонок ${missing.join(', ')}`);
        continue;
      }
      for (let index = 1; index < matrix.length; index += 1) {
        const sourceRow = matrix[index];
        const read = (name) => sourceRow[columns.get(name)];
        if (!sourceRow || sourceRow.every((cell) => !normalizeText(cell))) continue;
        if (normalizeText(read('Дата')).startsWith('ИТОГО')) continue;
        totalRows += 1;
        const status = normalizeText(read('Статус'));
        if (status && status !== 'Выполнено') {
          warnings.push(`${sheetName}, строка ${index + 1}: статус ${status}`);
          continue;
        }
        const date = parseSheetDate(read('Дата'));
        const description = normalizeText(read('Описание'));
        const netAmount = parseMoney(read('Сумма'));
        const grossAmount = parseMoney(read('Сумма чека самозанятого'));
        if (!date || !description || netAmount === null || grossAmount === null) {
          warnings.push(`${sheetName}, строка ${index + 1}: некорректные данные`);
          continue;
        }
        rows.push({ date, description, netAmount, grossAmount });
      }
    }
    const organization = state.db.organizations[0];
    const client = state.db.clients.find((item) => item.isPhysicalPerson);
    if (!organization) throw new Error('Для импорта нужна организация');
    if (!client) throw new Error('Для импорта нужен клиент с признаком "Это физлицо"');
    let importedRows = 0;
    let skippedDuplicates = 0;
    const sortedRows = [...rows].sort((left, right) => {
      const byDate = left.date.getTime() - right.date.getTime();
      return byDate || left.description.localeCompare(right.description, 'ru');
    });
    for (const row of sortedRows) {
      const duplicate = state.db.works.some(
        (work) =>
          sameDay(work.actDate || work.invoiceDate, row.date) &&
          Math.abs(work.amount - row.grossAmount) < 0.000001 &&
          Math.abs((work.creditedAmount || work.amount) - row.netAmount) < 0.000001 &&
          work.items.some((item) => normalizeText(item.name) === row.description)
      );
      if (duplicate) {
        skippedDuplicates += 1;
        continue;
      }
      state.db.works.push(
        normalizeWork({
          _id: uid(),
          items: [{ name: row.description, quantity: 1, price: row.grossAmount }],
          creditedAmount: row.netAmount,
          isPayed: true,
          currency: 'RUB',
          executorOrganizationId: organization._id,
          clientId: client._id,
          actNumber: '',
          invoiceNumber: '',
          actDate: row.date.toISOString(),
          invoiceDate: row.date.toISOString(),
          source: 'kwork',
          sourceName: 'Kwork',
          platformCommission: Math.max(0, row.grossAmount - row.netAmount),
          payoutCommission: 0
        })
      );
      importedRows += 1;
    }
    saveDb();
    showMessage(
      `Импорт Kwork завершен. Строк всего: ${totalRows}. Распознано: ${rows.length}. Создано: ${importedRows}. Дубликатов: ${skippedDuplicates}. Предупреждений: ${warnings.length}.`
    );
  };

  const render = () => {
    if (!isLoggedIn() || !state.db) {
      renderLogin();
      return;
    }
    if (state.view === 'clients') renderClients();
    else if (state.view === 'report') renderReport();
    else if (state.view === 'settlement') app.innerHTML = shell(settlementView.render());
    else if (state.view === 'backup') renderBackup();
    else if (state.view === 'payments') app.innerHTML = shell(paymentView.render() + browserFeatures.renderPayments());
    else if (state.view === 'github') app.innerHTML = shell(browserFeatures.renderGithub());
    else renderWorks();
  };

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('form');
    if (!form) return;
    event.preventDefault();
    clearMessage();
    try {
      if (paymentView.handleSubmit(form)) return;
      if (form.dataset.form === 'login') {
        if (normalizeText(form.username.value) !== ADMIN.username || !(await verifyPassword(form.password.value))) {
          throw new Error('Неверный логин или пароль');
        }
        state.password = form.password.value;
        state.db = await loadDb(state.password);
        setLoggedIn(true);
        render();
        return;
      }
      if (form.dataset.form === 'work') saveWorkFromForm(form);
      if (form.dataset.form === 'client') saveClientFromForm(form);
    } catch (error) {
      showMessage(error.message || 'Ошибка', 'error');
    }
  });

  document.addEventListener('input', (event) => {
    const target = event.target;
    if (paymentView.handleInput(target)) return;
    if (settlementView.handleInput(target)) return;
    if (browserFeatures.handleInput(target)) return;
    if (target.dataset.input === 'work-search') {
      state.query = target.value;
      updateWorkResults();
    }
    if (['updAmount', 'orderAmount'].includes(target.name)) {
      target.dataset.auto = target.value === '' ? 'true' : 'false';
      updateWorkTotals(target.closest('form'));
    }
    if (target.name === 'creditedAmount' || target.name === 'source') {
      const form = target.closest('form');
      const isKwork = form.source.value === 'kwork';
      form.querySelector('[data-work-kwork-payments]').hidden = !isKwork;
      form.querySelector('[data-work-direct-payments]').hidden = isKwork;
    }
    if (target.name === 'itemName' || target.name === 'itemQuantity' || target.name === 'itemPrice') {
      const row = target.closest('[data-item-row]');
      if (row) updateWorkItemAmount(row);
      updateWorkTotals(target.closest('form'));
    }
  });

  document.addEventListener('change', (event) => {
    const target = event.target;
    if (paymentView.handleChange(target)) return;
    if (settlementView.handleChange(target)) return;
    if (browserFeatures.handleChange(target)) return;
    const filter = { 'work-client': 'clientId', 'work-date-from': 'dateFrom', 'work-date-to': 'dateTo' }[target.dataset.input];
    if (filter) {
      state.workFilters[filter] = target.value;
      updateWorkResults();
    }
    if (['clientId', 'executorOrganizationId'].includes(target.name)) {
      const form = target.closest('form');
      for (const input of form.querySelectorAll('[name="linkedPaymentId"]')) input.innerHTML = workPaymentOptions(form.clientId.value, form.executorOrganizationId.value, form._id.value, input.value);
    }
  });

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action], [data-view]');
    if (!target) return;
    clearMessage();
    const action = target.dataset.action;
    try {
      if (paymentView.handleAction(action, target)) return;
      if (settlementView.handleAction(action, target)) return;
      if (await browserFeatures.handleAction(action, target)) return;
      if (target.dataset.view) {
        state.view = target.dataset.view;
        state.editingWorkId = null;
        state.editingClientId = null;
        render();
        return;
      }
      if (action === 'logout') {
        browserFeatures.clearSecrets();
        state.password = null;
        setLoggedIn(false);
        render();
      }
      if (action === 'new-work') {
        state.editingWorkId = '';
        renderWorks();
      }
      if (action === 'edit-work') {
        state.view = 'works';
        state.editingWorkId = target.dataset.id;
        renderWorks();
      }
      if (action === 'cancel-work') {
        state.editingWorkId = null;
        renderWorks();
      }
      if (action === 'delete-work') {
        if (confirm('Удалить работу? Платежи останутся в журнале без привязки к этой работе.')) {
          replaceCollections(ledger.removeWork(state.db, target.dataset.id));
          saveDb();
          renderWorks();
        }
      }
      if (action === 'add-work-payment') {
        const form = target.closest('form'); const row = document.createElement('div');
        row.innerHTML = workPaymentRow({}, { _id: form._id.value, clientId: form.clientId.value, executorOrganizationId: form.executorOrganizationId.value });
        form.querySelector('[data-work-payment-rows]').appendChild(row.firstElementChild);
      }
      if (action === 'remove-work-payment') target.closest('[data-work-payment-row]').remove();
      if (action === 'reset-search') {
        state.query = '';
        state.workFilters = { clientId: '', dateFrom: '', dateTo: '' };
        for (const name of ['work-search', 'work-client', 'work-date-from', 'work-date-to']) {
          const input = document.querySelector(`[data-input="${name}"]`);
          if (input) input.value = '';
        }
        updateWorkResults();
      }
      if (action === 'print-doc') {
        openPrintDocument(target.dataset.doc, target.dataset.id);
      }
      if (action === 'add-item') {
        const container = document.querySelector('.work-items');
        const row = document.querySelector('[data-item-row]').cloneNode(true);
        row.querySelectorAll('input').forEach((input) => {
          input.value = input.name === 'itemQuantity' ? '1' : input.name === 'itemPrice' ? '0' : '';
          input.readOnly = input.readOnly;
        });
        updateWorkItemAmount(row);
        row.querySelector('[data-action="remove-item"]').disabled = false;
        container.appendChild(row);
        updateWorkTotals(container.closest('form'));
      }
      if (action === 'remove-item') {
        const form = target.closest('form');
        target.closest('[data-item-row]').remove();
        updateWorkTotals(form);
      }
      if (action === 'new-client') {
        state.editingClientId = '';
        renderClients();
      }
      if (action === 'edit-client') {
        state.editingClientId = target.dataset.id;
        renderClients();
      }
      if (action === 'cancel-client') {
        state.editingClientId = null;
        renderClients();
      }
      if (action === 'delete-client') {
        const used = state.db.works.some((work) => work.clientId === target.dataset.id) || state.db.payments.some((payment) => payment.clientId === target.dataset.id);
        if (used) throw new Error('Нельзя удалить клиента, который используется в работах или платежах');
        if (confirm('Удалить клиента?')) {
          state.db.clients = state.db.clients.filter((client) => client._id !== target.dataset.id);
          saveDb();
          renderClients();
        }
      }
      if (action === 'toggle-report-paid') {
        state.paidOnly = target.checked;
        renderReport();
      }
      if (action === 'import-kwork') {
        await importKwork(document.querySelector('[data-input="kwork-file"]').files[0]);
      }
      if (action === 'export-backup') {
        await exportBackup();
      }
      if (action === 'import-backup') {
        if (confirm('Восстановить бэкап и заменить локальные данные?')) {
          await restoreBackup(document.querySelector('[data-input="backup-file"]').files[0]);
        }
      }
      if (action === 'reset-seed') {
        if (!state.password) throw new Error('Для сброса к стартовым данным выйдите и войдите снова');
        if (confirm('Сбросить локальные данные к стартовому бэкапу?')) {
          state.db = await seedDb(state.password);
          saveDb(state.db, { markChanged: false });
          showMessage('Данные сброшены к стартовым');
        }
      }
    } catch (error) {
      showMessage(error.message || 'Ошибка', 'error');
    }
  });

  const browserFeatures = window.OffersBrowserFeatures.create({
    html, formatMoney, paymentDateText, document, storage: localStorage,
    getDb: () => state.db, exportPayload: backupPayload,
    replacePayload: (payload, meta) => { state.db = dbFromCollections(reviveMongo(payload.collections), meta); },
    saveDb, render, message: showMessage, confirm: (message) => confirm(message),
    getPassword: () => state.password,
    getSeed: () => window.__OFFERS_SEED_ENCRYPTED__, setSeed: (packet) => { window.__OFFERS_SEED_ENCRYPTED__ = packet; }
  });
  const settlementView = window.OffersSettlementView.create({
    html, formatMoney, displayDate, paymentDateText, document, amountToWords, personShortName, printableShell, sanitizeDocumentPart,
    today: todayInput, getDb: () => state.db, render, openDocument: openSettlementDocument
  });
  const paymentView = window.OffersPaymentView.create({
    html, formatMoney, paymentDateText, document, uid, getDb: () => state.db, replaceCollections, saveDb, render,
    confirm: (message) => confirm(message), message: showMessage, showView: () => { state.view = 'payments'; }
  });
  window.addEventListener?.('pagehide', () => { browserFeatures.clearSecrets(); state.password = null; });

  if (isLoggedIn()) {
    state.db = loadStoredDb();
    if (!state.db) setLoggedIn(false);
  }
  render();
})();
