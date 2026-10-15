#!/usr/bin/env bash
set -euo pipefail

domain="${1:-}"
if [[ "$EUID" != 0 || ! "$domain" =~ ^[a-zA-Z0-9][a-zA-Z0-9.-]*\.[a-zA-Z]{2,}$ ]]; then
    echo 'Usage as root: bash server/deploy.sh updates.example.com' >&2
    exit 1
fi
source_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
source /etc/os-release
if [[ "$ID" != debian && "$ID" != ubuntu ]]; then
    echo 'This installer supports Debian and Ubuntu with systemd.' >&2
    exit 1
fi
if ! command -v systemctl >/dev/null; then
    echo 'systemd is required.' >&2
    exit 1
fi
if ss -ltnH '( sport = :80 or sport = :443 )' | grep -q . && ! systemctl is-active --quiet caddy; then
    echo 'Ports 80/443 are in use by another service. Configure its HTTPS proxy before deploying.' >&2
    exit 1
fi
case "$(uname -m)" in
    x86_64) node_arch=x64 ;;
    aarch64) node_arch=arm64 ;;
    *) echo 'Unsupported CPU architecture.' >&2; exit 1 ;;
esac

apt-get update
apt-get install --yes ca-certificates curl xz-utils caddy
task_tmp="$(mktemp -d /tmp/discodicxp-deploy.XXXXXXXX)"
trap 'rm -rf -- "$task_tmp"' EXIT
curl --fail --silent --show-error --location https://nodejs.org/dist/latest-v22.x/SHASUMS256.txt -o "$task_tmp/SHASUMS256.txt"
checksum_line="$(awk -v arch="$node_arch" '$2 ~ ("^node-v22\\.[0-9]+\\.[0-9]+-linux-" arch "\\.tar\\.xz$") { print }' "$task_tmp/SHASUMS256.txt")"
read -r checksum archive <<< "$checksum_line"
if [[ ! "$checksum" =~ ^[a-f0-9]{64}$ || ! "$archive" =~ ^node-v22\.[0-9]+\.[0-9]+-linux-(x64|arm64)\.tar\.xz$ ]]; then
    echo 'Cannot identify the official Node.js archive.' >&2
    exit 1
fi
curl --fail --silent --show-error --location "https://nodejs.org/dist/latest-v22.x/$archive" -o "$task_tmp/$archive"
(cd "$task_tmp" && printf '%s  %s\n' "$checksum" "$archive" | sha256sum --check --status)
tar -xJf "$task_tmp/$archive" -C "$task_tmp"
install -d -m 755 /opt/discodicxp-node
node_directory="${archive%.tar.xz}"
if [[ ! -d "/opt/discodicxp-node/$node_directory" ]]; then
    cp -a "$task_tmp/$node_directory" /opt/discodicxp-node/
fi
ln -sfn "/opt/discodicxp-node/$node_directory" /opt/discodicxp-node/current
if ! id discodicxp-update >/dev/null 2>&1; then
    useradd --system --home-dir /var/lib/discodicxp --shell /usr/sbin/nologin discodicxp-update
fi
install -d -m 755 /opt/discodicxp-update
install -m 644 "$source_dir/"*.mjs /opt/discodicxp-update/
install -d -o root -g discodicxp-update -m 750 /etc/discodicxp
install -d -o discodicxp-update -g discodicxp-update -m 700 /var/lib/discodicxp
if [[ ! -f /etc/discodicxp/devices.json ]]; then
    printf '[]\n' > /etc/discodicxp/devices.json
fi
chown root:discodicxp-update /etc/discodicxp/devices.json
chmod 640 /etc/discodicxp/devices.json
if [[ ! -f /etc/discodicxp/service.env ]]; then
    cat > /etc/discodicxp/service.env <<'CONFIG'
GITHUB_REPOSITORY=Ishimitsu14/DiscodicXP-WoW-Forever
GITHUB_TOKEN=
PORT=8787
CACHE_PATH=/var/lib/discodicxp/cache
DEVICE_KEYS_PATH=/etc/discodicxp/devices.json
CONFIG
fi
chmod 600 /etc/discodicxp/service.env
cat > /etc/systemd/system/discodicxp-update.service <<'SERVICE'
[Unit]
Description=DiscodicXP private release service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=discodicxp-update
Group=discodicxp-update
EnvironmentFile=/etc/discodicxp/service.env
ExecStart=/opt/discodicxp-node/current/bin/node --max-old-space-size=96 /opt/discodicxp-update/index.mjs
Restart=on-failure
RestartSec=5
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/discodicxp
MemoryMax=192M
TasksMax=64
UMask=0077

[Install]
WantedBy=multi-user.target
SERVICE

cp -a /etc/caddy/Caddyfile "$task_tmp/Caddyfile.previous"
if [[ -f /etc/caddy/discodicxp.caddy ]]; then
    cp -a /etc/caddy/discodicxp.caddy "$task_tmp/discodicxp.caddy.previous"
fi
cat > /etc/caddy/discodicxp.caddy <<CADDY
$domain {
    header -Server
    reverse_proxy 127.0.0.1:8787
}
CADDY
if ! grep -Fxq 'import /etc/caddy/discodicxp.caddy' /etc/caddy/Caddyfile; then
    printf '\nimport /etc/caddy/discodicxp.caddy\n' >> /etc/caddy/Caddyfile
fi
if ! caddy validate --config /etc/caddy/Caddyfile --adapter caddyfile; then
    cp -a "$task_tmp/Caddyfile.previous" /etc/caddy/Caddyfile
    if [[ -f "$task_tmp/discodicxp.caddy.previous" ]]; then
        cp -a "$task_tmp/discodicxp.caddy.previous" /etc/caddy/discodicxp.caddy
    else
        rm -f /etc/caddy/discodicxp.caddy
    fi
    echo 'Caddy configuration was restored. Deployment stopped.' >&2
    exit 1
fi
systemctl daemon-reload
systemctl enable --now discodicxp-update caddy
systemctl restart discodicxp-update
systemctl reload caddy
curl --fail --silent --show-error http://127.0.0.1:8787/health
printf '\nService installed. Configure the GitHub credential and device keys before using the launcher.\n'
