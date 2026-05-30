import { Spinner } from '@clawmind/ui';

export default function Loading() {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 12,
        color: 'var(--cm-muted)',
        fontSize: 14,
      }}
    >
      <Spinner />
      <span>Loading</span>
    </div>
  );
}
