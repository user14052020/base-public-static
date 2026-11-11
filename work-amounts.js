(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OffersWorkAmounts = factory();
})(globalThis, () => {
  const normalizeUpdAmount = (value) => {
    if (value == null || (typeof value !== 'number' && typeof value !== 'string')) return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const amount = Number(String(value).replace(',', '.'));
    return Number.isFinite(amount) && amount >= 0 ? Math.round(amount * 100) / 100 : null;
  };

  const getUpdAmount = (work) => normalizeUpdAmount(work.updAmount) ?? normalizeUpdAmount(work.amount) ?? 0;

  const getUpdItems = (work) => {
    const items = work.items || [];
    const total = items.reduce((sum, item) => sum + item.amount, 0);
    const target = getUpdAmount(work);
    if (!items.length || target === total) return items;

    const targetCents = Math.round(target * 100);
    const weightTotal = total || items.length;
    let cumulativeWeight = 0;
    let allocatedCents = 0;

    // Cumulative rounding keeps the line amounts equal to the document total.
    return items.map((item) => {
      cumulativeWeight += total ? item.amount : 1;
      const nextCents = Math.round((cumulativeWeight / weightTotal) * targetCents);
      const amount = (nextCents - allocatedCents) / 100;
      allocatedCents = nextCents;
      return { ...item, price: item.quantity > 0 ? amount / item.quantity : 0, amount };
    });
  };

  return { normalizeUpdAmount, getUpdAmount, getUpdItems };
});
