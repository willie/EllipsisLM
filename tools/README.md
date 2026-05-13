# Deterministic split / combine prototype

Goal: edit `index.html` in modular pieces, but treat the single file as the
distributed artifact. `combine(split(index.html)) == index.html`, byte-for-byte.

## The property

- `split.js` partitions `index.html` into a sequence of slices. Every byte of
  the input lives in exactly one slice (after wrapper-stripping). Top-level
  JavaScript declarations inside each inline `<script>` block become their own
  named slice (`.js`, with an editor-friendly wrapper); everything else — HTML,
  CSS, inter-statement whitespace, JSDoc blocks, the script-tag wrappers
  themselves — becomes an unnamed gap slice (`.slice`, verbatim, no wrapper).
  No code is regenerated.

- `combine.js` reads `slices/manifest.txt`, strips the wrapper region from each
  named slice, and concatenates the result. The wrapper region is delimited by
  the sentinel comments `//@ellipsis-wrap-begin` and `//@ellipsis-wrap-end`;
  `split.js` aborts if either sentinel appears anywhere in `index.html`.

- Round-trip is identity *by construction* outside the wrapper regions.
  Whitespace, CRLF endings, quote styles, comment formatting, multi-byte UTF-8
  in comments — all preserved, because the original substring inside each
  slice is never reformatted, only sliced and re-glued. `combine.js` verifies
  the recombined sha256 against `slices/source.sha256` and exits non-zero on
  mismatch (the CI signal).

## What the wrapper does

Each named slice opens like this:

```js
//@ellipsis-wrap-begin
/* eslint-disable no-var, no-unused-vars */
/* Declarations of sibling-slice identifiers — stripped at combine time. */
/** @type {*} */ var
    APP_BUILD_TIMESTAMP, DOM, ActionHandler, debounce, DBService,
    ImageGenerationService, StoryService, StateManager, TTSService,
    /* … 22 more names … */
    app;
//@ellipsis-wrap-end
const APIService = {
    // … original verbatim …
};
```

The wrapper declares every sibling-slice binding (everything declared in any
other named slice) as `var` with JSDoc `@type {*}`. That makes the slice file
syntactically self-contained: `acorn` parses it as a clean script, and
editors / linters / LSPs stop flagging `ReactiveStore.state` and similar
cross-controller references as undefined. The wrapper contributes zero bytes
to the combined output — `combine.js` matches the sentinel pair and removes
everything between them, including the trailing newline after `wrap-end`.

The wrapper does not make the slice runnable as a Node module — the `var`s
are placeholders, not real bindings. Methods on the controller still need the
combined `index.html` to actually call cross-controller code. The wrapper is
for editor / LLM ergonomics: open one slice, edit it, the file looks like
correct JS at rest. Runnability would require a heavier wrapper that loads
sibling slices and installs them on `globalThis`; not implemented here.

## Usage

```
npm install                       # one-time, installs acorn (dev dep)
node tools/split.js               # writes slices/ (32 .js + 59 .slice)
node tools/combine.js             # writes out/index.html and verifies hash
shasum -a 256 index.html out/index.html
```

Edit a named slice (e.g. `slices/42-APIService.js`) → re-run `combine.js` →
the resulting `out/index.html` differs from the original at exactly the edited
bytes. The combine script reports `ROUND-TRIP MISMATCH` and exits non-zero,
which is correct: the slices are now the source of truth, the original is
stale, and `out/index.html` is what you'd commit.

To regenerate slices from a freshly modified `index.html`, just re-run
`split.js` — it always wipes `slices/` first.

## File layout

- `slices/NN-Name.js` — a wrapped, editor-friendly file holding exactly one
  top-level JS declaration (`const Foo = …`, `function Bar() {…}`, or
  `class Baz {…}`).
- `slices/NN.slice` — a raw byte-literal slice with no wrapper. Holds HTML,
  CSS, inter-declaration whitespace, JSDoc comments, the `<script>` tag
  wrappers, and top-level expression statements like
  `document.addEventListener(…)`.
- `slices/manifest.txt` — ordered list of slice filenames. `combine.js` reads
  this and only this for ordering.
- `slices/source.sha256` — snapshot of `index.html`'s sha256 at split time;
  `combine.js` checks the rebuilt output against this and uses the diff as
  the CI signal.

## Why this exists

`index.html` is ~23k lines and ~1.6 MB. Asking an LLM to edit it means
loading the whole file into context, but real edits usually touch one
controller (`NarrativeController`, `PromptBuilder`, `APIService`, etc.) that's
a small fraction of the file. With this split, an edit to the Scriptwriter
prompt becomes "open `slices/78-NarrativeController.js` (~3000 lines), edit
it, re-combine." Distribution and "the app is one HTML file" remain unchanged.

## Limitations / next steps

- Top-level decomposition only. Some named slices are still large
  (`UIManager` ~240 KB, `NarrativeController` ~207 KB). A second pass could
  split each controller's methods into sub-slices using the same approach.
- The wrapper is declarations-only (Flavor A). Standalone Node-module loading
  (Flavor B) would require generating a `_stubs.js` that lazily resolves
  cross-controller names, plus per-slice `globalThis` registration. Doable;
  not done because most realistic testing happens in the combined file anyway.
- No HMR. This is a build-artifact pattern, not a dev server.
