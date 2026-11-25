(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./work-amounts.js'), require('./work-payments.js'));
  else root.OffersPaymentLedger = factory(root.OffersWorkAmounts, root.OffersWorkPayments);
})(globalThis, (amounts, dates) => {
  const id = (value) => typeof value === 'string' ? value : value?.$oid || id(value?._id || '');
  const cents = (value) => {
    const number = dates.paymentAmount(value);
    if (number === null || !Number.isSafeInteger(Math.round(number * 100))) throw new Error('Некорректная сумма платежа');
    return Math.round(number * 100);
  };
  const sum = (values) => {
    const total = values.reduce((result, value) => result + value, 0);
    if (!Number.isSafeInteger(total)) throw new Error('Сумма платежей слишком велика');
    return total;
  };
  const active = (payment) => !['possible-duplicate', 'legacy-uncertain'].includes(payment.reviewStatus) && !payment.migrationError;
  const allocationId = (paymentId, workId) => JSON.stringify([paymentId, workId]);
  const migrateLegacy = (collections) => {
    const payments = new Map();
    const allocations = new Map();
    const works = (collections.works || []).map((original) => {
      const work = dates.normalizePaymentFields(original);
      if (work.source === 'kwork') return work;
      const workId = id(work._id);
      const entries = Array.isArray(work.bankPayments) ? work.bankPayments : [];
      for (const [index, entry] of entries.entries()) {
        const paymentId = String(entry.paymentId || entry.bankPaymentId || `legacy:${workId}:${index}`);
        const amount = cents(entry.amount);
        if (!amount) continue;
        const existing = payments.get(paymentId);
        const knownTotal = dates.paymentAmount(entry.originalAmount);
        if (!existing) payments.set(paymentId, { ...entry, _id: paymentId, organizationId: id(work.executorOrganizationId), clientId: id(work.clientId),
          source: entry.source || (entry.bankPaymentId ? 'bank' : 'manual'), amount: knownTotal ?? 0, amountKnown: knownTotal !== null,
          date: dates.paymentDateTime(entry.date), currency: work.currency || 'RUB', migrated: true });
        else if (existing.clientId !== id(work.clientId) || existing.organizationId !== id(work.executorOrganizationId)) throw new Error('Один платеж связан с разными клиентами или организациями');
        const payment = payments.get(paymentId);
        if (!payment.amountKnown) payment.amount = (cents(payment.amount) + amount) / 100;
        const key = allocationId(paymentId, workId);
        const previous = allocations.get(key);
        allocations.set(key, { _id: key, paymentId, workId, amount: (cents(previous?.amount || 0) + amount) / 100, kind: entry.kind || 'payment' });
      }
      if (!entries.length && cents(work.creditedAmount ?? 0) && (work.paymentDate || work.isPayed || Number(work.creditedAmount) < amounts.getOrderAmount(work))) {
        const paymentId = `legacy:${workId}`;
        payments.set(paymentId, { _id: paymentId, source: 'manual', organizationId: id(work.executorOrganizationId), clientId: id(work.clientId),
          date: dates.paymentDateTime(work.paymentDate), amount: cents(work.creditedAmount) / 100, amountKnown: true,
          currency: work.currency || 'RUB', documentNumber: '', purpose: '', migrated: true,
          reviewStatus: !work.paymentDate && !work.isPayed ? 'legacy-uncertain' : '' });
        const key = allocationId(paymentId, workId);
        allocations.set(key, { _id: key, paymentId, workId, amount: cents(work.creditedAmount) / 100, kind: 'payment' });
      } else if (entries.length) {
        const total = sum(entries.map((entry) => cents(entry.amount))) / 100;
        const lastDate = entries.map((entry) => dates.paymentDateTime(entry.date)).filter(Boolean).sort().at(-1) || null;
        if (total !== Number(work.creditedAmount || 0) || dates.paymentDateTime(work.paymentDate) !== lastDate) {
          work.legacyPaymentReview = { amount: work.creditedAmount, date: work.paymentDate, reason: 'Ручные сведения об оплате отличаются от банковской истории' };
          if (cents(work.creditedAmount || 0)) {
            const paymentId = `legacy:${workId}:review`;
            payments.set(paymentId, { _id: paymentId, source: 'manual', organizationId: id(work.executorOrganizationId), clientId: id(work.clientId),
              date: dates.paymentDateTime(work.paymentDate), amount: cents(work.creditedAmount) / 100, amountKnown: true, currency: work.currency || 'RUB',
              reviewStatus: 'legacy-uncertain', migrated: true, purpose: work.legacyPaymentReview.reason });
            const key = allocationId(paymentId, workId);
            allocations.set(key, { _id: key, paymentId, workId, amount: cents(work.creditedAmount) / 100, kind: 'payment' });
          }
        }
      }
      return work;
    });
    for (const payment of payments.values()) if (payment.source === 'manual' && payment.date) {
      const candidates = [...payments.values()].filter((other) => other.source === 'bank' && other.clientId === payment.clientId
        && other.organizationId === payment.organizationId && other.currency === payment.currency && cents(other.amount) === cents(payment.amount)
        && dates.paymentDate(other.date) === dates.paymentDate(payment.date));
      if (candidates.length === 1) { payment.reviewStatus = 'possible-duplicate'; payment.duplicateOf = id(candidates[0]._id); }
    }
    return { ...collections, works, payments: [...payments.values()], paymentAllocations: [...allocations.values()] };
  };
  const normalize = (source) => {
    for (const key of ['payments', 'paymentAllocations']) if (source[key] !== undefined && !Array.isArray(source[key])) throw new Error('Некорректный формат журнала платежей');
    const hasPayments = Array.isArray(source.payments);
    const hasAllocations = Array.isArray(source.paymentAllocations);
    if (hasPayments !== hasAllocations) throw new Error('В бекапе отсутствует часть журнала платежей');
    const collections = hasPayments ? source : migrateLegacy(source);
    const payments = (collections.payments || []).map((payment) => ({ ...payment, _id: id(payment._id), organizationId: id(payment.organizationId),
      clientId: id(payment.clientId), date: dates.paymentDateTime(payment.date), amount: cents(payment.amount) / 100, currency: payment.currency || 'RUB' }));
    const paymentMap = new Map(payments.map((payment) => [payment._id, payment]));
    if (paymentMap.size !== payments.length || payments.some((payment) => !payment._id || payment.amount <= 0)) throw new Error('Повтор или некорректный платеж в журнале');
    const bankIds = new Set();
    for (const payment of payments) if (payment.bankPaymentId) {
      const key = JSON.stringify([payment.organizationId, payment.bankPaymentId]);
      if (bankIds.has(key)) throw new Error('Банковская операция повторяется в журнале платежей');
      bankIds.add(key);
    }
    const workMap = new Map((collections.works || []).map((work) => [id(work._id), work]));
    const used = new Map();
    const pairs = new Set();
    const allocations = (collections.paymentAllocations || []).map((entry) => {
      const paymentId = id(entry.paymentId); const workId = id(entry.workId);
      const payment = paymentMap.get(paymentId); const work = workMap.get(workId);
      const amount = cents(entry.amount);
      if (!payment || !work || work.source === 'kwork' || !amount) throw new Error('Некорректная привязка платежа к работе');
      if (id(work.clientId) !== payment.clientId || id(work.executorOrganizationId) !== payment.organizationId || (work.currency || 'RUB') !== payment.currency) throw new Error('Клиент, организация или валюта платежа не совпадают с работой');
      const key = allocationId(paymentId, workId);
      if (pairs.has(key)) throw new Error('Один платеж повторно привязан к той же работе');
      pairs.add(key);
      used.set(paymentId, sum([used.get(paymentId) || 0, amount]));
      return { ...entry, _id: key, paymentId, workId, amount: amount / 100, kind: entry.kind === 'advance' ? 'advance' : 'payment' };
    });
    for (const [paymentId, amount] of used) if (amount > cents(paymentMap.get(paymentId).amount)) throw new Error('Сумма распределений превышает сумму платежа');
    const byWork = new Map();
    for (const entry of allocations) if (active(paymentMap.get(entry.paymentId))) {
      const list = byWork.get(entry.workId) || []; list.push(entry); byWork.set(entry.workId, list);
    }
    const works = (collections.works || []).map((work) => {
      if (work.source === 'kwork') return { ...work, isPayed: true };
      const { bankPayments: removed, ...rest } = work;
      const entries = byWork.get(id(work._id)) || [];
      const creditedAmount = sum(entries.map((entry) => cents(entry.amount))) / 100;
      const paymentDate = entries.map((entry) => paymentMap.get(entry.paymentId).date).filter(Boolean).sort().at(-1) || null;
      return { ...rest, creditedAmount, paymentDate, isPayed: dates.isFullyPaid({ amount: amounts.getOrderAmount(work) }, creditedAmount) };
    });
    return { ...collections, works, payments, paymentAllocations: allocations };
  };
  const availableAmount = (collections, paymentId, exceptWorkId = '') => {
    const payment = collections.payments.find((entry) => id(entry._id) === paymentId);
    if (!payment) return 0;
    return (cents(payment.amount) - sum(collections.paymentAllocations.filter((entry) => id(entry.paymentId) === paymentId && id(entry.workId) !== exceptWorkId).map((entry) => cents(entry.amount)))) / 100;
  };
  const workPayments = (collections, workId) => {
    const payments = new Map(collections.payments.map((entry) => [id(entry._id), entry]));
    return collections.paymentAllocations.filter((entry) => id(entry.workId) === workId).map((entry) => ({ ...entry, payment: payments.get(id(entry.paymentId)) }));
  };
  const setWorkAllocations = (source, workId, entries) => {
    const collections = normalize(Array.isArray(source.paymentAllocations)
      ? { ...source, paymentAllocations: source.paymentAllocations.filter((entry) => id(entry.workId) !== workId) } : source);
    const allocations = collections.paymentAllocations.filter((entry) => entry.workId !== workId);
    for (const entry of entries) allocations.push({ ...entry, workId, paymentId: id(entry.paymentId), amount: cents(entry.amount) / 100 });
    const works = collections.works.map((work) => id(work._id) === workId ? { ...work, legacyPaymentReview: null } : work);
    return normalize({ ...collections, works, paymentAllocations: allocations });
  };
  const savePayment = (source, payment, entries) => {
    const collections = normalize(source);
    if (!dates.paymentDateTime(payment.date)) throw new Error('Укажите дату платежа, при наличии с временем');
    if (!id(payment._id) || !id(payment.clientId) || !id(payment.organizationId) || cents(payment.amount) <= 0) throw new Error('Укажите клиента, организацию и положительную сумму платежа');
    const paymentId = id(payment._id);
    const previous = collections.payments.find((entry) => entry._id === paymentId);
    if (previous?.source === 'bank' && previous.amountKnown && cents(previous.amount) !== cents(payment.amount)) throw new Error('Сумму банковского платежа менять нельзя. Измените распределение.');
    const record = { ...previous, ...payment, _id: paymentId, amountKnown: true, reviewStatus: '', date: dates.paymentDateTime(payment.date) };
    const allocations = collections.paymentAllocations.filter((entry) => entry.paymentId !== paymentId);
    for (const entry of entries) allocations.push({ ...entry, paymentId, workId: id(entry.workId), amount: cents(entry.amount) / 100 });
    const works = collections.works.map((work) => entries.some((entry) => id(entry.workId) === id(work._id)) ? { ...work, legacyPaymentReview: null } : work);
    return normalize({ ...collections, works, payments: [...collections.payments.filter((entry) => entry._id !== paymentId), record], paymentAllocations: allocations });
  };
  const deletePayment = (source, paymentId) => {
    const collections = normalize(source);
    return normalize({ ...collections, payments: collections.payments.filter((entry) => entry._id !== paymentId), paymentAllocations: collections.paymentAllocations.filter((entry) => entry.paymentId !== paymentId) });
  };
  const removeWork = (source, workId) => {
    const collections = normalize(source);
    return normalize({ ...collections, works: collections.works.filter((work) => id(work._id) !== workId), paymentAllocations: collections.paymentAllocations.filter((entry) => entry.workId !== workId) });
  };
  const exportCompatible = (source) => {
    const collections = normalize(source);
    const works = collections.works.map((work) => work.source === 'kwork' ? work : { ...work, bankPayments: workPayments(collections, id(work._id)).map((entry) => {
      const payment = entry.payment;
      return { paymentId: id(payment._id), bankPaymentId: payment.bankPaymentId, source: payment.source, date: payment.date, amount: entry.amount,
        originalAmount: payment.amount, documentNumber: payment.documentNumber || '', payer: payment.payer || '', payerInn: payment.payerInn || '',
        purpose: payment.purpose || '', kind: entry.kind, ...(payment.reviewStatus ? { reviewStatus: payment.reviewStatus, duplicateOf: payment.duplicateOf } : {}) };
    }) });
    return { ...collections, works };
  };
  return { id, cents, sum, active, normalize, availableAmount, workPayments, setWorkAllocations, savePayment, deletePayment, removeWork, exportCompatible };
});
