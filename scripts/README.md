# Publish a Backup

The application now imports bank receipts and publishes encrypted data directly from the browser.
This optional command-line tool remains available as an alternative; no desktop client is required.

Requires Node.js 18+ and Git with access to `origin`. Run on a clean, up-to-date `main` branch.
Keep the backup outside this public repository.

```powershell
.\scripts\publish-backup.ps1 -BackupPath "C:\Users\dev\Downloads\offers-base-static-backup-20261111041501..json.gz"
```

Alternatively:

```powershell
node .\scripts\publish-backup.cjs "C:\path\backup.json.gz"
```

Enter the current static site password when prompted. Input is hidden; do not put passwords in arguments or files.
Both `.json` and gzip-compressed backups from the static and main versions are supported.

The script validates the backup and password, preserves every collection and field, encrypts `seed-data.js`,
updates its cache version in `index.html`, commits only these two files, and pushes `main` without force.
GitHub Pages then deploys the update. No local build or server is started.

Publishing the same backup twice makes no extra commit. Validation failures leave the files unchanged.
If push fails after committing, run the retry command printed by the script.

## Existing Browser Data

Published data is the starting dataset, not a shared live database. Existing browser data is deliberately not
overwritten: it may contain newer edits. To load the published dataset in an existing browser, export any
local changes first, then use the reset-to-starting-data button on the Backups page. Log out and back in
first if the page asks for a password. New browser profiles use the published data on their first login.

## Tests

```powershell
node --test tests/*.test.cjs
```
