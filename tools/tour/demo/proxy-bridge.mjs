// Only needed when this machine reaches the internet through a proxy on
// 127.0.0.1 (HTTPS_PROXY=http://127.0.0.1:…): containers can't use the host's
// loopback, so this listens on all interfaces and passes connections through.
//   node demo/proxy-bridge.mjs            (leave it running)
//   TOUR_APP_PROXY=http://<the finesse network's gateway, e.g. 172.18.0.1>:36008 sh demo/up.sh
import net from 'node:net'

const proxy = new URL(process.env.HTTPS_PROXY || process.env.https_proxy || '')
const port = Number(proxy.port)
if (!port) {
  console.error('HTTPS_PROXY isn’t set to a local proxy, so there is nothing to bridge.')
  process.exit(1)
}
const LISTEN = Number(process.env.BRIDGE_PORT || 36008)
net
  .createServer((c) => {
    const u = net.connect(port, proxy.hostname)
    c.pipe(u).pipe(c)
    c.on('error', () => u.destroy())
    u.on('error', () => c.destroy())
  })
  .listen(LISTEN, '0.0.0.0', () => console.log(`bridging :${LISTEN} → ${proxy.hostname}:${port}`))
