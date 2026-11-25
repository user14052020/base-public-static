const { test } = require('node:test');
const assert = require('node:assert/strict');
const { apply } = require('../data-revisions.js');
const ledger = require('../payment-ledger.js');
const revisions = [{ id: 'fix-receipts', updates: [
  { collection: 'works', id: 'one', expected: [{ creditedAmount: 48000 }], fields: { creditedAmount: 24000 } },
  { collection: 'works', id: 'two', expected: [{ creditedAmount: 24000 }], fields: { creditedAmount: 48000 } }
] }];

test('published corrections are conditional, atomic, idempotent and preserve unrelated requisites', () => {
  const payload = { collections: { works: [{ _id: { $oid: 'one' }, creditedAmount: 48000, custom: 'keep' }, { _id: 'two', creditedAmount: 24000 }] } };
  const original = structuredClone(payload);
  const corrected = apply(payload, revisions);
  assert.equal(corrected.collections.works[0].creditedAmount, 24000);
  assert.equal(corrected.collections.works[0].custom, 'keep');
  assert.deepEqual(apply(corrected, revisions), corrected);
  assert.deepEqual(payload, original);
  const changed = structuredClone(payload); changed.collections.works[1].creditedAmount = 123;
  const conflict = apply(changed, revisions);
  assert.deepEqual(conflict.collections, changed.collections);
  assert.deepEqual(conflict.meta.dataRevisionConflicts, ['fix-receipts']);
});

test('a canonical roundtrip recognizes an already-correct legacy projection without replacing its journal', () => {
  const c = ledger.normalize({ works: [{ _id: 'one', source: 'document', clientId: 'client', executorOrganizationId: 'org', amount: 100,
    creditedAmount: 100, paymentDate: '2026-11-25', bankPayments: [{ bankPaymentId: 'bank', date: '2026-11-25', amount: 100, originalAmount: 100 }] }] });
  const revision = { id: 'roundtrip', updates: [{ collection: 'works', id: 'one', expected: [], fields: { creditedAmount: 100,
    bankPayments: [{ bankPaymentId: 'bank', date: '2026-11-25', amount: 100, originalAmount: 100 }] } }] };
  const result = apply({ collections: c }, [revision]);
  assert.deepEqual(result.meta.appliedDataRevisions, ['roundtrip']);
  assert.deepEqual(result.collections, c);
  const edited = structuredClone(c); edited.payments[0].date = '2026-11-24';
  const conflict = apply({ collections: edited }, [revision]);
  assert.deepEqual(conflict.meta.dataRevisionConflicts, ['roundtrip']);
  assert.deepEqual(conflict.collections, edited);
});
