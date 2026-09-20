# Authoring a document

## Files and commands

Run the entry point by its installed absolute path. It resolves its own assets; your current directory does not have to be the skill directory.

```sh
node /path/to/skill/scripts/document.mjs create ./order-guide --title 'Order guide' --lang en
node /path/to/skill/scripts/document.mjs build ./order-guide --out ./order-guide/report.html
```

Create requires a new directory with an existing parent. It will not merge with, clear or overwrite existing work. Build accepts only an explicit `.html` output and writes atomically: a render failure leaves the previous output unchanged. Source symlinks may resolve within the document workspace, never outside it. Output symlinks are refused.

`document.json`:

```json
{
  "title": "Order guide",
  "description": "How acceptance differs from fulfilment.",
  "lang": "en"
}
```

Only these keys are accepted. `lang` is `en` or `ru`; the document shell and diagram-source controls are localized. Diagram labels are authored in the source, not automatically translated. Description is optional and shown under the title.

`content.html`:

```html
<section id="acceptance" data-nav-title="Acceptance">
  <h2>Acceptance is not a shipping confirmation</h2>
  <p>The service records an order before warehouse work starts.</p>
</section>
<section id="delivery">
  <h2>Delivery has a separate owner</h2>
  <p>A later event tells the warehouse that an accepted order is ready.</p>
</section>
```

Navigation is generated from top-level sections. Stable author-supplied IDs survive edits; absent IDs are generated from headings, with suffixes for repeated headings. Cyrillic is supported. Duplicate/reserved IDs and broken local anchors are errors. Keep IDs meaningful; do not manually number navigation entries.

No `html`, `head`, `body`, `h1`, page navigation, CSS, scripts, images or remote resources belong in source content. The supported semantic vocabulary includes paragraphs, sections/articles/asides, headings h2–h6, lists, definition lists, tables, code/pre, links, figures and native details/summary. Components use these same elements. Use `.puml` and `.bpmn` sources for rendered diagrams, not opaque image exports.

## Revising an existing document

Keep the editable source directory alongside the delivered HTML. A follow-up such as “add a warning after this table”, “replace this block” or “remove this section” is a source edit followed by the same build command—not a new scaffold or a rewrite of the finished HTML.

| Requested change | Edit |
| --- | --- |
| Add, replace, remove or reorder a content block | The relevant part of `content.html` |
| Change a diagram | Its referenced file in `diagrams/`; update the caption if needed |
| Change document title, description or language | `document.json` (translate authored content separately) |
| Change appearance | Prefer existing component classes; change canonical assets only for an intentional shared design-system change |

Use the agent's normal search/read/edit tools: locate the section by heading or stable ID, read that section and necessary surrounding context, make a targeted replacement, and rebuild. Read only the relevant component snippet when adding a component. Routine content edits do not require reading the builder, theme, or generated HTML's embedded libraries into model context. The builder's private DOM helper is an implementation detail, not an authoring API or a new document language.

Preserve explicit section IDs when changing wording so existing links still work. When deleting a section, also update references to it and any explanation that depends on it. Navigation is regenerated automatically. Do not automatically delete a diagram source just because one figure was removed; another figure may use it.

```sh
node /path/to/skill/scripts/document.mjs build ./order-guide --out ./order-guide/report.html
```

Inspect the changed region in the resulting page; also check affected anchors, narrow layout and printing when relevant. BPMN must finish reader-side rendering before print verification. Do not patch `report.html` or an in-browser DOM as the source of truth: those changes disappear on the next build. A standalone HTML remains readable without its source directory, but keep the directory for this editable workflow.

## Components

Copy a relevant `assets/components/*.html` snippet into `content.html`, then adapt the content and IDs. The snippet is plain HTML, not a custom document language. Read [components.md](components.md) for coverage and markup guidance. Existing headings, table captions, headers and figure captions should remain meaningful after adaptation.

Tables should explain fields or decisions, not create page layout. Supply a caption and column headers with `scope="col"`. Existing `.boundary-table` cells get heading-derived `data-label` values automatically; optional component tables have their own local responsive wrappers. Long identifiers must not force the whole page to scroll.

## Diagrams

```html
<figure data-diagram="bpmn" data-source="diagrams/review.bpmn">
  <figcaption>Incomplete submissions return for clarification before a decision.</figcaption>
</figure>
```

A source-backed figure contains only its caption. PlantUML SVG is inserted during the build. BPMN is prepared in Node and drawn by embedded JavaScript when the reader opens the HTML. Both use an accessible scroll region and an expandable source with an offline download link. BPMN shows a no-JS/error fallback rather than an empty figure; wait for rendering before printing. The build preserves original source files. If BPMN auto-layout adds DI, the embedded/downloadable XML includes that layout; the authored file is not changed. Read [rendering.md](rendering.md) for prerequisites and limits.

Use a caption to interpret the important relationship or boundary. Avoid captions that merely repeat “Diagram.” The explanatory text must still make sense when the reader does not inspect every symbol.

## Depth and verification

Start from the reader's question, not a quota of cards. Explain inputs, ownership, rules, normal outcomes and significant alternatives. Label fictional examples and consequential assumptions. A workflow diagram does not prove completeness, a requirements table does not prove implementation, and a syntactically valid model does not establish business truth.

Before delivery:

1. Build from the editable sources.
2. Open the HTML offline on desktop and at about 390px wide.
3. Use the topics disclosure, keyboard Tab, Enter and Escape; follow a final-section anchor.
4. Inspect actual text layout, not only absence of overflow: long headings and inline code must wrap legibly; note sentences must remain continuous; short-label and single-paragraph callouts must not leave empty grid columns. Check that prose and fact blocks have coherent reading widths. Inspect diagrams with local horizontal scrolling.
5. Check print preview, including expanded native details and diagram source behavior.
6. Deliver the HTML and preserve the source directory for future edits.
