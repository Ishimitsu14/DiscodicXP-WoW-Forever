param(
    [string]$Runtime = 'win-x64',
    [string]$RuntimeFrameworkVersion
)

$ErrorActionPreference = 'Stop'
if ($Runtime -notin @('win-x64', 'win-arm64')) { throw 'Поддерживаются win-x64 и win-arm64.' }
$projectRoot = Split-Path -Parent $PSScriptRoot
$outputPath = Join-Path $projectRoot "dist\launcher-$Runtime"
$env:DOTNET_CLI_HOME = Join-Path $projectRoot 'dist\dotnet-home'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
& powershell.exe -NoProfile -STA -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot 'create-icon.ps1')
if ($LASTEXITCODE -ne 0) { throw 'Не удалось подготовить иконку лаунчера.' }
if (-not $RuntimeFrameworkVersion) {
    $releaseMetadata = Invoke-RestMethod 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/9.0/releases.json'
    $RuntimeFrameworkVersion = $releaseMetadata.'latest-runtime'
}
if ($RuntimeFrameworkVersion -notmatch '^9\.0\.\d+$') { throw 'Некорректная версия .NET Runtime.' }
dotnet publish (Join-Path $PSScriptRoot 'DiscodicXP.Launcher.csproj') --configuration Release --runtime $Runtime --self-contained true -p:RuntimeFrameworkVersion=$RuntimeFrameworkVersion -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true --output $outputPath --nologo
if ($LASTEXITCODE -ne 0) { throw 'Не удалось собрать лаунчер.' }
$launcherFile = Get-Item -LiteralPath (Join-Path $outputPath 'DiscodicXP.Launcher.exe')
$launcherHash = (Get-FileHash -LiteralPath $launcherFile.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
$launcherVersion = $launcherFile.VersionInfo.ProductVersion.Split('+')[0]
Write-Output "Готово: $($launcherFile.FullName)"
Write-Output "Версия: $launcherVersion"
Write-Output "SHA-256: $launcherHash"
Write-Output "Публикация: GitHub Release launcher-v$launcherVersion с --latest=false; доставку на сервер выполняет GitHub Actions."
