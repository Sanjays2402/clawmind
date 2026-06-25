// Dependency-free syntax highlighter for the source viewer.
//
// Real Prism/Shiki would pull a heavy dependency and a webfont of grammars
// into the bundle for what is, in this app, a calm read-only code view. This
// is a small, restrained tokenizer covering the languages ClawMind actually
// indexes (TS/JS, Python, JSON, CSS, shell, YAML, Go/Rust/Java/C-family) with
// a deliberately limited palette so the result reads like ink-on-paper, not a
// rainbow.
//
// The tokenizer runs line-by-line, carrying a small `LineState` across lines
// so multi-line block comments (/* ... */) and template literals (`...`) are
// coloured correctly without ever letting a stray quote run away and tint the
// rest of the file (single/double strings and line comments always terminate
// at the newline).

export type TokenType = 'kw' | 'str' | 'com' | 'num' | 'punct' | 'plain';

export interface Token {
  text: string;
  type: TokenType;
}

export interface LineState {
  /** Inside an unterminated block comment opened on a previous line. */
  block: boolean;
  /** Inside an unterminated template literal opened on a previous line. */
  template: boolean;
}

export const INITIAL_STATE: LineState = { block: false, template: false };

interface LangSpec {
  line: string | null; // line-comment marker
  block: [string, string] | null; // block-comment open/close
  /** Quote chars that DON'T span lines (close at newline). */
  strings: string[];
  /** Whether backtick template literals (multi-line) are supported. */
  template: boolean;
  keywords: Set<string>;
}

const C_FAMILY_KW = [
  'abstract', 'as', 'async', 'await', 'break', 'case', 'catch', 'class', 'const',
  'continue', 'debugger', 'default', 'delete', 'do', 'else', 'enum', 'export',
  'extends', 'false', 'finally', 'for', 'from', 'function', 'if', 'implements',
  'import', 'in', 'instanceof', 'interface', 'let', 'new', 'null', 'of', 'private',
  'protected', 'public', 'readonly', 'return', 'static', 'super', 'switch', 'this',
  'throw', 'true', 'try', 'type', 'typeof', 'undefined', 'var', 'void', 'while',
  'yield', 'namespace', 'declare', 'keyof', 'satisfies', 'infer',
];

const PY_KW = [
  'and', 'as', 'assert', 'async', 'await', 'break', 'class', 'continue', 'def',
  'del', 'elif', 'else', 'except', 'False', 'finally', 'for', 'from', 'global',
  'if', 'import', 'in', 'is', 'lambda', 'None', 'nonlocal', 'not', 'or', 'pass',
  'raise', 'return', 'True', 'try', 'while', 'with', 'yield', 'match', 'case',
  'self', 'cls',
];

const GO_KW = [
  'break', 'case', 'chan', 'const', 'continue', 'default', 'defer', 'else', 'fallthrough',
  'for', 'func', 'go', 'goto', 'if', 'import', 'interface', 'map', 'package', 'range',
  'return', 'select', 'struct', 'switch', 'type', 'var', 'nil', 'true', 'false',
];

const RUST_KW = [
  'as', 'async', 'await', 'break', 'const', 'continue', 'crate', 'dyn', 'else', 'enum',
  'extern', 'false', 'fn', 'for', 'if', 'impl', 'in', 'let', 'loop', 'match', 'mod',
  'move', 'mut', 'pub', 'ref', 'return', 'self', 'Self', 'static', 'struct', 'super',
  'trait', 'true', 'type', 'unsafe', 'use', 'where', 'while',
];

const SH_KW = [
  'if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac',
  'function', 'in', 'return', 'export', 'local', 'echo', 'cd', 'set', 'unset', 'read',
];

const JSON_KW = ['true', 'false', 'null'];

const YAML_KW = ['true', 'false', 'null', 'yes', 'no', 'on', 'off'];

function spec(
  line: string | null,
  block: [string, string] | null,
  strings: string[],
  template: boolean,
  kw: string[],
): LangSpec {
  return { line, block, strings, template, keywords: new Set(kw) };
}

const SPECS: Record<string, LangSpec> = {
  cfamily: spec('//', ['/*', '*/'], ["'", '"'], true, C_FAMILY_KW),
  python: spec('#', null, ["'", '"'], false, PY_KW),
  json: spec(null, null, ['"'], false, JSON_KW),
  css: spec(null, ['/*', '*/'], ["'", '"'], false, []),
  shell: spec('#', null, ["'", '"'], false, SH_KW),
  yaml: spec('#', null, ["'", '"'], false, YAML_KW),
  go: spec('//', ['/*', '*/'], ['"', '`'], false, GO_KW),
  rust: spec('//', ['/*', '*/'], ['"'], false, RUST_KW),
};

const EXT_LANG: Record<string, keyof typeof SPECS | 'none'> = {
  ts: 'cfamily', tsx: 'cfamily', js: 'cfamily', jsx: 'cfamily', mjs: 'cfamily',
  cjs: 'cfamily', java: 'cfamily', c: 'cfamily', h: 'cfamily', cpp: 'cfamily',
  hpp: 'cfamily', cc: 'cfamily', cs: 'cfamily', swift: 'cfamily', kt: 'cfamily',
  py: 'python', pyi: 'python',
  json: 'json', jsonc: 'json',
  css: 'css', scss: 'css', less: 'css',
  sh: 'shell', bash: 'shell', zsh: 'shell',
  yaml: 'yaml', yml: 'yaml',
  go: 'go',
  rs: 'rust',
};

/**
 * Resolve a LangSpec for a path by extension, or null when the file type has
 * no highlighter (markdown, plain text, unknown). A null spec means "render
 * as plain text", which the viewer falls back to cleanly.
 */
export function langForPath(path: string): LangSpec | null {
  const m = /\.([a-z0-9]+)$/i.exec(path);
  if (!m) return null;
  const lang = EXT_LANG[m[1]!.toLowerCase()];
  if (!lang || lang === 'none') return null;
  return SPECS[lang] ?? null;
}

const ID_START = /[A-Za-z_$]/;
const ID_CHAR = /[A-Za-z0-9_$]/;
const DIGIT = /[0-9]/;

/** Tokenize a single line given the carried state; returns tokens + next state. */
export function tokenizeLine(
  line: string,
  spc: LangSpec,
  state: LineState,
): { tokens: Token[]; next: LineState } {
  const tokens: Token[] = [];
  let i = 0;
  const n = line.length;
  let block = state.block;
  let template = state.template;
  const push = (text: string, type: TokenType) => {
    if (!text) return;
    const last = tokens[tokens.length - 1];
    if (last && last.type === type) last.text += text;
    else tokens.push({ text, type });
  };

  // Carry-over: finish an open block comment.
  if (block && spc.block) {
    const close = line.indexOf(spc.block[1]);
    if (close === -1) {
      push(line, 'com');
      return { tokens, next: { block: true, template } };
    }
    push(line.slice(0, close + spc.block[1].length), 'com');
    i = close + spc.block[1].length;
    block = false;
  }

  // Carry-over: finish an open template literal.
  if (template) {
    let j = i;
    while (j < n) {
      if (line[j] === '\\') { j += 2; continue; }
      if (line[j] === '`') { j++; break; }
      j++;
    }
    const closed = j <= n && line[j - 1] === '`';
    push(line.slice(i, j), 'str');
    i = j;
    template = !closed;
    if (template) return { tokens, next: { block, template } };
  }

  while (i < n) {
    const ch = line[i]!;
    const rest = line.slice(i);

    // Line comment to end of line.
    if (spc.line && rest.startsWith(spc.line)) {
      push(rest, 'com');
      break;
    }
    // Block comment open.
    if (spc.block && rest.startsWith(spc.block[0])) {
      const close = line.indexOf(spc.block[1], i + spc.block[0].length);
      if (close === -1) {
        push(rest, 'com');
        block = true;
        break;
      }
      push(line.slice(i, close + spc.block[1].length), 'com');
      i = close + spc.block[1].length;
      continue;
    }
    // Template literal open (spans lines).
    if (spc.template && ch === '`') {
      let j = i + 1;
      while (j < n) {
        if (line[j] === '\\') { j += 2; continue; }
        if (line[j] === '`') { j++; break; }
        j++;
      }
      const closed = j <= n && line[j - 1] === '`' && j > i + 1;
      push(line.slice(i, j), 'str');
      i = j;
      template = !closed;
      if (template) break;
      continue;
    }
    // Single/double quoted string (terminates at newline).
    if (spc.strings.includes(ch)) {
      let j = i + 1;
      while (j < n) {
        if (line[j] === '\\') { j += 2; continue; }
        if (line[j] === ch) { j++; break; }
        j++;
      }
      push(line.slice(i, j), 'str');
      i = j;
      continue;
    }
    // Number.
    if (DIGIT.test(ch)) {
      let j = i;
      while (j < n && /[0-9a-fA-FxXob._]/.test(line[j]!)) j++;
      push(line.slice(i, j), 'num');
      i = j;
      continue;
    }
    // Identifier / keyword.
    if (ID_START.test(ch)) {
      let j = i;
      while (j < n && ID_CHAR.test(line[j]!)) j++;
      const word = line.slice(i, j);
      push(word, spc.keywords.has(word) ? 'kw' : 'plain');
      i = j;
      continue;
    }
    // Punctuation cluster (anything not whitespace/word).
    if (/\s/.test(ch)) {
      push(ch, 'plain');
      i++;
      continue;
    }
    push(ch, 'punct');
    i++;
  }

  return { tokens, next: { block, template } };
}

/**
 * Highlight a multi-line string into an array of per-line token arrays, given
 * a LangSpec. Pass `null` spec (or use langForPath) to skip highlighting; the
 * caller then renders plain text.
 */
export function highlight(content: string, spc: LangSpec): Token[][] {
  const lines = content.split('\n');
  const out: Token[][] = [];
  let state = INITIAL_STATE;
  for (const line of lines) {
    const { tokens, next } = tokenizeLine(line, spc, state);
    out.push(tokens.length ? tokens : [{ text: line, type: 'plain' }]);
    state = next;
  }
  return out;
}
