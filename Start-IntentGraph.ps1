param([switch]$NoBrowser, [string]$NodePath)
$ErrorActionPreference = 'Stop'
$intentProject = $PSScriptRoot
$intentUrl = 'http://127.0.0.1:8768'
$intentReady = $false
try {
    $intentIndex = Invoke-RestMethod -Uri ($intentUrl + '/api/health') -TimeoutSec 3
    $intentReady = $intentIndex.service -eq 'aven-intentgraph' -and $intentIndex.ready -eq $true -and $intentIndex.rootLabel -eq (Split-Path $intentProject -Leaf)
} catch { }
if (-not $intentReady) {
    if (Get-NetTCPConnection -LocalPort 8768 -State Listen -ErrorAction SilentlyContinue) {
        throw 'Port 8768 is already in use. Its process was left running.'
    }
    $intentNode = if ($NodePath) { (Get-Command $NodePath -ErrorAction Stop).Source } else { (Get-Command node -ErrorAction Stop).Source }
    & $intentNode -e "require(process.argv[1]).assertRuntime()" (Join-Path $intentProject 'intentgraph/reliability-storage.cjs')
    if ($LASTEXITCODE -ne 0) { throw 'Durable chat admission requires Node.js 24.16 or newer.' }
    $intentRuntime = Join-Path $intentProject '.intentgraph/runtime'
    New-Item -ItemType Directory -Path $intentRuntime -Force | Out-Null
    $intentProcess = Start-Process -FilePath $intentNode -ArgumentList @('intentgraph/server.cjs') -WorkingDirectory $intentProject -WindowStyle Hidden -PassThru -RedirectStandardOutput (Join-Path $intentRuntime 'server.log') -RedirectStandardError (Join-Path $intentRuntime 'server-error.log')
    $intentProcess.Id | Set-Content -LiteralPath (Join-Path $intentRuntime 'server.pid')
    for ($intentAttempt = 0; $intentAttempt -lt 40; $intentAttempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $intentIndex = Invoke-RestMethod -Uri ($intentUrl + '/api/health') -TimeoutSec 2
            if ($intentIndex.service -eq 'aven-intentgraph' -and $intentIndex.ready -eq $true -and $intentIndex.rootLabel -eq (Split-Path $intentProject -Leaf)) { $intentReady = $true; break }
        } catch { }
    }
    if (-not $intentReady) { throw 'IntentGraph did not become ready. See .intentgraph/runtime/server-error.log.' }
}
Write-Output $intentUrl
if (-not $NoBrowser) { Start-Process $intentUrl }
