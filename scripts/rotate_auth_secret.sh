#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/rotate_auth_secret.sh --env=<dev|production>

Generates a new random AUTH_SECRET and stores it with Wrangler for the
selected deployable environment.
EOF
}

env_name=""

for arg in "$@"; do
  case "$arg" in
    --env=*)
      env_name="${arg#--env=}"
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      usage
      exit 2
      ;;
  esac
done

if [[ -z "$env_name" ]]; then
  usage
  exit 2
fi

case "$env_name" in
  dev|production)
    ;;
  test)
    echo "Refusing to rotate AUTH_SECRET for test; test is unit-test only and is not deployed." >&2
    exit 2
    ;;
  *)
    echo "Unknown environment: $env_name" >&2
    usage
    exit 2
    ;;
esac

if ! command -v openssl >/dev/null 2>&1; then
  echo "openssl is required to generate AUTH_SECRET." >&2
  exit 1
fi

secret="$(openssl rand -base64 48)"
printf '%s' "$secret" | pnpm wrangler secret put AUTH_SECRET --env "$env_name"

echo "Rotated AUTH_SECRET for environment: $env_name"
