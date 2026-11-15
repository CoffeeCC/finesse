// What's in Settings, for its menu and its search box. Each page is one screen
// (not one long scroll), and each entry is something you can search for and jump
// to: the page opens and the setting lights up. An entry finds its spot by
// `data-setting="<anchor>"` on the page (Toggle and Field set it from their label).
// Adding a setting? Add it here too, with the words people might search for.

export type SectionId =
  | 'devices'
  | 'playback'
  | 'appearance'
  | 'sound'
  | 'account'
  | 'updates'
  | 'about'
  | 'health'
  | 'downloads'
  | 'media'
  | 'people'
  | 'games'
  | 'server'

/** Who's looking, and on what: decides which pages and settings exist. */
export interface Ctx {
  admin: boolean
  tv: boolean
  webos: boolean
  touch: boolean
  features: Record<string, boolean>
}

export interface SectionDef {
  id: SectionId
  label: string
  /** One line under the page title. */
  blurb: string
  admin?: boolean
  when?: (c: Ctx) => boolean
}

export interface Entry {
  section: SectionId
  label: string
  hint?: string
  /** More words to match: what people call it, the apps involved. */
  words?: string
  /** Defaults to the label, as `slug(label)`. */
  anchor?: string
  when?: (c: Ctx) => boolean
}

/** "Auto-play next episode" → "auto-play-next-episode": the anchor Toggle and Field set. */
export const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[’']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')

const system = (c: Ctx) => Boolean(c.features.system)

export const SECTIONS: SectionDef[] = [
  { id: 'devices', label: 'Other devices', blurb: 'Finesse on your phone, TV and other computers.', when: (c) => !c.webos },
  { id: 'playback', label: 'Playback', blurb: 'How movies, shows and music play on this device.' },
  { id: 'appearance', label: 'Appearance', blurb: 'Colors, size and motion.' },
  { id: 'sound', label: 'Sound', blurb: 'Interface sounds, previews and lyrics.' },
  { id: 'account', label: 'Account', blurb: 'Who’s signed in, and how this device connects.' },
  { id: 'updates', label: 'Updates', blurb: 'This app’s version, and the server’s.' },
  { id: 'about', label: 'About', blurb: 'Finesse, reporting a problem, and supporting it.' },
  { id: 'health', label: 'Health', blurb: 'How every app is doing, and one-click fixes when one isn’t.', admin: true },
  { id: 'downloads', label: 'Downloads', blurb: 'Where requests go and in what quality.', admin: true, when: (c) => Boolean(c.features.requests) || system(c) },
  { id: 'media', label: 'Media', blurb: 'Preview clips and the graphics card that converts video.', admin: true },
  { id: 'people', label: 'People', blurb: 'Accounts, invites, friends’ servers and limits for profiles.', admin: true },
  { id: 'games', label: 'Games', blurb: 'Retro games, game streaming and the game store.', admin: true },
  { id: 'server', label: 'Server', blurb: 'App updates, backups, and the address and email invites use.', admin: true, when: system },
]

export const ENTRIES: Entry[] = [
  // Other devices
  { section: 'devices', label: 'Open Finesse on another device', anchor: 'connect-devices', words: 'phone tablet tv lg webos android auto computer qr code pair jellyfin app' },
  { section: 'devices', label: 'Use your phone as a remote', anchor: 'connect-devices', words: 'remote control phone' },
  { section: 'devices', label: 'Away from home', anchor: 'connect-devices', words: 'outside remote access travel' },

  // Playback
  { section: 'playback', label: 'Maximum streaming quality', words: 'bitrate quality transcode bandwidth data mbps 4k 1080p lossless' },
  { section: 'playback', label: 'Subtitles on by default', words: 'captions cc subs' },
  { section: 'playback', label: 'Auto-play next episode', words: 'autoplay binge continue next up' },
  { section: 'playback', label: 'Ambient glow', words: 'black bars colors ambilight', when: (c) => !c.tv },
  { section: 'playback', label: 'Moment pop-ups', words: 'moments notes spoilers popup' },

  // Appearance
  { section: 'appearance', label: 'Accent color', words: 'colour theme tint highlight' },
  { section: 'appearance', label: 'Display size', words: 'scale zoom bigger text size ui couch' },
  { section: 'appearance', label: 'Preview quality', words: 'hover preview resolution trailer clips' },
  { section: 'appearance', label: 'Reduce motion', words: 'animation accessibility transitions still' },
  { section: 'appearance', label: 'Screensaver', words: 'idle clock burn in' },
  { section: 'appearance', label: 'Tilt parallax', words: 'gyro motion depth phone', when: (c) => c.touch },

  // Sound
  { section: 'sound', label: 'Interface sounds', words: 'ui sounds clicks beeps volume mouse hover' },
  { section: 'sound', label: 'Preview sound', words: 'audio hover mute' },
  { section: 'sound', label: 'Thumbnail previews', words: 'scrub thumbnails hover' },
  { section: 'sound', label: 'Find lyrics online', words: 'lrclib lyrics music karaoke' },

  // Account
  { section: 'account', label: 'Switch profile or sign out', anchor: 'account', words: 'log out logout sign out profile user' },
  { section: 'account', label: 'Finesse server', anchor: 'tv-server', words: 'server address change connect', when: (c) => c.webos },
  { section: 'account', label: 'Secure connection, without warnings', anchor: 'secure-connection', words: 'https certificate ssl tls warning trust', when: (c) => !c.tv },

  // Updates
  { section: 'updates', label: 'Check for updates', anchor: 'updates-app', words: 'version update new release' },
  { section: 'updates', label: 'Update the server', anchor: 'updates-server', words: 'server version github release everyone', when: (c) => c.admin && !c.webos },

  // About
  { section: 'about', label: 'About Finesse', anchor: 'about', words: 'source code open source github' },
  { section: 'about', label: 'Report a problem', anchor: 'report-problem', words: 'bug issue broken feedback logs', when: (c) => !c.tv },
  { section: 'about', label: 'Support Finesse', anchor: 'tip-jar', words: 'donate tip crypto eth support' },

  // Health
  { section: 'health', label: 'Server status', anchor: 'system-summary', words: 'health everything running problems attention', when: system },
  { section: 'health', label: 'Apps', anchor: 'system-apps', words: 'containers restart logs pause resume jellyfin sonarr radarr', when: system },
  { section: 'health', label: 'VPN and storage', anchor: 'system-vpn-storage', words: 'vpn gluetun disk space free full storage', when: system },
  { section: 'health', label: 'Connected apps', anchor: 'connected-apps', words: 'radarr sonarr lidarr prowlarr sabnzbd qbittorrent indexers download clients errors fix broken vpn' },
  { section: 'health', label: 'Library health', anchor: 'library-health', words: 'duplicates missing files unfollowed misfiled' },
  { section: 'health', label: 'Recent activity', anchor: 'system-activity', words: 'events log history repairs', when: system },

  // Downloads
  { section: 'downloads', label: 'Quality and folders for requests', anchor: 'request-defaults', words: 'quality profile root folder radarr sonarr lidarr 4k 1080p requests', when: (c) => Boolean(c.features.requests) },
  { section: 'downloads', label: 'Usenet, torrents, VPN and access from outside', anchor: 'system-setup-change', words: 'usenet torrents vpn tailscale cloudflare remote access setup change', when: system },

  // Media
  { section: 'media', label: 'Preview clips', anchor: 'preview-clips', words: 'clips trailers hover previews teaser next time on' },
  { section: 'media', label: 'Graphics', anchor: 'graphics', words: 'gpu graphics card nvenc quicksync transcoding hardware acceleration nvidia intel amd' },

  // People
  { section: 'people', label: 'Create account', anchor: 'create-account', words: 'add user new profile account' },
  { section: 'people', label: 'Invites', anchor: 'invites', words: 'invite link email qr code share friend family' },
  { section: 'people', label: 'Friends’ servers', anchor: 'groups', words: 'groups friends share servers pair moments recommendations' },
  { section: 'people', label: 'Limits for profiles', anchor: 'parental', words: 'parental controls kids rating age restrictions' },

  // Games
  { section: 'games', label: 'Retro games', anchor: 'system-games', words: 'romm roms games nes snes emulators steamgriddb', when: system },
  { section: 'games', label: 'Game streaming', anchor: 'streaming', words: 'wolf moonlight steam stream pc games consoles emulators paired devices controllers' },
  { section: 'games', label: 'Game store', anchor: 'game-store', words: 'store feeds installers requests' },

  // Server
  { section: 'server', label: 'App updates', anchor: 'system-app-updates', words: 'auto update overnight jellyfin sonarr radarr versions', when: system },
  { section: 'server', label: 'Backups', anchor: 'system-backups', words: 'backup restore download nightly', when: system },
  { section: 'server', label: 'Public address and email', anchor: 'system-sharing', words: 'public url domain address smtp email invites gmail', when: system },
]

export const visibleSections = (c: Ctx) => SECTIONS.filter((s) => (!s.admin || c.admin) && (!s.when || s.when(c)))

/** Settings matching every word typed, best first: a match in the name beats one in its description. */
export function searchSettings(query: string, c: Ctx): (Entry & { sectionLabel: string })[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (!words.length) return []
  const sections = new Map(visibleSections(c).map((s) => [s.id, s]))
  const out: { e: Entry & { sectionLabel: string }; score: number }[] = []
  for (const e of ENTRIES) {
    const sec = sections.get(e.section)
    if (!sec || (e.when && !e.when(c))) continue
    const name = e.label.toLowerCase()
    const all = `${name} ${(e.hint ?? '').toLowerCase()} ${(e.words ?? '').toLowerCase()} ${sec.label.toLowerCase()}`
    if (!words.every((w) => all.includes(w))) continue
    const score = words.reduce((n, w) => n + (name.startsWith(w) ? 4 : name.includes(w) ? 2 : 0), 0)
    out.push({ e: { ...e, sectionLabel: sec.label }, score })
  }
  return out.sort((a, b) => b.score - a.score).map((x) => x.e)
}
