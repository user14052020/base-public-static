(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./payment-ledger.js'));
  else root.OffersDataRevisions = factory(root.OffersPaymentLedger);
})(globalThis, (ledger) => {
  const id = (value) => typeof value === 'string' ? value : value?.$oid || '';
  const canonical = (value) => {
    if (value === undefined) return null;
    if (Array.isArray(value)) return value.map(canonical);
    if (!value || typeof value !== 'object') return value;
    if (Object.keys(value).length === 1 && (value.$date || value.$oid)) return value.$date || value.$oid;
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
  };
  const contains = (actual, expected) => {
    if (Array.isArray(expected)) return Array.isArray(actual) && actual.length === expected.length && expected.every((value, index) => contains(actual[index], value));
    if (expected && typeof expected === 'object') return actual && typeof actual === 'object' && Object.entries(expected).every(([key, value]) => contains(actual[key], value));
    return actual === expected;
  };
  const matches = (record, fields) => Object.entries(fields).every(([key, value]) => contains(canonical(record[key]), canonical(value)));
  const apply = (payload, revisions = []) => {
    let collections = payload.collections;
    const applied = new Set(payload.meta?.appliedDataRevisions || []);
    const conflicts = [];
    for (const revision of revisions) {
      if (applied.has(revision.id)) continue;
      const updates = revision.updates || [];
      if (!updates.length || updates.some((update) => !['works', 'payments', 'paymentAllocations'].includes(update.collection))) throw new Error('Некорректное исправление данных');
      if (Array.isArray(collections.payments) && updates.every((update) => update.collection === 'works')) {
        const compatible = ledger.exportCompatible(collections);
        if (updates.every((update) => matches(compatible.works.find((record) => id(record._id) === update.id) || {}, update.fields))) applied.add(revision.id);
        else conflicts.push(revision.id);
        continue;
      }
      const records = updates.map((update) => collections[update.collection]?.find((record) => id(record._id) === update.id));
      if (records.some((record, index) => !record || !(matches(record, updates[index].fields) || (updates[index].expected || []).some((fields) => matches(record, fields))))) {
        conflicts.push(revision.id); continue;
      }
      const next = { ...collections };
      for (const update of updates) next[update.collection] = next[update.collection].map((record) => id(record._id) === update.id ? { ...record, ...structuredClone(update.fields) } : record);
      collections = next;
      applied.add(revision.id);
    }
    return { ...payload, collections, meta: { ...payload.meta, dataRevisions: revisions, appliedDataRevisions: [...applied], dataRevisionConflicts: conflicts } };
  };
  return { apply };
});
