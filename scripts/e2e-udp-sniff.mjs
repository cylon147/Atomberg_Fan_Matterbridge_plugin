import dgram from 'node:dgram';

const PORT = 5625;
const TIMEOUT_MS = 15_000;

const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
const packets = [];

socket.on('message', (msg, rinfo) => {
  const preview = msg.toString('utf8').slice(0, 120).replace(/\n/g, '\\n');
  const hexPreview = msg.length <= 80 ? msg.toString('hex').slice(0, 160) : `${msg.toString('hex').slice(0, 80)}...`;
  const line = `${rinfo.address}:${rinfo.port} len=${msg.length} text="${preview}" hex="${hexPreview}"`;
  packets.push(line);
  console.log('PACKET', line);
});

socket.on('error', (err) => {
  console.error('SOCKET ERROR', err.message);
  process.exit(1);
});

socket.bind(PORT, '0.0.0.0', () => {
  console.log(`Listening on 0.0.0.0:${PORT} for ${TIMEOUT_MS}ms...`);
});

setTimeout(() => {
  socket.close();
  console.log('--- SUMMARY ---');
  console.log(`Packets received: ${packets.length}`);
  if (packets.length === 0) {
    console.log('No Atomberg UDP traffic seen. Check fan power, same LAN/Wi-Fi, and Windows firewall for UDP 5625 inbound.');
    process.exit(1);
  }
  process.exit(0);
}, TIMEOUT_MS);
