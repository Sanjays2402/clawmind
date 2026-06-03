import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

// `clawmind related <path>` — list source files whose chunks are
// semantically close to the given path. Useful as a "see also" lookup
// after running `clawmind search` and landing on a single file.

export function relatedCommand() {
  const cmd = new Command('related')
    .argument('<path>', 'indexed source path to find neighbours for')
    .option('-k, --k <n>', 'how many related sources to return', (v) => parseInt(v, 10), 8)
    .option('-n, --namespaces <list>', 'comma-separated namespaces to restrict to')
    .option('--json', 'emit results as JSON for scripting')
    .description('Find sources semantically similar to a given indexed path');

  cmd.action(async (path: string, opts: { k: number; namespaces?: string; json?: boolean }) => {
    const env = loadEnv();
    const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
    const url = new URL(`${base}/v1/related`);
    url.searchParams.set('path', path);
    url.searchParams.set('k', String(opts.k));
    if (opts.namespaces) url.searchParams.set('namespaces', opts.namespaces);
    let res: Response;
    try {
      res = await fetch(url);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      process.stderr.write(kleur.red(`related failed: cannot reach ${base} (${msg})\n`));
      process.exitCode = 1;
      return;
    }
    if (!res.ok) {
      let detail = (await res.text()).trim();
      try {
        const parsed = JSON.parse(detail) as { message?: unknown; error?: unknown };
        if (typeof parsed.message === 'string') detail = parsed.message;
        else if (typeof parsed.error === 'string') detail = parsed.error;
      } catch {
        // not JSON, keep as text
      }
      if (detail.length > 200) detail = detail.slice(0, 200) + '...';
      const suffix = detail ? `: ${detail}` : '';
      process.stderr.write(kleur.red(`related failed (${res.status} ${res.statusText})${suffix}\n`));
      process.exitCode = 1;
      return;
    }
    const out = (await res.json()) as {
      path: string;
      sourceChunkCount: number;
      items: { path: string; namespace: string; score: number; hits: number; excerpt: string }[];
      count: number;
    };
    if (opts.json) {
      process.stdout.write(JSON.stringify(out, null, 2) + '\n');
      return;
    }
    if (out.count === 0) {
      process.stdout.write(kleur.gray(`no related sources found (searched against ${out.sourceChunkCount} chunks)\n`));
      return;
    }
    process.stdout.write(
      kleur.dim(`related to ${out.path} (${out.sourceChunkCount} chunks)\n`),
    );
    for (const it of out.items) {
      const head = `${kleur.bold(it.path)} ${kleur.gray(`[${it.namespace}]`)} ${kleur.cyan(it.score.toFixed(3))} ${kleur.dim(`x${it.hits}`)}`;
      process.stdout.write(head + '\n');
      process.stdout.write('  ' + kleur.dim(it.excerpt.replace(/\s+/g, ' ')) + '\n');
    }
  });

  return cmd;
}
