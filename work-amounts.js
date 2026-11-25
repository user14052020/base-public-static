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

  const getOrderAmount = (work) => normalizeUpdAmount(work.orderAmount) ?? normalizeUpdAmount(work.amount) ?? 0;
  const getInvoiceItems = (work) => (work.items || []).map((item) => ({ ...item, amount: Number(item.quantity || 0) * Number(item.price || 0) }));
  const getInvoiceAmount = (work) => normalizeUpdAmount(getInvoiceItems(work).reduce((sum, item) => sum + item.amount, 0)) ?? 0;
  const getUpdAmount = (work) => normalizeUpdAmount(work.updAmount) ?? getOrderAmount(work);

  const allocateItems = (work, target) => {
    const items = work.items || [];
    const total = items.reduce((sum, item) => sum + item.amount, 0);
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

  const getUpdItems = (work) => allocateItems(work, getUpdAmount(work));
  const migrateInvoiceAmount = (work) => {
    const { invoiceAmount, ...rest } = work;
    const items = getInvoiceItems(work);
    const total = getInvoiceAmount(work);
    const previous = normalizeUpdAmount(invoiceAmount);
    if (previous === null || previous === total) return { ...rest, items, amount: total };
    const migrated = allocateItems({ items }, previous);
    if (!migrated.length || migrated.some((item) => item.amount > 0 && !(item.quantity > 0))) throw new Error('Проверьте позиции старого счета: сумма не соответствует количеству');
    // Retire the old override once, preserving the amount of an already issued invoice.
    return { ...rest, items: migrated, amount: previous, orderAmount: getOrderAmount(work) };
  };
  const getOrderItems = (work) => allocateItems(work, getOrderAmount(work));
  return { normalizeUpdAmount, getOrderAmount, getInvoiceAmount, getUpdAmount, getUpdItems, getInvoiceItems, getOrderItems, migrateInvoiceAmount };
});
