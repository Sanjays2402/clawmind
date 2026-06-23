import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';

// CLI shim over the /v1/aliases HTTP endpoints. Aliases are workspace-wide
// shortcuts (e.g. "@notes" -> "/Users/me/.openclaw/workspace/notes") that
// the API expands inside queries and uses to shorten cited paths.

class AliasesCliError extends Error {}

async function apiFetch(method: string, path: string, body?: unknown) {
  const env = loadEnv();
  const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      method,
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    throw new AliasesCliError(`cannot reach ${base} (${msg})`);
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
    throw new AliasesCliError(`(${res.status} ${res.statusText})${suffix}`);
  }
  return res.json();
}

async function runOrReport(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof AliasesCliError) {
      process.stderr.write(kleur.red(`${label} failed: ${err.message}\n`));
      process.exitCode = 1;
      return;
    }
    throw err;
  }
}

function fmtDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

export function aliasesCommand() {
  const cmd = new Command('aliases').description('Short, memorable names for long source paths');

  cmd.command('add <name> <path>')
    .description('Create or replace an alias (name must match [a-z0-9][a-z0-9_-]*)')
    .action(async (name: string, path: string) => {
      await runOrReport('aliases add', async () => {
        const out = await apiFetch('POST', '/v1/aliases', { name, path });
        const e = out as { name: string; path: string };
        process.stdout.write(kleur.green(`@${e.name}`) + kleur.gray(` -> ${e.path}\n`));
      });
    });

  cmd.command('remove <name>')
    .alias('rm')
    .description('Remove an alias')
    .action(async (name: string) => {
      await runOrReport('aliases remove', async () => {
        await apiFetch('DELETE', '/v1/aliases', { name });
        process.stdout.write(kleur.gray(`removed @${name}\n`));
      });
    });

  cmd.command('list')
    .description('List aliases sorted by name')
    .option('-q, --q <text>', 'case-insensitive substring filter across name and path')
    .option('--since <iso-date>', 'keep only aliases whose createdAt is at-or-after this ISO date. The natural cron use is a daily snapshot of "what was added in the last 24h" without scrolling through every alias: `clawmind aliases list --since "$(date -u -d \'1 day ago\' +%FT%TZ)" --paths`. Mirrors `pins list --since` / `mutes list --since` byte-for-byte (cutoff is INCLUSIVE: `>=`, so an alias created exactly at the cutoff is kept). Composes with -q as an intersection (filter must both match the substring AND be recent enough). Filter applies BEFORE --paths / --json / text rendering so every output mode sees the same subset. Parse failures abort cleanly with exit 1.')
    .option('--sort <key>', 'sort surviving aliases by one of: name (asc alphabetical, the default human-readable ordering; matches the API\'s native sort so this key is mostly useful for symmetry with other commands), createdAt (desc — newest-first, the natural "what was added recently" ordering that pairs with --since for daily snapshots). Applied AFTER -q / --since so the sort orders the SURVIVORS of any narrowing filter. Mirrors `feedback list --sort` / `digest list --sort` precedent: ties carry a secondary sort by original index for cross-snapshot determinism, unknown keys abort cleanly with exit 1. The default (no --sort) preserves the API-returned alphabetical name ordering so existing scripts diffing `aliases list --json` stay byte-stable.')
    .option('--reverse', 'flip the --sort direction (mirrors `stale --reverse` / `search --reverse` / `related --reverse` / `feedback list --reverse` / `digest list --reverse` byte-for-byte). With --sort name the default is asc alphabetical; --reverse gives desc — useful for `tail`-style log scrapes where the FIRST change is the operator\'s focus and lives at the bottom of an alphabetical run. With --sort createdAt the default is desc (newest-first); --reverse gives asc (oldest-first) — pairs with --since for "the alias that was added at-or-after this cutoff with the LONGEST track record" question, complementary to the "freshest first" default that --since alone surfaces. Ignored without --sort (the API ordering is a fixed contract). The secondary tie-break by original index is ALSO reversed under --reverse so cross-snapshot determinism holds in either direction (two consecutive --sort + --reverse runs over identical-ties input produce byte-identical output).')
    .option('--paths', 'emit only the alias target paths, one per line, with no styling (pipe-friendly)')
    .option('--paths-only', 'family-wide canonical alias for --paths. Mirrors `stale --paths-only` / `tags paths --paths-only` (which also expose both spellings) so the muscle-memory contract is uniform across every list-style command. Both flags emit the byte-identical stream; passing either or both produces the same output. The `--paths` spelling stays for backwards compatibility with existing scripts.')
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { q?: string; since?: string; sort?: string; reverse?: boolean; paths?: boolean; pathsOnly?: boolean; json?: boolean }) => {
      await runOrReport('aliases list', async () => {
        const qs = opts.q ? `?q=${encodeURIComponent(opts.q)}` : '';
        let out = (await apiFetch('GET', `/v1/aliases${qs}`)) as {
          items: { name: string; path: string; createdAt: number; createdBy: string }[];
          count: number;
        };
        // --since narrows the listed aliases to those created on or
        // after the cutoff. Mirrors `pins list --since` / `mutes list
        // --since` byte-for-byte: the cutoff is INCLUSIVE (>=) so an
        // alias created exactly at the cutoff is kept (matches
        // colloquial "since X" reading where X itself counts). The
        // filter applies AFTER the -q narrowing (-q forwards to the
        // API as a server-side substring filter; --since runs
        // client-side on top) so the kept set is the intersection.
        //
        // The recomputed count reflects the post-filter length so a
        // downstream `jq .count` consumer sees the right number and
        // the text-mode empty-state path is taken when the filter
        // empties everything. Pre-filter `out.count` would lie about
        // the displayed body.
        //
        // Parse failures abort cleanly via the existing AliasesCliError
        // path so a typo like `--since 2026-13-01` does not silently
        // degrade to "no filter".
        if (opts.since) {
          const cutoff = Date.parse(opts.since);
          if (!Number.isFinite(cutoff)) {
            throw new AliasesCliError(`--since value "${opts.since}" is not a valid ISO date`);
          }
          const items = out.items.filter((it) => it.createdAt >= cutoff);
          out = { items, count: items.length };
        }
        // --sort orders the SURVIVORS of any narrowing filter.
        // The API natively returns aliases sorted by name asc, so
        // `--sort name` is mostly useful for symmetry with other
        // commands; `--sort createdAt` is the meaningful primitive
        // — it pairs with --since to answer "what got added
        // recently, newest first" in a single call.
        //
        // Sort keys:
        //   name (asc)        -> alphabetical by alias name
        //   createdAt (desc)  -> newest-first
        //
        // Mirrors `feedback list --sort` / `digest list --sort`
        // contract: applied AFTER -q / --since so the sort orders
        // the survivors of any narrowing filter; ties carry a
        // secondary sort by original index for cross-snapshot
        // determinism; unknown keys abort cleanly with exit 1
        // (a typo cannot silently fall back to API order).
        if (opts.sort !== undefined) {
          const sortKey = opts.sort.toLowerCase();
          const validKeys = ['name', 'createdat'];
          if (!validKeys.includes(sortKey)) {
            throw new AliasesCliError(`--sort value must be one of: name, createdAt (got "${opts.sort}")`);
          }
          // --reverse flips the per-key direction. Mirrors the family-
          // wide reverse-modifier contract (stale / search / related /
          // feedback list / digest list --reverse) byte-for-byte: a
          // single sign-flipping multiplier (dir = -1 under --reverse,
          // else 1) applied to BOTH the primary comparator AND the
          // secondary tie-break by original index. The dual-flip
          // preserves cross-snapshot determinism under --reverse.
          const dir = opts.reverse ? -1 : 1;
          const ranked = out.items
            .map((it, idx) => ({ it, idx }))
            .sort((a, b) => {
              let cmp = 0;
              if (sortKey === 'name') cmp = a.it.name.localeCompare(b.it.name);
              else if (sortKey === 'createdat') cmp = b.it.createdAt - a.it.createdAt;
              if (cmp !== 0) return cmp * dir;
              // Secondary sort by original index for deterministic ties.
              // Also reversed under --reverse so cross-snapshot determinism
              // holds in either direction.
              return (a.idx - b.idx) * dir;
            })
            .map((r) => r.it);
          out = { ...out, items: ranked };
        }
        if (opts.json) {
          process.stdout.write(JSON.stringify(out, null, 2) + '\n');
          return;
        }
        // --paths is the pipe-friendly twin of `pins list --paths` /
        // `mutes list --paths` / `forget --paths-only`. Emits only the
        // alias's resolved target path (one per line, no styling, no
        // arrow, no @name, no timestamp), so things like
        //   clawmind aliases list --paths -q work | xargs ls -la
        //   clawmind aliases list --paths | xargs -n1 clawmind ingest
        // work without conditional skips. -q still narrows the set;
        // zero matches yields a clean empty stream.
        //
        // --paths-only is the family-wide canonical alias for --paths.
        // The two flags are checked together so passing either or
        // both produces the byte-identical stream. The dual spelling
        // exists because earlier commands (stale, tags) ship both
        // names as TRUE aliases — keeping the muscle-memory contract
        // consistent across every list-style command means an
        // operator who learned `clawmind stale --paths-only` does
        // not have to learn a different spelling here.
        if (opts.paths || opts.pathsOnly) {
          for (const it of out.items) process.stdout.write(`${it.path}\n`);
          return;
        }
        if (out.count === 0) { process.stdout.write(kleur.gray('no aliases defined\n')); return; }
        for (const it of out.items) {
          const head = kleur.bold(`@${it.name}`);
          const tail = kleur.gray(`(${fmtDate(it.createdAt)} by ${it.createdBy})`);
          process.stdout.write(`${head} ${kleur.cyan('->')} ${it.path} ${tail}\n`);
        }
      });
    });

  return cmd;
}
