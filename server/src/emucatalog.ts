// The emulators Finesse can download for you: pinned like the container images
// in stack/catalog.ts. A pin changes only with a Finesse release; the file is
// checked against its sha256 before it's ever run.
//
// Sources are each project's own releases (EmuDeck's list was the reference
// for where each comes from). Every file below was downloaded and hashed, and
// is the same file the emulators were tested with.
//
// - Dolphin publishes no Linux AppImage (only Flatpak, which can't run in these
//   containers). Its entry is the community "anylinux" build from pkgforge-dev,
//   marked `official: false`, and shown as such.
// - No Ryujinx: upstream is gone; Finesse still runs one you supply yourself.
// - ES-DE comes inside the Moonlight emulator image, so there's nothing to fetch.

import type { EmulatorId } from './emulators.ts'

export type InstallId = 'pcsx2' | 'dolphin' | 'rpcs3' | 'cemu' | 'eden'
export const INSTALL_IDS: InstallId[] = ['pcsx2', 'dolphin', 'rpcs3', 'cemu', 'eden']

export interface PinnedEmulator {
  id: InstallId
  /** The emulator app it fills (Eden is the Switch app). */
  app: EmulatorId
  name: string
  /** What people know it as. */
  consoles: string
  version: string
  url: string
  /** The file name it's saved as (it must match the app's program pattern). */
  file: string
  sha256: string
  size: number
  license: string
  /** From the project itself (false: a community build, said so in the app). */
  official: boolean
  source: string
}

export const EMULATOR_PINS: PinnedEmulator[] = [
  {
    id: 'pcsx2',
    app: 'pcsx2',
    name: 'PCSX2',
    consoles: 'PlayStation 2',
    version: '2.8.2',
    url: 'https://github.com/PCSX2/pcsx2/releases/download/v2.8.2/pcsx2-v2.8.2-linux-appimage-x64-Qt.AppImage',
    file: 'pcsx2-v2.8.2-linux-appimage-x64-Qt.AppImage',
    sha256: '0c46bb6a88aa2782b10853a7b07cf3387ba99cbef2b966372cd2315b8571abea',
    size: 60119544,
    license: 'GPL-3.0-or-later',
    official: true,
    source: 'PCSX2’s GitHub releases',
  },
  {
    id: 'dolphin',
    app: 'dolphin',
    name: 'Dolphin',
    consoles: 'GameCube and Wii',
    version: '2609',
    url: 'https://github.com/pkgforge-dev/Dolphin-emu-AppImage/releases/download/2609%402026-10-01_1790876487/Dolphin_Emulator-2609-anylinux-x86_64.AppImage',
    file: 'Dolphin_Emulator-2609-anylinux-x86_64.AppImage',
    sha256: 'd033d883870c3cd3224fa28b8b70ac932f464f4f6c3dea4e331f875c811d437a',
    size: 61716856,
    license: 'GPL-2.0-or-later',
    official: false,
    source: 'a community build of Dolphin 2609 (pkgforge-dev); Dolphin itself offers Linux only as a Flatpak',
  },
  {
    id: 'rpcs3',
    app: 'rpcs3',
    name: 'RPCS3',
    consoles: 'PlayStation 3',
    version: '0.0.43-20184',
    url: 'https://github.com/RPCS3/rpcs3-binaries-linux/releases/download/build-d5213de6dd329b4f61ad0b95c1a3dc7d6622aa3b/rpcs3-v0.0.43-20184-d5213de6_linux64.AppImage',
    file: 'rpcs3-v0.0.43-20184-d5213de6_linux64.AppImage',
    sha256: '878ebefc8090d257a602dbcedf4fd531ada783c7807c804acc7f8630c9cd373d',
    size: 94004639,
    license: 'GPL-2.0-only',
    official: true,
    source: 'RPCS3’s builds (the same file and checksum its update service lists)',
  },
  {
    id: 'cemu',
    app: 'cemu',
    name: 'Cemu',
    consoles: 'Wii U',
    version: '2.6',
    url: 'https://github.com/cemu-project/Cemu/releases/download/v2.6/Cemu-2.6-x86_64.AppImage',
    file: 'Cemu-2.6-x86_64.AppImage',
    sha256: '0c20c4aeb800bb13d9bab9474ef45a6f8fcde6402cad9b32ac2a1bbd03186313',
    size: 61423960,
    license: 'MPL-2.0',
    official: true,
    source: 'Cemu’s GitHub releases',
  },
  {
    id: 'eden',
    app: 'switch',
    name: 'Eden',
    consoles: 'Switch',
    version: '0.2.1',
    url: 'https://stable.eden-emu.dev/v0.2.1/Eden-Linux-v0.2.1-amd64-clang-pgo.AppImage',
    file: 'Eden-Linux-v0.2.1-amd64-clang-pgo.AppImage',
    sha256: '7a28bf988b0648831989722bdbaa90ab31371b403808199813e0ea7c8b25ba6d',
    size: 69276651,
    license: 'GPL-3.0-or-later',
    official: true,
    source: 'Eden’s releases (git.eden-emu.dev)',
  },
]

export const pinFor = (id: InstallId) => EMULATOR_PINS.find((p) => p.id === id)!

/** The emulator app a download fills, and the reverse. */
export const installIdFor = (app: EmulatorId, switchEmulator?: string): InstallId | null =>
  app === 'switch' ? (switchEmulator === 'ryujinx' ? null : 'eden') : app === 'esde' ? null : (app as InstallId)
