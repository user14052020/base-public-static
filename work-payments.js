(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OffersWorkPayments = factory();
})(globalThis, () => {
  const paymentAmount = (value) => {
    if (value == null || String(value).trim() === '') return null;
    const amount = Number(String(value).replace(',', '.'));
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
  };
  const paymentDate = (value) => {
    if (value && typeof value === 'object' && value.$date) value = value.$date;
    if (!value) return null;
    const text = String(value);
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text);
    const local = /^(\d{2})\.(\d{2})\.(\d{4})(?:$|\s)/.exec(text);
    if (!iso && !local) return null;
    const day = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : `${local[3]}-${local[2]}-${local[1]}`;
    const parsed = new Date(`${day}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
  };
  const paymentTime = (value) => {
    if (value && typeof value === 'object' && value.$date) value = value.$date;
    const match = /(?:T|\s)(\d{2}):(\d{2})(?::(\d{2})(\.\d{1,3})?)?/.exec(String(value || ''));
    if (!match || Number(match[1]) > 23 || Number(match[2]) > 59 || Number(match[3] || 0) > 59) return null;
    return `${match[1]}:${match[2]}${match[3] ? `:${match[3]}${match[4] || ''}` : ''}`;
  };
  const paymentDateTime = (value) => {
    if (value && typeof value === 'object' && value.$date) value = value.$date;
    if (!/^(?:\d{4}-\d{2}-\d{2}|\d{2}\.\d{2}\.\d{4})(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/.test(String(value || '').trim())) return null;
    const date = paymentDate(value);
    if (!date) return null;
    const hasTime = /(?:T|\s)\d{2}:/.test(String(value));
    const time = paymentTime(value);
    if (hasTime && !time) return null;
    const zone = time ? /(Z|[+-]\d{2}:\d{2})$/.exec(String(value))?.[1] || '' : '';
    return time ? `${date}T${time}${zone}` : date;
  };
  const combinePaymentDateTime = (date, time, original) => {
    if (!date) return null;
    const next = paymentDateTime(`${date}${time ? `T${time}` : ''}`);
    const previous = paymentDateTime(original);
    const comparableTime = (value) => value && value.length === 5 ? `${value}:00` : value;
    return previous && paymentDate(previous) === date && comparableTime(paymentTime(previous)) === comparableTime(time || null)
      ? previous : next;
  };
  const isFullyPaid = (work, amount) => amount >= Math.round((work.amount || 0) * 100) / 100 && (amount > 0 || work.amount === 0);
  const paymentDetails = (work) => {
    const legacyAmount = paymentAmount(work.paymentAmount);
    return {
      creditedAmount: legacyAmount ?? paymentAmount(work.creditedAmount) ?? work.amount ?? 0,
      paymentDate: paymentDateTime(work.paymentDate),
      isPayed: legacyAmount === null ? Boolean(work.isPayed) : isFullyPaid(work, legacyAmount)
    };
  };
  const normalizePaymentFields = (work) => {
    const { paymentAmount: removed, ...rest } = work;
    return { ...rest, ...paymentDetails(work) };
  };
  return { paymentAmount, paymentDate, paymentTime, paymentDateTime, combinePaymentDateTime, paymentDetails, normalizePaymentFields, isFullyPaid };
});
