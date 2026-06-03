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
    .option('--api <url>', 'API base URL', process.env.CLAWMIND_API_URL ?? 'http://127.0.0.1:7410')
    .action(async (id: string, opts: { out?: string; format: Format; api: string }) => {
      const url = `${opts.api.replace(/\/+$/, '')}/v1/conversations/${encodeURIComponent(id)}/export.${opts.format}`;
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
