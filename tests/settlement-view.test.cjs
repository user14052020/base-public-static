const { test } = require('node:test');
const assert = require('node:assert/strict');
const { create } = require('../settlement-view.js');
const { buildDocument } = require('../settlement-document.js');
const { buildStatement } = require('../settlement.js');

const html = (value) => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;');
const helpers = { html, formatMoney: (value) => Number(value).toFixed(2), displayDate: (value) => String(value).slice(0, 10).split('-').reverse().join('.'),
  amountToWords: (value) => `${value} in words`, personShortName: (value) => value, sanitizeDocumentPart: (value) => String(value).replace(/[^a-zа-я0-9]/giu, ''),
  printableShell: (title, body, layout, options) => ({ title, body, layout, options }) };
const data = () => ({ organizations: [{ _id: 'org', name: 'Seller', inn: '123', signerName: 'Seller Signer' }],
  clients: [{ _id: 'client', name: 'Buyer <script>', inn: '456', signerName: 'Buyer Signer' }],
  works: [{ _id: 'work', source: 'document', executorOrganizationId: 'org', clientId: 'client', invoiceNumber: '1', invoiceDate: '2026-01-10', amount: 100, creditedAmount: 75, paymentDate: '2026-01-20' }] });
const statement = (db) => buildStatement({ works: db.works, organizationId: 'org', clientId: 'client', dateFrom: '2026-01-01', dateTo: '2026-11-25' });

test('the statement follows the two-sided example without inventing counterpart accounting data', () => {
  const db = data();
  const options = { report: statement(db), organization: db.organizations[0], client: db.clients[0], number: '166', date: '2026-11-25' };
  const doc = buildDocument(options, helpers);
  assert.equal(doc.layout, 'portrait');
  assert.equal(doc.options.pdf, true);
  assert.match(doc.body, /Сальдо начальное/);
  assert.match(doc.body, /Обороты за период/);
  assert.match(doc.body, /задолженность в пользу Seller составляет 25.00/);
  assert.ok(!doc.body.includes('<script>'));
  assert.match(doc.body, /Buyer &lt;script>/);
  assert.equal((doc.body.match(/УПД № 1 от/g) || []).length, 1);
  const mirrored = buildDocument({ ...options, mirror: true }, helpers);
  assert.equal((mirrored.body.match(/УПД № 1 от/g) || []).length, 2);
  assert.match(doc.title, /166от25.11.2026/);
});

test('long statements have explicit A4 pages, repeated headers and balance carry-forwards', () => {
  const db = data();
  db.works = Array.from({ length: 40 }, (_, index) => ({ ...db.works[0], _id: `work-${index}`, invoiceNumber: String(index + 1) }));
  const doc = buildDocument({ report: statement(db), organization: db.organizations[0], client: db.clients[0], date: '2026-11-25' }, helpers);
  assert.equal((doc.body.match(/class="doc-page settlement-document"/g) || []).length, 5);
  assert.equal((doc.body.match(/Сальдо перенесенное/g) || []).length, 8);
  assert.equal((doc.body.match(/Обороты за период/g) || []).length, 2);
  assert.equal((doc.body.match(/settlement-print-footer/g) || []).length, 1);
  assert.match(doc.body, /Лист 5 из 5/);
});

test('missing payment dates block PDF generation instead of silently overstating a debt', () => {
  const db = data(); db.works[0].paymentDate = null; db.works[0].isPayed = true;
  assert.throws(() => buildDocument({ report: statement(db), organization: db.organizations[0], client: db.clients[0], date: '2026-11-25' }, helpers), /Исправьте/);
  const view = create({ ...helpers, getDb: () => db, today: () => '2026-11-25', paymentDateText: (value) => value, render: () => {} });
  assert.match(view.render(), /Сальдо предварительное/);
  view.handleAction('settlement-client', { dataset: { id: 'client' } });
  assert.match(view.render(), /Предварительное сальдо/);
  assert.match(view.render(), /data-action="print-settlement" disabled/);
});

test('the browser view supports client overview, manual opening, printing, and preserves the database', () => {
  const db = data(); const original = JSON.stringify(db);
  let printed; let renders = 0;
  const view = create({ ...helpers, getDb: () => db, today: () => '2026-11-25', paymentDateText: (value) => value,
    document: { querySelector: () => null }, render: () => { renders++; }, openDocument: (doc) => { printed = doc; } });
  assert.match(view.render(), /Все клиенты/);
  assert.match(view.render(), /75.00/);
  view.handleAction('settlement-client', { dataset: { id: 'client' } });
  assert.match(view.render(), /Скачать акт сверки PDF/);
  view.handleChange({ dataset: { settlementInput: 'manualOpening' }, checked: true });
  view.handleInput({ dataset: { settlementInput: 'openingAmount' }, value: '50' });
  view.handleChange({ dataset: { settlementInput: 'openingSide' }, value: 'client' });
  view.handleInput({ dataset: { settlementInput: 'number' }, value: '166' });
  view.handleAction('print-settlement', {});
  assert.match(printed.body, /задолженность в пользу Buyer &lt;script> составляет 25.00/);
  view.handleChange({ dataset: { settlementInput: 'dateFrom' }, value: '2026-01-21' });
  assert.ok(!view.render().includes('data-settlement-input="openingAmount"'));
  assert.ok(renders > 0);
  assert.equal(JSON.stringify(db), original);
});
