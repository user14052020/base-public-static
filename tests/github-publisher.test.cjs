const { strict: assert } = require('node:assert');
const { test } = require('node:test');
const codec = require('../seed-codec.js');
const { createPublisher, normalizeSettings } = require('../github-publisher.js');
const { decryptSeed } = require('../scripts/publish-backup.cjs');

const password = 'fixture site password';
const token = 'fixture-token-never-persist';
const payload = (amount = 100) => ({ meta: { createdAt: '2026-11-11T00:00:00.000Z' }, collections: {
  clients: [{ _id: { $oid: 'a'.repeat(24) }, name: 'Private client', inn: '0012345678', bankAccount: '00000000000000000001', custom: { keep: true } }],
  organizations: [{ _id: 'org', name: 'Seller' }], works: [{ _id: 'work', amount, creditedAmount: amount, paymentDate: '2026-11-11T13:45:16' }],
  files: [], users: [], sequences: [], 'uploads.files': [], 'uploads.chunks': [{ data: { $binary: 'aGVsbG8=', $type: '0' } }]
} });
const fixture = async () => {
  const requests = [];
  const remote = { head: 'a'.repeat(40), seedSha: 'b'.repeat(40), packet: await codec.encrypt(payload(), password, 100000),
    index: '<script src="./seed-data.js?v=old"></script><script src="./app.js?v=new-code"></script>', rejectPatch: false };
  const blobs = new Map(); let tree; let commit; let sequence = 1;
  const sha = () => (sequence++).toString(16).padStart(40, '0');
  const fetchImpl = async (url, options) => {
    assert.ok(url.startsWith('https://api.github.com/repos/user14052020/base-public-static/'));
    assert.equal(options.headers.Authorization, `Bearer ${token}`);
    assert.equal(options.credentials, 'omit');
    assert.equal(options.redirect, 'error');
    const path = url.split('/base-public-static')[1];
    const body = options.body ? JSON.parse(options.body) : undefined;
    requests.push({ path, method: options.method, body });
    const response = (value, status = 200) => ({ ok: status < 400, status, json: async () => value });
    if (path === '/git/ref/heads/main') return response({ object: { sha: remote.head } });
    if (path.startsWith('/contents/seed-data.js?')) return response({ sha: remote.seedSha, encoding: 'base64', content: Buffer.from(codec.serialize(remote.packet)).toString('base64') });
    if (path.startsWith('/contents/index.html?')) return response({ sha: 'c'.repeat(40), encoding: 'base64', content: Buffer.from(remote.index).toString('base64') });
    if (options.method === 'GET' && path.startsWith('/git/commits/')) return response({ tree: { sha: 'd'.repeat(40) } });
    if (path === '/git/blobs') { const key = sha(); blobs.set(key, body.content); return response({ sha: key }); }
    if (path === '/git/trees') { tree = body; return response({ sha: sha() }); }
    if (path === '/git/commits') { commit = body; return response({ sha: sha() }); }
    if (path === '/git/refs/heads/main') {
      assert.equal(body.force, false);
      if (remote.rejectPatch) return response({}, 422);
      remote.head = body.sha;
      remote.seedSha = tree.tree.find((file) => file.path === 'seed-data.js').sha;
      remote.packet = codec.parseScript(blobs.get(remote.seedSha));
      remote.index = blobs.get(tree.tree.find((file) => file.path === 'index.html').sha);
      return response({ object: { sha: remote.head } });
    }
    throw new Error(`Unexpected request ${options.method} ${path}`);
  };
  const publisher = createPublisher(fetchImpl);
  const inspect = () => publisher.inspect({ token, password });
  const publish = async (options = {}) => publisher.publish({ token, password, payload: payload(200), snapshot: await inspect(),
    expectedRevision: remote.packet.revision, settings: { authorName: 'Fixture Author', authorEmail: 'fixture@example.test' }, ...options });
  return { remote, requests, blobs, publisher, inspect, publish, getTree: () => tree, getCommit: () => commit };
};

test('browser codec preserves every requisite and remains compatible with the existing backup format', async () => {
  const original = payload(); original.collections.clients[0].largeNote = 'x'.repeat(120000);
  const packet = await codec.encrypt(original, password, 100000);
  assert.deepEqual(await codec.decrypt(codec.parseScript(codec.serialize(packet)), password), original);
  assert.deepEqual(decryptSeed(packet, password), original);
  assert.ok(!codec.serialize(packet).includes('Private client'));
  await assert.rejects(codec.decrypt(packet, 'wrong'));
  assert.throws(() => codec.parseScript('window.__OFFERS_SEED_ENCRYPTED__ = {}; alert(1);'));
});

test('publishing creates one atomic encrypted commit and preserves unrelated files', async () => {
  const f = await fixture();
  const result = await f.publish();
  assert.equal(result.changed, true);
  assert.equal(f.getTree().base_tree, 'd'.repeat(40));
  assert.deepEqual(f.getTree().tree.map((file) => file.path).sort(), ['index.html', 'seed-data.js']);
  assert.deepEqual(await codec.decrypt(f.remote.packet, password), payload(200));
  assert.ok(f.remote.index.includes(`?v=${result.revision}`));
  assert.ok(f.remote.index.includes('app.js?v=new-code'));
  assert.equal(f.getCommit().author.name, 'Fixture Author');
  assert.ok(!JSON.stringify(f.requests).includes(token));
  assert.ok(!f.blobs.get(f.remote.seedSha).includes('Private client'));
});

test('a change after preflight always blocks publishing without branch writes', async () => {
  const f = await fixture();
  const snapshot = await f.inspect();
  f.remote.seedSha = 'e'.repeat(40);
  await assert.rejects(f.publish({ snapshot, allowReplace: true }), (error) => error.code === 'CONFLICT');
  assert.equal(f.requests.filter((request) => request.method === 'POST' || request.method === 'PATCH').length, 0);
});

test('an outdated or unknown local baseline needs explicit replacement confirmation', async () => {
  const f = await fixture();
  await assert.rejects(f.publish({ expectedRevision: 'outdated' }), (error) => error.code === 'STALE_BASE');
  assert.equal(f.requests.filter((request) => request.method === 'POST').length, 0);
  assert.equal((await f.publish({ expectedRevision: undefined, allowReplace: true })).changed, true);
});

test('concurrent branch updates never trigger force push or an automatic overwrite', async () => {
  const f = await fixture();
  f.remote.rejectPatch = true;
  await assert.rejects(f.publish(), (error) => error.code === 'CONFLICT');
  assert.equal(f.remote.head, 'a'.repeat(40));
  assert.equal(f.requests.filter((request) => request.method === 'PATCH').length, 1);
});

test('unchanged data does not create a commit and optional authors use the token owner', async () => {
  const f = await fixture();
  assert.equal((await f.publish({ payload: { ...payload(), meta: { createdAt: 'later' } }, expectedRevision: undefined })).changed, false);
  assert.equal(f.requests.filter((request) => request.method === 'POST').length, 0);
  await f.publish({ settings: {} });
  assert.equal('author' in f.getCommit(), false);
  assert.deepEqual(normalizeSettings({ token, password }), { authorName: '', authorEmail: '' });
});

test('authorization and network failures do not disclose tokens or write data', async () => {
  const publisher = createPublisher(async () => ({ ok: false, status: 401, json: async () => ({}) }));
  await assert.rejects(publisher.inspect({ token, password }), (error) => error.code === 'AUTH' && !error.message.includes(token));
  const failed = createPublisher(async () => { throw new Error(token); });
  await assert.rejects(failed.inspect({ token, password }), (error) => error.code === 'NETWORK' && !error.message.includes(token));
});
