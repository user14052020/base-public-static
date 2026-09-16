(() => {
  const DB_KEY = 'offers-base-static-db-v1';
  const SESSION_KEY = 'offers-base-static-session-v1';
  const ADMIN = {
    username: 'admin',
    salt: 'snwdPP34s/2j99J7Sm3VkA==',
    hash: 'pcDnecfCBTLHKnb3NH5cHwx/d0ylk765Irk4gZjEnAs=',
    iterations: 250000
  };

  const app = document.getElementById('app');
  const state = {
    db: null,
    view: 'works',
    editingWorkId: null,
    editingClientId: null,
    query: '',
    paidOnly: true,
    message: null,
    password: null
  };

  const money = new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const monthLabel = new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric' });

  const html = (value) =>
    String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#039;');

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
    const items = Array.isArray(work.items) ? work.items.map(normalizeItem).filter((item) => item.name) : [];
    const amount = items.reduce((sum, item) => sum + item.amount, 0);
    const actDate = parseDate(work.actDate) || parseDate(work.invoiceDate) || new Date();
    const invoiceDate = parseDate(work.invoiceDate) || actDate;
    return {
      ...work,
      _id: idOf(work._id) || uid(),
      executorOrganizationId: idOf(work.executorOrganizationId),
      clientId: idOf(work.clientId),
      items,
      amount,
      creditedAmount: Math.max(0, toNumber(work.creditedAmount, amount)),
      isPayed: Boolean(work.isPayed),
      currency: work.currency || 'RUB',
      source: work.source === 'kwork' ? 'kwork' : 'document',
      sourceName: work.sourceName || (work.source === 'kwork' ? 'Kwork' : 'Счет/акт'),
      platformCommission: Math.max(0, toNumber(work.platformCommission, 0)),
      payoutCommission: Math.max(0, toNumber(work.payoutCommission, 0)),
      actNumber: String(work.actNumber || ''),
      invoiceNumber: String(work.invoiceNumber || ''),
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
    name: normalizeText(organization.name)
  });

  const dbFromCollections = (collections, meta = {}) => ({
    meta: {
      ...meta
    },
    organizations: (collections.organizations || []).map(normalizeOrganization),
    clients: (collections.clients || []).map(normalizeClient),
    works: (collections.works || []).map(normalizeWork),
    users: collections.users || [],
    files: collections.files || [],
    uploadsFiles: collections['uploads.files'] || [],
    uploadsChunks: collections['uploads.chunks'] || []
  });

  const decryptSeed = async (password) => {
    const encrypted = window.__OFFERS_SEED_ENCRYPTED__;
    if (!encrypted) throw new Error('Стартовый бэкап не найден');
    const rawKey = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    const key = await crypto.subtle.deriveKey(
      {
        name: 'PBKDF2',
        salt: base64ToBytes(encrypted.salt),
        iterations: encrypted.iterations,
        hash: 'SHA-256'
      },
      rawKey,
      { name: 'AES-GCM', length: 256 },
      false,
      ['decrypt']
    );
    const plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: base64ToBytes(encrypted.iv) },
      key,
      base64ToBytes(encrypted.data)
    );
    return JSON.parse(new TextDecoder().decode(plain));
  };

  const seedDb = async (password) => {
    const seed = reviveMongo(await decryptSeed(password));
    const collections = seed.collections || {};
    return dbFromCollections(collections, { createdAt: new Date().toISOString(), source: 'seed' });
  };

  const loadStoredDb = () => {
    const stored = localStorage.getItem(DB_KEY);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        return {
          ...parsed,
          organizations: (parsed.organizations || []).map(normalizeOrganization),
          clients: (parsed.clients || []).map(normalizeClient),
          works: (parsed.works || []).map(normalizeWork)
        };
      } catch {
        localStorage.removeItem(DB_KEY);
      }
    }
    return null;
  };

  const loadDb = async (password) => {
    const stored = loadStoredDb();
    if (stored) return stored;
    const seeded = await seedDb(password);
    saveDb(seeded);
    return seeded;
  };

  const saveDb = (db = state.db) => {
    db.meta = { ...(db.meta || {}), updatedAt: new Date().toISOString() };
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
  const partyLine = (party) =>
    [party?.name, innKpp(party), party?.address].map(normalizeText).filter(Boolean).join(', ') || '-';
  const signerName = (party) => party?.signerName || party?.shortName || party?.name || '';
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
  const documentsCell = (work) => `
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
  const printableShell = (title, body, layout = 'portrait') => `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="utf-8" />
    <title>${html(title)}</title>
    <style>
      @page { size: A4 ${layout}; margin: 12mm; }
      * { box-sizing: border-box; }
      body { margin: 0; color: #111; font: 12px/1.35 Arial, sans-serif; }
      h1, h2, h3, p { margin: 0; }
      .no-print { position: sticky; top: 0; display: flex; gap: 8px; justify-content: flex-end; padding: 8px; background: #fff; border-bottom: 1px solid #ddd; }
      .no-print button { border: 1px solid #222; background: #222; color: #fff; border-radius: 6px; padding: 7px 10px; cursor: pointer; }
      .doc-page { max-width: 190mm; margin: 0 auto; }
      .landscape { max-width: 273mm; }
      .title { margin: 18px 0 14px; text-align: center; font-size: 19px; font-weight: 700; }
      .subtitle { margin: 8px 0; }
      .line { margin: 5px 0; }
      .party { margin: 7px 0; }
      table { width: 100%; border-collapse: collapse; }
      th, td { border: 1px solid #111; padding: 5px 6px; vertical-align: top; }
      th { text-align: center; font-weight: 700; background: #f5f5f5; }
      .right { text-align: right; }
      .center { text-align: center; }
      .bold { font-weight: 700; }
      .bank td { height: 23px; }
      .totals td { font-weight: 700; }
      .summary { margin-top: 14px; }
      .signatures { display: grid; grid-template-columns: 1fr 1fr; gap: 28px; margin-top: 48px; }
      .sign-box { min-height: 74px; border: 1px solid #111; padding: 10px; }
      .sign-line { margin-top: 26px; border-bottom: 1px solid #111; min-height: 18px; }
      .upd { font-size: 7.2px; line-height: 1.12; }
      .upd .top { display: grid; grid-template-columns: 72px 1fr 230px; gap: 8px; align-items: start; }
      .upd .side { border-right: 2px solid #111; padding-right: 5px; min-height: 146px; }
      .upd .status { display: inline-grid; place-items: center; width: 22px; height: 18px; border: 1px solid #111; font-size: 12px; font-weight: 700; }
      .upd .fns { text-align: right; }
      .upd-line { display: grid; grid-template-columns: 172px 1fr 24px; gap: 5px; min-height: 12px; }
      .upd-value { border-bottom: 1px solid #111; min-height: 11px; }
      .upd table { margin-top: 5px; }
      .upd th, .upd td { padding: 2px; font-size: 6.8px; line-height: 1.05; }
      .upd-transfer { margin-top: 12px; display: grid; gap: 6px; }
      @media print {
        .no-print { display: none; }
        body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
      }
    </style>
  </head>
  <body>
    <div class="no-print"><button onclick="window.print()">Печать / сохранить PDF</button></div>
    ${body}
    <script>window.addEventListener('load', () => setTimeout(() => window.print(), 300));</script>
  </body>
</html>`;
  const invoiceDocument = (work, organization, client) => {
    const total = totalWorkAmount(work.items);
    return printableShell(
      documentTitle('invoice', work),
      `<main class="doc-page">
        <h1 class="title">Счет № ${html(work.invoiceNumber || '-')} от ${displayDate(work.invoiceDate)} г.</h1>
        <table class="bank">
          <tr><td>ИНН ${html(organization.inn || '')}</td><td>КПП ${html(organization.kpp || '')}</td><td>Сч. №</td><td>${html(organization.bankAccount || '')}</td></tr>
          <tr><td colspan="2">Получатель<br><b>${html(organization.name || '')}</b></td><td>БИК</td><td>${html(organization.bik || '')}</td></tr>
          <tr><td colspan="2">Банк получателя<br>${html(organization.bankName || '')}</td><td>Сч. №</td><td>${html(organization.correspondentAccount || '')}</td></tr>
        </table>
        <p class="party"><b>Поставщик:</b> ${html(partyLine(organization))}</p>
        <p class="party"><b>Покупатель:</b> ${html(partyLine(client))}</p>
        <table>
          <thead><tr><th style="width:36px">№</th><th>Наименование товара/услуги</th><th style="width:130px">Сумма</th></tr></thead>
          <tbody>${printableRows(work, 'simple')}</tbody>
          <tfoot class="totals">
            <tr><td colspan="2" class="right">Итого:</td><td class="right">${formatMoney(total)}</td></tr>
            <tr><td colspan="2" class="right">Итого НДС:</td><td class="right">0,00</td></tr>
            <tr><td colspan="2" class="right">Всего к оплате:</td><td class="right">${formatMoney(total)}</td></tr>
          </tfoot>
        </table>
        <p class="summary">Всего наименований ${work.items.length}, на сумму ${formatMoney(total)} руб.</p>
        <p class="summary bold">${html(amountToWords(total))}</p>
        <section class="signatures">
          <div class="sign-box"><b>Руководитель предприятия</b><div class="sign-line">${html(signerName(organization))}</div></div>
          <div class="sign-box"><b>Главный бухгалтер</b><div class="sign-line">${html(organization.chiefAccountant || '')}</div></div>
        </section>
      </main>`
    );
  };
  const actDocument = (work, organization, client) => {
    const total = totalWorkAmount(work.items);
    const totalQuantity = work.items.reduce((sum, item) => sum + toNumber(item.quantity, 0), 0);
    return printableShell(
      documentTitle('act', work),
      `<main class="doc-page">
        <h1 class="title">Акт выполненных работ (оказанных услуг) № ${html(work.actNumber || '-')} от ${displayDate(work.actDate)} г.</h1>
        <p class="party"><b>Исполнитель:</b> ${html(partyLine(organization))}</p>
        <p class="party"><b>Заказчик:</b> ${html(partyLine(client))}</p>
        <p class="party"><b>Договор:</b> ${html(client.contract || '-')}</p>
        <table>
          <thead><tr><th style="width:36px">№</th><th>Наименование услуги</th><th style="width:90px">Количество</th><th style="width:100px">Цена</th><th style="width:110px">Сумма</th></tr></thead>
          <tbody>${printableRows(work)}</tbody>
          <tfoot class="totals">
            <tr><td colspan="4" class="right">Итого:</td><td class="right">${formatMoney(total)}</td></tr>
            <tr><td colspan="4" class="right">Без налога (НДС):</td><td class="right">-</td></tr>
          </tfoot>
        </table>
        <p class="summary">Всего оказано услуг: ${quantityText(totalQuantity)}, на сумму: ${formatMoney(total)} руб.</p>
        <p class="summary bold">Всего к оплате: ${html(amountToWords(total))}</p>
        <p class="summary">Вышеперечисленные услуги выполнены полностью и в срок. Заказчик претензий по объему, качеству и срокам оказания услуг не имеет.</p>
        <section class="signatures">
          <div class="sign-box"><b>Исполнитель</b><div class="sign-line">${html(signerName(organization))}</div></div>
          <div class="sign-box"><b>Заказчик</b><div class="sign-line">${html(signerName(client))}</div></div>
        </section>
      </main>`
    );
  };
  const updDocument = (work, organization, client) => {
    const total = totalWorkAmount(work.items);
    const invoiceNumber = work.invoiceNumber || work.actNumber || '-';
    return printableShell(
      documentTitle('upd', work),
      `<main class="doc-page landscape upd">
        <section class="top">
          <div class="side">
            <b>Универсальный<br>передаточный<br>документ</b><br><br>
            Статус <span class="status">2</span><br><br>
            1 - счет-фактура<br>и передаточный<br>документ (акт)<br>
            2 - передаточный<br>документ (акт)<br>
            3 - счет-фактура
          </div>
          <div>
            ${[
              ['Счет-фактура N', `${invoiceNumber} от ${displayDate(work.invoiceDate)}` , '(1)'],
              ['Исправление N', '- от -', '(1а)'],
              ['Продавец:', organization.name || '-', '(2)'],
              ['Адрес:', organization.address || '-', '(2а)'],
              ['ИНН/КПП продавца:', innKpp(organization) || '-', '(2б)'],
              ['Грузоотправитель и его адрес:', 'он же', '(3)'],
              ['Грузополучатель и его адрес:', '-', '(4)'],
              ['Документ об отгрузке:', `УПД № ${invoiceNumber} от ${displayDate(work.invoiceDate)}`, '(5а)'],
              ['Покупатель:', client.name || '-', '(6)'],
              ['Адрес:', client.address || '-', '(6а)'],
              ['ИНН/КПП покупателя:', innKpp(client) || '-', '(6б)'],
              ['Валюта: наименование, код', 'Российский рубль, 643', '(7)']
            ]
              .map(([label, value, code]) => `<div class="upd-line"><b>${html(label)}</b><span class="upd-value">${html(value)}</span><span>${html(code)}</span></div>`)
              .join('')}
          </div>
          <div class="fns">
            Приложение № 1 к постановлению Правительства Российской Федерации<br>
            от 26 декабря 2011 года № 1137<br>
            (в ред. Постановления Правительства РФ от 23.01.2026 № 26)
          </div>
        </section>
        <table>
          <thead>
            <tr>
              <th rowspan="2">№<br>п/п</th><th rowspan="2">Наименование товара<br>(описание выполненных работ, оказанных услуг)</th>
              <th colspan="2">Единица измерения</th><th rowspan="2">Количество</th><th rowspan="2">Цена</th>
              <th rowspan="2">Стоимость без налога</th><th rowspan="2">В том числе акциз</th><th rowspan="2">Налоговая ставка</th>
              <th rowspan="2">Сумма налога</th><th rowspan="2">Стоимость с налогом</th><th colspan="2">Страна происхождения товара</th>
              <th rowspan="2">Рег. номер декларации</th>
            </tr>
            <tr><th>код</th><th>условное обозначение</th><th>код</th><th>краткое наименование</th></tr>
          </thead>
          <tbody>
            ${work.items
              .map(
                (item, index) => `<tr><td class="center">${index + 1}</td><td>${html(item.name)}</td><td class="center">796</td><td class="center">шт</td><td class="right">${quantityText(item.quantity)}</td><td class="right">${formatMoney(item.price)}</td><td class="right">${formatMoney(item.amount)}</td><td class="center">без акциза</td><td class="center">без НДС</td><td class="right">0,00</td><td class="right">${formatMoney(item.amount)}</td><td></td><td></td><td></td></tr>`
              )
              .join('')}
            <tr class="totals"><td colspan="6" class="right">Всего к оплате</td><td class="right">${formatMoney(total)}</td><td></td><td></td><td class="right">0,00</td><td class="right">${formatMoney(total)}</td><td colspan="3"></td></tr>
          </tbody>
        </table>
        <section class="upd-transfer">
          <div class="upd-line"><b>Документ об отгрузке, передаче</b><span class="upd-value">УПД № ${html(invoiceNumber)} от ${displayDate(work.invoiceDate)}</span><span>(9)</span></div>
          <div class="upd-line"><b>Иные сведения об отгрузке, передаче</b><span class="upd-value">Услуги оказаны в полном объеме</span><span>(13)</span></div>
          <div class="upd-line"><b>Ответственный за правильность оформления факта хозяйственной жизни</b><span class="upd-value">${html(signerName(organization))}</span><span>(15)</span></div>
        </section>
        <section class="signatures">
          <div class="sign-box"><b>Индивидуальный предприниматель или иное уполномоченное лицо</b><div class="sign-line">${html(signerName(organization))}</div></div>
          <div class="sign-box"><b>Ответственный за правильность оформления со стороны покупателя</b><div class="sign-line">${html(signerName(client))}</div></div>
        </section>
      </main>`,
      'landscape'
    );
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
    const printWindow = window.open('', '_blank');
    if (!printWindow) throw new Error('Браузер заблокировал окно печати');
    printWindow.document.open();
    printWindow.document.write(htmlDocument);
    printWindow.document.close();
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

  const renderWorks = () => {
    const query = normalizeText(state.query).toLowerCase();
    const works = sortedWorks().filter((work) => {
      if (!query) return true;
      return [workTitle(work), clientName(work.clientId), organizationName(work.executorOrganizationId), work.actNumber, work.invoiceNumber]
        .join(' ')
        .toLowerCase()
        .includes(query);
    });
    app.innerHTML = shell(`
      <section class="panel stack">
        <div class="row between">
          <div>
            <h2>Работы</h2>
            <p class="muted">Текущие работы загружены из серверного бэкапа. Новые изменения хранятся в браузере.</p>
          </div>
          <button data-action="new-work">Новая работа</button>
        </div>
        <div class="row">
          <input style="max-width:520px" data-input="work-search" placeholder="Поиск по работам, клиентам, номерам" value="${html(state.query)}" />
          <button class="secondary" data-action="reset-search">Сброс</button>
        </div>
      </section>
      ${renderWorkForm()}
      <section class="panel">
        <div class="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Дата</th><th>Позиции</th><th>Организация</th><th>Клиент</th><th>Документы</th>
                <th>Источник</th><th>Сумма</th><th>Зачислено</th><th>Оплачено</th><th>Действия</th>
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
                  <td>${formatMoney(work.amount)} ${html(work.currency || 'RUB')}</td>
                  <td>${formatMoney(work.creditedAmount)} ${html(work.currency || 'RUB')}</td>
                  <td><label class="switch"><input type="checkbox" data-action="toggle-paid" data-id="${html(work._id)}" ${work.isPayed ? 'checked' : ''}/> ${work.isPayed ? 'Да' : 'Нет'}</label></td>
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
        ${works.length ? '' : '<p class="muted">Работы не найдены.</p>'}
      </section>
    `);
  };

  const emptyWork = () => ({
    _id: '',
    items: [{ name: '', quantity: 1, price: 0 }],
    creditedAmount: 0,
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
            <label>Сумма зачисления<input name="creditedAmount" type="number" min="0" step="0.01" value="${html(work.creditedAmount || work.amount || 0)}" /></label>
            <label>Оплата<span class="switch"><input name="isPayed" type="checkbox" ${work.isPayed ? 'checked' : ''}/> Оплачено</span></label>
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
    const payload = normalizeWork({
      _id: existingId || uid(),
      items,
      amount,
      creditedAmount: form.creditedAmount.value === '' ? amount : toNumber(form.creditedAmount.value, amount),
      isPayed: form.isPayed.checked,
      currency: 'RUB',
      source: form.source.value,
      sourceName: form.source.value === 'kwork' ? 'Kwork' : 'Счет/акт',
      platformCommission: form.source.value === 'kwork' ? Math.max(0, amount - toNumber(form.creditedAmount.value, amount)) : 0,
      payoutCommission: 0,
      executorOrganizationId: form.executorOrganizationId.value,
      clientId: form.clientId.value,
      actNumber: normalizeText(form.actNumber.value) || nextNumber(year, 'act'),
      invoiceNumber: normalizeText(form.invoiceNumber.value) || nextNumber(year, 'invoice'),
      actDate: documentDate.toISOString(),
      invoiceDate: documentDate.toISOString()
    });
    const index = state.db.works.findIndex((work) => work._id === payload._id);
    if (index >= 0) state.db.works[index] = payload;
    else state.db.works.push(payload);
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
            <thead><tr><th>Название</th><th>Физлицо</th><th>ИНН</th><th>Договор</th><th>Действия</th></tr></thead>
            <tbody>
              ${state.db.clients
                .map(
                  (client) => `
                <tr>
                  <td>${html(client.name)}</td>
                  <td>${client.isPhysicalPerson ? 'Да' : 'Нет'}</td>
                  <td>${html(client.inn || '—')}</td>
                  <td>${html(client.contract || '—')}</td>
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
        ? { _id: '', name: '', isPhysicalPerson: false, inn: '', kpp: '', address: '', contract: '', signerName: '' }
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

  const aggregateReport = () => {
    const months = new Map();
    const summary = { totalWorks: 0, paidWorksCount: 0, totalAmount: 0, totalCreditedAmount: 0, totalCommission: 0 };
    for (const work of state.db.works) {
      if (state.paidOnly && !work.isPayed) continue;
      const date = workDate(work);
      const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
      const rowKey = `${monthKey}|${work.source}|${work.clientId}`;
      if (!months.has(monthKey)) {
        months.set(monthKey, {
          monthKey,
          label: monthLabel.format(new Date(Date.UTC(date.getFullYear(), date.getMonth(), 1))).replace(/\s?г\.$/, ''),
          totalWorks: 0,
          paidWorksCount: 0,
          totalAmount: 0,
          totalCreditedAmount: 0,
          totalCommission: 0,
          rows: new Map()
        });
      }
      const month = months.get(monthKey);
      if (!month.rows.has(rowKey)) {
        month.rows.set(rowKey, {
          source: work.source,
          clientName: clientName(work.clientId),
          worksCount: 0,
          paidWorksCount: 0,
          totalAmount: 0,
          totalCreditedAmount: 0,
          totalCommission: 0
        });
      }
      const row = month.rows.get(rowKey);
      const count = work.items.length || 1;
      const commission = (work.platformCommission || 0) + (work.payoutCommission || 0);
      row.worksCount += count;
      row.paidWorksCount += work.isPayed ? count : 0;
      row.totalAmount += work.amount;
      row.totalCreditedAmount += work.creditedAmount;
      row.totalCommission += commission;
      month.totalWorks += count;
      month.paidWorksCount += work.isPayed ? count : 0;
      month.totalAmount += work.amount;
      month.totalCreditedAmount += work.creditedAmount;
      month.totalCommission += commission;
      summary.totalWorks += count;
      summary.paidWorksCount += work.isPayed ? count : 0;
      summary.totalAmount += work.amount;
      summary.totalCreditedAmount += work.creditedAmount;
      summary.totalCommission += commission;
    }
    return {
      summary,
      months: [...months.values()]
        .sort((left, right) => right.monthKey.localeCompare(left.monthKey))
        .map((month) => ({ ...month, rows: [...month.rows.values()].sort((a, b) => b.totalAmount - a.totalAmount) }))
    };
  };

  const renderReport = () => {
    const report = aggregateReport();
    app.innerHTML = shell(`
      <section class="panel stack">
        <div class="row between">
          <div>
            <h2>Отчет</h2>
            <p class="muted">Книга доходов по работам в локальной базе браузера.</p>
          </div>
          <label class="switch"><input type="checkbox" data-action="toggle-report-paid" ${state.paidOnly ? 'checked' : ''}/> Только оплаченные</label>
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

  const backupPayload = () => ({
    meta: {
      createdAt: new Date().toISOString(),
      database: 'offers-base-static',
      collections: ['clients', 'files', 'organizations', 'sequences', 'users', 'works', 'uploads.chunks', 'uploads.files']
    },
    collections: {
      clients: state.db.clients,
      files: state.db.files || [],
      organizations: state.db.organizations,
      sequences: [],
      users: state.db.users || [],
      works: state.db.works,
      'uploads.chunks': state.db.uploadsChunks || [],
      'uploads.files': state.db.uploadsFiles || []
    }
  });

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
    const payload = JSON.parse(text);
    const collections = payload.collections || {};
    state.db = dbFromCollections(collections, { restoredAt: new Date().toISOString() });
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
    for (const row of rows) {
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
      const year = row.date.getFullYear();
      state.db.works.push(
        normalizeWork({
          _id: uid(),
          items: [{ name: row.description, quantity: 1, price: row.grossAmount }],
          creditedAmount: row.netAmount,
          isPayed: true,
          currency: 'RUB',
          executorOrganizationId: organization._id,
          clientId: client._id,
          actNumber: nextNumber(year, 'act'),
          invoiceNumber: nextNumber(year, 'invoice'),
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
    else if (state.view === 'backup') renderBackup();
    else renderWorks();
  };

  document.addEventListener('submit', async (event) => {
    const form = event.target.closest('form');
    if (!form) return;
    event.preventDefault();
    clearMessage();
    try {
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
    if (target.dataset.input === 'work-search') {
      state.query = target.value;
      renderWorks();
    }
    if (target.name === 'itemQuantity' || target.name === 'itemPrice') {
      const row = target.closest('[data-item-row]');
      if (row) updateWorkItemAmount(row);
    }
  });

  document.addEventListener('click', async (event) => {
    const target = event.target.closest('[data-action], [data-view]');
    if (!target) return;
    clearMessage();
    const action = target.dataset.action;
    try {
      if (target.dataset.view) {
        state.view = target.dataset.view;
        state.editingWorkId = null;
        state.editingClientId = null;
        render();
        return;
      }
      if (action === 'logout') {
        setLoggedIn(false);
        render();
      }
      if (action === 'new-work') {
        state.editingWorkId = '';
        renderWorks();
      }
      if (action === 'edit-work') {
        state.editingWorkId = target.dataset.id;
        renderWorks();
      }
      if (action === 'cancel-work') {
        state.editingWorkId = null;
        renderWorks();
      }
      if (action === 'delete-work') {
        if (confirm('Удалить работу?')) {
          state.db.works = state.db.works.filter((work) => work._id !== target.dataset.id);
          saveDb();
          renderWorks();
        }
      }
      if (action === 'toggle-paid') {
        const work = state.db.works.find((item) => item._id === target.dataset.id);
        if (work) {
          work.isPayed = target.checked;
          saveDb();
          renderWorks();
        }
      }
      if (action === 'reset-search') {
        state.query = '';
        renderWorks();
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
      }
      if (action === 'remove-item') {
        target.closest('[data-item-row]').remove();
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
        const used = state.db.works.some((work) => work.clientId === target.dataset.id);
        if (used) throw new Error('Нельзя удалить клиента, который используется в работах');
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
          saveDb();
          showMessage('Данные сброшены к стартовым');
        }
      }
    } catch (error) {
      showMessage(error.message || 'Ошибка', 'error');
    }
  });

  if (isLoggedIn()) {
    state.db = loadStoredDb();
    if (!state.db) setLoggedIn(false);
  }
  render();
})();
