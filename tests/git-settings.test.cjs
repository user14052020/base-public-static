const { strict: assert } = require('node:assert');
const { execFileSync } = require('node:child_process');
const { mkdtempSync, mkdirSync, readFileSync, rmSync, realpathSync } = require('node:fs');
const { join, basename, dirname } = require('node:path');
const { tmpdir } = require('node:os');
const { test } = require('node:test');
const { normalizeRepositoryUrl, validateIdentity, gitConnectionOptions, readGitSettings, configureIdentity } = require('../scripts/lib/git-settings.cjs');

test('only the intended HTTPS or SSH repository is accepted; embedded credentials are rejected', () => {
  assert.equal(normalizeRepositoryUrl('https://github.com/user14052020/base-public-static'), 'https://github.com/user14052020/base-public-static.git');
  assert.equal(normalizeRepositoryUrl('git@github.com:user14052020/base-public-static.git'), 'git@github.com:user14052020/base-public-static.git');
  for (const url of ['http://github.com/user14052020/base-public-static.git', 'https://token@github.com/user14052020/base-public-static.git',
    'https://github.com.evil.test/user14052020/base-public-static.git', 'https://github.com/other/repo.git']) assert.throws(() => normalizeRepositoryUrl(url));
});

test('HTTPS uses GCM with the Windows credential store, not plaintext or app-managed tokens', () => {
  const options = gitConnectionOptions({ githubLogin: 'test-user' }, { GCM_INTERACTIVE: 'false', CUSTOM: 'preserve' });
  assert.equal(options.https, true);
  assert.ok(options.args.includes('credential.helper='));
  assert.ok(options.args.includes('credential.helper=manager'));
  assert.ok(options.args.includes('credential.username=test-user'));
  assert.equal(options.env.GCM_INTERACTIVE, 'true');
  assert.equal(options.env.GCM_CREDENTIAL_STORE, 'wincredman');
  assert.equal(options.env.CUSTOM, 'preserve');
  assert.equal(gitConnectionOptions({ repositoryUrl: 'git@github.com:user14052020/base-public-static.git' }).args.length, 0);
});

test('missing or invalid author fields fail before configuration changes', () => {
  assert.throws(() => validateIdentity({ authorName: '', authorEmail: '' }), /имя и email/);
  assert.throws(() => validateIdentity({ authorName: 'Name\nOther', authorEmail: 'author@example.test' }));
  assert.throws(() => validateIdentity({ authorName: 'Name', authorEmail: 'not-an-email' }));
  assert.deepEqual(validateIdentity({ authorName: ' Test Author ', authorEmail: 'author@example.test' }), { authorName: 'Test Author', authorEmail: 'author@example.test' });
});

test('author settings are applied to this repository only and can be read again', (t) => {
  const parent = realpathSync(tmpdir());
  const dir = mkdtempSync(join(parent, 'offers-git-settings-test-'));
  t.after(() => {
    if (dirname(dir) !== parent || !basename(dir).startsWith('offers-git-settings-test-')) throw new Error('Unsafe cleanup target');
    rmSync(dir, { recursive: true, force: true });
  });
  const repo = join(dir, 'repo'); mkdirSync(repo);
  const global = join(dir, 'global.gitconfig');
  const env = { ...process.env, GIT_CONFIG_GLOBAL: global, GIT_CONFIG_NOSYSTEM: '1' };
  const git = (args, options = {}) => execFileSync('git', args, { cwd: repo, env, encoding: 'utf8', stdio: 'pipe', ...options }).trim();
  git(['init', '--initial-branch=main']);
  git(['config', '--global', 'user.name', 'Global Author']);
  git(['config', '--global', 'user.email', 'global@example.test']);
  const before = readFileSync(global, 'utf8');
  configureIdentity(repo, { authorName: 'Local Author', authorEmail: 'local@example.test' }, (args, options) => git(args, options));
  assert.deepEqual(readGitSettings(repo, env), { authorName: 'Local Author', authorEmail: 'local@example.test' });
  assert.equal(readFileSync(global, 'utf8'), before);
  assert.equal(git(['status', '--porcelain']), '');
});
