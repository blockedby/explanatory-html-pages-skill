# Documentation toolkit acceptance

Tracking: https://github.com/blockedby/explanatory-html-pages-skill/issues/1

Verified on Linux x64 with Node 24.21.0. Builds use npm dependencies only: PlantUML TeaVM/Viz.js in Node, BPMN XML/DI preparation in Node, and embedded bpmn-js/DOMPurify in the reader. Neither Java nor Chromium is a build requirement. Chromium was used only as an optional development tool to test the ordinary reader-browser path. This is implementation acceptance, not proof of business correctness.

## DOM helper follow-up verification

The private figure-construction helper preserves text-safe DOM insertion and the existing sanitized PlantUML SVG path. Fresh `npm test` passed **45 tests** and `npm run test:browser` passed **10 scenarios**, with zero failures or skips. The new EN/RU regression covers escaping, retained/downloaded source equality, serialization, IDs, accessibility, no-JS markup and caption position.

After `npm run build:examples`, SHA-256 checks against the pre-refactor baseline matched all four example HTML files and the standalone template byte-for-byte. `npm run validate` and `git diff --check` passed. The builder shrank from 132 to 128 lines; tests add coverage, so this is a local readability improvement, not a net repository-size reduction or a measured model-speed improvement. Incremental source editing is documented in `references/authoring.md`.

## Browser-free migration verification

```sh
npm test
npm run build:examples
npm run test:browser
npm run validate
npm run doctor
git diff --check
```

**44 unit/renderer/integration tests and 10 browser scenarios passed**, zero failures or skips. All four documents and the canonical reference built. Repository/HTML/asset validation and doctor passed. Repeated builds produced identical hashes.

### Production-only installation proof

In a fresh temporary toolkit copy (`/tmp/bpmn-reader-production-lEJLP7`), default `node scripts/setup.mjs` installed production npm dependencies only. Confirmed absent: `node_modules/playwright`, `node_modules/playwright-core`, `.tools` (no downloaded browser/JRE).

With `PATH=/nonexistent` and Java/JAR/Chromium/cache overrides pointing to missing paths, the absolute Node executable successfully ran doctor, all four example builds, and **17 preparation/build/tooling tests**. No Playwright package/cache was installed; executable search PATH and browser overrides could not resolve a browser. The remaining local Chromium cache in the development worktree is optional test tooling, not shipped or required by the authoring workflow.

## Acceptance matrix

| Requirement | Evidence | Result |
| --- | --- | --- |
| Browser-free authoring | Fresh default setup and production-only builds described above; Playwright is a devDependency | Passed |
| BPMN source/DI safety | Ten preparation tests: XML limits, malformed references, geometry, complete DI, subprocess coverage, cancellable auto-layout, source preservation, no resource requests | Passed |
| Reader-side BPMN | Built process document renders both auto-layout and explicit-DI pool/lane/message/timer diagrams via embedded assets | Passed |
| Offline HTML | `file:` document tests intercept HTTP; no network requests/page errors; no CDN or source fetch | Passed |
| Loading/error/no-JS | Localized status and error text, visible print feedback, no-JS explanation, retained source/downloads | Passed |
| SVG safety/isolation | Active-resource stripping, inert source/script terminators, marker references isolated across duplicates, XML declarations/size limits; BPMN script-task bodies never execute | Passed |
| Theme/navigation | Canonical assets, desktop/mobile keyboard/focus/Escape, final-section marker, reduced motion, selection, overflow | Passed |
| Print | Ready diagrams visible; pending/error messages visible; navigation/source controls hidden; explanatory disclosures included | Passed |
| Upstream attribution | Embedded license notices; original bpmn.io watermark retained and visibly outside diagram geometry | Passed |
| PlantUML | Sixteen real JS/WASM renderer tests including all seven notation families; no Java fallback | Passed |
| Scaffold/content/output | Localized presets, Unicode IDs, metadata, safe paths, atomic output, source preservation | Passed |
| Examples | Technical: 5 sections / 1 UML; process: 8 sections / 2 BPMN; integration: 7 sections / 1 UML; catalog: 16 sections | Passed |

The process HTML is approximately 310 KB in this build, including both diagrams, their editable sources and the embedded viewer/sanitizer. Documents without BPMN do not include those bundles.

## Browser evidence

Fresh desktop/mobile screenshots were inspected: `/tmp/documentation-business-process-desktop.png` and `/tmp/documentation-business-process-mobile.png`. All four documents have `/tmp/documentation-*-desktop.png`, `/tmp/documentation-*-mobile.png` and `/tmp/documentation-*.pdf` artifacts. Diagram overflow is local rather than shrinking labels; bpmn.io attribution remains visible.

Browser acceptance uses 1440px desktop and 390px mobile viewports, reduced motion, blocked HTTP, and a separate no-JavaScript context. It awaits `window.bpmnDiagramsReady` before asserting successful BPMN rendering or exporting PDFs. These artifacts and Chromium are development evidence, not reader dependencies.

## Explicit limits

- BPMN visuals require JavaScript in the reader browser. Without it, explanatory content and downloadable source remain, but there is no pre-rendered BPMN image fallback. PlantUML remains static SVG.
- Native Ctrl+P cannot await asynchronous rendering; wait until diagrams appear. Pending/error text is printed rather than an unexplained blank. Automated exports should await readiness and check every result's `ok`.
- Reader timeout handles asynchronous delays but cannot interrupt synchronous main-thread work. Source/element/SVG caps reduce this risk; Node preparation and PlantUML workers have cancellable deadlines. Heap/WASM growth caps are not an OS-level RSS ceiling.
- Other OS/browser combinations were not exercised; reader verification here used Chromium. Browser-test tooling requires supported host libraries and uses `--no-sandbox` on this host.
- Advanced BPMN needs complete explicit DI. Hidden subprocess contents, incomplete diagrams and unsupported auto-layout constructs are rejected.
- PlantUML's conservative safe subset excludes includes, preprocessors, resource loading, custom skins and pagination.
- A valid rendering does not establish that a business model or implementation is correct.
- Changes remain on `feat/document-design-system`. No push, merge or deployment was performed.
