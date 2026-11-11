(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./xlsx.full.min.js'), require('./work-payments.js'));
  else root.OffersBankReconciliation = factory(root.XLSX, root.OffersWorkPayments);
})(globalThis, (XLSX, paymentHelpers) => {
  const { paymentAmount, paymentDate, paymentDateTime, normalizePaymentFields, isFullyPaid } = paymentHelpers;
  const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const lower = (value) => text(value).toLowerCase().replaceAll('\u0451', '\u0435');
  const id = (value) => typeof value === 'string' ? value : value?.$oid || id(value?._id || '');
  const cents = (value) => Math.round(Number(value || 0) * 100);
  const normalizedNumber = (value) => text(value).replace(/^0+(?=\d)/, '').toUpperCase();
  const entries = (work) => Array.isArray(work.bankPayments) ? work.bankPayments : [];
  const dateValue = (value, numberFormat = '', date1904 = false) => {
    if (typeof value !== 'number') return paymentDateTime(value);
    const d = XLSX.SSF.parse_date_code(value, { date1904 });
    if (!d) return null;
    const pad = (number) => String(number).padStart(2, '0');
    const date = `${d.y}-${pad(d.m)}-${pad(d.d)}`;
    const hasTime = Math.abs(value % 1) > 0.000000001 || /[hs]/i.test(numberFormat.replace(/"[^"]*"|\[[^\]]*\]/g, ''));
    return paymentDateTime(hasTime ? `${date}T${pad(d.H)}:${pad(d.M)}:${pad(Math.floor(d.S))}` : date);
  };
  const parseWorkbook = (workbook, collections, organizationId) => {
    const organization = (collections.organizations || []).find((item) => id(item._id) === organizationId);
    if (!organization) throw new Error('Выберите организацию');
    const result = [];
    let supported = false;
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
      const headerIndex = rows.findIndex((row) => ['дата', 'сумма', 'назначение'].every((name) => row.some((cell) => lower(cell) === name)));
      if (headerIndex < 0) continue;
      const headers = rows[headerIndex].map(lower);
      const index = (name) => headers.indexOf(lower(name));
      const isEvents = index('Контрагент') >= 0;
      if (!isEvents && index('Плательщик') < 0) continue;
      supported = true;
      for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex++) {
        const values = rows[rowIndex];
        if (values.every((value) => text(value) === '')) continue;
        const get = (name) => values[index(name)];
        const numeric = typeof get('Сумма') === 'number' ? get('Сумма') : Number(text(get('Сумма')).replace(/\s/g, '').replace(',', '.'));
        const amount = Number.isFinite(numeric) ? Math.round(numeric * 100) / 100 : null;
        const dateCell = sheet[XLSX.utils.encode_cell({ r: rowIndex, c: index('Дата') })];
        const date = dateValue(get('Дата'), dateCell?.z, Boolean(workbook.Workbook?.WBProps?.date1904));
        const payer = text(get(isEvents ? 'Контрагент' : 'Плательщик'));
        const payerInn = text(get(isEvents ? 'ИНН' : 'ИНН/КИО Плательщика'));
        const purpose = text(get('Назначение'));
        const documentNumber = text(get(isEvents ? 'Наименование' : 'Номер'));
        let blockedReason = '';
        if (!date || amount == null) blockedReason = 'Неверная дата или сумма';
        else if (!['исполнен', 'исполнено', 'проведен', 'зачислен', 'выполнен', 'completed'].includes(lower(get('Статус')))) blockedReason = 'Платеж не исполнен';
        else if (amount <= 0) blockedReason = 'Исходящий платеж';
        else if (!isEvents && text(get('ИНН Получателя')) !== text(organization.inn) && text(get('Получатель Счет')) !== text(organization.bankAccount)) blockedReason = 'Платеж не в выбранную организацию';
        else if (payerInn === text(organization.inn) || /перевод собственных средств/i.test(purpose)) blockedReason = 'Перевод собственных средств';
        result.push({ date, amount: amount ?? 0, documentNumber, payer, payerInn, purpose, organizationId, sheetName,
          rowNumber: rowIndex + 1, blockedReason,
          fingerprint: JSON.stringify([text(organization.inn) || text(organization.bankAccount) || organizationId,
            paymentDate(date), amount, normalizedNumber(documentNumber), payerInn || lower(payer), lower(purpose)]) });
      }
    }
    if (!supported) throw new Error('Не найдена банковская выгрузка с колонками Дата, Сумма, Назначение.');
    return result;
  };
  const invoiceReferences = (purpose) => {
    const pattern = /сч[её]т(?:у|а|ом|е)?\s*(?:на\s*оплату\s*)?(?:№|n(?:o)?\.?|#)?\s*([0-9]+(?:[/-][0-9a-zа-я]+)?)(?:\s*от\s*(\d{2})[.\s](\d{2})[.\s]+(\d{4}))?/giu;
    return Array.from(purpose.matchAll(pattern), (match) => ({ number: normalizedNumber(match[1]), date: match[2] ? paymentDate(`${match[4]}-${match[3]}-${match[2]}`) : null }));
  };
  const getInvoices = (collections, organizationId) => {
    const clients = new Map((collections.clients || []).map((client) => [id(client._id), client]));
    return (collections.works || []).filter((work) => work.source !== 'kwork' && text(work.invoiceNumber) && id(work.executorOrganizationId) === organizationId)
      .map((work) => {
        const client = clients.get(id(work.clientId)) || {};
        const date = paymentDate(work.invoiceDate) || paymentDate(work.actDate);
        return { id: id(work._id), number: text(work.invoiceNumber), date, amount: Number(work.amount || 0),
          paidAmount: work.paymentAmount != null ? paymentAmount(work.paymentAmount) : entries(work).length || work.paymentDate ? paymentAmount(work.creditedAmount) : null,
          client: text(client.name), clientInn: text(client.inn), ledgerAmount: entries(work).reduce((sum, entry) => sum + cents(entry.amount), 0) / 100,
          label: `№ ${work.invoiceNumber} от ${date || '—'} · ${client.name || '—'} · ${Number(work.amount || 0).toLocaleString('ru-RU')} ₽` };
      });
  };
  const preview = ({ collections, payments, organizationId }) => {
    const invoices = getInvoices(collections, organizationId);
    const allocated = new Map();
    for (const work of collections.works) for (const entry of entries(work)) if (entry.bankPaymentId) {
      allocated.set(entry.bankPaymentId, (allocated.get(entry.bankPaymentId) || 0) + cents(entry.amount));
    }
    const seen = new Set();
    const rows = payments.map((payment) => {
      let reason = payment.blockedReason;
      const remaining = cents(payment.amount) - (allocated.get(payment.paymentId) || 0);
      if (!reason && seen.has(payment.paymentId)) reason = 'Повтор строки в файле';
      seen.add(payment.paymentId);
      if (!reason && remaining <= 0) reason = 'Уже учтен';
      if (reason) return { ...payment, include: false, canSelect: false, reason, allocationAmount: 0, workId: '' };
      const references = invoiceReferences(payment.purpose);
      const candidates = invoices.filter((invoice) => invoice.date && (payment.payerInn && invoice.clientInn
        ? payment.payerInn === invoice.clientInn : lower(invoice.client) === lower(payment.payer)));
      const matches = references.length ? candidates.filter((invoice) => references.some((reference) => normalizedNumber(invoice.number) === reference.number
        && (reference.date ? invoice.date === reference.date : invoice.date.slice(0, 4) === payment.date.slice(0, 4))))
        : candidates.filter((invoice) => invoice.date <= payment.date && cents(invoice.amount) - cents(invoice.paidAmount ?? invoice.ledgerAmount) === remaining);
      const numberMatches = references.length ? candidates.filter((invoice) => references.some((reference) => normalizedNumber(invoice.number) === reference.number
        && invoice.date.slice(0, 4) === (reference.date || payment.date).slice(0, 4))) : [];
      const match = matches.length === 1 ? matches[0] : numberMatches.length === 1 ? numberMatches[0] : null;
      const manualOverride = match && match.paidAmount !== null && cents(match.paidAmount) !== cents(match.ledgerAmount);
      const warning = references.length > 1 ? 'Несколько счетов в назначении' : match && matches.length !== 1 ? 'Дата счета отличается от назначения'
        : match && match.date > payment.date ? 'Дата платежа раньше счета' : manualOverride ? 'Проверить ручную сумму оплаты' : '';
      return { ...payment, allocationAmount: remaining / 100, workId: match?.id || '', include: Boolean(match && !warning), canSelect: true,
        reason: warning || (match ? (references.length ? 'Номер счета и контрагент' : 'Контрагент и сумма') : matches.length > 1 ? 'Несколько подходящих счетов' : 'Счет не найден') };
    });
    return { organizationId, invoices, rows, totalRows: rows.length, incomingRows: rows.filter((row) => row.canSelect).length, matchedRows: rows.filter((row) => row.include).length };
  };
  const apply = ({ payload, preview: result, allocations }) => {
    const available = new Map(result.rows.filter((row) => row.canSelect).map((row) => [row.paymentId, row]));
    const invoices = new Map(result.invoices.map((invoice) => [invoice.id, invoice]));
    const selected = new Map();
    for (const allocation of allocations || []) {
      const row = available.get(allocation.paymentId);
      const invoice = invoices.get(allocation.workId);
      const amount = paymentAmount(allocation.amount);
      if (!row || !invoice || amount == null || amount <= 0) throw new Error('Неверное сопоставление платежа со счетом.');
      if (row.payerInn && invoice.clientInn && row.payerInn !== invoice.clientInn) throw new Error(`ИНН плательщика не совпадает с клиентом счета ${invoice.number}.`);
      const group = selected.get(row.paymentId) || { row, totalCents: 0, allocations: new Map() };
      group.totalCents += cents(amount);
      group.allocations.set(invoice.id, (group.allocations.get(invoice.id) || 0) + cents(amount));
      if (group.totalCents > cents(row.allocationAmount)) throw new Error('Распределенная сумма превышает доступную сумму платежа.');
      selected.set(row.paymentId, group);
    }
    if (!selected.size) throw new Error('Выберите хотя бы один платеж и счет.');
    const updated = structuredClone(payload);
    updated.collections.works = updated.collections.works.map(normalizePaymentFields);
    const works = new Map(updated.collections.works.map((work) => [id(work._id), work]));
    const changed = new Set();
    for (const { row, allocations: shares } of selected.values()) for (const [workId, amountCents] of shares) {
      const work = works.get(workId);
      if (!work) throw new Error('Список работ изменился. Повторите сопоставление.');
      work.bankPayments = entries(work);
      let entry = work.bankPayments.find((item) => item.bankPaymentId === row.paymentId);
      if (!entry) {
        entry = { bankPaymentId: row.paymentId, date: row.date, amount: 0, documentNumber: row.documentNumber, payer: row.payer, payerInn: row.payerInn, purpose: row.purpose };
        work.bankPayments.push(entry);
      }
      entry.amount = (cents(entry.amount) + amountCents) / 100;
      changed.add(workId);
    }
    for (const workId of changed) {
      const work = works.get(workId);
      work.creditedAmount = work.bankPayments.reduce((sum, entry) => sum + cents(entry.amount), 0) / 100;
      work.paymentDate = work.bankPayments.map((entry) => paymentDateTime(entry.date)).filter(Boolean).sort().at(-1) || null;
      work.isPayed = isFullyPaid(work, work.creditedAmount);
    }
    updated.meta = { ...updated.meta, createdAt: new Date().toISOString(), paymentsUpdatedAt: new Date().toISOString() };
    return { payload: updated, updatedWorks: changed.size, appliedPayments: selected.size };
  };
  return { id, parseWorkbook, getInvoices, invoiceReferences, preview, apply };
});
