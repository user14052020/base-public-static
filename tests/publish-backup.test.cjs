const { strict: assert } = require('node:assert');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { basename, dirname, join } = require('node:path');
const { test } = require('node:test');
const { gzipSync } = require('node:zlib');
const { webcrypto } = require('node:crypto');
const { readBackup, parseSeed, decryptSeed, encryptSeed, serializeSeed, updateSeedVersion, publishBackup } = require('../scripts/publish-backup.cjs');

const PASSWORD = 'fixture password only';
const payload = (works = []) => ({
  meta: { database: 'offers-base-static', createdAt: '2026-11-11T04:15:01.160Z' },
  collections: {
    clients: [{ _id: { $oid: 'aaaaaaaaaaaaaaaaaaaaaaaa' }, name: '\u041a\u043b\u0438\u0435\u043d\u0442',
      isPhysicalPerson: false, inn: '0012345678', kpp: '001001001', bankAccount: '00123456789012345678',
      bankName: 'Bank', bik: '001234567', correspondentAccount: '00987654321098765432',
      address: 'Address', email: 'fixture@example.test', phone: '+70000000000', contract: 'Contract 1',
      signerName: 'Signer', files: [], futureRequisite: { nested: 'preserved' } }],
    organizations: [{ _id: { $oid: 'bbbbbbbbbbbbbbbbbbbbbbbb' }, name: 'Seller' }],
    works, files: [], sequences: [], users: [],
    'uploads.files': [{ _id: { $oid: 'cccccccccccccccccccccccc' }, filename: 'fixture.txt' }],
    'uploads.chunks': [{ files_id: { $oid: 'cccccccccccccccccccccccc' }, n: 0, data: { $binary: 'aGVsbG8=', $type: '0' } }]
  }
});

const fixture = (t) => {
  const temporaryRoot = realpathSync(tmpdir());
  const directory = mkdtempSync(join(temporaryRoot, 'offers-seed-publish-test-'));
  t.after(() => {
    if (dirname(directory) !== temporaryRoot || !basename(directory).startsWith('offers-seed-publish-test-')) {
      throw new Error('Unsafe temporary directory cleanup target.');
    }
    rmSync(directory, { recursive: true, force: true });
  });
  const repoDir = join(directory, 'repo');
  const remoteDir = join(directory, 'origin.git');
  mkdirSync(repoDir);
  const git = (...args) => execFileSync('git', args, { cwd: repoDir, encoding: 'utf8', stdio: 'pipe' }).trim();
  git('init', '--initial-branch=main');
  git('config', 'core.autocrlf', 'false');
  git('config', 'user.name', 'Backup test');
  git('config', 'user.email', 'fixture@example.test');
  const original = payload();
  writeFileSync(join(repoDir, 'seed-data.js'), serializeSeed(encryptSeed(original, PASSWORD, 100000)));
  writeFileSync(join(repoDir, 'index.html'), '<script src="./seed-data.js?v=old"></script>\n');
  git('add', '.');
  git('commit', '-m', 'fixture');
  git('init', '--bare', '--initial-branch=main', remoteDir);
  git('remote', 'add', 'origin', remoteDir);
  git('push', 'origin', 'main');
  const backupPath = join(directory, 'backup.json.gz');
  const updated = payload([{ _id: { $oid: 'dddddddddddddddddddddddd' }, amount: 25000, creditedAmount: 25000,
    updAmount: 50000, isPayed: true, items: [{ name: 'Work', quantity: 1, price: 25000 }] }]);
  writeFileSync(backupPath, gzipSync(JSON.stringify(updated)));
  const publish = (options = {}) => publishBackup({ repoDir, backupPath, password: PASSWORD, log: () => {}, ...options });
  return { directory, repoDir, remoteDir, git, original, updated, backupPath, publish };
};

test('encrypted seed is compatible with browser WebCrypto and preserves all fields', async () => {
  const source = payload();
  const seed = encryptSeed(source, PASSWORD, 100000);
  const raw = await webcrypto.subtle.importKey('raw', Buffer.from(PASSWORD), 'PBKDF2', false, ['deriveKey']);
  const key = await webcrypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt: Buffer.from(seed.salt, 'base64'), iterations: seed.iterations },
    raw, { name: 'AES-GCM', length: 256 }, false, ['decrypt']);
  const plain = await webcrypto.subtle.decrypt({ name: 'AES-GCM', iv: Buffer.from(seed.iv, 'base64') }, key, Buffer.from(seed.data, 'base64'));
  assert.deepEqual(JSON.parse(Buffer.from(plain).toString('utf8')), source);
  assert.deepEqual(decryptSeed(parseSeed(serializeSeed(seed)), PASSWORD), source);
  assert.ok(!serializeSeed(seed).includes('fixture@example.test'));
});

test('publishing gzip backup updates only seed and cache key, commits and pushes main', async (t) => {
  const f = fixture(t);
  const result = await f.publish();
  assert.equal(result.changed, true);
  assert.deepEqual(decryptSeed(parseSeed(readFileSync(join(f.repoDir, 'seed-data.js'), 'utf8')), PASSWORD), f.updated);
  assert.ok(readFileSync(join(f.repoDir, 'index.html'), 'utf8').includes(`?v=${result.revision}`));
  assert.deepEqual(f.git('diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD').split('\n').sort(), ['index.html', 'seed-data.js']);
  assert.equal(f.git('rev-parse', 'HEAD'), f.git('--git-dir', f.remoteDir, 'rev-parse', 'main'));
  assert.equal(f.git('status', '--porcelain'), '');
  const head = f.git('rev-parse', 'HEAD');
  assert.equal((await f.publish()).changed, false);
  assert.equal(f.git('rev-parse', 'HEAD'), head);
});

test('plain JSON backups from the main version are supported', async (t) => {
  const f = fixture(t);
  const input = { ...f.updated, meta: { database: 'offers-base' } };
  const filename = join(f.directory, 'main-backup.json');
  writeFileSync(filename, '\uFEFF' + JSON.stringify(input));
  assert.deepEqual(readBackup(filename), input);
  await f.publish({ backupPath: filename });
  assert.deepEqual(decryptSeed(parseSeed(readFileSync(join(f.repoDir, 'seed-data.js'), 'utf8')), PASSWORD), input);
});

test('wrong password leaves files and git history unchanged', async (t) => {
  const f = fixture(t);
  const before = readFileSync(join(f.repoDir, 'seed-data.js'), 'utf8');
  const head = f.git('rev-parse', 'HEAD');
  await assert.rejects(f.publish({ password: 'wrong' }), /Check the static site password/);
  assert.equal(readFileSync(join(f.repoDir, 'seed-data.js'), 'utf8'), before);
  assert.equal(f.git('rev-parse', 'HEAD'), head);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('dirty repositories and backups inside the public repo are rejected', async (t) => {
  const f = fixture(t);
  writeFileSync(join(f.repoDir, 'unrelated.txt'), 'user change');
  await assert.rejects(f.publish(), /working tree is not clean/);
  assert.equal(readFileSync(join(f.repoDir, 'unrelated.txt'), 'utf8'), 'user change');
  const unsafeBackup = join(f.repoDir, 'backup.json.gz');
  writeFileSync(unsafeBackup, readFileSync(f.backupPath));
  await assert.rejects(f.publish({ backupPath: unsafeBackup }), /outside the public Git repository/);
});

test('missing collections and executable seed content are rejected', (t) => {
  const f = fixture(t);
  writeFileSync(f.backupPath, gzipSync('{"collections":{"works":[]}}'));
  assert.throws(() => readBackup(f.backupPath), /missing clients/);
  assert.throws(() => parseSeed('window.__OFFERS_SEED_ENCRYPTED__ = {}; process.exit();'), /JSON/);
  assert.throws(() => updateSeedVersion('<html></html>', 'new'), /exactly one/);
});

test('failed commit rolls back only generated files and leaves no temporary files', async (t) => {
  const f = fixture(t);
  const seed = readFileSync(join(f.repoDir, 'seed-data.js'), 'utf8');
  const index = readFileSync(join(f.repoDir, 'index.html'), 'utf8');
  const hooks = join(f.directory, 'hooks');
  mkdirSync(hooks);
  writeFileSync(join(hooks, 'pre-commit'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  f.git('config', 'core.hooksPath', hooks);
  await assert.rejects(f.publish());
  assert.equal(readFileSync(join(f.repoDir, 'seed-data.js'), 'utf8'), seed);
  assert.equal(readFileSync(join(f.repoDir, 'index.html'), 'utf8'), index);
  assert.equal(f.git('status', '--porcelain'), '');
});

test('failed push retains the local commit and prints a retry command', async (t) => {
  const f = fixture(t);
  const remoteHead = f.git('--git-dir', f.remoteDir, 'rev-parse', 'main');
  writeFileSync(join(f.remoteDir, 'hooks', 'pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  await assert.rejects(f.publish(), /was created, but push failed\. Retry: git -C/);
  assert.notEqual(f.git('rev-parse', 'HEAD'), remoteHead);
  assert.equal(f.git('--git-dir', f.remoteDir, 'rev-parse', 'main'), remoteHead);
  assert.equal(f.git('status', '--porcelain'), '');
});
