---
name: explanatory-html-pages
description: Create polished, offline HTML documentation using a shared design system and local diagram renderers. Use for technical explainers, business analysis, process documentation, integration specifications, visual guides, and printable reference pages.
---

# Explanatory HTML pages

Use the toolkit to scaffold a document, author its content and diagram sources, and build one self-contained HTML file. **Do not recreate the CSS, navigation, page shell or renderer for each document.** This is one skill with reusable internals, not a collection of unrelated templates.

Resolve every path below relative to this skill's directory, wherever it was installed. Node 22.12+ is required at authoring time. The reader needs only a browser.

## Working sequence

1. Choose a useful structure from the user's question. Make reasonable content and notation choices without a compulsory interview or approval round. State consequential assumptions in the document; ask only when missing information prevents a useful result.
2. Prepare local dependencies once, if not already installed:
   ```sh
   node /path/to/skill/scripts/setup.mjs
   node /path/to/skill/scripts/document.mjs doctor
   ```
   Setup downloads pinned tooling; builds do not. For text/native-flow documents, `setup.mjs --npm` is sufficient. For diagrams and platform limitations, read [rendering.md](references/rendering.md).
3. Scaffold in a **new directory**:
   ```sh
   node /path/to/skill/scripts/document.mjs create /path/to/document \
     --title "How order submission works" --lang en --preset integration
   ```
   Presets: `explainer`, `process`, `integration`. Interface languages: `en`, `ru`. The starter is editable example content, not a claim about the user's system. Replace it with the actual explanation.
4. Edit `document.json`, `content.html`, and sources in `diagrams/`. Reuse snippets from `assets/components/`; consult [components.md](references/components.md) and [authoring.md](references/authoring.md). Do not add CSS or scripts to `content.html`.
5. Build and inspect:
   ```sh
   node /path/to/skill/scripts/document.mjs build /path/to/document \
     --out /path/to/document/report.html
   ```
   Open the result locally. Check wide/narrow screens, diagrams, navigation, keyboard focus and print. A successful build verifies structure/rendering, **not business correctness**.
6. Deliver the HTML and keep the source directory available for editing. Each rendered diagram includes an expandable, downloadable source. No server is required to read the result.

Create refuses an existing directory. Build replaces only the explicitly named output, atomically after successful rendering; it must not overwrite source files. Do not bypass errors with hand-authored renderer SVG or remote rendering services.

## Author content, not a document framework

`document.json` contains only `title`, optional `description`, and `lang`. `content.html` is ordinary semantic HTML: top-level sections with `h2` headings, paragraphs, lists, tables and selected components. The builder generates navigation from section headings. Supply stable section IDs when cross-references matter; missing IDs are generated, including Cyrillic headings. Use `data-nav-title` on a section for a shorter navigation label without shortening the visible heading.

The title is the document's one `h1`. Start with the useful idea, not a decorative masthead or metadata block. Do not add audience/read-time/model labels unless specifically relevant. The shared compact monochrome theme controls typography, density, responsive navigation and print. Compact layout is **not** an instruction to shorten the reasoning.

Use the amount of explanation the subject needs:

- Establish the question, boundaries and terminology.
- Explain causal relationships, not only list boxes or steps.
- Trace a concrete scenario, including meaningful alternatives and failures.
- Separate known rules from assumptions and open questions.
- End with the practical consequence or conclusion.

## Choose only the useful components

- **Technical explanation:** definition, native flow or UML sequence, steps, comparison, caveat, optional deep dive, conclusion.
- **Business analysis:** goals and scope, actors, scenarios, rules and decision tables, requirements and acceptance criteria, glossary, assumptions/questions, AS-IS / TO-BE.
- **Integration specification:** ownership, API/event contract, data dictionary, mapping, sequence, errors/retries/idempotency, observable acceptance criteria.

These are options, not mandatory document outlines. A simple concept does not need a requirements matrix; a detailed integration should not be reduced to three attractive cards. Read the ready-built `examples/*.html` and editable sibling directories for complete examples. `examples/component-catalog.html` demonstrates the reusable markup.

## Pick the diagram for the question

Use [notations.md](references/notations.md) for selection guidance.

- Native flow markup: a short linear conceptual path, not a substitute for branching formal notation.
- PlantUML: sequence, state, activity, use-case, component, deployment or entity relationships as appropriate.
- BPMN 2.0 XML: business-process events, tasks, gateways, pools, lanes and message flows. It documents a process; this toolkit does not execute it.

Declare a source-backed figure in content:

```html
<figure data-diagram="plantuml" data-source="diagrams/exchange.puml">
  <figcaption>Explain the relationship and the important exception.</figcaption>
</figure>
```

For BPMN use `data-diagram="bpmn"` and a `.bpmn` source. Paths stay inside the document directory. The builder renders locally, sanitizes and isolates SVG IDs, and embeds the result. Preserve notation semantics; use text to explain what the diagram leaves out. Missing-DI BPMN auto-layout has explicit limits: use supplied DI for advanced models, rather than silently dropping unsupported elements. Never upload private diagram sources to a public service.

## Reuse and maintenance

- `assets/theme.css`, `assets/navigation.js`: canonical shell styling and behavior.
- `assets/components.css`, `assets/components/*.html`: optional component styling and copyable markup.
- `assets/starters/`: source-only presets.
- `scripts/document.mjs`: create/build/doctor entry point.
- `scripts/renderers/`: local rendering and safe embedding.
- `assets/explanatory-page-template.html`: generated standalone reference, **not** a second styling source to fork.

For a document-specific need, first combine existing components and ordinary semantic HTML. Change the shared toolkit only when the design system itself needs a reusable improvement, not as a routine step in producing a page.
