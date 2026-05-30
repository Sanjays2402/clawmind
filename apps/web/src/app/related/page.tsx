import Link from 'next/link';
import { TopNav } from '@/components/TopNav';
import { api } from '@/lib/api';
import { EmptyState, IconArrowRight, IconFolder, IconSpark, IconWarning } from '@clawmind/ui';

export const dynamic = 'force-dynamic';

type SP = Promise<{ path?: string; k?: string; ns?: string }>;

export default async function RelatedPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const path = sp.path?.trim();
  const k = sp.k ? Math.max(1, Math.min(50, Number(sp.k))) : 12;
  const namespaces = sp.ns ? sp.ns.split(',').map((s) => s.trim()).filter(Boolean) : undefined;

  if (!path) {
    return (
      <Shell>
        <Header />
        <div className="mt-6">
          <EmptyState
            title="Pick a source"
            body="Open any source from the sources list, then use the Related link to land here."
          />
          <div className="mt-3 text-sm">
            <Link href="/sources" className="text-cm-accent">Browse sources</Link>
          </div>
        </div>
      </Shell>
    );
  }

  let data: Awaited<ReturnType<typeof api.related>> | null = null;
  let error: string | null = null;
  try {
    data = await api.related(path, { k, namespaces });
  } catch (e) {
    error = (e as Error).message;
  }

  return (
    <Shell>
      <Header />
      <div className="mt-4 text-xs text-cm-muted">
        For path
      </div>
      <div className="mt-1 break-all font-mono text-sm">{path}</div>

      {error ? (
        <div className="mt-6 cm-card flex items-start gap-3 p-4 text-sm">
          <IconWarning className="mt-0.5 text-cm-danger" />
          <div>
            <div className="font-medium">Could not load related sources.</div>
            <div className="mt-1 text-cm-muted">{error}</div>
            <div className="mt-3">
              <Link href={`/sources/view?path=${encodeURIComponent(path)}`} className="text-cm-accent">
                Back to source
              </Link>
            </div>
          </div>
        </div>
      ) : !data || data.items.length === 0 ? (
        <div className="mt-6">
          <EmptyState
            title="Nothing nearby"
            body="No other indexed sources scored close enough to this one. Try ingesting more notes or widening namespaces."
          />
        </div>
      ) : (
        <>
          <div className="mt-4 text-xs text-cm-muted">
            {data.count} matches across {data.sourceChunkCount} source chunks
          </div>
          <ul className="mt-3 cm-card divide-y divide-cm-border">
            {data.items.map((it) => (
              <li key={it.path} className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 text-xs text-cm-muted">
                      <IconFolder size={12} />
                      <span>{it.namespace}</span>
                      <span>·</span>
                      <span>{it.hits} chunk{it.hits === 1 ? '' : 's'}</span>
                      <span>·</span>
                      <span>score {it.score.toFixed(3)}</span>
                    </div>
                    <Link
                      href={`/sources/view?path=${encodeURIComponent(it.path)}`}
                      className="mt-1 block break-all font-mono text-sm text-cm-fg hover:text-cm-accent"
                    >
                      {it.path}
                    </Link>
                    <p className="mt-2 line-clamp-3 text-sm text-cm-muted">{it.excerpt}</p>
                  </div>
                  <Link
                    href={`/related?path=${encodeURIComponent(it.path)}`}
                    title="Find related to this"
                    className="shrink-0 inline-flex items-center gap-1 rounded-md border border-cm-border px-2 py-1 text-xs text-cm-muted hover:text-cm-fg"
                  >
                    <IconSpark size={12} /> hop
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <div className="mt-6 text-sm">
        <Link
          href={`/sources/view?path=${encodeURIComponent(path)}`}
          className="inline-flex items-center gap-1 text-cm-accent"
        >
          Open source <IconArrowRight size={12} />
        </Link>
      </div>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen">
      <TopNav />
      <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6">{children}</div>
    </main>
  );
}

function Header() {
  return (
    <header>
      <div className="text-xs text-cm-muted">
        <Link href="/sources" className="text-cm-accent">Sources</Link> / Related
      </div>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">Related sources</h1>
      <p className="mt-1 text-sm text-cm-muted">
        Documents that sit close in embedding space to the given source. Useful for jumping sideways into adjacent notes.
      </p>
    </header>
  );
}
