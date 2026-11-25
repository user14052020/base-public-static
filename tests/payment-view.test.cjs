const { test } = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../payment-ledger.js');
const view = require('../payment-view.js');

const setup = () => {
  let db = ledger.normalize({ organizations: [{ _id: 'org', name: 'Seller' }], clients: [{ _id: 'client', name: 'Buyer' }],
    works: [{ _id: 'work', source: 'document', clientId: 'client', executorOrganizationId: 'org', amount: 100, invoiceNumber: '1', items: [{ name: 'Service' }] }], payments: [], paymentAllocations: [] });
  let saved = 0;
  const controller = view.create({ html: String, formatMoney: String, paymentDateText: (value) => value || '', uid: () => 'receipt', getDb: () => db,
    replaceCollections: (next) => { db = next; }, saveDb: () => { saved++; }, render() {}, message() {}, confirm: () => true });
  const form = (changes = {}, shares = []) => Object.assign({ dataset: { form: 'payment' },
    paymentId: { value: '' }, paymentClientId: { value: 'client' }, paymentOrganizationId: { value: 'org' }, receiptDate: { value: '25.11.2026 12:34:56' },
    receiptAmount: { value: '100' }, receiptNumber: { value: '1' }, receiptContract: { value: 'Contract' }, receiptPurpose: { value: 'Service' },
    querySelectorAll: () => shares.map((entry) => ({ querySelector: (selector) => ({ value: entry[selector.match(/name="([^"]+)"/)[1]] }) })) }, changes);
  return { controller, form, getDb: () => db, saved: () => saved };
};

test('payment cards create and edit one receipt with a work dropdown, date and time, and preserve its identity', () => {
  const h = setup();
  h.controller.handleAction('new-payment', {});
  assert.match(h.controller.render(), /name="receiptDate"/);
  h.controller.handleSubmit(h.form({}, [{ allocatedWorkId: 'work', allocatedAmount: '40', allocationKind: 'advance' }]));
  assert.equal(h.getDb().payments.length, 1);
  assert.equal(h.getDb().payments[0].date, '2026-11-25T12:34:56');
  assert.equal(h.getDb().works[0].creditedAmount, 40);
  h.controller.handleAction('edit-payment', { dataset: { id: 'receipt' } });
  assert.match(h.controller.render(), /option value="work" selected/);
  h.controller.handleSubmit(h.form({ paymentId: { value: 'receipt' } }, [{ allocatedWorkId: 'work', allocatedAmount: '100', allocationKind: 'payment' }]));
  assert.equal(h.getDb().payments.length, 1);
  assert.equal(h.getDb().works[0].isPayed, true);
  assert.equal(h.saved(), 2);
  h.controller.handleAction('delete-payment', { dataset: { id: 'receipt' } });
  assert.equal(h.getDb().payments.length, 0);
  assert.equal(h.getDb().works[0].isPayed, false);
});

test('payment card validation never partially persists an invalid allocation', () => {
  const h = setup();
  assert.throws(() => h.controller.handleSubmit(h.form({}, [{ allocatedWorkId: 'work', allocatedAmount: '101', allocationKind: 'payment' }])), /превышает/);
  assert.equal(h.getDb().payments.length, 0);
  assert.equal(h.saved(), 0);
  h.controller.handleSubmit(h.form());
  assert.equal(h.getDb().payments.length, 1);
  assert.equal(h.getDb().paymentAllocations.length, 0);
});
