# Documentation toolkit acceptance

Tracking: https://github.com/blockedby/explanatory-html-pages-skill/issues/1

Verified locally on Linux x64, Node 24.21.0, prepared Temurin Java 21, PlantUML 1.2026.8 and Playwright Chromium. This records implementation acceptance, not proof of business correctness of the illustrative documents.

## Fresh verification

```sh
npm test
npm run build:examples
npm run test:browser
npm run validate
git diff --check
node scripts/document.mjs doctor
```

Results: **36 unit/renderer/integration tests and 2 browser scenarios passed**, zero skips or failures. All four complete documents built. Python repository/HTML/canonical-asset validation passed. Doctor reported all required local tools available. A second build produced byte-identical SHA-256 hashes for all four generated examples and the standalone reference.

## Acceptance matrix

| Issue item | Evidence | Result |
| --- | --- | --- |
| 1. Theme and shell | Canonical CSS/JS embedded verbatim; drift validator; inspected desktop/mobile screenshots; browser focus, reduced-motion, selection and print checks | Passed |
| 2. Scaffold/build | Create/build from `/tmp`; all three presets in English/Russian; stable Unicode IDs; source/output protection and failure preservation | Passed |
| 3. Explanatory components | Definition, steps, comparison, notes, details, conclusions and native flow snippets built in the catalog | Passed |
| 4. Analysis components | Sixteen optional semantic snippets, including scenarios, scope/actors, rules, criteria, dictionaries, contracts, mapping and AS-IS/TO-BE | Passed |
| 5. PlantUML | Fourteen tests; real Java/Smetana rendering for seven diagram families; syntax/unsafe-input/runtime/size/error-artifact checks | Passed |
| 6. BPMN | Seven real Chromium tests; auto-layout and explicit-DI collaboration/lane/message/timer; unsupported/missing elements diagnosed | Passed |
| 7. Setup/diagnostics | Pinned npm lockfile, verified jar/JRE downloads, explicit setup and offline doctor; builds do not install tools | Passed on tested platform |
| 8. Complete examples | Technical: 5 sections / 1 UML; process: 8 sections / 2 BPMN; integration: 7 sections / 1 UML; catalog: 16 sections | Passed |
| 9. Skill/docs | skills.sh frontmatter, runnable commands, local reference links, canonical implementation in code rather than per-document prose | Passed |
| 10. Verification | Tests above; zero runtime HTTP requests/page errors; local diagram scrolling; malformed inputs, safe SVG, namespace isolation, source downloads | Passed |

## Browser evidence

The browser suite opens built HTML via `file:` with HTTP requests intercepted, uses 1440px desktop and 390px mobile viewports, and separately disables JavaScript for native navigation. It checks final-section tracking, focus transfer, disclosure/Escape, whole-page overflow, reduced-motion scrolling/layout transitions, selection colors, hidden print navigation/source controls and visible print explanation details.

Generated inspection artifacts: `/tmp/documentation-*-desktop.png`, `/tmp/documentation-*-mobile.png`, `/tmp/documentation-selection.png`, and `/tmp/documentation-*.pdf`. These are local verification artifacts, not shipped runtime dependencies. Screenshots were inspected for content hierarchy, readable copy, sidebar clearance, native-flow selection and real UML/BPMN rendering.

Integration checks caught and fixed the standard bpmn-js SVG-header compatibility case, reduced-motion selector specificity, print gutters/source visibility, and semantic figcaption placement. Source files remain editable; generated SVG IDs are isolated and diagram-source downloads require no network.

## Explicit limits

- Automatic bundled JRE setup is Linux x64; other platforms need a local Java executable. Other OS/browser combinations were not exercised here.
- Chromium requires Playwright's supported host libraries; this environment uses headless `--no-sandbox` with renderer network requests blocked.
- Advanced BPMN requires complete explicit DI. Hidden subprocess contents, multiple diagrams and incomplete rendering are rejected.
- PlantUML accepts a conservative safe subset: no includes, preprocessors, external images, custom skins or pagination. Directive-like text in labels/comments may also be rejected.
- A renderer producing valid SVG does not establish business validity or implementation conformance.
- Work is on `feat/document-design-system` in the dedicated linked worktree. No push, delivery merge or deployment was performed.
