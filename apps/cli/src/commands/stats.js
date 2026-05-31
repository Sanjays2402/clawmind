import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';
function fmtBytes(n) {
    if (n < 1024)
        return `${n} B`;
    if (n < 1024 * 1024)
        return `${(n / 1024).toFixed(1)} KB`;
    if (n < 1024 * 1024 * 1024)
        return `${(n / 1024 / 1024).toFixed(1)} MB`;
    return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}
function fmtAge(ms) {
    if (ms === null)
        return 'never';
    const delta = Date.now() - ms;
    if (delta < 60_000)
        return `${Math.round(delta / 1000)}s ago`;
    if (delta < 3_600_000)
        return `${Math.round(delta / 60_000)}m ago`;
    if (delta < 86_400_000)
        return `${Math.round(delta / 3_600_000)}h ago`;
    return `${Math.round(delta / 86_400_000)}d ago`;
}
export function statsCommand() {
    return new Command('stats')
        .description('Per-namespace breakdown of indexed files, chunks, and bytes')
        .option('--json', 'emit machine-readable JSON instead of a text table')
        .action(async (opts) => {
        const env = loadEnv();
        const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
        const res = await fetch(`${base}/v1/stats`);
        if (!res.ok)
            throw new Error(`GET /v1/stats -> ${res.status}: ${await res.text()}`);
        const report = (await res.json());
        if (opts.json) {
            process.stdout.write(JSON.stringify(report, null, 2) + '\n');
            return;
        }
        process.stdout.write(kleur.bold(`${report.totals.files} files, ${report.totals.chunks} chunks, ` +
            `${fmtBytes(report.totals.bytes)} across ${report.totals.namespaces} namespaces\n\n`));
        if (report.byNamespace.length === 0) {
            process.stdout.write(kleur.gray('no files indexed yet\n'));
            return;
        }
        for (const ns of report.byNamespace) {
            const top = ns.extensions.slice(0, 4).map((e) => `${e.ext}:${e.count}`).join(' ');
            process.stdout.write(`${kleur.cyan(ns.namespace.padEnd(10))} ` +
                `${String(ns.files).padStart(6)} files  ` +
                `${String(ns.chunks).padStart(7)} chunks  ` +
                `${fmtBytes(ns.bytes).padStart(10)}  ` +
                kleur.gray(`updated ${fmtAge(ns.newestIngestedAt)}  [${top}]\n`));
        }
    });
}
//# sourceMappingURL=stats.js.map