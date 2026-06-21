import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

// CLI shim over the /v1/tags HTTP endpoints. The API owns the persisted tag
// map so the CLI, web UI, and direct HTTP callers all converge on a single
// source of truth.

async function apiFetch(method: string, path: string, body?: unknown) {
  const env = loadEnv();
  const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
  const res = await fetch(`${base}${path}`, {
    method,
    headers: body ? { 'content-type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

function parseTagList(raw: string): string[] {
  return raw.split(',').map((s) => s.trim()).filter(Boolean);
}

export function tagsCommand() {
  const cmd = new Command('tags').description('Label sources with arbitrary tags for query-time filtering');

  cmd.command('list')
    .description('List every tag with its source count')
    .option('-q, --q <text>', 'case-insensitive substring filter on tag name')
    .option('--sort <key>', 'sort key for the tag list: `count` (descending by source count, ties broken alphabetically by tag — the API default) or `tag` (ascending alphabetical by tag name, useful for diff-stable cron snapshots). Mirrors the `--sort` family on `stats` and the verbosity-knob philosophy that the cli should expose the ordering the operator wants without forcing a downstream `jq ... | sort`.', 'count')
    .option('--top <n>', 'cap the list at this many entries AFTER sorting and -q filtering. The natural use is "the top 10 tags by source count" — pairs with `--sort count` (the default) to answer "which labels dominate my index" in a single invocation. Composes with -q: the substring filter narrows the candidate set first, then --top picks the head. Mirrors `stats --top` byte-for-byte (clamped to a sensible positive integer; non-positive or NaN values fall back to "no cap" so a typo like --top 0 still yields a useful response rather than an empty table).', (v) => Number.parseInt(v, 10))
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { q?: string; sort: string; top?: number; json?: boolean }) => {
      const qs = opts.q ? `?q=${encodeURIComponent(opts.q)}` : '';
      const apiOut = (await apiFetch('GET', `/v1/tags${qs}`)) as {
        items: { tag: string; count: number }[];
        count: number;
      };
      // The API already returns `items` sorted by count descending
      // with alphabetical tie-breaking (see services/tags.ts /
      // pathsByTag). We re-sort here only when the operator asked
      // for a different key. Two supported keys:
      //   - count (default): keep the API order verbatim, no work
      //   - tag           : ascending alphabetical by tag name —
      //                     stable across snapshots so two
      //                     consecutive `clawmind tags list --sort
      //                     tag --json --top 100` runs diff cleanly
      //                     even when a tag's count flutters across
      //                     ingests. The cron use is a daily snapshot
      //                     of the namespace label set.
      // An unknown --sort key aborts cleanly (matches `stats --sort`).
      const sortKey = opts.sort.toLowerCase();
      let items = apiOut.items;
      if (sortKey === 'tag') {
        items = [...items].sort((a, b) => a.tag.localeCompare(b.tag));
      } else if (sortKey !== 'count') {
        process.stderr.write(kleur.red(`tags list failed: unknown --sort key "${opts.sort}" (expected: count, tag)\n`));
        process.exitCode = 1;
        return;
      }
      // --top is the final shaper: it slices the head off the
      // already-sorted list. Clamping matches `stats --top` so the
      // muscle memory carries — a non-positive or NaN value falls
      // back to "no cap" (the full list) rather than yielding the
      // surprising "empty table" that `--top 0` would otherwise
      // produce. We apply --top AFTER --sort because the slice
      // semantic is "the top N entries by the chosen order"; the
      // operator who passes `--sort tag --top 10` is asking for
      // the first 10 alphabetically, not 10 random tags. Composes
      // with -q (the API already narrowed by substring above).
      if (opts.top !== undefined && Number.isFinite(opts.top) && opts.top > 0) {
        items = items.slice(0, opts.top);
      }
      const out = { items, count: items.length };
      if (opts.json) {
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
        return;
      }
      if (out.count === 0) { process.stdout.write(kleur.gray('no tags defined\n')); return; }
      for (const it of out.items) {
        process.stdout.write(`${kleur.bold(it.tag)} ${kleur.gray(`(${it.count})`)}\n`);
      }
    });

  cmd.command('paths <tag>')
    .description('List source paths carrying a tag')
    .option('--json', 'emit results as JSON for scripting')
    .option('--paths', 'pipeline-friendly: emit ONLY the path column (no styling, no headers, no "no sources tagged" hint). Zero matches yields an empty stream so xargs/wc keep working.')
    .action(async (tag: string, opts: { json?: boolean; paths?: boolean }) => {
      const enc = encodeURIComponent(tag);
      const out = (await apiFetch('GET', `/v1/tags/${enc}`)) as {
        tag: string; paths: string[]; count: number;
      };
      if (opts.json) {
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
        return;
      }
      // --paths is the pipeline-friendly contract shared with pins/mutes/
      // aliases/stale: one path per line, no ANSI, no "no sources tagged"
      // hint, no header. Zero matches yields an empty stream. The default
      // text mode already prints "no sources tagged <tag>" for empty
      // results and a styled-bold path body for matches, neither of which
      // a `| xargs` consumer wants.
      if (opts.paths) {
        for (const p of out.paths) process.stdout.write(`${p}\n`);
        return;
      }
      if (out.count === 0) {
        process.stdout.write(kleur.gray(`no sources tagged ${out.tag}\n`));
        return;
      }
      for (const p of out.paths) process.stdout.write(`${p}\n`);
    });

  cmd.command('show <path>')
    .description('Show tags currently attached to a source path')
    .option('--json', 'emit results as JSON for scripting')
    .action(async (path: string, opts: { json?: boolean }) => {
      const enc = encodeURIComponent(path);
      const out = (await apiFetch('GET', `/v1/tags/by-path?path=${enc}`)) as {
        path: string; tags: string[];
      };
      if (opts.json) {
        process.stdout.write(JSON.stringify(out, null, 2) + '\n');
        return;
      }
      if (out.tags.length === 0) {
        process.stdout.write(kleur.gray(`no tags on ${out.path}\n`));
        return;
      }
      process.stdout.write(`${kleur.bold(out.path)}\n  ${out.tags.join(', ')}\n`);
    });

  cmd.command('add <path> <tags>')
    .description('Add one or more comma-separated tags to a source')
    .action(async (path: string, tags: string) => {
      const out = (await apiFetch('POST', '/v1/tags/by-path', {
        path, tags: parseTagList(tags),
      })) as { path: string; tags: string[] };
      process.stdout.write(kleur.green(`tagged ${out.path}: ${out.tags.join(', ')}\n`));
    });

  cmd.command('set <path> <tags>')
    .description('Replace the tag list on a source with this comma-separated set')
    .action(async (path: string, tags: string) => {
      const out = (await apiFetch('PUT', '/v1/tags/by-path', {
        path, tags: parseTagList(tags),
      })) as { path: string; tags: string[] };
      if (out.tags.length === 0) process.stdout.write(kleur.gray(`cleared tags on ${out.path}\n`));
      else process.stdout.write(kleur.green(`set ${out.path}: ${out.tags.join(', ')}\n`));
    });

  cmd.command('remove <path> [tags]')
    .alias('rm')
    .description('Remove specific tags, or clear all tags when none are given')
    .action(async (path: string, tags?: string) => {
      const body: { path: string; tags?: string[] } = { path };
      if (tags) body.tags = parseTagList(tags);
      const out = (await apiFetch('DELETE', '/v1/tags/by-path', body)) as {
        path: string; tags: string[];
      };
      process.stdout.write(kleur.gray(`tags on ${out.path}: ${out.tags.join(', ') || '(none)'}\n`));
    });

  return cmd;
}
