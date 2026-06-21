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
    .action(async (id: string, opts: { out?: string; format: Format; since?: string; api: string }) => {
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
      if (opts.out) {
        await writeFile(opts.out, body, 'utf8');
        process.stdout.write(kleur.green(`wrote ${body.length} bytes -> ${opts.out}\n`));
      } else {
        process.stdout.write(body);
      }
    });
}
