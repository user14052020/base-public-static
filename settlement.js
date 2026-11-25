(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./work-amounts.js'), require('./work-payments.js'), require('./payment-ledger.js'));
  else root.OffersSettlement = factory(root.OffersWorkAmounts, root.OffersWorkPayments, root.OffersPaymentLedger);
})(globalThis, (amounts, dates, ledger) => {
  const validatePeriod = (dateFrom, dateTo) => {
    if (!dateFrom || !dateTo || dates.paymentDate(dateFrom) !== dateFrom || dates.paymentDate(dateTo) !== dateTo) throw new Error('Укажите начало и окончание периода');
    if (dateFrom > dateTo) throw new Error('Начало периода не может быть позже окончания');
  };
  const buildStatement = ({ works, payments, paymentAllocations, organizationId, clientId, dateFrom, dateTo, openingBalance = null, currency = 'RUB' }) => {
    validatePeriod(dateFrom, dateTo);
    if (!organizationId || !clientId) throw new Error('Выберите организацию и клиента');
    const collections = ledger.normalize({ works, ...(Array.isArray(payments) ? { payments } : {}), ...(Array.isArray(paymentAllocations) ? { paymentAllocations } : {}) });
    const operations = []; const warnings = []; let excludedKwork = 0;
    const selected = collections.works.filter((work) => ledger.id(work.executorOrganizationId) === organizationId && ledger.id(work.clientId) === clientId);
    for (const work of selected) {
      if (work.source === 'kwork') { excludedKwork++; continue; }
      const workId = ledger.id(work._id); const number = String(work.invoiceNumber || work.actNumber || '');
      if ((work.currency || 'RUB') !== currency) { warnings.push({ workId, code: 'CURRENCY', message: `УПД ${number}: другая валюта` }); continue; }
      const date = dates.paymentDate(work.invoiceDate) || dates.paymentDate(work.actDate);
      if (!date) { warnings.push({ workId, code: 'DOCUMENT_DATE', message: `УПД ${number}: не указана дата документа` }); continue; }
      const debit = ledger.cents(amounts.getUpdAmount(work));
      if (date <= dateTo && debit) operations.push({ key: `upd:${workId}`, type: 'upd', date, number, debit, credit: 0, workIds: [workId] });
    }
    for (const payment of collections.payments.filter((item) => item.organizationId === organizationId && item.clientId === clientId)) {
      const paymentId = ledger.id(payment._id);
      const workIds = collections.paymentAllocations.filter((entry) => entry.paymentId === paymentId).map((entry) => entry.workId);
      if (!ledger.active(payment)) {
        warnings.push({ paymentId, workId: workIds[0] || '', code: 'PAYMENT_REVIEW', message: `Платеж ${payment.documentNumber || ''}: возможен повтор или не подтверждены старые сведения об оплате` }); continue;
      }
      if (payment.currency !== currency) { warnings.push({ paymentId, code: 'CURRENCY', message: `Платеж ${payment.documentNumber || ''}: другая валюта` }); continue; }
      const date = dates.paymentDateTime(payment.date);
      if (!date) { warnings.push({ paymentId, workId: workIds[0] || '', code: 'PAYMENT_DATE', message: `Платеж ${payment.documentNumber || ''}: не указана дата` }); continue; }
      if (dates.paymentDate(date) <= dateTo) operations.push({ key: `payment:${paymentId}`, type: 'payment', date, number: payment.documentNumber || '', debit: 0, credit: ledger.cents(payment.amount), workIds });
    }
    operations.sort((a, b) => a.date.localeCompare(b.date) || a.type.localeCompare(b.type) || a.key.localeCompare(b.key));
    let automaticOpening = 0;
    for (const operation of operations) if (dates.paymentDate(operation.date) < dateFrom) automaticOpening = ledger.sum([automaticOpening, operation.debit, -operation.credit]);
    let opening = automaticOpening;
    if (openingBalance !== null) {
      if (!Number.isFinite(Number(openingBalance))) throw new Error('Некорректное начальное сальдо');
      opening = Math.sign(Number(openingBalance)) * ledger.cents(Math.abs(Number(openingBalance)));
    }
    let balance = opening; let debit = 0; let credit = 0;
    const rows = operations.filter((operation) => dates.paymentDate(operation.date) >= dateFrom && dates.paymentDate(operation.date) <= dateTo).map((operation) => {
      debit = ledger.sum([debit, operation.debit]); credit = ledger.sum([credit, operation.credit]);
      balance = ledger.sum([balance, operation.debit, -operation.credit]);
      return { ...operation, debit: operation.debit / 100, credit: operation.credit / 100, balance: balance / 100 };
    });
    return { organizationId, clientId, dateFrom, dateTo, currency, rows, warnings, excludedKwork,
      automaticOpening: automaticOpening / 100, openingBalance: opening / 100, totalUpd: debit / 100, totalPaid: credit / 100,
      closingBalance: balance / 100, manualOpening: openingBalance !== null };
  };
  return { buildStatement, validatePeriod };
});
