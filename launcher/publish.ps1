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
if (-not $RuntimeFrameworkVersion) {
    $releaseMetadata = Invoke-RestMethod 'https://builds.dotnet.microsoft.com/dotnet/release-metadata/9.0/releases.json'
    $RuntimeFrameworkVersion = $releaseMetadata.'latest-runtime'
}
if ($RuntimeFrameworkVersion -notmatch '^9\.0\.\d+$') { throw 'Некорректная версия .NET Runtime.' }
dotnet publish (Join-Path $PSScriptRoot 'DiscodicXP.Launcher.csproj') --configuration Release --runtime $Runtime --self-contained true -p:RuntimeFrameworkVersion=$RuntimeFrameworkVersion -p:PublishSingleFile=true -p:EnableCompressionInSingleFile=true -p:IncludeNativeLibrariesForSelfExtract=true --output $outputPath --nologo
if ($LASTEXITCODE -ne 0) { throw 'Не удалось собрать лаунчер.' }
Write-Output "Готово: $(Join-Path $outputPath 'DiscodicXP.Launcher.exe')"
