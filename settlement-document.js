(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.OffersSettlementDocument = factory();
})(globalThis, () => {
  const buildDocument = ({ report, organization, client, number = '', date, contract = '', mirror = false }, helpers) => {
    if (report.warnings.length) throw new Error('Исправьте замечания к данным перед печатью акта сверки');
    const { html, formatMoney, displayDate, amountToWords, personShortName, printableShell, sanitizeDocumentPart } = helpers;
    const seller = String(organization.name || '');
    const buyer = String(client.name || '');
    const label = (party) => `${party.name || ''}${party.inn ? ` (ИНН ${party.inn})` : ''}`;
    const money = (value) => value ? formatMoney(value) : '';
    const documentLabel = (row) => row.type === 'upd'
      ? `УПД${row.number ? ` № ${row.number}` : ''} от ${displayDate(row.date)}`
      : `Оплата${row.number ? ` № ${row.number}` : ''} от ${displayDate(row.date)}`;
    const balanceCells = (value, reverse = false) => {
      const amount = reverse ? -value : value;
      return `<td class="right">${money(Math.max(0, amount))}</td><td class="right">${money(Math.max(0, -amount))}</td>`;
    };
    const debt = () => report.closingBalance === 0 ? 'Задолженность отсутствует.'
      : `На ${displayDate(report.dateTo)} задолженность в пользу ${report.closingBalance > 0 ? html(seller) : html(buyer)} составляет ${formatMoney(Math.abs(report.closingBalance))} руб. (${html(amountToWords(Math.abs(report.closingBalance)))}).`;
    const pages = [];
    const pageSize = 18;
    const totalPages = Math.max(1, Math.ceil(report.rows.length / pageSize));
    for (let pageIndex = 0; pageIndex < totalPages; pageIndex++) {
      const rows = report.rows.slice(pageIndex * pageSize, (pageIndex + 1) * pageSize);
      const opening = pageIndex === 0 ? report.openingBalance : report.rows[pageIndex * pageSize - 1].balance;
      const closing = rows.at(-1)?.balance ?? opening;
      const last = pageIndex === totalPages - 1;
      const balanceLabel = pageIndex === 0 ? 'Сальдо начальное' : 'Сальдо перенесенное';
      pages.push(`<main class="doc-page settlement-document">
        <h1>Акт сверки взаимных расчетов${number ? ` № ${html(number)}` : ''}</h1>
        <p class="settlement-period">от ${displayDate(date)} за период ${displayDate(report.dateFrom)} - ${displayDate(report.dateTo)}</p>
        <p class="center">между ${html(label(organization))}<br>и ${html(label(client))}</p>
        ${contract ? `<p class="center">по договору ${html(contract)}</p>` : ''}
        ${pageIndex === 0 ? `<p class="settlement-intro">Настоящий акт составлен для сверки взаимных расчетов. По данным учета ${html(seller)} состояние расчетов следующее:</p>` : ''}
        <table class="settlement-print-table">
          <colgroup>${[10, 20, 10, 10, 10, 20, 10, 10].map((width) => `<col style="width:${width}%">`).join('')}</colgroup>
          <thead><tr><th colspan="4">По данным ${html(seller)}, руб.</th><th colspan="4">По данным ${html(buyer)}, руб.</th></tr>
            <tr>${['Дата', 'Документ', 'Дебет', 'Кредит', 'Дата', 'Документ', 'Дебет', 'Кредит'].map((text) => `<th>${text}</th>`).join('')}</tr></thead>
          <tbody>
            <tr class="bold"><td colspan="2">${balanceLabel}</td>${balanceCells(opening)}<td colspan="2">${balanceLabel}</td>${mirror ? balanceCells(opening, true) : '<td></td><td></td>'}</tr>
            ${rows.map((row) => `<tr><td>${displayDate(row.date)}</td><td>${html(documentLabel(row))}</td><td class="right">${money(row.debit)}</td><td class="right">${money(row.credit)}</td>
              ${mirror ? `<td>${displayDate(row.date)}</td><td>${html(documentLabel(row))}</td><td class="right">${money(row.credit)}</td><td class="right">${money(row.debit)}</td>` : '<td></td><td></td><td></td><td></td>'}</tr>`).join('')}
            ${last ? `<tr class="bold"><td colspan="2">Обороты за период</td><td class="right">${formatMoney(report.totalUpd)}</td><td class="right">${formatMoney(report.totalPaid)}</td><td colspan="2">Обороты за период</td>${mirror ? `<td class="right">${formatMoney(report.totalPaid)}</td><td class="right">${formatMoney(report.totalUpd)}</td>` : '<td></td><td></td>'}</tr>` : ''}
            <tr class="bold"><td colspan="2">${last ? 'Сальдо конечное' : 'Перенос'}</td>${balanceCells(closing)}<td colspan="2">${last ? 'Сальдо конечное' : 'Перенос'}</td>${mirror ? balanceCells(closing, true) : '<td></td><td></td>'}</tr>
          </tbody>
        </table>
        ${last ? `<div class="settlement-print-footer">
          <section><b>По данным ${html(seller)}</b><p>${debt()}</p></section>
          <section><b>По данным ${html(buyer)}</b>${mirror ? `<p>${debt()}</p>` : '<p class="settlement-counterpart-blank"></p>'}</section>
          <section><b>От ${html(seller)}</b><p class="settlement-signature">________________ / ${html(personShortName(organization.signerName || organization.shortName || (/^ИП\s/iu.test(seller) ? seller : '')))} /</p><p>М.П.</p></section>
          <section><b>От ${html(buyer)}</b><p class="settlement-signature">________________ / ${html(personShortName(client.signerName || ''))} /</p><p>М.П.</p></section>
        </div>` : ''}
        <div class="settlement-page-number">Лист ${pageIndex + 1} из ${totalPages}</div>
      </main>`);
    }
    const title = `акт-сверки${number ? `№${sanitizeDocumentPart(number)}` : ''}от${displayDate(date)}-${sanitizeDocumentPart(buyer)}`;
    return printableShell(title, pages.join(''), 'portrait', { pdf: true, styles: `
      .settlement-document { min-height:296.5mm; padding:10mm; font-size:9pt; line-height:1.2; }
      .settlement-document h1 { font-size:14pt; text-align:center; margin:0 0 2mm; }
      .settlement-period { text-align:center; margin-bottom:3mm; }
      .settlement-intro { margin:4mm 0; }
      .settlement-print-table { margin-top:4mm; }
      .settlement-print-table th, .settlement-print-table td { border:0.5px solid #111; padding:1.3mm 1mm; font-size:8pt; line-height:1.2; overflow-wrap:anywhere; vertical-align:middle; }
      .settlement-print-table th { font-size:8pt; }
      .settlement-print-footer { display:grid; grid-template-columns:repeat(2,minmax(0,1fr)); gap:7mm; margin-top:6mm; overflow-wrap:anywhere; }
      .settlement-print-footer p { margin-top:2mm; }
      .settlement-counterpart-blank { min-height:9mm; width:100%; border-bottom:0.5px solid #111; }
      .settlement-print-footer .settlement-signature { margin-top:10mm; }
      .settlement-page-number { position:absolute; bottom:7mm; right:10mm; font-size:8pt; }
    ` });
  };
  return { buildDocument };
});
