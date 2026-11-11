'use strict';

const { readFileSync, existsSync, mkdirSync, readdirSync } = require('node:fs');
const { resolve, dirname, join } = require('node:path');
const { readBackup, publishBackup } = require('./publish-backup.cjs');
const { previewReconciliation, applyReconciliation, id, hash } = require('./lib/bank-reconciliation.cjs');
const { normalizeRepositoryUrl, validateIdentity, createGitClient, readGitSettings, configureIdentity } = require('./lib/git-settings.cjs');

const ensureRepository = (directory, client) => {
  const root = resolve(directory);
  if (client.https) {
    try { client.run(['credential-manager', '--version']); }
    catch { throw new Error('Установите Git for Windows с компонентом Git Credential Manager.'); }
  }
  if (!existsSync(join(root, '.git'))) {
    if (existsSync(root) && readdirSync(root).length) throw new Error('Выбранная папка не является Git-репозиторием и не пуста.');
    mkdirSync(dirname(root), { recursive: true });
    client.run(['clone', '--branch', 'main', client.url, root]);
  }
  const git = (...args) => client.run(args, { cwd: root });
  const remote = git('remote', 'get-url', 'origin');
  normalizeRepositoryUrl(remote);
  if (git('branch', '--show-current') !== 'main') throw new Error('В папке репозитория должна быть выбрана ветка main.');
  if (git('status', '--porcelain')) throw new Error('В папке репозитория есть несохраненные изменения. Публикация отменена.');
  if (remote !== client.url) git('remote', 'set-url', 'origin', client.url);
  git('fetch', 'origin', 'main');
  git('merge', '--ff-only', 'refs/remotes/origin/main');
  return root;
};

const handleRequest = async (request) => {
  if (request.command === 'git-settings') return readGitSettings(request.repoDir);
  if (request.command === 'git-login') {
    const client = createGitClient(request);
    if (!client.https) throw new Error('Вход через Git Credential Manager используется с HTTPS URL.');
    client.run(['credential-manager', 'github', 'login', '--url', 'https://github.com', '--browser',
      ...(request.githubLogin ? ['--username', request.githubLogin] : [])]);
    return { message: 'Вход в GitHub выполнен.' };
  }
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
    const identity = validateIdentity(request);
    const client = createGitClient(request);
    const repoDir = ensureRepository(request.repoDir, client);
    configureIdentity(repoDir, identity, client.run);
    const messages = [];
    const result = await publishBackup({ repoDir, backupPath: request.backupPath, password: request.password,
      gitCommand: client.run, log: (message) => messages.push(message) });
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
