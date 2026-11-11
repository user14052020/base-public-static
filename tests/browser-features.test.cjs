const { strict: assert } = require('node:assert');
const { test } = require('node:test');
const XLSX = require('../xlsx.full.min.js');
const { create } = require('../browser-features.js');

const fixture = (publisher, document = { querySelector: () => null }) => {
  let db = { meta: { seedRevision: 'base-revision' }, clients: [{ _id: 'client', name: 'Client', inn: '0012345678' }],
    organizations: [{ _id: 'org', name: 'Seller', inn: '123456789012' }],
    works: [{ _id: 'work', clientId: 'client', executorOrganizationId: 'org', invoiceNumber: '1', invoiceDate: '2026-01-01', amount: 50000, creditedAmount: 0, isPayed: false }] };
  let seed = { revision: 'base-revision' };
  const storage = new Map(); let saves = 0;
  const features = create({ publisher, html: (text) => String(text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'),
    formatMoney: (value) => String(value), paymentDateText: (value) => value || '', storage: { getItem: (key) => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    getDb: () => db, exportPayload: () => structuredClone({ collections: { clients: db.clients, organizations: db.organizations, works: db.works } }),
    replacePayload: (payload, meta) => { db = { ...payload.collections, meta }; }, saveDb: () => { saves++; },
    render: () => {}, message: () => {}, confirm: () => true, getPassword: () => 'site-password',
    getSeed: () => seed, setSeed: (value) => { seed = value; }, document });
  return { features, getDb: () => db, storage, saves: () => saves };
};
const bankFile = () => {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([
    ['Дата', 'Наименование', 'Контрагент', 'ИНН', 'Сумма', 'Назначение', 'Статус'],
    ['2026-01-10T13:45:16', '123', 'Client', '0012345678', 50000, 'Счет №1 от 01.01.2026', 'Исполнен'],
    ['2026-01-10', '124', 'Own transfer', '123456789012', -50000, 'Перевод собственных средств', 'Исполнен']
  ]), 'Операции');
  const data = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  return { name: 'events.xlsx', arrayBuffer: async () => data };
};
const prepareBank = async (f) => {
  f.features.handleChange({ dataset: { input: 'bank-file' }, files: [bankFile()] });
  f.features.handleChange({ dataset: { input: 'bank-organization' }, value: 'org' });
  await f.features.handleAction('bank-preview', {});
};

test('the browser imports receipts into the current database and repeat imports are skipped', async () => {
  const f = fixture();
  await prepareBank(f);
  assert.ok(f.features.renderPayments().includes('Выбрано: 1'));
  await f.features.handleAction('bank-apply', {});
  assert.equal(f.getDb().works[0].creditedAmount, 50000);
  assert.equal(f.getDb().works[0].paymentDate, '2026-01-10T13:45:16');
  assert.equal(f.getDb().works[0].isPayed, true);
  assert.equal(f.getDb().meta.seedRevision, 'base-revision');
  assert.equal(f.saves(), 1);
  await prepareBank(f);
  assert.ok(f.features.renderPayments().includes('Выбрано: 0'));
});

test('a changed database invalidates the bank preview before any update is applied', async () => {
  const f = fixture();
  await prepareBank(f);
  f.getDb().works[0].amount = 60000;
  await assert.rejects(f.features.handleAction('bank-apply', {}), /База изменилась/);
  assert.equal(f.getDb().works[0].creditedAmount, 0);
  assert.equal(f.saves(), 0);
});

test('only author preferences persist; credentials never enter preferences or backups', () => {
  const f = fixture();
  f.features.handleInput({ dataset: { input: 'github-token' }, value: 'private-pat-fixture' });
  f.features.handleInput({ dataset: { input: 'github-password' }, value: 'private-password-fixture' });
  f.features.handleInput({ dataset: { input: 'github-author-name' }, value: 'Author' });
  f.features.handleInput({ dataset: { input: 'github-author-email' }, value: 'author@example.test' });
  assert.equal(f.storage.size, 1);
  const stored = [...f.storage.values()].join('');
  assert.ok(stored.includes('Author'));
  assert.ok(!stored.includes('private-pat-fixture') && !stored.includes('private-password-fixture'));
  assert.ok(!JSON.stringify(f.getDb()).includes('private-pat-fixture'));
  f.features.clearSecrets();
  assert.ok(!f.features.renderGithub().includes('private-pat-fixture'));
});

test('token input enables clearing and page exit removes credentials from the DOM too', () => {
  const clearButton = { disabled: true };
  const tokenInput = { value: 'fixture-token' };
  const passwordInput = { value: 'fixture-password' };
  const f = fixture(undefined, { querySelector: () => clearButton, querySelectorAll: () => [tokenInput, passwordInput] });
  f.features.handleInput({ dataset: { input: 'github-token' }, value: tokenInput.value });
  assert.equal(clearButton.disabled, false);
  f.features.clearSecrets();
  assert.equal(tokenInput.value, '');
  assert.equal(passwordInput.value, '');
});

test('publishing keeps the local baseline and prevents a stale Pages build from replacing it', async () => {
  const publisher = { inspect: async () => ({ seedSha: 'old-sha', revision: 'base-revision', works: 1, clients: 1 }),
    publish: async () => ({ changed: true, commit: 'a'.repeat(40), revision: 'new-revision', packet: { revision: 'new-revision' } }) };
  const f = fixture(publisher);
  f.features.handleInput({ dataset: { input: 'github-token' }, value: 'fixture-token' });
  await f.features.handleAction('github-publish', {});
  assert.equal(f.getDb().meta.seedRevision, 'new-revision');
  assert.equal(f.getDb().meta.pendingPublication.previousRevision, 'base-revision');
  assert.equal(f.getDb().meta.localChanges, false);
});

test('repeated publication retains known older Pages revisions without losing newer local edits', async () => {
  let sequence = 0;
  let f;
  const publisher = { inspect: async () => ({ seedSha: 'sha', revision: 'base-revision', works: 1, clients: 1 }),
    publish: async () => {
      sequence++;
      if (sequence === 2) f.getDb().works[0].amount = 12345;
      return { changed: true, commit: 'a'.repeat(40), revision: `revision-${sequence}`, packet: { revision: `revision-${sequence}` } };
    } };
  f = fixture(publisher);
  await f.features.handleAction('github-publish', {});
  await f.features.handleAction('github-publish', {});
  assert.deepEqual(f.getDb().meta.pendingPublication.previousRevisions, ['base-revision', 'revision-1']);
  assert.equal(f.getDb().meta.localChanges, true);
  assert.equal(f.getDb().works[0].amount, 12345);
});
