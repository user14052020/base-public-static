(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./payment-ledger.js'), require('./work-payments.js'));
  else root.OffersIncomeReport = factory(root.OffersPaymentLedger, root.OffersWorkPayments);
})(globalThis, (ledger, dates) => {
  const aggregate = (source, paidOnly = true) => {
    const collections = ledger.normalize(source);
    const clients = new Map((collections.clients || []).map((client) => [ledger.id(client._id), client.name]));
    const moneyKeys = ['totalAmount', 'totalCreditedAmount', 'totalCommission'];
    const empty = () => ({ totalWorks: 0, paidWorksCount: 0, totalAmount: 0, totalCreditedAmount: 0, totalCommission: 0 });
    const summary = empty(); const months = new Map();
    const group = (date, sourceName, clientId) => {
      const day = dates.paymentDate(date); const monthKey = day?.slice(0, 7) || 'unknown';
      if (!months.has(monthKey)) months.set(monthKey, { ...empty(), monthKey,
        label: day ? new Intl.DateTimeFormat('ru-RU', { month: 'long', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${monthKey}-01T00:00:00Z`)).replace(/\s?г\.$/, '') : 'Без даты платежа', rows: new Map() });
      const month = months.get(monthKey); const rowKey = `${sourceName}|${clientId}`;
      if (!month.rows.has(rowKey)) month.rows.set(rowKey, { source: sourceName, clientName: clients.get(clientId) || '—', worksCount: 0, paidWorksCount: 0, totalAmount: 0, totalCreditedAmount: 0, totalCommission: 0 });
      return { month, row: month.rows.get(rowKey) };
    };
    const addMoney = (target, key, value) => { target[key] = ledger.sum([target[key], ledger.cents(value)]); };
    for (const work of collections.works) {
      if (paidOnly && !work.isPayed) continue;
      const { month, row } = group(work.actDate || work.invoiceDate, work.source || 'document', ledger.id(work.clientId));
      const count = work.items?.length || 1;
      row.worksCount += count; month.totalWorks += count; summary.totalWorks += count;
      if (work.isPayed) { row.paidWorksCount += count; month.paidWorksCount += count; summary.paidWorksCount += count; }
      if (work.source === 'kwork') for (const target of [row, month, summary]) {
        addMoney(target, 'totalAmount', work.amount || 0); addMoney(target, 'totalCreditedAmount', work.creditedAmount || 0);
        addMoney(target, 'totalCommission', (work.platformCommission || 0) + (work.payoutCommission || 0));
      }
    }
    for (const payment of collections.payments.filter(ledger.active)) {
      const { month, row } = group(payment.date, 'document', payment.clientId);
      for (const target of [row, month, summary]) { addMoney(target, 'totalAmount', payment.amount); addMoney(target, 'totalCreditedAmount', payment.amount); }
    }
    const convert = (record) => ({ ...record, ...Object.fromEntries(moneyKeys.map((key) => [key, record[key] / 100])) });
    return { summary: convert(summary), months: [...months.values()].sort((a, b) => b.monthKey.localeCompare(a.monthKey)).map((month) => ({ ...convert(month), rows: [...month.rows.values()].map(convert).sort((a, b) => b.totalAmount - a.totalAmount) })) };
  };
  return { aggregate };
});
