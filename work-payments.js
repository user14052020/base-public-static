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
    const local = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(text);
    if (!iso && !local) return null;
    const day = iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : `${local[3]}-${local[2]}-${local[1]}`;
    const parsed = new Date(`${day}T00:00:00.000Z`);
    return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === day ? day : null;
  };
  const paymentDetails = (work) => {
    const amount = paymentAmount(work.paymentAmount);
    return {
      paymentAmount: amount,
      paymentDate: paymentDate(work.paymentDate),
      isPayed: amount === null ? Boolean(work.isPayed) : amount >= Math.round((work.amount || 0) * 100) / 100 && (amount > 0 || work.amount === 0)
    };
  };
  return { paymentAmount, paymentDate, paymentDetails };
});
