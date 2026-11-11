'use strict';

const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, realpathSync } = require('node:fs');
const { resolve } = require('node:path');
const { gzipSync } = require('node:zlib');
const XLSX = require('../../xlsx.full.min.js');
const core = require('../../bank-reconciliation.js');
const { readBackup } = require('../publish-backup.cjs');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const parseBankWorkbook = (buffer, collections, organizationId) => {
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false, cellNF: true });
  return core.parseWorkbook(workbook, collections, organizationId).map(({ fingerprint, ...row }) => ({ ...row, paymentId: hash(fingerprint) }));
};
const previewReconciliation = ({ backupPath, bankPath, organizationId }) => {
  const payload = readBackup(backupPath);
  const organizations = payload.collections.organizations || [];
  const selected = organizationId || (organizations.length === 1 ? core.id(organizations[0]._id) : '');
  return { ...core.preview({ collections: payload.collections, payments: parseBankWorkbook(readFileSync(bankPath), payload.collections, selected), organizationId: selected }),
    backupHash: hash(readFileSync(backupPath)), bankHash: hash(readFileSync(bankPath)) };
};
const applyReconciliation = ({ backupPath, bankPath, organizationId, backupHash, bankHash, allocations, outputPath }) => {
  if (!backupHash || !bankHash || hash(readFileSync(backupPath)) !== backupHash || hash(readFileSync(bankPath)) !== bankHash) throw new Error('Исходные файлы изменились. Повторите сопоставление.');
  if (resolve(backupPath) === resolve(outputPath) || resolve(bankPath) === resolve(outputPath)
    || (existsSync(outputPath) && [realpathSync(backupPath), realpathSync(bankPath)].includes(realpathSync(outputPath)))) throw new Error('Нельзя перезаписывать исходный бекап или выписку.');
  const result = core.apply({ payload: readBackup(backupPath), preview: previewReconciliation({ backupPath, bankPath, organizationId }), allocations });
  const temporary = `${resolve(outputPath)}.payments-${process.pid}.tmp`;
  let created = false;
  try {
    const json = Buffer.from(JSON.stringify(result.payload));
    writeFileSync(temporary, outputPath.toLowerCase().endsWith('.gz') ? gzipSync(json) : json, { flag: 'wx', mode: 0o600 });
    created = true;
    renameSync(temporary, outputPath);
  } finally { if (created && existsSync(temporary)) unlinkSync(temporary); }
  return { outputPath: resolve(outputPath), updatedWorks: result.updatedWorks, appliedPayments: result.appliedPayments };
};
module.exports = { ...core, parseBankWorkbook, previewReconciliation, applyReconciliation, hash };
