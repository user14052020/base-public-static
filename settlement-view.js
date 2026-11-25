(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./settlement.js'), require('./settlement-document.js'));
  else root.OffersSettlementView = factory(root.OffersSettlement, root.OffersSettlementDocument);
})(globalThis, (settlement, documents) => {
  const create = (deps) => {
    const { html, formatMoney, displayDate, paymentDateText } = deps;
    const today = deps.today();
    const state = { organizationId: '', clientId: '', dateFrom: `${today.slice(0, 4)}-01-01`, dateTo: today,
      number: '', date: today, contract: '', manualOpening: false, openingAmount: '0', openingSide: 'organization', mirror: false };
    const build = (clientId, manual = false) => {
      if (manual && state.manualOpening && (!String(state.openingAmount).trim() || !Number.isFinite(Number(state.openingAmount)) || Number(state.openingAmount) < 0)) throw new Error('Укажите неотрицательную сумму начального сальдо');
      return settlement.buildStatement({ works: deps.getDb().works,
        organizationId: state.organizationId, clientId, dateFrom: state.dateFrom, dateTo: state.dateTo,
        openingBalance: manual && state.manualOpening ? (state.openingSide === 'organization' ? 1 : -1) * Number(state.openingAmount) : null });
    };
    const balanceText = (value) => value > 0 ? `Клиент должен ${formatMoney(value)}` : value < 0 ? `Мы должны ${formatMoney(-value)}` : 'Расчеты закрыты';
    const metrics = (items) => `<div class="settlement-metrics">${items.map(([label, value]) => `<div><span class="muted">${label}</span><strong>${html(value)}</strong></div>`).join('')}</div>`;
    const renderResults = () => {
      if (!state.organizationId) return '';
      try {
        settlement.validatePeriod(state.dateFrom, state.dateTo);
        if (!state.clientId) {
          const clients = [...deps.getDb().clients].sort((a, b) => a.name.localeCompare(b.name, 'ru'));
          const reports = clients.filter((client) => deps.getDb().works.some((work) => work.clientId === client._id && work.executorOrganizationId === state.organizationId && work.source !== 'kwork'))
            .map((client) => ({ client, report: build(client._id) }));
          const sum = (select) => reports.reduce((total, item) => total + Math.round(select(item.report) * 100), 0) / 100;
          return `${metrics([['Сумма УПД', formatMoney(sum((r) => r.totalUpd))], ['Поступило платежей', formatMoney(sum((r) => r.totalPaid))],
            ['Долг клиентов', formatMoney(sum((r) => Math.max(0, r.closingBalance)))], ['Наш долг / авансы', formatMoney(sum((r) => Math.max(0, -r.closingBalance)))]])}
            <div class="table-wrap"><table class="settlement-table"><thead><tr><th>Клиент</th><th>Сальдо на начало</th><th>Сумма УПД</th><th>Поступило</th><th>Сальдо на конец</th><th>Данные</th><th></th></tr></thead>
              <tbody>${reports.map(({ client, report }) => `<tr><td>${html(client.name)}</td><td class="numeric">${formatMoney(report.openingBalance)}</td><td class="numeric">${formatMoney(report.totalUpd)}</td><td class="numeric">${formatMoney(report.totalPaid)}</td><td>${html(balanceText(report.closingBalance))}</td><td>${report.warnings.length ? `Замечаний: ${report.warnings.length}` : 'Без замечаний'}</td><td><button class="secondary" data-action="settlement-client" data-id="${html(client._id)}">Акт сверки</button></td></tr>`).join('')}</tbody></table></div>
            ${reports.length ? '' : '<p class="muted">Нет работ по выбранной организации.</p>'}`;
        }
        const report = build(state.clientId, true);
        return `${metrics([['Сальдо на начало', formatMoney(report.openingBalance)], ['Сумма УПД', formatMoney(report.totalUpd)], ['Поступило платежей', formatMoney(report.totalPaid)], ['Сальдо на конец', formatMoney(report.closingBalance)]])}
          <p class="settlement-balance" role="status">${html(balanceText(report.closingBalance))}</p>
          ${report.excludedKwork ? `<p class="muted">Работ Kwork без УПД: ${report.excludedKwork}. В сверку по документам не включены.</p>` : ''}
          ${report.warnings.length ? `<section class="settlement-warnings"><h3>Замечания к данным</h3><ul>${report.warnings.map((warning) => `<li>${html(warning.message)} <button class="secondary" data-action="edit-work" data-id="${html(warning.workId)}">Исправить</button></li>`).join('')}</ul></section>` : ''}
          <div class="row"><button data-action="print-settlement" ${report.warnings.length ? 'disabled' : ''}>Скачать акт сверки PDF</button></div>
          <div class="table-wrap"><table class="settlement-table"><thead><tr><th>Дата</th><th>Документ</th><th>УПД / дебет</th><th>Платеж / кредит</th><th>Сальдо</th></tr></thead>
            <tbody><tr><td></td><td>Сальдо начальное</td><td></td><td></td><td class="numeric">${formatMoney(report.openingBalance)}</td></tr>
              ${report.rows.map((row) => `<tr><td>${html(paymentDateText(row.date))}</td><td>${row.type === 'upd' ? 'УПД' : 'Оплата'}${row.number ? ` № ${html(row.number)}` : ''} от ${html(displayDate(row.date))}</td><td class="numeric">${row.debit ? formatMoney(row.debit) : ''}</td><td class="numeric">${row.credit ? formatMoney(row.credit) : ''}</td><td class="numeric">${formatMoney(row.balance)}</td></tr>`).join('')}
              <tr class="settlement-total"><td></td><td>Обороты за период</td><td class="numeric">${formatMoney(report.totalUpd)}</td><td class="numeric">${formatMoney(report.totalPaid)}</td><td></td></tr>
              <tr class="settlement-total"><td></td><td>Сальдо конечное</td><td></td><td></td><td class="numeric">${formatMoney(report.closingBalance)}</td></tr>
            </tbody></table></div>`;
      } catch (error) { return `<p class="message error" role="alert">${html(error.message)}</p>`; }
    };
    const render = () => {
      const db = deps.getDb();
      if (!db.organizations.some((item) => item._id === state.organizationId)) state.organizationId = db.organizations[0]?._id || '';
      if (state.clientId && !db.clients.some((item) => item._id === state.clientId)) { state.clientId = ''; state.contract = ''; state.manualOpening = false; }
      return `<section class="browser-section stack"><h2>Акт сверки взаиморасчетов</h2>
        <div class="settlement-controls">
          <label>Организация<select data-settlement-input="organizationId">${db.organizations.map((item) => `<option value="${html(item._id)}" ${item._id === state.organizationId ? 'selected' : ''}>${html(item.name)}</option>`).join('')}</select></label>
          <label>Клиент<select data-settlement-input="clientId"><option value="">Все клиенты</option>${[...db.clients].sort((a, b) => a.name.localeCompare(b.name, 'ru')).map((item) => `<option value="${html(item._id)}" ${item._id === state.clientId ? 'selected' : ''}>${html(item.name)}</option>`).join('')}</select></label>
          <label>Период с<input type="date" data-settlement-input="dateFrom" value="${html(state.dateFrom)}" max="${html(state.dateTo)}" /></label>
          <label>Период по<input type="date" data-settlement-input="dateTo" value="${html(state.dateTo)}" min="${html(state.dateFrom)}" /></label>
        </div>
        ${state.clientId ? `<div class="settlement-controls">
          <label>Номер акта<input data-settlement-input="number" value="${html(state.number)}" /></label>
          <label>Дата акта<input type="date" data-settlement-input="date" value="${html(state.date)}" /></label>
          <label class="switch"><input type="checkbox" data-settlement-input="manualOpening" ${state.manualOpening ? 'checked' : ''} /> Начальное сальдо вручную</label>
          <label class="switch"><input type="checkbox" data-settlement-input="mirror" ${state.mirror ? 'checked' : ''} /> Заполнить сторону клиента</label>
        </div><label>Договор для печати<input data-settlement-input="contract" value="${html(state.contract)}" /></label>${state.manualOpening ? `<div class="grid two"><label>Сальдо на начало<input type="number" min="0" step="0.01" data-settlement-input="openingAmount" value="${html(state.openingAmount)}" /></label><label>В пользу<select data-settlement-input="openingSide"><option value="organization" ${state.openingSide === 'organization' ? 'selected' : ''}>Нашей организации</option><option value="client" ${state.openingSide === 'client' ? 'selected' : ''}>Клиента</option></select></label></div>` : ''}` : ''}
        </section><section class="browser-section stack" data-settlement-results>${renderResults()}</section>`;
    };
    const handleInput = (target) => {
      const key = target.dataset?.settlementInput;
      if (!['number', 'contract', 'openingAmount'].includes(key)) return false;
      state[key] = target.value;
      if (key === 'openingAmount') {
        const result = deps.document?.querySelector('[data-settlement-results]');
        if (result) result.innerHTML = renderResults();
      }
      return true;
    };
    const handleChange = (target) => {
      const key = target.dataset?.settlementInput;
      if (!Object.hasOwn(state, key)) return false;
      if (['number', 'contract', 'openingAmount'].includes(key)) return handleInput(target);
      if (key === 'manualOpening' && target.checked) {
        try { const report = build(state.clientId); state.openingAmount = String(Math.abs(report.automaticOpening)); state.openingSide = report.automaticOpening < 0 ? 'client' : 'organization'; } catch { state.openingAmount = '0'; }
      }
      state[key] = ['manualOpening', 'mirror'].includes(key) ? target.checked : target.value;
      if (['organizationId', 'clientId', 'dateFrom', 'dateTo'].includes(key)) state.manualOpening = false;
      if (['organizationId', 'clientId'].includes(key)) state.contract = '';
      if (['date', 'mirror'].includes(key)) return true;
      deps.render();
      return true;
    };
    const handleAction = (action, target) => {
      if (action === 'settlement-client') { state.clientId = target.dataset.id; state.contract = ''; state.manualOpening = false; deps.render(); return true; }
      if (action !== 'print-settlement') return false;
      settlement.validatePeriod(state.date, state.date);
      const db = deps.getDb();
      const organization = db.organizations.find((item) => item._id === state.organizationId);
      const client = db.clients.find((item) => item._id === state.clientId);
      if (!organization || !client) throw new Error('Выберите организацию и клиента');
      deps.openDocument(documents.buildDocument({ report: build(state.clientId, true), organization, client, number: state.number, date: state.date, contract: state.contract, mirror: state.mirror }, deps));
      return true;
    };
    return { render, handleInput, handleChange, handleAction };
  };
  return { create };
});
