#!/usr/bin/env bash
# Provision gogcli credentials from environment variables.
# Runs before the gateway starts so gog can authenticate with Gmail API.
#
# Required env vars:
#   XDG_CONFIG_HOME          — base config dir (e.g. /data/.config)
#   GOG_OAUTH_CLIENT_ID      — OAuth client ID
#   GOG_OAUTH_CLIENT_SECRET  — OAuth client secret
#   GOG_KEYRING_TOKEN_EMMA   — encrypted keyring token for assistant.emmajones@gmail.com
#   GOG_KEYRING_TOKEN_EMMA_DEFAULT — encrypted keyring token (default client)
#
# Optional:
#   GOG_KEYRING_BACKEND      — keyring backend (default: file)

set -euo pipefail

CONFIG_DIR="${XDG_CONFIG_HOME:-/data/.config}/gogcli"
KEYRING_DIR="$CONFIG_DIR/keyring"

if [ -z "${GOG_OAUTH_CLIENT_ID:-}" ] || [ -z "${GOG_OAUTH_CLIENT_SECRET:-}" ]; then
  echo "[init-gog] GOG_OAUTH_CLIENT_ID or GOG_OAUTH_CLIENT_SECRET not set, skipping"
  exit 0
fi

mkdir -p "$CONFIG_DIR" "$KEYRING_DIR"

# Write credentials.json
cat > "$CONFIG_DIR/credentials.json" <<EOF
{
  "client_id": "${GOG_OAUTH_CLIENT_ID}",
  "client_secret": "${GOG_OAUTH_CLIENT_SECRET}"
}
EOF

# Write config.json
cat > "$CONFIG_DIR/config.json" <<EOF
{
  "keyring_backend": "${GOG_KEYRING_BACKEND:-file}"
}
EOF

# Write keyring token files (if provided)
if [ -n "${GOG_KEYRING_TOKEN_EMMA:-}" ]; then
  printf '%s' "$GOG_KEYRING_TOKEN_EMMA" > "$KEYRING_DIR/token:assistant.emmajones@gmail.com"
fi

if [ -n "${GOG_KEYRING_TOKEN_EMMA_DEFAULT:-}" ]; then
  printf '%s' "$GOG_KEYRING_TOKEN_EMMA_DEFAULT" > "$KEYRING_DIR/token:default:assistant.emmajones@gmail.com"
fi

# Secure permissions
chmod 700 "$CONFIG_DIR" "$KEYRING_DIR"
chmod 600 "$CONFIG_DIR/credentials.json" "$CONFIG_DIR/config.json"
find "$KEYRING_DIR" -type f -exec chmod 600 {} +

echo "[init-gog] Credentials provisioned at $CONFIG_DIR"
