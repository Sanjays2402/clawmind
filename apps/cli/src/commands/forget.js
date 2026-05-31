import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';
async function callForget(patterns, dryRun) {
    const env = loadEnv();
    const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
    const res = await fetch(`${base}/v1/maintenance/forget`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ patterns, dryRun }),
    });
    if (!res.ok)
        throw new Error(`POST /v1/maintenance/forget -> ${res.status}: ${await res.text()}`);
    return (await res.json());
}
export function forgetCommand() {
    return new Command('forget')
        .description('Remove indexed sources by glob pattern (manifest, BM25, and vector store)')
        .argument('<patterns...>', 'one or more glob patterns matched against absolute paths')
        .option('--apply', 'actually delete the matches; default is a dry-run preview')
        .option('--quiet', 'do not list every matched path')
        .action(async (patterns, opts) => {
        const dryRun = !opts.apply;
        const report = await callForget(patterns, dryRun);
        const verb = dryRun ? 'would remove' : 'removed';
        const head = `${verb} ${report.matched} source(s) and ${report.removedChunks} chunk(s)`;
        process.stdout.write((dryRun ? kleur.yellow(head) : kleur.red(head)) + '\n');
        if (!opts.quiet) {
            for (const p of report.removedPaths) {
                process.stdout.write(kleur.gray(`  ${p}\n`));
            }
        }
        if (dryRun && report.matched > 0) {
            process.stdout.write(kleur.bold('\nrerun with --apply to actually forget these.\n'));
        }
    });
}
//# sourceMappingURL=forget.js.map