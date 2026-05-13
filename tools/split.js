#!/usr/bin/env node
// Partitions index.html into byte-literal slices. Every byte of the input ends
// up in exactly one slice; concatenating slices in manifest order reproduces
// the file exactly. Slice boundaries are placed around top-level statements
// inside each inline <script>...</script> block (using acorn for the parse),
// plus the script-tag boundaries themselves.
//
// Named slices (those that span exactly one top-level binding — const, function,
// class) are written as `.js` with stripped-on-combine wrappers that make the
// slice loadable as a Node module: a header installs lazy `globalThis` getters
// pointing into a generated `_stubs.js` so sibling-slice references resolve at
// runtime, and a footer publishes this slice's own binding back to globalThis
// and `module.exports`. require('./42-APIService.js') then returns
// { APIService }. The wrapper regions are delimited by the sentinel comments
//   //@ellipsis-wrap-begin   and   //@ellipsis-wrap-end ;
// combine.js strips both and concatenates what remains.
//
// Output: ./slices/NNNN[-Name].{js,slice}  +  ./slices/manifest.txt  +
//         ./slices/_stubs.js  (sibling resolver, not part of the manifest)

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const acorn = require('acorn');

const ROOT = path.resolve(__dirname, '..');
const SRC = path.join(ROOT, 'index.html');
const OUT_DIR = path.join(ROOT, 'slices');

const WRAP_BEGIN = '//@ellipsis-wrap-begin';
const WRAP_END = '//@ellipsis-wrap-end';

const source = fs.readFileSync(SRC); // Buffer (raw bytes)
const text = source.toString('utf8'); // JS string; indices are UTF-16 code units
const srcHash = crypto.createHash('sha256').update(source).digest('hex');
// All cut points below are char indices into `text`. We slice `text` (not
// `source`) and write slices as utf8 text — so concatenating the utf8-encoded
// slices reproduces the original byte sequence regardless of multi-byte chars.

// Sentinel safety: bail if the source already contains our wrapper markers.
// Otherwise combine.js would strip legitimate source bytes.
for (const marker of [WRAP_BEGIN, WRAP_END]) {
    if (text.indexOf(marker) !== -1) {
        throw new Error(`Source contains sentinel "${marker}"; choose a different sentinel before proceeding.`);
    }
}

// 1. Locate inline <script> blocks (skip external src= scripts).
const scriptBlocks = [];
const openRe = /<script(\s[^>]*)?>/g;
let m;
while ((m = openRe.exec(text)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;
    const contentStart = m.index + m[0].length;
    const closeIdx = text.indexOf('</script>', contentStart);
    if (closeIdx === -1) throw new Error(`Unclosed <script> at offset ${m.index}`);
    scriptBlocks.push({ contentStart, contentEnd: closeIdx });
    openRe.lastIndex = closeIdx;
}
console.log(`Found ${scriptBlocks.length} inline <script> blocks`);

// 2. Parse each block, collect top-level statement spans (absolute offsets).
const cutPoints = new Set([0, text.length]);
const statements = []; // {start, end, label, bindingName}

// label: human-readable tag for the filename (may include `call_xxx` etc.)
// bindingName: the actual identifier this statement introduces, or null
function extractLabel(node) {
    if (node.type === 'VariableDeclaration' && node.declarations[0]?.id?.name) return node.declarations[0].id.name;
    if (node.type === 'FunctionDeclaration' && node.id?.name) return node.id.name;
    if (node.type === 'ClassDeclaration' && node.id?.name) return node.id.name;
    if (node.type === 'ExpressionStatement') {
        const e = node.expression;
        if (e.type === 'CallExpression' && e.callee?.name) return `call_${e.callee.name}`;
        if (e.type === 'AssignmentExpression' && e.left?.type === 'Identifier') return e.left.name;
    }
    return null;
}
function extractBindingName(node) {
    if (node.type === 'VariableDeclaration' && node.declarations[0]?.id?.name) return node.declarations[0].id.name;
    if (node.type === 'FunctionDeclaration' && node.id?.name) return node.id.name;
    if (node.type === 'ClassDeclaration' && node.id?.name) return node.id.name;
    return null;
}

function sanitize(name) {
    return name.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 60);
}

for (const blk of scriptBlocks) {
    const js = text.slice(blk.contentStart, blk.contentEnd);
    let ast;
    try {
        ast = acorn.parse(js, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true });
    } catch (e) {
        console.warn(`acorn failed on block [${blk.contentStart},${blk.contentEnd}): ${e.message}`);
        cutPoints.add(blk.contentStart);
        cutPoints.add(blk.contentEnd);
        continue;
    }
    cutPoints.add(blk.contentStart);
    cutPoints.add(blk.contentEnd);
    for (const node of ast.body) {
        const absStart = blk.contentStart + node.start;
        const absEnd = blk.contentStart + node.end;
        cutPoints.add(absStart);
        cutPoints.add(absEnd);
        statements.push({
            start: absStart,
            end: absEnd,
            label: extractLabel(node),
            bindingName: extractBindingName(node),
        });
    }
}

// 3. Build slices: consecutive cut-point pairs partition the file.
const sorted = [...cutPoints].sort((a, b) => a - b);
const slices = [];
for (let i = 0; i < sorted.length - 1; i++) {
    const start = sorted[i];
    const end = sorted[i + 1];
    if (start === end) continue;
    const stmt = statements.find(s => s.start === start && s.end === end);
    slices.push({
        start,
        end,
        label: stmt?.label || null,
        bindingName: stmt?.bindingName || null,
    });
}

// Sanity: slices partition the file.
let cursor = 0;
for (const s of slices) {
    if (s.start !== cursor) throw new Error(`gap at ${cursor}-${s.start}`);
    cursor = s.end;
}
if (cursor !== text.length) throw new Error(`tail gap at ${cursor}-${text.length}`);

// Collect every sibling-slice binding name. Each slice's wrapper declares
// every name EXCEPT its own (re-declaring with `var` would shadow harmlessly
// for `var` but would be a SyntaxError when the slice body uses `const`).
const allBindingNames = slices.map(s => s.bindingName).filter(Boolean);

// 4. Write slices + manifest.
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// We need each slice's filename so the generated _stubs.js can require it.
// First pass: assign filenames; second pass: write contents.
const pad = String(slices.length).length;
const filenames = slices.map((s, i) => {
    const idx = String(i).padStart(pad, '0');
    const tag = s.label ? `-${sanitize(s.label)}` : '';
    return `${idx}${tag}${s.bindingName ? '.js' : '.slice'}`;
});
const fileForBinding = {};
slices.forEach((s, i) => { if (s.bindingName) fileForBinding[s.bindingName] = filenames[i]; });

function formatNameList(names) {
    // 6 names per line, indented for readability.
    const lines = [];
    for (let i = 0; i < names.length; i += 6) {
        lines.push('    ' + names.slice(i, i + 6).map(n => JSON.stringify(n)).join(', '));
    }
    return lines.join(',\n');
}

function buildHeader(ownName) {
    const others = allBindingNames.filter(n => n !== ownName);
    return [
        WRAP_BEGIN,
        '/* eslint-disable */',
        '/* Sibling-slice resolver. Active only when this slice is loaded as a',
        ' * Node module (require(\'./NN-Name.js\')). The combine step strips this',
        ' * whole block, so it contributes zero bytes to index.html. */',
        '{',
        '    const _stubs = require(\'./_stubs.js\');',
        '    const _siblings = [',
        formatNameList(others) + ',',
        '    ];',
        '    for (const _k of _siblings) {',
        '        if (_k in globalThis) continue;',
        '        Object.defineProperty(globalThis, _k, {',
        '            configurable: true,',
        '            get() { return _stubs[_k]; },',
        '            set(v) { Object.defineProperty(globalThis, _k, { value: v, writable: true, configurable: true, enumerable: true }); },',
        '        });',
        '    }',
        '}',
        WRAP_END,
        '',
    ].join('\n');
}

function buildFooter(ownName) {
    // No leading '' here — the footer butts directly against the original's
    // last byte. The strip regex consumes the trailing newline after WRAP_END.
    return [
        WRAP_BEGIN,
        `if (typeof globalThis !== 'undefined') globalThis.${ownName} = ${ownName};`,
        `if (typeof module !== 'undefined') module.exports = { ${ownName} };`,
        WRAP_END,
        '',
    ].join('\n');
}

const manifestLines = [];
slices.forEach((s, i) => {
    const fname = filenames[i];
    let content;
    if (s.bindingName) {
        content = buildHeader(s.bindingName) + text.slice(s.start, s.end) + buildFooter(s.bindingName);
    } else {
        content = text.slice(s.start, s.end);
    }
    fs.writeFileSync(path.join(OUT_DIR, fname), content, 'utf8');
    manifestLines.push(fname);
});

// Generate _stubs.js — the lazy resolver every named slice's header requires.
// Pulls in _browser-stubs.js as its very first action so any slice that
// touches `document`, `localStorage`, etc. inside a method body doesn't
// immediately ReferenceError when invoked from Node. Not in the manifest;
// not part of the rebuilt index.html.
const stubsEntries = allBindingNames
    .map(name => `    ${JSON.stringify(name)}: ${JSON.stringify('./' + fileForBinding[name])},`)
    .join('\n');
const stubsJs = [
    '// Generated by tools/split.js — do not edit by hand.',
    'require(\'./_browser-stubs.js\'); // installs minimal globalThis stubs for document, localStorage, etc.',
    '// Lazy resolver for every sibling-slice binding. Each get triggers a',
    '// require() of the owning slice; Node\'s module cache keeps repeat',
    '// access cheap. Circular dependencies that touch other slices only',
    '// inside method bodies (the EllipsisLM pattern) resolve cleanly.',
    'const SLICE_FOR = {',
    stubsEntries,
    '};',
    'for (const name of Object.keys(SLICE_FOR)) {',
    '    Object.defineProperty(module.exports, name, {',
    '        enumerable: true,',
    '        get() { return require(SLICE_FOR[name])[name]; },',
    '    });',
    '}',
    '',
].join('\n');
fs.writeFileSync(path.join(OUT_DIR, '_stubs.js'), stubsJs, 'utf8');

// Generate _browser-stubs.js — minimal stand-ins for browser globals so
// controller methods that touch `document`, `localStorage`, `navigator`,
// etc. don't immediately ReferenceError when invoked from Node. Stubs are
// intentionally shallow: getters return sensible defaults, mutations are
// no-ops. Anything substantive (real persistence, real DOM behavior, real
// IndexedDB) requires the combined file running in a browser / Electron.
// If a global is already defined (e.g. by Node or by a real browser-env
// shim like JSDOM), the stub does not clobber it.
const browserStubsJs = `// Generated by tools/split.js — do not edit by hand.
// Minimal browser-globals shim. Lets controller methods be invoked from Node
// for smoke-testing; does NOT provide real browser semantics.

const _passThroughStyle = new Proxy({}, { get() { return ''; }, set() { return true; } });
const _noOpClassList = { add() {}, remove() {}, toggle() {}, contains() { return false; } };
const _makeStubElement = () => ({
    value: '', textContent: '', innerHTML: '', tagName: 'STUB',
    classList: _noOpClassList,
    style: _passThroughStyle,
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    appendChild(c) { return c; }, removeChild(c) { return c; }, insertBefore(c) { return c; },
    querySelector() { return null; }, querySelectorAll() { return []; },
    getAttribute() { return null; }, setAttribute() {}, removeAttribute() {},
    click() {}, focus() {}, blur() {},
    getBoundingClientRect: () => ({ x: 0, y: 0, width: 0, height: 0, top: 0, left: 0, right: 0, bottom: 0 }),
    children: [], childNodes: [], parentNode: null,
    cloneNode() { return _makeStubElement(); },
});

function _mapBackedStorage() {
    const _s = new Map();
    return {
        getItem: (k) => (_s.has(k) ? _s.get(k) : null),
        setItem: (k, v) => { _s.set(String(k), String(v)); },
        removeItem: (k) => { _s.delete(String(k)); },
        clear: () => { _s.clear(); },
        key: (i) => [..._s.keys()][i] ?? null,
        get length() { return _s.size; },
    };
}

if (typeof globalThis.window === 'undefined') globalThis.window = globalThis;

if (typeof globalThis.document === 'undefined') {
    globalThis.document = {
        getElementById: () => _makeStubElement(),
        querySelector: () => null,
        querySelectorAll: () => [],
        createElement: () => _makeStubElement(),
        createElementNS: () => _makeStubElement(),
        createDocumentFragment: () => _makeStubElement(),
        body: _makeStubElement(),
        head: _makeStubElement(),
        documentElement: _makeStubElement(),
        readyState: 'complete',
        addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; },
    };
}

if (typeof globalThis.navigator === 'undefined') {
    globalThis.navigator = {
        userAgent: 'EllipsisLM-slice-runtime/node',
        clipboard: { writeText: async () => {}, readText: async () => '' },
        language: 'en-US',
        onLine: true,
    };
}

// Force-install localStorage / sessionStorage. Node 25+ ships an experimental
// build-flag-gated implementation that's only half-wired (no getItem unless
// you pass --localstorage-file); we want a working in-memory store regardless.
globalThis.localStorage = _mapBackedStorage();
globalThis.sessionStorage = _mapBackedStorage();

if (typeof globalThis.requestAnimationFrame === 'undefined') {
    globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 16);
    globalThis.cancelAnimationFrame = (id) => clearTimeout(id);
}

if (typeof globalThis.Audio === 'undefined') {
    globalThis.Audio = class Audio {
        constructor(src) { this.src = src || ''; this.volume = 1; this.paused = true; this.currentTime = 0; }
        play() { return Promise.resolve(); }
        pause() {} load() {}
        addEventListener() {} removeEventListener() {}
    };
}

if (typeof globalThis.Image === 'undefined') {
    globalThis.Image = class Image {
        constructor() { this.src = ''; this.width = 0; this.height = 0; }
        addEventListener() {} removeEventListener() {}
    };
}

// IndexedDB is deliberately NOT stubbed. Silent no-op persistence would be
// worse than a loud failure; tests of DBService etc. should run in the
// combined file or under a real IDB shim (fake-indexeddb).
`;
fs.writeFileSync(path.join(OUT_DIR, '_browser-stubs.js'), browserStubsJs, 'utf8');

fs.writeFileSync(path.join(OUT_DIR, 'manifest.txt'), manifestLines.join('\n') + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'source.sha256'), srcHash + '  index.html\n');

const named = slices.filter(s => s.bindingName).length;
console.log(`Wrote ${slices.length} slices (${named} named .js with wrapper, ${slices.length - named} gap .slice)`);
console.log(`Source sha256: ${srcHash}`);
