# Installer pictures

`install.sh` can show Nessa in the terminal: once when it starts (`nessa-hi.png`) and once when it
finishes (`nessa-yay.png`). Neither file is here right now, so the installer shows text in those
places. To add them:

1. Put the PNGs in this folder (either one can be missing).
2. Run `python3 tools/installer/art.py` (needs Pillow). It rewrites the block between the
   `# ---------- Nessa` markers in `install.sh`.
3. Run `bash -n install.sh` and try it in a terminal.

## What the pictures need to be

- **Pixel art, one PNG pixel = one terminal "half cell".** Each terminal row shows two pixels
  stacked, so a 40×28 picture takes 40 columns and 14 rows.
- **Small.** The welcome picture sits beside the "Finesse." name and a speech bubble, so keep it
  **at most 44 pixels wide and 28 tall**. The finish picture sits beside a few words: **at most 52
  wide and 32 tall**. Wider terminals aren't guaranteed: 80 columns is the common default.
- **Transparent background**, with alpha fully on or fully off (no soft edges). The terminal's own
  background shows through, and it can be dark or light, so give everything a dark outline.
- **62 colours at most** across both pictures. They're shown in 24-bit colour where the terminal
  supports it and as the nearest of the 256 standard colours elsewhere (most SSH sessions), so
  avoid relying on very close shades.
- **On model**: blue-violet twin tails fading to lavender, navy bows, the small outline F-house
  clip, violet eyes, navy hoodie with the lavender F-house, black leggings, white sneakers with
  lavender trim. See the brand notes in the video asset pack.

## Ideas that were wanted

Small animated scenes while the slow steps run (installing Docker, downloading Finesse, waiting
for it to start): Nessa watching TV with popcorn, playing games, listening to lo-fi with
headphones, napping. `install.sh` can't animate yet; adding it means drawing the frames in
place above the spinner line (see `spin()`), with each scene a short loop of 4–8 frames.
