import { Command } from 'commander';
import kleur from 'kleur';
import { buildRuntime } from '../runtime.js';

// `clawmind status` is the operator's "is everything healthy?" smoke
// check. Beyond the static counts (workspace, documents, chunks) we
// surface two pieces of context that have repeatedly proven useful when
// chasing why CI looks green locally but red in a container:
//
//   1. the resolved api base URL (host:port). The cli, web, and several
//      side services all read CLAWMIND_API_HOST / CLAWMIND_API_PORT, and
//      a typo in one .env file is the usual culprit. Echoing the URL the
//      runtime would dial removes the guesswork.
//   2. the per-probe latency for the embed and llm health checks. A
//      provider that is "up but slow" is the failure mode users actually
//      notice in production; reporting the wall-clock time on the probe
//      both calls out the regression early and gives Sanjay a number to
//      put in a bug report.
//
// We measure with `performance.now()` so the figure survives clock skew
// and is monotonic on all the platforms ClawMind targets. The probe is
// allowed to fail without crashing the command: a slow / down provider
// becomes a `down` flag plus the latency we observed up to the timeout.

async function timed<T>(fn: () => Promise<T>): Promise<{ value: T; ms: number }> {
  const start = performance.now();
  const value = await fn();
  return { value, ms: Math.round(performance.now() - start) };
}

export function statusCommand() {
  return new Command('status')
    .description('Print index status and provider health')
    .option('--json', 'emit status as JSON for scripting')
    .action(async (opts: { json?: boolean }) => {
      const rt = await buildRuntime();
      const apiBase = `http://${rt.env.CLAWMIND_API_HOST}:${rt.env.CLAWMIND_API_PORT}`;
      const [embedProbe, llmProbe, chunks] = await Promise.all([
        timed(() => rt.embed.health() as Promise<boolean>),
        timed(() => rt.llm.health() as Promise<boolean>),
        rt.lance.count() as Promise<number>,
      ]);
      const embedOk = Boolean(embedProbe.value);
      const llmOk = Boolean(llmProbe.value);
      const documents = rt.manifest.size();
      const bm25Docs = rt.bm25.size();
      if (opts.json) {
        process.stdout.write(JSON.stringify({
          workspace: rt.workspace,
          apiBase,
          documents,
          chunks,
          bm25Docs,
          embed: embedOk ? 'ok' : 'down',
          llm: llmOk ? 'ok' : 'down',
          embedLatencyMs: embedProbe.ms,
          llmLatencyMs: llmProbe.ms,
          ok: embedOk && llmOk,
        }) + '\n');
        return;
      }
      const fmtProbe = (ok: boolean, ms: number) => {
        const label = ok ? kleur.green('ok') : kleur.red('down');
        return `${label}  ${kleur.gray(`(${ms}ms)`)}`;
      };
      process.stdout.write([
        kleur.bold('ClawMind status'),
        `  workspace : ${rt.workspace}`,
        `  api       : ${apiBase}`,
        `  documents : ${documents}`,
        `  chunks    : ${chunks}`,
        `  bm25 docs : ${bm25Docs}`,
        `  embed     : ${fmtProbe(embedOk, embedProbe.ms)}`,
        `  llm       : ${fmtProbe(llmOk, llmProbe.ms)}`,
      ].join('\n') + '\n');
    });
}
