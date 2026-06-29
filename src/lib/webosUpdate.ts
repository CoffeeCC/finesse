// Over-the-air self-update for the sideloaded webOS build.
//
// A sandboxed webOS app can't install a new .ipk on itself — but it CAN swap out
// its own web bundle. The whole app is built as one self-contained HTML file
// (see scripts/build-webos.mjs). Each GitHub release ships that file as an asset.
// "Check for updates" downloads the newer file, stashes it in IndexedDB, and the
// next launch's bootstrap (webos/boot.js) loads the stashed copy instead of the
// one baked into the .ipk. The baked-in copy is always the safe fallback, so a
// bad/aborted download can never brick the app.
//
// Updating the native shell itself (icon, bootstrap, appinfo) still needs a real
// .ipk reinstall from a PC — that's what webos/update-webos.bat is for.

// owner/repo that publishes the webOS bundle as release assets.
const GITHUB_REPO = 'CoffeeCC/finesse'

const DB_NAME = 'finesse-ota'
const STORE = 'kv'
const KEY = 'bundle'

export interface StoredBundle {
  version: string
  css: string
  js: string
  stagedAt: number
}

export interface UpdateInfo {
  available: boolean
  current: string
  latest: string
  notes: string
  downloadUrl: string | null
}

/** Version of the bundle currently running (baked-in or a previously staged OTA). */
export function currentVersion(): string {
  // A staged bundle injects its own version; otherwise fall back to the build constant.
  const staged = (window as unknown as { __APP_VERSION__?: string }).__APP_VERSION__
  return staged || __APP_VERSION__
}

/** Compare dotted numeric versions. >0 if a is newer than b. */
export function cmpVersion(a: string, b: string): number {
  const pa = String(a).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  const pb = String(b).replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d !== 0) return d > 0 ? 1 : -1
  }
  return 0
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

export async function getStagedBundle(): Promise<StoredBundle | null> {
  try {
    const db = await openDb()
    return await new Promise((resolve) => {
      const req = db.transaction(STORE, 'readonly').objectStore(STORE).get(KEY)
      req.onsuccess = () => resolve((req.result as StoredBundle) || null)
      req.onerror = () => resolve(null)
    })
  } catch {
    return null
  }
}

async function putStagedBundle(bundle: StoredBundle): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(bundle, KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** Ask GitHub whether a newer bundle exists. Does not download it. */
export async function checkForUpdate(): Promise<UpdateInfo> {
  const current = currentVersion()
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
    headers: { Accept: 'application/vnd.github+json' },
  })
  if (!res.ok) throw new Error(`GitHub responded ${res.status}`)
  const rel = (await res.json()) as {
    tag_name?: string
    body?: string
    assets?: { name: string; browser_download_url: string }[]
  }
  const latest = (rel.tag_name || '0.0.0').replace(/^v/, '')
  const asset = (rel.assets || []).find((a) => /finesse-webos.*\.json$/i.test(a.name))
  return {
    available: cmpVersion(latest, current) > 0 && !!asset,
    current,
    latest,
    notes: rel.body || '',
    downloadUrl: asset?.browser_download_url || null,
  }
}

/** Download the bundle and stage it for the next launch. */
export async function downloadAndStage(info: UpdateInfo): Promise<void> {
  if (!info.downloadUrl) throw new Error('No bundle asset on that release')
  const res = await fetch(info.downloadUrl)
  if (!res.ok) throw new Error(`Download failed (${res.status})`)
  const data = (await res.json()) as Partial<StoredBundle>
  // Sanity check: it should actually be our app bundle, not an error page.
  if (!data || typeof data.js !== 'string' || data.js.length < 1000 || !data.version) {
    throw new Error('Downloaded file does not look like a Finesse bundle')
  }
  await putStagedBundle({
    version: data.version,
    css: data.css || '',
    js: data.js,
    stagedAt: Date.now(),
  })
}

/** Forget any staged OTA bundle (revert to the baked-in copy on next launch). */
export async function clearStagedBundle(): Promise<void> {
  try {
    const db = await openDb()
    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORE, 'readwrite')
      tx.objectStore(STORE).delete(KEY)
      tx.oncomplete = () => resolve()
      tx.onerror = () => resolve()
    })
  } catch {
    /* ignore */
  }
}
