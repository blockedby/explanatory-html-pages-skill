# Explanatory HTML pages

One reusable documentation design-system skill for technical explanations, business analysis, process documentation and integration specifications.

**Scaffold → author content and diagram sources → build offline HTML.** Agents do not need to recreate CSS, navigation or diagrams by hand for each document.

## Install the skill

```sh
npx skills add blockedby/explanatory-html-pages-skill
```

The repository is one skills.sh-compatible skill rooted at `SKILL.md`. Resolve the commands below from the installed skill directory, not from the document workspace.

## Quick start

Authoring needs Node 22.12+. Prepare the local toolkit once:

```sh
node /path/to/skill/scripts/setup.mjs
node /path/to/skill/scripts/document.mjs doctor
```

Then create a source directory and build:

```sh
node /path/to/skill/scripts/document.mjs create ./order-guide \
  --title 'How order acceptance works' --lang en --preset integration

# Edit order-guide/content.html, document.json, and diagrams/*.puml or *.bpmn.

node /path/to/skill/scripts/document.mjs build ./order-guide \
  --out ./order-guide/report.html
```

Open `report.html` directly. It contains its theme, navigation and static SVG, so readers need no server, runtime tooling or internet connection. Editable diagram sources are retained and downloadable from the document.

- Presets: `explainer`, `process`, `integration`.
- Shell languages: English and Russian; content and labels are authored normally.
- Create refuses existing directories. Build requires an explicit output and preserves the previous HTML on failure.
- For text, native-flow and PlantUML documents, `setup.mjs --npm` is sufficient. No Java/JRE is required; only BPMN needs Chromium.

## What is reusable

| Layer | Purpose |
| --- | --- |
| `assets/theme.css`, `assets/navigation.js` | Compact monochrome typography, layout, collapsible desktop topics, mobile disclosure, keyboard/focus, reduced motion and print |
| `assets/components.css`, `assets/components/` | Definitions, steps, comparisons, notes, scenarios, scope, actors, rules, requirements, contracts, mappings and analysis tables |
| `assets/starters/` | Plain semantic HTML and editable diagram sources; no bespoke document DSL |
| `scripts/document.mjs` | Scaffold, validation, generated navigation and atomic standalone build |
| `scripts/renderers/` | Local PlantUML and BPMN rendering plus safe SVG embedding |

Compact presentation does not mean shallow explanation. Components are choices, not a checklist that every document must contain. The skill chooses a useful structure and notation without compulsory interviews or approval gates.

## Complete examples

Each HTML file has a sibling source directory with metadata, content and diagram sources:

- [Technical explainer](examples/technical-explainer.html) — Russian request-boundary explanation, sequence diagram, failure analysis and optional depth.
- [Business process](examples/business-process.html) — expense-review scope, roles, BPMN branching, rules and acceptance criteria.
- [Integration specification](examples/integration-spec.html) — API/event contracts, idempotency, outbox sequence, mapping and recovery.
- [Component catalog](examples/component-catalog.html) — all reusable semantic snippets in the shared shell.

Download or open HTML locally; GitHub's file viewer displays source. `assets/explanatory-page-template.html` is a generated standalone reference, not an alternative CSS source to fork.

## Diagram choices and limits

Use native markup for short conceptual flows, PlantUML for UML/technical relationships, and actual BPMN 2.0 XML for business-process notation. Renderers run locally; private sources are never sent to public diagram services. Finished documents contain static SVG, not client-side modeling libraries.

Simple missing-DI BPMN processes can be auto-laid out. Advanced collaborations, lanes, message flows and subprocesses require complete supplied DI. Unsupported/incomplete rendering fails explicitly instead of silently discarding notation. This toolkit is not a process execution engine and does not certify business correctness.

PlantUML uses the official TeaVM JavaScript engine plus Viz.js WASM in Node workers—no JRE, JAR, native Graphviz or MCP server. Chromium is only needed for BPMN and requires a Playwright-supported platform and system libraries. Builds never install or download dependencies implicitly. See [rendering and troubleshooting](references/rendering.md).

## Authoring references

- [Authoring contract and workflow](references/authoring.md)
- [Component selection and snippets](references/components.md)
- [Notation selection](references/notations.md)
- [Local rendering, security and limitations](references/rendering.md)

## Development and verification

```sh
npm run setup
npm test
npm run build:examples
npm run test:browser
npm run validate
git diff --check
```

Unit/integration tests cover scaffold safety, metadata, Unicode IDs, source paths, atomic output, SVG isolation, real PlantUML/BPMN rendering and renderer failures. Browser tests open built files offline, check desktop/mobile navigation, keyboard focus, overflow and print, and write screenshots/PDFs under `/tmp`. Python validation checks skill packaging, HTML structure and drift from canonical assets without installing another Python dependency.

Change the canonical assets or component snippets, then run `npm run build:examples`. Do not patch generated HTML to fix a theme issue.

## License

MIT for this repository. PlantUML, Viz.js, Chromium and npm dependencies retain their respective upstream licenses; dependencies are installed locally, not redistributed in this repository. Final exported diagrams do not include the renderer programs.
