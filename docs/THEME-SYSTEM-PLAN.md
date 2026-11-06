# Themes settings and creator system

Updated 31 October 2026. Implementation handoff for the optional-theme branch.

## Implemented in this preview

Settings has a dedicated Themes section, separate from Appearance. Built-in themes
show names, descriptions and small visual previews. Selecting one applies it and
saves it in this browser. Try your theme opens Home; Restore Finesse is always
available. Arcane Table exposes a Live 3D objects toggle and provides still artwork
on TV, reduced motion, animation disable, WebGL initialization failure, or context
loss. A creator-guide download is available directly in the section.

ThemePicker, ThemeSettings and src/lib/theme.ts are the current entry points.
Theme choices are not synced to the account. Changing a theme does not overwrite
the account accent. Default, Midnight Cinema and Arcane Table are built in.

## Next: installable community packs

Add Installed, Import and Create areas within Themes, with a simple visual gallery.
Keep the default theme and recovery action reachable regardless of selected art.
Do not display nonfunctional import buttons before the importer exists.

An installable pack should supply a versioned manifest, semantic tokens, local
artwork, approved fonts, known layout/motion presets, preview images, author/version,
license, credits, supported app versions and capabilities. The first format should
not load arbitrary JavaScript, CSS, shaders or Blender files into signed-in Finesse.
Original layout components and live 3D interactions remain reviewed source work.

Flow: choose archive → validate → show author/license/compatibility → preview on
real library data without replacing the saved theme → Apply or Cancel. Keep the
previous selection for Revert. Invalid or incomplete packs leave it intact. If an
active asset fails, use known fallback materials and make Restore Finesse available.
Uninstall an active pack by first restoring the default. Updating a pack is an
explicit action; do not fetch or replace its files in the background.

Validation must bound archive bytes, expanded bytes, file count, decoded image
dimensions and asset types; reject external URLs, path traversal, executable code,
duplicate IDs and unsupported schemas. Theme artwork must not cover login, account
or recovery controls. Keep account accent and reduced-motion preferences intact.

## Creator experience

Start with a source guide and sample theme. Then add a declarative editor with live
preview, colors/materials, artwork slots, supported layout presets and export.
Preview phone, tablet, desktop and TV, plus long text, missing artwork, loading,
empty and error states. Foldable previews are design aids, not hardware certification.

Publish an actual schema and validator together before advertising ZIP compatibility.
Build a small reference pack and use it to verify import, preview, apply, cancel,
reload, update, rollback and uninstall. A sample JSON proposal is not an implemented
API. See FOLDABLES-AND-THEME-PACKS.md for the earlier manifest sketch and pane ideas.

## Showcase quality bar

Use one cohesive art direction, separate artwork from controls, preserve original
posters and video, and keep all required routes available. At least 44px targets,
visible labels and coherent focus outlines are required. Every animation has a
reduced-motion alternative. Three-dimensional effects must degrade without losing
actions, and should run only while visible. Measure bytes, memory and device frame
rate rather than assuming a small canvas is inexpensive.

The current preview adds a real Blender orb and hinged library boxes with runtime lighting. It does not
claim an entirely 3D tabletop, cross-object dynamic shadows, hardware-tested
foldables, imported themes, a visual editor or a public theme gallery.
