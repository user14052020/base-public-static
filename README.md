# Offers Base

Static accounting application at https://offers.maharram.ru, published from `main` on GitHub Pages.
No Windows client, local server, Git installation, or virtual machine is needed to use it.

## Work Filters And Reconciliation

Works can be filtered by client and an inclusive document-date interval, together with text search.
Changing or resetting filters updates only the results, preserving an open work editor.

The Reconciliation page shows each client's UPD turnover, actual payments, and opening/closing balances.
Every document work contributes its UPD amount, with the work total as the automatic default. Set the
UPD amount to zero for advance-only invoices that must not accrue a second delivery. Kwork entries do
not issue UPD and are excluded from this document-based reconciliation.

The payment journal is the single source of receipts. Each receipt is counted once, independently
of its work allocations. Unallocated client advances are included too. Undated receipts and ambiguous
legacy payment fields are flagged for review; PDF output is blocked until these issues are corrected. Opening balance is
calculated from earlier operations and can be overridden for incomplete historical records.

The printable statement follows the supplied two-sided reconciliation layout with page carry-forwards,
turnover totals, closing debt, and signatures. Counterpart accounting columns remain blank unless the
user explicitly chooses to fill them. Reports do not change income totals or the underlying database.

## Bank Payments

The Payments page supports creating, editing, deleting, and allocating receipt cards. A payment can
cover several works; a work can use several payments. Allocation totals cannot exceed the receipt,
and client, organization and currency must agree. An advance can be saved without any invoice.
Work cards show linked receipts as read-only information. Add/Edit opens the shared receipt form in
a modal without discarding the work draft. Payment amounts, allocation amounts and types are edited
only in that receipt form; saving a work never rewrites payment allocations.
The invoice total always equals quantity times price summed over its items; there is no separate
editable invoice total or print-time price scaling. The UPD total can still be overridden independently.
Order cost is retained separately for contract balances. Paid status uses allocated receipts
against order cost; income reports count actual receipts on their receipt dates, not invoice totals.

For bank imports, select an organization and a bank Excel export. Operations (`Events.xlsx`)
and Payment Orders exports are supported. Review the proposed matches, select invoices for uncertain
payments, and split payments between invoices when necessary. Automatic splitting is proposed only
for an unambiguous combination of outstanding amounts; uncertain matches remain unchecked. To register
an unallocated advance, select its client and leave the invoice empty. Apply the checked receipts to the current
browser database. Outgoing/rejected/own-account transfers and duplicate receipts are not imported.
Work receipt totals and latest dates are derived from journal allocations. Kwork works are fully paid despite
commission deductions. Receipt times are retained when supplied; date-only sources remain date-only.

## Publish From the Browser

Open GitHub in the application. Create a fine-grained personal access token limited to
`user14052020/base-public-static` with repository permission **Contents: Read and write**.
Enter the token in the application, not in source code or a chat. The token and site password remain only
in the current tab's memory and are cleared on logout/page exit. Only optional commit author name/email
are remembered in local browser preferences. GitHub uses the token owner as the author if both are blank.

Check GitHub, then publish. The application encrypts the full backup with the existing site password,
creates one commit containing `seed-data.js` and its cache version in `index.html`, and updates `main`
without force. No client data is committed as plaintext. GitHub Pages deployment follows automatically.
If another browser has published newer data, publishing is blocked unless replacing that version is
explicitly confirmed. A change after the preflight check always requires a fresh check.

Browser edits are local until publication. Published data can be loaded manually on the Backups page;
it never silently replaces potentially newer local edits. Backups remain available in both directions
with the main application. The optional command-line publisher is documented in `scripts/README.md`.
Backups contain canonical `payments` and `paymentAllocations` collections plus derived legacy work
payment history. Old backups migrate once without treating edited cached totals as new bank receipts.
Conditional data corrections travel inside the encrypted backup and do not overwrite unrelated local edits.

## Tests

```sh
node --test
```

The bank matching engine, backup codec, and GitHub publisher are independent browser-compatible modules.
The publisher tests use a mock GitHub API and do not require real access tokens or publish test data.
