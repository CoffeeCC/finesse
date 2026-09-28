// Form building blocks for the setup wizard (and the System settings page).

import { useId, useState, type ReactNode } from 'react'
import type { Verdict } from '../../api/setup'

export const inputClass =
  'w-full h-11 rounded-xl bg-ink-900/80 border border-white/10 px-3.5 text-[15px] text-white placeholder:text-ink-400/70 outline-none focus:border-accent-400 focus:bg-ink-900 transition-colors disabled:opacity-60'

export function Field({ label, hint, error, children, optional }: { label: string; hint?: ReactNode; error?: string | null; children: (id: string) => ReactNode; optional?: boolean }) {
  const id = useId()
  return (
    <div className="min-w-0">
      <label htmlFor={id} className="flex items-baseline justify-between gap-2 text-[13px] font-medium text-ink-200">
        <span>{label}</span>
        {optional && <span className="text-[11px] font-normal text-ink-400">Optional</span>}
      </label>
      <div className="mt-1.5">{children(id)}</div>
      {error ? <p className="mt-1.5 text-[12.5px] text-red-300">{error}</p> : hint ? <p className="mt-1.5 text-[12.5px] leading-relaxed text-ink-400">{hint}</p> : null}
    </div>
  )
}

export function TextField(props: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder?: string
  hint?: ReactNode
  error?: string | null
  type?: string
  autoComplete?: string
  optional?: boolean
  mono?: boolean
  inputMode?: 'text' | 'numeric' | 'email' | 'url'
  autoFocus?: boolean
  disabled?: boolean
}) {
  const [show, setShow] = useState(false)
  const isPw = props.type === 'password'
  return (
    <Field label={props.label} hint={props.hint} error={props.error} optional={props.optional}>
      {(id) => (
        <div className="relative">
          <input
            id={id}
            className={`${inputClass} ${props.mono ? 'font-mono text-[13.5px]' : ''} ${isPw ? 'pr-16' : ''}`}
            type={isPw && show ? 'text' : (props.type ?? 'text')}
            value={props.value}
            placeholder={props.placeholder}
            autoComplete={props.autoComplete ?? 'off'}
            spellCheck={false}
            autoCapitalize="off"
            inputMode={props.inputMode}
            autoFocus={props.autoFocus}
            disabled={props.disabled}
            onChange={(e) => props.onChange(e.target.value)}
          />
          {isPw && (
            <button
              type="button"
              onClick={() => setShow((s) => !s)}
              className="absolute right-2 top-1/2 -translate-y-1/2 h-7 rounded-lg px-2 text-[12px] font-medium text-ink-400 hover:text-white hover:bg-white/10"
            >
              {show ? 'Hide' : 'Show'}
            </button>
          )}
        </div>
      )}
    </Field>
  )
}

export function SelectField({ label, value, onChange, options, hint }: { label: string; value: string; onChange: (v: string) => void; options: { value: string; label: string }[]; hint?: ReactNode }) {
  return (
    <Field label={label} hint={hint}>
      {(id) => (
        <div className="relative">
          <select id={id} className={`${inputClass} appearance-none pr-9`} value={value} onChange={(e) => onChange(e.target.value)}>
            {options.map((o) => (
              <option key={o.value} value={o.value} className="bg-ink-900">
                {o.label}
              </option>
            ))}
          </select>
          <svg className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-ink-400" viewBox="0 0 20 20" fill="currentColor" aria-hidden>
            <path d="M5.3 7.3a1 1 0 0 1 1.4 0L10 10.6l3.3-3.3a1 1 0 1 1 1.4 1.4l-4 4a1 1 0 0 1-1.4 0l-4-4a1 1 0 0 1 0-1.4Z" />
          </svg>
        </div>
      )}
    </Field>
  )
}

export function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (v: boolean) => void; label: string; description?: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="own-focus group flex w-full items-start gap-3 rounded-xl p-2 -m-2 text-left outline-none focus-visible:bg-white/5">
      <span className={`mt-0.5 relative inline-flex h-6 w-10 shrink-0 rounded-full transition-colors ${checked ? 'bg-accent-fill' : 'bg-white/15'} group-focus-visible:ring-2 group-focus-visible:ring-accent-400`}>
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${checked ? 'left-[18px]' : 'left-0.5'}`} />
      </span>
      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-white">{label}</span>
        {description && <span className="mt-0.5 block text-[13px] leading-relaxed text-ink-400">{description}</span>}
      </span>
    </button>
  )
}

/** A big selectable card (radio or checkbox semantics). */
export function ChoiceCard({
  selected,
  onClick,
  icon,
  title,
  badge,
  children,
  multi,
}: {
  selected: boolean
  onClick: () => void
  icon?: ReactNode
  title: string
  badge?: string
  children?: ReactNode
  multi?: boolean
}) {
  return (
    <button
      type="button"
      role={multi ? 'checkbox' : 'radio'}
      aria-checked={selected}
      onClick={onClick}
      className={`own-focus group relative w-full rounded-2xl border p-4 text-left outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-accent-400 ${
        selected ? 'border-accent-400/80 bg-accent-500/[0.12] shadow-[0_0_0_1px_rgba(117,137,216,0.35)]' : 'border-white/10 bg-white/[0.03] hover:border-white/25 hover:bg-white/[0.06]'
      }`}
    >
      <div className="flex items-start gap-3.5">
        {icon && <span className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-xl ${selected ? 'bg-accent-fill text-white' : 'bg-white/[0.07] text-ink-200'} transition-colors`}>{icon}</span>}
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[15.5px] font-semibold text-white">{title}</span>
            {badge && <span className="rounded-full bg-emerald-400/15 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">{badge}</span>}
          </span>
          {children && <span className="mt-1 block text-[13.5px] leading-relaxed text-ink-400">{children}</span>}
        </span>
        <span className={`mt-1 flex h-5 w-5 shrink-0 items-center justify-center ${multi ? 'rounded-md' : 'rounded-full'} border ${selected ? 'border-accent-400 bg-accent-fill' : 'border-white/25'}`}>
          {selected && (
            <svg viewBox="0 0 20 20" className="h-3.5 w-3.5 text-white" fill="currentColor" aria-hidden>
              <path d="M16.7 5.3a1 1 0 0 1 0 1.4l-8 8a1 1 0 0 1-1.4 0l-4-4a1 1 0 1 1 1.4-1.4L8 12.6l7.3-7.3a1 1 0 0 1 1.4 0Z" />
            </svg>
          )}
        </span>
      </div>
    </button>
  )
}

export function Callout({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'error' | 'ok'; title?: string; children: ReactNode }) {
  const style = {
    info: 'border-accent-400/25 bg-accent-500/[0.08] text-ink-200',
    warn: 'border-amber-300/25 bg-amber-300/[0.07] text-amber-100',
    error: 'border-red-400/30 bg-red-500/[0.08] text-red-100',
    ok: 'border-emerald-400/25 bg-emerald-400/[0.07] text-emerald-100',
  }[tone]
  return (
    <div className={`rounded-xl border px-4 py-3 text-[13.5px] leading-relaxed ${style}`}>
      {title && <p className="mb-0.5 font-semibold text-white">{title}</p>}
      <div>{children}</div>
    </div>
  )
}

export function Spinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <svg className={`animate-spin ${className}`} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeOpacity="0.25" strokeWidth="3" />
      <path d="M21.5 12A9.5 9.5 0 0 0 12 2.5" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  )
}

export function StatusDot({ ok, pending }: { ok: boolean | null; pending?: boolean }) {
  if (pending) return <Spinner className="h-4 w-4 text-ink-400" />
  if (ok === null) return <span className="h-2.5 w-2.5 rounded-full bg-amber-300" />
  return ok ? (
    <svg viewBox="0 0 20 20" className="h-5 w-5 text-emerald-400" fill="currentColor" aria-label="OK">
      <path d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16Zm3.7-9.3a1 1 0 0 0-1.4-1.4L9 10.6 7.7 9.3a1 1 0 0 0-1.4 1.4l2 2a1 1 0 0 0 1.4 0l4-4Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" className="h-5 w-5 text-red-400" fill="currentColor" aria-label="Problem">
      <path d="M10 18a8 8 0 1 0 0-16 8 8 0 0 0 0 16ZM8.7 7.3a1 1 0 0 0-1.4 1.4L8.6 10l-1.3 1.3a1 1 0 1 0 1.4 1.4l1.3-1.3 1.3 1.3a1 1 0 0 0 1.4-1.4L11.4 10l1.3-1.3a1 1 0 0 0-1.4-1.4L10 8.6 8.7 7.3Z" />
    </svg>
  )
}

/** "Test" button that runs a check and shows its verdict underneath. */
export function CheckButton({ label = 'Test', run, disabled, busyLabel = 'Testing…', onResult }: { label?: string; run: () => Promise<Verdict>; disabled?: boolean; busyLabel?: string; onResult?: (v: Verdict) => void }) {
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<Verdict | null>(null)
  return (
    <div className="flex flex-col gap-2">
      <div>
        <button
          type="button"
          disabled={disabled || busy}
          onClick={async () => {
            setBusy(true)
            setResult(null)
            try {
              const r = await run()
              setResult(r)
              onResult?.(r)
            } catch (e) {
              const r = { ok: false, message: (e as Error).message }
              setResult(r)
              onResult?.(r)
            } finally {
              setBusy(false)
            }
          }}
          className="inline-flex h-9 items-center gap-2 rounded-full border border-white/15 bg-white/[0.06] px-4 text-[13px] font-semibold text-white hover:bg-white/[0.12] disabled:opacity-50 transition-colors"
        >
          {busy && <Spinner className="h-3.5 w-3.5" />}
          {busy ? busyLabel : label}
        </button>
      </div>
      {result && (
        <div className={`flex items-start gap-2 text-[13px] leading-relaxed ${result.ok ? 'text-emerald-200' : 'text-red-200'}`}>
          <span className="mt-px shrink-0">
            <StatusDot ok={result.ok} />
          </span>
          <span>{result.message}</span>
        </div>
      )}
    </div>
  )
}

export function PrimaryButton({ children, onClick, disabled, busy, type = 'button', className = '' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; busy?: boolean; type?: 'button' | 'submit'; className?: string }) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled || busy}
      className={`inline-flex h-11 items-center justify-center gap-2 rounded-full bg-accent-fill px-6 text-[15px] font-semibold text-white shadow-lg shadow-accent-600/25 hover:brightness-110 active:scale-[0.98] disabled:opacity-45 disabled:hover:brightness-100 disabled:active:scale-100 transition-all ${className}`}
    >
      {busy && <Spinner />}
      {children}
    </button>
  )
}

export function GhostButton({ children, onClick, disabled, className = '' }: { children: ReactNode; onClick?: () => void; disabled?: boolean; className?: string }) {
  return (
    <button type="button" onClick={onClick} disabled={disabled} className={`inline-flex h-11 items-center justify-center gap-2 rounded-full px-5 text-[15px] font-medium text-ink-200 hover:text-white hover:bg-white/[0.07] disabled:opacity-40 transition-colors ${className}`}>
      {children}
    </button>
  )
}

export function SectionTitle({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <h3 className="text-[12px] font-semibold uppercase tracking-[0.12em] text-ink-400">{children}</h3>
      {action}
    </div>
  )
}

export function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="font-medium text-accent-300 underline decoration-accent-300/30 underline-offset-2 hover:decoration-accent-300">
      {children}
    </a>
  )
}

export const gb = (n: number) => `${(n / 1e9).toFixed(n >= 100e9 ? 0 : 1)} GB`
