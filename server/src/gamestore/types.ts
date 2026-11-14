// The game store's server-side contract. The first half mirrors src/api/gameStore.ts (what the
// pages are built on): keep the two in step; server/test/gamestore.test.ts compares the request
// states and installer kinds. The second half is what the workstreams in
// docs/agents/game-store-plan.md plug into each other with: Provider (WS1), Downloader (WS2),
// InstallPlan / InstallOutcome (WS3), SandboxRunner (WS4 Linux, WS5 Windows), Player (WS6).
// Types only, so anything may import it.

import type { ChecksumEntry } from '../downloadCheck.ts'
import type { InstallerKind, Sniffed } from '../installerSniff.ts'

export type { InstallerKind }

// ---------- what the app sees (mirrors src/api/gameStore.ts) ----------

export type GameMode = 'single' | 'local' | 'online'
export type GamePlatform = 'windows' | 'linux'

export interface StoreGame {
  id: string
  title: string
  summary: string
  description?: string
  developer?: string
  year?: number
  genres: string[]
  modes: GameMode[]
  platforms: GamePlatform[]
  license?: string
  website?: string
  cover?: string
  hero?: string
  screenshots?: string[]
  addedAt: string
}

export interface StoreSource {
  id: string
  platform: GamePlatform
  installer: InstallerKind
  sizeBytes: number
  version?: string
  verified?: boolean
}

export interface StoreGameDetail {
  game: StoreGame
  sources: StoreSource[]
  similar: StoreGame[]
}

export type StoreSort = 'popular' | 'new' | 'name' | 'year'

export interface StoreQuery {
  q?: string
  genres?: string[]
  platform?: GamePlatform
  mode?: GameMode
  sort?: StoreSort
  offset?: number
  limit?: number
}

export interface StorePage {
  items: StoreGame[]
  total: number
  nextOffset?: number
}

export interface Facet {
  value: string
  label: string
  count: number
}

export interface StoreFacets {
  genres: Facet[]
  platforms: Facet[]
  modes: Facet[]
}

export interface StoreShelf {
  id: string
  title: string
  query: StoreQuery
  items: StoreGame[]
}

export interface StoreHome {
  featured: StoreGame[]
  shelves: StoreShelf[]
}

export const REQUEST_STATES = ['queued', 'downloading', 'paused', 'checking', 'installing', 'needs-you', 'finishing', 'ready', 'failed'] as const
export type GameRequestState = (typeof REQUEST_STATES)[number]

export interface GameRequest {
  id: string
  gameId: string
  title: string
  cover?: string
  sourceId: string
  platform: GamePlatform
  installer: InstallerKind
  state: GameRequestState
  progress?: number
  bytesPerSecond?: number
  etaSeconds?: number
  sizeBytes?: number
  detail?: string
  requestedBy?: string
  createdAt: string
  updatedAt: string
}

// ---------- WS1: where games come from ----------

/** A game as the catalogue keeps it: what the app sees, plus what orders "Popular". */
export interface CatalogueGame extends StoreGame {
  /** Higher = more popular (a provider's own figure, or IGDB's). */
  popularity: number
  /** Which provider it came from. */
  provider: string
}

/** A download as the server keeps it. Where it comes from never reaches a browser. */
export interface CatalogueSource extends StoreSource {
  gameId: string
  /** Exactly one of these: a magnet for the downloader, or a direct address. */
  magnet?: string
  url?: string
  /** The store's own checksums for the files (the only ones that say they're genuine). */
  checksums?: ChecksumEntry[]
  /** The file in the download that is the installer, when the provider knows. */
  installerHint?: string
}

/** A source of games, set up by whoever runs the server (Finesse ships none). */
export interface Provider {
  id: string
  name: string
  /** Everything it has, for the catalogue sync (paged by the provider itself). */
  list(): AsyncIterable<{ game: CatalogueGame; sources: CatalogueSource[] }>
}

// ---------- WS2: downloading ----------

export interface DownloadStatus {
  state: 'queued' | 'downloading' | 'paused' | 'done' | 'error' | 'missing'
  /** 0–100. */
  progress: number
  bytesPerSecond?: number
  etaSeconds?: number
  /** Where the finished files are, as Finesse reads them. */
  folder?: string
  /** Why, in the downloader's words, when state is error. */
  reason?: string
}

export interface Downloader {
  /** Whether it can take a download right now (the VPN is up, it answers), and why not. */
  available(): Promise<{ ok: true } | { ok: false; why: string }>
  add(job: { id: string; magnet?: string; url?: string; sizeBytes: number }): Promise<void>
  status(id: string): Promise<DownloadStatus>
  pause(id: string): Promise<void>
  resume(id: string): Promise<void>
  /** Stop it; with `files`, delete what it downloaded too. */
  remove(id: string, opts: { files: boolean }): Promise<void>
}

// ---------- WS3: installing ----------

/** The four ways of getting a game installed, tried in this order (the plan's tiers). */
export type Tier = 'unpack' | 'silent' | 'auto-click' | 'needs-you'
export type UnpackTool = NonNullable<Sniffed['unpack']>

/** One file of a finished download, with what its bytes say it is. */
export interface SurveyedFile {
  /** Relative to the download folder, forward slashes. */
  path: string
  size: number
  sniffed: Sniffed
}

export interface InstallStep {
  tier: Tier
  /** unpack: the tool, and the file it opens. */
  tool?: UnpackTool
  file?: string
  /** silent / auto-click: the installer and its switches (<dir> and <log> are filled in by the runner). */
  command?: string[]
  /** Why this step is here, in plain words (shown in the request's log). */
  why: string
}

export interface InstallPlan {
  /** The file everything starts from (an installer, an archive, or the game itself), or null. */
  installer: string | null
  kind: InstallerKind
  format: string
  /** A Linux build: nothing here needs the Windows layer. */
  linux: boolean
  steps: InstallStep[]
  notes: string[]
}

/** A top-level window on the sandbox's screen, as the window helper reports it. */
export interface WindowInfo {
  title: string
  /** The window class ("#32770" is a dialog box). */
  class: string
  /** Text of its labels, joined. */
  text: string
  buttons: string[]
  /** It has a box to type in or a list to choose from. */
  wantsInput: boolean
}

export interface RunResult {
  /** The exit code, or null when it was stopped. */
  exit: number | null
  /** Stopped because nothing was happening (no files written, no CPU) for the hang limit. */
  hung: boolean
  /** The tail of the tool's or the installer's own log. */
  log: string
}

export interface LaunchResult {
  /** What was on screen when the check ended. */
  windows: WindowInfo[]
  /** A screenshot that isn't blank was taken (and where, relative to the job folder). */
  screenshot?: string
  /** The program had already exited, with this code. */
  exited?: number
  log: string
}

/**
 * Where installing happens: a container with no network on Linux (WS4), Windows Sandbox or the
 * low-privilege account on Windows (WS5). Paths are relative to the job: `download/` is
 * read-only, `install/` is the only place anything can write.
 */
export interface SandboxRunner {
  host: 'linux' | 'windows'
  /** What an unpack tool can open: e.g. the newest Inno Setup version innoextract reads. */
  supports(tool: UnpackTool): { maxVersion?: string }
  /** What's inside, without unpacking (innoextract --list, 7z l). Empty when the tool can't say. */
  list(tool: UnpackTool, file: string): Promise<string[]>
  unpack(tool: UnpackTool, file: string, into: string, onProgress?: (bytes: number) => void): Promise<RunResult>
  /** Run an installer (or a Linux install script). Stops everything in the sandbox on a hang. */
  install(command: string[], opts: { hangAfterMs: number; onProgress?: (bytes: number) => void }): Promise<RunResult>
  /** Every file under a folder of the job (after unpacking or installing). */
  files(dir: string): Promise<{ path: string; size: number }[]>
  /** Start a program and report what's on screen after it settles (or it exits). */
  launch(program: string, opts: { waitMs: number }): Promise<LaunchResult>
  /** The windows on screen now, and clicking a button in one by its label. */
  windows(): Promise<WindowInfo[]>
  click(window: WindowInfo, button: string): Promise<boolean>
  /** Stop everything running in the sandbox (the job itself stays for the next step). */
  stop(): Promise<void>
}

export type InstallOutcome =
  | { state: 'ready'; by: Tier; program: string; dir: string; screenshot?: string; log: string[] }
  | { state: 'needs-you'; waitingOn?: string; why: string; log: string[] }
  | { state: 'failed'; reason: string; log: string[] }

// ---------- WS6: playing ----------

export type PlayWay = 'server' | 'stream'

export interface Player {
  way: PlayWay
  /** Whether this way works on this server right now, and why not, in words. */
  available(): Promise<{ ok: true } | { ok: false; why: string }>
  start(game: { id: string; title: string; dir: string; program: string; linux: boolean }): Promise<{ sessionId?: string }>
}
