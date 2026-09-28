// Friendly defaults for the setup wizard: well-known providers prefill their
// technical details so people only type what's theirs (username, password,
// keys). Everything stays editable.

export interface UsenetPreset {
  id: string
  name: string
  host: string
  port: number
  connections: number
}

/** Popular Usenet providers (SSL on 563). Connection counts are conservative — raise them to your plan's limit. */
export const USENET_PRESETS: UsenetPreset[] = [
  { id: 'newshosting', name: 'Newshosting', host: 'news.newshosting.com', port: 563, connections: 50 },
  { id: 'eweka', name: 'Eweka', host: 'news.eweka.nl', port: 563, connections: 50 },
  { id: 'frugal', name: 'Frugal Usenet', host: 'news.frugalusenet.com', port: 563, connections: 50 },
  { id: 'usenetexpress', name: 'UsenetExpress', host: 'news.usenetexpress.com', port: 563, connections: 50 },
  { id: 'newsdemon', name: 'NewsDemon', host: 'news.newsdemon.com', port: 563, connections: 50 },
  { id: 'ninja', name: 'Newsgroup Ninja', host: 'news.newsgroup.ninja', port: 563, connections: 50 },
  { id: 'tweaknews', name: 'Tweaknews', host: 'news.tweaknews.eu', port: 563, connections: 40 },
  { id: 'easynews', name: 'Easynews', host: 'secure.news.easynews.com', port: 563, connections: 20 },
  { id: 'giganews', name: 'Giganews', host: 'news.giganews.com', port: 563, connections: 30 },
  { id: 'usenetfarm', name: 'Usenet.Farm', host: 'news.usenet.farm', port: 563, connections: 40 },
]

export interface SmtpPreset {
  id: string
  name: string
  host: string
  port: number
  secure: boolean
  username?: 'email' | string
  help: string
  link?: string
}

export const SMTP_PRESETS: SmtpPreset[] = [
  { id: 'gmail', name: 'Gmail', host: 'smtp.gmail.com', port: 465, secure: true, username: 'email', help: 'Use an app password (Google Account → Security → 2-Step Verification → App passwords), not your normal password.', link: 'https://myaccount.google.com/apppasswords' },
  { id: 'icloud', name: 'iCloud Mail', host: 'smtp.mail.me.com', port: 587, secure: false, username: 'email', help: 'Create an app-specific password at account.apple.com → Sign-In and Security.', link: 'https://account.apple.com' },
  { id: 'fastmail', name: 'Fastmail', host: 'smtp.fastmail.com', port: 465, secure: true, username: 'email', help: 'Settings → Privacy & Security → App passwords → new password for “Mail (SMTP)”.' },
  { id: 'zoho', name: 'Zoho Mail', host: 'smtp.zoho.com', port: 465, secure: true, username: 'email', help: 'Use an application-specific password if two-factor sign-in is on.' },
  { id: 'resend', name: 'Resend', host: 'smtp.resend.com', port: 465, secure: true, username: 'resend', help: 'Username is “resend”; the password is an API key. The from address must be on a domain you verified.' },
  { id: 'sendgrid', name: 'SendGrid', host: 'smtp.sendgrid.net', port: 587, secure: false, username: 'apikey', help: 'Username is literally “apikey”; the password is your API key. Verify the from address first.' },
  { id: 'other', name: 'Other', host: '', port: 587, secure: false, help: 'Your provider’s SMTP server. Port 587 (STARTTLS) or 465 (TLS).' },
]

export const QUALITY_PRESETS = [
  { id: '720p', title: 'Good · 720p', body: 'Smallest files (~1–2 GB a movie). Great on phones and slower connections.' },
  { id: '1080p', title: 'Great · 1080p', body: 'Sharp on every screen (~3–8 GB a movie). The sweet spot for most homes.', badge: 'Recommended' },
  { id: '4k', title: 'Best · 4K', body: 'For big TVs and fast networks (~15–60 GB a movie). Needs plenty of disk space.' },
  { id: 'any', title: 'Whatever’s available', body: 'Grab the first release that turns up, any quality. Fastest, least predictable.' },
] as const

export const LANGUAGES: { code: string; name: string }[] = [
  ['en', 'English'],
  ['es', 'Español'],
  ['fr', 'Français'],
  ['de', 'Deutsch'],
  ['it', 'Italiano'],
  ['pt', 'Português'],
  ['pt-BR', 'Português (Brasil)'],
  ['nl', 'Nederlands'],
  ['sv', 'Svenska'],
  ['nb', 'Norsk'],
  ['da', 'Dansk'],
  ['fi', 'Suomi'],
  ['pl', 'Polski'],
  ['cs', 'Čeština'],
  ['hu', 'Magyar'],
  ['ro', 'Română'],
  ['el', 'Ελληνικά'],
  ['tr', 'Türkçe'],
  ['ru', 'Русский'],
  ['uk', 'Українська'],
  ['ar', 'العربية'],
  ['he', 'עברית'],
  ['hi', 'हिन्दी'],
  ['ja', '日本語'],
  ['ko', '한국어'],
  ['zh-CN', '中文（简体）'],
  ['zh-TW', '中文（繁體）'],
].map(([code, name]) => ({ code: code!, name: name! }))

const ISO = 'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR MT MU MV MW MX MY MZ NA NE NG NI NL NO NP NR NZ OM PA PE PG PH PK PL PR PS PT PW PY QA RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW'.split(' ')

/** navigator.language, minus extensions some systems append ("en-US@posix"). */
const browserLang = () => (navigator.language || 'en-US').split(/[@.]/)[0]!.replace('_', '-')

export function countries(locale = browserLang()): { code: string; name: string }[] {
  let names: Intl.DisplayNames | null = null
  for (const locales of [[locale, 'en'], ['en']]) {
    try {
      names = new Intl.DisplayNames(locales, { type: 'region' })
      break
    } catch {
      /* invalid tag or old engine — try the next */
    }
  }
  return ISO.map((code) => ({ code, name: names?.of(code) ?? code })).sort((a, b) => a.name.localeCompare(b.name))
}

export function timeZones(): string[] {
  try {
    const list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone')
    if (list?.length) return list
  } catch {
    /* fall through */
  }
  return ['UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney']
}

/** Best guesses from the browser: time zone, country, language. */
export function browserLocale(): { timezone: string; country: string; language: string } {
  let timezone = 'UTC'
  try {
    timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  } catch {
    /* default */
  }
  const lang = browserLang()
  const [l, r] = lang.split('-')
  const country = r && /^[A-Z]{2}$/i.test(r) ? r.toUpperCase() : 'US'
  const exact = LANGUAGES.find((x) => x.code.toLowerCase() === lang.toLowerCase())
  const language = exact?.code ?? LANGUAGES.find((x) => x.code === l?.toLowerCase())?.code ?? 'en'
  return { timezone, country, language }
}

/** Parses a WireGuard .conf the provider gave you. */
export function parseWireGuard(text: string): { privateKey?: string; addresses?: string; presharedKey?: string; publicKey?: string; endpointIp?: string; endpointPort?: number } {
  const get = (k: string) => new RegExp(`^\\s*${k}\\s*=\\s*(.+?)\\s*$`, 'mi').exec(text)?.[1]
  const out: ReturnType<typeof parseWireGuard> = {}
  const pk = get('PrivateKey')
  if (pk) out.privateKey = pk
  const addr = get('Address')
  // Gluetun takes IPv4 addresses; drop IPv6 entries.
  if (addr) out.addresses = addr.split(',').map((a) => a.trim()).filter((a) => !a.includes(':')).join(',') || addr
  const psk = get('PresharedKey')
  if (psk) out.presharedKey = psk
  const pub = get('PublicKey')
  if (pub) out.publicKey = pub
  const ep = get('Endpoint')
  if (ep) {
    const m = /^\[?([^\]]+?)\]?:(\d+)$/.exec(ep)
    if (m) {
      out.endpointIp = m[1]
      out.endpointPort = Number(m[2])
    }
  }
  return out
}
