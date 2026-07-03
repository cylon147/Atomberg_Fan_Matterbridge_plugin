#!/bin/bash
set -euo pipefail

echo "=== Installing matter-server (matterjs-server) ==="
sudo npm install -g matter-server --no-fund --no-audit

PRIMARY_IF=$(ip route get 1.1.1.1 2>/dev/null | awk '{for (i=1;i<=NF;i++) if ($i=="dev") {print $(i+1); exit}}')
PRIMARY_IF="${PRIMARY_IF:-eth0}"
echo "Detected primary interface: ${PRIMARY_IF}"

mkdir -p /home/admin/.matter-server

sudo tee /etc/systemd/system/matterjs-server.service > /dev/null <<EOF
[Unit]
Description=Open Home Foundation Matter.js Server
Documentation=https://github.com/matter-js/matterjs-server
After=network-online.target tailscaled.service matterbridge.service
Wants=network-online.target

[Service]
Type=simple
User=admin
Group=admin
WorkingDirectory=/home/admin
Environment=NODE_ENV=production
Environment=HOME=/home/admin
Environment=STORAGE_PATH=/home/admin/.matter-server
Environment=PRODUCTION_MODE=true
Environment=LOG_LEVEL=info
ExecStart=/usr/bin/node --enable-source-maps /usr/lib/node_modules/matter-server/dist/esm/MatterServer.js --storage-path /home/admin/.matter-server --primary-interface ${PRIMARY_IF} --production-mode --enable-test-net-dcl --log-level info
Restart=on-failure
RestartSec=15
TimeoutStartSec=120

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable matterjs-server
sudo systemctl restart matterjs-server

sleep 8
systemctl is-active matterjs-server
curl -s --max-time 10 -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:5580/ || true
node --enable-source-maps /usr/lib/node_modules/matter-server/dist/esm/MatterServer.js --version 2>/dev/null | head -1 || true
echo "=== matterjs-server install complete ==="
