// `finesse doctor --json` prints exactly one JSON object (the status, with the connected
// apps inside it), so scripts can parse it. A fake Finesse answers; nothing real is called.

import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { createServer } from 'node:http'
import { join } from 'node:path'
import { test } from 'node:test'
import { listen, tmp } from './helpers.ts'

const STATUS = {
  version: '9.9.9',
  mode: 'adopt',
  setup: { state: 'ready', completedAt: '2026-10-01T00:00:00Z' },
  health: { docker: true, network: true, services: [], vpn: null, disks: [], backups: { last: null }, events: [] },
}
const CONNECTIONS = {
  checkedAt: '2026-10-31T00:00:00Z',
  apps: [{ id: 'radarr', name: 'Radarr', ok: false, summary: '1 problem: open Radarr to fix it', problems: ['Radarr: All indexers are unavailable due to failures'] }],
  vpn: null,
}

function doctor(url: string, args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    const cli = join(import.meta.dirname, '..', 'cli', 'finesse.ts')
    execFile(process.execPath, [cli, 'doctor', ...args], { env: { ...process.env, FINESSE_URL: url, FINESSE_TOKEN: 't', FINESSE_CONFIG_DIR: tmp() } }, (err, stdout) =>
      resolve({ code: err ? Number((err as { code?: number }).code ?? 1) : 0, out: stdout }),
    )
  })
}

test('doctor --json: one object, connected apps inside, and the exit code counts their problems', async () => {
  const srv = createServer((req, res) => {
    const body = req.url === '/api/finesse' ? { name: 'finesse', version: '9.9.9', mode: 'adopt', setup: { state: 'ready' } } : req.url?.startsWith('/api/system/status') ? STATUS : req.url?.startsWith('/api/system/connections') ? CONNECTIONS : null
    res.writeHead(body ? 200 : 404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(body ?? { error: 'nope' }))
  })
  const url = await listen(srv)
  try {
    const r = await doctor(url, ['--json'])
    const parsed = JSON.parse(r.out) as typeof STATUS & { connections: typeof CONNECTIONS }
    assert.equal(parsed.version, '9.9.9')
    assert.deepEqual(parsed.connections, CONNECTIONS)
    assert.equal(r.code, 1)
    // Plain output names the problem too.
    const plain = await doctor(url, [])
    assert.match(plain.out, /Connected apps/)
    assert.match(plain.out, /All indexers are unavailable/)
    assert.match(plain.out, /1 problem found/)
  } finally {
    srv.closeAllConnections()
    srv.close()
  }
})
