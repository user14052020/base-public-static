(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./work-amounts.js'), require('./work-payments.js'));
  else root.OffersSettlement = factory(root.OffersWorkAmounts, root.OffersWorkPayments);
})(globalThis, (amounts, payments) => {
  const id = (value) => typeof value === 'string' ? value : value?.$oid || id(value?._id || '');
  const cents = (value) => {
    const number = payments.paymentAmount(value);
    if (number === null || !Number.isSafeInteger(Math.round(number * 100))) throw new Error('Некорректная сумма операции');
    return Math.round(number * 100);
  };
  const add = (...values) => {
    const total = values.reduce((sum, value) => sum + value, 0);
    if (!Number.isSafeInteger(total)) throw new Error('Сумма расчетов слишком велика');
    return total;
  };
  const validatePeriod = (dateFrom, dateTo) => {
    if (!dateFrom || !dateTo || payments.paymentDate(dateFrom) !== dateFrom || payments.paymentDate(dateTo) !== dateTo) throw new Error('Укажите начало и окончание периода');
    if (dateFrom > dateTo) throw new Error('Начало периода не может быть позже окончания');
  };
  const buildStatement = ({ works, organizationId, clientId, dateFrom, dateTo, openingBalance = null, currency = 'RUB' }) => {
    validatePeriod(dateFrom, dateTo);
    if (!organizationId || !clientId) throw new Error('Выберите организацию и клиента');
    const operations = [];
    const warnings = [];
    const bankOperations = new Map();
    let excludedKwork = 0;
    const warn = (work, code, message) => warnings.push({ workId: id(work._id), code, message });
    const selected = works.filter((work) => id(work.executorOrganizationId) === organizationId && id(work.clientId) === clientId);
    for (const work of selected) {
      if (work.source === 'kwork') { excludedKwork++; continue; }
      if ((work.currency || 'RUB').toUpperCase() !== currency) {
        warn(work, 'CURRENCY', `Работа ${work.invoiceNumber || ''}: валюта отличается от ${currency}`);
        continue;
      }
      const workId = id(work._id);
      const documentDate = payments.paymentDate(work.invoiceDate) || payments.paymentDate(work.actDate);
      const documentNumber = String(work.invoiceNumber || work.actNumber || '').trim();
      if (!documentDate) warn(work, 'DOCUMENT_DATE', `УПД ${documentNumber}: не указана дата документа`);
      else if (documentDate <= dateTo) {
        const amount = cents(amounts.getUpdAmount(work));
        if (amount) operations.push({ key: `upd:${workId}`, type: 'upd', date: documentDate, number: documentNumber, debit: amount, credit: 0, workIds: [workId] });
      }
      const ledger = Array.isArray(work.bankPayments) ? work.bankPayments : [];
      const credited = cents(work.creditedAmount ?? 0);
      if (!ledger.length) {
        const date = payments.paymentDateTime(work.paymentDate);
        if (date && credited) operations.push({ key: `manual:${workId}`, type: 'payment', date, number: '', debit: 0, credit: credited, workIds: [workId] });
        else if (!date && credited && (work.isPayed || credited < Number(work.amount || 0) * 100) && (!documentDate || documentDate <= dateTo)) {
          warn(work, 'PAYMENT_DATE', `Счет ${documentNumber}: у оплаты не указана дата`);
        }
        continue;
      }
      let ledgerTotal = 0;
      const seen = new Set();
      for (const [index, entry] of ledger.entries()) {
        const amount = cents(entry.amount);
        ledgerTotal = add(ledgerTotal, amount);
        if (!amount) continue;
        const date = payments.paymentDateTime(entry.date);
        if (!date) { warn(work, 'PAYMENT_DATE', `Счет ${documentNumber}: у банковского платежа не указана дата`); continue; }
        if (payments.paymentDate(date) > dateTo) continue;
        const key = entry.bankPaymentId ? `bank:${entry.bankPaymentId}` : `bank:${workId}:${index}`;
        if (seen.has(key)) { warn(work, 'DUPLICATE_PAYMENT', `Счет ${documentNumber}: повтор банковского платежа`); continue; }
        seen.add(key);
        const number = String(entry.documentNumber || '').trim();
        const existing = bankOperations.get(key);
        if (existing && (existing.date !== date || existing.number !== number)) {
          warn(work, 'PAYMENT_CONFLICT', `Счет ${documentNumber}: реквизиты частей одного платежа различаются`);
          continue;
        }
        if (existing) { existing.credit = add(existing.credit, amount); existing.workIds.push(workId); }
        else bankOperations.set(key, { key, type: 'payment', date, number, debit: 0, credit: amount, workIds: [workId] });
      }
      if (ledgerTotal !== credited && (!documentDate || documentDate <= dateTo)) warn(work, 'PAYMENT_TOTAL', `Счет ${documentNumber}: сумма платежа не совпадает с банковскими операциями`);
    }
    operations.push(...bankOperations.values());
    operations.sort((left, right) => left.date.localeCompare(right.date) || left.type.localeCompare(right.type) || left.key.localeCompare(right.key));
    let automaticOpening = 0;
    for (const operation of operations) if (payments.paymentDate(operation.date) < dateFrom) automaticOpening = add(automaticOpening, operation.debit, -operation.credit);
    let opening = automaticOpening;
    if (openingBalance !== null) {
      if (!Number.isFinite(Number(openingBalance))) throw new Error('Некорректное начальное сальдо');
      opening = Math.sign(Number(openingBalance)) * cents(Math.abs(Number(openingBalance)));
    }
    let balance = opening;
    let debit = 0;
    let credit = 0;
    const rows = operations.filter((operation) => {
      const date = payments.paymentDate(operation.date);
      return date >= dateFrom && date <= dateTo;
    }).map((operation) => {
      debit = add(debit, operation.debit); credit = add(credit, operation.credit);
      balance = add(balance, operation.debit, -operation.credit);
      return { ...operation, debit: operation.debit / 100, credit: operation.credit / 100, balance: balance / 100 };
    });
    return { organizationId, clientId, dateFrom, dateTo, currency, rows, warnings, excludedKwork,
      automaticOpening: automaticOpening / 100, openingBalance: opening / 100, totalUpd: debit / 100,
      totalPaid: credit / 100, closingBalance: balance / 100, manualOpening: openingBalance !== null };
  };
  return { buildStatement, validatePeriod };
});
