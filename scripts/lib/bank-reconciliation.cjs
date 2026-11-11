'use strict';

const { createHash } = require('node:crypto');
const { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, realpathSync } = require('node:fs');
const { resolve } = require('node:path');
const { gzipSync } = require('node:zlib');
const XLSX = require('../../xlsx.full.min.js');
const { readBackup } = require('../publish-backup.cjs');
const { paymentAmount, paymentDate, paymentDetails } = require('../../work-payments.js');

const text = (value) => String(value ?? '').replace(/\s+/g, ' ').trim();
const lower = (value) => text(value).toLowerCase().replaceAll('\u0451', '\u0435');
const id = (value) => typeof value === 'string' ? value : value?.$oid || id(value?._id || '');
const hash = (value) => createHash('sha256').update(value).digest('hex');
const cents = (value) => Math.round(Number(value || 0) * 100);
const normalizedNumber = (value) => text(value).replace(/^0+(?=\d)/, '').toUpperCase();
const dateValue = (value) => {
  if (typeof value === 'number') {
    const d = XLSX.SSF.parse_date_code(value);
    return d ? paymentDate(`${d.y}-${String(d.m).padStart(2, '0')}-${String(d.d).padStart(2, '0')}`) : null;
  }
  return paymentDate(value);
};
const money = (value) => {
  const amount = typeof value === 'number' ? value : Number(text(value).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null;
};

const parseBankWorkbook = (buffer, collections, organizationId) => {
  const organizations = collections.organizations || [];
  const organization = organizations.find((item) => id(item._id) === organizationId);
  if (!organization) throw new Error('Выберите организацию из бекапа.');
  const workbook = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const result = [];
  let supported = false;
  for (const sheetName of workbook.SheetNames) {
    const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { header: 1, defval: '', raw: true });
    const headerIndex = rows.findIndex((row) => row.some((cell) => lower(cell) === 'дата') && row.some((cell) => lower(cell) === 'сумма') && row.some((cell) => lower(cell) === 'назначение'));
    if (headerIndex < 0) continue;
    supported = true;
    const headers = rows[headerIndex].map(lower);
    const index = (name) => headers.indexOf(lower(name));
    const isEvents = index('Контрагент') >= 0;
    if (!isEvents && index('Плательщик') < 0) continue;
    for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex++) {
      const values = rows[rowIndex];
      if (values.every((value) => text(value) === '')) continue;
      const get = (name) => values[index(name)];
      const amount = money(get('Сумма'));
      const date = dateValue(get('Дата'));
      const payer = text(get(isEvents ? 'Контрагент' : 'Плательщик'));
      const payerInn = text(get(isEvents ? 'ИНН' : 'ИНН/КИО Плательщика'));
      const recipientInn = text(get('ИНН Получателя'));
      const purpose = text(get('Назначение'));
      const documentNumber = text(get(isEvents ? 'Наименование' : 'Номер'));
      const bankPaymentId = hash(JSON.stringify([text(organization.inn) || text(organization.bankAccount) || organizationId,
        date, amount, normalizedNumber(documentNumber), payerInn || lower(payer), lower(purpose)]));
      let blockedReason = '';
      if (!date || amount == null) blockedReason = 'Неверная дата или сумма';
      else if (!['исполнен', 'исполнено', 'проведен', 'зачислен', 'выполнен', 'completed'].includes(lower(get('Статус')))) blockedReason = 'Платеж не исполнен';
      else if (amount <= 0) blockedReason = 'Исходящий платеж';
      else if (!isEvents && recipientInn !== text(organization.inn) && text(get('Получатель Счет')) !== text(organization.bankAccount)) blockedReason = 'Платеж не в выбранную организацию';
      else if (payerInn === text(organization.inn) || /перевод собственных средств/i.test(purpose)) blockedReason = 'Перевод собственных средств';
      result.push({ paymentId: bankPaymentId, date, amount: amount ?? 0, documentNumber, payer, payerInn, purpose,
        organizationId, sheetName, rowNumber: rowIndex + 1, blockedReason });
    }
  }
  if (!supported) throw new Error('Не найдены колонки Дата, Сумма, Назначение. Поддерживаются выгрузки Операции и Платежные поручения.');
  return result;
};

const invoiceReferences = (purpose) => {
  const references = [];
  const pattern = /сч[её]т(?:у|а|ом|е)?\s*(?:на\s*оплату\s*)?(?:№|n(?:o)?\.?|#)?\s*([0-9]+(?:[/-][0-9a-zа-я]+)?)(?:\s*от\s*(\d{2})[.\s](\d{2})[.\s]+(\d{4}))?/giu;
  for (const match of purpose.matchAll(pattern)) references.push({ number: normalizedNumber(match[1]), date: match[2] ? paymentDate(`${match[4]}-${match[3]}-${match[2]}`) : null });
  return references;
};

const bankEntries = (work) => Array.isArray(work.bankPayments) ? work.bankPayments : [];
const getInvoices = (collections, organizationId) => {
  const clients = new Map((collections.clients || []).map((client) => [id(client._id), client]));
  return (collections.works || []).filter((work) => work.source !== 'kwork' && text(work.invoiceNumber) && id(work.executorOrganizationId) === organizationId)
    .map((work) => {
      const client = clients.get(id(work.clientId)) || {};
      const date = paymentDate(work.invoiceDate) || paymentDate(work.actDate);
      return { id: id(work._id), number: text(work.invoiceNumber), date, amount: Number(work.amount || 0),
        paidAmount: paymentAmount(work.paymentAmount), client: text(client.name), clientInn: text(client.inn),
        ledgerAmount: bankEntries(work).reduce((sum, entry) => sum + cents(entry.amount), 0) / 100,
        label: `№ ${work.invoiceNumber} от ${date || '—'} · ${client.name || '—'} · ${Number(work.amount || 0).toLocaleString('ru-RU')} ₽` };
    });
};

const previewReconciliation = ({ backupPath, bankPath, organizationId }) => {
  const payload = readBackup(backupPath);
  const organizations = payload.collections.organizations || [];
  const selectedOrganization = organizationId || (organizations.length === 1 ? id(organizations[0]._id) : '');
  const invoices = getInvoices(payload.collections, selectedOrganization);
  const payments = parseBankWorkbook(readFileSync(bankPath), payload.collections, selectedOrganization);
  const allocated = new Map();
  for (const work of payload.collections.works) for (const entry of bankEntries(work)) {
    if (entry.bankPaymentId) allocated.set(entry.bankPaymentId, (allocated.get(entry.bankPaymentId) || 0) + cents(entry.amount));
  }
  const seen = new Set();
  const rows = payments.map((payment) => {
    let reason = payment.blockedReason;
    const remaining = cents(payment.amount) - (allocated.get(payment.paymentId) || 0);
    if (!reason && seen.has(payment.paymentId)) reason = 'Повтор строки в файле';
    seen.add(payment.paymentId);
    if (!reason && remaining <= 0) reason = 'Уже учтен';
    if (reason) return { ...payment, include: false, canSelect: false, reason, allocationAmount: 0, workId: '' };
    const references = invoiceReferences(payment.purpose);
    const partyMatches = (invoice) => payment.payerInn && invoice.clientInn
      ? payment.payerInn === invoice.clientInn : lower(invoice.client) === lower(payment.payer);
    const candidates = invoices.filter((invoice) => partyMatches(invoice) && invoice.date);
    const matches = references.length ? candidates.filter((invoice) => references.some((reference) =>
      normalizedNumber(invoice.number) === reference.number && (reference.date ? invoice.date === reference.date : invoice.date.slice(0, 4) === payment.date.slice(0, 4))))
      : candidates.filter((invoice) => invoice.date <= payment.date && cents(invoice.amount) - cents(invoice.paidAmount ?? invoice.ledgerAmount) === remaining);
    const numberMatches = references.length ? candidates.filter((invoice) => references.some((reference) => normalizedNumber(invoice.number) === reference.number
      && invoice.date.slice(0, 4) === (reference.date || payment.date).slice(0, 4))) : [];
    const match = matches.length === 1 ? matches[0] : numberMatches.length === 1 ? numberMatches[0] : null;
    const manualOverride = match && match.paidAmount !== null && cents(match.paidAmount) !== cents(match.ledgerAmount);
    const warning = references.length > 1 ? 'Несколько счетов в назначении' : match && matches.length !== 1 ? 'Дата счета отличается от назначения'
      : match && match.date > payment.date ? 'Дата платежа раньше счета' : manualOverride ? 'Проверить ручную сумму оплаты' : '';
    return { ...payment, allocationAmount: remaining / 100, workId: match?.id || '', include: Boolean(match && !warning), canSelect: true,
      reason: warning || (match ? (references.length ? 'Номер счета и контрагент' : 'Контрагент и сумма') : matches.length > 1 ? 'Несколько подходящих счетов' : 'Счет не найден') };
  });
  return { backupHash: hash(readFileSync(backupPath)), bankHash: hash(readFileSync(bankPath)), organizationId: selectedOrganization,
    invoices, rows, totalRows: rows.length, incomingRows: rows.filter((row) => row.canSelect).length,
    matchedRows: rows.filter((row) => row.include).length };
};

const applyReconciliation = ({ backupPath, bankPath, organizationId, backupHash, bankHash, allocations, outputPath }) => {
  if (!backupHash || !bankHash || hash(readFileSync(backupPath)) !== backupHash || hash(readFileSync(bankPath)) !== bankHash) throw new Error('Исходные файлы изменились. Повторите сопоставление.');
  if (resolve(backupPath) === resolve(outputPath) || resolve(bankPath) === resolve(outputPath)
    || (existsSync(outputPath) && [realpathSync(backupPath), realpathSync(bankPath)].includes(realpathSync(outputPath)))) throw new Error('Нельзя перезаписывать исходный бекап или выписку.');
  const preview = previewReconciliation({ backupPath, bankPath, organizationId });
  const available = new Map(preview.rows.filter((row) => row.canSelect).map((row) => [row.paymentId, row]));
  const invoiceById = new Map(preview.invoices.map((invoice) => [invoice.id, invoice]));
  const selected = new Map();
  for (const allocation of allocations || []) {
    const row = available.get(allocation.paymentId);
    const invoice = invoiceById.get(allocation.workId);
    const amount = paymentAmount(allocation.amount);
    if (!row || !invoice || amount == null || amount <= 0) throw new Error('Неверное сопоставление платежа со счетом.');
    if (row.payerInn && invoice.clientInn && row.payerInn !== invoice.clientInn) throw new Error(`ИНН плательщика не совпадает с клиентом счета ${invoice.number}.`);
    const group = selected.get(row.paymentId) || { row, totalCents: 0, allocations: new Map() };
    group.totalCents += cents(amount);
    group.allocations.set(invoice.id, (group.allocations.get(invoice.id) || 0) + cents(amount));
    if (group.totalCents > cents(row.allocationAmount)) throw new Error('Распределенная сумма превышает доступную сумму платежа.');
    selected.set(row.paymentId, group);
  }
  if (!selected.size) throw new Error('Выберите хотя бы один платеж и счет.');
  const payload = readBackup(backupPath);
  const works = new Map(payload.collections.works.map((work) => [id(work._id), work]));
  const changed = new Set();
  for (const { row, allocations: shares } of selected.values()) for (const [workId, amountCents] of shares) {
    const work = works.get(workId);
    work.bankPayments = bankEntries(work).map((entry) => ({ ...entry }));
    let entry = work.bankPayments.find((item) => item.bankPaymentId === row.paymentId);
    if (!entry) {
      entry = { bankPaymentId: row.paymentId, date: row.date, amount: 0, documentNumber: row.documentNumber,
        payer: row.payer, payerInn: row.payerInn, purpose: row.purpose };
      work.bankPayments.push(entry);
    }
    entry.amount = (cents(entry.amount) + amountCents) / 100;
    changed.add(workId);
  }
  for (const workId of changed) {
    const work = works.get(workId);
    work.paymentAmount = work.bankPayments.reduce((sum, entry) => sum + cents(entry.amount), 0) / 100;
    work.paymentDate = work.bankPayments.map((entry) => paymentDate(entry.date)).filter(Boolean).sort().at(-1) || null;
    work.isPayed = paymentDetails(work).isPayed;
  }
  payload.meta = { ...payload.meta, createdAt: new Date().toISOString(), paymentsUpdatedAt: new Date().toISOString() };
  const temporary = `${resolve(outputPath)}.payments-${process.pid}.tmp`;
  let created = false;
  try {
    const json = Buffer.from(JSON.stringify(payload));
    writeFileSync(temporary, outputPath.toLowerCase().endsWith('.gz') ? gzipSync(json) : json, { flag: 'wx', mode: 0o600 });
    created = true;
    renameSync(temporary, outputPath);
  } finally {
    if (created && existsSync(temporary)) unlinkSync(temporary);
  }
  return { outputPath: resolve(outputPath), updatedWorks: changed.size, appliedPayments: selected.size };
};

module.exports = { parseBankWorkbook, invoiceReferences, previewReconciliation, applyReconciliation, id, hash };
