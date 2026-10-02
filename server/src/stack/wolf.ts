// Game streaming on a managed install: what Wolf needs from this machine, in
// words an administrator can act on. Finesse sets Wolf's container up itself;
// these are the parts that live in the host's kernel and drivers.

export interface StreamingProbe {
  /** Host devices that exist (from Orchestrator.hostDevices). */
  devices: string[]
  /** Docker has the Nvidia runtime (the NVIDIA Container Toolkit). */
  nvidiaRuntime: boolean
  /** nvidia-drm loaded with modeset=1; null when there's no Nvidia card. */
  nvidiaModeset: boolean | null
}

export interface StreamingCheckItem {
  id: 'folder' | 'gpu' | 'nvidia-modeset' | 'controllers' | 'dualsense'
  ok: boolean
  title: string
  detail: string
  /** Commands to run on the server, one per line. */
  fix?: string[]
}

export interface StreamingCheck {
  gpu: 'nvidia' | 'intel-amd' | null
  items: StreamingCheckItem[]
  allGood: boolean
  /** Why Wolf can't run here at all (it isn't offered); otherwise absent. */
  blocked?: string
}

/** A unix socket's path holds at most 107 characters (108 with its end marker). */
const SOCKET_PATH_MAX = 107

function folderDetail(runDir: string): string | null {
  if (Buffer.byteLength(`${runDir}/pulse-socket`) <= SOCKET_PATH_MAX) return null
  return `Wolf’s sockets go in ${runDir}, and a socket’s path can be at most ${SOCKET_PATH_MAX} characters. Move Finesse’s folder somewhere shorter, like /srv/finesse.`
}

/** Why Wolf's sockets can't live in this folder, or null when they can. */
export function wolfFolderProblem(runDir: string): string | null {
  const detail = folderDetail(runDir)
  return detail && `Finesse’s folder is too deep for Wolf. ${detail}`
}

export function streamingCheck(p: StreamingProbe, opts: { runDir: string }): StreamingCheck {
  const has = (d: string) => p.devices.includes(d)
  const items: StreamingCheckItem[] = []
  let gpu: StreamingCheck['gpu'] = null

  const folder = folderDetail(opts.runDir)
  if (folder) items.push({ id: 'folder', ok: false, title: 'Finesse’s folder is too deep for Wolf', detail: folder })

  if (has('/dev/nvidia0')) {
    if (p.nvidiaRuntime) {
      gpu = 'nvidia'
      items.push({ id: 'gpu', ok: true, title: 'Nvidia graphics card', detail: 'Wolf runs and streams games on it.' })
      items.push(
        p.nvidiaModeset
          ? { id: 'nvidia-modeset', ok: true, title: 'Nvidia display mode', detail: 'Turned on, as Wolf needs.' }
          : {
              id: 'nvidia-modeset',
              ok: false,
              title: 'Nvidia display mode is off',
              detail: 'Wolf needs the nvidia-drm module loaded with modeset=1, or games show a black screen.',
              fix: ['Add nvidia-drm.modeset=1 to the kernel options (GRUB_CMDLINE_LINUX_DEFAULT in /etc/default/grub)', 'sudo update-grub, then restart the server'],
            },
      )
    } else {
      items.push({
        id: 'gpu',
        ok: false,
        title: 'Nvidia graphics card',
        detail: 'Docker can’t hand it to apps yet, so Wolf would fall back to the processor.',
        fix: ['Install the NVIDIA Container Toolkit (1.16 or newer) and restart Docker', 'On TrueNAS: turn on Install NVIDIA Drivers in the Apps settings'],
      })
    }
  } else if (has('/dev/dri')) {
    gpu = 'intel-amd'
    items.push({ id: 'gpu', ok: true, title: 'Intel or AMD graphics', detail: 'Wolf runs and streams games on it.' })
  } else {
    items.push({
      id: 'gpu',
      ok: false,
      title: 'No graphics card found',
      detail: 'Wolf can still start, using the processor, but games will be too slow to play.',
    })
  }

  items.push(
    has('/dev/uinput')
      ? { id: 'controllers', ok: true, title: 'Virtual controllers', detail: 'Controllers, mouse and keyboard work in games.' }
      : {
          id: 'controllers',
          ok: false,
          title: 'Virtual controllers are off',
          detail: 'Without them, controllers, mouse and keyboard don’t work in games.',
          fix: ['sudo modprobe uinput', 'echo uinput | sudo tee -a /etc/modules-load.d/wolf.conf'],
        },
  )
  items.push(
    has('/dev/uhid')
      ? { id: 'dualsense', ok: true, title: 'PlayStation controllers', detail: 'DualSense extras like the touchpad and motion work.' }
      : {
          id: 'dualsense',
          ok: false,
          title: 'PlayStation controller extras are off',
          detail: 'DualSense controllers work as ordinary gamepads, without the touchpad and motion.',
          fix: ['sudo modprobe uhid', 'echo uhid | sudo tee -a /etc/modules-load.d/wolf.conf'],
        },
  )

  return { gpu, items, allGood: items.every((i) => i.ok), ...(folder ? { blocked: wolfFolderProblem(opts.runDir)! } : {}) }
}
