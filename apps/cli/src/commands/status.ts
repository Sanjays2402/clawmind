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
    .option('--check', 'exit non-zero (code 2) when any probe is down. Designed for CI smoke checks — pipes back the same JSON / text body but flips the exit code so a flat `clawmind status --check` is a usable health-check command in a wider script.')
    .action(async (opts: { json?: boolean; check?: boolean }) => {
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
      const overallOk = embedOk && llmOk;
      // --check is the CI smoke-check flag. The body of the response
      // (json or text) is unchanged so a single command can both report
      // status AND drive the exit code, but a non-OK result flips the
      // exit code to 2 so a wrapper script can branch on it without
      // having to parse the output. We use exit code 2 (not 1) to
      // distinguish "everything ran but a probe is down" from "the
      // command itself crashed" (which still uses 1 from the top-level
      // commander handler). The flag is a no-op when everything is up
      // so the happy path stays at exit 0.
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
          ok: overallOk,
        }) + '\n');
        if (opts.check && !overallOk) process.exitCode = 2;
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
      if (opts.check && !overallOk) {
        // Also drop a one-line summary to stderr so a script that
        // redirected stdout to /dev/null still sees WHICH probe was
        // down. We intentionally name only the down probes; an
        // operator scanning `journalctl` should not have to re-parse
        // the table to find the offender.
        const down: string[] = [];
        if (!embedOk) down.push('embed');
        if (!llmOk) down.push('llm');
        process.stderr.write(kleur.red(`status --check: ${down.join(' + ')} down\n`));
        process.exitCode = 2;
      }
    });
}
