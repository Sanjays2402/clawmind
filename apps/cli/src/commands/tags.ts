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
    .option('--sort <key>', 'sort key for the tag list: `count` (descending by source count, ties broken alphabetically by tag — the API default) or `tag` (ascending alphabetical by tag name, useful for diff-stable cron snapshots). Mirrors the `--sort` family on `stats` and the verbosity-knob philosophy that the cli should expose the ordering the operator wants without forcing a downstream `jq ... | sort`. Ties at the same primary key now carry a secondary sort by original-input index for cross-snapshot determinism — two consecutive `tags list --sort count --json` runs over identical input produce byte-identical output regardless of V8\'s Array#sort stability guarantees. Mirrors the family-wide secondary-index sort (feedback / digest / aliases / related / search / stale / stats --sort).', 'count')
    .option('--reverse', 'flip the --sort direction (mirrors `stale --reverse` / `search --reverse` / `related --reverse` / `feedback list --reverse` / `digest list --reverse` / `aliases list --reverse` / `stats --reverse` byte-for-byte). With --sort count the default is desc (loudest tags first); --reverse gives asc (rarest tags first) — the "audit underused labels" question, complementary to the "which labels dominate" default. With --sort tag the default is asc alphabetical; --reverse gives desc — useful for `tail`-style log scrapes where the FIRST change is the operator\'s focus and lives at the bottom of an alphabetical run. The secondary tie-break by original-input index is ALSO reversed under --reverse so cross-snapshot determinism holds in either direction (two consecutive --sort + --reverse runs over identical-ties input produce byte-identical output). Note: like `stats --reverse`, `tags list --reverse` is ALWAYS active because --sort has a commander default value (`count`) — the rest of the family treats --reverse without --sort as a no-op because opts.sort is undefined. Tags and stats are the only two commands in the family with this deviation; documented here so the precedent is explicit. Composes with --top: the cap applies to the head of the post-reverse ordering, so `--sort count --reverse --top 5` is "the 5 rarest tags" (not the 5 most common).')
    .option('--top <n>', 'cap the list at this many entries AFTER sorting and -q filtering. The natural use is "the top 10 tags by source count" — pairs with `--sort count` (the default) to answer "which labels dominate my index" in a single invocation. Composes with -q: the substring filter narrows the candidate set first, then --top picks the head. Mirrors `stats --top` byte-for-byte (clamped to a sensible positive integer; non-positive or NaN values fall back to "no cap" so a typo like --top 0 still yields a useful response rather than an empty table).', (v) => Number.parseInt(v, 10))
    .option('--slim', 'with --json: emit a slimmed `{count, tags}` shape that drops the per-entry `count` field (the per-tag source count). Mirrors `aliases list --json --slim` byte-for-byte but with the tag-name axis (the array is named `tags` not `names` because the operator already knows these are tag identifiers). The full --json payload includes the per-tag source count which doubles the payload size for every tag — a dashboard panel polling "is the tag set stable" once a minute only cares about which labels EXIST, not how loud each one is. The `tags` array is the tag-name list IN WHICHEVER ORDER the prior --sort + --reverse + --top pipeline produced. Composes with -q (server-side narrowing) / --sort / --reverse / --top: the slim count + tags describe SURVIVORS of every narrowing step. `count === tags.length` always. Ignored without --json (text mode unchanged).')
    .option('--json', 'emit results as JSON for scripting')
    .action(async (opts: { q?: string; sort: string; reverse?: boolean; top?: number; slim?: boolean; json?: boolean }) => {
      const qs = opts.q ? `?q=${encodeURIComponent(opts.q)}` : '';
      const apiOut = (await apiFetch('GET', `/v1/tags${qs}`)) as {
        items: { tag: string; count: number }[];
        count: number;
      };
      // The API already returns `items` sorted by count descending
      // with alphabetical tie-breaking (see services/tags.ts /
      // pathsByTag). We re-sort here for two reasons:
      //   1. `tag` is a different primary key (asc alphabetical).
      //   2. The family-wide contract requires a secondary sort by
      //      original-input index for cross-snapshot determinism AND
      //      a single dir-multiplier flip under --reverse. Both of
      //      those need an explicit local sort even for `--sort count`
      //      — passing through the API order would surface fine under
      //      stable engines but is unenforceable.
      // An unknown --sort key aborts cleanly (matches `stats --sort`).
      const sortKey = opts.sort.toLowerCase();
      if (sortKey !== 'tag' && sortKey !== 'count') {
        process.stderr.write(kleur.red(`tags list failed: unknown --sort key "${opts.sort}" (expected: count, tag)\n`));
        process.exitCode = 1;
        return;
      }
      // --reverse flips the per-key direction. Mirrors the family-
      // wide reverse-modifier contract (stale / search / related /
      // feedback list / digest list / aliases list / stats --reverse)
      // byte-for-byte: a single sign-flipping multiplier (dir = -1
      // under --reverse, else 1) applied to BOTH the primary
      // comparator AND the secondary tie-break by original-input
      // index. The dual-flip preserves cross-snapshot determinism
      // under --reverse — without it, ties would silently shift on
      // every other run because the primary returned 0 but the
      // secondary kept ascending while the visible ordering of every
      // other row was descending.
      const dir = opts.reverse ? -1 : 1;
      let items = apiOut.items
        .map((it, idx) => ({ it, idx }))
        .sort((a, b) => {
          let cmp = 0;
          if (sortKey === 'count') cmp = b.it.count - a.it.count;
          else if (sortKey === 'tag') cmp = a.it.tag.localeCompare(b.it.tag);
          if (cmp !== 0) return cmp * dir;
          // Secondary sort by original-input index for deterministic
          // ties. Also reversed under --reverse so cross-snapshot
          // determinism holds in either direction.
          return (a.idx - b.idx) * dir;
        })
        .map((r) => r.it);
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
        // --slim emits a `{count, tags}` shape that drops the
        // per-entry `count` field (the per-tag source count).
        // Mirrors `aliases list --json --slim` byte-for-byte but
        // with the tag-name axis (the array is named `tags` not
        // `names` because the operator already knows these are
        // tag identifiers — naming the array `names` would be
        // ambiguous next to the queued `tags paths --json --slim`
        // shape which uses `paths`).
        //
        // The natural cron use is a dashboard panel polling "is
        // the tag set stable" once a minute. The full --json
        // payload includes the per-tag source count which doubles
        // the payload size for every tag — a dashboard polling
        // "which labels exist" pays for what it does not need.
        // The slim shape drops the per-tag count and keeps just
        // the names.
        //
        // The `tags` array is the tag-name list IN WHICHEVER
        // ORDER the prior --sort + --reverse + --top pipeline
        // produced. -q narrows server-side; --sort / --reverse
        // re-order client-side; --top slices the head. The slim
        // shape emits whichever order survived (matches the
        // aliases / digest / feedback slim ordering contract).
        //
        // `count` mirrors the full shape's `count` field (post-
        // filter recomputation). The sum-equals-total invariant
        // holds: count === tags.length.
        //
        // Single-line JSON.stringify (no indent) so an NDJSON
        // snapshot stream like
        //   while true; do clawmind tags list --json --slim; sleep 60; done
        // produces clean NDJSON that diffs cleanly between ticks.
        if (opts.slim) {
          const slim = {
            count: out.items.length,
            tags: out.items.map((it) => it.tag),
          };
          process.stdout.write(JSON.stringify(slim) + '\n');
          return;
        }
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
    .option('--paths', 'pipeline-friendly: emit ONLY the path column (no styling, no headers, no "no sources tagged" hint). Zero matches yields an empty stream so xargs/wc keep working. Predates the family-wide `--paths-only` naming used by search/forget/related/stale/pins/mutes/aliases; `--paths-only` is the recommended alias going forward.')
    .option('--paths-only', 'alias for --paths to bring the tags surface in line with the family-wide `--paths-only` naming exposed by search/forget/related/stale. Either flag emits exactly the same byte stream (one path per line, no ANSI, no header, no "no sources tagged" hint) so existing scripts using --paths keep working unchanged. When both are passed, the effect is identical (no precedence — they are truly equivalent). Mirrors the stale --paths / --paths-only alias relationship byte-for-byte. Composes with --json (--paths-only short-circuits --json).')
    .option('--sort <key>', 'sort the path list by `path` (asc alphabetical, for stable cross-snapshot diffs of `tags paths <tag> --paths-only` cron streams). Default: no --sort (preserves the API-returned order — usually insertion order — so existing scripts diffing snapshots stay byte-stable until they opt into the new sort). Applied BEFORE every output mode (--json / --paths / --paths-only / text) so each mode sees the SAME ordered subset — a downstream consumer parsing --json and a sibling parsing --paths-only get byte-equivalent path orders. Mirrors the family-wide --sort contract (stats / feedback list / digest list / aliases list / tags list / stale / search / related --sort): ties at the same primary key carry a secondary sort by original-input index for cross-snapshot determinism, unknown keys abort cleanly with exit 1 enumerating the valid set. The natural cron use is a daily snapshot of "the paths under tag X" that diffs cleanly even when the API insertion order shifts across ingests — `clawmind tags paths work --sort path --paths-only > snap.txt` then `diff` across days. Only `path` is supported today (the per-path payload has no other meaningful sort key); the flag exists for symmetry with the rest of the family so a future addition (e.g. lastIngestedAt) drops in without a breaking change to the surface.')
    .option('--reverse', 'flip the --sort direction (mirrors `stale --reverse` / `search --reverse` / `related --reverse` / `feedback list --reverse` / `digest list --reverse` / `aliases list --reverse` / `stats --reverse` / `tags list --reverse` byte-for-byte). With --sort path the default is asc alphabetical; --reverse gives desc — useful for `tail`-style log scrapes where the FIRST change is the operator\'s focus and lives at the bottom of an alphabetical run. The secondary tie-break by original-input index is ALSO reversed under --reverse so cross-snapshot determinism holds in either direction (two consecutive --sort + --reverse runs over identical-ties input produce byte-identical output — although for paths under a single tag, ties cannot occur because path strings are unique by definition; the dual-flip is documented here for family-contract consistency rather than as a real-world need). Ignored without --sort (the API ordering is a fixed contract and --reverse alone is not a sort direction question without a sort key) — mirrors the rest of the family-wide --sort/--reverse contract.')
    .option('--slim', 'with --json: emit a slimmed `{count, tag, paths}` shape that drops nothing (the full --json payload is already {tag, paths, count}). The slim shape just re-keys to the family-wide cron-dashboard convention so a downstream poller scripting against multiple slim-shape commands (aliases / pins / mutes / tags list / digest / etc.) sees the SAME top-level shape `{count, ...}` everywhere. The `tag` identifier is preserved because it disambiguates which tag\'s paths these are — useful when a single script polls `tags paths <a> --json --slim` and `tags paths <b> --json --slim` and dumps both into the same NDJSON stream. Composes naturally with the `tags paths <tag>` command\'s zero-match contract: a tag with no sources yields `{count: 0, tag: "<tag>", paths: []}` rather than an error or empty stream — same shape as a popular tag, just empty arrays. `count === paths.length` always. Ignored without --json (text mode unchanged); short-circuited by --paths / --paths-only (the pipeline shape wins).')
    .action(async (tag: string, opts: { json?: boolean; paths?: boolean; pathsOnly?: boolean; sort?: string; reverse?: boolean; slim?: boolean }) => {
      const enc = encodeURIComponent(tag);
      const out = (await apiFetch('GET', `/v1/tags/${enc}`)) as {
        tag: string; paths: string[]; count: number;
      };
      // --sort orders the path list BEFORE every output mode so the
      // --json / --paths / --paths-only / text branches all see the
      // SAME ordered subset. Mirrors the family-wide --sort contract
      // (stats / feedback list / digest list / aliases list / tags
      // list / stale / search / related --sort): ties at the same
      // primary key carry a secondary sort by original-input index
      // for cross-snapshot determinism, unknown keys abort cleanly.
      //
      // Today only `path` is supported (the per-path payload under a
      // single tag has no other meaningful sort key — `tags paths`
      // returns a flat string list, NOT objects with metadata). The
      // flag exists for symmetry with the rest of the family so a
      // future addition (e.g. lastIngestedAt) drops in without a
      // breaking change to the surface. An unknown key aborts with
      // a crisp error pointing at the supported set.
      //
      // Ties cannot occur for paths under a single tag (path strings
      // are unique by definition — the API stores them in a Set) so
      // the secondary-by-original-index sort is a no-op in practice;
      // it's documented here for family-contract consistency rather
      // than as a real-world need. The dual sort still fires under
      // --reverse so the contract is auditable in either direction.
      //
      // The default (no --sort) preserves the API-returned order so
      // existing scripts diffing `tags paths X --paths-only`
      // snapshots stay byte-stable until they opt into the new sort.
      let paths = out.paths;
      if (opts.sort !== undefined) {
        const sortKey = opts.sort.toLowerCase();
        if (sortKey !== 'path') {
          process.stderr.write(kleur.red(`tags paths failed: unknown --sort key "${opts.sort}" (expected: path)\n`));
          process.exitCode = 1;
          return;
        }
        // --reverse flips the per-key direction. Mirrors the family-
        // wide reverse-modifier contract (stale / search / related /
        // feedback list / digest list / aliases list / stats / tags
        // list --reverse) byte-for-byte: a single sign-flipping
        // multiplier (dir = -1 under --reverse, else 1) applied to
        // BOTH the primary comparator AND the secondary tie-break
        // by original-input index. The dual-flip preserves cross-
        // snapshot determinism under --reverse — even though paths
        // are unique so the secondary cannot fire in practice, the
        // contract is auditable in either direction.
        const dir = opts.reverse ? -1 : 1;
        paths = out.paths
          .map((p, idx) => ({ p, idx }))
          .sort((a, b) => {
            const cmp = a.p.localeCompare(b.p);
            if (cmp !== 0) return cmp * dir;
            return (a.idx - b.idx) * dir;
          })
          .map((r) => r.p);
      }
      // --paths and --paths-only emit the same byte stream. We check
      // BOTH before --json so the pipeline-friendly contract trumps
      // the machine-readable one (matches the precedent set by
      // search/forget/related/stale --paths-only). The pair of flags
      // is the alias relationship: --paths was the original spelling
      // for this command, --paths-only is the family-wide canonical
      // name. We OR them so either spelling triggers the path-stream
      // shape; when both are passed the effect is identical. This
      // keeps the flag family uniform without breaking the existing
      // --paths contract that the tests pin to its exact byte layout.
      if (opts.paths || opts.pathsOnly) {
        for (const p of paths) process.stdout.write(`${p}\n`);
        return;
      }
      if (opts.json) {
        // --slim re-keys the full payload to the family-wide cron-
        // dashboard convention `{count, tag, paths}` so a downstream
        // poller scripting against multiple slim-shape commands
        // (aliases / pins / mutes / tags list / digest / etc.) sees
        // the SAME top-level `{count, ...}` shape everywhere. The
        // full --json payload (`{tag, paths, count}`) is already
        // slim — there is no per-row metadata to drop — but the
        // key ORDER differs (count comes last in the full shape)
        // and the slim shape pins the leading-count convention so
        // a `jq '.count'` filter works against every slim shape in
        // the family without case-by-case handling.
        //
        // The `tag` identifier is preserved because it disambiguates
        // which tag's paths these are — useful when a single cron
        // script polls `tags paths <a> --json --slim` and
        // `tags paths <b> --json --slim` and dumps both into the
        // same NDJSON stream. Without `tag` the dashboard parser
        // would have to know which command produced which line by
        // out-of-band convention.
        //
        // Zero matches yields `{count: 0, tag: "<tag>", paths: []}`
        // (NOT an empty stream or an error) so a downstream cron
        // poll polling a tag that has no sources sees the same shape
        // as a popular tag, just with empty arrays. The natural use
        // is a per-tag stability dashboard where a tag dropping to
        // zero is a SIGNAL worth surfacing, not a parse failure.
        //
        // `count === paths.length` always (the API already enforces
        // this on the source side; we re-emit it for symmetry).
        //
        // Single-line JSON.stringify so an NDJSON snapshot stream
        // diffs cleanly across ticks.
        if (opts.slim) {
          const slim = { count: paths.length, tag: out.tag, paths };
          process.stdout.write(JSON.stringify(slim) + '\n');
          return;
        }
        // Full --json shape includes the sorted paths too — observational
        // consistency with --slim and --paths-only across every output
        // mode. The full shape's `count` is recomputed from the sorted
        // length so it always matches paths.length (--sort cannot
        // change the count, but we keep the recompute belt-and-suspenders
        // so a future filter on top of --sort does not silently lie).
        const payload = { tag: out.tag, paths, count: paths.length };
        process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
        return;
      }
      // --paths is the pipeline-friendly contract shared with pins/mutes/
      // aliases/stale: one path per line, no ANSI, no "no sources tagged"
      // hint, no header. Zero matches yields an empty stream. The default
      // text mode already prints "no sources tagged <tag>" for empty
      // results and a styled-bold path body for matches, neither of which
      // a `| xargs` consumer wants.
      if (out.count === 0) {
        process.stdout.write(kleur.gray(`no sources tagged ${out.tag}\n`));
        return;
      }
      for (const p of paths) process.stdout.write(`${p}\n`);
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
