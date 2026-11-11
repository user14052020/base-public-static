(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./seed-codec.js'));
  else root.OffersGithubPublisher = factory(root.OffersSeedCodec);
})(globalThis, (codec) => {
  const repository = 'user14052020/base-public-static';
  const branch = 'main';
  const normalizeSettings = (settings = {}) => {
    const authorName = String(settings.authorName || '').trim();
    const authorEmail = String(settings.authorEmail || '').trim();
    if ((authorName || authorEmail) && (!authorName || !/^[^\s<>@]+@[^\s<>@]+$/.test(authorEmail) || /[\x00-\x1f\x7f<>]/.test(authorName))) {
      throw new Error('Заполните имя и корректный email автора либо оставьте оба поля пустыми.');
    }
    return { authorName, authorEmail };
  };
  const failure = (message, code) => Object.assign(new Error(message), { code });
  const createPublisher = (fetchImpl = (...args) => fetch(...args)) => {
    const api = (token) => {
      const secret = String(token || '').trim();
      if (!secret) throw new Error('Введите токен GitHub');
      return async (method, path, body) => {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 30000);
        try {
          const response = await fetchImpl(`https://api.github.com/repos/${repository}${path}`, {
            method, headers: { Accept: 'application/vnd.github+json', Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json', 'X-GitHub-Api-Version': '2022-11-28' },
            body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', redirect: 'error', cache: 'no-store', signal: controller.signal
          });
          if (!response.ok) {
            if (response.status === 401) throw failure('Токен GitHub неверен или истек.', 'AUTH');
            if (response.status === 403) throw failure('Недостаточно прав или превышен лимит API. Нужен доступ Contents: Read and write к этому репозиторию.', 'ACCESS');
            if (method === 'PATCH' && [409, 422].includes(response.status)) throw failure('Ветка изменилась или защищена. Проверьте GitHub повторно; принудительная перезапись отключена.', 'CONFLICT');
            throw failure(`GitHub вернул ошибку ${response.status}. Данные в браузере сохранены.`, 'API');
          }
          return await response.json();
        } catch (error) {
          if (error.code) throw error;
          throw failure(error.name === 'AbortError' ? 'GitHub не ответил вовремя. Проверьте состояние публикации перед повторной попыткой.' : 'Не удалось связаться с GitHub. Проверьте подключение.', 'NETWORK');
        } finally { clearTimeout(timeout); }
      };
    };
    const readFile = async (request, path, ref) => {
      const file = await request('GET', `/contents/${path}?ref=${encodeURIComponent(ref)}`);
      const blob = file.encoding === 'base64' ? file : await request('GET', `/git/blobs/${file.sha}`);
      if (blob.encoding !== 'base64' || typeof blob.content !== 'string') throw new Error(`Не удалось прочитать ${path}`);
      return { sha: file.sha, text: codec.decodeText(blob.content) };
    };
    const inspect = async ({ token, password }) => {
      const request = api(token);
      const ref = await request('GET', `/git/ref/heads/${branch}`);
      const file = await readFile(request, 'seed-data.js', ref.object.sha);
      const packet = codec.parseScript(file.text);
      const payload = await codec.decrypt(packet, password);
      return { headSha: ref.object.sha, seedSha: file.sha, packet, payload, revision: await codec.revision(packet),
        works: payload.collections.works.length, clients: (payload.collections.clients || []).length };
    };
    const publish = async ({ token, password, settings, payload, snapshot, expectedRevision, allowReplace = false, onProgress = () => {} }) => {
      const identity = normalizeSettings(settings);
      for (const name of ['works', 'clients', 'organizations']) if (!Array.isArray(payload?.collections?.[name])) throw new Error(`В базе отсутствует коллекция ${name}`);
      onProgress('Проверка актуальности опубликованной базы...');
      const current = await inspect({ token, password });
      if (!snapshot || current.seedSha !== snapshot.seedSha) throw failure('После проверки база в GitHub изменилась. Повторите проверку перед публикацией.', 'CONFLICT');
      const same = await codec.collectionsHash(current.payload) === await codec.collectionsHash(payload);
      if (same) return { changed: false, revision: current.revision, packet: current.packet };
      if ((!expectedRevision || expectedRevision !== current.revision) && !allowReplace) {
        throw failure('Локальная копия отличается от опубликованной версии. Загрузите актуальные данные либо явно подтвердите замену.', 'STALE_BASE');
      }
      onProgress('Шифрование данных...');
      const packet = await codec.encrypt(payload, password, current.packet.iterations);
      if (await codec.collectionsHash(await codec.decrypt(packet, password)) !== await codec.collectionsHash(payload)) throw new Error('Проверка зашифрованного бекапа не пройдена');
      const request = api(token);
      const commit = await request('GET', `/git/commits/${current.headSha}`);
      const index = await readFile(request, 'index.html', current.headSha);
      let matches = 0;
      const updatedIndex = index.text.replace(/(<script\b[^>]*\bsrc=["']\.\/seed-data\.js)(?:\?[^"']*)?(["'])/g, (_, prefix, quote) => {
        matches += 1;
        return `${prefix}?v=${packet.revision}${quote}`;
      });
      if (matches !== 1) throw new Error('В index.html не найден единственный скрипт seed-data.js');
      onProgress('Создание коммита...');
      const files = [];
      for (const [path, content] of [['seed-data.js', codec.serialize(packet)], ['index.html', updatedIndex]]) {
        const blob = await request('POST', '/git/blobs', { content, encoding: 'utf-8' });
        files.push({ path, mode: '100644', type: 'blob', sha: blob.sha });
      }
      const tree = await request('POST', '/git/trees', { base_tree: commit.tree.sha, tree: files });
      const body = { message: `data: publish browser backup (${payload.collections.works.length} works)`, tree: tree.sha, parents: [current.headSha] };
      if (identity.authorName) body.author = { name: identity.authorName, email: identity.authorEmail };
      const created = await request('POST', '/git/commits', body);
      onProgress('Обновление main...');
      await request('PATCH', `/git/refs/heads/${branch}`, { sha: created.sha, force: false });
      return { changed: true, commit: created.sha, revision: packet.revision, packet, commitUrl: `https://github.com/${repository}/commit/${created.sha}` };
    };
    return { inspect, publish };
  };
  return { repository, branch, normalizeSettings, createPublisher };
});
