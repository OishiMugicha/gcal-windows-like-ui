$ErrorActionPreference = 'Stop'
Set-Location -LiteralPath (Join-Path $PSScriptRoot '..')
$env:PW_BROWSER_CHANNEL = 'msedge'
$nodeCommand = Get-Command node.exe -ErrorAction Stop
& $nodeCommand.Source 'node_modules/playwright/cli.js' test @args
exit $LASTEXITCODE
