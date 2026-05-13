#!/usr/bin/env node
// Partitions index.html into byte-literal slices. Every byte of the input ends
// up in exactly one slice; concatenating slices in manifest order reproduces
// the file exactly. Slice boundaries are placed around top-level statements
// inside each inline <script>...</script> block (using acorn for the parse),
// plus the script-tag boundaries themselves.
//
// Named slices (those that span exactly one top-level binding — const, function,
// class) are written as `.js` with a stripped-on-combine wrapper that declares
// every sibling-slice binding name. That makes the slice file open in an editor
// as syntactically clean JavaScript with no spurious "undefined identifier"
// warnings on cross-controller references. The wrapper region is delimited by
// the sentinel comments  //@ellipsis-wrap-begin  and  //@ellipsis-wrap-end ;
// combine.js strips that region and concatenates what remains.
//
// Output: ./slices/NNNN[-Name].{js,slice}  +  ./slices/manifest.txt

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

function buildWrapper(ownName) {
    const others = allBindingNames.filter(n => n !== ownName);
    // Format: 6 names per line, indented for readability inside the file.
    const lines = [];
    for (let i = 0; i < others.length; i += 6) {
        lines.push('    ' + others.slice(i, i + 6).join(', '));
    }
    return [
        WRAP_BEGIN,
        '/* eslint-disable no-var, no-unused-vars */',
        '/* Declarations of sibling-slice identifiers — stripped at combine time. */',
        '/** @type {*} */ var',
        lines.join(',\n') + ';',
        WRAP_END,
        '',
    ].join('\n');
}

const pad = String(slices.length).length;
const manifestLines = [];
slices.forEach((s, i) => {
    const idx = String(i).padStart(pad, '0');
    const tag = s.label ? `-${sanitize(s.label)}` : '';
    let content;
    let fname;
    if (s.bindingName) {
        // Named slice with a real binding → write as JS with wrapper.
        fname = `${idx}${tag}.js`;
        content = buildWrapper(s.bindingName) + text.slice(s.start, s.end);
    } else {
        // Gap slice (whitespace/HTML/CSS/wrapper) or ExpressionStatement →
        // write as raw substring with .slice extension, no wrapper.
        fname = `${idx}${tag}.slice`;
        content = text.slice(s.start, s.end);
    }
    fs.writeFileSync(path.join(OUT_DIR, fname), content, 'utf8');
    manifestLines.push(fname);
});
fs.writeFileSync(path.join(OUT_DIR, 'manifest.txt'), manifestLines.join('\n') + '\n');
fs.writeFileSync(path.join(OUT_DIR, 'source.sha256'), srcHash + '  index.html\n');

const named = slices.filter(s => s.bindingName).length;
console.log(`Wrote ${slices.length} slices (${named} named .js with wrapper, ${slices.length - named} gap .slice)`);
console.log(`Source sha256: ${srcHash}`);
