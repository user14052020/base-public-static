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
    window: { OffersWorkAmounts: amounts, OffersWorkPayments: require('../work-payments.js'), OffersBrowserFeatures: require('../browser-features.js'), OffersSettlementView: require('../settlement-view.js'), OffersPaymentLedger: require('../payment-ledger.js'), OffersPaymentView: require('../payment-view.js'), OffersDataRevisions: require('../data-revisions.js'), OffersIncomeReport: require('../income-report.js'), location: { href: 'https://example.test/' } },
    document: { getElementById: () => ({}), addEventListener: (name, handler) => { listeners[name] = handler; } },
    sessionStorage: { getItem: () => null },
    localStorage: { setItem: () => {} },
    crypto: require('node:crypto').webcrypto,
    Blob,
    setTimeout,
    URL
  };
  vm.runInNewContext(source.replace(/\}\)\(\);\s*$/, `
    globalThis.testApp = { state, normalizeWork, aggregateReport, backupPayload, dbFromCollections,
      reviveMongo, updDocument, invoiceDocument, actDocument, updateWorkTotals, renderWorkForm, saveWorkFromForm, shell,
      filteredWorks, renderWorks, renderWorkResults, printableShell, amountToWords, personShortName, sanitizeDocumentPart, openSettlementDocument, openWorkPayment, paymentView, element: app };
  })();`), context);
  return { ...context.testApp, listeners, window: context.window, document: context.document };
};

const filterFixture = () => {
  const app = loadApp();
  app.state.db = app.dbFromCollections({ organizations: [{ _id: 'org', name: 'Executor' }],
    clients: [{ _id: 'one', name: 'Same client name' }, { _id: 'two', name: 'Same client name' }],
    works: [
      { ...makeWork(null), _id: 'older', clientId: 'one', executorOrganizationId: 'org', actDate: '2025-11-25', invoiceDate: '2025-11-25' },
      { ...makeWork(null), _id: 'first', clientId: 'one', executorOrganizationId: 'org', actDate: '2026-11-01', invoiceDate: '2026-11-01' },
      { ...makeWork(null), _id: 'last', clientId: 'one', executorOrganizationId: 'org', actDate: '2026-11-30T23:59:59.999Z', invoiceDate: '2026-11-30', items: [{ name: 'Backend', quantity: 1, price: 100 }] },
      { ...makeWork(null), _id: 'other-client', clientId: 'two', executorOrganizationId: 'org', actDate: '2026-11-15', invoiceDate: '2026-11-15' },
      { ...makeWork(null), _id: 'next', clientId: 'one', executorOrganizationId: 'org', actDate: '2026-12-01', invoiceDate: '2026-12-01' }
    ] });
  return app;
};

test('work filters combine exact client, inclusive document dates, and the existing text search', () => {
  const app = filterFixture();
  const ids = () => Array.from(app.filteredWorks(), (work) => work._id);
  assert.deepEqual(ids(), ['next', 'last', 'other-client', 'first', 'older']);
  app.state.workFilters = { clientId: 'one', dateFrom: '2026-11-01', dateTo: '2026-11-30' };
  assert.deepEqual(ids(), ['last', 'first']);
  app.state.query = '  BACKEND ';
  assert.deepEqual(ids(), ['last']);
  app.state.query = 'Executor';
  assert.deepEqual(ids(), ['last', 'first']);
  app.state.query = '';
  app.state.workFilters.dateFrom = '';
  assert.deepEqual(ids(), ['last', 'first', 'older']);
  app.state.workFilters.dateFrom = '2026-12-01';
  app.state.workFilters.dateTo = '';
  assert.deepEqual(ids(), ['next']);
  app.state.workFilters.dateTo = '2026-11-30';
  assert.deepEqual(ids(), []);
  assert.match(app.renderWorkResults(), /Начало периода не может быть позже окончания/);
});

test('changing and resetting filters preserves the editor DOM and never mutates accounting data', async () => {
  const app = filterFixture();
  const original = JSON.stringify(app.state.db);
  const results = { innerHTML: '' };
  const inputs = Object.fromEntries(['work-search', 'work-client', 'work-date-from', 'work-date-to'].map((key) => [key, { value: '', max: '', min: '' }]));
  app.document.querySelector = (selector) => selector === '[data-work-results]' ? results : inputs[/data-input="([^"]+)"/.exec(selector)?.[1]];
  app.element.innerHTML = 'unsaved editor DOM';
  app.listeners.change({ target: { dataset: { input: 'work-client' }, value: 'one' } });
  app.listeners.change({ target: { dataset: { input: 'work-date-from' }, value: '2026-11-01' } });
  assert.equal(inputs['work-date-to'].min, '2026-11-01');
  app.listeners.input({ target: { dataset: { input: 'work-search' }, value: 'Backend' } });
  assert.match(results.innerHTML, /Backend/);
  assert.equal(app.element.innerHTML, 'unsaved editor DOM');
  for (const input of Object.values(inputs)) input.value = 'active-filter';
  const button = { dataset: { action: 'reset-search' } };
  await app.listeners.click({ target: { closest: () => button } });
  assert.equal(app.state.query, '');
  assert.equal(app.state.workFilters.clientId, '');
  assert.equal(app.state.workFilters.dateFrom, '');
  assert.equal(app.state.workFilters.dateTo, '');
  assert.equal(app.element.innerHTML, 'unsaved editor DOM');
  assert.ok(Object.values(inputs).every((input) => input.value === ''));
  assert.equal(inputs['work-date-to'].min, '');
  assert.equal(JSON.stringify(app.state.db), original);
});

test('shared pages do not display the obsolete published-backup banner', () => {
  const app = loadApp();
  app.window.__OFFERS_SEED_ENCRYPTED__ = { revision: 'newer' };
  app.state.db = app.dbFromCollections({ works: [makeWork(null)] }, { seedRevision: 'older' });
  const page = app.shell('<h2>Current page</h2>');
  assert.ok(page.includes('<h2>Current page</h2>'));
  assert.ok(!page.includes('published-backup'));
  assert.ok(!page.includes('Опубликован новый бекап'));
  assert.ok(!page.includes('Загрузить опубликованные данные'));
  assert.equal(app.state.db.meta.seedRevision, 'older');
});

test('statement printing uses an isolated preview iframe without depending on browser popups', () => {
  const app = loadApp();
  const frame = {};
  const listeners = {};
  let attached = false;
  let shown = false;
  let removed = false;
  app.window.addEventListener = (event, handler) => { assert.equal(event, 'message'); listeners.message = handler; };
  app.window.removeEventListener = (event, handler) => { assert.equal(event, 'message'); assert.equal(handler, listeners.message); listeners.message = null; };
  const dialog = { setAttribute: () => {}, querySelector: (selector) => selector === 'iframe' ? frame : { addEventListener: (event, handler) => { listeners.click = handler; } },
    addEventListener: (event, handler) => { listeners[event] = handler; }, showModal: () => { shown = true; },
    close: () => listeners.close(), remove: () => { removed = true; } };
  app.document.createElement = (tag) => { assert.equal(tag, 'dialog'); return dialog; };
  app.document.body = { appendChild: (element) => { assert.equal(element, dialog); attached = true; } };
  app.openSettlementDocument('<html>printable statement</html>');
  assert.equal(frame.srcdoc, '<html>printable statement</html>');
  assert.equal(attached, true);
  assert.equal(shown, true);
  listeners.click();
  assert.equal(removed, true);
  assert.equal(listeners.message, null);
});

test('statement HTML renders a PDF blob and hands downloads to its trusted parent', async () => {
  const app = loadApp();
  const page = app.printableShell('statement', '<main>Statement</main>', 'portrait', { pdf: true, parentDownload: true });
  const script = /<script>([\s\S]*?)<\/script>/.exec(page)[1];
  const button = {};
  const blob = new Blob(['test PDF'], { type: 'application/pdf' });
  let posted;
  let saved = false;
  const worker = { set: () => worker, from: () => worker, outputPdf: async (type) => { assert.equal(type, 'blob'); return blob; }, save: () => { saved = true; } };
  const scope = { window: { html2pdf: () => worker, addEventListener: () => {}, parent: { postMessage: (data, origin) => { posted = { data, origin }; } } },
    document: { querySelector: () => button, body: { classList: { add: () => {}, remove: () => {} } } } };
  vm.runInNewContext(`${script};globalThis.exportPdf = generatePdf;`, scope);
  await scope.exportPdf();
  assert.equal(posted.origin, 'https://example.test');
  assert.equal(posted.data.type, 'offers-base-pdf');
  assert.equal(posted.data.filename, 'statement.pdf');
  assert.equal(posted.data.blob, blob);
  assert.equal(saved, false);
  assert.equal(button.disabled, false);
});

test('preview downloads accept only PDF blobs from the exact same-origin preview frame', () => {
  const app = loadApp();
  const frame = { contentWindow: {} };
  const callbacks = {};
  const downloaded = [];
  const dialog = { setAttribute: () => {}, querySelector: (selector) => selector === 'iframe' ? frame : { addEventListener: () => {} },
    addEventListener: (event, handler) => { callbacks[event] = handler; }, showModal: () => {}, remove: () => {} };
  app.document.createElement = (tag) => tag === 'dialog' ? dialog : { click() { downloaded.push(this.download); } };
  app.document.body = { appendChild: () => {} };
  app.window.addEventListener = (event, handler) => { callbacks[event] = handler; };
  app.window.removeEventListener = () => {};
  app.openSettlementDocument('<html>statement</html>');
  const data = { type: 'offers-base-pdf', blob: new Blob(['PDF'], { type: 'application/pdf' }), filename: 'statement.pdf' };
  const event = { source: frame.contentWindow, origin: 'https://example.test', data };
  callbacks.message({ ...event, source: {} });
  callbacks.message({ ...event, origin: 'https://untrusted.example' });
  callbacks.message({ ...event, data: { ...data, filename: '../outside.pdf' } });
  callbacks.message({ ...event, data: { ...data, blob: new Blob(['html'], { type: 'text/html' }) } });
  assert.deepEqual(downloaded, []);
  callbacks.message(event);
  assert.deepEqual(downloaded, ['statement.pdf']);
  callbacks.close();
});

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
    querySelectorAll: (selector) => selector === '[data-item-row]' ? [row] : [],
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
    const existing = makeWork(value);
    app.state.db = app.dbFromCollections({ works: [existing], payments: [{ _id: 'existing-payment', clientId: existing.clientId, organizationId: existing.executorOrganizationId, date: '2026-11-11', amount: 25000, source: 'manual' }], paymentAllocations: [{ paymentId: 'existing-payment', workId: existing._id, amount: 25000 }] });
    const { form } = makeForm();
    form._id.value = existing._id;
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

test('saving a work cannot create a receipt and retains client requisites and uploaded files', () => {
  const app = loadApp();
  const client = { _id: 'cccccccccccccccccccccccc', name: 'Buyer', inn: '1234567890', kpp: '123456789', ogrn: '1234567890123',
    bankAccount: '123', bankName: 'Bank', address: 'Office', signer: 'Director', customRequisite: { nested: 'retained' }, files: ['file'] };
  app.state.db = app.dbFromCollections({ clients: [client], works: [], organizations: [],
    'uploads.files': [{ _id: 'file', filename: 'card.docx' }], 'uploads.chunks': [{ _id: 'chunk', files_id: 'file', data: 'abc' }] });
  const before = JSON.parse(JSON.stringify(app.state.db.clients));
  const { form } = makeForm(); form.creditedAmount.value = '99999';
  app.saveWorkFromForm(form);
  assert.equal(app.state.db.payments.length, 0);
  assert.equal(app.state.db.works[0].creditedAmount, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(app.state.db.clients)), before);
  assert.equal(app.state.db.uploadsFiles[0].filename, 'card.docx');
  assert.equal(app.state.db.uploadsChunks[0].data, 'abc');
});

test('invoice total is always its items total, without hidden overrides or print-time price changes', () => {
  const work = { ...makeWork(50000), invoiceAmount: 1, orderAmount: 48000 };
  assert.equal(amounts.getInvoiceAmount(work), 25000);
  assert.equal(amounts.getInvoiceItems(work)[0].price, 25000);
  assert.equal(amounts.getInvoiceItems(work)[0].amount, 25000);
  assert.equal(amounts.getInvoiceAmount({ ...work, amount: 999999 }), 25000);
  const app = loadApp();
  app.state.db = app.dbFromCollections({ works: [makeWork(50000)] });
  const current = app.state.db.works[0]; app.state.editingWorkId = current._id;
  const markup = app.renderWorkForm();
  assert.doesNotMatch(markup, /name="invoiceAmount"/);
  assert.match(markup, /Сумма счета<input data-work-total readonly/);
  assert.match(markup, /name="updAmount"/);
  current.orderAmount = 48000;
  const invoice = app.invoiceDocument(current, { name: 'Seller' }, { name: 'Buyer' });
  const act = app.actDocument(current, { name: 'Seller' }, { name: 'Buyer' });
  current.orderAmount = 99999;
  assert.equal(app.invoiceDocument(current, { name: 'Seller' }, { name: 'Buyer' }), invoice);
  assert.equal(app.actDocument(current, { name: 'Seller' }, { name: 'Buyer' }), act);
});

test('legacy separate invoice totals migrate into positions once and survive backup restore without changing payments or UPD', () => {
  const original = { ...makeWork(48000), items: [{ name: 'CRM', quantity: 1, price: 48000, amount: 48000 }], amount: 48000,
    orderAmount: 48000, invoiceAmount: 24000, creditedAmount: 48000, paymentDate: '2026-09-08' };
  const source = structuredClone(original);
  const app = loadApp();
  const normalized = app.normalizeWork(original);
  assert.equal(normalized.items[0].price, 24000);
  assert.equal(normalized.amount, 24000);
  assert.equal(normalized.orderAmount, 48000);
  assert.equal(normalized.updAmount, 48000);
  assert.equal(normalized.creditedAmount, 48000);
  assert.ok(!('invoiceAmount' in normalized));
  assert.deepEqual(JSON.parse(JSON.stringify(app.normalizeWork(normalized))), JSON.parse(JSON.stringify(normalized)));
  assert.deepEqual(original, source);
  app.state.db = app.dbFromCollections({ works: [original] });
  const before = JSON.parse(JSON.stringify(app.state.db.payments));
  const backup = JSON.parse(JSON.stringify(app.backupPayload()));
  const restored = app.dbFromCollections(app.reviveMongo(backup).collections);
  assert.deepEqual(JSON.parse(JSON.stringify(restored.payments)), before);
  assert.equal(restored.works[0].items[0].price, 24000);
  assert.equal(restored.works[0].updAmount, 48000);
  assert.ok(!('invoiceAmount' in backup.collections.works[0]));
});

test('work payment totals and remaining-order widgets are removed without changing receipts or allocations', () => {
  const app = loadApp();
  app.state.db = app.dbFromCollections({ works: [{ ...makeWork(48000), orderAmount: 48000, paymentDate: '2026-11-11' }] });
  app.state.editingWorkId = app.state.db.works[0]._id;
  const before = JSON.stringify(app.backupPayload().collections);
  const markup = app.renderWorkForm() + app.renderWorkResults();
  assert.doesNotMatch(markup, /Получено по платежам|Осталось по заказу|data-work-received|data-work-balance|work-balance/);
  assert.doesNotMatch(markup, /name="linkedPayment(?:Id|Amount|Kind)"/);
  assert.match(markup, /data-action="edit-work-payment"/);
  assert.match(markup, /data-action="new-work-payment"/);
  assert.equal(JSON.stringify(app.backupPayload().collections), before);
  const source = readFileSync(join(__dirname, '../app.js'), 'utf8');
  assert.doesNotMatch(source, /updateWorkPaymentTotals|data-work-received|data-work-balance/);
});

test('saving a work never edits its receipt allocations or types', () => {
  const app = loadApp();
  const work = { ...makeWork(48000), paymentDate: '2026-11-11' };
  app.state.db = app.dbFromCollections({ works: [work] });
  const before = JSON.parse(JSON.stringify({ payments: app.state.db.payments, allocations: app.state.db.paymentAllocations }));
  const { form } = makeForm(); form._id.value = work._id;
  form.creditedAmount.value = '1';
  app.saveWorkFromForm(form);
  assert.deepEqual(JSON.parse(JSON.stringify({ payments: app.state.db.payments, allocations: app.state.db.paymentAllocations })), before);
  assert.equal(app.state.db.works[0].creditedAmount, 25000);
});

test('receipt modal callbacks update only the work payment information and results, preserving unsaved work inputs', () => {
  const app = loadApp();
  const work = { ...makeWork(null), paymentDate: '2026-11-11' };
  app.state.db = app.dbFromCollections({ works: [work] });
  const { form, fields } = makeForm(); form._id.value = work._id;
  fields.itemName.value = 'Unsaved service draft';
  const host = { innerHTML: '' }; const results = { innerHTML: '' };
  form.querySelector = () => host;
  app.document.querySelector = (selector) => selector === '[data-work-results]' ? results : null;
  let opened;
  app.paymentView.openModal = (options) => { opened = options; };
  const paymentId = app.state.db.payments[0]._id;
  app.openWorkPayment(form, paymentId);
  assert.equal(opened.workId, work._id);
  assert.equal(opened.paymentId, paymentId);
  opened.onSaved();
  assert.match(host.innerHTML, /data-action="edit-work-payment"/);
  assert.match(results.innerHTML, /Development/);
  assert.equal(fields.itemName.value, 'Unsaved service draft');
});

test('changing the work party first requires saving it before a receipt can be edited', () => {
  const app = loadApp(); const work = makeWork(null);
  app.state.db = app.dbFromCollections({ works: [work] });
  const { form } = makeForm(); form._id.value = work._id; form.clientId.value = 'changed-client';
  const message = { hidden: true }; form.querySelector = () => ({ querySelector: () => message });
  app.paymentView.openModal = () => assert.fail('must not link a receipt using stale work party information');
  app.openWorkPayment(form);
  assert.equal(message.hidden, false);
  assert.match(message.textContent, /Сначала сохраните/);
});

test('work table shows the current client INN below its name, preserving leading zeros and omitting missing INNs', () => {
  const app = loadApp();
  app.state.db = app.dbFromCollections({ clients: [{ _id: 'client-one', name: 'Buyer & Co', inn: '001234567890' }, { _id: 'client-two', name: 'Private buyer', inn: ' ' }],
    works: [{ ...makeWork(null), _id: 'first', clientId: 'client-one' }, { ...makeWork(null), _id: 'second', clientId: 'client-two' }] });
  const before = JSON.stringify(app.state.db);
  const markup = app.renderWorkResults();
  assert.match(markup, /Buyer &amp; Co<small class="work-client-inn">ИНН 001234567890<\/small>/);
  assert.equal((markup.match(/class="work-client-inn"/g) || []).length, 1);
  assert.equal(JSON.stringify(app.state.db), before);
  app.state.db.clients[0].inn = '<img src=x onerror=alert(1)>';
  const updated = app.renderWorkResults();
  assert.doesNotMatch(updated, /<img/);
  assert.match(updated, /ИНН &lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(updated, /001234567890/);
});
