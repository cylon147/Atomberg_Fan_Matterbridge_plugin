#!/bin/bash
set -euo pipefail

PROD="${HOME}/matterbridge-atomberg-fan"
SRC="${HOME}/Atomberg_Fan_Matterbridge_plugin"

rm -rf "${PROD}"
mkdir -p "${PROD}"
cp -r "${SRC}/dist" "${SRC}/apps" "${PROD}/"
cp "${SRC}/matterbridge-atomberg-fan.schema.json" "${PROD}/"
if [ -f "${SRC}/matterbridge-atomberg-plugin.schema.json" ]; then
  cp "${SRC}/matterbridge-atomberg-plugin.schema.json" "${PROD}/"
fi

node <<'NODE'
const fs = require('fs');
const pkg = JSON.parse(fs.readFileSync('/home/admin/Atomberg_Fan_Matterbridge_plugin/package.json', 'utf8'));
delete pkg.devDependencies;
delete pkg.automator;
fs.writeFileSync('/home/admin/matterbridge-atomberg-fan/package.json', JSON.stringify(pkg, null, 2));
NODE

cd "${PROD}"
npm install --omit=dev --no-fund --no-audit
matterbridge --add "${PROD}"
matterbridge --enable "${PROD}"
echo "Plugin registered at ${PROD}"
