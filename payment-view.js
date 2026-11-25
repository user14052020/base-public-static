(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./payment-ledger.js'), require('./work-payments.js'), require('./work-amounts.js'));
  else root.OffersPaymentView = factory(root.OffersPaymentLedger, root.OffersWorkPayments, root.OffersWorkAmounts);
})(globalThis, (ledger, dates, amounts) => {
  const create = (deps) => {
    const { html, formatMoney, paymentDateText } = deps;
    let editingId = null;
    let clientFilter = '';
    const options = (items, selected, empty) => `<option value="">${empty}</option>${items.map((item) => `<option value="${html(item._id)}" ${item._id === selected ? 'selected' : ''}>${html(item.name)}</option>`).join('')}`;
    const workOptions = (clientId, organizationId, selected = '') => `<option value="">Не распределено</option>${deps.getDb().works.filter((work) => work.source !== 'kwork' && work.clientId === clientId && work.executorOrganizationId === organizationId)
      .map((work) => `<option value="${html(work._id)}" ${selected === work._id ? 'selected' : ''}>${html(`Счет ${work.invoiceNumber || 'без номера'} · ${work.items.map((item) => item.name).join('; ')} · заказ ${formatMoney(amounts.getOrderAmount(work))}`)}</option>`).join('')}`;
    const allocationRow = (entry, clientId, organizationId) => `<div class="payment-allocation-row" data-payment-allocation-row>
      <label>Работа<select name="allocatedWorkId">${workOptions(clientId, organizationId, entry.workId)}</select></label>
      <label>Сумма<input name="allocatedAmount" type="number" min="0.01" step="0.01" value="${html(entry.amount ?? '')}" /></label>
      <label>Назначение<select name="allocationKind"><option value="payment">Оплата</option><option value="advance" ${entry.kind === 'advance' ? 'selected' : ''}>Аванс</option></select></label>
      <button type="button" class="danger" data-action="remove-payment-share">Удалить</button></div>`;
    const renderForm = () => {
      if (editingId === null) return '';
      const db = deps.getDb();
      const payment = db.payments.find((item) => item._id === editingId) || { _id: '', source: 'manual', organizationId: db.organizations[0]?._id || '', clientId: clientFilter, amount: '', date: '', contract: '', documentNumber: '', purpose: '' };
      const entries = db.paymentAllocations.filter((entry) => entry.paymentId === payment._id);
      return `<section class="browser-section stack"><div class="row between"><h2>${payment._id ? 'Редактирование платежа' : 'Новый платеж'}</h2><button class="secondary" data-action="cancel-payment">Закрыть</button></div>
        <form class="stack" data-form="payment"><input name="paymentId" type="hidden" value="${html(payment._id)}" />
          <div class="grid two"><label>Организация<select name="paymentOrganizationId" required>${options(db.organizations, payment.organizationId, 'Выберите организацию')}</select></label>
          <label>Клиент<select name="paymentClientId" required>${options(db.clients, payment.clientId, 'Выберите клиента')}</select></label>
          <label>Дата платежа<input name="receiptDate" required placeholder="ДД.ММ.ГГГГ ЧЧ:ММ:СС" value="${html(paymentDateText(payment.date))}" /></label>
          <label>Сумма платежа<input name="receiptAmount" type="number" required min="0.01" step="0.01" value="${html(payment.amount)}" ${payment.source === 'bank' && payment.amountKnown ? 'readonly' : ''} /></label>
          <label>Номер платежного документа<input name="receiptNumber" value="${html(payment.documentNumber || '')}" /></label>
          <label>Договор<input name="receiptContract" value="${html(payment.contract || '')}" /></label></div>
          <label>Назначение платежа<textarea name="receiptPurpose">${html(payment.purpose || '')}</textarea></label>
          ${payment.reviewStatus ? '<p class="message error">Сведения перенесены из старой карточки работы и требуют проверки. Сохранение подтверждает отдельное поступление.</p>' : ''}
          <div class="row between"><h3>Привязка к работам</h3><button type="button" class="secondary" data-action="add-payment-share">Добавить работу</button></div>
          <div class="stack" data-payment-shares>${entries.map((entry) => allocationRow(entry, payment.clientId, payment.organizationId)).join('')}</div>
          <p class="muted" role="status" data-payment-remainder>Не распределено: ${formatMoney(ledger.availableAmount(db, payment._id))}</p>
          <div class="row"><button type="submit">Сохранить платеж</button><button type="button" class="secondary" data-action="cancel-payment">Отмена</button></div>
        </form></section>`;
    };
    const render = () => {
      const db = deps.getDb();
      const payments = db.payments.filter((payment) => !clientFilter || payment.clientId === clientFilter).slice().sort((a, b) => (b.date || '').localeCompare(a.date || ''));
      return `<section class="browser-section stack"><div class="row between"><h2>Журнал платежей</h2><button data-action="new-payment">Новый платеж</button></div>
        <label class="payment-client-filter">Клиент<select data-payment-filter>${options(db.clients, clientFilter, 'Все клиенты')}</select></label></section>
        ${renderForm()}<section class="browser-section stack"><div class="table-wrap"><table class="payment-journal"><thead><tr><th>Дата</th><th>Клиент / договор</th><th>Документ</th><th>Сумма</th><th>Распределено</th><th>Остаток / аванс</th><th>Источник</th><th></th></tr></thead><tbody>
          ${payments.map((payment) => { const free = ledger.availableAmount(db, payment._id); return `<tr><td>${html(paymentDateText(payment.date) || 'Дата не указана')}</td><td>${html(db.clients.find((client) => client._id === payment.clientId)?.name || 'Не указан')}<br><small>${html(payment.contract || '')}</small></td><td>${html(payment.documentNumber || 'Без номера')}</td><td class="numeric">${formatMoney(payment.amount)}</td><td class="numeric">${formatMoney(payment.amount - free)}</td><td class="numeric">${formatMoney(free)}</td><td>${payment.source === 'bank' ? 'Банк' : 'Вручную'}${!ledger.active(payment) ? `<br><span class="payment-review">${payment.reviewStatus === 'possible-duplicate' ? 'Проверить повтор' : 'Требует проверки'}</span>` : ''}</td><td><div class="row"><button class="secondary" data-action="edit-payment" data-id="${html(payment._id)}">Редактировать</button><button class="danger" data-action="delete-payment" data-id="${html(payment._id)}">Удалить</button></div></td></tr>`; }).join('')}
          </tbody></table></div>${payments.length ? '' : '<p class="muted">Платежей нет.</p>'}</section>`;
    };
    const updateRemainder = (form) => {
      if (!form) return;
      const allocated = [...form.querySelectorAll('[name="allocatedAmount"]')].reduce((sum, input) => sum + Number(input.value || 0), 0);
      const result = form.querySelector('[data-payment-remainder]');
      if (result) result.textContent = `Не распределено: ${formatMoney(Number(form.receiptAmount.value || 0) - allocated)}`;
    };
    const handleInput = (target) => {
      if (!['receiptAmount', 'allocatedAmount'].includes(target.name)) return false;
      updateRemainder(target.closest('form')); return true;
    };
    const handleChange = (target) => {
      if (target.hasAttribute?.('data-payment-filter')) { clientFilter = target.value; editingId = null; deps.render(); return true; }
      if (!['paymentClientId', 'paymentOrganizationId'].includes(target.name)) return false;
      const form = target.closest('form');
      for (const input of form.querySelectorAll('[name="allocatedWorkId"]')) input.innerHTML = workOptions(form.paymentClientId.value, form.paymentOrganizationId.value, input.value);
      return true;
    };
    const handleSubmit = (form) => {
      if (form.dataset.form !== 'payment') return false;
      const db = deps.getDb(); const paymentId = form.paymentId.value || deps.uid();
      const previous = db.payments.find((payment) => payment._id === paymentId);
      if (!db.clients.some((client) => client._id === form.paymentClientId.value) || !db.organizations.some((org) => org._id === form.paymentOrganizationId.value)) throw new Error('Выберите клиента и организацию');
      if (previous?.source === 'bank' && previous.amountKnown && ledger.cents(previous.amount) !== ledger.cents(form.receiptAmount.value)) throw new Error('Сумму банковского платежа менять нельзя. Измените распределение.');
      const entries = [...form.querySelectorAll('[data-payment-allocation-row]')].map((row) => ({ workId: row.querySelector('[name="allocatedWorkId"]').value,
        amount: row.querySelector('[name="allocatedAmount"]').value, kind: row.querySelector('[name="allocationKind"]').value })).filter((entry) => entry.workId || entry.amount);
      const next = ledger.savePayment(db, { ...previous, _id: paymentId, source: previous?.source || 'manual', currency: previous?.currency || 'RUB',
        organizationId: form.paymentOrganizationId.value, clientId: form.paymentClientId.value, date: dates.paymentDateTime(form.receiptDate.value.trim()),
        amount: form.receiptAmount.value, documentNumber: form.receiptNumber.value.trim(), contract: form.receiptContract.value.trim(), purpose: form.receiptPurpose.value.trim() }, entries);
      deps.replaceCollections(next); deps.saveDb(); editingId = null; deps.message('Платеж сохранен'); return true;
    };
    const handleAction = (action, target) => {
      if (action === 'new-payment' || action === 'edit-payment') { editingId = action === 'new-payment' ? '' : target.dataset.id; deps.showView?.(); deps.render(); return true; }
      if (action === 'cancel-payment') { editingId = null; deps.render(); return true; }
      if (action === 'delete-payment') {
        if (deps.confirm('Удалить платеж из учета и снять его привязки к работам?')) { deps.replaceCollections(ledger.deletePayment(deps.getDb(), target.dataset.id)); deps.saveDb(); editingId = null; deps.render(); }
        return true;
      }
      if (action === 'add-payment-share') {
        const form = target.closest('form'); const row = deps.document.createElement('div');
        row.innerHTML = allocationRow({}, form.paymentClientId.value, form.paymentOrganizationId.value);
        form.querySelector('[data-payment-shares]').appendChild(row.firstElementChild); updateRemainder(form); return true;
      }
      if (action === 'remove-payment-share') { const form = target.closest('form'); target.closest('[data-payment-allocation-row]').remove(); updateRemainder(form); return true; }
      return false;
    };
    return { render, handleInput, handleChange, handleSubmit, handleAction };
  };
  return { create };
});
