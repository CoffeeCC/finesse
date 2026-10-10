import { finesseRoot, useFinesse } from '../lib/finesseServer'
import { useToast } from './Toast'

const isLocal = (host: string) => host === 'localhost' || host === '[::1]' || host.startsWith('127.')

/** "Open Finesse on another device": the address to type, said plainly and big. */
export default function ConnectDevices() {
  const { info } = useFinesse()
  const toast = useToast()
  const root = new URL(finesseRoot() || window.location.origin)
  // On the server itself the address bar says "localhost", which no other device can use.
  const host = isLocal(root.hostname) ? info?.lanHost || null : root.hostname
  const base = host ? `${root.protocol}//${host}${root.port ? `:${root.port}` : ''}` : null
  const app = base ? `${base}/finesse/` : null
  const tvAddress = base ? base.replace(/^https?:\/\//, '') : null
  const jellyfin = base && info?.jellyfin ? `${base}${info.jellyfin.path}` : null
  const away = info?.publicUrl ? `${info.publicUrl.replace(/\/+$/, '')}/finesse/` : null

  const copy = (text: string) =>
    navigator.clipboard
      .writeText(text)
      .then(() => toast('Address copied'))
      .catch(() => toast('Couldn’t copy. Select the address and copy it yourself.', 'error'))

  return (
    <div className="rounded-2xl border border-emerald-400/30 bg-emerald-400/[0.06] p-5">
      <p className="text-[15px] font-semibold text-white">Open Finesse on a phone, tablet, TV or another computer</p>
      {app ? (
        <>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-200">Connect it to the same Wi-Fi as this server, then open this address in its web browser:</p>
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <code className="select-all break-all rounded-xl bg-black/30 px-4 py-3 text-lg font-semibold text-white sm:text-xl">{app}</code>
            <button type="button" onClick={() => copy(app)} className="h-10 rounded-full bg-white/10 px-4 text-sm font-semibold text-white transition-colors hover:bg-white/20">
              Copy
            </button>
          </div>
          <dl className="mt-4 space-y-2.5 text-[13.5px] leading-relaxed">
            <div>
              <dt className="font-semibold text-white">LG TV</dt>
              <dd className="text-ink-200">
                Install the Finesse app, then enter <b className="text-white select-all">{tvAddress}</b>.
              </dd>
            </div>
            {jellyfin && (
              <div>
                <dt className="font-semibold text-white">Other TVs and players (the Jellyfin app)</dt>
                <dd className="text-ink-200">
                  Use this as the server address: <b className="text-white select-all">{jellyfin}</b>
                </dd>
              </div>
            )}
            <div>
              <dt className="font-semibold text-white">Away from home</dt>
              <dd className="text-ink-200">
                {away ? (
                  <>
                    Open <b className="text-white select-all">{away}</b>
                  </>
                ) : (
                  <>This address only works at home. To watch away from home, set up remote access (Settings → Server → Downloads &amp; away from home).</>
                )}
              </dd>
            </div>
          </dl>
        </>
      ) : (
        <>
          <p className="mt-1 text-[13.5px] leading-relaxed text-ink-200">
            This page is open on the server itself, so it can’t tell which address your other devices should use. On them, open this in a web browser (on the same Wi-Fi):
          </p>
          <code className="mt-3 block select-all break-all rounded-xl bg-black/30 px-4 py-3 text-lg font-semibold text-white sm:text-xl">
            http://<span className="text-amber-200">this-computers-address</span>:{root.port || '8080'}/finesse/
          </code>
          <p className="mt-4 text-[13.5px] font-semibold text-white">To find this computer’s address (it looks like 192.168.1.20):</p>
          <ol className="mt-1.5 list-decimal space-y-1 pl-5 text-[13.5px] leading-relaxed text-ink-200">
            <li>
              <b className="text-white">Windows:</b> open Command Prompt, type <b className="text-white">ipconfig</b> and read the “IPv4 Address”.
            </li>
            <li>
              <b className="text-white">Linux or a NAS:</b> run <b className="text-white">hostname -I</b>.
            </li>
            <li>
              <b className="text-white">Any computer:</b> it’s also in your router’s app, in the list of connected devices.
            </li>
          </ol>
        </>
      )}
    </div>
  )
}
