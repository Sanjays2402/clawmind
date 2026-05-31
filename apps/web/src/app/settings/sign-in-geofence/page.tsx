'use client';
// Sign-in geofence settings page. Owner-only on the server; non-owners
// will see a 403 from the API call and the page renders an error. We
// pair the policy editor with a live probe of the country the server
// would resolve for THIS browser so an admin can confirm reverse-proxy
// header wiring before flipping the switch on.

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import {
  api,
  ApiError,
  type SignInGeofenceRecord,
  type SignInGeofenceLimits,
  type SignInGeofenceProbe,
} from '@/lib/api';
import {
  Spinner,
  IconShield,
  IconNetwork,
  IconPlus,
  IconTrash,
  IconCheck,
  IconWarning,
  IconArrowRight,
} from '@clawmind/ui';

function uniqueUpper(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of list) {
    const v = raw.trim().toUpperCase();
    if (!/^[A-Z]{2}$/.test(v)) continue;
    if (seen.has(v)) continue;
    seen.add(v);
    out.push(v);
  }
  return out;
}

function isDirty(
  rec: SignInGeofenceRecord,
  enabled: boolean,
  mode: 'allow' | 'block',
  countries: string[],
  requireCountry: boolean,
): boolean {
  if (rec.enabled !== enabled) return true;
  if (rec.mode !== mode) return true;
  if (rec.requireCountry !== requireCountry) return true;
  if (rec.countries.length !== countries.length) return true;
  for (let i = 0; i < countries.length; i++) {
    if (rec.countries[i] !== countries[i]) return true;
  }
  return false;
}

export default function SignInGeofencePage() {
  const [record, setRecord] = useState<SignInGeofenceRecord | null>(null);
  const [limits, setLimits] = useState<SignInGeofenceLimits | null>(null);
  const [probe, setProbe] = useState<SignInGeofenceProbe | null>(null);
  const [enabled, setEnabled] = useState(false);
  const [mode, setMode] = useState<'allow' | 'block'>('allow');
  const [countries, setCountries] = useState<string[]>([]);
  const [requireCountry, setRequireCountry] = useState(true);
  const [pending, setPending] = useState('');
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);
  const [confirmLockout, setConfirmLockout] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [r, p] = await Promise.all([
        api.signInGeofenceGet(),
        api.signInGeofenceProbe().catch(() => null),
      ]);
      setRecord(r.record);
      setLimits(r.limits);
      setProbe(p);
      setEnabled(r.record.enabled);
      setMode(r.record.mode);
      setCountries([...r.record.countries]);
      setRequireCountry(r.record.requireCountry);
      setConfirmLockout(false);
    } catch (e) {
      if (e instanceof ApiError) setErr(e.message);
      else setErr('Failed to load sign-in geofence');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const dirty = useMemo(
    () => (record ? isDirty(record, enabled, mode, countries, requireCountry) : false),
    [record, enabled, mode, countries, requireCountry],
  );

  const addCountry = useCallback(() => {
    const list = uniqueUpper([...countries, pending]);
    setCountries(list);
    setPending('');
  }, [countries, pending]);

  const removeCountry = useCallback((code: string) => {
    setCountries((prev) => prev.filter((c) => c !== code));
  }, []);

  const save = useCallback(async () => {
    if (!record) return;
    setSaving(true);
    setSaveErr(null);
    try {
      const next = await api.signInGeofencePut({
        enabled,
        mode,
        countries,
        requireCountry,
        confirmSelfLockoutAccepted: confirmLockout || undefined,
      });
      setRecord(next);
      setSavedAt(Date.now());
      setConfirmLockout(false);
    } catch (e) {
      if (e instanceof ApiError) {
        if (e.status === 422) {
          setSaveErr(
            'This policy would block your current sign-in. Adjust the list or tick the confirm box below and save again.',
          );
        } else {
          setSaveErr(e.message);
        }
      } else {
        setSaveErr('Failed to save');
      }
    } finally {
      setSaving(false);
    }
  }, [record, enabled, mode, countries, requireCountry, confirmLockout]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="mb-6 flex items-start gap-3">
          <IconShield className="mt-1 h-6 w-6 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold tracking-tight">Sign-in geofence</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Restrict where members may complete a GitHub or OIDC sign-in. The
              country is resolved from a trusted upstream header such as
              <code className="mx-1 rounded bg-muted px-1 py-0.5 text-xs">cf-ipcountry</code>
              and evaluated only at the OAuth callback, so an existing session
              is not killed when a member travels.
            </p>
          </div>
        </div>

        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" aria-live="polite">
            <Spinner /> Loading policy
          </div>
        ) : err ? (
          <div className="rounded-md border border-destructive/40 bg-destructive/5 p-4 text-sm">
            <div className="flex items-center gap-2 font-medium text-destructive">
              <IconWarning className="h-4 w-4" /> {err}
            </div>
            <button
              onClick={() => void load()}
              className="mt-2 text-xs underline underline-offset-2 hover:text-foreground"
            >
              Try again
            </button>
          </div>
        ) : record && limits ? (
          <div className="space-y-6">
            <section className="rounded-lg border bg-card p-4">
              <div className="flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-medium">Enforcement</h2>
                  <p className="text-xs text-muted-foreground">
                    When off, every authenticated callback is permitted regardless of country.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={enabled}
                    onChange={(e) => setEnabled(e.target.checked)}
                    className="h-4 w-4 accent-foreground"
                    aria-label="Enable sign-in geofence"
                  />
                  {enabled ? 'Enabled' : 'Disabled'}
                </label>
              </div>

              <fieldset className="mt-4 grid grid-cols-1 gap-2 sm:grid-cols-2" disabled={!enabled}>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${
                    mode === 'allow' ? 'border-foreground/40 bg-muted/40' : 'border-border'
                  } ${enabled ? '' : 'opacity-50'}`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value="allow"
                    checked={mode === 'allow'}
                    onChange={() => setMode('allow')}
                    className="mt-0.5 h-4 w-4 accent-foreground"
                  />
                  <span>
                    <span className="font-medium">Allow only listed</span>
                    <span className="block text-xs text-muted-foreground">
                      Sign-ins must originate from one of the countries below.
                    </span>
                  </span>
                </label>
                <label
                  className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 text-sm ${
                    mode === 'block' ? 'border-foreground/40 bg-muted/40' : 'border-border'
                  } ${enabled ? '' : 'opacity-50'}`}
                >
                  <input
                    type="radio"
                    name="mode"
                    value="block"
                    checked={mode === 'block'}
                    onChange={() => setMode('block')}
                    className="mt-0.5 h-4 w-4 accent-foreground"
                  />
                  <span>
                    <span className="font-medium">Block listed</span>
                    <span className="block text-xs text-muted-foreground">
                      Every country is permitted except those below.
                    </span>
                  </span>
                </label>
              </fieldset>

              <label className="mt-4 flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={requireCountry}
                  onChange={(e) => setRequireCountry(e.target.checked)}
                  disabled={!enabled}
                  className="mt-0.5 h-4 w-4 accent-foreground"
                />
                <span>
                  <span className="font-medium">Fail closed on unknown country</span>
                  <span className="block text-xs text-muted-foreground">
                    Block any sign-in where no trusted header resolves to a country. Recommended.
                  </span>
                </span>
              </label>
            </section>

            <section className="rounded-lg border bg-card p-4">
              <div className="mb-3 flex items-center justify-between">
                <div>
                  <h2 className="text-sm font-medium">
                    Countries <span className="text-xs text-muted-foreground">({countries.length}/{limits.maxCountries})</span>
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    ISO 3166-1 alpha-2 codes (US, DE, JP). Pasting a comma-separated list works.
                  </p>
                </div>
              </div>

              <div className="flex gap-2">
                <input
                  type="text"
                  value={pending}
                  onChange={(e) => setPending(e.target.value)}
                  onPaste={(e) => {
                    const text = e.clipboardData.getData('text');
                    if (text.includes(',')) {
                      e.preventDefault();
                      const list = uniqueUpper([...countries, ...text.split(/[\s,]+/)]);
                      setCountries(list);
                      setPending('');
                    }
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      addCountry();
                    }
                  }}
                  placeholder="US"
                  maxLength={2}
                  className="flex-1 rounded-md border bg-background px-3 py-2 text-sm uppercase tracking-widest focus:border-foreground/40 focus:outline-none"
                  aria-label="Country code"
                />
                <button
                  onClick={addCountry}
                  disabled={!/^[a-z]{2}$/i.test(pending.trim())}
                  className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm hover:bg-muted disabled:opacity-50"
                >
                  <IconPlus className="h-4 w-4" /> Add
                </button>
              </div>

              {countries.length === 0 ? (
                <p className="mt-3 text-xs italic text-muted-foreground">
                  No countries yet. Allow-mode cannot be enabled with an empty list.
                </p>
              ) : (
                <ul className="mt-3 flex flex-wrap gap-2">
                  {countries.map((c) => (
                    <li
                      key={c}
                      className="inline-flex items-center gap-2 rounded-full border bg-muted/40 px-3 py-1 text-xs"
                    >
                      <span className="font-mono">{c}</span>
                      <button
                        onClick={() => removeCountry(c)}
                        aria-label={`Remove ${c}`}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <IconTrash className="h-3 w-3" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </section>

            <section className="rounded-lg border bg-card p-4">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-medium">
                <IconNetwork className="h-4 w-4 text-muted-foreground" /> What the server sees
              </h2>
              {probe ? (
                <dl className="grid grid-cols-3 gap-2 text-xs">
                  <dt className="text-muted-foreground">Resolved country</dt>
                  <dd className="col-span-2 font-mono">
                    {probe.country ?? <span className="italic text-muted-foreground">none</span>}
                  </dd>
                  <dt className="text-muted-foreground">Source header</dt>
                  <dd className="col-span-2 font-mono">
                    {probe.source ?? <span className="italic text-muted-foreground">none of {probe.usingHeaders.join(', ')}</span>}
                  </dd>
                  <dt className="text-muted-foreground">Your IP</dt>
                  <dd className="col-span-2 font-mono">{probe.ip}</dd>
                  <dt className="text-muted-foreground">Current decision</dt>
                  <dd className="col-span-2">
                    {probe.wouldAllow ? (
                      <span className="inline-flex items-center gap-1 text-emerald-600">
                        <IconCheck className="h-3 w-3" /> Allowed
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 text-destructive">
                        <IconWarning className="h-3 w-3" /> Blocked ({probe.reason})
                      </span>
                    )}
                  </dd>
                </dl>
              ) : (
                <p className="text-xs italic text-muted-foreground">Probe unavailable.</p>
              )}
            </section>

            {saveErr ? (
              <div className="rounded-md border border-destructive/40 bg-destructive/5 p-3 text-sm">
                <div className="flex items-center gap-2 text-destructive">
                  <IconWarning className="h-4 w-4" /> {saveErr}
                </div>
                {saveErr.includes('confirm') ? (
                  <label className="mt-2 flex items-start gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={confirmLockout}
                      onChange={(e) => setConfirmLockout(e.target.checked)}
                      className="mt-0.5 h-3 w-3 accent-foreground"
                    />
                    <span>
                      I understand this will block sign-ins from my current country and I have an alternate way back in.
                    </span>
                  </label>
                ) : null}
              </div>
            ) : null}

            <div className="flex items-center justify-between gap-3 border-t pt-4">
              <div className="text-xs text-muted-foreground">
                {record.updatedBy ? (
                  <>Last updated by <span className="font-mono">{record.updatedBy}</span></>
                ) : (
                  <>Never modified</>
                )}
                {savedAt ? (
                  <span className="ml-2 inline-flex items-center gap-1 text-emerald-600">
                    <IconCheck className="h-3 w-3" /> Saved
                  </span>
                ) : null}
              </div>
              <div className="flex gap-2">
                <button
                  onClick={() => void load()}
                  disabled={saving}
                  className="rounded-md border px-3 py-2 text-sm hover:bg-muted"
                >
                  Reset
                </button>
                <button
                  onClick={() => void save()}
                  disabled={!dirty || saving}
                  className="inline-flex items-center gap-1 rounded-md bg-foreground px-3 py-2 text-sm font-medium text-background hover:opacity-90 disabled:opacity-50"
                >
                  {saving ? <Spinner /> : <IconArrowRight className="h-4 w-4" />}
                  Save policy
                </button>
              </div>
            </div>

            <p className="text-xs text-muted-foreground">
              Need the curl recipe?{' '}
              <Link className="underline underline-offset-2" href="/settings">
                Back to settings
              </Link>
              .
            </p>
          </div>
        ) : null}
      </main>
    </div>
  );
}
