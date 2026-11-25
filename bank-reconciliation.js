(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./xlsx.full.min.js'), require('./work-payments.js'), require('./payment-ledger.js'), require('./work-amounts.js'));
  else root.OffersBankReconciliation = factory(root.XLSX, root.OffersWorkPayments, root.OffersPaymentLedger, root.OffersWorkAmounts);
})(globalThis, (XLSX, paymentHelpers, ledger, amounts) => {
  const { paymentAmount, paymentDate, paymentDateTime } = paymentHelpers;
  const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
  const lower = (value) => text(value).toLowerCase().replaceAll('\u0451', '\u0435');
  const id = (value) => typeof value === 'string' ? value : value?.$oid || id(value?._id || '');
  const cents = (value) => Math.round(Number(value || 0) * 100);
  const normalizedNumber = (value) => text(value).replace(/^0+(?=\d)/, '').toUpperCase();
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
    collections = ledger.normalize(collections);
    const clients = new Map((collections.clients || []).map((client) => [id(client._id), client]));
    return (collections.works || []).filter((work) => work.source !== 'kwork' && text(work.invoiceNumber) && id(work.executorOrganizationId) === organizationId)
      .map((work) => {
        const client = clients.get(id(work.clientId)) || {};
        const date = paymentDate(work.invoiceDate) || paymentDate(work.actDate);
        return { id: id(work._id), clientId: id(work.clientId), number: text(work.invoiceNumber), date, amount: amounts.getOrderAmount(work), invoiceAmount: amounts.getInvoiceAmount(work),
          paidAmount: work.creditedAmount, client: text(client.name), clientInn: text(client.inn), ledgerAmount: work.creditedAmount,
          requiresReview: Boolean(work.legacyPaymentReview) || ledger.workPayments(collections, id(work._id)).some((entry) => !ledger.active(entry.payment)),
          label: `№ ${work.invoiceNumber} от ${date || '—'} · ${client.name || '—'} · остаток ${Math.max(0, amounts.getOrderAmount(work) - work.creditedAmount).toLocaleString('ru-RU')} ₽` };
      });
  };
  const uniqueSplit = (candidates, target) => {
    const states = new Map([[0, { count: 1, indexes: [] }]]);
    for (const [index, candidate] of candidates.entries()) {
      const value = candidate.remaining;
      if (value <= 0 || value > target) continue;
      for (const [previous, state] of [...states]) {
        const next = previous + value;
        if (next > target) continue;
        const existing = states.get(next);
        states.set(next, { count: Math.min(2, (existing?.count || 0) + state.count), indexes: existing ? existing.indexes : [...state.indexes, index] });
      }
      if (states.size > 100000) return null;
    }
    const result = states.get(target);
    return result?.count === 1 ? result.indexes.map((index) => ({ workId: candidates[index].id, amount: candidates[index].remaining / 100 })) : null;
  };
  const preview = ({ collections, payments, organizationId }) => {
    collections = ledger.normalize(collections);
    const invoices = getInvoices(collections, organizationId);
    const allocated = new Map();
    for (const entry of collections.paymentAllocations) allocated.set(entry.paymentId, (allocated.get(entry.paymentId) || 0) + cents(entry.amount));
    const planned = new Map();
    const seen = new Set();
    const rows = payments.map((payment, sourceIndex) => ({ ...payment, sourceIndex })).sort((a, b) => (a.date || '').localeCompare(b.date || '') || a.sourceIndex - b.sourceIndex).map((payment) => {
      let reason = payment.blockedReason;
      const remaining = cents(payment.amount) - (allocated.get(payment.paymentId) || 0);
      if (!reason && seen.has(payment.paymentId)) reason = 'Повтор строки в файле';
      seen.add(payment.paymentId);
      if (!reason && remaining <= 0) reason = 'Уже учтен';
      if (reason) return { ...payment, include: false, canSelect: false, reason, allocationAmount: 0, workId: '' };
      const references = invoiceReferences(payment.purpose);
      const clients = (collections.clients || []).filter((client) => payment.payerInn && text(client.inn)
        ? payment.payerInn === text(client.inn) : lower(client.name) === lower(payment.payer));
      const clientId = clients.length === 1 ? id(clients[0]._id) : '';
      const candidates = invoices.filter((invoice) => invoice.date && (payment.payerInn && invoice.clientInn
        ? payment.payerInn === invoice.clientInn : lower(invoice.client) === lower(payment.payer)))
        .map((invoice) => ({ ...invoice, remaining: cents(invoice.amount) - cents(invoice.paidAmount || 0) - (planned.get(invoice.id) || 0) }));
      const matches = references.length ? candidates.filter((invoice) => references.some((reference) => normalizedNumber(invoice.number) === reference.number
        && (reference.date ? invoice.date === reference.date : invoice.date.slice(0, 4) === payment.date.slice(0, 4))))
        : candidates.filter((invoice) => invoice.date <= payment.date && invoice.remaining === remaining);
      const numberMatches = references.length ? candidates.filter((invoice) => references.some((reference) => normalizedNumber(invoice.number) === reference.number
        && invoice.date.slice(0, 4) === (reference.date || payment.date).slice(0, 4))) : [];
      const match = matches.length === 1 ? matches[0] : numberMatches.length === 1 ? numberMatches[0] : null;
      const manualOverride = match?.requiresReview || !references.length && candidates.some((invoice) => invoice.requiresReview && invoice.date <= payment.date);
      const referenced = references.length > 1 && references.every((reference) => matches.filter((invoice) => normalizedNumber(invoice.number) === reference.number
        && (reference.date ? invoice.date === reference.date : invoice.date.slice(0, 4) === payment.date.slice(0, 4))).length === 1)
        && matches.every((invoice) => !invoice.requiresReview && invoice.date <= payment.date && invoice.remaining > 0)
        && matches.reduce((sum, invoice) => sum + invoice.remaining, 0) === remaining;
      const warning = references.length > 1 && !referenced ? 'Несколько счетов в назначении' : match && matches.length !== 1 ? 'Дата счета отличается от назначения'
        : match && match.date > payment.date ? 'Дата платежа раньше счета' : manualOverride ? 'Проверить ручную сумму оплаты' : '';
      let shares = match && !warning && remaining <= match.remaining ? [{ workId: match.id, amount: remaining / 100 }] : null;
      if (referenced) shares = matches.map((invoice) => ({ workId: invoice.id, amount: invoice.remaining / 100 }));
      if (!warning && !references.length) shares = uniqueSplit(candidates.filter((invoice) => invoice.date <= payment.date && !invoice.requiresReview), remaining);
      if (shares) for (const share of shares) planned.set(share.workId, (planned.get(share.workId) || 0) + cents(share.amount));
      return { ...payment, clientId, allocationAmount: shares?.length || match ? remaining / 100 : 0, workId: shares?.[0]?.workId || match?.id || '', allocations: shares || [], availableAmount: remaining / 100,
        include: Boolean(shares?.length), canSelect: true,
        reason: warning || (shares?.length > 1 ? 'Однозначное распределение между работами' : shares?.length ? (references.length ? 'Номер счета и контрагент' : 'Контрагент и остаток') : match ? 'Сумма требует распределения' : 'Счет не найден') };
    }).sort((a, b) => a.sourceIndex - b.sourceIndex);
    return { organizationId, invoices, clients: collections.clients || [], rows, totalRows: rows.length, incomingRows: payments.filter((row) => !row.blockedReason).length,
      availableRows: rows.filter((row) => row.canSelect).length, matchedRows: rows.filter((row) => row.include).length };
  };
  const apply = ({ payload, preview: result, allocations }) => {
    const collections = ledger.normalize(payload.collections);
    const available = new Map(result.rows.filter((row) => row.canSelect).map((row) => [row.paymentId, row]));
    const invoices = new Map(result.invoices.map((invoice) => [invoice.id, invoice]));
    const selected = new Map();
    for (const allocation of allocations || []) {
      const row = available.get(allocation.paymentId);
      const invoice = invoices.get(allocation.workId);
      const amount = paymentAmount(allocation.amount);
      const clientId = invoice?.clientId || allocation.clientId || row?.clientId;
      const client = collections.clients?.find((client) => id(client._id) === clientId);
      if (!row || !client || amount == null || (invoice ? amount <= 0 : allocation.workId || amount !== 0)) throw new Error('Выберите счет или клиента для нераспределенного аванса.');
      if (row.payerInn && client.inn && row.payerInn !== text(client.inn)) throw new Error('ИНН плательщика не совпадает с выбранным клиентом.');
      const group = selected.get(row.paymentId) || { row, clientId, totalCents: 0, allocations: new Map() };
      if (group.clientId !== clientId) throw new Error('Один платеж нельзя распределить между разными клиентами');
      group.totalCents += cents(amount);
      if (invoice) group.allocations.set(invoice.id, (group.allocations.get(invoice.id) || 0) + cents(amount));
      if (group.totalCents > cents(row.availableAmount ?? row.allocationAmount)) throw new Error('Распределенная сумма превышает доступную сумму платежа.');
      selected.set(row.paymentId, group);
    }
    if (!selected.size) throw new Error('Выберите хотя бы один платеж и счет.');
    const changed = new Set();
    let updatedCollections = collections;
    for (const { row, clientId, allocations: shares } of selected.values()) {
      const previous = updatedCollections.payments.find((payment) => id(payment._id) === row.paymentId);
      const combined = new Map(updatedCollections.paymentAllocations.filter((entry) => entry.paymentId === row.paymentId).map((entry) => [entry.workId, { ...entry }]));
      for (const [workId, amountCents] of shares) {
        const old = combined.get(workId);
        combined.set(workId, { workId, amount: (cents(old?.amount || 0) + amountCents) / 100, kind: old?.kind || 'payment' }); changed.add(workId);
      }
      updatedCollections = ledger.savePayment(updatedCollections, { ...previous, _id: row.paymentId, bankPaymentId: row.paymentId, source: 'bank',
        organizationId: result.organizationId, clientId, amount: row.amount, date: row.date, documentNumber: row.documentNumber,
        payer: row.payer, payerInn: row.payerInn, purpose: row.purpose, currency: previous?.currency || 'RUB' }, [...combined.values()]);
    }
    const updated = { ...payload, collections: updatedCollections };
    updated.meta = { ...updated.meta, createdAt: new Date().toISOString(), paymentsUpdatedAt: new Date().toISOString() };
    return { payload: updated, updatedWorks: changed.size, appliedPayments: selected.size };
  };
  return { id, parseWorkbook, getInvoices, invoiceReferences, preview, apply, uniqueSplit };
});
