param(
    [Parameter(Mandatory = $true)]
    [string]$AddOnsPath,
    [string]$BuildPath = (Join-Path $PSScriptRoot '..\dist\DiscodicXP'),
    [switch]$Update
)

$ErrorActionPreference = 'Stop'
$buildRoot = (Resolve-Path -LiteralPath $BuildPath).Path
$addonsRoot = (Resolve-Path -LiteralPath $AddOnsPath).Path
$target = [IO.Path]::GetFullPath((Join-Path $addonsRoot 'DiscodicXP'))

if ((Split-Path -Path $target -Parent) -ne $addonsRoot) {
    throw 'Некорректный каталог назначения.'
}
if (-not (Test-Path -LiteralPath (Join-Path $buildRoot 'DiscodicXP.toc'))) {
    throw 'В папке сборки отсутствует DiscodicXP.toc.'
}
if (Test-Path -LiteralPath $target) {
    if (-not $Update) { throw 'DiscodicXP уже установлен. Для обновления с резервной копией укажите -Update.' }
    $manifestPath = Join-Path $target 'build.json'
    if (-not (Test-Path -LiteralPath $manifestPath)) {
        throw 'В папке назначения не найдена подтверждённая установка DiscodicXP.'
    }
    $installedManifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
    if ($installedManifest.addon -ne 'DiscodicXP') {
        throw 'В папке назначения не найдена подтверждённая установка DiscodicXP.'
    }
    $buildManifest = Get-Content -LiteralPath (Join-Path $buildRoot 'build.json') -Raw | ConvertFrom-Json
    $preserveGuides = $installedManifest.guideUpdates -eq 1 -and $buildManifest.guideUpdates -eq 1 -and
        (Test-Path -LiteralPath (Join-Path $target 'UserGuides\ForeverHorde.lua'))
    $backupRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot ("..\dist\install-backups\" + (Get-Date -Format 'yyyyMMdd-HHmmss-fff'))))
    New-Item -ItemType Directory -Path $backupRoot -Force | Out-Null
    Copy-Item -LiteralPath $target -Destination (Join-Path $backupRoot 'DiscodicXP') -Recurse
    foreach ($entry in Get-ChildItem -LiteralPath $buildRoot -Force) {
        if ($preserveGuides -and $entry.Name -eq 'UserGuides') { continue }
        Copy-Item -LiteralPath $entry.FullName -Destination $target -Recurse -Force
    }
    Write-Output "Резервная копия: $backupRoot"
} else {
    Copy-Item -LiteralPath $buildRoot -Destination $target -Recurse
}
Write-Output "Установлено: $target"
Write-Output 'В списке модификаций включите DiscordicXP и отключите RestedXP Guides. Команда: /dxp'
