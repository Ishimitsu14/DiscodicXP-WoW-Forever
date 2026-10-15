#!/usr/bin/env bash
set -euo pipefail
source .github/scripts/ssh.sh

remote_stage=''
cleanup() {
    if [[ "$remote_stage" =~ ^/tmp/discodicxp-ci\.[a-zA-Z0-9]{8}$ ]]; then
        ssh -F "$SSH_CONFIG" discodicxp "rm -rf -- '$remote_stage'" || true
    fi
    rm -rf -- "$ssh_directory"
}
trap cleanup EXIT

[[ "$LAUNCHER_VERSION" =~ ^[0-9]{1,4}\.[0-9]{1,4}\.[0-9]{1,4}$ && "$RELEASE_TAG" == "launcher-v$LAUNCHER_VERSION" ]]
cd dist/launcher-win-x64
sha256sum --check DiscodicXP.Launcher.exe.sha256
launcher_hash="$(sha256sum DiscodicXP.Launcher.exe | cut -d ' ' -f 1)"
latest_tag="$(gh api "repos/$GITHUB_REPOSITORY/releases/latest" --jq .tag_name)"
if [[ "$latest_tag" == "$RELEASE_TAG" ]]; then
    echo 'Launcher releases must use --latest=false; restore the addon release as Latest before retrying.' >&2
    exit 1
fi

status="$(curl --silent --show-error --max-time 20 --output "$RUNNER_TEMP/current-launcher.json" --write-out '%{http_code}' "$DEPLOY_ORIGIN/downloads/launcher/latest.json")"
if [[ "$status" == 200 ]]; then
    node --input-type=module - "$RUNNER_TEMP/current-launcher.json" "$LAUNCHER_VERSION" "$launcher_hash" <<'NODE'
import { readFileSync } from 'node:fs';
const [path, version, hash] = process.argv.slice(2);
const current = JSON.parse(readFileSync(path, 'utf8'));
if (!/^\d{1,4}\.\d{1,4}\.\d{1,4}$/.test(current.version)) throw new Error('Invalid current launcher manifest.');
const previous = current.version.split('.').map(Number), next = version.split('.').map(Number);
const difference = next.map((part, index) => part - previous[index]).find(part => part !== 0) || 0;
if (difference < 0 || (difference === 0 && hash !== current.sha256)) throw new Error('Use a new version; published launchers cannot be downgraded or replaced.');
NODE
elif [[ "$status" != 404 ]]; then
    echo "Cannot read current launcher manifest: HTTP $status" >&2
    exit 1
fi

assets="$(gh release view "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --json assets --jq '.assets[].name')"
for file in DiscodicXP.Launcher.exe DiscodicXP.Launcher.exe.sha256; do
    if printf '%s\n' "$assets" | grep -Fxq "$file"; then
        existing="$(mktemp -d "$RUNNER_TEMP/discodicxp-asset.XXXXXXXX")"
        gh release download "$RELEASE_TAG" --repo "$GITHUB_REPOSITORY" --pattern "$file" --dir "$existing"
        cmp -- "$file" "$existing/$file"
        rm -rf -- "$existing"
    else
        gh release upload "$RELEASE_TAG" "$file" --repo "$GITHUB_REPOSITORY"
    fi
done

remote_stage="$(ssh -F "$SSH_CONFIG" discodicxp 'umask 077; mktemp -d /tmp/discodicxp-ci.XXXXXXXX')"
[[ "$remote_stage" =~ ^/tmp/discodicxp-ci\.[a-zA-Z0-9]{8}$ ]]
scp -F "$SSH_CONFIG" DiscodicXP.Launcher.exe "discodicxp:$remote_stage/launcher.exe"
ssh -F "$SSH_CONFIG" discodicxp "bash -s -- '$remote_stage/launcher.exe' '$launcher_hash' '$LAUNCHER_VERSION'" <<'REMOTE'
set -euo pipefail
if [[ "$(id -u)" == 0 ]]; then
    flock -w 120 /run/lock/discodicxp-deploy.lock bash /opt/discodicxp-update/server/publish-launcher.sh "$1" "$2" "$3"
else
    sudo -n flock -w 120 /run/lock/discodicxp-deploy.lock bash /opt/discodicxp-update/server/publish-launcher.sh "$1" "$2" "$3"
fi
REMOTE

curl --fail --silent --show-error --max-time 20 "$DEPLOY_ORIGIN/downloads/launcher/latest.json" --output "$RUNNER_TEMP/published-launcher.json"
node --input-type=module - "$RUNNER_TEMP/published-launcher.json" "$LAUNCHER_VERSION" "$launcher_hash" <<'NODE'
import { readFileSync, statSync } from 'node:fs';
const [path, version, hash] = process.argv.slice(2);
const manifest = JSON.parse(readFileSync(path, 'utf8'));
if (manifest.version !== version || manifest.sha256 !== hash || manifest.size !== statSync('DiscodicXP.Launcher.exe').size
    || manifest.downloadPath !== `/downloads/launcher/${hash}.exe`) throw new Error('Published launcher manifest mismatch.');
NODE
curl --fail --silent --show-error --max-time 120 "$DEPLOY_ORIGIN/downloads/launcher/$launcher_hash.exe" --output "$RUNNER_TEMP/published-launcher.exe"
cmp -- DiscodicXP.Launcher.exe "$RUNNER_TEMP/published-launcher.exe"
curl --fail --silent --show-error --max-time 120 "$DEPLOY_ORIGIN/downloads/DiscodicXP.Launcher.exe" --output "$RUNNER_TEMP/published-launcher.exe"
cmp -- DiscodicXP.Launcher.exe "$RUNNER_TEMP/published-launcher.exe"
curl --fail --silent --show-error --max-time 20 "$DEPLOY_ORIGIN/downloads/DiscodicXP.Launcher.exe.sha256" --output "$RUNNER_TEMP/published-launcher.sha256"
cmp -- DiscodicXP.Launcher.exe.sha256 "$RUNNER_TEMP/published-launcher.sha256"
printf 'Published launcher %s: %s/downloads/DiscodicXP.Launcher.exe\n' "$LAUNCHER_VERSION" "$DEPLOY_ORIGIN" >> "$GITHUB_STEP_SUMMARY"
