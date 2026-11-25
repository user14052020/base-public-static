const { test } = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../payment-ledger.js');
const bank = require('../bank-reconciliation.js');
const { buildStatement } = require('../settlement.js');
const { aggregate } = require('../income-report.js');
const amounts = require('../work-amounts.js');

const base = () => ({ organizations: [{ _id: 'org', name: 'Seller' }], clients: [{ _id: 'client', name: 'Buyer', inn: '1234567890' }],
  works: [{ _id: 'one-c', source: 'document', clientId: 'client', executorOrganizationId: 'org', amount: 24000, orderAmount: 24000, invoiceAmount: 24000, updAmount: 24000, invoiceNumber: '46', invoiceDate: '2026-09-07', items: [{ name: '1C', quantity: 1, price: 24000, amount: 24000 }] },
    { _id: 'crm', source: 'document', clientId: 'client', executorOrganizationId: 'org', amount: 24000, orderAmount: 48000, invoiceAmount: 24000, updAmount: 48000, invoiceNumber: '47', invoiceDate: '2026-09-07', items: [{ name: 'CRM', quantity: 1, price: 24000, amount: 24000 }] }],
  payments: [{ _id: 'advance', source: 'manual', clientId: 'client', organizationId: 'org', date: '2026-08-31', amount: 24000, currency: 'RUB' }],
  paymentAllocations: [{ paymentId: 'advance', workId: 'crm', amount: 24000, kind: 'advance' }] });
const receipt = (overrides = {}) => ({ paymentId: 'bank-166', amount: 48000, organizationId: 'org', date: '2026-09-08', payer: 'Buyer', payerInn: '1234567890', purpose: 'Оплата по договору №5, за CRM и доработку 1С', documentNumber: '166', blockedReason: '', ...overrides });

test('one bank receipt automatically splits between uniquely determined work balances', () => {
  const source = base(); const original = structuredClone(source);
  const preview = bank.preview({ collections: source, payments: [receipt()], organizationId: 'org' });
  assert.equal(preview.rows[0].include, true);
  assert.deepEqual(preview.rows[0].allocations.map((entry) => entry.amount), [24000, 24000]);
  const result = bank.apply({ payload: { collections: source }, preview, allocations: preview.rows[0].allocations.map((entry) => ({ ...entry, paymentId: 'bank-166' })) });
  const c = result.payload.collections;
  assert.equal(c.payments.length, 2);
  assert.equal(c.paymentAllocations.length, 3);
  assert.equal(c.payments.find((entry) => entry._id === 'bank-166').amount, 48000);
  assert.equal(c.works.find((entry) => entry._id === 'crm').creditedAmount, 48000);
  assert.equal(c.works.find((entry) => entry._id === 'one-c').creditedAmount, 24000);
  assert.ok(c.works.every((work) => work.isPayed));
  const statement = buildStatement({ ...c, organizationId: 'org', clientId: 'client', dateFrom: '2026-01-01', dateTo: '2026-12-31' });
  assert.equal(statement.totalUpd, 72000);
  assert.equal(statement.totalPaid, 72000);
  assert.equal(statement.closingBalance, 0);
  assert.equal(statement.rows.filter((row) => row.date === '2026-09-08' && row.type === 'payment').length, 1);
  assert.equal(bank.preview({ collections: c, payments: [receipt()], organizationId: 'org' }).rows[0].reason, 'Уже учтен');
  assert.deepEqual(source, original);
});

test('ambiguous combinations require review even if one work alone matches the entire amount', () => {
  const candidates = [{ id: 'one', remaining: 2400000 }, { id: 'two', remaining: 2400000 }, { id: 'three', remaining: 4800000 }];
  assert.equal(bank.uniqueSplit(candidates, 4800000), null);
  assert.equal(bank.uniqueSplit([{ id: 'one', remaining: 2400000 }, { id: 'two', remaining: 2400000 }], 4800000).length, 2);
});

test('changing work amounts or cached payment fields cannot create new receipts', () => {
  const c = ledger.normalize(base());
  c.works[1].creditedAmount = 999999; c.works[1].paymentDate = '2026-09-08'; c.works[1].invoiceAmount = 1;
  const updated = ledger.normalize(c);
  assert.equal(updated.payments.length, 1);
  assert.equal(updated.works[1].creditedAmount, 24000);
  assert.equal(updated.works[1].paymentDate, '2026-08-31');
  assert.equal(updated.works[1].isPayed, false);
  assert.ok(!('bankPayments' in updated.works[1]));
});

test('a client advance can exist without any invoice or work allocation and is counted once in income', () => {
  const c = ledger.savePayment(base(), { _id: 'unassigned-advance', source: 'manual', clientId: 'client', organizationId: 'org', date: '2026-08-01T14:22:13', amount: 1000 }, []);
  assert.equal(ledger.availableAmount(c, 'unassigned-advance'), 1000);
  const r = aggregate(c);
  assert.equal(r.summary.totalAmount, 25000);
  assert.equal(r.summary.totalCreditedAmount, 25000);
  assert.equal(r.months.find((month) => month.monthKey === '2026-08').totalAmount, 25000);
});

test('allocation updates are atomic and never exceed a receipt or cross client boundaries', () => {
  const c = base(); const original = structuredClone(c);
  assert.throws(() => ledger.setWorkAllocations(c, 'one-c', [{ paymentId: 'advance', amount: 24000 }]), /превышает/);
  c.works[0].clientId = 'another';
  assert.throws(() => ledger.setWorkAllocations(c, 'one-c', [{ paymentId: 'advance', amount: 1 }]), /не совпадают/);
  assert.deepEqual(c.payments, original.payments);
  assert.deepEqual(c.paymentAllocations, original.paymentAllocations);
});

test('deleting a work releases allocations but never deletes the actual payment', () => {
  const c = ledger.removeWork(base(), 'crm');
  assert.equal(c.payments.length, 1);
  assert.equal(c.paymentAllocations.length, 0);
  assert.equal(aggregate(c).summary.totalAmount, 24000);
});

test('legacy manual amounts matching a bank receipt are flagged, not silently counted twice or discarded', () => {
  const c = base(); delete c.payments; delete c.paymentAllocations;
  c.works[0] = { ...c.works[0], creditedAmount: 48000, paymentDate: '2026-09-08', isPayed: true };
  c.works[1] = { ...c.works[1], creditedAmount: 24000, paymentDate: '2026-08-31', isPayed: true,
    bankPayments: [{ bankPaymentId: 'bank-166', amount: 48000, date: '2026-09-08', documentNumber: '166' }] };
  const normalized = ledger.normalize(c);
  assert.equal(normalized.payments.length, 3);
  assert.equal(normalized.payments.filter(ledger.active).length, 1);
  const statement = buildStatement({ ...normalized, organizationId: 'org', clientId: 'client', dateFrom: '2026-01-01', dateTo: '2026-12-31' });
  assert.equal(statement.totalPaid, 48000);
  assert.equal(statement.warnings.length, 2);
});

test('new and legacy-compatible backups preserve receipts, allocation identities and amounts', () => {
  const c = ledger.normalize(base());
  const compatible = JSON.parse(JSON.stringify(ledger.exportCompatible(c)));
  assert.deepEqual(ledger.normalize(compatible), c);
  delete compatible.payments; delete compatible.paymentAllocations;
  const migrated = ledger.normalize(compatible);
  assert.equal(migrated.payments.length, 1);
  assert.equal(migrated.payments[0].amount, 24000);
  assert.equal(migrated.works[1].creditedAmount, 24000);
  assert.equal(ledger.normalize(migrated).payments.length, 1);
});

test('contract cost, installment invoice and UPD amounts remain independent', () => {
  const crm = base().works[1];
  assert.equal(amounts.getOrderAmount(crm), 48000);
  assert.equal(amounts.getInvoiceAmount(crm), 24000);
  assert.equal(amounts.getUpdAmount(crm), 48000);
  assert.equal(amounts.getInvoiceItems(crm)[0].amount, 24000);
  assert.equal(amounts.getOrderItems(crm)[0].amount, 48000);
  assert.equal(amounts.getUpdItems(crm)[0].amount, 48000);
});

test('bank imports can register an unallocated client advance without an invoice', () => {
  const source = base();
  const p = receipt({ paymentId: 'new-advance', amount: 1000, date: '2026-07-01' });
  const preview = bank.preview({ collections: source, payments: [p], organizationId: 'org' });
  assert.equal(preview.rows[0].include, false);
  assert.equal(preview.rows[0].clientId, 'client');
  const result = bank.apply({ payload: { collections: source }, preview, allocations: [{ paymentId: p.paymentId, clientId: 'client', workId: '', amount: 0 }] });
  const c = result.payload.collections;
  assert.equal(result.updatedWorks, 0);
  assert.equal(c.payments.length, 2);
  assert.equal(ledger.availableAmount(c, p.paymentId), 1000);
  assert.equal(aggregate(c).summary.totalAmount, 25000);
  const repeat = bank.preview({ collections: c, payments: [p], organizationId: 'org' });
  assert.equal(repeat.rows[0].include, false);
  const again = bank.apply({ payload: { collections: c }, preview: repeat, allocations: [{ paymentId: p.paymentId, clientId: 'client', workId: '', amount: 0 }] });
  assert.equal(again.payload.collections.payments.length, 2);
});

test('explicit multiple invoice references split only when each reference is unique and fully covered', () => {
  const source = base();
  const preview = bank.preview({ collections: source, payments: [receipt({ purpose: 'По счету №46 от 07.09.2026 и счету №47 от 07.09.2026' })], organizationId: 'org' });
  assert.deepEqual(preview.rows[0].allocations.map((entry) => entry.amount), [24000, 24000]);
  const ambiguous = bank.preview({ collections: source, payments: [receipt({ amount: 30000, purpose: 'По счету №46 и счету №47' })], organizationId: 'org' });
  assert.equal(ambiguous.rows[0].include, false);
});

test('canonical bank identities and amounts cannot be duplicated or silently edited', () => {
  const source = ledger.savePayment(base(), { ...receipt(), _id: 'receipt', bankPaymentId: 'original', source: 'bank', clientId: 'client' }, []);
  assert.throws(() => ledger.savePayment(source, { ...source.payments[1], amount: 1 }, []), /менять нельзя/);
  assert.throws(() => ledger.normalize({ ...source, payments: [...source.payments, { ...source.payments[1], _id: 'other' }] }), /повторяется/);
  assert.throws(() => ledger.normalize({ works: [], payments: {}, paymentAllocations: {} }), /формат/);
});

test('a work can change its client after explicitly removing its payment links', () => {
  const c = ledger.normalize(base());
  c.works[1].clientId = 'new-client';
  const next = ledger.setWorkAllocations(c, 'crm', []);
  assert.equal(next.works[1].clientId, 'new-client');
  assert.equal(next.payments.length, 1);
  assert.equal(ledger.availableAmount(next, 'advance'), 24000);
  assert.throws(() => ledger.setWorkAllocations(c, 'crm', [{ paymentId: 'advance', amount: 24000 }]), /не совпадают/);
});

test('legacy-compatible exports retain unresolved receipt review flags', () => {
  const c = base(); c.payments[0].reviewStatus = 'legacy-uncertain';
  const exported = ledger.exportCompatible(c);
  delete exported.payments; delete exported.paymentAllocations;
  const restored = ledger.normalize(exported);
  assert.equal(restored.payments.filter(ledger.active).length, 0);
  assert.equal(restored.works[1].creditedAmount, 0);
});
