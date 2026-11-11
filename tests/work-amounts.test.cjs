const { strict: assert } = require('node:assert');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const { test } = require('node:test');
const vm = require('node:vm');
const amounts = require('../work-amounts.js');

const makeWork = (updAmount) => ({
  _id: 'aaaaaaaaaaaaaaaaaaaaaaaa',
  executorOrganizationId: 'bbbbbbbbbbbbbbbbbbbbbbbb',
  clientId: 'cccccccccccccccccccccccc',
  items: [{ name: 'Development', quantity: 1, price: 25000, amount: 25000 }],
  amount: 25000,
  creditedAmount: 25000,
  updAmount,
  isPayed: true,
  invoiceNumber: '1',
  actNumber: '1',
  actDate: '2026-11-11T00:00:00.000Z',
  invoiceDate: '2026-11-11T00:00:00.000Z'
});

test('legacy and automatic amounts follow the work total', () => {
  for (const value of [undefined, null, '', ' ', -1, NaN, Infinity, {}, false]) {
    assert.equal(amounts.getUpdAmount(makeWork(value)), 25000);
  }
  assert.equal(amounts.getUpdAmount({ ...makeWork(null), amount: 30000 }), 30000);
});

test('manual amounts, including zero, are independent of the work total', () => {
  for (const value of [0, 50000]) {
    assert.equal(amounts.getUpdAmount(makeWork(value)), value);
    assert.equal(amounts.getUpdAmount({ ...makeWork(value), amount: 30000 }), value);
  }
  assert.equal(amounts.normalizeUpdAmount('123,45'), 123.45);
});

test('automatic UPD amounts are rounded to kopecks for fractional quantities', () => {
  const work = { amount: 1.234 * 123.45, items: [{ quantity: 1.234, price: 123.45, amount: 1.234 * 123.45 }] };
  assert.equal(amounts.getUpdAmount(work), 152.34);
  assert.equal(amounts.getUpdItems(work)[0].amount, 152.34);
  assert.equal(amounts.getUpdAmount({ amount: 0.1 * 3 }), 0.3);
});

test('UPD line amounts and prices change without mutating the work', () => {
  const work = makeWork(50000);
  const original = structuredClone(work);
  assert.deepEqual(amounts.getUpdItems(work), [
    { name: 'Development', quantity: 1, price: 50000, amount: 50000 }
  ]);
  assert.deepEqual(work, original);
});

test('proportional line amounts sum to the target to the last kopeck', () => {
  const work = {
    amount: 3,
    items: [1, 2, 3].map((quantity) => ({ name: 'Service', quantity, price: 1 / quantity, amount: 1 }))
  };
  for (const target of [0, 0.01, 0.02, 1, 123.45, 50000]) {
    const items = amounts.getUpdItems({ ...work, updAmount: target });
    assert.equal(items.reduce((sum, item) => sum + Math.round(item.amount * 100), 0), Math.round(target * 100));
    for (const item of items) assert.ok(item.amount >= 0);
  }
});

test('zero-priced lines and an empty item list are safe', () => {
  const work = makeWork(100);
  work.amount = 0;
  work.items[0].price = 0;
  work.items[0].amount = 0;
  assert.equal(amounts.getUpdItems(work)[0].amount, 100);
  assert.deepEqual(amounts.getUpdItems({ items: [], amount: 0, updAmount: 100 }), []);
});

const loadApp = () => {
  const source = readFileSync(join(__dirname, '../app.js'), 'utf8');
  const listeners = {};
  const context = {
    window: { OffersWorkAmounts: amounts, OffersWorkPayments: require('../work-payments.js'), OffersBrowserFeatures: require('../browser-features.js'), location: { href: 'https://example.test/' } },
    document: { getElementById: () => ({}), addEventListener: (name, handler) => { listeners[name] = handler; } },
    sessionStorage: { getItem: () => null },
    localStorage: { setItem: () => {} },
    crypto: require('node:crypto').webcrypto,
    URL
  };
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `
    globalThis.testApp = { state, normalizeWork, aggregateReport, backupPayload, dbFromCollections,
      reviveMongo, updDocument, invoiceDocument, actDocument, updateWorkTotals, renderWorkForm, saveWorkFromForm };
  })();`), context);
  return { ...context.testApp, listeners };
};

test('backup round trips preserve automatic and manual UPD amounts', () => {
  const app = loadApp();
  for (const value of [undefined, null, 0, 50000]) {
    const work = app.normalizeWork(makeWork(value));
    app.state.db = app.dbFromCollections({ works: [work] });
    const backup = JSON.parse(JSON.stringify(app.backupPayload()));
    const restored = app.dbFromCollections(app.reviveMongo(backup).collections).works[0];
    assert.equal(restored.updAmount, value ?? null);
    assert.equal(restored.amount, 25000);
    assert.equal(restored.creditedAmount, 25000);
  }
});

test('reports, invoices and acts ignore the UPD amount', () => {
  const app = loadApp();
  const organization = { name: 'Seller' };
  const client = { name: 'Buyer' };
  const work = app.normalizeWork(makeWork(null));
  app.state.db = app.dbFromCollections({ works: [work], clients: [client] });
  const report = JSON.stringify(app.aggregateReport());
  const invoice = app.invoiceDocument(work, organization, client);
  const act = app.actDocument(work, organization, client);
  work.updAmount = 50000;
  app.state.db.works[0].updAmount = 50000;
  assert.equal(JSON.stringify(app.aggregateReport()), report);
  assert.equal(app.invoiceDocument(work, organization, client), invoice);
  assert.equal(app.actDocument(work, organization, client), act);
  const upd = app.updDocument(work, organization, client);
  assert.ok(upd.includes(new Intl.NumberFormat('ru-RU', { minimumFractionDigits: 2 }).format(50000)));
});

const makeForm = () => {
  const fields = {
    itemName: { value: 'Development' }, itemQuantity: { value: '1' }, itemPrice: { value: '25000' }
  };
  const total = {};
  const row = { querySelector: (selector) => fields[/name="(.*?)"/.exec(selector)?.[1]] };
  const form = {
    _id: { value: '' },
    documentDate: { value: '2026-11-11' },
    source: { value: 'document' },
    creditedAmount: { value: '25000' },
    isPayed: { checked: true },
    paymentDate: { value: '' },
    executorOrganizationId: { value: 'bbbbbbbbbbbbbbbbbbbbbbbb' },
    clientId: { value: 'cccccccccccccccccccccccc' },
    actNumber: { value: '' }, invoiceNumber: { value: '' },
    updAmount: { name: 'updAmount', value: '25000', dataset: { auto: 'true' } },
    querySelectorAll: () => [row],
    querySelector: () => total
  };
  form.updAmount.closest = () => form;
  return { form, fields, total };
};

test('form tracks the total automatically until a manual edit, and clearing resets it', () => {
  const app = loadApp();
  const { form, fields, total } = makeForm();
  fields.itemPrice.value = '30000';
  app.updateWorkTotals(form);
  assert.equal(form.updAmount.value, '30000');
  assert.ok(total.value.includes('30'));
  form.updAmount.value = '50000';
  app.listeners.input({ target: form.updAmount });
  fields.itemPrice.value = '35000';
  app.updateWorkTotals(form);
  assert.equal(form.updAmount.value, '50000');
  form.updAmount.value = '';
  app.listeners.input({ target: form.updAmount });
  assert.equal(form.updAmount.dataset.auto, 'true');
  assert.equal(form.updAmount.value, '35000');
});

test('saving and reopening a work preserves UPD mode without changing accounting amounts', () => {
  for (const value of [null, 0, 50000]) {
    const app = loadApp();
    app.state.db = app.dbFromCollections({});
    const { form } = makeForm();
    form.updAmount.value = String(value ?? 25000);
    form.updAmount.dataset.auto = value === null ? 'true' : 'false';
    app.saveWorkFromForm(form);
    const work = app.state.db.works[0];
    assert.equal(work.updAmount, value);
    assert.equal(work.amount, 25000);
    assert.equal(work.creditedAmount, 25000);
    app.state.editingWorkId = work._id;
    const markup = app.renderWorkForm();
    assert.ok(markup.includes(`data-auto="${value === null}" value="${value ?? 25000}"`));
  }
});

test('receipt date and time use one input and the legacy duplicate amount input is absent', () => {
  const app = loadApp();
  const work = app.normalizeWork({ ...makeWork(null), paymentDate: '2026-11-11T13:45:16+03:00' });
  app.state.db = app.dbFromCollections({ works: [work] });
  app.state.editingWorkId = work._id;
  const markup = app.renderWorkForm();
  assert.equal((markup.match(/name="paymentDate"/g) || []).length, 1);
  assert.ok(!markup.includes('name="paymentTime"'));
  assert.ok(!markup.includes('name="paymentAmount"'));
  assert.ok(markup.includes('11.11.2026 13:45:16+03:00'));
  const { form } = makeForm();
  form._id.value = work._id;
  form.paymentDate.value = '11.11.2026 13:45:16+03:00';
  app.saveWorkFromForm(form);
  assert.equal(app.state.db.works[0].paymentDate, '2026-11-11T13:45:16+03:00');
});
