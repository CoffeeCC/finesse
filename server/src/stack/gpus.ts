// Finds the graphics cards on the host (graphics.ts plans what uses them):
//   1. the host's /sys/class/drm render nodes (vendor, PCI address, driver,
//      memory) and NVIDIA's /proc/driver/nvidia (model, UUID), read by a
//      short-lived probe container with both mounted read-only;
//   2. each card is then tested: a 2-second test-pattern conversion in a
//      short-lived container given only that card (NVIDIA: h264_nvenc through
//      the NVIDIA runtime, pinned by UUID; Intel/AMD: h264_vaapi on its render
//      node), using Jellyfin's image, which has ffmpeg. A card can look fine
//      and still fail here (a broken driver state, or a card containers
//      can't use), and then nothing is given it. The same container then
//      decodes a one-second clip of each codec Jellyfin may hand the card
//      (HEVC, 10-bit HEVC, VP9, 10-bit VP9, AV1) on the card itself: Jellyfin
//      is told to decode only what passed (and H.264, which every card does).
// A probe that couldn't finish, or Docker not saying which runtimes it has,
// leaves the inventory "unknown" (complete: false): nothing is planned from it.
// Every probe container is Finesse's own (finesse.managed=true) and removed
// when it ends.

import { existsSync, readdirSync, readFileSync, readlinkSync } from 'node:fs'
import { basename } from 'node:path'
import { DockerError, type Docker } from './docker.ts'
import { DRI_DECODE_DEFAULT, nvidiaDecode, nvidiaSessionLimit, type Gpu, type Inventory, type Vendor } from './graphics.ts'

const VENDORS: Record<string, Vendor> = { '0x10de': 'nvidia', '0x8086': 'intel', '0x1002': 'amd', '0x1022': 'amd' }

/** The probe's script: one "R" line per render node, one "N" block per NVIDIA card, then "END" (it finished). */
export const PROBE_SCRIPT = [
  '[ -d /host/sys/class ] || exit 3;',
  'for d in /host/sys/class/drm/renderD*; do [ -e "$d" ] || continue;',
  'v=$(cat $d/device/vendor 2>/dev/null); i=$(cat $d/device/device 2>/dev/null);',
  'p=$(basename $(readlink -f $d/device)); r=$(basename $(readlink -f $d/device/driver) 2>/dev/null);',
  'm=$(cat $d/device/mem_info_vram_total 2>/dev/null || echo -);',
  'echo "R $(basename $d) $v $i $p ${r:--} $m"; done;',
  'for f in /host/nvidia/gpus/*/information; do [ -e "$f" ] && { echo "N"; cat "$f"; }; done; echo END',
].join(' ')

/** Whether a probe's output is a finished look (pure): its "END", or at least one card. Empty output is never "no cards". */
export function probeComplete(text: string): boolean {
  return /^END$/m.test(text) || /^(R renderD\d+ |N$)/m.test(text)
}

/** Reads the probe's output into cards (pure). */
export function parseProbe(text: string): Gpu[] {
  const nodes: { node: string; vendor: Vendor; device: string; pci: string; driver: string; vram: number | null }[] = []
  const nvidia: { model: string; uuid: string; pci: string }[] = []
  let cur: { model: string; uuid: string; pci: string } | null = null
  for (const line of text.split('\n')) {
    const r = /^R (renderD\d+) (0x[0-9a-f]+) (0x[0-9a-f]+) (\S+) (\S+) (\S+)/i.exec(line.trim())
    if (r) {
      nodes.push({ node: r[1]!, vendor: VENDORS[r[2]!.toLowerCase()] ?? 'other', device: r[3]!.toLowerCase(), pci: r[4]!.toLowerCase(), driver: r[5]!, vram: /^\d+$/.test(r[6]!) ? Number(r[6]) : null })
      continue
    }
    if (line.trim() === 'N') {
      cur = { model: '', uuid: '', pci: '' }
      nvidia.push(cur)
      continue
    }
    const kv = /^([^:]+):\s*(.*)$/.exec(line.trim())
    if (cur && kv) {
      const [k, v] = [kv[1]!.trim(), kv[2]!.trim()]
      if (k === 'Model') cur.model = v
      // "GPU-????????-…" when the driver can't read it: unknown, and never planned with.
      else if (k === 'GPU UUID') cur.uuid = v.includes('?') ? '' : v
      else if (k === 'Bus Location') cur.pci = v.toLowerCase()
    }
  }
  const out: Gpu[] = []
  for (const n of nvidia) {
    const node = nodes.find((x) => x.pci === n.pci)
    const name = n.model ? (n.model.startsWith('NVIDIA') ? n.model : `NVIDIA ${n.model}`) : 'NVIDIA graphics card'
    out.push({
      id: n.uuid ? `nvidia:${n.uuid}` : `nvidia:${n.pci}`,
      vendor: 'nvidia',
      name,
      integrated: false,
      pci: n.pci,
      ...(node ? { renderNode: `/dev/dri/${node.node}` } : {}),
      ...(n.uuid ? { uuid: n.uuid } : {}),
      encodes: null,
      sessionLimit: nvidiaSessionLimit(name),
      decode: nvidiaDecode(name),
    })
  }
  for (const n of nodes) {
    if (n.vendor === 'nvidia' && out.some((g) => g.pci === n.pci)) continue
    const vramMiB = n.vram ? Math.round(n.vram / 1048576) : undefined
    // Intel's built-in graphics always sits at 00:02.0; AMD's built-in ones have little memory of their own.
    const integrated = n.vendor === 'intel' ? /:00:02\.0$/.test(n.pci) : n.vendor === 'amd' ? (vramMiB ?? 0) <= 2048 : false
    const label = n.vendor === 'intel' ? (integrated ? 'Intel graphics (built in)' : 'Intel Arc graphics card') : n.vendor === 'amd' ? (integrated ? 'AMD graphics (built in)' : 'AMD Radeon graphics card') : n.vendor === 'nvidia' ? 'NVIDIA graphics card' : 'Graphics device'
    out.push({
      // By PCI address: render node numbers can change between boots; the node is looked up each time.
      id: `dri:${n.pci !== '-' ? n.pci : n.node}`,
      vendor: n.vendor,
      name: label,
      integrated,
      pci: n.pci,
      renderNode: `/dev/dri/${n.node}`,
      ...(vramMiB ? { vramMiB } : {}),
      encodes: null,
      sessionLimit: n.vendor === 'nvidia' ? 8 : null,
      decode: n.vendor === 'intel' || n.vendor === 'amd' ? [...DRI_DECODE_DEFAULT] : [],
    })
  }
  return out
}

/** The probe output read straight from this machine (Finesse not in Docker: development). */
function localProbe(): string {
  const lines: string[] = []
  try {
    for (const n of readdirSync('/sys/class/drm').filter((f) => /^renderD\d+$/.test(f))) {
      const d = `/sys/class/drm/${n}/device`
      const read = (f: string) => {
        try {
          return readFileSync(`${d}/${f}`, 'utf8').trim()
        } catch {
          return '-'
        }
      }
      const link = (f: string) => {
        try {
          return basename(readlinkSync(f))
        } catch {
          return '-'
        }
      }
      lines.push(`R ${n} ${read('vendor')} ${read('device')} ${link(d)} ${link(`${d}/driver`)} ${read('mem_info_vram_total')}`)
    }
  } catch {
    /* no graphics */
  }
  try {
    if (existsSync('/proc/driver/nvidia/gpus')) for (const b of readdirSync('/proc/driver/nvidia/gpus')) lines.push('N', readFileSync(`/proc/driver/nvidia/gpus/${b}/information`, 'utf8'))
  } catch {
    return ''
  }
  if (existsSync('/sys/class')) lines.push('END')
  return lines.join('\n')
}

/** What a failed test said, in a few words. */
export function testProblem(output: string): string {
  const lines = output.split('\n').map((l) => l.trim()).filter(Boolean)
  const hit = lines.find((l) => /no cuda-capable device|unsupported device|cannot load|openencodesession|no capable devices|failed to initialise|operation not permitted|no such file/i.test(l))
  const line = (hit ?? lines.filter((l) => !/^(NVENC|VAAPI)_OK$/.test(l)).pop() ?? 'no answer').replace(/^\[[^\]]*\]\s*/, '')
  return line.length > 120 ? `${line.slice(0, 117)}…` : line
}

const FFMPEG = '/usr/lib/jellyfin-ffmpeg/ffmpeg'

/** The codecs the test decodes on the card: Jellyfin's name, the encoder making the clip, its pixel format, and the frames it comes back as. */
export const DECODE_TESTS: [name: string, encoder: string, pix: string, hwFormat: string][] = [
  ['hevc', '-c:v libx265 -x265-params log-level=none', 'yuv420p', 'nv12'],
  ['hevc-10bit', '-c:v libx265 -x265-params log-level=none', 'yuv420p10le', 'p010le'],
  ['vp9', '-c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 1M', 'yuv420p', 'nv12'],
  ['vp9-10bit', '-c:v libvpx-vp9 -deadline realtime -cpu-used 8 -b:v 1M', 'yuv420p10le', 'p010le'],
  ['av1', '-c:v libsvtav1 -preset 12', 'yuv420p', 'nv12'],
]

/**
 * A shell function and its calls: each codec's one-second clip is made on the processor, then
 * decoded on the card with its frames kept there (`hw`). ffmpeg quietly decodes on the processor
 * when the card can't, so the frames are downloaded from the card: that fails unless the card
 * decoded them. Prints "DEC <name>" for each that passed.
 */
export function decodeScript(hw: string): string {
  const calls = DECODE_TESTS.map(([name, enc, pix, fmt]) => `d ${name} '${enc}' ${pix} ${fmt}`).join('; ')
  return (
    `d() { $T ${FFMPEG} -nostdin -hide_banner -loglevel error -f lavfi -i testsrc2=duration=1:size=640x360:rate=24 -pix_fmt $3 $2 -y /tmp/t-$1.mkv >/dev/null 2>&1 || return 0; ` +
    `$T ${FFMPEG} -nostdin -hide_banner -loglevel error ${hw} -i /tmp/t-$1.mkv -vf "hwdownload,format=$4" -f null - >/dev/null 2>&1 && echo "DEC $1"; return 0; }; ${calls}`
  )
}

/** The codecs a card decoded in its test (pure): H.264 always, and every "DEC" line. */
export function decodedBy(output: string, always: string[]): string[] {
  const got = new Set(always)
  for (const m of output.matchAll(/^DEC (\S+)$/gm)) if (DECODE_TESTS.some(([n]) => n === m[1])) got.add(m[1]!)
  return [...got]
}

/**
 * Tests one card with a 2-second conversion, then a decode of each codec, in a container given
 * only that card. A container Docker couldn't start for the card is a failed test; Docker not
 * answering is no test at all (encodes null).
 */
export async function testCard(docker: Docker, image: string, g: Gpu): Promise<Pick<Gpu, 'encodes' | 'problem' | 'vramMiB'> & { decode?: string[] }> {
  const src = '-f lavfi -i testsrc2=duration=2:size=1280x720:rate=30'
  const T = `T=; command -v timeout >/dev/null 2>&1 && T='timeout 45';`
  const failed = (e: unknown) => (e instanceof DockerError && e.status > 0 ? { code: -1, output: String((e as Error).message), data: null } : null)
  if (g.vendor === 'nvidia' && g.uuid) {
    const script = `${T} if $T ${FFMPEG} -nostdin -hide_banner -loglevel error ${src} -c:v h264_nvenc -f null - ; then echo NVENC_OK; ${decodeScript('-hwaccel cuda -hwaccel_output_format cuda')}; fi; nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits 2>/dev/null | sed 's/^/MEM /'; true`
    const r = await docker
      .runJob(image, ['sh', '-c', script], {
        env: [`NVIDIA_VISIBLE_DEVICES=${g.uuid}`, 'NVIDIA_DRIVER_CAPABILITIES=compute,video,utility'],
        host: { DeviceRequests: [{ Driver: 'nvidia', DeviceIDs: [g.uuid], Capabilities: [['gpu']] }] },
        timeoutMs: 150000,
        service: 'gpu-test',
      })
      .catch(failed)
    if (!r) return { encodes: null }
    const mem = /MEM (\d+)/.exec(r.output)
    const ok = /NVENC_OK/.test(r.output)
    // Every NVDEC card decodes MPEG-2 and VC-1; the rest only as tested.
    return { encodes: ok, ...(ok ? { decode: decodedBy(r.output, ['h264', 'mpeg2video', 'vc1']) } : { problem: testProblem(r.output) }), ...(mem ? { vramMiB: Number(mem[1]) } : {}) }
  }
  if ((g.vendor === 'intel' || g.vendor === 'amd') && g.renderNode) {
    const script = `${T} if $T ${FFMPEG} -nostdin -hide_banner -loglevel error -vaapi_device ${g.renderNode} ${src} -vf format=nv12,hwupload -c:v h264_vaapi -f null - ; then echo VAAPI_OK; ${decodeScript(`-hwaccel vaapi -hwaccel_device ${g.renderNode} -hwaccel_output_format vaapi`)}; fi; true`
    const r = await docker
      .runJob(image, ['sh', '-c', script], { host: { Devices: [{ PathOnHost: g.renderNode, PathInContainer: g.renderNode, CgroupPermissions: 'rwm' }] }, timeoutMs: 150000, service: 'gpu-test' })
      .catch(failed)
    if (!r) return { encodes: null }
    const ok = /VAAPI_OK/.test(r.output)
    return { encodes: ok, ...(ok ? { decode: decodedBy(r.output, DRI_DECODE_DEFAULT) } : { problem: testProblem(r.output) }) }
  }
  return { encodes: null }
}

/**
 * The host's cards, each tested. `probeImage` runs the read-only look (Finesse's own image);
 * `testImage` runs the test conversions (an image with Jellyfin's ffmpeg), or null to skip them.
 */
export async function probeGpus(docker: Docker, opts: { probeImage: string; testImage: string | null; inDocker: boolean }): Promise<Inventory> {
  const info = (await docker.info().catch(() => null)) as { Runtimes?: Record<string, unknown> } | null
  const nvidiaRuntime = Boolean(info?.Runtimes && 'nvidia' in info.Runtimes)
  let text = ''
  if (!opts.inDocker) text = localProbe()
  else {
    // /proc/driver/nvidia only exists with NVIDIA's driver loaded: try with it, then without.
    const withNvidia = await docker.runOnce(opts.probeImage, ['sh', '-c', PROBE_SCRIPT], ['/sys:/host/sys:ro', '/proc/driver/nvidia:/host/nvidia:ro']).catch(() => null)
    const r = withNvidia?.code === 0 ? withNvidia : await docker.runOnce(opts.probeImage, ['sh', '-c', PROBE_SCRIPT], ['/sys:/host/sys:ro']).catch(() => null)
    text = r?.code === 0 ? r.output : ''
  }
  // Unknown, not "no cards": Docker didn't say what it can run, or the look didn't finish.
  if (!info || !probeComplete(text)) return { checkedAt: new Date().toISOString(), gpus: [], nvidiaRuntime, complete: false }
  const gpus = parseProbe(text)
  if (opts.testImage) {
    for (const g of gpus) {
      if (g.vendor === 'nvidia' && !nvidiaRuntime) continue
      Object.assign(g, await testCard(docker, opts.testImage, g))
    }
  }
  return { checkedAt: new Date().toISOString(), gpus, nvidiaRuntime, complete: true }
}
