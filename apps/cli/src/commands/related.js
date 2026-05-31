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
        .description('Find sources semantically similar to a given indexed path');
    cmd.action(async (path, opts) => {
        const env = loadEnv();
        const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
        const url = new URL(`${base}/v1/related`);
        url.searchParams.set('path', path);
        url.searchParams.set('k', String(opts.k));
        if (opts.namespaces)
            url.searchParams.set('namespaces', opts.namespaces);
        const res = await fetch(url);
        if (!res.ok) {
            process.stderr.write(kleur.red(`error: ${res.status} ${await res.text()}\n`));
            process.exitCode = 1;
            return;
        }
        const out = (await res.json());
        if (out.count === 0) {
            process.stdout.write(kleur.gray(`no related sources found (searched against ${out.sourceChunkCount} chunks)\n`));
            return;
        }
        process.stdout.write(kleur.dim(`related to ${out.path} (${out.sourceChunkCount} chunks)\n`));
        for (const it of out.items) {
            const head = `${kleur.bold(it.path)} ${kleur.gray(`[${it.namespace}]`)} ${kleur.cyan(it.score.toFixed(3))} ${kleur.dim(`x${it.hits}`)}`;
            process.stdout.write(head + '\n');
            process.stdout.write('  ' + kleur.dim(it.excerpt.replace(/\s+/g, ' ')) + '\n');
        }
    });
    return cmd;
}
//# sourceMappingURL=related.js.map