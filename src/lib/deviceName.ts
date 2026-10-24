// How a device shows up in Jellyfin's session list, and so in Remote and every "Play on…" menu.
// TVs first: Android TV, Google TV, Fire TV and Shield all say "Android" too, and used to be
// called an Android tablet (or phone). ASCII only: it goes in an HTTP header.

const TVS: [RegExp, string][] = [
  [/Web0S|webOS|NetCast/, 'LG TV'],
  [/Tizen|SMART-TV.*Samsung|SamsungBrowser.*TV/, 'Samsung TV'],
  [/AFT[A-Z]/, 'Fire TV'],
  [/SHIELD/, 'Shield TV'],
  [/BRAVIA/, 'Sony TV'],
  [/VIDAA|Hisense/, 'Hisense TV'],
  [/NETTV|Philips/, 'Philips TV'],
  [/Viera/, 'Panasonic TV'],
  [/AQUOSBrowser|AQUOS/, 'Sharp TV'],
  [/Vestel/, 'Vestel TV'],
  [/CrKey|Chromecast/, 'Chromecast'],
  [/GoogleTV|Google TV/, 'Google TV'],
  [/Android TV|AndroidTV/, 'Android TV'],
  [/SMART-TV|SmartTV|HbbTV|Opera TV|OPR\/[\d.]+ TV/, 'Smart TV'],
]

export function deviceNameFor(ua: string, webos = false): string {
  if (webos) return 'LG TV'
  const tv = TVS.find(([re]) => re.test(ua))
  if (tv) return tv[1]
  const device = /iPhone/.test(ua)
    ? 'iPhone'
    : /iPad|Macintosh.*Mobile/.test(ua)
      ? 'iPad'
      : /Android/.test(ua)
        ? /Mobile/.test(ua) ? 'Android phone' : 'Android tablet'
        : /CrOS/.test(ua)
          ? 'Chromebook'
          : /Windows/.test(ua)
            ? 'Windows'
            : /Mac OS X/.test(ua)
              ? 'Mac'
              : /Linux/.test(ua)
                ? 'Linux'
                : 'Browser'
  const browser = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : ''
  return browser ? `${browser} on ${device}` : device
}
