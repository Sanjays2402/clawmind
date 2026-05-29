'use client';
import { useEffect, useState } from 'react';
import { ThemeToggle, Card, Badge } from '@clawmind/ui';
import { api } from '@/lib/api';

export default function Settings() {
  const [health, setHealth] = useState<Awaited<ReturnType<typeof api.health>> | null>(null);
  useEffect(() => { api.health().then(setHealth).catch(() => setHealth(null)); }, []);
  return (
    <main style={{ maxWidth: 720, margin: '40px auto', padding: '0 24px', display: 'grid', gap: 16 }}>
      <h1 style={{ fontSize: 24, fontWeight: 600 }}>Settings</h1>
      <Card>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div style={{ fontWeight: 500 }}>Appearance</div>
            <div style={{ color: 'var(--cm-muted)', fontSize: 13 }}>Switch between dark and light.</div>
          </div>
          <ThemeToggle />
        </div>
      </Card>
      <Card>
        <div style={{ fontWeight: 500, marginBottom: 8 }}>System status</div>
        {!health ? (
          <div style={{ color: 'var(--cm-muted)' }}>Loading...</div>
        ) : (
          <div style={{ display: 'grid', gap: 8 }}>
            <Row label="Embed provider"><Badge tone={health.embed ? 'success' : 'danger'}>{health.embed ? 'ok' : 'down'}</Badge></Row>
            <Row label="LLM provider"><Badge tone={health.llm ? 'success' : 'danger'}>{health.llm ? 'ok' : 'down'}</Badge></Row>
            <Row label="Documents"><Badge>{health.docs}</Badge></Row>
            <Row label="Chunks"><Badge>{health.chunks}</Badge></Row>
          </div>
        )}
      </Card>
    </main>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14 }}>
      <span style={{ color: 'var(--cm-muted)' }}>{label}</span>
      {children}
    </div>
  );
}
