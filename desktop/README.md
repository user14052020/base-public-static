# Offers Base for Windows

Download `OffersBaseDesktop-win-x64.zip` from the `desktop-latest` GitHub release.
Extract the entire archive and run `OffersBase.exe`. Windows 10/11 x64 is supported.
The package contains its own .NET and Node runtimes. Git for Windows must be installed,
with Git Credential Manager. HTTPS is the default connection method. SSH remains supported.

On the Publication tab, enter the repository URL, commit author name/email, and GitHub username.
These settings are automatically saved after editing and restored on the next launch.
Existing Git author details are used to fill blank fields. Author name/email are applied only to this
repository; global Git configuration is never changed. Click the GitHub sign-in button to authenticate
in your browser. Git Credential Manager stores credentials in Windows Credential Manager.
The application itself never stores GitHub passwords/tokens or the static site password.

Select a backup, then either publish it directly or load a bank export on the Payments tab.
The application supports the bank's Operations export (`Events.xlsx`) and Payment Orders export.
Outgoing transfers, rejected operations, transfers between own accounts and duplicate payments are skipped.
Automatic matches use the invoice number/date and payer identity, or a unique payer/amount match.
Review uncertain matches manually. A payment can be split between invoices; the total cannot exceed
its remaining unallocated amount. Partial payments and several payments per invoice are supported.

Saving creates a new backup; the input backup and bank workbook are never overwritten.
For affected invoices, `creditedAmount` is the single payment amount and becomes the sum of linked bank payments.
The old duplicate `paymentAmount` field is migrated automatically. The payment date becomes the latest
receipt timestamp, including time when present in the export. Date-only sources remain date-only.
Kwork works stay fully paid even when the received amount is below the document total because of commission.
Existing manual payment totals require review and confirmation before replacement.
Kwork works are not automatically linked to bank withdrawals from the platform.

Publication uses the same encrypted seed publisher as the command-line tool. If the repository folder
does not yet exist, the application clones it using the configured HTTPS or SSH URL.
Passwords/tokens are not saved in app settings or put in process arguments. Backups and bank exports are never committed.

After Pages deployment, an existing browser offers to load the newly published backup. This replaces
its local data only after confirmation. Export any newer local changes first.

Windows builds and backend tests run in GitHub Actions, not on the local machine.
