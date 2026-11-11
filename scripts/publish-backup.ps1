param(
    [Parameter(Mandatory = $true, Position = 0)]
    [string]$BackupPath
)

$ErrorActionPreference = 'Stop'
$node = Get-Command node -ErrorAction SilentlyContinue
if ($node) {
    $nodePath = $node.Source
} else {
    $nodePath = Join-Path $env:USERPROFILE '.cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe'
    if (-not (Test-Path -LiteralPath $nodePath)) {
        throw 'Node.js 18 or newer is required. Install it and restart the terminal.'
    }
}

& $nodePath (Join-Path $PSScriptRoot 'publish-backup.cjs') $BackupPath
exit $LASTEXITCODE
