// The consoles Finesse can set up by itself: one emulator each, downloaded and
// checked by the server (server/src/emucatalog.ts has the pinned files). What
// each still needs from you is the part only you can add: dumps from your own
// console, never downloaded.

import type { InstallId } from '../api/setup'

export interface ConsoleInfo {
  id: InstallId
  /** What people call it. */
  title: string
  emulator: string
  /** Download size, in MB (rounded). */
  mb: number
  /** What you add yourself, in plain words (empty: nothing). */
  yours: string
}

export const CONSOLES: ConsoleInfo[] = [
  { id: 'pcsx2', title: 'PlayStation 2', emulator: 'PCSX2', mb: 60, yours: 'The PS2 BIOS, a file copied from your own PS2.' },
  { id: 'dolphin', title: 'GameCube and Wii', emulator: 'Dolphin', mb: 62, yours: '' },
  { id: 'rpcs3', title: 'PlayStation 3', emulator: 'RPCS3', mb: 94, yours: 'The PS3 system software file (PS3UPDAT.PUP, free from PlayStation’s website).' },
  { id: 'cemu', title: 'Wii U', emulator: 'Cemu', mb: 61, yours: 'Only for encrypted disc copies: your keys.txt.' },
  { id: 'eden', title: 'Switch', emulator: 'Eden', mb: 69, yours: 'Your Switch’s keys (prod.keys) and its firmware, copied from your own Switch.' },
]

export const mb = (bytes: number) => `${Math.round(bytes / 1_000_000)} MB`
