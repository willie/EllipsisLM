# Deterministic split / combine prototype

Goal: edit `index.html` in modular pieces, but treat the single file as the
distributed artifact. `combine(split(index.html)) == index.html`, byte-for-byte.

## The property

- `split.js` partitions `index.html` into a sequence of slices. Every byte of
  the input lives in exactly one slice (after wrapper-stripping). Top-level
  JavaScript declarations inside each inline `<script>` block become their own
  named slice (`.js`, wrapped to be loadable as a Node module); everything
  else — HTML, CSS, inter-statement whitespace, JSDoc blocks, the script-tag
  wrappers themselves, and top-level expression statements like
  `document.addEventListener(…)` — becomes an unnamed gap slice (`.slice`,
  verbatim, no wrapper). No code is regenerated.

- `combine.js` reads `slices/manifest.txt`, strips every wrapper region from
  each named slice, and concatenates the result. Wrapper regions are delimited
  by the sentinel comments `//@ellipsis-wrap-begin` and `//@ellipsis-wrap-end`;
  `split.js` aborts if either sentinel appears in `index.html`.

- Round-trip is identity *by construction* outside the wrapper regions.
  Whitespace, CRLF endings, quote styles, comment formatting, multi-byte UTF-8
  — all preserved. `combine.js` verifies the recombined sha256 against
  `slices/source.sha256` and exits non-zero on mismatch (the CI signal).

## What the wrappers do (Flavor B)

Each named slice is a real Node module:

```js
//@ellipsis-wrap-begin
{
    const _stubs = require('./_stubs.js');
    const _siblings = [ "DOM", "DBService", "StateManager", /* … 28 more … */ ];
    for (const _k of _siblings) {
        if (_k in globalThis) continue;
        Object.defineProperty(globalThis, _k, {
            configurable: true,
            get() { return _stubs[_k]; },
            set(v) { Object.defineProperty(globalThis, _k, { value: v, writable: true, configurable: true, enumerable: true }); },
        });
    }
}
//@ellipsis-wrap-end
const APIService = {
    // … original verbatim …
};//@ellipsis-wrap-begin
if (typeof globalThis !== 'undefined') globalThis.APIService = APIService;
if (typeof module !== 'undefined') module.exports = { APIService };
//@ellipsis-wrap-end
```

`require('./42-APIService.js')` returns `{ APIService }`. Cross-controller
references (`ReactiveStore.state`, `StateManager.getState()`, etc.) inside
the controller's methods resolve at call time through `globalThis` getters
that lazily `require()` the owning slice via the generated `_stubs.js`. The
setter on each descriptor reassigns the property as a plain data property the
first time the owning slice publishes itself, so subsequent access skips the
resolver chain.

The combine step strips every wrapper region, so all of this contributes
exactly zero bytes to `index.html`. `out/index.html` is byte-identical to the
source.

### What works

- Loading a single slice (`require('./slices/42-APIService.js')`) returns the
  controller as an object with all its methods present.
- Touching a sibling on `globalThis` (e.g. `globalThis.NarrativeController`)
  after loading any one slice triggers a lazy require chain that resolves
  the whole graph on demand.
- Loading all 32 named slices and then accessing
  `globalThis.NarrativeController.determineNextSpeaker` yields a function.

### Browser-globals stubs

`slices/_browser-stubs.js` (generated, required by `_stubs.js`) installs
minimal stand-ins for the browser environment so controller methods can be
invoked from Node for smoke-testing:

- `window` → `globalThis`
- `document` — `getElementById`, `querySelector(All)`, `createElement`, `body`,
  `head`, etc. return stub elements with no-op `classList`, pass-through `style`,
  empty children, and silent event listeners.
- `localStorage`, `sessionStorage` — in-memory `Map`-backed. **Force-installed**
  because Node 25+ ships a half-wired experimental version that emits warnings
  and lacks `getItem` without `--localstorage-file`.
- `navigator` — userAgent, clipboard, language, onLine (only if Node hasn't
  already provided one).
- `requestAnimationFrame` / `cancelAnimationFrame` — `setTimeout`-backed.
- `Audio`, `Image` — placeholder classes with no-op methods.

What this buys you is **pure-function invocation in Node**. The parsers,
formatters, and helpers in `UTILITY` (`extractStructuredHeadings`,
`extractDelimitedList`, `parseLoreTrigger`, `uuid`, `escapeRegExp`,
`stripThinking`, etc.) now run as-is from any slice. Anything that touches
DOM state, IndexedDB, the network, or real browser semantics will run far
enough to need real data — at which point you should test in the combined
file or under a real browser-env shim (JSDOM, happy-dom, fake-indexeddb).

IndexedDB is deliberately not stubbed: a silent no-op persistence layer is
worse than a loud failure.

### What doesn't work, and why

- **Methods that need real DOM state, real IndexedDB, or live network.** The
  stubs let methods *start* without immediately ReferenceError-ing on
  `document` / `localStorage` / etc.; methods that go deeper into those
  systems will fail loudly. For behaviour testing, use the combined file in
  a browser or Electron.
- **Circular references at module load time.** Node returns partial exports
  for a module that's mid-loading. EllipsisLM's controllers reference
  siblings only in method bodies (not at the top of their own object
  literal), so this doesn't bite in practice. If you write code that
  references a sibling at slice load time, you might get `undefined`.

## Usage

```
npm install                       # one-time, installs acorn (dev dep)
node tools/split.js               # writes slices/ (32 .js + 59 .slice + _stubs.js)
node tools/combine.js             # writes out/index.html and verifies hash
shasum -a 256 index.html out/index.html
```

Edit a named slice (e.g. `slices/42-APIService.js`) → re-run `combine.js` →
the resulting `out/index.html` differs from the original at exactly the edited
bytes. The combine script reports `ROUND-TRIP MISMATCH` and exits non-zero —
that's correct: the slices are now the source of truth, the original is
stale, and `out/index.html` is what you'd commit.

To regenerate slices from a freshly modified `index.html`, re-run `split.js`
— it always wipes `slices/` first.

## File layout

- `slices/NN-Name.js` — wrapped, editor-friendly, Node-loadable file holding
  exactly one top-level JS declaration.
- `slices/NN.slice` — raw byte-literal slice with no wrapper. Holds HTML,
  CSS, inter-declaration whitespace, JSDoc comments, the `<script>` tag
  wrappers, top-level expression statements (IIFEs etc.).
- `slices/_stubs.js` — generated lazy resolver mapping every binding name to
  the slice file that defines it. Required by each named slice's header.
  Not in the manifest; not part of the rebuilt `index.html`.
- `slices/_browser-stubs.js` — generated browser-globals shim (`document`,
  `localStorage`, etc.). Required by `_stubs.js`, so every named slice picks
  it up automatically. Not in the manifest; not part of `index.html`.
- `slices/manifest.txt` — ordered list of slice filenames. `combine.js` reads
  this and only this for ordering.
- `slices/source.sha256` — snapshot of `index.html`'s sha256 at split time;
  `combine.js` uses the diff against this as the CI signal.

## Why this exists

`index.html` is ~23k lines and ~1.6 MB. Asking an LLM to edit it means
loading the whole file into context, but real edits usually touch one
controller (`NarrativeController`, `PromptBuilder`, `APIService`, etc.)
that's a small fraction of the file. With this split, an edit to the
Scriptwriter prompt becomes "open `slices/78-NarrativeController.js` (~3000
lines), edit it, re-combine." Distribution and "the app is one HTML file"
remain unchanged.

## Limitations / next steps

- Top-level decomposition only. Some named slices are still large
  (`UIManager` ~240 KB, `NarrativeController` ~207 KB). A second pass could
  split each controller's methods into sub-slices using the same approach.
- The wrappers don't supply browser-environment stubs (`window`, `document`,
  `localStorage`, etc.). A slice loads fine in Node but its methods can't be
  executed there without an external stub layer (JSDOM, happy-dom, or
  hand-written shims). Not needed for the LLM-editing workflow this prototype
  targets.
- No HMR. This is a build-artifact pattern, not a dev server.
