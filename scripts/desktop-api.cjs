'use strict';

const { readFileSync, existsSync, mkdirSync, readdirSync } = require('node:fs');
const { resolve, dirname, join } = require('node:path');
const { execFileSync } = require('node:child_process');
const { readBackup, publishBackup } = require('./publish-backup.cjs');
const { previewReconciliation, applyReconciliation, id, hash } = require('./lib/bank-reconciliation.cjs');

const ensureRepository = (directory) => {
  const root = resolve(directory);
  process.env.GIT_TERMINAL_PROMPT = '0';
  process.env.GIT_SSH_COMMAND ||= 'ssh -o BatchMode=yes -o ConnectTimeout=20';
  if (!existsSync(join(root, '.git'))) {
    if (existsSync(root) && readdirSync(root).length) throw new Error('Выбранная папка не является Git-репозиторием и не пуста.');
    mkdirSync(dirname(root), { recursive: true });
    execFileSync('git', ['clone', '--branch', 'main', 'git@github.com:user14052020/base-public-static.git', root], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  }
  const remote = execFileSync('git', ['remote', 'get-url', 'origin'], { cwd: root, encoding: 'utf8' }).trim();
  if (!/^(?:git@github\.com:|https:\/\/github\.com\/|ssh:\/\/git@github\.com\/)user14052020\/base-public-static(?:\.git)?\/?$/i.test(remote)) {
    throw new Error('Origin должен указывать на user14052020/base-public-static.');
  }
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  if (git('branch', '--show-current') !== 'main') throw new Error('В папке репозитория должна быть выбрана ветка main.');
  if (git('status', '--porcelain')) throw new Error('В папке репозитория есть несохраненные изменения. Публикация отменена.');
  git('fetch', 'origin', 'main');
  git('merge', '--ff-only', 'refs/remotes/origin/main');
  return root;
};

const handleRequest = async (request) => {
  if (request.command === 'inspect') {
    const payload = readBackup(request.backupPath);
    return { works: payload.collections.works.length, clients: payload.collections.clients.length,
      organizations: payload.collections.organizations.map((item) => ({ id: id(item._id), name: item.name || '' })),
      backupHash: hash(readFileSync(request.backupPath)) };
  }
  if (request.command === 'preview') return previewReconciliation(request);
  if (request.command === 'apply') return applyReconciliation(request);
  if (request.command === 'publish') {
    if (!request.password) throw new Error('Введите пароль статичного сайта.');
    const repoDir = ensureRepository(request.repoDir);
    const messages = [];
    const result = await publishBackup({ repoDir, backupPath: request.backupPath, password: request.password, log: (message) => messages.push(message) });
    return { ...result, messages };
  }
  throw new Error('Неизвестная команда.');
};

if (require.main === module) {
  global.console = new (require('node:console').Console)({ stdout: process.stderr, stderr: process.stderr });
  Promise.resolve().then(() => handleRequest(JSON.parse(readFileSync(0, 'utf8'))))
    .then((result) => process.stdout.write(JSON.stringify({ ok: true, result })))
    .catch((error) => {
      process.stdout.write(JSON.stringify({ ok: false, error: error.message }));
      process.exitCode = 1;
    });
}

module.exports = { handleRequest };
