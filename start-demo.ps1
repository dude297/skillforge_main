# One-command SkillForge demo: ./start-demo.ps1 [--port 8766] [--no-open] [--reset-demo]
# (blocked by execution policy? powershell -ExecutionPolicy Bypass -File start-demo.ps1 --no-open)
# Thin wrapper; all logic lives in scripts/demo_launcher.py.
Set-Location -LiteralPath $PSScriptRoot
foreach ($py in @(@('py', '-3'), @('python'), @('python3'))) {
    if (-not (Get-Command $py[0] -ErrorAction SilentlyContinue)) { continue }
    $pre = @($py | Select-Object -Skip 1)
    & $py[0] @pre -c 'import sys; sys.exit(sys.version_info < (3, 11))' 2>$null
    if ($LASTEXITCODE -eq 0) {
        & $py[0] @pre scripts/demo_launcher.py @args
        exit $LASTEXITCODE
    }
}
Write-Host '[demo] STOP: python >= 3.11 not found (tried py -3, python, python3)'
exit 1
