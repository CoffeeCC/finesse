# winhelper

The game store's install engine has to know what's on screen: is that a real game window or an
error box, what does the box say, which button moves it on. `winhelper` is the small Windows
program that tells it, and presses the button. One tool for both hosts: it runs natively on
Windows and under Wine in the Linux sandbox.

```
winhelper list                      every visible top-level window, as JSON
winhelper click <hwnd> <label>      press a button by its label ("&Next >" and "Next >" match)
winhelper shot <file.bmp> [hwnd]    a picture of the screen or one window; says if it's blank
```

`list` gives, per window: `hwnd`, `pid`, `title`, `class` (`#32770` is a dialog box), `text` (its
labels), `buttons` (enabled push buttons), `wantsInput` (it has a box to type in, a list or a
choice to make), `hung`, `width`, `height`. That's `WindowInfo` in
`server/src/gamestore/types.ts`; `server/src/gamestore/answers.ts` decides what to do with it.

It only looks and clicks. It never starts or stops a program or reads another one's memory.

## Build and test

```bash
make            # needs mingw-w64 (apt: gcc-mingw-w64-x86-64); gives winhelper.exe, static
x86_64-w64-mingw32-gcc -O2 -municode -static -s -o testwin.exe testwin.c -luser32 -lgdi32
./test.sh       # needs wine64 and Xvfb: a real message box and a real window, on a virtual screen
```

`test.sh` checks that an error box is listed as a dialog with its words and buttons, that OK can
be pressed (and the box really closes with OK), that a plain window is listed with its own class
and pictured as not blank, and that an empty screen is blank.

Not yet done: nothing calls it. The sandbox runners (WS4 Linux, WS5 Windows in
`docs/agents/game-store-plan.md`) are what run it and turn its JSON into `WindowInfo`; it hasn't
been run on real Windows, or against a real Inno Setup or NSIS wizard page.
