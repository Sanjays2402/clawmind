export default function About() {
  return (
    <main style={{ maxWidth: 720, margin: '60px auto', padding: '0 24px', lineHeight: 1.6 }}>
      <h1 style={{ fontSize: 32, fontWeight: 700 }}>About ClawMind</h1>
      <p style={{ marginTop: 12, color: 'var(--cm-muted)' }}>
        A personal RAG that lives on your Mac. Built because the best search of your own life is the one that respects it.
      </p>
      <p style={{ marginTop: 12, color: 'var(--cm-muted)' }}>
        Free and open source under the MIT license.
      </p>
    </main>
  );
}
