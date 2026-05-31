'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, type ChunkExplanation, type ExplainResponse } from '@/lib/api';
import {
  Logo,
  Spinner,
  IconSpark,
  IconChartBar,
  IconFolder,
  IconCheck,
  IconWarning,
} from '@clawmind/ui';

interface SampleQuery {
  id: string;
  title: string;
  q: string;
  hint: string;
}

const SAMPLES: SampleQuery[] = [
  {
    id: 'lexical',
    title: 'Lexical heavy',
    q: 'LanceDB BM25 hybrid alpha',
    hint: 'Rare tokens. BM25 should dominate the blend.',
  },
  {
    id: 'semantic',
    title: 'Semantic heavy',
    q: 'how does the system stay fresh when files change on disk?',
    hint: 'No obvious keywords. Dense embeddings should lead.',
  },
  {
    id: 'mixed',
    title: 'Mixed signal',
    q: 'tamper-evident audit log hash chain',
    hint: 'Specific feature plus paraphraseable intent.',
  },
];

function fmt(n: number | null | undefined, digits = 3): string {
  if (n == null || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

interface BarProps { value: number; color: string; label: string; raw?: number | null }
function Bar({ value, color, label, raw }: BarProps) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div className="flex items-center gap-2">
      <span className="cm-mono w-12 shrink-0 text-[10px] uppercase tracking-wider text-cm-faint">
        {label}
      </span>
      <div className="relative h-2 flex-1 overflow-hidden rounded-full bg-cm-border/40">
        <div
          className="absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${pct}%`, background: color }}
        />
      </div>
      <span className="cm-mono w-14 shrink-0 text-right text-[10px] tabular-nums text-cm-muted">
        {fmt(value, 2)}
      </span>
      {raw != null && (
        <span className="cm-mono hidden w-16 shrink-0 text-right text-[10px] tabular-nums text-cm-faint sm:inline">
          raw {fmt(raw, 2)}
        </span>
      )}
    </div>
  );
}

function CandidateCard({ c, alpha }: { c: ChunkExplanation; alpha: number }) {
  const finalBadge = c.inFinal ? (
    <span className="inline-flex items-center gap-1 rounded-md border border-cm-accent/40 bg-cm-accent/10 px-1.5 py-0.5 text-[10px] text-cm-fg">
      <IconCheck size={10} /> rank {c.finalRank}
    </span>
  ) : (
    <span className="inline-flex items-center rounded-md border border-cm-border px-1.5 py-0.5 text-[10px] text-cm-faint">
      filtered out
    </span>
  );
  return (
    <li
      className={`rounded-xl border p-4 ${c.inFinal ? 'border-cm-border bg-cm-bg' : 'border-cm-border/60 bg-cm-bg/60'}`}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[12px] text-cm-fg">
            <IconFolder size={12} />
            <span className="truncate">{c.displayPath ?? c.path}</span>
            <span className="cm-mono text-[10px] text-cm-faint">
              L{c.startLine}-{c.endLine}
            </span>
          </div>
          <p className="mt-2 line-clamp-2 text-[12px] leading-snug text-cm-muted">{c.excerpt}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          {finalBadge}
          <span className="cm-mono rounded-md border border-cm-border px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-cm-faint">
            {c.namespace}
          </span>
        </div>
      </div>
      <div className="mt-4 space-y-2">
        <Bar label="bm25" value={c.bm25Norm} raw={c.bm25Raw} color="var(--cm-accent, #b07a3a)" />
        <Bar label="dense" value={c.denseNorm} raw={c.denseRaw} color="#4f8cc4" />
        <Bar label="hybrid" value={c.hybridScore} color="#7a7a7a" />
        <Bar label="rerank" value={c.rerankedScore} color="#5a5a5a" />
        {c.mmrScore != null && <Bar label="mmr" value={c.mmrScore} color="#2a2a2a" />}
      </div>
      <div className="mt-3 flex items-center justify-between">
        <span className="cm-mono text-[10px] text-cm-faint">
          blend: {fmt(alpha, 2)}·dense + {fmt(1 - alpha, 2)}·bm25
        </span>
        <Link
          href={`/sources/view?path=${encodeURIComponent(c.path)}`}
          className="cm-mono text-[10px] text-cm-fg hover:underline"
        >
          open source
        </Link>
      </div>
    </li>
  );
}

export default function ExplainPage() {
  const [q, setQ] = useState('');
  const [alpha, setAlpha] = useState(0.5);
  const [lambda, setLambda] = useState(0.5);
  const [k, setK] = useState(8);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<ExplainResponse | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);

  async function run(query: string) {
    const trimmed = query.trim();
    if (!trimmed || loading) return;
    setQ(query);
    setLoading(true);
    setError(null);
    setData(null);
    setLatencyMs(null);
    const t0 = performance.now();
    try {
      const res = await api.explain({ q: trimmed, k, hybridAlpha: alpha, mmrLambda: lambda });
      setData(res);
      setLatencyMs(Math.round(performance.now() - t0));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault();
        run(q);
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [q, k, alpha, lambda, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  const showEmpty = !loading && !data && !error;

  return (
    <main className="min-h-screen flex flex-col bg-cm-bg">
      <TopNav />

      <section className="mx-auto w-full max-w-[1180px] px-6 pt-12 pb-6 sm:px-10">
        <div className="flex items-center gap-2 text-[12px] text-cm-faint">
          <Logo size={14} />
          <span className="cm-mono uppercase tracking-[0.14em]">Retrieval explain</span>
        </div>
        <h1 className="cm-display mt-4 text-[40px] sm:text-[56px] leading-[1.02] text-cm-fg">
          See why each chunk got picked.
        </h1>
        <p className="mt-4 max-w-[680px] text-[15px] leading-relaxed text-cm-muted">
          Run a query and inspect the per-chunk BM25 score, dense cosine, hybrid blend, lexical
          rerank, and MMR score. Same pipeline as ask, no LLM call. Tune alpha and lambda to feel
          how the ranking shifts.
        </p>
      </section>

      <section className="mx-auto w-full max-w-[1180px] px-6 sm:px-10">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {SAMPLES.map((s) => (
            <button
              key={s.id}
              onClick={() => run(s.q)}
              disabled={loading}
              className="group rounded-xl border border-cm-border bg-cm-bg p-4 text-left transition hover:border-cm-fg/40 disabled:opacity-60"
            >
              <div className="flex items-center gap-2 text-cm-fg">
                <IconChartBar size={14} />
                <span className="text-[13px] font-medium">{s.title}</span>
              </div>
              <p className="mt-2 text-[13px] leading-snug text-cm-fg">{s.q}</p>
              <p className="mt-2 text-[11px] leading-relaxed text-cm-muted">{s.hint}</p>
            </button>
          ))}
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1180px] px-6 sm:px-10 mt-6">
        <div className="rounded-xl border border-cm-border bg-cm-bg p-4 sm:p-5">
          <label htmlFor="explain-q" className="cm-mono text-[10px] uppercase tracking-[0.14em] text-cm-faint">
            Query
          </label>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-start">
            <input
              id="explain-q"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="LanceDB hybrid retrieval with MMR"
              className="flex-1 rounded-md border border-cm-border bg-cm-bg p-3 text-[14px] text-cm-fg outline-none focus:border-cm-fg/50"
            />
            <button
              onClick={() => run(q)}
              disabled={loading || !q.trim()}
              className="inline-flex items-center gap-1.5 rounded-md bg-cm-fg px-4 py-2.5 text-[13px] font-medium text-cm-bg disabled:opacity-50"
            >
              <IconSpark size={14} />
              Explain
            </button>
          </div>

          <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div>
              <label className="cm-mono text-[10px] uppercase tracking-[0.14em] text-cm-faint">
                alpha · dense weight {fmt(alpha, 2)}
              </label>
              <input
                type="range" min={0} max={1} step={0.05} value={alpha}
                onChange={(e) => setAlpha(Number(e.target.value))}
                className="mt-1 w-full accent-cm-fg"
              />
            </div>
            <div>
              <label className="cm-mono text-[10px] uppercase tracking-[0.14em] text-cm-faint">
                lambda · MMR diversity {fmt(lambda, 2)}
              </label>
              <input
                type="range" min={0} max={1} step={0.05} value={lambda}
                onChange={(e) => setLambda(Number(e.target.value))}
                className="mt-1 w-full accent-cm-fg"
              />
            </div>
            <div>
              <label className="cm-mono text-[10px] uppercase tracking-[0.14em] text-cm-faint">
                top k {k}
              </label>
              <input
                type="range" min={1} max={20} step={1} value={k}
                onChange={(e) => setK(Number(e.target.value))}
                className="mt-1 w-full accent-cm-fg"
              />
            </div>
          </div>
          <p className="cm-mono mt-3 text-[11px] text-cm-faint">cmd + enter to re-run</p>
        </div>
      </section>

      <section className="mx-auto w-full max-w-[1180px] flex-1 px-6 pb-24 pt-6 sm:px-10">
        {showEmpty && (
          <div className="rounded-xl border border-dashed border-cm-border p-10 text-center">
            <IconChartBar size={20} />
            <p className="mt-3 text-[14px] text-cm-fg">Pick a sample or type a query.</p>
            <p className="mt-1 text-[12px] text-cm-muted">
              Each candidate shows raw and normalised retrieval scores side by side.
            </p>
          </div>
        )}

        {loading && (
          <div className="rounded-xl border border-cm-border p-6">
            <div className="flex items-center gap-3 text-[13px] text-cm-muted">
              <Spinner />
              Running BM25 + dense + MMR
            </div>
            <div className="mt-5 space-y-2">
              <div className="h-3 w-11/12 animate-pulse rounded bg-cm-border/60" />
              <div className="h-3 w-9/12 animate-pulse rounded bg-cm-border/60" />
              <div className="h-3 w-10/12 animate-pulse rounded bg-cm-border/60" />
            </div>
          </div>
        )}

        {error && (
          <div className="rounded-xl border border-cm-border bg-cm-bg p-5">
            <div className="flex items-center gap-2 text-[13px] text-cm-fg">
              <IconWarning size={14} />
              Something went wrong.
            </div>
            <p className="mt-2 text-[12px] text-cm-muted">{error}</p>
            <p className="mt-3 text-[12px] text-cm-muted">
              Make sure the API is running on <span className="cm-mono">127.0.0.1:7410</span> and
              the corpus is ingested.
            </p>
          </div>
        )}

        {data && (
          <div>
            <div className="mb-4 flex flex-wrap items-center gap-3 text-[11px] text-cm-faint cm-mono">
              <span>bm25 {data.funnel.bm25}</span>
              <span>→ dense {data.funnel.dense}</span>
              <span>→ merged {data.funnel.merged}</span>
              <span>→ filtered {data.funnel.afterFilter}</span>
              <span>→ rerank {data.funnel.afterRerank}</span>
              <span>→ final {data.funnel.final}</span>
              {latencyMs != null && (
                <span className="ml-auto flex items-center gap-1 text-cm-muted">
                  <IconCheck size={11} /> {latencyMs} ms
                </span>
              )}
            </div>

            {(data.query.added.length > 0 || data.query.corrections.length > 0) && (
              <div className="mb-4 rounded-lg border border-cm-border bg-cm-bg/60 p-3 text-[12px] text-cm-muted">
                <span className="cm-mono text-cm-faint">expanded query: </span>
                <span className="text-cm-fg">{data.query.expanded}</span>
                {data.query.added.length > 0 && (
                  <span className="ml-2 cm-mono text-[10px] text-cm-faint">
                    +added: {data.query.added.join(', ')}
                  </span>
                )}
              </div>
            )}

            {data.candidates.length === 0 ? (
              <div className="rounded-xl border border-dashed border-cm-border p-8 text-center text-[13px] text-cm-muted">
                No candidates retrieved. Try a broader query.
              </div>
            ) : (
              <ol className="space-y-3">
                {data.candidates.map((c) => (
                  <CandidateCard key={c.id} c={c} alpha={data.params.hybridAlpha} />
                ))}
              </ol>
            )}
          </div>
        )}
      </section>
    </main>
  );
}
