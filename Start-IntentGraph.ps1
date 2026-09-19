param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$intentProject = $PSScriptRoot
$intentUrl = 'http://127.0.0.1:8768'
$intentReady = $false
try {
    $intentIndex = Invoke-RestMethod -Uri ($intentUrl + '/api/index') -TimeoutSec 3
    $intentReady = $intentIndex.rootLabel -eq (Split-Path $intentProject -Leaf)
} catch { }
if (-not $intentReady) {
    if (Get-NetTCPConnection -LocalPort 8768 -State Listen -ErrorAction SilentlyContinue) {
        throw 'Port 8768 is already in use. Its process was left running.'
    }
    $intentNode = (Get-Command node -ErrorAction Stop).Source
    $intentRuntime = Join-Path $intentProject '.intentgraph/runtime'
    New-Item -ItemType Directory -Path $intentRuntime -Force | Out-Null
    $intentProcess = Start-Process -FilePath $intentNode -ArgumentList @('intentgraph/server.cjs') -WorkingDirectory $intentProject -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $intentRuntime 'server.log') -RedirectStandardError (Join-Path $intentRuntime 'server-error.log')
    $intentProcess.Id | Set-Content -LiteralPath (Join-Path $intentRuntime 'server.pid')
    for ($intentAttempt = 0; $intentAttempt -lt 40; $intentAttempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $intentIndex = Invoke-RestMethod -Uri ($intentUrl + '/api/index') -TimeoutSec 2
            if ($intentIndex.rootLabel -eq (Split-Path $intentProject -Leaf)) { $intentReady = $true; break }
        } catch { }
    }
    if (-not $intentReady) { throw 'IntentGraph did not become ready. See .intentgraph/runtime/server-error.log.' }
}
Write-Output $intentUrl
if (-not $NoBrowser) { Start-Process $intentUrl }
