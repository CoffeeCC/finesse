/// <reference types="vite/client" />

// Injected by Vite `define` (see vite.config.ts). True only in the webOS TV
// build (`--mode webos`), where the app runs as a sideloaded single-file bundle
// off a file:// origin instead of being served under /finesse/ by nginx.
declare const __WEBOS__: boolean

// Version of the currently-running bundle, baked in at build time from
// package.json. Used by the OTA self-updater to compare against GitHub releases.
declare const __APP_VERSION__: string
