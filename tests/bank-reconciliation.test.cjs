const { strict: assert } = require('node:assert');
const { mkdtempSync, writeFileSync, readFileSync, rmSync, realpathSync } = require('node:fs');
const { join, dirname, basename } = require('node:path');
const { tmpdir } = require('node:os');
const { test } = require('node:test');
const { gzipSync } = require('node:zlib');
const XLSX = require('../xlsx.full.min.js');
const { readBackup } = require('../scripts/publish-backup.cjs');
const { previewReconciliation, applyReconciliation, invoiceReferences } = require('../scripts/lib/bank-reconciliation.cjs');
const { paymentDate, paymentDateTime, paymentDetails, normalizePaymentFields, combinePaymentDateTime } = require('../work-payments.js');

const base = () => ({ collections: {
  clients: [{ _id: 'client', inn: '0012345678', name: 'Client', bankAccount: '00000000000000000001', customField: 'keep' }],
  organizations: [{ _id: 'org', inn: '123456789012', bankAccount: '00000000000000000002', name: 'Seller' }],
  works: [
    { _id: 'w1', invoiceNumber: '1', invoiceDate: '2026-01-01', amount: 50000, creditedAmount: 25000, updAmount: 100000, clientId: 'client', executorOrganizationId: 'org', isPayed: false },
    { _id: 'w2', invoiceNumber: '2', invoiceDate: '2026-01-01', amount: 25000, clientId: 'client', executorOrganizationId: 'org', isPayed: false },
    { _id: 'old', invoiceNumber: '1', invoiceDate: '2025-01-01', amount: 50000, clientId: 'client', executorOrganizationId: 'org', isPayed: true },
    { _id: 'kwork', source: 'kwork', invoiceNumber: '', amount: 25000, clientId: 'client', executorOrganizationId: 'org', isPayed: true }
  ], files: [{ custom: 'preserve' }]
} });
const payment = (number, amount, purpose = 'Оплата по счету № 1 от 01.01.2026') => ['2026-01-10', number, 'Client', '0012345678', amount, purpose, 'Исполнен'];
const fixture = (t, rows, source = base()) => {
  const parent = realpathSync(tmpdir());
  const dir = mkdtempSync(join(parent, 'offers-bank-test-'));
  t.after(() => {
    if (dirname(dir) !== parent || !basename(dir).startsWith('offers-bank-test-')) throw new Error('Unsafe cleanup target');
    rmSync(dir, { recursive: true, force: true });
  });
  const backupPath = join(dir, 'input.json.gz');
  const bankPath = join(dir, 'events.xlsx');
  const outputPath = join(dir, 'updated.json.gz');
  writeFileSync(backupPath, gzipSync(JSON.stringify(source)));
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet([['Дата', 'Наименование', 'Контрагент', 'ИНН', 'Сумма', 'Назначение', 'Статус'], ...rows]), 'Операции');
  writeFileSync(bankPath, XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
  const preview = () => previewReconciliation({ backupPath, bankPath });
  const apply = (allocations, options = {}) => {
    const p = preview();
    return applyReconciliation({ backupPath, bankPath, organizationId: p.organizationId, backupHash: p.backupHash,
      bankHash: p.bankHash, allocations, outputPath, ...options });
  };
  return { backupPath, bankPath, outputPath, preview, apply };
};

test('payment dates are real calendar dates and legacy paid flags stay intact', () => {
  assert.equal(paymentDate('2026-02-30'), null);
  assert.equal(paymentDate('11.11.2026'), '2026-11-11');
  assert.equal(paymentDate({ $date: '2026-11-11T12:00:00.000Z' }), '2026-11-11');
  assert.equal(paymentDetails({ amount: 100, isPayed: true }).isPayed, true);
  assert.equal(paymentDetails({ amount: 100, paymentAmount: 25, isPayed: true }).isPayed, false);
  assert.equal(paymentDetails({ amount: 100, paymentAmount: 100 }).isPayed, true);
});

test('invoice reference parsing handles bank date separators and ignores contract numbers', () => {
  assert.deepEqual(invoiceReferences('По счету №52 от 12.10 2026г. договор №999'), [{ number: '52', date: '2026-10-12' }]);
  assert.deepEqual(invoiceReferences('Перевод по договору №123'), []);
});

test('annual numbering, party identity, rejected and outgoing payments are respected', (t) => {
  const rejected = payment('rejected', 100); rejected[6] = 'Отклонён банком';
  const f = fixture(t, [payment('incoming', 25000), payment('outgoing', -25000), rejected]);
  const p = f.preview();
  assert.equal(p.matchedRows, 1);
  assert.equal(p.rows[0].workId, 'w1');
  assert.equal(p.rows[1].canSelect, false);
  assert.equal(p.rows[2].canSelect, false);
});

test('partial payments accumulate, preserve requisites and UPD, and duplicate imports do not add income', (t) => {
  const f = fixture(t, [payment('first', 25000), payment('second', 25000)]);
  const p = f.preview();
  f.apply([{ paymentId: p.rows[0].paymentId, workId: 'w1', amount: 25000 }]);
  let restored = readBackup(f.outputPath);
  let work = restored.collections.works.find((item) => item._id === 'w1');
  assert.equal(work.creditedAmount, 25000);
  assert.equal('paymentAmount' in work, false);
  assert.equal(work.isPayed, false);
  assert.equal(work.paymentDate, '2026-01-10');
  assert.equal(work.amount, 50000);
  assert.equal(work.creditedAmount, 25000);
  assert.equal(work.updAmount, 100000);
  assert.deepEqual(restored.collections.clients, base().collections.clients);
  writeFileSync(f.backupPath, readFileSync(f.outputPath));
  const next = f.preview();
  assert.equal(next.rows[0].reason, 'Уже учтен');
  f.apply([{ paymentId: next.rows[1].paymentId, workId: 'w1', amount: 25000 }]);
  restored = readBackup(f.outputPath);
  work = restored.collections.works.find((item) => item._id === 'w1');
  assert.equal(work.creditedAmount, 50000);
  assert.equal(work.isPayed, true);
  writeFileSync(f.backupPath, readFileSync(f.outputPath));
  assert.equal(f.preview().rows.filter((row) => row.canSelect).length, 0);
});

test('one payment can be split between invoices and over-allocation is rejected', (t) => {
  const f = fixture(t, [payment('one', 50000)]);
  const paymentId = f.preview().rows[0].paymentId;
  assert.throws(() => f.apply([{ paymentId, workId: 'w1', amount: 50000 }, { paymentId, workId: 'w2', amount: 1 }]), /превышает/);
  f.apply([{ paymentId, workId: 'w1', amount: 25000 }, { paymentId, workId: 'w2', amount: 25000 }]);
  const works = readBackup(f.outputPath).collections.works;
  assert.equal(works.find((work) => work._id === 'w1').creditedAmount, 25000);
  assert.equal(works.find((work) => work._id === 'w2').creditedAmount, 25000);
});

test('files changed after preview and overwriting source data are rejected', (t) => {
  const f = fixture(t, [payment('one', 50000)]);
  const p = f.preview();
  assert.throws(() => f.apply([{ paymentId: p.rows[0].paymentId, workId: 'w1', amount: 50000 }], { outputPath: f.backupPath }), /перезаписывать/);
  assert.throws(() => applyReconciliation({ backupPath: f.backupPath, bankPath: f.bankPath, backupHash: 'stale', bankHash: p.bankHash, allocations: [], outputPath: f.outputPath }), /изменились/);
});

test('date discrepancies and manual payment totals require review', (t) => {
  const source = base(); source.collections.works[0].paymentAmount = 1000;
  const f = fixture(t, [payment('manual', 25000)], source);
  assert.equal(f.preview().rows[0].include, false);
  assert.match(f.preview().rows[0].reason, /ручную/);
  const other = fixture(t, [payment('date', 25000, 'Счет №1 от 02.01.2026')]);
  assert.equal(other.preview().rows[0].include, false);
  assert.equal(other.preview().rows[0].workId, 'w1');
});

test('legacy duplicate payment amount migrates to creditedAmount without losing payments', () => {
  const migrated = normalizePaymentFields({ amount: 50000, creditedAmount: 50000, paymentAmount: 25000,
    paymentDate: '2026-11-11T13:45:16', isPayed: true, bankPayments: [{ amount: 25000 }] });
  assert.equal(migrated.creditedAmount, 25000);
  assert.equal('paymentAmount' in migrated, false);
  assert.equal(migrated.paymentDate, '2026-11-11T13:45:16');
  assert.equal(migrated.isPayed, false);
  assert.equal(migrated.bankPayments.length, 1);
  assert.equal(normalizePaymentFields({ amount: 100, creditedAmount: 0, isPayed: false }).creditedAmount, 0);
});

test('receipt times and time zones are retained and date-only sources stay date-only', () => {
  assert.equal(paymentDateTime('11.11.2026 13:45:16'), '2026-11-11T13:45:16');
  assert.equal(paymentDateTime('2026-11-11T13:45:16+03:00'), '2026-11-11T13:45:16+03:00');
  assert.equal(paymentDateTime('2026-11-11'), '2026-11-11');
  assert.equal(paymentDateTime('2026-11-11T25:00'), null);
  assert.equal(combinePaymentDateTime('2026-11-11', '13:45', '2026-11-11T13:45:00+03:00'), '2026-11-11T13:45:00+03:00');
  assert.equal(combinePaymentDateTime('2026-11-11', '13:45', '2026-11-11T13:45:16+03:00'), '2026-11-11T13:45');
});

test('Excel numeric receipt times survive import without changing duplicate identifiers', (t) => {
  const row = payment('with-time', 50000);
  const f = fixture(t, [row]);
  const old = f.preview().rows[0];
  const wb = XLSX.read(readFileSync(f.bankPath), { type: 'buffer' });
  const cell = wb.Sheets['Операции'].A2;
  cell.t = 'n'; cell.v = 46032 + (13 * 3600 + 45 * 60 + 16) / 86400; cell.z = 'dd.mm.yyyy hh:mm:ss';
  writeFileSync(f.bankPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  const p = f.preview();
  assert.match(p.rows[0].date, /T13:45:16$/);
  f.apply([{ paymentId: p.rows[0].paymentId, workId: 'w1', amount: 50000 }]);
  const restored = readBackup(f.outputPath).collections.works.find((work) => work._id === 'w1');
  assert.match(restored.paymentDate, /T13:45:16$/);
  cell.v = Math.floor(cell.v); cell.z = 'dd.mm.yyyy';
  writeFileSync(f.bankPath, XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' }));
  assert.equal(f.preview().rows[0].paymentId, p.rows[0].paymentId);
});
