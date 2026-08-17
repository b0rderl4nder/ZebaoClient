param(
    [ValidateSet("start", "stop", "status")]
    [string]$Action = "start",
    [int]$Port = 8002,
    [ValidateSet("empty", "minimal", "museum", "kitchen")]
    [string]$Scene = "minimal",
    [switch]$Headless
)

$ErrorActionPreference = "Stop"
$runtimeRoot = Join-Path $env:LOCALAPPDATA "ZebaoClient\mujoco"
$pidFile = Join-Path $runtimeRoot "mujoco-shadow-$Port.pid"
$stdoutLog = Join-Path $runtimeRoot "mujoco-shadow-$Port.out.log"
$stderrLog = Join-Path $runtimeRoot "mujoco-shadow-$Port.err.log"
$statusUrl = "http://127.0.0.1:$Port/api/daemon/status"
$executable = Join-Path $PSScriptRoot "bin\reachy-mini-daemon.exe"

function Get-ShadowStatus {
    try { return Invoke-RestMethod -Uri $statusUrl -TimeoutSec 2 }
    catch { return $null }
}

function Get-VerifiedShadowProcess {
    if (-not (Test-Path -LiteralPath $pidFile)) { return $null }
    $processIdText = (Get-Content -LiteralPath $pidFile -Raw).Trim()
    if ($processIdText -notmatch '^\d+$') { return $null }
    $processInfo = Get-CimInstance Win32_Process -Filter "ProcessId = $processIdText" -ErrorAction SilentlyContinue
    if ($null -eq $processInfo) { return $null }
    $expectedExecutable = [System.IO.Path]::GetFullPath($executable)
    if ([System.IO.Path]::GetFullPath($processInfo.ExecutablePath) -ne $expectedExecutable) {
        throw "The PID file does not belong to this packaged MuJoCo process."
    }
    return $processInfo
}

if ($Action -eq "status") {
    $status = Get-ShadowStatus
    if ($null -eq $status) { exit 1 }
    $status | ConvertTo-Json -Depth 6
    exit 0
}

if ($Action -eq "stop") {
    $processInfo = Get-VerifiedShadowProcess
    if ($null -eq $processInfo) {
        if ($null -ne (Get-ShadowStatus)) { throw "The port is owned by another process." }
        Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
        exit 0
    }
    Stop-Process -Id $processInfo.ProcessId -Force
    Wait-Process -Id $processInfo.ProcessId -Timeout 10 -ErrorAction SilentlyContinue
    Remove-Item -LiteralPath $pidFile -Force -ErrorAction SilentlyContinue
    exit 0
}

if (-not (Test-Path -LiteralPath $executable -PathType Leaf)) {
    throw "The packaged MuJoCo runtime executable is missing."
}
if ($null -ne (Get-ShadowStatus)) { exit 0 }

New-Item -ItemType Directory -Path $runtimeRoot -Force | Out-Null
$arguments = @(
    "--sim", "--scene", $Scene,
    "--fastapi-host", "127.0.0.1", "--fastapi-port", "$Port",
    "--no-media", "--no-autostart", "--no-wake-up-on-start",
    "--no-goto-sleep-on-stop", "--log-level", "INFO"
)
if ($Headless) { $arguments += "--headless" }
$processInfo = Start-Process -FilePath $executable -ArgumentList $arguments -WindowStyle Hidden -RedirectStandardOutput $stdoutLog -RedirectStandardError $stderrLog -PassThru
Set-Content -LiteralPath $pidFile -Value $processInfo.Id -Encoding ascii

$deadline = (Get-Date).AddSeconds(30)
do {
    Start-Sleep -Milliseconds 250
    if ($processInfo.HasExited) { throw "MuJoCo runtime startup failed. See $stderrLog" }
    $status = Get-ShadowStatus
} while ($null -eq $status -and (Get-Date) -lt $deadline)
if ($null -eq $status) { throw "MuJoCo runtime was not ready within 30 seconds. See $stderrLog" }
