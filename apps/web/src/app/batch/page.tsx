'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api, API_BASE } from '@/lib/api';
import {
  Card,
  Badge,
  EmptyState,
  ErrorState,
  Spinner,
  IconSpark,
  IconDownload,
  IconArrowRight,
  IconRefresh,
} from '@clawmind/ui';

interface BatchRow {
  q: string;
  tag?: string;
  ok: boolean;
  answer?: string;
  model?: string;
  sources?: number;
  error?: string;
  durationMs: number;
}

interface BatchResponse {
  id: string;
  total: number;
  ok: number;
  failed: number;
  results: BatchRow[];
}

const SAMPLE = `q
What is ClawMind?
How does retrieval work?
Which embedding model is used?`;

export default function BatchPage() {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<BatchResponse | null>(null);
  const [openIdx, setOpenIdx] = useState<number | null>(null);

  const queries = useMemo(() => parseQuestions(text), [text]);

  async function run() {
    if (!queries.length || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    setOpenIdx(null);
    try {
      const res = await api.askBatch(queries);
      setResult(res);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function downloadCsv() {
    if (!result) return;
    const header = ['q', 'ok', 'model', 'sources', 'duration_ms', 'answer', 'error'];
    const lines = [header.join(',')];
    for (const r of result.results) {
      lines.push([
        csvEscape(r.q),
        r.ok ? '1' : '0',
        csvEscape(r.model),
        csvEscape(r.sources),
        csvEscape(r.durationMs),
        csvEscape(r.answer),
        csvEscape(r.error),
      ].join(','));
    }
    const blob = new Blob([lines.join('\r\n') + '\r\n'], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `clawmind-batch-${result.id}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  async function onFile(file: File) {
    const t = await file.text();
    setText(t);
  }

  return (
    <div className="min-h-screen">
      <TopNav />
      <main className="mx-auto w-full max-w-[980px] px-6 pb-24 pt-8 sm:px-10">
        <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight" style={{ color: 'var(--cm-fg)' }}>
              Batch ask
            </h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--cm-muted)' }}>
              Paste or upload up to 100 questions. Each one runs against your indexed sources and
              every answer is saved to history.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link
              href="/history"
              className="rounded-md border px-3 py-1.5 text-[13px]"
              style={{ borderColor: 'var(--cm-border)', color: 'var(--cm-muted)' }}
            >
              History
            </Link>
          </div>
        </header>

        <Card>
          <div className="grid gap-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm font-medium" style={{ color: 'var(--cm-fg)' }}>
                Questions
              </div>
              <div className="flex items-center gap-2 text-[12px]" style={{ color: 'var(--cm-muted)' }}>
                <label className="cursor-pointer rounded-md border px-2 py-1" style={{ borderColor: 'var(--cm-border)' }}>
                  Upload CSV
                  <input
                    type="file"
                    accept=".csv,text/csv,text/plain"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) void onFile(f);
                      e.target.value = '';
                    }}
                  />
                </label>
                <button
                  type="button"
                  onClick={() => setText(SAMPLE)}
                  className="rounded-md border px-2 py-1"
                  style={{ borderColor: 'var(--cm-border)' }}
                >
                  Load sample
                </button>
                <span aria-live="polite">
                  {queries.length} / 100
                </span>
              </div>
            </div>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'One question per line, or paste a CSV with a "q" column.'}
              rows={10}
              className="w-full resize-y rounded-md border bg-transparent p-3 text-[13.5px] leading-relaxed outline-none focus:ring-2"
              style={{ borderColor: 'var(--cm-border)', color: 'var(--cm-fg)' }}
              spellCheck={false}
            />
            <div className="flex items-center justify-between gap-3">
              <div className="text-[12px]" style={{ color: 'var(--cm-faint)' }}>
                Quota counts every row, successful or not.
              </div>
              <button
                type="button"
                onClick={run}
                disabled={!queries.length || busy}
                className="inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-[13px] font-medium disabled:opacity-50"
                style={{ background: 'var(--cm-accent)', color: 'var(--cm-on-accent)' }}
              >
                {busy ? <Spinner /> : <IconSpark size={14} />}
                {busy ? 'Running' : `Run ${queries.length || ''}`.trim()}
              </button>
            </div>
          </div>
        </Card>

        {error && (
          <div className="mt-6">
            <ErrorState title="Batch failed" message={error} onRetry={run} />
          </div>
        )}

        {!result && !busy && !error && (
          <div className="mt-6">
            <EmptyState
              icon={<IconSpark size={20} />}
              title="No batch yet"
              hint="Try the sample to see a three-question run end to end."
            />
          </div>
        )}

        {busy && !result && (
          <div className="mt-6 flex items-center gap-3 text-sm" style={{ color: 'var(--cm-muted)' }}>
            <Spinner /> Running {queries.length} {queries.length === 1 ? 'question' : 'questions'}. This can take a minute.
          </div>
        )}

        {result && (
          <div className="mt-6 grid gap-4">
            <Card>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-3 text-sm">
                  <Badge tone="success">{result.ok} ok</Badge>
                  {result.failed > 0 && <Badge tone="danger">{result.failed} failed</Badge>}
                  <span style={{ color: 'var(--cm-muted)' }}>batch {result.id}</span>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={downloadCsv}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px]"
                    style={{ borderColor: 'var(--cm-border)', color: 'var(--cm-fg)' }}
                  >
                    <IconDownload size={14} /> CSV
                  </button>
                  <button
                    type="button"
                    onClick={run}
                    className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-[13px]"
                    style={{ borderColor: 'var(--cm-border)', color: 'var(--cm-muted)' }}
                  >
                    <IconRefresh size={14} /> Rerun
                  </button>
                </div>
              </div>
            </Card>

            <div className="overflow-hidden rounded-md border" style={{ borderColor: 'var(--cm-border)' }}>
              <table className="w-full text-left text-[13px]">
                <thead style={{ background: 'var(--cm-accent-soft)' }}>
                  <tr>
                    <th className="px-3 py-2 font-medium">#</th>
                    <th className="px-3 py-2 font-medium">Question</th>
                    <th className="px-3 py-2 font-medium">Status</th>
                    <th className="px-3 py-2 font-medium hidden sm:table-cell">Sources</th>
                    <th className="px-3 py-2 font-medium hidden sm:table-cell">Time</th>
                    <th className="px-3 py-2"></th>
                  </tr>
                </thead>
                <tbody>
                  {result.results.map((r, i) => (
                    <BatchRowItem
                      key={i}
                      index={i}
                      row={r}
                      open={openIdx === i}
                      onToggle={() => setOpenIdx(openIdx === i ? null : i)}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        <details className="mt-10 text-[12.5px]" style={{ color: 'var(--cm-muted)' }}>
          <summary className="cursor-pointer">curl example</summary>
          <pre className="mt-2 overflow-x-auto rounded-md border p-3 text-[12px]" style={{ borderColor: 'var(--cm-border)' }}>{`curl -X POST ${API_BASE}/v1/ask/batch \\
  -H "content-type: text/csv" \\
  --data-binary $'q\\nWhat is ClawMind?\\nHow does retrieval work?' \\
  -o results.csv`}</pre>
        </details>
      </main>
    </div>
  );
}

function BatchRowItem({
  index,
  row,
  open,
  onToggle,
}: {
  index: number;
  row: BatchRow;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <>
      <tr className="border-t" style={{ borderColor: 'var(--cm-border)' }}>
        <td className="px-3 py-2 align-top tabular-nums" style={{ color: 'var(--cm-faint)' }}>{index + 1}</td>
        <td className="px-3 py-2 align-top" style={{ color: 'var(--cm-fg)' }}>
          <div className="line-clamp-2">{row.q}</div>
        </td>
        <td className="px-3 py-2 align-top">
          <Badge tone={row.ok ? 'success' : 'danger'}>{row.ok ? 'ok' : 'error'}</Badge>
        </td>
        <td className="px-3 py-2 align-top hidden sm:table-cell" style={{ color: 'var(--cm-muted)' }}>
          {row.sources ?? '-'}
        </td>
        <td className="px-3 py-2 align-top hidden sm:table-cell tabular-nums" style={{ color: 'var(--cm-muted)' }}>
          {row.durationMs}ms
        </td>
        <td className="px-3 py-2 align-top text-right">
          <button
            type="button"
            onClick={onToggle}
            className="inline-flex items-center gap-1 text-[12px]"
            style={{ color: 'var(--cm-muted)' }}
            aria-expanded={open}
          >
            {open ? 'Hide' : 'View'} <IconArrowRight size={12} />
          </button>
        </td>
      </tr>
      {open && (
        <tr style={{ background: 'var(--cm-accent-soft)' }}>
          <td colSpan={6} className="px-4 py-3 align-top text-[13px]" style={{ color: 'var(--cm-fg)' }}>
            {row.ok ? (
              <article style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{row.answer}</article>
            ) : (
              <div style={{ color: 'var(--cm-danger, #c00)' }}>{row.error}</div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

function parseQuestions(text: string): string[] {
  const t = text.trim();
  if (!t) return [];
  // CSV-ish: skip a literal "q" header so pasting a CSV Just Works.
  const lines = t.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (lines[0]?.toLowerCase() === 'q' || lines[0]?.toLowerCase().startsWith('q,')) {
    lines.shift();
  }
  // If a row contains commas treat column 0 as the question.
  return lines
    .map((l) => (l.includes(',') ? splitFirstCsvCol(l) : l))
    .filter((q) => q && q.length > 0)
    .slice(0, 100);
}

function splitFirstCsvCol(line: string): string {
  if (line.startsWith('"')) {
    let out = '';
    for (let i = 1; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (line[i + 1] === '"') { out += '"'; i++; continue; }
        return out;
      }
      out += ch;
    }
    return out;
  }
  const idx = line.indexOf(',');
  return idx === -1 ? line : line.slice(0, idx);
}

function csvEscape(v: string | number | undefined): string {
  if (v === undefined || v === null) return '';
  const s = String(v);
  if (/[",\r\n]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}
