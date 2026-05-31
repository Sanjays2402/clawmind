'use client';

import { useMemo, useState } from 'react';
import { API_BASE } from '@/lib/api';
import { IconCopy, IconCheck } from '@clawmind/ui';

interface Props {
  // When a secret is freshly issued we pre-fill the examples with it.
  // Otherwise we show a `$CLAWMIND_KEY` placeholder so the snippets work
  // for any user reading the reference section.
  secret?: string | null;
}

type Snippet = { id: string; label: string; description: string; cmd: string };

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}

export function CurlExamples({ secret }: Props) {
  const token = secret && secret.length > 0 ? secret : '$CLAWMIND_KEY';
  const base = API_BASE;

  const snippets: Snippet[] = useMemo(() => {
    const askBody = JSON.stringify({ q: 'What did I write about retrieval reranking?', k: 6 });
    const searchBody = JSON.stringify({ q: 'retrieval reranking', k: 10 });
    return [
      {
        id: 'ask',
        label: 'Ask a question',
        description: 'Run the full RAG pipeline. Returns an answer plus cited sources.',
        cmd: [
          `curl -X POST ${base}/v1/ask \\`,
          `  -H "Authorization: Bearer ${token}" \\`,
          `  -H "Content-Type: application/json" \\`,
          `  -d ${shellQuote(askBody)}`,
        ].join('\n'),
      },
      {
        id: 'search',
        label: 'Search the index',
        description: 'Retrieval only. Useful when you want chunks without an LLM answer.',
        cmd: [
          `curl -X POST ${base}/v1/search \\`,
          `  -H "Authorization: Bearer ${token}" \\`,
          `  -H "Content-Type: application/json" \\`,
          `  -d ${shellQuote(searchBody)}`,
        ].join('\n'),
      },
      {
        id: 'history',
        label: 'List your history',
        description: 'Recent asks for the user that owns this key.',
        cmd: [
          `curl ${base}/v1/history?limit=20 \\`,
          `  -H "Authorization: Bearer ${token}"`,
        ].join('\n'),
      },
    ];
  }, [base, token]);

  return (
    <section className="mt-8">
      <h2 className="mb-1 text-sm font-medium text-cm-muted">Using your key</h2>
      <p className="mb-3 text-xs text-cm-muted">
        {secret
          ? 'These commands are pre-filled with the secret above. Copy one to try it now.'
          : 'Set CLAWMIND_KEY in your shell, then paste any of these.'}
      </p>
      {!secret && (
        <pre className="cm-card mb-3 overflow-x-auto p-3 font-mono text-xs">
          export CLAWMIND_KEY=&apos;sk-...&apos;
        </pre>
      )}
      <div className="space-y-3">
        {snippets.map((s) => (
          <SnippetCard key={s.id} snippet={s} />
        ))}
      </div>
      <p className="mt-3 text-xs text-cm-muted">
        Base URL: <code className="font-mono">{base}</code>. Full API reference lives in the repo README.
      </p>
    </section>
  );
}

function SnippetCard({ snippet }: { snippet: Snippet }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet.cmd);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard can be blocked in insecure contexts; surface nothing rather
      // than throw. Users can still select the text manually.
    }
  }
  return (
    <div className="cm-card p-3">
      <div className="mb-2 flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-medium">{snippet.label}</div>
          <div className="text-xs text-cm-muted">{snippet.description}</div>
        </div>
        <button
          onClick={copy}
          aria-label={`Copy ${snippet.label} command`}
          className="inline-flex items-center gap-1.5 rounded-md border border-cm-border px-2 py-1 text-xs hover:text-cm-fg"
        >
          {copied ? <IconCheck size={12} className="text-cm-success" /> : <IconCopy size={12} />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      <pre className="overflow-x-auto rounded-md border border-cm-border bg-cm-bg p-3 font-mono text-xs leading-relaxed">
        {snippet.cmd}
      </pre>
    </div>
  );
}
