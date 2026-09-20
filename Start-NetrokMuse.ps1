param([switch]$NoBrowser)
$ErrorActionPreference = 'Stop'
$prototypeDirectory = $PSScriptRoot
$prototypeUrl = 'http://127.0.0.1:8767/polished.html'
$prototypeReady = $false
try {
    $prototypeResponse = Invoke-WebRequest -UseBasicParsing -Uri $prototypeUrl -TimeoutSec 2
    $prototypeReady = [Convert]::ToBase64String($prototypeResponse.RawContentStream.ToArray()) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $prototypeDirectory 'polished.html')))
} catch { }
if (-not $prototypeReady) {
    $prototypeListener = Get-NetTCPConnection -LocalPort 8767 -State Listen -ErrorAction SilentlyContinue
    if ($prototypeListener) { throw 'Port 8767 is occupied by another application. Do not stop it automatically.' }
    $prototypePython = (Get-Command python -ErrorAction Stop).Source
    Start-Process -FilePath $prototypePython -ArgumentList @('-m', 'http.server', '8767', '--bind', '127.0.0.1') -WorkingDirectory $prototypeDirectory -WindowStyle Hidden
    for ($prototypeAttempt = 0; $prototypeAttempt -lt 20; $prototypeAttempt++) {
        Start-Sleep -Milliseconds 250
        try {
            $prototypeResponse = Invoke-WebRequest -UseBasicParsing -Uri $prototypeUrl -TimeoutSec 1
            if ([Convert]::ToBase64String($prototypeResponse.RawContentStream.ToArray()) -eq [Convert]::ToBase64String([IO.File]::ReadAllBytes((Join-Path $prototypeDirectory 'polished.html')))) { $prototypeReady = $true; break }
        } catch { }
    }
    if (-not $prototypeReady) { throw 'The local preview did not become ready.' }
}
Write-Output $prototypeUrl
if (-not $NoBrowser) { Start-Process $prototypeUrl }
