#!/bin/bash
# Ensures the Atomberg plugin can load after reboot (npm link to global matterbridge).
set -euo pipefail

PLUGIN_DIR="${HOME}/matterbridge-atomberg-fan"
GLOBAL_MB="/usr/lib/node_modules/matterbridge"

if [ ! -d "${PLUGIN_DIR}/dist" ]; then
  echo "Plugin not deployed at ${PLUGIN_DIR}" >&2
  exit 1
fi

if [ -d "${GLOBAL_MB}" ]; then
  npm link -C "${GLOBAL_MB}" --no-fund --no-audit >/dev/null 2>&1 || true
fi

cd "${PLUGIN_DIR}"
npm link matterbridge --no-fund --no-audit >/dev/null 2>&1 || true

# Matterbridge rejects a duplicate package in the plugin tree.
rm -rf "${PLUGIN_DIR}/node_modules/matterbridge" "${PLUGIN_DIR}/node_modules/@matterbridge" 2>/dev/null || true
if [ ! -e "${PLUGIN_DIR}/node_modules/matterbridge" ]; then
  ln -sf "${GLOBAL_MB}" "${PLUGIN_DIR}/node_modules/matterbridge"
fi

exit 0
