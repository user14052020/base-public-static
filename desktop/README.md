# Offers Base for Windows

Download `OffersBaseDesktop-win-x64.zip` from the `desktop-latest` GitHub release.
Extract the entire archive and run `OffersBase.exe`. Windows 10/11 x64 is supported.
The package contains its own .NET and Node runtimes. Git for Windows must be installed,
with an SSH key authorized for `user14052020/base-public-static` and a configured Git name/email.

Select a backup, then either publish it directly or load a bank export on the Payments tab.
The application supports the bank's Operations export (`Events.xlsx`) and Payment Orders export.
Outgoing transfers, rejected operations, transfers between own accounts and duplicate payments are skipped.
Automatic matches use the invoice number/date and payer identity, or a unique payer/amount match.
Review uncertain matches manually. A payment can be split between invoices; the total cannot exceed
its remaining unallocated amount. Partial payments and several payments per invoice are supported.

Saving creates a new backup; the input backup and bank workbook are never overwritten.
For affected invoices, the payment amount becomes the sum of linked bank payments and the payment date
becomes the latest receipt date. Existing manual payment totals require review and confirmation before replacement.
Kwork works are not automatically linked to bank withdrawals from the platform.

Publication uses the same encrypted seed publisher as the command-line tool. If the repository folder
does not yet exist, the application clones it over SSH. The password is not saved or put in process arguments.
Only the repository folder is remembered. Backups and bank exports are never committed.

After Pages deployment, an existing browser offers to load the newly published backup. This replaces
its local data only after confirmation. Export any newer local changes first.

Windows builds and backend tests run in GitHub Actions, not on the local machine.
