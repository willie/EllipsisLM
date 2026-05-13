#!/usr/bin/env node
// Reads slices/manifest.txt and concatenates the named slice files in order,
// producing out/index.html. For named (.js) slices, strips the wrapper region
// delimited by  //@ellipsis-wrap-begin  ...  //@ellipsis-wrap-end ; gap (.slice)
// files are taken verbatim. Output is byte-identical to the source iff the
// content outside wrapper regions has not been edited.

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const SLICES_DIR = path.join(ROOT, 'slices');
const OUT = path.join(ROOT, 'out', 'index.html');

const WRAP_RE = /\/\/@ellipsis-wrap-begin\n[\s\S]*?\/\/@ellipsis-wrap-end\n/g;

const manifest = fs.readFileSync(path.join(SLICES_DIR, 'manifest.txt'), 'utf8')
    .split('\n')
    .filter(Boolean);

const parts = manifest.map(f => {
    const raw = fs.readFileSync(path.join(SLICES_DIR, f), 'utf8');
    // Strip wrapper regions. Runs unconditionally — no-op on gap slices that
    // don't contain the sentinels.
    const stripped = raw.replace(WRAP_RE, '');
    return Buffer.from(stripped, 'utf8');
});
const combined = Buffer.concat(parts);

fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, combined);

const outHash = crypto.createHash('sha256').update(combined).digest('hex');
console.log(`Wrote ${OUT} (${combined.length} bytes)`);
console.log(`Output sha256: ${outHash}`);

// If we recorded the source hash at split time, verify the round-trip.
const expectedFile = path.join(SLICES_DIR, 'source.sha256');
if (fs.existsSync(expectedFile)) {
    const expected = fs.readFileSync(expectedFile, 'utf8').split(/\s+/)[0];
    if (expected === outHash) {
        console.log(`ROUND-TRIP OK: matches source.sha256`);
    } else {
        console.error(`ROUND-TRIP MISMATCH:\n  expected ${expected}\n  got      ${outHash}`);
        process.exit(1);
    }
}
