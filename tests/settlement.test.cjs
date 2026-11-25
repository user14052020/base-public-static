const { test } = require('node:test');
const assert = require('node:assert/strict');
const { buildStatement } = require('../settlement.js');

const work = (overrides = {}) => ({ _id: 'work', executorOrganizationId: 'org', clientId: 'client',
  source: 'document', invoiceNumber: '1', invoiceDate: '2026-01-10', amount: 50000, creditedAmount: 0, isPayed: false, ...overrides });
const report = (works, options = {}) => buildStatement({ works, organizationId: 'org', clientId: 'client', dateFrom: '2026-01-01', dateTo: '2026-12-31', ...options });

test('all document works accrue their UPD amount independently from invoice and income totals', () => {
  const works = [work({ _id: 'advance', updAmount: 0, amount: 25000, creditedAmount: 25000, paymentDate: '2026-01-05' }),
    work({ _id: 'final', updAmount: 50000, amount: 25000, creditedAmount: 25000, paymentDate: '2026-01-15' })];
  const original = structuredClone(works);
  const r = report(works);
  assert.equal(r.totalUpd, 50000);
  assert.equal(r.totalPaid, 50000);
  assert.equal(r.closingBalance, 0);
  assert.equal(r.warnings.length, 0);
  assert.deepEqual(works, original);
});

test('opening balance uses earlier UPD and actual payment dates, with inclusive period boundaries', () => {
  const works = [work({ invoiceDate: '2025-12-31', amount: 100, creditedAmount: 30, paymentDate: '2026-01-01T00:00:00' }),
    work({ _id: 'last', invoiceDate: '2026-01-31', amount: 20, creditedAmount: 25, paymentDate: '2026-01-31T23:59:59' }),
    work({ _id: 'next', invoiceDate: '2026-02-01', amount: 999, creditedAmount: 999, paymentDate: '2026-02-01' })];
  const r = report(works, { dateTo: '2026-01-31' });
  assert.equal(r.openingBalance, 100);
  assert.equal(r.totalUpd, 20);
  assert.equal(r.totalPaid, 55);
  assert.equal(r.closingBalance, 65);
  assert.equal(r.rows.at(-1).balance, 65);
});

test('split bank payments are consolidated once and manual totals are not added again', () => {
  const entry = { bankPaymentId: 'bank-id', amount: 25000, date: '2026-01-12T13:45:16', documentNumber: '147' };
  const r = report([work({ amount: 25000, creditedAmount: 25000, bankPayments: [entry] }),
    work({ _id: 'other', amount: 25000, creditedAmount: 25000, bankPayments: [{ ...entry }] })]);
  assert.equal(r.totalPaid, 50000);
  assert.equal(r.rows.filter((row) => row.type === 'payment').length, 1);
  assert.equal(r.rows.find((row) => row.type === 'payment').workIds.length, 2);
  assert.equal(r.closingBalance, 0);
});

test('each payment keeps its own period rather than the invoice or latest receipt date', () => {
  const r = report([work({ amount: 100, creditedAmount: 100, paymentDate: '2026-02-01', bankPayments: [
    { bankPaymentId: 'first', amount: 40, date: '2026-01-15' }, { bankPaymentId: 'last', amount: 60, date: '2026-02-01' }
  ] })], { dateTo: '2026-01-31' });
  assert.equal(r.totalPaid, 40);
  assert.equal(r.closingBalance, 60);
});

test('unknown payment dates and inconsistent ledgers are explicit, never assigned invented dates', () => {
  const r = report([work({ creditedAmount: 50000, isPayed: true }),
    work({ _id: 'bad-ledger', creditedAmount: 100, bankPayments: [{ amount: 50, date: '2026-01-15' }] })]);
  assert.equal(r.totalPaid, 50);
  assert.deepEqual(r.warnings.map((warning) => warning.code).sort(), ['PAYMENT_DATE', 'PAYMENT_TOTAL']);
  assert.equal(report([work({ creditedAmount: 50000 })]).warnings.length, 0);
});

test('commission-based Kwork receipts do not create fictitious UPD or customer debts', () => {
  const r = report([work({ source: 'kwork', amount: 50000, creditedAmount: 40000, isPayed: true, paymentDate: '2026-01-10' }),
    work({ _id: 'other-client', clientId: 'another', amount: 100 }), work({ _id: 'other-org', executorOrganizationId: 'another', amount: 100 })]);
  assert.equal(r.totalUpd, 0);
  assert.equal(r.totalPaid, 0);
  assert.equal(r.closingBalance, 0);
  assert.equal(r.excludedKwork, 1);
});

test('manual opening balance and kopeck arithmetic remain exact', () => {
  const r = report([work({ amount: 0.3, creditedAmount: 0.1, paymentDate: '2026-01-10' })], { openingBalance: -0.2 });
  assert.equal(r.closingBalance, 0);
  assert.equal(r.automaticOpening, 0);
  assert.equal(r.manualOpening, true);
});

test('invalid periods and mixed currencies cannot silently produce a misleading statement', () => {
  assert.throws(() => report([], { dateFrom: '2026-02-30' }), /периода/);
  assert.throws(() => report([], { dateFrom: '2027-01-01' }), /позже/);
  assert.equal(report([work({ currency: 'USD' })]).warnings[0].code, 'CURRENCY');
});

test('the supplied reconciliation example produces 48000 debit, 72000 credit, and 24000 advance', () => {
  const r = report([work({ invoiceNumber: '46', invoiceDate: '2026-09-07', amount: 24000, creditedAmount: 24000,
    bankPayments: [{ bankPaymentId: '147', documentNumber: '147', amount: 24000, date: '2026-08-31' }] }),
    work({ _id: 'second', invoiceNumber: '47', invoiceDate: '2026-09-07', amount: 24000, creditedAmount: 48000,
      bankPayments: [{ bankPaymentId: '166', documentNumber: '166', amount: 48000, date: '2026-09-08' }] })], { dateTo: '2026-09-18' });
  assert.equal(r.totalUpd, 48000);
  assert.equal(r.totalPaid, 72000);
  assert.equal(r.closingBalance, -24000);
  assert.equal(r.rows[0].number, '147');
});

test('an advance for a future invoice is included on its actual receipt date', () => {
  const r = report([work({ invoiceDate: '2026-02-10', creditedAmount: 25000, paymentDate: '2026-01-20' })], { dateTo: '2026-01-31' });
  assert.equal(r.totalUpd, 0);
  assert.equal(r.totalPaid, 25000);
  assert.equal(r.closingBalance, -25000);
});
