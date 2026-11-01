// The Games library hides what RomM lists from a console's folder that isn't a game
// (src/lib/gameFiles.ts): emulator settings, patches, saves and an emulator's own folders.
// Games kept as folders stay. Console folders RomM didn't recognise get their proper names.

import assert from 'node:assert/strict'
import { test } from 'node:test'
import { consoleName, isSupportFile, type RomFileLike } from '../../src/lib/gameFiles.ts'

// What RomM returned for a real library (Xbox 360, Model 2, GameCube, PS3, PS1, SNES folders).
const file = (fs_name: string, extra: Partial<RomFileLike> = {}): RomFileLike => ({ fs_name, fs_extension: fs_name.includes('.') ? fs_name.split('.').pop() : '', ...extra })
const dir = (fs_name: string): RomFileLike => ({ fs_name, fs_extension: '', multi: true })

test('emulator settings, patches, saves and emulator folders are not games', () => {
  for (const r of [
    file('xenia.config.toml'),
    file('xenia-canary.config.toml'),
    file('daytona.pat'),
    dir('SYSTEM'),
    dir('TEXTURES'),
    file('Super Mario World (USA).srm'),
    file('Super Mario World (USA).state3'),
    file('Chrono Trigger (USA).ips'),
    file('Dolphin.ini'),
    file('retroarch.cfg'),
    file('Game List.txt'),
    file('cover.png'),
    file('.DS_Store'),
    // Older RomM: no extension field, no folder flag; the name says it.
    { fs_name: 'Textures' },
    { fs_name: 'SYSTEM' },
  ]) assert.equal(isSupportFile(r), true, `${r.fs_name} should be hidden`)
})

test('games stay: single files, archives, disc images, and games kept as folders', () => {
  for (const r of [
    file('Super Mario World (USA).sfc'),
    file('Daytona USA.zip'),
    file('Halo 3 (USA).iso'),
    file('Final Fantasy VII (USA) (Disc 1).chd'),
    file('Metroid Prime (USA).rvz'),
    file('Crash Bandicoot.cue'),
    file('Crash Bandicoot.bin'),
    dir('Demon’s Souls [BLUS30443]'),
    dir('Gran Turismo 5'),
    dir('System Shock 2'), // a game whose name starts like an emulator folder
    dir('Halo 3'),
    { fs_name: 'Mario Kart 8', has_multiple_files: true },
    { fs_name: 'Zelda BotW' }, // a folder on older RomM (no flags)
  ]) assert.equal(isSupportFile(r), false, `${r.fs_name} should stay`)
})

test('console names: RomM’s title-cased folder names get proper names; its own names are kept', () => {
  assert.equal(consoleName('Gc', 'gc', 'gc'), 'Nintendo GameCube')
  assert.equal(consoleName('N3Ds', 'n3ds'), 'Nintendo 3DS')
  assert.equal(consoleName('Xbox360', 'xbox360'), 'Xbox 360')
  // RomM knew it: its name stands.
  assert.equal(consoleName('Nintendo GameCube', 'ngc', 'gc'), 'Nintendo GameCube')
  assert.equal(consoleName('PlayStation', 'psx'), 'PlayStation')
  // A folder nobody knows keeps what RomM said; nothing at all falls back to the folder, then "Games".
  assert.equal(consoleName('Mystery', 'mystery'), 'Mystery')
  assert.equal(consoleName(undefined, 'gba'), 'Game Boy Advance')
  assert.equal(consoleName('', 'oddfolder'), 'oddfolder')
  assert.equal(consoleName(undefined), 'Games')
})
