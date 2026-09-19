$ErrorActionPreference = 'Stop'
$prototypeDirectory = $PSScriptRoot
$prototypeUrl = 'http://127.0.0.1:8767/'
$prototypeReady = $false
try {
    $prototypeResponse = Invoke-WebRequest -Uri ($prototypeUrl + 'index.html') -TimeoutSec 2
    $prototypeReady = $prototypeResponse.Content -match 'Netrok Muse'
} catch { }
if (-not $prototypeReady) {
    $prototypeListener = Get-NetTCPConnection -LocalPort 8767 -State Listen -ErrorAction SilentlyContinue
    if ($prototypeListener) { throw 'Port 8767 is occupied by another application. Do not stop it automatically.' }
    $prototypePython = (Get-Command python -ErrorAction Stop).Source
    Start-Process -FilePath $prototypePython -ArgumentList @('-m', 'http.server', '8767', '--bind', '127.0.0.1') -WorkingDirectory $prototypeDirectory -WindowStyle Hidden
    for ($prototypeAttempt = 0; $prototypeAttempt -lt 20; $prototypeAttempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $prototypeResponse = Invoke-WebRequest -Uri ($prototypeUrl + 'index.html') -TimeoutSec 1
            if ($prototypeResponse.Content -match 'Netrok Muse') { $prototypeReady = $true; break }
        } catch { }
    }
    if (-not $prototypeReady) { throw 'The local preview did not become ready.' }
}
Start-Process $prototypeUrl
