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
// Not in the manifest; not part of the rebuilt index.html.
const stubsEntries = allBindingNames
    .map(name => `    ${JSON.stringify(name)}: ${JSON.stringify('./' + fileForBinding[name])},`)
    .join('\n');
const stubsJs = [
    '// Generated by tools/split.js — do not edit by hand.',
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

fs.writeFileSync(path.join(OUT_DIR, 'manifest.txt'), manifestLines.join('\n') + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'source.sha256'), srcHash + '  index.html\n');

const named = slices.filter(s => s.bindingName).length;
console.log(`Wrote ${slices.length} slices (${named} named .js with wrapper, ${slices.length - named} gap .slice)`);
console.log(`Source sha256: ${srcHash}`);
