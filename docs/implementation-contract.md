# Implementation contract — issue #1

Tracking: https://github.com/blockedby/explanatory-html-pages-skill/issues/1
Worktree: `/home/kcnc/code/skills/explanatory-html-pages-design-system`, branch `feat/document-design-system`.
Pipeline cancelled at user request. Direct Astra workers only; parent integrates, tests and makes atomic commits. Never commit/push from workers. Do not edit another owner's files.

## Architecture

One skill. Authoring is plain semantic HTML, not a custom document language. `node scripts/document.mjs create <directory> --title <title> --lang ru|en --preset explainer|process|integration` creates `document.json`, `content.html`, `diagrams/`. `document.json` has `{ "title": string, "description": string, "lang": "ru"|"en" }`. Source `content.html` consists of optional introduction paragraphs followed by top-level sections with h2 headings. No document shell, CSS, scripts, h1, nav or manual TOC. Content includes ordinary component classes.

Figure source syntax:
```html
<figure data-diagram="plantuml" data-source="diagrams/exchange.puml">
  <figcaption>Request and response, including the rejection path.</figcaption>
</figure>
```
Same for `data-diagram="bpmn"`, `.bpmn` XML. Source path must remain within document workspace. Builder renders, sanitizes and namespaces SVG, adds local diagram scroll wrapper and expandable escaped source. User's .puml/.bpmn sources remain editable. No public server or runtime downloads.

Build: `node scripts/document.mjs build <directory> --out <report.html>`. Core reads canonical `assets/theme.css`, `assets/navigation.js`, creates shell/nav/h1, builds figures, validates content and writes atomically. Scaffold and build resolve assets from installed skill directory, not cwd. Source files and output must not collide. Output standalone/offline. Generated reference `assets/explanatory-page-template.html` stays available; parent will regenerate from canonical sources. Shared manifest/package scripts and Python validator are parent-owned.

## Ownership and contracts

### Theme worker
Files: `assets/theme.css`, `assets/navigation.js` only. Extract approved template styles/behavior; consolidate redundant roomy/compact overrides into a compact default. Root `body`/`.reading-pane`, `.page`, `.site-header`, `.utility-row`, `.eyebrow`, `.eyebrow-mark`, `.masthead-grid`, `.lead`, `.site-footer` classes remain supported. Existing definition/steps/diagram/etc classes remain usable. No At-a-glance/Request decorative column/issue label/oversized hero. Main section max measure/spacing approved. Theme handles any direct `main > section` and main intro wrapper `.document-intro` without requiring agents to add `.page` around every section. Parent shell uses `<main id="main-content" class="page document-content">` and direct `<section>`; avoid doubled .page width. Legacy nested .page supported for standalone template conversion.

Navigation contract: native `<details id="topic-panel" class="topic-panel" open><summary class="topic-toggle" aria-controls="topic-links"><span class="topic-icon">[inline SVG]</span><span class="topic-label">localized Topics</span><span class="topic-close">[inline SVG]</span></summary><nav id="topic-links" class="toc" aria-label="..."><p class="topic-caption">...</p><ul><li><a href="#id"><span class="toc-number">01</span><span>Title</span></a></li>...</ul></nav></details>`. Summary `data-open-label`, `data-close-label` supplied by shell. No hardcoded English text in JS. Desktop >=80rem expanded ~15.5rem, collapsed rail; mobile initially closed disclosure, anchors work without JS, Escape, link focus, desktop preference, current-section marker including final section at bottom. `.diagram-viewport` handles local scrolling (not page overflow), keyboard-focusable markup parent supplied. `figure.diagram-rendered`, `.diagram-source`, inline SVG responsive without illegible squeezing; print relevant. Reduced motion, selection on dark surfaces.

### Component worker
Files: `assets/components.css`, `assets/components/*.html`, `references/components.md`, `references/notations.md` only. Add optional component classes/snippets not covered by theme. Scoped CSS, token reuse, not duplicate .toc/layout or existing canonical classes. Components: scenario/main/alternatives, goals/scope/actors, business rules/decision table, requirements/acceptance criteria, glossary/data dictionary, API/event contract, mapping, assumptions/questions, AS-IS/TO-BE; plus snippets for existing explanatory definition/steps/notes/comparison/details/conclusions/native flows. Real useful content, semantic headings/tables, no author tokens in snippets. Document snippet selection and copying into content.html. Reference notation advice recommends PlantUML, BPMN, native simple flow and diagram figure syntax above; no approval gates or claims of logical proof. The snippets become parent-built component catalog.

### PlantUML worker
Files: `scripts/renderers/plantuml.mjs`, `tests/plantuml.test.mjs`, `tests/fixtures/plantuml/*` only.
Export `async function renderPlantUml(source, options = {})` -> `{ svg: string, source: string, extension: 'puml', warnings: string[] }`.
Options `{ toolkitRoot?: string, timeoutMs?: number }` defaults root from module path (`../../`); bounded source/output/runtime. Runtime default `.tools/jre/bin/java`, JAR `.tools/plantuml.jar`; permit explicit `JAVA_BIN`, `PLANTUML_JAR` overrides. No system Graphviz; bundled Smetana where applicable. Pinned local tooling exists. Shared compact monochrome style. Raw source retained; reject remote/local includes or unsupported unsafe preprocessors rather than reading/network. Java sandbox and pipe input, no shell interpolation. Real tests for requested types and errors. Returned SVG is raw; parent calls central sanitizer. No new deps/manifests or core builder edits.

### BPMN worker
Files: `scripts/renderers/bpmn.mjs`, `tests/bpmn.test.mjs`, `tests/fixtures/bpmn/*` only.
Export `async function renderBpmn(source, options = {})` -> `{ svg: string, source: string, extension: 'bpmn', warnings: string[] }`.
Options same. Prefer returning laid-out XML as source when DI added, so retained downloadable source is editable with layout; indicate warning. bpmn-js and bpmn-auto-layout ready. Chromium under `.tools/ms-playwright` (playwright 1.63.0); configure local runtime path without internet. Browser local blank page, no remote requests. Reject malformed XML/DOCTYPE/entities, meaningful import failures, unrendered/unlaid elements. Supported missing-DI processes autolayout; collaborations/lanes unsupported by auto-layout must be explicit actionable failures or supplied-DI examples, not silently dropped. Provide real fixtures for happy simple autolayout and advanced explicit-DI collaboration/lane/message/timer where library supports. Monochrome style preserving notation meaning. Returned SVG raw; parent sanitizes. Existing deps may be used; no manifest/core edits.

### SVG worker
Files: `scripts/renderers/svg.mjs`, `tests/svg.test.mjs` only.
Export `function prepareSvg(rawSvg, { prefix, title })` -> safe namespaced SVG string (or throw). Use installed jsdom/DOMPurify or appropriate parsed allowlist. Preserve rendered PlantUML/BPMN labels/arrows, viewBox, dimensions for readable wrapper, title/accessible labeling. Reject malformed/not-SVG or renderer error artifacts where detectable. Remove scripts, event attributes, foreignObject, external resource references, unsafe CSS/URLs; reject unsupported unsafe output instead of silently claiming diagram survived if critical content lost. Namespace all IDs and matching local href/url() references to avoid collisions. No remote/data image/script/font assets, XML entity expansion/DOCTYPE. Test safety and normal marker/text/defs cases. No other files.

### Parent
Owns `scripts/document.mjs`, `scripts/lib/*`, setup/doctor scripts, package manifests, shell assembly, scaffold starters, `examples/*`, build/unit/browser tests outside above worker files, README, SKILL.md, Python validator, issue updates and all commits.

## Prepared tooling
Node24; pinned deps in package.json/lock. Java `.tools/jre/bin/java`, JAR `.tools/plantuml.jar`; browser root `.tools/ms-playwright` and tested Chromium `.tools/ms-playwright/chromium-1243/chrome-linux64/chrome`. Host requires `--no-sandbox` for local Chromium. Renderer tests must use temporary local files or memory and block network. Pin details in parent issue. No binaries or node_modules committed.

## Verification/handoff
Workers run focused tests and report conclusion first, changed files, commands/results, limitations, recommended next step. No Git commits or issue operations. Main integrates and verifies three complete documents plus catalog offline/desktop/mobile/print and records evidence/commits in issue #1. Never mark business correctness proven; syntax/rendering checks suffice.
