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
    .option('-t, --threshold <n>', 'drop neighbours with score strictly below this value (0..1 typical). Mirrors `search --threshold` semantics: a missing or non-numeric value is silently treated as "no filter" so `--threshold $MAYBE` in a shell script does not break when the env var is empty. The filter applies BEFORE --paths-only / --json / text rendering so every output mode sees the same subset, and the `count` in --json reflects the filtered length.')
    .option('--paths-only', 'pipeline-friendly: emit ONLY the neighbour paths, one per line, in rank order. No styling, no header, no "no related sources" hint. Zero matches yields a clean empty stream so xargs/wc keep working. Mirrors the contract used by search --paths-only, forget --paths-only, and the pins/mutes/aliases/tags --paths family.')
    .option('--json', 'emit results as JSON for scripting')
    .description('Find sources semantically similar to a given indexed path');

  cmd.action(async (path: string, opts: { k: number; namespaces?: string; threshold?: string; pathsOnly?: boolean; json?: boolean }) => {
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
    const raw = (await res.json()) as {
      path: string;
      sourceChunkCount: number;
      items: { path: string; namespace: string; score: number; hits: number; excerpt: string }[];
      count: number;
    };
    // --threshold is a post-retrieval client-side filter. We apply it
    // BEFORE the --paths-only / --json / text branches so every output
    // mode sees the same filtered subset and the `count` in --json
    // reflects the kept items (not the API-returned total). Semantics
    // mirror `search --threshold` exactly:
    //   - missing flag => no filter (default behaviour preserved)
    //   - non-numeric value (`--threshold $MAYBE` with empty env var)
    //     is silently ignored rather than thrown so shell scripts that
    //     conditionally set the var do not break
    //   - score >= minScore is kept (inclusive lower bound, same as
    //     `search --threshold`)
    // The API does not currently accept a `minScore` query parameter,
    // so doing this client-side is the only way to expose the knob
    // without an API change. The `sourceChunkCount` field is preserved
    // verbatim from the response so an operator still sees how many
    // chunks the source actually contributed to retrieval — that count
    // is not narrowed by the filter (it is a property of the source,
    // not of the returned set).
    const minScore = opts.threshold !== undefined ? Number.parseFloat(opts.threshold) : NaN;
    const filteredItems = Number.isFinite(minScore)
      ? raw.items.filter((it) => it.score >= minScore)
      : raw.items;
    const out = { ...raw, items: filteredItems, count: filteredItems.length };
    // --paths-only is the pipeline-friendly twin of search --paths-only
    // / forget --paths-only / pins-mutes-aliases-tags --paths. We emit
    // one path per line in rank order (the API already returns items
    // ranked by score so we keep its order verbatim). Each path is
    // deduplicated against a Set sentinel — the API currently returns
    // each source at most once, but matching the search --paths-only
    // contract means the cli flag has the same guarantee even if the
    // API later grows finer granularity. Zero matches yields a clean
    // empty stream (no header, no "no related sources" hint, no ANSI)
    // so `clawmind related foo.md --paths-only | xargs ls` is safe.
    // We short-circuit before --json / styling so the contract is
    // unambiguous: --paths-only wins when set.
    if (opts.pathsOnly) {
      const seen = new Set<string>();
      for (const it of out.items) {
        if (seen.has(it.path)) continue;
        seen.add(it.path);
        process.stdout.write(`${it.path}\n`);
      }
      return;
    }
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
