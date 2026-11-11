#!/usr/bin/env node
'use strict';

const { createCipheriv, createDecipheriv, createHash, pbkdf2Sync, randomBytes } = require('node:crypto');
const { readFileSync, writeFileSync, renameSync, existsSync, unlinkSync, realpathSync, statSync } = require('node:fs');
const { isAbsolute, join, relative, resolve, sep } = require('node:path');
const { createInterface } = require('node:readline');
const { Writable } = require('node:stream');
const { execFileSync } = require('node:child_process');
const { gunzipSync } = require('node:zlib');
const { isDeepStrictEqual } = require('node:util');

const SEED_PREFIX = 'window.__OFFERS_SEED_ENCRYPTED__ = ';
const MAX_BACKUP_BYTES = 128 * 1024 * 1024;
const GENERATED_FILES = ['seed-data.js', 'index.html'];

const validateBackup = (payload) => {
  if (!payload || !payload.collections || typeof payload.collections !== 'object' || Array.isArray(payload.collections)) {
    throw new Error('Invalid backup: expected a collections object.');
  }
  for (const name of ['clients', 'organizations', 'works']) {
    if (!Array.isArray(payload.collections[name])) throw new Error(`Invalid backup: missing ${name} collection.`);
  }
  for (const [name, documents] of Object.entries(payload.collections)) {
    if (!Array.isArray(documents) || documents.some((document) => !document || typeof document !== 'object' || Array.isArray(document))) {
      throw new Error(`Invalid backup: ${name} must contain document objects.`);
    }
  }
  return payload;
};

const readBackup = (filename) => {
  if (statSync(filename).size > MAX_BACKUP_BYTES) throw new Error('Backup exceeds the 128 MiB size limit.');
  const buffer = readFileSync(filename);
  const json = buffer[0] === 0x1f && buffer[1] === 0x8b
    ? gunzipSync(buffer, { maxOutputLength: MAX_BACKUP_BYTES })
    : buffer;
  return validateBackup(JSON.parse(json.toString('utf8').replace(/^\uFEFF/, '')));
};

const parseSeed = (source) => {
  const assignment = source.trim();
  if (!assignment.startsWith(SEED_PREFIX) || !assignment.endsWith(';')) throw new Error('Unsupported seed-data.js format.');
  const seed = JSON.parse(assignment.slice(SEED_PREFIX.length, -1));
  if (seed.version !== 1 || seed.kdf !== 'PBKDF2-SHA256' || !Number.isInteger(seed.iterations)
    || seed.iterations < 100000 || seed.iterations > 2000000
    || typeof seed.salt !== 'string' || typeof seed.iv !== 'string' || typeof seed.data !== 'string'
    || Buffer.from(seed.salt, 'base64').length !== 16 || Buffer.from(seed.iv, 'base64').length !== 12
    || Buffer.from(seed.data, 'base64').length < 16) {
    throw new Error('Unsupported seed encryption settings.');
  }
  return seed;
};

const decryptSeed = (seed, password) => {
  const key = pbkdf2Sync(password, Buffer.from(seed.salt, 'base64'), seed.iterations, 32, 'sha256');
  try {
    const data = Buffer.from(seed.data, 'base64');
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(seed.iv, 'base64'));
    decipher.setAuthTag(data.subarray(-16));
    return JSON.parse(Buffer.concat([decipher.update(data.subarray(0, -16)), decipher.final()]).toString('utf8'));
  } catch {
    throw new Error('Cannot decrypt the current seed. Check the static site password. No files changed.');
  } finally {
    key.fill(0);
  }
};

const encryptSeed = (payload, password, iterations = 250000) => {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = pbkdf2Sync(password, salt, iterations, 32, 'sha256');
  try {
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const data = Buffer.concat([cipher.update(JSON.stringify(payload), 'utf8'), cipher.final(), cipher.getAuthTag()]);
    return { version: 1, kdf: 'PBKDF2-SHA256', iterations, salt: salt.toString('base64'), iv: iv.toString('base64'), data: data.toString('base64') };
  } finally {
    key.fill(0);
  }
};

const serializeSeed = (seed) => `${SEED_PREFIX}${JSON.stringify(seed)};\n`;

const updateSeedVersion = (index, version) => {
  let matches = 0;
  const updated = index.replace(/(<script\b[^>]*\bsrc=["']\.\/seed-data\.js)(?:\?[^"']*)?(["'])/g, (_, prefix, quote) => {
    matches += 1;
    return `${prefix}?v=${version}${quote}`;
  });
  if (matches !== 1) throw new Error('Expected exactly one seed-data.js script in index.html.');
  return updated;
};

const promptPassword = () => new Promise((resolvePassword, reject) => {
  if (!process.stdin.isTTY) {
    reject(new Error('Run this script in an interactive terminal to enter the static site password.'));
    return;
  }
  let muted = false;
  const output = new Writable({ write(chunk, encoding, callback) {
    if (!muted) process.stderr.write(chunk, encoding);
    callback();
  } });
  const input = createInterface({ input: process.stdin, output, terminal: true });
  let answered = false;
  input.on('close', () => {
    process.stderr.write('\n');
    if (!answered) reject(new Error('Cancelled. No files changed.'));
  });
  input.on('SIGINT', () => input.close());
  input.question('Static site password (hidden): ', (password) => {
    answered = true;
    input.close();
    resolvePassword(password);
  });
  muted = true;
});

const atomicWrite = (filename, content) => {
  const temporary = `${filename}.publish-${process.pid}.tmp`;
  let created = false;
  try {
    writeFileSync(temporary, content, { flag: 'wx', mode: 0o600 });
    created = true;
    renameSync(temporary, filename);
  } finally {
    if (created && existsSync(temporary)) unlinkSync(temporary);
  }
};

const publishBackup = async ({ backupPath, password, repoDir = resolve(__dirname, '..'), log = console.log }) => {
  const root = realpathSync(repoDir);
  const backupFile = realpathSync(resolve(backupPath));
  const backupRelative = relative(root, backupFile);
  if (!isAbsolute(backupRelative) && backupRelative !== '..' && !backupRelative.startsWith(`..${sep}`)) {
    throw new Error('Keep the unencrypted backup outside the public Git repository.');
  }
  const payload = readBackup(backupFile);
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (realpathSync(git('rev-parse', '--show-toplevel')) !== root) throw new Error('The script must belong to the repository root.');
  if (git('branch', '--show-current') !== 'main') throw new Error('Switch to the main branch before publishing.');
  if (git('status', '--porcelain')) throw new Error('The working tree is not clean. Commit or move your changes first.');
  git('var', 'GIT_AUTHOR_IDENT');
  git('var', 'GIT_COMMITTER_IDENT');
  log('Checking origin/main...');
  git('fetch', 'origin', 'main');
  if (git('rev-parse', 'HEAD') !== git('rev-parse', 'refs/remotes/origin/main')) {
    throw new Error('Local main differs from origin/main. Synchronize the branch before publishing.');
  }

  const originals = GENERATED_FILES.map((name) => readFileSync(join(root, name)));
  const currentSeed = parseSeed(originals[0].toString('utf8'));
  const secret = password ?? await promptPassword();
  if (!secret) throw new Error('The password cannot be empty.');
  const currentPayload = decryptSeed(currentSeed, secret);
  if (isDeepStrictEqual(currentPayload, payload)) {
    log('This backup is already published. No commit needed.');
    return { changed: false };
  }

  const encrypted = encryptSeed(payload, secret, currentSeed.iterations);
  if (!isDeepStrictEqual(decryptSeed(encrypted, secret), payload)) throw new Error('Encrypted backup verification failed.');
  const revision = createHash('sha256').update(JSON.stringify(payload)).digest('hex').slice(0, 16);
  const contents = [serializeSeed(encrypted), updateSeedVersion(originals[1].toString('utf8'), revision)];
  let committed = false;
  try {
    GENERATED_FILES.forEach((name, index) => atomicWrite(join(root, name), contents[index]));
    git('add', '--', ...GENERATED_FILES);
    git('commit', '--only', '-m', `data: refresh published backup (${payload.collections.works.length} works)`, '--', ...GENERATED_FILES);
    committed = true;
    const commit = git('rev-parse', '--short', 'HEAD');
    try {
      git('push', 'origin', 'HEAD:main');
    } catch {
      throw new Error(`Commit ${commit} was created, but push failed. Retry: git -C "${root}" push origin main`);
    }
    log(`Published commit ${commit}: ${payload.collections.works.length} works, ${payload.collections.clients.length} clients.`);
    log('GitHub Pages will deploy automatically. Existing browser data is not overwritten.');
    return { changed: true, commit, revision };
  } catch (error) {
    if (!committed) {
      try { git('restore', '--staged', '--', ...GENERATED_FILES); } catch { /* Original index was clean. */ }
      GENERATED_FILES.forEach((name, index) => atomicWrite(join(root, name), originals[index]));
    }
    throw error;
  }
};

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args.length !== 1 || args[0] === '--help' || args[0] === '-h') {
    console.log('Usage: node scripts/publish-backup.cjs "C:\\path\\backup.json.gz"');
    if (args.length !== 1) process.exitCode = 1;
  } else {
    publishBackup({ backupPath: args[0] }).catch((error) => {
      console.error(`Publish failed: ${error.message}`);
      process.exitCode = 1;
    });
  }
}

module.exports = { readBackup, parseSeed, decryptSeed, encryptSeed, serializeSeed, updateSeedVersion, publishBackup };
