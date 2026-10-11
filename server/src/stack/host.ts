// What Finesse needs from whatever runs the stack's apps. Two hosts implement
// it: Docker containers (Linux and NAS installs, orchestrator.ts) and plain
// Windows programs (the native Windows install, native.ts). Setup, the health
// loop and Settings → Server only talk to this, so they work the same on both.

import { ApiError } from '../http/core.ts'
import type { StackContext, StackServiceId } from './catalog.ts'

export interface ProgressSink {
  (event: { service: StackServiceId; phase: 'pull' | 'create' | 'start' | 'wait' | 'ready' | 'skip'; detail?: string; fraction?: number }): void
}

/** One app as its host sees it right now. */
export interface AppState {
  running: boolean
  restarting: boolean
  exitCode: number
  startedAt: string
  /** What it runs: the image (Docker) or the app and version (Windows). */
  image: string
  /** Finesse made it, so Finesse may change or remove it. */
  managed: boolean
  /** It runs an older version or definition than this Finesse ships. */
  updatePending: boolean
}

export interface ManagedApp {
  id: string
  state: string
  status: string
  image: string
}

export interface StackHost {
  readonly kind: 'docker' | 'native'
  /** Whether this host can run the app at all (Windows has no Gluetun, Wolf…). */
  supports(id: StackServiceId): boolean
  /** Where Finesse reaches the app. */
  url(id: StackServiceId): string
  /** Where the other apps reach it (download clients, Jellyfin notifications). */
  peer(id: StackServiceId): { host: string; port: number }
  /** A path in the data folder as the apps see it ("media/movies" → "/data/media/movies" in Docker). */
  appPath(ctx: { hostData: string }, rel: string): string
  /** The host is there and answering (Docker's daemon, or always true for Windows). */
  ping(): Promise<boolean>
  /** Which of the devices the stack cares about exist (/dev/dri, /dev/net/tun…). */
  hostDevices(): Promise<string[]>
  /** Whatever the apps need to find each other (Docker's network). */
  prepareNetwork(ctx: StackContext): Promise<void>
  /** Creates the config and data folders the apps need. */
  ensureDirs(ctx: StackContext, ids: StackServiceId[]): void
  /** Gets the app's pinned version onto this machine (pull, or download and unpack). */
  download(id: StackServiceId, onProgress?: ProgressSink): Promise<void>
  /** Brings one app to its pinned definition and starts it; true when it was (re)created. */
  ensureService(id: StackServiceId, ctx: StackContext, onProgress?: ProgressSink, opts?: { forceRecreate?: boolean }): Promise<boolean>
  /** Polls the app's health path until it answers. */
  waitReady(id: StackServiceId, onProgress?: ProgressSink, timeoutMs?: number, paths?: string[]): Promise<void>
  /** Waits for a line in the app's log since it last started. */
  waitLog(id: StackServiceId, pattern: RegExp, timeoutMs?: number): Promise<boolean>
  /** Null when the app isn't there. */
  state(id: StackServiceId, ctx: StackContext): Promise<AppState | null>
  /** Running right now (false when it isn't there). */
  isRunning(id: StackServiceId): Promise<boolean>
  start(id: StackServiceId): Promise<void>
  stop(id: StackServiceId, seconds?: number): Promise<void>
  restart(id: StackServiceId, seconds?: number): Promise<void>
  /** The last `tail` lines of the app's output (since `since`, in seconds since 1970). */
  logs(id: StackServiceId, tail?: number, since?: number): Promise<string>
  /** Stops and removes the app. Its settings and files stay. */
  removeService(id: StackServiceId): Promise<void>
  /** Every app Finesse runs here, keyed by id. */
  managed(): Promise<Map<string, ManagedApp>>
  /**
   * Runs Jellyfin's own ffmpeg at the lowest priority with `args`, writing to a
   * staging file named `out`. Returns that file's path on this machine once it
   * holds something, else null (and what ffmpeg said).
   */
  ffmpeg(args: string[], out: string, hostRoot: string): Promise<{ file: string | null; output: string }>
  /** Whether a TCP port is free on this machine. */
  hostPortFree(port: number): Promise<boolean>
  /** The first free port at or after `want` (up to +20), or null. */
  freePortFrom(want: number): Promise<number | null>
}

/** Something only Docker installs can do (Games, Wolf, Tailscale in a container…). */
export class NotOnThisHost extends ApiError {
  constructor(what: string) {
    super(409, `${what} isn’t available on Windows yet`)
  }
}
