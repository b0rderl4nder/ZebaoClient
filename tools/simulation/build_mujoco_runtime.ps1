param(
    [string]$DaemonRoot = "",
    [switch]$Clean
)

$ErrorActionPreference = "Stop"
$clientRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
if (-not $DaemonRoot) {
    $DaemonRoot = (Resolve-Path (Join-Path $clientRoot "..\zebao_daemon")).Path
}
$DaemonRoot = (Resolve-Path -LiteralPath $DaemonRoot).Path
if (-not (Test-Path -LiteralPath (Join-Path $DaemonRoot "pyproject.toml") -PathType Leaf)) {
    throw "DaemonRoot is not a valid Reachy Mini source directory."
}

$buildRoot = Join-Path $PSScriptRoot "build"
$distRoot = Join-Path $buildRoot "dist"
$workRoot = Join-Path $buildRoot "work"
$specRoot = Join-Path $buildRoot "spec"
$bundleRoot = Join-Path $clientRoot "src-tauri\resources\mujoco-runtime\bin"
if ($Clean) {
    $expectedBuildRoot = [System.IO.Path]::GetFullPath((Join-Path $clientRoot "tools\simulation\build"))
    $expectedBundleRoot = [System.IO.Path]::GetFullPath((Join-Path $clientRoot "src-tauri\resources\mujoco-runtime\bin"))
    foreach ($target in @($buildRoot, $bundleRoot)) {
        $resolvedTarget = [System.IO.Path]::GetFullPath($target)
        if ($resolvedTarget -notin @($expectedBuildRoot, $expectedBundleRoot)) {
            throw "Refusing to clean a directory outside the workspace."
        }
        Remove-Item -LiteralPath $target -Recurse -Force -ErrorAction SilentlyContinue
    }
}
New-Item -ItemType Directory -Path $distRoot, $workRoot, $specRoot, $bundleRoot -Force | Out-Null

$entry = Join-Path $PSScriptRoot "mujoco_sidecar.py"
& uv run --project $DaemonRoot --extra mujoco --with pyinstaller pyinstaller `
    --noconfirm --clean --onedir --console `
    --name reachy-mini-daemon `
    --distpath $distRoot --workpath $workRoot --specpath $specRoot `
    --collect-all reachy_mini --collect-all mujoco --collect-all glfw $entry
if ($LASTEXITCODE -ne 0) { throw "MuJoCo sidecar build failed." }

$source = Join-Path $distRoot "reachy-mini-daemon"
Copy-Item -Path (Join-Path $source "*") -Destination $bundleRoot -Recurse -Force
if (-not (Test-Path -LiteralPath (Join-Path $bundleRoot "reachy-mini-daemon.exe"))) {
    throw "MuJoCo sidecar artifact is incomplete."
}
Write-Output "MuJoCo runtime staged at $bundleRoot"
