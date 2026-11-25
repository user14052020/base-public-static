const { test } = require('node:test');
const assert = require('node:assert/strict');
const ledger = require('../payment-ledger.js');
const view = require('../payment-view.js');

const setup = () => {
  let db = ledger.normalize({ organizations: [{ _id: 'org', name: 'Seller' }], clients: [{ _id: 'client', name: 'Buyer' }],
    works: [{ _id: 'work', source: 'document', clientId: 'client', executorOrganizationId: 'org', amount: 100, invoiceNumber: '1', items: [{ name: 'Service' }] }], payments: [], paymentAllocations: [] });
  let saved = 0;
  let renders = 0; let notifications = 0;
  const dialogs = [];
  const document = { body: { appendChild: (dialog) => dialogs.push(dialog) }, createElement: () => ({
    listeners: {}, setAttribute() {}, addEventListener(name, fn) { this.listeners[name] = fn; },
    showModal() { this.open = true; }, close() { this.open = false; this.listeners.close?.(); }, remove() { this.removed = true; }
  }) };
  const errorMessage = { hidden: true, textContent: '' };
  const controller = view.create({ html: String, formatMoney: String, paymentDateText: (value) => value || '', uid: () => 'receipt', getDb: () => db,
    document, replaceCollections: (next) => { db = next; }, saveDb: () => { saved++; }, render: () => { renders++; }, message: () => { notifications++; }, confirm: () => true });
  const form = (changes = {}, shares = []) => Object.assign({ dataset: { form: 'payment' },
    paymentId: { value: '' }, paymentClientId: { value: 'client' }, paymentOrganizationId: { value: 'org' }, receiptDate: { value: '25.11.2026 12:34:56' },
    receiptAmount: { value: '100' }, receiptNumber: { value: '1' }, receiptContract: { value: 'Contract' }, receiptPurpose: { value: 'Service' },
    querySelectorAll: () => shares.map((entry) => ({ querySelector: (selector) => ({ value: entry[selector.match(/name="([^"]+)"/)[1]] }) })),
    querySelector: () => errorMessage, closest: () => dialogs.at(-1) }, changes);
  return { controller, form, getDb: () => db, saved: () => saved, dialogs, errorMessage, renders: () => renders, notifications: () => notifications };
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

test('a receipt modal prefills the saved work and saves without rerendering or discarding its draft', () => {
  const h = setup(); let refreshed = 0;
  h.controller.openModal({ workId: 'work', onSaved: () => { refreshed++; } });
  const dialog = h.dialogs[0];
  assert.equal(dialog.open, true);
  assert.match(dialog.innerHTML, /Новый платеж/);
  assert.match(dialog.innerHTML, /option value="work" selected/);
  assert.match(dialog.innerHTML, /option value="client" selected/);
  assert.match(dialog.innerHTML, /name="allocatedAmount"/);
  assert.equal(h.saved(), 0);
  h.controller.handleSubmit(h.form({}, [{ allocatedWorkId: 'work', allocatedAmount: '40', allocationKind: 'advance' }]));
  assert.equal(h.getDb().works[0].creditedAmount, 40);
  assert.equal(refreshed, 1);
  assert.equal(h.renders(), 0);
  assert.equal(h.notifications(), 0);
  assert.equal(dialog.removed, true);
  h.controller.openModal({ workId: 'work', paymentId: 'receipt' });
  assert.match(h.dialogs[1].innerHTML, /Редактирование платежа/);
  assert.match(h.dialogs[1].innerHTML, /name="allocatedAmount"[^>]*value="40"/);
  h.controller.handleAction('cancel-payment', { closest: () => h.dialogs[1] });
  assert.equal(h.dialogs[1].removed, true);
  assert.equal(h.saved(), 1);
});

test('modal validation errors stay in the modal and cancel or Escape never change the database', () => {
  const h = setup(); const before = structuredClone(h.getDb());
  h.controller.openModal({ workId: 'work' });
  const form = h.form({}, [{ allocatedWorkId: 'work', allocatedAmount: '101', allocationKind: 'payment' }]);
  assert.equal(h.controller.handleSubmit(form), true);
  assert.match(h.errorMessage.textContent, /превышает/);
  assert.equal(h.errorMessage.hidden, false);
  assert.equal(h.dialogs[0].open, true);
  assert.equal(h.renders(), 0);
  assert.deepEqual(h.getDb(), before);
  h.dialogs[0].close();
  assert.equal(h.dialogs[0].removed, true);
  assert.deepEqual(h.getDb(), before);
  assert.throws(() => h.controller.openModal({ workId: 'unsaved' }), /Сначала сохраните/);
});
