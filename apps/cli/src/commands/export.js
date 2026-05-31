import { Command } from 'commander';
import { writeFile } from 'node:fs/promises';
import kleur from 'kleur';
// Talks to the local API to fetch a conversation as Markdown. We keep this in
// the CLI rather than re-implementing rendering here so the API stays the
// single source of truth for export format.
export function exportCommand() {
    return new Command('export')
        .description('Export a conversation to Markdown')
        .argument('<id>', 'conversation id')
        .option('-o, --out <file>', 'write to file instead of stdout')
        .option('--api <url>', 'API base URL', process.env.CLAWMIND_API_URL ?? 'http://127.0.0.1:7410')
        .action(async (id, opts) => {
        const url = `${opts.api.replace(/\/+$/, '')}/v1/conversations/${encodeURIComponent(id)}/export.md`;
        const res = await fetch(url);
        if (!res.ok) {
            process.stderr.write(kleur.red(`export failed (${res.status} ${res.statusText})\n`));
            process.exitCode = 1;
            return;
        }
        const md = await res.text();
        if (opts.out) {
            await writeFile(opts.out, md, 'utf8');
            process.stdout.write(kleur.green(`wrote ${md.length} bytes -> ${opts.out}\n`));
        }
        else {
            process.stdout.write(md);
        }
    });
}
//# sourceMappingURL=export.js.map