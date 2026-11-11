# Offers Base

Static accounting application at https://offers.maharram.ru, published from `main` on GitHub Pages.
No Windows client, local server, Git installation, or virtual machine is needed to use it.

## Bank Payments

On the Payments page, select an organization and a bank Excel export. Operations (`Events.xlsx`)
and Payment Orders exports are supported. Review the proposed matches, select invoices for uncertain
payments, and split payments between invoices when necessary. Apply the checked allocations to the current
browser database. Outgoing/rejected/own-account transfers and duplicate receipts are not imported.
The single `creditedAmount` field is displayed as Payment Amount. Kwork works are fully paid despite
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

## Tests

```sh
node --test
```

The bank matching engine, backup codec, and GitHub publisher are independent browser-compatible modules.
The publisher tests use a mock GitHub API and do not require real access tokens or publish test data.
