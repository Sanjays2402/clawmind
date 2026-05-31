'use client';

import { useEffect, useState } from 'react';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};

const DISMISS_KEY = 'clawmind:pwa:dismissed-at';
const DISMISS_DAYS = 14;

export function PwaInstall() {
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [installed, setInstalled] = useState(false);
  const [visible, setVisible] = useState(false);
  const [busy, setBusy] = useState(false);

  // Register service worker.
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (!('serviceWorker' in navigator)) return;
    if (process.env.NODE_ENV !== 'production') return;
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        /* registration failure is non-fatal */
      });
    };
    if (document.readyState === 'complete') onLoad();
    else window.addEventListener('load', onLoad, { once: true });
    return () => window.removeEventListener('load', onLoad);
  }, []);

  // Capture install prompt.
  useEffect(() => {
    if (typeof window === 'undefined') return;

    const standalone =
      window.matchMedia?.('(display-mode: standalone)').matches ||
      // @ts-expect-error iOS Safari
      window.navigator.standalone === true;
    if (standalone) {
      setInstalled(true);
      return;
    }

    const dismissedAt = Number(window.localStorage.getItem(DISMISS_KEY) || 0);
    const cutoff = Date.now() - DISMISS_DAYS * 24 * 60 * 60 * 1000;
    const recentlyDismissed = dismissedAt && dismissedAt > cutoff;

    const onPrompt = (e: Event) => {
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
      if (!recentlyDismissed) setVisible(true);
    };
    const onInstalled = () => {
      setInstalled(true);
      setVisible(false);
      setDeferred(null);
    };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (installed || !visible || !deferred) return null;

  const dismiss = () => {
    window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
    setVisible(false);
  };

  const install = async () => {
    if (!deferred) return;
    setBusy(true);
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      if (choice.outcome === 'dismissed') {
        window.localStorage.setItem(DISMISS_KEY, String(Date.now()));
      }
      setDeferred(null);
      setVisible(false);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-live="polite"
      aria-label="Install ClawMind"
      style={{
        position: 'fixed',
        zIndex: 60,
        left: 16,
        right: 16,
        bottom: 16,
        margin: '0 auto',
        maxWidth: 420,
        padding: 14,
        borderRadius: 12,
        background: 'var(--cm-surface, #fff)',
        color: 'var(--cm-fg, #111)',
        border: '1px solid var(--cm-border, #e5e5e5)',
        boxShadow: '0 8px 28px rgba(0,0,0,0.12)',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        fontSize: 14,
      }}
    >
      <div style={{ flex: 1, lineHeight: 1.35 }}>
        <div style={{ fontWeight: 600, marginBottom: 2 }}>Install ClawMind</div>
        <div style={{ color: 'var(--cm-muted, #666)', fontSize: 12.5 }}>
          Add it to your home screen for quick, offline-aware access.
        </div>
      </div>
      <button
        type="button"
        onClick={dismiss}
        style={{
          padding: '8px 10px',
          borderRadius: 8,
          border: '1px solid var(--cm-border, #e5e5e5)',
          background: 'transparent',
          color: 'var(--cm-muted, #666)',
          fontSize: 13,
          cursor: 'pointer',
        }}
      >
        Not now
      </button>
      <button
        type="button"
        onClick={install}
        disabled={busy}
        style={{
          padding: '8px 12px',
          borderRadius: 8,
          border: '1px solid #7c5cff',
          background: '#7c5cff',
          color: 'white',
          fontSize: 13,
          fontWeight: 600,
          cursor: busy ? 'wait' : 'pointer',
        }}
      >
        {busy ? 'Installing' : 'Install'}
      </button>
    </div>
  );
}
