import { Command, InvalidArgumentError } from 'commander';
import { writeFile } from 'node:fs/promises';
import kleur from 'kleur';

// Talks to the local API to fetch a conversation as Markdown, JSON, or CSV.
// We keep rendering in the API so it stays the single source of truth for
// export format; the CLI just picks the endpoint and writes the bytes.

const FORMATS = ['md', 'json', 'csv'] as const;
type Format = (typeof FORMATS)[number];

function parseFormat(value: string): Format {
  const v = value.toLowerCase();
  if ((FORMATS as readonly string[]).includes(v)) return v as Format;
  throw new InvalidArgumentError(`expected one of: ${FORMATS.join(', ')}`);
}

export function exportCommand() {
  return new Command('export')
    .description('Export a conversation (markdown, json, or csv)')
    .argument('<id>', 'conversation id')
    .option('-o, --out <file>', 'write to file instead of stdout')
    .option('-f, --format <fmt>', `output format (${FORMATS.join('|')})`, parseFormat, 'md' as Format)
    .option('--since <iso-date>', 'narrow the export to turns whose `ts` is at-or-after this ISO date. The natural cron use is an incremental dump: `clawmind export <id> --since "$(date -u -d \'1 day ago\' +%FT%TZ)" -o today.md` produces a daily delta without re-downloading the whole thread each tick. Cutoff is INCLUSIVE (>=) — mirrors --since semantics across stale / stats / digest show / pins / mutes / ingest / reindex byte-for-byte. Forwarded as ?since=<value> to the API; parse failures abort with the API\'s 400 surfaced through the normal error path (so a typo cannot silently degrade to the full export and double-bill the bandwidth budget). Empty windows yield a well-formed export with zero turns — NOT a 404 — so a cron polling a quiet conversation does not alarm.')
    .option('--api <url>', 'API base URL', process.env.CLAWMIND_API_URL ?? 'http://127.0.0.1:7410')
    .option('--slim', 'with the export response: emit a slim `{format, since, bytes}` dashboard probe shape that drops the conversation body and reports only the response byte length. The classic cron use is `clawmind export <id> --since <iso> --slim` polled every minute to answer "did this conversation grow since the cutoff, and by how much" without paying the wire cost of the full transcript. On a long conversation, the full export body can be hundreds of kilobytes; the slim shape is ~80 bytes regardless. `bytes` is the raw response body length (post-API, pre-write) so the dashboard sees what the network actually carried; a dashboard panel that branches on `bytes > 0` distinguishes a real incremental delta from an empty cutoff-window. `format` echoes the requested format (md / json / csv) so a multi-format dashboard panel does not have to correlate against cron config to know which row it is reading. `since` echoes the cutoff (or null when absent) so a multi-cutoff dashboard polling several time windows can identify which row it is reading — mirrors the `reindex --dry-run --json --slim` / `ingest --dry-run --json --slim` since-anchor convention byte-for-byte. The body itself is suppressed (NOT written to stdout, NOT written to -o) so the slim probe never accidentally double-bills the filesystem on a polling dashboard. Single-line JSON.stringify (no indent) keeps the NDJSON snapshot diff clean across cron ticks. Composes naturally with --since, -f / --format, --api. Ignored on a non-2xx (the standard `export failed` error path still fires before reaching the slim shape — the probe is for HEALTHY exports only). The -o file write is SKIPPED under --slim because the body has been discarded; the slim probe is a polling shape, not a persistence shape. Wins over the legacy stdout/-o emit when set.')
    .action(async (id: string, opts: { out?: string; format: Format; since?: string; slim?: boolean; api: string }) => {
      // Validate --since up front so a typo aborts BEFORE any
      // network round-trip. The API would also reject it (the route
      // returns 400 on a non-numeric Date.parse) but a client-side
      // hard-fail keeps the error message crisp ("invalid ISO date")
      // instead of leaking the API's generic "400 Bad Request" wrap
      // when the actual problem is a shell-level $MAYBE expansion
      // typo. Matches the validation precedent set by ingest --since
      // / reindex --since / digest run --since.
      if (opts.since !== undefined && !Number.isFinite(Date.parse(opts.since))) {
        process.stderr.write(kleur.red(`export failed: --since value "${opts.since}" is not a valid ISO date\n`));
        process.exitCode = 1;
        return;
      }
      const baseUrl = `${opts.api.replace(/\/+$/, '')}/v1/conversations/${encodeURIComponent(id)}/export.${opts.format}`;
      const url = opts.since !== undefined
        ? `${baseUrl}?since=${encodeURIComponent(opts.since)}`
        : baseUrl;
      let res: Response;
      try {
        res = await fetch(url);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        process.stderr.write(kleur.red(`export failed: cannot reach ${opts.api} (${msg})\n`));
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
        process.stderr.write(kleur.red(`export failed (${res.status} ${res.statusText})${suffix}\n`));
        process.exitCode = 1;
        return;
      }
      const body = await res.text();
      // --slim wins over the legacy stdout/-o emit. The shape is
      // `{format, since, bytes}` — only the integers + identifiers
      // a cron-dashboard polling panel needs, no conversation body.
      // The body itself is suppressed (NOT written to stdout, NOT
      // written to -o) so the slim probe never accidentally
      // double-bills the filesystem on a polling dashboard.
      //
      // Why this shape (and what was deliberately dropped):
      //   - `bytes`  -> response body length (post-API, pre-write).
      //                 The headline integer a dashboard branches
      //                 on: "did this conversation grow since the
      //                 cutoff" is a `bytes > 0` test (an empty
      //                 cutoff-window returns a well-formed export
      //                 with zero turns, which is still a real
      //                 body but its length collapses to the
      //                 format's empty-shape minimum — md: 0,
      //                 json: ~30 bytes for {"version":1,...}
      //                 with empty turns, csv: header row only).
      //                 A dashboard wiring `bytes > N` against a
      //                 per-format empty-shape baseline distinguishes
      //                 a real incremental delta from an empty
      //                 cutoff-window without parsing the body.
      //   - `format` -> echoes the requested format so a multi-
      //                 format dashboard panel does not have to
      //                 correlate against cron config to know
      //                 which row it is reading (mirrors the
      //                 `reindex --dry-run --json --slim` /
      //                 `ingest --dry-run --json --slim` self-
      //                 describing-payload convention)
      //   - `since`  -> echoes the cutoff (or null when absent) so
      //                 a multi-cutoff dashboard polling several
      //                 time windows can identify which row it is
      //                 reading without out-of-band tracking;
      //                 mirrors the family-wide cron-dashboard
      //                 `--since` echo contract byte-for-byte
      //   - the conversation body is INTENTIONALLY DROPPED: a
      //     polling dashboard does not need the transcript; the
      //     operator who wants the transcript runs without --slim
      //     (the legacy stdout/-o path is fully preserved)
      //   - `id` is INTENTIONALLY DROPPED: a single dashboard
      //     polling a single conversation already knows the id
      //     from cron config; a multi-conversation dashboard
      //     can identify the id from cron labels rather than
      //     carry it through the JSON payload (the saving is
      //     ~30+ bytes per snapshot, meaningful at NDJSON-append
      //     scale)
      //
      // The -o file write is SKIPPED under --slim because the body
      // has been discarded; the slim probe is a polling shape, not
      // a persistence shape. An operator who wants both should
      // either run twice (once without --slim to persist, once
      // with --slim to probe) or tee the polling output.
      //
      // Single-line JSON.stringify (no indent) keeps the NDJSON
      // snapshot diff clean across cron ticks.
      if (opts.slim) {
        process.stdout.write(JSON.stringify({
          format: opts.format,
          since: opts.since ?? null,
          bytes: body.length,
        }) + '\n');
        return;
      }
      if (opts.out) {
        await writeFile(opts.out, body, 'utf8');
        process.stdout.write(kleur.green(`wrote ${body.length} bytes -> ${opts.out}\n`));
      } else {
        process.stdout.write(body);
      }
    });
}
