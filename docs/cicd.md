# CI/CD лаунчера

Исходники лаунчера находятся в `DiscodicXP-WoW-Forever`, API и админка — в
`DiscodicXP-WoW-Forever-AdminPanel`. Основная ветка обоих репозиториев — `main`.
Сервер автоматически обновляется по push в `main` серверного репозитория.

Workflow `.github/workflows/launcher.yml` собирает и проверяет лаунчер на Windows
при pull request и push в `main`, если изменены его файлы. Публикация отдельной
GitHub Release `launcher-v<версия>` запускает сборку из её тега, загрузку EXE и
checksum в релиз, затем автоматическое обновление файлов на HTTPS-сервере.
CI проверяет версию EXE, SHA-256, размер, манифест и скачивание по обоим адресам.
Node-служба при выпуске лаунчера не перезапускается.

## Однократная настройка

В **Settings → Secrets and variables → Actions** клиентского репозитория добавьте
те же repository secrets, что у серверного workflow:

| Secret | Значение |
| --- | --- |
| `DEPLOY_HOST` | IP или домен сервера без протокола |
| `DEPLOY_USER` | SSH-пользователь сервера (`root` либо с разрешённым `sudo -n`) |
| `DEPLOY_SSH_KEY` | Приватный SSH-ключ GitHub Actions; публичная часть — в `authorized_keys` на сервере |
| `DEPLOY_KNOWN_HOSTS` | Проверенная запись сервера OpenSSH `known_hosts` |

Variables `DEPLOY_PORT` и `DEPLOY_ORIGIN` необязательны; по умолчанию это `22` и
`https://<DEPLOY_HOST>`. Job публикации использует environment `production`, где
тоже можно хранить эти секреты. Для автоматического выпуска не включайте ручное
подтверждение environment. Ключи в Git или чат не добавляются.

На сервере уже должен находиться `server/publish-launcher.sh` из серверного
репозитория. Сначала завершите первый успешный деплой AdminPanel через Actions.
Подробности SSH-настройки — `docs/cicd.md` серверного репозитория.

## Выпуск

1. Обновите `<Version>` в `launcher/DiscodicXP.Launcher.csproj`.
2. Сохраните исходники и workflow коммитом и отправьте их в `main`.
3. Создайте обычный опубликованный релиз с тегом `launcher-v<версия>`, привязанный
   к проверенному коммиту. Снимите **Set as the latest release** в GitHub UI либо:

   ```powershell
   & $ghPath release create "launcher-v$version" `
       --repo Ishimitsu14/DiscodicXP-WoW-Forever --target $releaseCommit `
       --title "DiscodicXP Launcher $version" --notes-file $notesFile --latest=false
   ```

4. Дождитесь успешных `build` и `publish` в **Actions → Launcher**. Само создание
   GitHub Release не означает, что файлы на сервере уже обновлены.
5. Проверьте результат в итогах workflow и
   [манифест](https://153.76.170.60/downloads/launcher/latest.json).

Архивы аддона по-прежнему публикуются под тегами `v<версия>` и помечаются `Latest`.
Сервер берёт аддон через GitHub `releases/latest`, поэтому релиз лаунчера обязательно
создаётся с `--latest=false`. Workflow не публикует prerelease и проверяет, что
релиз лаунчера не занял канал `Latest` аддона.

Вышедший EXE нельзя заменить другим бинарником под той же версией или понизить
версию на сервере. При повторе workflow уже загруженные assets сравниваются побайтно.
Если повторная сборка дала другой EXE, выпустите новую версию. Для ошибки доступа
или сети повторите workflow; ручная загрузка EXE и ручной запуск publisher не нужны.
