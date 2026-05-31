import { ImageResponse } from 'next/og';
import { api } from '@/lib/api';

export const runtime = 'nodejs';
export const contentType = 'image/png';
export const size = { width: 1200, height: 630 };
export const alt = 'Shared answer from ClawMind';

function trim(s: string, n: number): string {
  const clean = s.replace(/\s+/g, ' ').trim();
  return clean.length <= n ? clean : clean.slice(0, n - 1).trimEnd() + '\u2026';
}

export default async function Image({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await api.share(id).catch(() => null);
  const query = data ? trim(data.query, 140) : 'Shared answer';
  const answer = data ? trim(data.answer, 260) : 'This share has expired or was removed.';
  const sourceCount = data && Array.isArray(data.sources) ? data.sources.length : 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: 64,
          background:
            'linear-gradient(135deg, #0b0b12 0%, #15131f 55%, #1a1530 100%)',
          color: '#f5f3ff',
          fontFamily: 'sans-serif',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: 10,
              background:
                'linear-gradient(135deg, #7c5cff 0%, #b196ff 100%)',
              display: 'flex',
            }}
          />
          <div style={{ fontSize: 26, fontWeight: 600, letterSpacing: -0.3 }}>
            ClawMind
          </div>
          <div
            style={{
              marginLeft: 12,
              fontSize: 14,
              padding: '4px 10px',
              borderRadius: 999,
              background: 'rgba(255,255,255,0.08)',
              color: '#cfc7ff',
              textTransform: 'uppercase',
              letterSpacing: 1.2,
            }}
          >
            Shared answer
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div
            style={{
              fontSize: 52,
              fontWeight: 600,
              lineHeight: 1.12,
              letterSpacing: -0.8,
              color: '#ffffff',
            }}
          >
            {query}
          </div>
          <div
            style={{
              fontSize: 26,
              lineHeight: 1.4,
              color: '#bdb6dc',
            }}
          >
            {answer}
          </div>
        </div>

        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            paddingTop: 24,
            borderTop: '1px solid rgba(255,255,255,0.10)',
            fontSize: 20,
            color: '#9d95c2',
          }}
        >
          <div style={{ display: 'flex' }}>
            {sourceCount > 0
              ? `${sourceCount} source${sourceCount === 1 ? '' : 's'} cited`
              : 'Answered from your workspace'}
          </div>
          <div style={{ display: 'flex' }}>clawmind.local</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
