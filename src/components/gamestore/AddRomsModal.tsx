// Add ROMs Modal: drag-and-drop / file & folder upload with automatic extension,
// zip-peek, and folder-name console detection, plus 1-click server/SD folder import.

import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react'
import { createPortal } from 'react-dom'
import { useQueryClient } from '@tanstack/react-query'
import { formatSize } from '../../api/gameStore'
import { retroApi, type RetroImportPreview, type RetroImportResult } from '../../api/retro'
import { pushBackHandler } from '../../lib/back'
import { IS_TV, useIsTouch } from '../../lib/device'
import { fromInput, readDrop, ROM_SYSTEMS, SYSTEM_CHOICES, type Dropped, type Planned } from '../../lib/mediaSort'
import { useOverlayFocus } from '../../lib/overlayFocus'
import { cancel, confirmReview, enqueue, retry, useUploads } from '../../lib/uploads'
import { detectConsoleFromZip } from '../../lib/zipPeek'
import { Spinner } from '../../pages/setup/ui'
import { useToast } from '../Toast'

export interface AddRomsModalProps {
  open: boolean
  onClose: () => void
  /** Pre-selected console slug when opened from a specific console shelf. */
  defaultConsole?: string
  /** Open directly on upload or server folder import tab. */
  initialTab?: 'upload' | 'import'
  /** Files dragged directly onto the Games page to pre-stage in the modal. */
  initialFiles?: Dropped[]
}

/** Complete canonical console choices for dropdowns (SYSTEM_CHOICES + modern & extra RomM slugs). */
const MODAL_CONSOLES: [string, string][] = (() => {
  const extra: [string, string][] = [
    ['3ds', 'Nintendo 3DS'],
    ['wiiu', 'Wii U'],
    ['switch', 'Nintendo Switch'],
    ['ps3', 'PlayStation 3'],
    ['segacd', 'Sega CD'],
    ['atari2600', 'Atari 2600'],
  ]
  const seen = new Set(SYSTEM_CHOICES.map(([id]) => id))
  const merged = [...SYSTEM_CHOICES]
  for (const pair of extra) {
    if (!seen.has(pair[0])) merged.push(pair)
  }
  return merged
})()

const CONSOLE_LABEL = new Map<string, string>(MODAL_CONSOLES)

/** Folder & slug aliases → canonical RomM console slug. */
const CONSOLE_ALIAS: Record<string, string> = {
  nes: 'nes', fc: 'nes', famicom: 'nes', 'nintendo-entertainment-system': 'nes',
  snes: 'snes', sfc: 'snes', sfam: 'snes', 'super-nintendo': 'snes', 'super-famicom': 'snes', 'super-nintendo-entertainment-system': 'snes',
  n64: 'n64', 'nintendo-64': 'n64',
  gb: 'gb', 'game-boy': 'gb', gameboy: 'gb',
  gbc: 'gbc', 'game-boy-color': 'gbc', gameboycolor: 'gbc',
  gba: 'gba', 'game-boy-advance': 'gba', gameboyadvance: 'gba',
  nds: 'nds', ds: 'nds', 'nintendo-ds': 'nds',
  '3ds': '3ds', n3ds: '3ds', 'nintendo-3ds': '3ds',
  gamecube: 'gamecube', gc: 'gamecube', gcn: 'gamecube', ngc: 'gamecube',
  wii: 'wii', 'nintendo-wii': 'wii',
  wiiu: 'wiiu', 'wii-u': 'wiiu',
  switch: 'switch', nsw: 'switch', 'nintendo-switch': 'switch',
  psx: 'psx', ps1: 'psx', psone: 'psx', playstation: 'psx', playstation1: 'psx', 'playstation-1': 'psx',
  ps2: 'ps2', playstation2: 'ps2', 'playstation-2': 'ps2',
  ps3: 'ps3', playstation3: 'ps3', 'playstation-3': 'ps3',
  psp: 'psp', 'playstation-portable': 'psp',
  genesis: 'genesis', md: 'genesis', megadrive: 'genesis', 'mega-drive': 'genesis', 'sega-genesis': 'genesis', 'genesis-slash-megadrive': 'genesis',
  sms: 'sms', mastersystem: 'sms', 'master-system': 'sms', 'sega-master-system': 'sms',
  gamegear: 'gamegear', gg: 'gamegear', 'game-gear': 'gamegear',
  segacd: 'segacd', 'sega-cd': 'segacd', megacd: 'segacd',
  saturn: 'saturn', 'sega-saturn': 'saturn',
  dc: 'dc', dreamcast: 'dc', 'sega-dreamcast': 'dc',
  tg16: 'tg16', pce: 'tg16', pcengine: 'tg16', 'pc-engine': 'tg16', turbografx16: 'tg16', 'turbografx-16': 'tg16',
  atari2600: 'atari2600', a26: 'atari2600', 'atari-2600': 'atari2600',
  arcade: 'arcade', mame: 'arcade', fbneo: 'arcade', fba: 'arcade', neogeo: 'arcade',
  dos: 'dos', msdos: 'dos',
}

const EXTRA_ROM_EXT: Record<string, string> = {
  ...ROM_SYSTEMS,
  cia: '3ds',
}

const AMBIGUOUS_DISC_EXT = new Set(['iso', 'chd', 'bin', 'cue', 'img', '7z'])
const IGNORED_EXT = new Set(['txt', 'nfo', 'md', 'jpg', 'jpeg', 'png', 'webp', 'gif', 'pdf', 'xml', 'json', 'ini', 'cfg', 'srm', 'sav'])

function normalizeConsole(raw: string | undefined): string {
  if (!raw) return ''
  const clean = raw.trim().toLowerCase().replace(/[_\s]+/g, '-')
  if (CONSOLE_ALIAS[clean]) return CONSOLE_ALIAS[clean]!
  const compact = clean.replace(/[^a-z0-9]/g, '')
  if (CONSOLE_ALIAS[compact]) return CONSOLE_ALIAS[compact]!
  if (CONSOLE_LABEL.has(clean)) return clean
  return ''
}

function consoleFromFolders(rel: string): string {
  const parts = rel.replace(/\\/g, '/').split('/').slice(0, -1)
  for (let i = parts.length - 1; i >= 0; i--) {
    const hit = normalizeConsole(parts[i])
    if (hit) return hit
  }
  return ''
}

function getExt(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
}

interface StagedRom {
  id: string
  file: File
  rel: string
  console: string
  detectedBy: 'ext' | 'zip' | 'folder' | 'shelf' | 'manual' | 'none'
}

let stageSeq = 1

async function classifyRom(item: Dropped, defaultSlug: string): Promise<StagedRom | null> {
  const rel = item.rel.replace(/\\/g, '/').replace(/^\/+/, '')
  const name = rel.slice(rel.lastIndexOf('/') + 1)
  if (!name || name.startsWith('.') || /^(thumbs\.db|desktop\.ini)$/i.test(name)) return null
  const ext = getExt(name)
  if (IGNORED_EXT.has(ext)) return null

  const id = `r-${stageSeq++}`

  // 1. Unambiguous file extension (.sfc, .gba, .n64, .nds, .cia, etc.)
  const byExt = EXTRA_ROM_EXT[ext]
  if (byExt) {
    return { id, file: item.file, rel, console: byExt, detectedBy: 'ext' }
  }

  // 2. Parent folder alias (SFC -> snes, PSX -> psx, etc.)
  const byFolder = consoleFromFolders(rel)

  // 3. Zip peek inside .zip archives
  if (ext === 'zip') {
    const byZip = await detectConsoleFromZip(item.file)
    if (byZip) {
      // If user dropped onto a specific disc-console shelf (e.g. PS2) and zip only had a generic disc image, prefer shelf.
      if (defaultSlug && byZip === 'psx' && defaultSlug !== 'psx' && !byFolder) {
        return { id, file: item.file, rel, console: defaultSlug, detectedBy: 'shelf' }
      }
      return { id, file: item.file, rel, console: byZip, detectedBy: 'zip' }
    }
  }

  // 4. Parent folder alias if present
  if (byFolder) {
    return { id, file: item.file, rel, console: byFolder, detectedBy: 'folder' }
  }

  // 5. Default console shelf (especially helpful for .iso / .chd / .bin / .zip)
  if (defaultSlug) {
    return { id, file: item.file, rel, console: defaultSlug, detectedBy: 'shelf' }
  }

  // 6. Unassigned (user picks from dropdown)
  if (AMBIGUOUS_DISC_EXT.has(ext) || ext === 'zip' || ext === 'rom' || !ext) {
    return { id, file: item.file, rel, console: '', detectedBy: 'none' }
  }

  return { id, file: item.file, rel, console: '', detectedBy: 'none' }
}

const DETECT_BADGE: Record<StagedRom['detectedBy'], string> = {
  ext: 'Auto',
  zip: 'Zip peek',
  folder: 'Folder',
  shelf: 'Shelf',
  manual: 'Picked',
  none: 'Needs console',
}

export function AddRomsModal({ open, onClose, defaultConsole, initialTab = 'upload', initialFiles }: AddRomsModalProps) {
  const toast = useToast()
  const qc = useQueryClient()
  const isTouch = useIsTouch()
  const dialogRef = useRef<HTMLDivElement>(null)
  const filesInputRef = useRef<HTMLInputElement>(null)
  const folderInputRef = useRef<HTMLInputElement>(null)

  const defaultSlug = useMemo(() => normalizeConsole(defaultConsole), [defaultConsole])

  const [tab, setTab] = useState<'upload' | 'import'>(initialTab)
  const [over, setOver] = useState(false)
  const [inspecting, setInspecting] = useState(false)
  const [staged, setStaged] = useState<StagedRom[]>([])
  const [bulkConsole, setBulkConsole] = useState('')
  const [trackedKeys, setTrackedKeys] = useState<string[]>([])
  const [uploadNotified, setUploadNotified] = useState(false)

  // Tab 2: server folder import state
  const [folderPath, setFolderPath] = useState('')
  const [scanning, setScanning] = useState(false)
  const [scanError, setScanError] = useState('')
  const [preview, setPreview] = useState<RetroImportPreview | null>(null)
  const [importing, setImporting] = useState(false)
  const [importDone, setImportDone] = useState<RetroImportResult | null>(null)

  const { jobs, speed } = useUploads()

  // Sync tab when modal re-opens
  useEffect(() => {
    if (open) {
      setTab(initialTab)
      setScanError('')
      setImportDone(null)
    }
  }, [open, initialTab])

  const ingestDropped = useCallback(
    async (items: Dropped[]) => {
      if (!items.length) return
      setInspecting(true)
      try {
        const results = await Promise.all(items.map((it) => classifyRom(it, defaultSlug)))
        const valid = results.filter((x): x is StagedRom => x !== null)
        if (!valid.length) {
          toast('No ROM files found in that selection', 'error')
          return
        }
        setStaged((prev) => {
          const seen = new Set(prev.map((p) => `${p.file.name}:${p.file.size}`))
          const fresh = valid.filter((v) => !seen.has(`${v.file.name}:${v.file.size}`))
          return [...prev, ...fresh]
        })
      } finally {
        setInspecting(false)
      }
    },
    [defaultSlug, toast],
  )

  // Ingest files dragged onto GamesPage directly
  const consumedInitial = useRef<Dropped[] | undefined>(undefined)
  useEffect(() => {
    if (open && initialFiles && initialFiles.length > 0 && consumedInitial.current !== initialFiles) {
      consumedInitial.current = initialFiles
      setTab('upload')
      void ingestDropped(initialFiles)
    }
    if (!open) {
      consumedInitial.current = undefined
    }
  }, [open, initialFiles, ingestDropped])

  useOverlayFocus(open, dialogRef)

  useEffect(() => {
    if (!open) return
    return pushBackHandler(() => {
      onClose()
      return true
    })
  }, [open, onClose])

  // Track active uploads started from this modal
  const activeJobs = useMemo(() => {
    if (!trackedKeys.length) return []
    const set = new Set(trackedKeys)
    return jobs.filter((j) => set.has(j.key))
  }, [jobs, trackedKeys])

  const uploadStats = useMemo(() => {
    const active = activeJobs.filter((j) => j.status === 'waiting' || j.status === 'sending')
    const done = activeJobs.filter((j) => j.status === 'done')
    const failed = activeJobs.filter((j) => j.status === 'failed')
    const totalBytes = activeJobs.reduce((sum, j) => sum + j.file.size, 0)
    const sentBytes = activeJobs.reduce((sum, j) => sum + (j.status === 'done' ? j.file.size : j.sent), 0)
    const pct = totalBytes > 0 ? Math.min(100, Math.round((sentBytes / totalBytes) * 100)) : 100
    return {
      total: activeJobs.length,
      active: active.length,
      done: done.length,
      failed: failed.length,
      totalBytes,
      sentBytes,
      pct,
    }
  }, [activeJobs])

  // Notify + invalidate library once a batch finishes uploading
  useEffect(() => {
    if (trackedKeys.length > 0 && uploadStats.total > 0 && uploadStats.active === 0 && uploadStats.done > 0 && !uploadNotified) {
      setUploadNotified(true)
      toast('Added to your library — RomM is scanning!')
      void retroApi.scan().catch(() => {})
      void qc.invalidateQueries({ queryKey: ['games'] })
      void qc.invalidateQueries({ queryKey: ['gamePlatforms'] })
    }
  }, [trackedKeys.length, uploadStats.total, uploadStats.active, uploadStats.done, uploadNotified, toast, qc])

  const setItemConsole = (id: string, slug: string) => {
    setStaged((prev) => prev.map((s) => (s.id === id ? { ...s, console: slug, detectedBy: 'manual' } : s)))
  }

  const removeStaged = (id: string) => {
    setStaged((prev) => prev.filter((s) => s.id !== id))
  }

  const applyBulkConsole = (slug: string) => {
    setBulkConsole(slug)
    if (!slug) return
    setStaged((prev) => prev.map((s) => ({ ...s, console: slug, detectedBy: 'manual' })))
  }

  const missingConsoleCount = staged.filter((s) => !s.console).length
  const totalStagedBytes = staged.reduce((sum, s) => sum + s.file.size, 0)

  // Group summary badges (e.g. "SNES · 3", "GBA · 2")
  const consoleSummary = useMemo(() => {
    const counts = new Map<string, number>()
    for (const s of staged) {
      const k = s.console || '__none__'
      counts.set(k, (counts.get(k) ?? 0) + 1)
    }
    return [...counts.entries()].map(([slug, count]) => ({
      slug,
      label: slug === '__none__' ? 'Unassigned' : CONSOLE_LABEL.get(slug) ?? slug.toUpperCase(),
      count,
    }))
  }, [staged])

  const startUpload = () => {
    if (!staged.length || missingConsoleCount > 0) return
    const batch = Date.now().toString(36)
    const planned: Planned[] = staged.map((s) => ({
      key: `roms:${batch}:${s.id}:${s.file.name}:${s.file.size}`,
      file: s.file,
      kind: 'games',
      path: `${s.console}/${s.file.name}`,
      system: s.console,
    }))
    setTrackedKeys((prev) => [...prev, ...planned.map((p) => p.key)])
    setUploadNotified(false)
    enqueue(planned)
    confirmReview()
    setStaged([])
    setBulkConsole('')
  }

  const handleScanFolder = async (e: FormEvent) => {
    e.preventDefault()
    const trimmed = folderPath.trim()
    if (!trimmed) return
    setScanning(true)
    setScanError('')
    setPreview(null)
    setImportDone(null)
    try {
      const res = await retroApi.importPreview(trimmed)
      setPreview(res)
      if (res.totalFiles === 0) {
        setScanError('No recognizable ROM files were found in that folder.')
      }
    } catch (err) {
      setScanError(err instanceof Error && err.message ? err.message : 'Couldn’t scan that folder.')
    } finally {
      setScanning(false)
    }
  }

  const handleRunImport = async () => {
    if (!preview) return
    setImporting(true)
    setScanError('')
    try {
      const res = await retroApi.importRun(preview.folder)
      setImportDone(res)
      toast(
        res.imported > 0
          ? `Imported ${res.imported} ${res.imported === 1 ? 'game' : 'games'} — RomM is scanning!`
          : 'All matching games were already in your library.',
      )
      void qc.invalidateQueries({ queryKey: ['games'] })
      void qc.invalidateQueries({ queryKey: ['gamePlatforms'] })
    } catch (err) {
      setScanError(err instanceof Error && err.message ? err.message : 'Import failed.')
    } finally {
      setImporting(false)
    }
  }

  if (!open) return null

  return createPortal(
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-roms-title"
        className="flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-white/10 bg-ink-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-white/[0.07] px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id="add-roms-title" className="font-display text-[26px] leading-tight text-white">
              Add ROMs
            </h2>
            <p className="mt-0.5 text-[13px] text-ink-400">
              {defaultSlug
                ? `Adding to ${CONSOLE_LABEL.get(defaultSlug) ?? defaultSlug.toUpperCase()} or any auto-detected console.`
                : 'Finesse detects each ROM’s console automatically — including inside .zip files.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Add ROMs"
            className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-ink-400 outline-none transition hover:bg-white/10 hover:text-white focus-visible:ring-2 focus-visible:ring-accent-400"
          >
            <svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Mode Tabs */}
        <div className="flex items-center gap-2 border-b border-white/[0.07] px-5 py-3 sm:px-6" role="tablist" aria-label="Add ROMs method">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'upload'}
            data-autofocus
            onClick={() => setTab('upload')}
            className={`inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent-400 ${
              tab === 'upload'
                ? 'bg-[#f5f3ee] text-ink-950'
                : 'border border-white/10 bg-white/[0.04] text-ink-300 hover:bg-white/[0.08] hover:text-white'
            }`}
          >
            Upload from this device
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'import'}
            onClick={() => setTab('import')}
            className={`inline-flex h-9 items-center gap-2 rounded-full px-4 text-sm font-medium outline-none transition focus-visible:ring-2 focus-visible:ring-accent-400 ${
              tab === 'import'
                ? 'bg-[#f5f3ee] text-ink-950'
                : 'border border-white/10 bg-white/[0.04] text-ink-300 hover:bg-white/[0.08] hover:text-white'
            }`}
          >
            Import from server / SD card
          </button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5 sm:px-6">
          {tab === 'upload' ? (
            <>
              {/* Drop zone */}
              <div
                onDragOver={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  e.dataTransfer.dropEffect = 'copy'
                  setOver(true)
                }}
                onDragLeave={(e) => {
                  e.stopPropagation()
                  setOver(false)
                }}
                onDrop={(e) => {
                  e.preventDefault()
                  e.stopPropagation()
                  setOver(false)
                  void readDrop(e.dataTransfer).then((items) => ingestDropped(items))
                }}
                className={`relative flex flex-col items-center justify-center gap-3.5 rounded-2xl border-2 border-dashed px-5 py-8 text-center transition-all ${
                  over
                    ? 'border-accent-300 bg-accent-500/15'
                    : 'border-white/15 bg-white/[0.02] hover:border-white/25'
                }`}
              >
                <span className="grid h-12 w-12 place-items-center rounded-xl bg-white/[0.07] text-accent-300 ring-1 ring-white/10">
                  <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                    <path d="M12 16V4m0 0-4.5 4.5M12 4l4.5 4.5" />
                    <path d="M4 14v3.5A2.5 2.5 0 0 0 6.5 20h11a2.5 2.5 0 0 0 2.5-2.5V14" />
                  </svg>
                </span>
                <div>
                  <p className="text-[15.5px] font-semibold text-white">
                    {inspecting
                      ? 'Detecting consoles…'
                      : over
                        ? 'Drop ROMs to stage them'
                        : isTouch
                          ? 'Choose ROM files from your device'
                          : 'Drag & drop ROM files or a console folder'}
                  </p>
                  <p className="mt-1 text-[12.5px] text-ink-400">
                    .nes, .sfc, .gba, .n64, .nds, .iso, .chd, .rvz, .zip &amp; more
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    disabled={inspecting}
                    onClick={() => filesInputRef.current?.click()}
                    className="inline-flex h-9 items-center gap-2 rounded-full bg-accent-fill px-4 text-[13.5px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                  >
                    Choose ROM files
                  </button>
                  {!isTouch && !IS_TV && (
                    <button
                      type="button"
                      disabled={inspecting}
                      onClick={() => folderInputRef.current?.click()}
                      className="inline-flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white/[0.05] px-4 text-[13.5px] font-medium text-ink-200 transition hover:bg-white/[0.1] hover:text-white disabled:opacity-50"
                    >
                      Choose console folder
                    </button>
                  )}
                </div>
                <input
                  ref={filesInputRef}
                  type="file"
                  multiple
                  hidden
                  onChange={(e) => {
                    void ingestDropped(fromInput(e.target.files))
                    e.target.value = ''
                  }}
                />
                <input
                  ref={folderInputRef}
                  type="file"
                  multiple
                  hidden
                  {...({ webkitdirectory: '' } as Record<string, string>)}
                  onChange={(e) => {
                    void ingestDropped(fromInput(e.target.files))
                    e.target.value = ''
                  }}
                />
              </div>

              {/* Staged files ready to upload */}
              {staged.length > 0 && (
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="text-[13px] font-semibold text-white">
                        {staged.length} {staged.length === 1 ? 'ROM' : 'ROMs'}
                        {totalStagedBytes > 0 ? ` · ${formatSize(totalStagedBytes)}` : ''}
                      </span>
                      {consoleSummary.map((g) => (
                        <span
                          key={g.slug}
                          className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${
                            g.slug === '__none__'
                              ? 'bg-amber-400/20 text-amber-200'
                              : 'bg-white/[0.08] text-ink-200'
                          }`}
                        >
                          {g.label} · {g.count}
                        </span>
                      ))}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setStaged([])
                        setBulkConsole('')
                      }}
                      className="text-xs font-medium text-ink-400 hover:text-white"
                    >
                      Clear list
                    </button>
                  </div>

                  {(staged.length > 1 || missingConsoleCount > 0) && (
                    <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3.5 py-2.5 text-[12.5px]">
                      <span className={missingConsoleCount > 0 ? 'text-amber-200' : 'text-ink-300'}>
                        {missingConsoleCount > 0
                          ? `${missingConsoleCount} ${missingConsoleCount === 1 ? 'file needs' : 'files need'} a console before uploading.`
                          : 'Every ROM has a console selected.'}
                      </span>
                      <label className="inline-flex items-center gap-2 text-ink-300">
                        <span>Set console for all:</span>
                        <select
                          value={bulkConsole}
                          onChange={(e) => applyBulkConsole(e.target.value)}
                          aria-label="Set console for all ROMs"
                          className="h-8 rounded-lg border border-white/15 bg-ink-900 px-2.5 text-[12.5px] text-white outline-none focus:border-accent-400"
                        >
                          <option value="" className="bg-ink-900 text-white">
                            Choose console…
                          </option>
                          {MODAL_CONSOLES.map(([slug, label]) => (
                            <option key={slug} value={slug} className="bg-ink-900 text-white">
                              {label}
                            </option>
                          ))}
                        </select>
                      </label>
                    </div>
                  )}

                  <ul className="max-h-56 divide-y divide-white/[0.06] overflow-y-auto rounded-xl border border-white/[0.08] bg-ink-950/60">
                    {staged.map((s) => (
                      <li key={s.id} className="flex flex-wrap items-center gap-2.5 px-3.5 py-2.5">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-[13.5px] font-medium text-white" title={s.rel}>
                            {s.file.name}
                          </p>
                          <p className="flex items-center gap-1.5 text-[11.5px] text-ink-400">
                            <span>{formatSize(s.file.size) || '0 B'}</span>
                            <span>·</span>
                            <span className={s.detectedBy === 'none' ? 'text-amber-300' : 'text-ink-400'}>
                              {DETECT_BADGE[s.detectedBy]}
                            </span>
                          </p>
                        </div>
                        <select
                          value={s.console}
                          onChange={(e) => setItemConsole(s.id, e.target.value)}
                          aria-label={`Console for ${s.file.name}`}
                          className={`h-8 max-w-[11rem] rounded-lg border bg-ink-900 px-2.5 text-[12.5px] text-white outline-none focus:border-accent-400 ${
                            s.console ? 'border-white/15' : 'border-amber-400/50'
                          }`}
                        >
                          <option value="" disabled className="bg-ink-900 text-ink-400">
                            Pick console…
                          </option>
                          {MODAL_CONSOLES.map(([slug, label]) => (
                            <option key={slug} value={slug} className="bg-ink-900 text-white">
                              {label}
                            </option>
                          ))}
                        </select>
                        <button
                          type="button"
                          onClick={() => removeStaged(s.id)}
                          aria-label={`Remove ${s.file.name}`}
                          className="grid h-7 w-7 shrink-0 place-items-center rounded-full text-ink-400 hover:bg-white/10 hover:text-white"
                        >
                          <svg viewBox="0 0 10 10" className="h-2.5 w-2.5" aria-hidden>
                            <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.5" />
                          </svg>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {/* Live Upload Progress */}
              {activeJobs.length > 0 && (
                <div className="space-y-3 rounded-xl border border-white/10 bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="text-[13.5px] font-semibold text-white">
                        {uploadStats.active > 0
                          ? `Uploading ${uploadStats.done + 1} of ${uploadStats.total}… (${uploadStats.pct}%)`
                          : uploadStats.failed > 0 && uploadStats.done === 0
                            ? 'Upload failed'
                            : `Added ${uploadStats.done} ${uploadStats.done === 1 ? 'game' : 'games'} — RomM is scanning!`}
                      </p>
                      <p className="mt-0.5 text-[12px] text-ink-400">
                        {uploadStats.active > 0
                          ? `${formatSize(uploadStats.sentBytes)} of ${formatSize(uploadStats.totalBytes)}${speed > 0 ? ` · ${formatSize(speed)}/s` : ''}`
                          : 'New games appear in Your games within a moment.'}
                      </p>
                    </div>
                    {uploadStats.active === 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          setTrackedKeys([])
                          setUploadNotified(false)
                        }}
                        className="text-xs font-medium text-ink-400 hover:text-white"
                      >
                        Clear
                      </button>
                    )}
                  </div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={`h-full rounded-full transition-[width] duration-300 ${
                        uploadStats.active === 0 && uploadStats.failed === 0 ? 'bg-emerald-400' : 'bg-accent-400'
                      }`}
                      style={{ width: `${uploadStats.pct}%` }}
                    />
                  </div>
                  <ul className="max-h-40 divide-y divide-white/[0.05] overflow-y-auto text-[12.5px]">
                    {activeJobs.map((j) => {
                      const pct = j.file.size ? (j.status === 'done' ? 100 : Math.floor((j.sent / j.file.size) * 100)) : 100
                      return (
                        <li key={j.key} className="flex items-center justify-between gap-3 py-1.5">
                          <span className="min-w-0 flex-1 truncate text-ink-200">
                            <span className="mr-1.5 rounded bg-white/[0.08] px-1.5 py-0.5 font-mono text-[10.5px] uppercase text-ink-300">
                              {j.system}
                            </span>
                            {j.file.name}
                          </span>
                          <span className="shrink-0 font-mono text-[11.5px]">
                            {j.status === 'done' ? (
                              <span className="text-emerald-300">Added</span>
                            ) : j.status === 'failed' ? (
                              <button type="button" onClick={() => retry(j.key)} className="text-amber-300 underline hover:text-amber-200">
                                Retry
                              </button>
                            ) : j.status === 'sending' ? (
                              <span className="text-sky-300">{pct}%</span>
                            ) : j.status === 'waiting' ? (
                              <span className="text-ink-400">Queued</span>
                            ) : (
                              <span className="text-ink-500">{j.status}</span>
                            )}
                          </span>
                          {(j.status === 'waiting' || j.status === 'sending') && (
                            <button
                              type="button"
                              onClick={() => cancel(j.key)}
                              aria-label={`Cancel ${j.file.name}`}
                              className="text-ink-500 hover:text-white"
                            >
                              ×
                            </button>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}
            </>
          ) : (
            /* Tab 2: Import from server / SD card folder */
            <div className="space-y-4">
              <p className="text-[13.5px] leading-relaxed text-ink-300">
                Point Finesse at a folder already on your server, USB drive, or SD card. It scans subfolders, identifies each console automatically, and copies everything into your ROMs library.
              </p>

              <form onSubmit={handleScanFolder} className="flex flex-wrap gap-2">
                <input
                  value={folderPath}
                  onChange={(e) => setFolderPath(e.target.value)}
                  placeholder="/mnt/usb/ROMs or /data/roms"
                  aria-label="Server folder path"
                  autoFocus={!IS_TV}
                  spellCheck={false}
                  className="h-10 min-w-0 flex-1 basis-56 rounded-xl border border-white/15 bg-ink-950/70 px-3.5 font-mono text-[13.5px] text-white placeholder:text-ink-500 outline-none focus:border-accent-400"
                />
                <button
                  type="submit"
                  disabled={scanning || importing || !folderPath.trim()}
                  className="inline-flex h-10 items-center gap-2 rounded-xl bg-white px-4 text-sm font-semibold text-ink-950 transition hover:bg-ink-200 disabled:opacity-50"
                >
                  {scanning && <Spinner className="h-3.5 w-3.5" />}
                  {scanning ? 'Scanning…' : 'Scan folder'}
                </button>
              </form>

              {scanError && (
                <div className="rounded-xl border border-red-400/25 bg-red-500/10 px-4 py-3 text-[13px] text-red-200">
                  {scanError}
                </div>
              )}

              {importDone && (
                <div className="rounded-xl border border-emerald-400/25 bg-emerald-500/10 px-4 py-3.5 text-[13.5px] text-emerald-100">
                  <p className="font-semibold text-white">
                    Imported {importDone.imported.toLocaleString()} {importDone.imported === 1 ? 'game' : 'games'} across {importDone.consoles}{' '}
                    {importDone.consoles === 1 ? 'console' : 'consoles'}
                  </p>
                  <p className="mt-0.5 text-[12.5px] text-emerald-200/80">
                    {importDone.skipped > 0 ? `${importDone.skipped.toLocaleString()} already present (skipped). ` : ''}
                    RomM is scanning your library now.
                  </p>
                </div>
              )}

              {preview && preview.totalFiles > 0 && (
                <div className="space-y-3 rounded-xl border border-white/10 bg-ink-950/60 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] pb-3">
                    <div>
                      <p className="text-[14px] font-semibold text-white">
                        Found {preview.totalFiles.toLocaleString()} {preview.totalFiles === 1 ? 'game' : 'games'} · {formatSize(preview.totalBytes)}
                      </p>
                      <p className="mt-0.5 truncate font-mono text-[11.5px] text-ink-400">{preview.folder}</p>
                    </div>
                    <button
                      type="button"
                      disabled={importing}
                      onClick={() => void handleRunImport()}
                      className="inline-flex h-9 items-center gap-2 rounded-full bg-accent-fill px-4 text-[13.5px] font-semibold text-white transition hover:brightness-110 disabled:opacity-50"
                    >
                      {importing && <Spinner className="h-3.5 w-3.5" />}
                      {importing ? 'Importing…' : 'Import all games'}
                    </button>
                  </div>

                  <ul className="max-h-60 divide-y divide-white/[0.05] overflow-y-auto">
                    {preview.consoles.map((c) => (
                      <li key={c.slug} className="py-2.5 first:pt-0 last:pb-0">
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[13.5px] font-semibold text-white">
                            {c.label}{' '}
                            <span className="font-normal text-ink-400">
                              · {c.count.toLocaleString()} {c.count === 1 ? 'game' : 'games'} · {formatSize(c.bytes)}
                            </span>
                          </span>
                        </div>
                        {c.sample.length > 0 && (
                          <p className="mt-0.5 truncate text-[12px] text-ink-400">
                            {c.sample.slice(0, 4).join(', ')}
                            {c.count > c.sample.length ? '…' : ''}
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center justify-end gap-2.5 border-t border-white/[0.07] bg-ink-950/40 px-5 py-3.5 sm:px-6">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-9 items-center rounded-full px-4 text-sm font-medium text-ink-300 transition hover:bg-white/10 hover:text-white"
          >
            {uploadStats.active > 0 ? 'Continue in background' : 'Close'}
          </button>
          {tab === 'upload' && staged.length > 0 && (
            <button
              type="button"
              disabled={missingConsoleCount > 0 || inspecting}
              onClick={startUpload}
              className="inline-flex h-9 items-center gap-2 rounded-full bg-accent-fill px-5 text-sm font-semibold text-white shadow-lg shadow-accent-600/25 transition hover:brightness-110 disabled:opacity-45 disabled:shadow-none"
            >
              Upload {staged.length} {staged.length === 1 ? 'game' : 'games'}
            </button>
          )}
        </div>
      </div>
    </div>,
    document.body,
  )
}
