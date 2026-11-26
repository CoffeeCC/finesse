import assert from 'node:assert/strict'
import { test } from 'node:test'
import { Roku, homeAddress, isRokuSession, type Ecp } from '../src/roku.ts'
import type { Jellyfin } from '../src/jellyfin.ts'

const ITEM = 'a'.repeat(32)
const ME = { Id: 'b'.repeat(32), Name: 'me', Policy: { IsAdministrator: false } }
const ADMIN = { Id: 'c'.repeat(32), Name: 'admin', Policy: { IsAdministrator: true } }

// A Jellyfin with one Jellyfin Roku session (signed in as ME), a phone, and one movie.
function setup(over: { endpoint?: string; ecp?: Partial<Record<string, number>>; type?: string } = {}) {
  const calls: string[] = []
  const sessions = [
    { Id: 'roku1', UserId: ME.Id, Client: 'Jellyfin Roku', DeviceName: 'Living room', RemoteEndPoint: over.endpoint ?? '192.168.8.121', SupportsRemoteControl: false, PlayState: { IsPaused: false } },
    { Id: 'phone', UserId: ME.Id, Client: 'Jellyfin Android', RemoteEndPoint: '192.168.8.50', SupportsRemoteControl: true },
  ]
  const jf = {
    request: async (path: string) => {
      if (path.startsWith('/Sessions')) return sessions
      if (path.startsWith('/Items?ids=')) return { Items: path.includes(ITEM) ? [{ Id: ITEM, Type: over.type ?? 'Movie' }] : [] }
      throw new Error(path)
    },
  } as unknown as Jellyfin
  const ecp: Ecp = async (ip, method, path) => {
    calls.push(`${method} ${ip}${path}`)
    if (path === '/query/device-info') return { status: over.ecp?.info ?? 200, text: '<device-info><model-name>40H4+</model-name></device-info>' }
    return { status: over.ecp?.launch ?? 204, text: '' }
  }
  return { roku: new Roku(jf, ecp), calls }
}

test('home addresses only', () => {
  assert.equal(homeAddress('192.168.8.121'), '192.168.8.121')
  assert.equal(homeAddress('::ffff:10.0.0.4'), '10.0.0.4')
  assert.equal(homeAddress('172.20.1.1:51234'), '172.20.1.1')
  assert.equal(homeAddress('172.32.1.1'), null)
  assert.equal(homeAddress('8.8.8.8'), null)
  assert.equal(homeAddress('127.0.0.1'), null)
  assert.equal(homeAddress('169.254.1.1'), null)
  assert.equal(homeAddress('example.com'), null)
})

test('a Jellyfin Roku session Jellyfin can’t drive is a Roku target', () => {
  assert.ok(isRokuSession({ Id: 'x', Client: 'Jellyfin Roku', SupportsRemoteControl: false }))
  assert.ok(!isRokuSession({ Id: 'x', Client: 'Jellyfin Roku', SupportsRemoteControl: true }), 'one Jellyfin can drive goes the usual way')
  assert.ok(!isRokuSession({ Id: 'x', Client: 'Jellyfin Web' }))
})

test('lists the Roku that answers on the home network, for its own user and admins', async () => {
  const { roku } = setup()
  assert.deepEqual(await roku.targets(ME), ['roku1'])
  assert.deepEqual(await roku.targets(ADMIN), ['roku1'])
  assert.deepEqual(await roku.targets({ Id: 'd'.repeat(32), Name: 'other', Policy: {} }), [])
  assert.deepEqual(await setup({ endpoint: '203.0.113.9' }).roku.targets(ME), [], 'not on the home network')
  assert.deepEqual(await setup({ ecp: { info: 404 } }).roku.targets(ME), [], 'doesn’t answer as a Roku')
})

test('plays a movie through the Jellyfin channel’s deep link', async () => {
  const { roku, calls } = setup()
  await roku.play(ME, 'roku1', ITEM)
  assert.equal(calls.at(-1), `POST 192.168.8.121/launch/592369?contentId=${ITEM}&mediaType=movie`)
  const ep = setup({ type: 'Episode' })
  await ep.roku.play(ME, 'roku1', ITEM)
  assert.match(ep.calls.at(-1)!, /mediaType=episode$/)
})

test('refuses what it shouldn’t do, in plain words', async () => {
  const { roku } = setup()
  await assert.rejects(roku.play(ME, 'roku1', 'f-friend-' + ITEM), /Only titles on this server/)
  await assert.rejects(roku.play(ME, 'roku1', 'e'.repeat(32)), /isn’t available to you/)
  await assert.rejects(roku.play(ME, 'phone', ITEM), /isn’t on any more/)
  await assert.rejects(roku.play({ Id: 'd'.repeat(32), Name: 'x', Policy: {} }, 'roku1', ITEM), /someone else’s account/)
  await assert.rejects(setup({ type: 'BoxSet' }).roku.play(ME, 'roku1', ITEM), /can’t play this kind/)
  await assert.rejects(setup({ ecp: { launch: 403 } }).roku.play(ME, 'roku1', ITEM), /Control by mobile apps/)
})

test('mini remote: play/pause and stop as Roku keys; pausing a paused Roku does nothing', async () => {
  const { roku, calls } = setup()
  await roku.press(ME, 'roku1', 'Pause')
  assert.equal(calls.at(-1), 'POST 192.168.8.121/keypress/Play')
  await roku.press(ME, 'roku1', 'Stop')
  assert.equal(calls.at(-1), 'POST 192.168.8.121/keypress/Back')
  await assert.rejects(roku.press(ME, 'roku1', 'Seek'), /its own remote/)
})
