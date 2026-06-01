import { Command } from 'commander';
import kleur from 'kleur';
import { loadEnv } from '@clawmind/config';
// CLI shim over the /v1/tags HTTP endpoints. The API owns the persisted tag
// map so the CLI, web UI, and direct HTTP callers all converge on a single
// source of truth.
async function apiFetch(method, path, body) {
    const env = loadEnv();
    const base = `http://${env.CLAWMIND_API_HOST}:${env.CLAWMIND_API_PORT}`;
    const res = await fetch(`${base}${path}`, {
        method,
        headers: body ? { 'content-type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    if (!res.ok)
        throw new Error(`${method} ${path} -> ${res.status}: ${await res.text()}`);
    return res.json();
}
function parseTagList(raw) {
    return raw.split(',').map((s) => s.trim()).filter(Boolean);
}
export function tagsCommand() {
    const cmd = new Command('tags').description('Label sources with arbitrary tags for query-time filtering');
    cmd.command('list')
        .description('List every tag with its source count')
        .action(async () => {
        const out = (await apiFetch('GET', '/v1/tags'));
        if (out.count === 0) {
            process.stdout.write(kleur.gray('no tags defined\n'));
            return;
        }
        for (const it of out.items) {
            process.stdout.write(`${kleur.bold(it.tag)} ${kleur.gray(`(${it.count})`)}\n`);
        }
    });
    cmd.command('paths <tag>')
        .description('List source paths carrying a tag')
        .action(async (tag) => {
        const enc = encodeURIComponent(tag);
        const out = (await apiFetch('GET', `/v1/tags/${enc}`));
        if (out.count === 0) {
            process.stdout.write(kleur.gray(`no sources tagged ${out.tag}\n`));
            return;
        }
        for (const p of out.paths)
            process.stdout.write(`${p}\n`);
    });
    cmd.command('show <path>')
        .description('Show tags currently attached to a source path')
        .action(async (path) => {
        const enc = encodeURIComponent(path);
        const out = (await apiFetch('GET', `/v1/tags/by-path?path=${enc}`));
        if (out.tags.length === 0) {
            process.stdout.write(kleur.gray(`no tags on ${out.path}\n`));
            return;
        }
        process.stdout.write(`${kleur.bold(out.path)}\n  ${out.tags.join(', ')}\n`);
    });
    cmd.command('add <path> <tags>')
        .description('Add one or more comma-separated tags to a source')
        .action(async (path, tags) => {
        const out = (await apiFetch('POST', '/v1/tags/by-path', {
            path, tags: parseTagList(tags),
        }));
        process.stdout.write(kleur.green(`tagged ${out.path}: ${out.tags.join(', ')}\n`));
    });
    cmd.command('set <path> <tags>')
        .description('Replace the tag list on a source with this comma-separated set')
        .action(async (path, tags) => {
        const out = (await apiFetch('PUT', '/v1/tags/by-path', {
            path, tags: parseTagList(tags),
        }));
        if (out.tags.length === 0)
            process.stdout.write(kleur.gray(`cleared tags on ${out.path}\n`));
        else
            process.stdout.write(kleur.green(`set ${out.path}: ${out.tags.join(', ')}\n`));
    });
    cmd.command('remove <path> [tags]')
        .alias('rm')
        .description('Remove specific tags, or clear all tags when none are given')
        .action(async (path, tags) => {
        const body = { path };
        if (tags)
            body.tags = parseTagList(tags);
        const out = (await apiFetch('DELETE', '/v1/tags/by-path', body));
        process.stdout.write(kleur.gray(`tags on ${out.path}: ${out.tags.join(', ') || '(none)'}\n`));
    });
    return cmd;
}
//# sourceMappingURL=tags.js.map