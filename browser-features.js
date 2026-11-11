(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./seed-codec.js'), require('./bank-reconciliation.js'), require('./github-publisher.js'), require('./xlsx.full.min.js'));
  else root.OffersBrowserFeatures = factory(root.OffersSeedCodec, root.OffersBankReconciliation, root.OffersGithubPublisher, root.XLSX);
})(globalThis, (codec, reconciliation, github, XLSX) => {
  const preferencesKey = 'offers-base-github-preferences-v1';
  const create = (deps) => {
    const { html, formatMoney, paymentDateText } = deps;
    const publisher = deps.publisher || github.createPublisher();
    let preferences = { authorName: '', authorEmail: '' };
    try {
      const stored = JSON.parse(deps.storage.getItem?.(preferencesKey) || '{}');
      preferences = { authorName: String(stored.authorName || ''), authorEmail: String(stored.authorEmail || '') };
    } catch { /* A malformed optional preference must not block the accounting app. */ }
    const bank = { file: null, organizationId: '', preview: null, rows: [], baseHash: '', busy: false, filter: 'pending', sequence: 0, lastResult: '' };
    const publication = { preferences, token: '', password: '', snapshot: null, allowReplace: false, busy: false, status: '', commitUrl: '' };
    const clearSecrets = () => {
      publication.token = ''; publication.password = ''; publication.snapshot = null; publication.allowReplace = false;
      publication.status = ''; publication.commitUrl = '';
      for (const input of deps.document?.querySelectorAll?.('[data-input="github-token"], [data-input="github-password"]') || []) input.value = '';
    };
    const updateProgress = (message) => {
      publication.status = message;
      const status = deps.document?.querySelector('[data-github-status]');
      if (status) status.textContent = message;
    };
    const renderPayments = () => {
      const organizations = deps.getDb().organizations;
      if (!bank.organizationId && organizations.length === 1) bank.organizationId = organizations[0]._id;
      const selected = bank.rows.filter((row) => row.include);
      const visible = bank.rows.filter((row) => bank.filter === 'all' || bank.filter === 'selected' && row.include
        || bank.filter === 'unmatched' && row.canSelect && (!row.workId || !row.include) || bank.filter === 'pending' && row.canSelect);
      return `<section class="browser-section stack">
        <div class="row between"><h2>Платежи</h2><button class="secondary" data-action="export-backup">Скачать бекап</button></div>
        <fieldset class="feature-controls stack" ${bank.busy ? 'disabled' : ''}>
          <div class="grid two">
            <label>Выписка банка<input type="file" accept=".xlsx,.xls" data-input="bank-file"/><span class="muted">${html(bank.file?.name || '')}</span></label>
            <label>Организация<select data-input="bank-organization"><option value="">Выберите организацию</option>${organizations.map((item) => `<option value="${html(item._id)}" ${item._id === bank.organizationId ? 'selected' : ''}>${html(item.name)}</option>`).join('')}</select></label>
          </div>
          <div class="row"><button data-action="bank-preview" ${!bank.file || !bank.organizationId ? 'disabled' : ''}>${bank.busy ? 'Обработка...' : 'Сопоставить'}</button>
            <button data-action="bank-apply" ${!selected.length ? 'disabled' : ''}>Применить платежи</button>
            <span role="status" data-bank-summary>${bank.preview ? `Строк: ${bank.preview.totalRows}. Входящих: ${bank.preview.incomingRows}. Доступно: ${bank.preview.availableRows}. Выбрано: ${selected.length}` : html(bank.lastResult)}</span>
          </div>
        </fieldset>
      </section>
      ${bank.preview ? `<section class="browser-section stack">
        <div class="row between">
          <label>Показать<select data-input="bank-filter">${[['pending', 'Входящие'], ['unmatched', 'Требуют проверки'], ['selected', 'Выбранные'], ['all', 'Все строки']].map(([value, label]) => `<option value="${value}" ${bank.filter === value ? 'selected' : ''}>${label}</option>`).join('')}</select></label>
          <div class="row"><button class="secondary" data-action="bank-select-matches">Выбрать совпадения</button><button class="secondary" data-action="bank-clear-selection">Снять выбор</button></div>
        </div>
        <div class="table-wrap bank-table-wrap"><table class="bank-table">
          <thead><tr><th>Выбор</th><th>Дата платежа</th><th>Сумма, ₽</th><th>Распределить, ₽</th><th>Плательщик</th><th>Счет</th><th>Результат</th><th>Назначение</th><th></th></tr></thead>
          <tbody>${visible.map((row) => `<tr data-bank-key="${row.key}">
            <td><input type="checkbox" data-bank-field="include" aria-label="Выбрать платеж" ${row.include ? 'checked' : ''} ${!row.canSelect ? 'disabled' : ''}/></td>
            <td>${html(paymentDateText(row.date))}</td><td class="numeric">${formatMoney(row.amount)}</td>
            <td><input class="bank-share" type="number" min="0.01" step="0.01" data-bank-field="allocationAmount" value="${html(row.allocationAmount)}" ${!row.canSelect ? 'disabled' : ''} aria-label="Сумма распределения"/></td>
            <td>${html(row.payer)}${row.payerInn ? `<br><small class="muted">ИНН ${html(row.payerInn)}</small>` : ''}</td>
            <td><select class="bank-invoice" data-bank-field="workId" aria-label="Счет для платежа" ${!row.canSelect ? 'disabled' : ''}>
              <option value="">Не привязан</option>${bank.preview.invoices.filter((invoice) => !(row.payerInn && invoice.clientInn && row.payerInn !== invoice.clientInn)).map((invoice) => `<option value="${html(invoice.id)}" ${invoice.id === row.workId ? 'selected' : ''}>${html(invoice.label)}</option>`).join('')}
            </select></td><td>${html(row.reason)}</td><td class="bank-purpose">${html(row.purpose)}</td>
            <td><button class="secondary" data-action="bank-split" data-bank-key="${row.key}" title="Разделить платеж" aria-label="Разделить платеж" ${!row.canSelect ? 'disabled' : ''}>+</button>
              ${row.clone ? `<button class="danger" data-action="bank-remove" data-bank-key="${row.key}" title="Удалить распределение" aria-label="Удалить распределение">×</button>` : ''}</td>
          </tr>`).join('') || '<tr><td colspan="9">Нет строк для выбранного фильтра</td></tr>'}</tbody>
        </table></div>
      </section>` : ''}`;
    };
    const renderGithub = () => {
      const db = deps.getDb();
      return `<section class="browser-section stack">
        <h2>Публикация в GitHub</h2>
        <fieldset class="feature-controls stack" ${publication.busy ? 'disabled' : ''}>
          <div class="grid two">
            <label>Репозиторий<input readonly value="https://github.com/${github.repository}"/></label>
            <label>Ветка<input readonly value="${github.branch}"/></label>
            <label>Имя автора<input data-input="github-author-name" autocomplete="name" value="${html(publication.preferences.authorName)}"/></label>
            <label>Email автора<input data-input="github-author-email" type="email" autocomplete="email" value="${html(publication.preferences.authorEmail)}"/></label>
            <label>Токен GitHub<input data-input="github-token" type="password" autocomplete="off" spellcheck="false" value="${html(publication.token)}"/></label>
            ${deps.getPassword() ? '' : `<label>Пароль сайта<input data-input="github-password" type="password" autocomplete="current-password" value="${html(publication.password)}"/></label>`}
          </div>
          <div class="row"><a href="https://github.com/settings/personal-access-tokens/new?name=Offers%20Base&amp;target_name=user14052020&amp;contents=write&amp;expires_in=30" target="_blank" rel="noopener noreferrer">Создать токен</a>
            <button class="secondary" data-action="github-clear-token" ${!publication.token ? 'disabled' : ''}>Очистить токен</button>
            <span class="muted">${db.meta?.localChanges ? 'Есть неопубликованные изменения' : 'Локальная база сохранена'}</span></div>
          ${publication.snapshot ? `<div class="sync-summary">В GitHub: ${publication.snapshot.works} работ, ${publication.snapshot.clients} клиентов. Локально: ${db.works.length} работ, ${db.clients.length} клиентов.</div>` : ''}
          <label class="switch"><input data-input="github-replace" type="checkbox" ${publication.allowReplace ? 'checked' : ''}/> Подтверждаю замену опубликованной базы текущими данными</label>
          <div class="row"><button class="secondary" data-action="github-check">Проверить GitHub</button><button data-action="github-publish">Опубликовать изменения</button></div>
        </fieldset>
        <p class="feature-status" role="status" aria-live="polite" data-github-status>${html(publication.status)}</p>
        ${publication.commitUrl ? `<a href="${html(publication.commitUrl)}" target="_blank" rel="noopener noreferrer">Открыть коммит</a>` : ''}
      </section>`;
    };
    const createPreview = async () => {
      if (!bank.file) throw new Error('Выберите выгрузку банка');
      if (!bank.organizationId) throw new Error('Выберите организацию');
      bank.busy = true; deps.render();
      try {
        const payload = deps.exportPayload();
        const workbook = XLSX.read(await bank.file.arrayBuffer(), { type: 'array', cellDates: false, cellNF: true });
        const records = reconciliation.parseWorkbook(workbook, payload.collections, bank.organizationId);
        const payments = [];
        for (const { fingerprint, ...record } of records) payments.push({ ...record, paymentId: await codec.sha256(fingerprint) });
        bank.preview = reconciliation.preview({ collections: payload.collections, payments, organizationId: bank.organizationId });
        bank.rows = bank.preview.rows.map((row) => ({ ...row, key: ++bank.sequence, clone: false }));
        bank.baseHash = await codec.collectionsHash(payload);
        bank.lastResult = '';
      } finally { bank.busy = false; deps.render(); }
    };
    const applyPayments = async () => {
      if (bank.busy) return;
      if (!bank.preview) throw new Error('Сначала сопоставьте платежи');
      const sourceDb = deps.getDb();
      const updatedAt = sourceDb.meta?.updatedAt;
      const current = deps.exportPayload();
      if (await codec.collectionsHash(current) !== bank.baseHash || deps.getDb() !== sourceDb || sourceDb.meta?.updatedAt !== updatedAt) throw new Error('База изменилась после сопоставления. Повторите сопоставление.');
      const allocations = bank.rows.filter((row) => row.include).map((row) => ({ paymentId: row.paymentId, workId: row.workId, amount: row.allocationAmount }));
      const result = reconciliation.apply({ payload: current, preview: bank.preview, allocations });
      if (!deps.confirm(`Обновить ${result.updatedWorks} работ? Ручные суммы затронутых счетов будут заменены суммой связанных банковских платежей.`)) return;
      deps.replacePayload(result.payload, { ...deps.getDb().meta });
      deps.saveDb();
      bank.preview = null; bank.rows = [];
      bank.lastResult = `Применено платежей: ${result.appliedPayments}. Обновлено работ: ${result.updatedWorks}.`;
      deps.message(bank.lastResult);
    };
    const checkGithub = async () => {
      publication.busy = true; updateProgress('Проверка GitHub...'); deps.render();
      try {
        publication.snapshot = await publisher.inspect({ token: publication.token, password: deps.getPassword() || publication.password });
        updateProgress('Опубликованная база прочитана.');
      } catch (error) { updateProgress(error.message); throw error;
      } finally { publication.busy = false; deps.render(); }
    };
    const publishGithub = async () => {
      if (publication.busy) return;
      publication.busy = true; publication.commitUrl = ''; updateProgress('Подготовка публикации...'); deps.render();
      try {
        const identity = github.normalizeSettings(publication.preferences);
        const password = deps.getPassword() || publication.password;
        const sourceDb = deps.getDb();
        const payload = deps.exportPayload();
        const sourceHash = await codec.collectionsHash(payload);
        if (!publication.snapshot) publication.snapshot = await publisher.inspect({ token: publication.token, password });
        if (!deps.confirm('Опубликовать текущую базу в GitHub? Данные будут зашифрованы, в main будет создан коммит.')) return;
        const result = await publisher.publish({ token: publication.token, password, settings: identity, payload,
          snapshot: publication.snapshot, expectedRevision: sourceDb.meta?.seedRevision, allowReplace: publication.allowReplace, onProgress: updateProgress });
        if (deps.getDb() === sourceDb) {
          const unchanged = await codec.collectionsHash(deps.exportPayload()) === sourceHash;
          const previousRevision = deps.getSeed()?.revision;
          const previousRevisions = [...new Set([...(sourceDb.meta?.pendingPublication?.previousRevisions || []),
            sourceDb.meta?.pendingPublication?.previousRevision, previousRevision].filter(Boolean))];
          sourceDb.meta = { ...sourceDb.meta, seedRevision: result.revision, localChanges: !unchanged,
            pendingPublication: result.changed ? { revision: result.revision, previousRevision, previousRevisions } : null };
          deps.setSeed(result.packet);
          deps.saveDb(sourceDb, { markChanged: false });
        }
        publication.allowReplace = false; publication.snapshot = null; publication.commitUrl = result.commitUrl || '';
        updateProgress(result.changed ? `Коммит ${result.commit.slice(0, 8)} создан. GitHub Pages публикует изменения.` : 'Эти данные уже опубликованы.');
      } catch (error) { updateProgress(error.message); throw error;
      } finally { publication.busy = false; deps.render(); }
    };
    const handleInput = (target) => {
      const key = target.dataset?.input;
      if (key === 'github-token' || key === 'github-password') {
        publication[key === 'github-token' ? 'token' : 'password'] = target.value;
        publication.snapshot = null;
        const clearButton = deps.document?.querySelector('[data-action="github-clear-token"]');
        if (clearButton) clearButton.disabled = !publication.token;
        return true;
      }
      if (key === 'github-author-name' || key === 'github-author-email') {
        publication.preferences[key === 'github-author-name' ? 'authorName' : 'authorEmail'] = target.value;
        deps.storage.setItem(preferencesKey, JSON.stringify({ authorName: publication.preferences.authorName, authorEmail: publication.preferences.authorEmail }));
        return true;
      }
      if (key === 'github-replace') { publication.allowReplace = target.checked; return true; }
      if (target.dataset?.bankField) {
        const row = bank.rows.find((item) => item.key === Number(target.closest('[data-bank-key]')?.dataset.bankKey));
        if (!row || !row.canSelect) return true;
        const field = target.dataset.bankField;
        if (field === 'include') row.include = target.checked;
        else if (field === 'allocationAmount') row.allocationAmount = target.value;
        else if (field === 'workId') {
          row.workId = target.value; row.include = Boolean(target.value);
          const checkbox = target.closest('tr')?.querySelector('[data-bank-field="include"]');
          if (checkbox) checkbox.checked = row.include;
        }
        const summary = deps.document?.querySelector('[data-bank-summary]');
        if (summary) summary.textContent = `Строк: ${bank.preview.totalRows}. Входящих: ${bank.preview.incomingRows}. Доступно: ${bank.preview.availableRows}. Выбрано: ${bank.rows.filter((item) => item.include).length}`;
        const applyButton = deps.document?.querySelector('[data-action="bank-apply"]');
        if (applyButton) applyButton.disabled = !bank.rows.some((item) => item.include);
        return true;
      }
      return false;
    };
    const handleChange = (target) => {
      const key = target.dataset?.input;
      if (key === 'bank-file') { bank.file = target.files?.[0] || null; bank.preview = null; bank.rows = []; deps.render(); return true; }
      if (key === 'bank-organization') { bank.organizationId = target.value; bank.preview = null; bank.rows = []; deps.render(); return true; }
      if (key === 'bank-filter') { bank.filter = target.value; deps.render(); return true; }
      return false;
    };
    const handleAction = async (action, target) => {
      if (action === 'bank-preview') { await createPreview(); return true; }
      if (action === 'bank-apply') { await applyPayments(); return true; }
      if (action === 'bank-select-matches' || action === 'bank-clear-selection') {
        for (const row of bank.rows) row.include = action === 'bank-select-matches' && !row.clone && Boolean(bank.preview.rows.find((original) => original.paymentId === row.paymentId)?.include);
        deps.render(); return true;
      }
      if (action === 'bank-split' || action === 'bank-remove') {
        const row = bank.rows.find((item) => item.key === Number(target.dataset.bankKey));
        if (row?.canSelect && action === 'bank-split') bank.rows.splice(bank.rows.indexOf(row) + 1, 0, { ...row, key: ++bank.sequence, clone: true, include: false, workId: '', allocationAmount: '', reason: 'Часть платежа' });
        if (row?.clone && action === 'bank-remove') bank.rows = bank.rows.filter((item) => item !== row);
        deps.render(); return true;
      }
      if (action === 'github-check') { await checkGithub(); return true; }
      if (action === 'github-publish') { await publishGithub(); return true; }
      if (action === 'github-clear-token') { clearSecrets(); deps.render(); return true; }
      return false;
    };
    return { renderPayments, renderGithub, handleInput, handleChange, handleAction, clearSecrets };
  };
  return { create };
});
