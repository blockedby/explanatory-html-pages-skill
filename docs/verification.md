# Documentation toolkit acceptance

Tracking: https://github.com/blockedby/explanatory-html-pages-skill/issues/1

Verified on Linux x64 with Node 24.21.0. Builds use npm dependencies only: PlantUML TeaVM/Viz.js in Node, BPMN XML/DI preparation in Node, and embedded bpmn-js/DOMPurify in the reader. Neither Java nor Chromium is a build requirement. Chromium was used only as an optional development tool to test the ordinary reader-browser path. This is implementation acceptance, not proof of business correctness.

## Local raster image embedding

Added source-authored PNG/JPEG/WebP images as ordinary `img`/`figure` markup. Builds embed original bytes as correctly typed data URLs, retain editable files, require explicit alt text, add intrinsic dimensions and use the shared responsive canvas without cropping. No new production dependencies or reader JavaScript are required for images.

Per user request, all toolkit-imposed raster image byte, resolution and cumulative limits have been removed. Fresh acceptance: **64 unit/renderer/integration tests and 12 browser scenarios passed**, zero failures/skips; example/template builds, repository validation and diff checks passed. Coverage includes exact byte retention, format/header checks, Unicode paths, confined/escaping symlinks, unsupported/remote sources, malformed files and atomic failure. Regression tests accept files over the former 8 MiB cap and document totals above 32 MiB; header-level fixtures verify that the former resolution and cumulative pixel caps no longer apply. Ordinary source files retain their 2 MiB default limit. PNG/JPEG/WebP created by a real browser decoded after their external source files were removed, offline at 1440/768/390px, with reader JavaScript both enabled and disabled; print visibility was checked.

Built `/home/kcnc/code/local-images-example/report.html` through the canonical scaffold/build path, using `/tmp/pipi-pipelines-refined-desktop.png` copied into its retained `images/` directory. Its independent browser probe verified the embedded 1440×1000 PNG, shared left alignment, aspect ratio, no page overflow, no HTTP requests/page errors and print-to-PDF. Inspected desktop/mobile screenshots in its `checks/` directory. This local demonstration image is not added to the public repository.

The image gate validates format structure/headers, not full compressed pixel data or PNG CRCs; metadata/EXIF is preserved. Animated/multiframe formats are rejected. Existing diagram rendering and safety boundaries are unchanged. Browser checks used disposable Playwright Chromium; the configured browser MCP launcher referenced a missing local skill path and was not used.

## Documentation spacing and integrated rendering verification

Added 20px content-block gaps, 28–32px section/subheading breaks, light neutral table headers and thin separators without changing shared widths or inline-callout behavior. Fresh integration: **46 unit/renderer tests and 11 browser scenarios passed**, zero failures/skips; rebuilt all examples/template and both delivered reports, then passed repository validation and diff checks. Geometry tests cover 1920/1440/768/390px and both sidebar states, including actual header/introduction and table/prose gaps.

Repeated the pipelines guide's browser and detail probes successfully (desktop/mobile, offline, eight SVGs, source disclosure, keyboard scrolling, anchors and print smoke). Inspected its fresh `checks/desktop-top.png` and `checks/audit-desktop.png`: updated block spacing and lighter tables are visible; the simplified audit sequence has visible lifelines and neutral notes. Guide text retains the omitted validation/termination details. Rendering safety is not weakened by the style fix.

## Sequence lifeline rendering follow-up

The TeaVM engine emitted lifeline geometry without a stroke, leaving sequence participants visually disconnected. A renderer-owned PlantUML style now explicitly supplies the dashed dark stroke; note backgrounds are explicitly neutral instead of the engine's yellow default. Authored style overrides remain prohibited, and sanitizer/worker/network controls are unchanged.

Worker full-suite verification passed 46 tests. Parent freshly ran `node --test tests/plantuml.test.mjs tests/svg.test.mjs`: **22 passed**, none failed or skipped. The new regression checks lifeline geometry and explicit paint both before and after SVG sanitation, plus monochrome note fill. Generated document refresh is verified separately with the spacing changes below.

## Shared section-width follow-up

Removed independent prose/callout width caps: the bounded responsive `.page` now owns the common canvas for prose, lists, fact blocks, tables and diagrams. This supersedes the separate 76ch fact/callout measure in the preceding natural-flow fix; inline-flow safety remains unchanged.

Worker verification passed 45 unit tests and 11 browser scenarios. Parent rebuilt all examples/template plus both delivered documents (`skills-overview` and `pipi-pipelines-guide`), then freshly passed all 11 browser scenarios, repository validation and diff checks. Geometry regression covers 1920/1440/768/390px with sidebar open/closed. A separate actual-report probe measured the execution section and following paragraph at 1152px each, left-edge delta 0; inspected `/tmp/pipi-width-fixed-desktop.png`. An initial probe had an ambiguous locator because the section contains two figures; selecting the first paragraph fixed the probe without changing document code.

## Natural-flow layout regression verification

Fixed the catalog's empty definition column, fragmented inline note, boxed technical heading and mismatched fact/prose widths in canonical CSS. Natural-flow callouts remain compact; supported structured components keep responsive columns. A paragraph-only note explicitly stays in natural flow.

Fresh `npm test` passed **45 tests** and `npm run test:browser` passed **11 scenarios**, with no failures or skips. The new geometry regression exercises 1920, 1440, 768 and 390px widths with sidebar open/closed states, inline text order, one-paragraph notes, short definitions, single-child takeaways, structured variants, heading wrapping and full-width data tables. Example/template builds, repository validation and `git diff --check` passed.

Rebuilt `/home/kcnc/code/skills-overview/report.html` from unchanged source content. Independently checked the actual catalog at 1440 and 390px: no page overflow, HTTP requests or page errors; inline notes use block flow. Captured six section screenshots under `/tmp/catalog-fixed-*.png`; inspected desktop definition/verification sections and mobile verification section. These checks cover the reported rendered defects rather than treating absence of overflow alone as visual acceptance.

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
