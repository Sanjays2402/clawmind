'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { ErrorState } from '@clawmind/ui';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Surface to the browser console for local debugging.
    // eslint-disable-next-line no-console
    console.error('[clawmind/web] route error', error);
  }, [error]);

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 32,
      }}
    >
      <div style={{ maxWidth: 560, width: '100%' }}>
        <ErrorState
          title="Something broke on this page"
          message={error.message || 'An unexpected error occurred while rendering this route.'}
          retryLabel="Try again"
          onRetry={reset}
        />
        <div style={{ marginTop: 16, textAlign: 'center', fontSize: 13, color: 'var(--cm-muted)' }}>
          <Link href="/dashboard" style={{ color: 'var(--cm-muted)' }}>
            Back to dashboard
          </Link>
          {error.digest && (
            <span style={{ marginLeft: 12, fontFamily: 'var(--cm-font-mono)', fontSize: 11 }}>
              digest {error.digest}
            </span>
          )}
        </div>
      </div>
    </main>
  );
}
