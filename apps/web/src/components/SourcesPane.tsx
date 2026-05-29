'use client';
import { EmptyState } from '@clawmind/ui';

interface Source { id: string; path: string; startLine: number; endLine: number; excerpt: string; score: number; }

export function SourcesPane({ sources, active, onSelect }: { sources: Source[]; active: Source | null; onSelect: (s: Source) => void }) {
  if (sources.length === 0) {
    return <EmptyState title="No sources yet" hint="Sources appear here once you ask something." />;
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div style={{ fontSize: 12, color: 'var(--cm-muted)', textTransform: 'uppercase', letterSpacing: 1 }}>Sources</div>
      {sources.map((s, i) => (
        <button
          key={s.id + i}
          onClick={() => onSelect(s)}
          style={{
            textAlign: 'left',
            padding: 12,
            border: '1px solid ' + (active?.id === s.id ? 'var(--cm-accent)' : 'var(--cm-border)'),
            borderRadius: 10,
            background: 'var(--cm-subtle)',
            color: 'var(--cm-fg)',
            cursor: 'pointer',
          }}
        >
          <div style={{ fontSize: 12, color: 'var(--cm-muted)', fontFamily: 'var(--cm-font-mono)' }}>
            [^{i + 1}] {s.path.split('/').slice(-2).join('/')}:{s.startLine}
          </div>
          <div style={{ marginTop: 6, fontSize: 13, lineHeight: 1.45 }}>
            {s.excerpt.length > 220 ? s.excerpt.slice(0, 220) + '...' : s.excerpt}
          </div>
        </button>
      ))}
    </div>
  );
}
