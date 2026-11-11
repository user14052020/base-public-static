'use strict';

const { execFileSync } = require('node:child_process');
const { existsSync } = require('node:fs');
const { join, resolve } = require('node:path');
const DEFAULT_REPOSITORY_URL = 'https://github.com/user14052020/base-public-static.git';

const normalizeRepositoryUrl = (value = DEFAULT_REPOSITORY_URL) => {
  const url = String(value).trim();
  if (/^https:\/\/github\.com\/user14052020\/base-public-static(?:\.git)?\/?$/i.test(url)) return DEFAULT_REPOSITORY_URL;
  if (/^(?:git@github\.com:|ssh:\/\/git@github\.com\/)user14052020\/base-public-static(?:\.git)?\/?$/i.test(url)) {
    return 'git@github.com:user14052020/base-public-static.git';
  }
  throw new Error('Укажите HTTPS или SSH URL репозитория user14052020/base-public-static без пароля и токена в адресе.');
};

const validateIdentity = ({ authorName, authorEmail }) => {
  const name = String(authorName || '').trim();
  const email = String(authorEmail || '').trim();
  if (!name || !email) throw new Error('Заполните имя и email автора на вкладке Публикация.');
  if (/[\x00-\x1f\x7f<>]/.test(name)) throw new Error('Имя автора не должно содержать переносы строк или угловые скобки.');
  if (!/^[^\s<>@]+@[^\s<>@]+$/.test(email)) throw new Error('Укажите корректный email автора.');
  return { authorName: name, authorEmail: email };
};

const gitConnectionOptions = ({ repositoryUrl, githubLogin = '' }, environment = process.env) => {
  const url = normalizeRepositoryUrl(repositoryUrl);
  const login = String(githubLogin).trim();
  if (login && !/^[a-z\d][a-z\d-]{0,38}$/i.test(login)) throw new Error('Укажите логин GitHub, не email.');
  const https = url.startsWith('https:');
  const args = https ? ['-c', 'credential.helper=', '-c', 'credential.helper=manager', '-c', 'credential.credentialStore=wincredman',
    '-c', 'credential.interactive=true', '-c', 'credential.guiPrompt=true', '-c', 'credential.gitHubAuthModes=browser'] : [];
  if (https && login) args.push('-c', `credential.username=${login}`);
  const env = { ...environment, GIT_TERMINAL_PROMPT: '0' };
  if (https) Object.assign(env, { GCM_INTERACTIVE: 'true', GCM_GUI_PROMPT: 'true', GCM_GITHUB_AUTHMODES: 'browser',
    GCM_CREDENTIAL_STORE: 'wincredman', GCM_TRACE_SECRETS: 'false' });
  else env.GIT_SSH_COMMAND ||= 'ssh -o BatchMode=yes -o ConnectTimeout=20';
  return { url, https, args, env };
};

const createGitClient = (settings) => {
  const options = gitConnectionOptions(settings);
  const run = (args, { cwd } = {}) => execFileSync('git', [...options.args, ...args], {
    cwd, env: options.env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
  }).trim();
  return { ...options, run };
};

const readGitSettings = (repoDir, environment = process.env) => {
  const cwd = repoDir && existsSync(join(resolve(repoDir), '.git')) ? resolve(repoDir) : undefined;
  const get = (key) => {
    try {
      return execFileSync('git', ['config', ...(cwd ? [] : ['--global']), '--get', key], {
        cwd, env: environment, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe']
      }).trim();
    } catch (error) {
      if (error.status === 1) return '';
      throw new Error('Не удалось прочитать настройки Git. Проверьте установку Git for Windows.');
    }
  };
  return { authorName: get('user.name'), authorEmail: get('user.email') };
};

const configureIdentity = (repoDir, settings, run = (args, options) => execFileSync('git', args, { ...options, encoding: 'utf8', stdio: 'pipe' }).trim()) => {
  const identity = validateIdentity(settings);
  run(['config', '--local', '--', 'user.name', identity.authorName], { cwd: repoDir });
  run(['config', '--local', '--', 'user.email', identity.authorEmail], { cwd: repoDir });
  return identity;
};

module.exports = { DEFAULT_REPOSITORY_URL, normalizeRepositoryUrl, validateIdentity, gitConnectionOptions, createGitClient, readGitSettings, configureIdentity };
