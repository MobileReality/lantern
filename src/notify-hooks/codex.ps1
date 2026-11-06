param([int]$Port = 31337, [string]$TokenFile = "")

$ErrorActionPreference = 'SilentlyContinue'
$ProgressPreference = 'SilentlyContinue'
$WarningPreference = 'SilentlyContinue'
$raw = [Console]::In.ReadToEnd()
$token = ''
try {
    if ($TokenFile -and (Test-Path -LiteralPath $TokenFile -PathType Leaf)) {
        $token = (Get-Content -LiteralPath $TokenFile -Raw).Trim()
    }
    if ($token) {
        Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:$Port/codex/event" -Method Post `
            -Body $raw -ContentType 'application/json' -Headers @{ 'X-Lantern-Codex-Token' = $token } `
            -TimeoutSec 1 | Out-Null
    }
} catch {}
[Console]::Out.Write("{}")
exit 0
