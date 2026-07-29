#Requires -Version 5.1
param(
  [string[]]$ExpoArgs = @('run:android')
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
  Write-Host "[CareTip Android] $Message" -ForegroundColor Cyan
}

$gradleHome = 'C:\gradle'
if (-not (Test-Path $gradleHome)) {
  New-Item -ItemType Directory -Path $gradleHome -Force | Out-Null
}
$env:GRADLE_USER_HOME = $gradleHome
Write-Step "GRADLE_USER_HOME=$gradleHome"

$sdkRoot = $env:ANDROID_HOME
if (-not $sdkRoot) { $sdkRoot = $env:ANDROID_SDK_ROOT }
if (-not $sdkRoot) { $sdkRoot = Join-Path $env:LOCALAPPDATA 'Android\Sdk' }

$ninjaBin = Join-Path $sdkRoot 'cmake\3.22.1\bin\ninja.exe'
if (Test-Path $ninjaBin) {
  $versionLine = & $ninjaBin --version 2>$null
  if ($versionLine -match '^1\.(10|11)\.') {
    Write-Step "Upgrading Ninja ($versionLine to 1.12.1) at $ninjaBin"
    $zip = Join-Path $env:TEMP 'ninja-win.zip'
    $extract = Join-Path $env:TEMP 'ninja-win'
    Invoke-WebRequest -Uri 'https://github.com/ninja-build/ninja/releases/download/v1.12.1/ninja-win.zip' -OutFile $zip
    if (Test-Path $extract) { Remove-Item $extract -Recurse -Force }
    Expand-Archive -Path $zip -DestinationPath $extract -Force
    Copy-Item (Join-Path $extract 'ninja.exe') $ninjaBin -Force
    Remove-Item $zip -Force -ErrorAction SilentlyContinue
    Remove-Item $extract -Recurse -Force -ErrorAction SilentlyContinue
    Write-Step "Ninja upgraded to $(& $ninjaBin --version)"
  } else {
    Write-Step "Ninja OK ($versionLine)"
  }
} else {
  Write-Step "Ninja not found at $ninjaBin. Install Android SDK CMake 3.22.1 or newer."
}

$longPaths = Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\FileSystem' -Name LongPathsEnabled -ErrorAction SilentlyContinue
if ($longPaths.LongPathsEnabled -ne 1) {
  Write-Host '[CareTip Android] WARNING: Windows long paths are disabled.' -ForegroundColor Yellow
}

$mobileRoot = Split-Path $PSScriptRoot -Parent
$cxxRoot = Join-Path $mobileRoot 'node_modules\expo-modules-core\android\.cxx'
if (Test-Path $cxxRoot) {
  Write-Step 'Cleaning expo-modules-core .cxx cache'
  Remove-Item $cxxRoot -Recurse -Force
}

Push-Location $mobileRoot
try {
  $joined = $ExpoArgs -join ' '
  cmd /c "npx expo $joined"
  exit $LASTEXITCODE
} finally {
  Pop-Location
}
