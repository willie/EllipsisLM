# Deterministic split / combine prototype

Goal: edit `index.html` in modular pieces, but treat the single file as the
distributed artifact. `combine(split(index.html)) == index.html`, byte-for-byte.

## The property

- `split.js` partitions `index.html` into a sequence of byte-literal slices.
  Every byte of the input lives in exactly one slice. Top-level JavaScript
  declarations inside each inline `<script>` block become their own slice
  (named after the declaration); everything else — HTML, CSS, inter-statement
  whitespace, JSDoc blocks, the script-tag wrappers themselves — becomes an
  unnamed gap slice. No code is regenerated; each slice file is a literal
  substring of the original.

- `combine.js` reads `slices/manifest.txt` and concatenates the named slice
  files in order. It compares the resulting sha256 against the snapshot
  recorded at split time (`slices/source.sha256`); a mismatch is a non-zero
  exit, which is what CI checks.

- Round-trip is identity *by construction*. Whitespace, CRLF endings, quote
  styles, comment formatting, multi-byte UTF-8 in comments — all preserved,
  because slices are never reformatted, only sliced and re-glued.

## Usage

```
npm install                       # one-time, installs acorn
node tools/split.js               # writes slices/
node tools/combine.js             # writes out/index.html and verifies
shasum -a 256 index.html out/index.html
```

Edit a slice (e.g. `slices/42-APIService.slice`) → re-run `combine.js` → the
resulting `out/index.html` differs from the original at exactly the edited
bytes. The combine script will report `ROUND-TRIP MISMATCH` and exit non-zero,
which is correct: the slices are now the source of truth, the original is
stale, and `out/index.html` is what you'd commit.

## Slice naming

`NN-Identifier.slice` for slices that exactly span a top-level declaration
(`const Foo = …`, `function bar() {…}`, `class Baz {…}`). `NN.slice` for gap
slices (whitespace, comments, HTML wrapper). The numeric prefix is the
manifest ordering — that's the only thing `combine.js` cares about; the rest
of the filename is for human/LLM readability.

## Why this exists

`index.html` is ~23k lines and ~1.6 MB. Asking an LLM to edit it means
loading the whole file into context, and the edit boundaries are usually
inside one controller (`NarrativeController`, `PromptBuilder`, `APIService`,
etc.) that's a small fraction of the file. With this split, an edit to the
Scriptwriter prompt becomes "open `slices/78-NarrativeController.slice`
(~3000 lines), edit it, re-combine." Distribution and "the app is one HTML
file" remain unchanged.

## Limitations / next steps

- Top-level decomposition only. Some named slices are still large
  (`UIManager` ~240 KB, `NarrativeController` ~207 KB). A second pass could
  split each controller's methods into sub-slices using the same approach
  recursively.
- The split is run once and slices become source-of-truth. There is no
  automated re-split when `index.html` is edited directly — that workflow is
  intentionally not supported (you'd lose any slice-level edits).
- No HMR; this is a build-artifact pattern, not a dev server.
