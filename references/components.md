# Choosing documentation components

Components are optional tools for answering a reader's question, **not mandatory document sections**. Start with the question and copy only the useful material. A short explanation may need a definition and a flow; an integration reference may need a contract and mapping, without a goals register or glossary.

The files in `assets/components/` are plain semantic HTML source snippets. Each is a complete top-level `<section>` with an `h2`, suitable for copying into `content.html` or for the parent-built component catalog. They have no document shell, scripts, remote assets, or authoring placeholders. The stock-reservation examples illustrate a fictional service contract; their timings, IDs, rules, and requirements are examples, not claims about your system.

## Authoring and build

From the installed skill directory, the CLI contract is:

```text
node scripts/document.mjs create <directory> --title <title> --lang ru|en --preset explainer|process|integration
node scripts/document.mjs build <directory> --out <report.html>
```

Choose one language and one preset, for example:

```sh
node scripts/document.mjs create ./reservation-guide --title "Stock reservation" --lang en --preset integration
node scripts/document.mjs build ./reservation-guide --out ./reservation-guide.html
```

Creation produces `document.json`, `content.html`, and `diagrams/`. Metadata has this shape:

```json
{"title":"Stock reservation","description":"How checkout holds stock and handles retries.","lang":"en"}
```

1. Read the starter `content.html`, then replace or extend its sections with selected snippets. Keep any introduction paragraphs before the top-level sections.
2. Adapt the example's facts, ownership, terms, constraints, and failure behavior to your subject. Remove material that does not help the reader. Translate visible copy and accessible labels together for Russian documents.
3. Each top-level section needs an `h2`; use `h3` for subtopics. You may copy just a component's inner markup into an existing section rather than nesting complete sections unnecessarily.
4. Keep IDs unique across the assembled document. If you copy a snippet twice, rename its section and caption IDs and every corresponding `aria-labelledby`, `aria-describedby`, or fragment link. These snippets have distinct IDs when used once each.
5. Keep table captions and `scope` attributes. A `.doc-table-scroll` region has a descriptive `aria-label` and `tabindex="0"` for keyboard scrolling; retain both. Do not convert decision tables into screenshots or hide columns on mobile.
6. Do not add `html`, `head`, `body`, `h1`, navigation, a manual TOC, styles, or scripts to `content.html`. The builder owns the shell, title, navigation, and embedded assets. Do not add `.page` wrappers to every section.
7. Keep output separate from metadata, source HTML, and diagram sources. Rebuild after editing; do not maintain the generated report as source.

The CLI resolves assets from the installed skill directory, not the document workspace. If invoked from another working directory, use the installed path to `scripts/document.mjs`.

## Pick by the reader's question

Paths below are relative to `assets/components/`.

| Reader's question | Snippet | How to adapt it |
| --- | --- | --- |
| Why is this being built, and who owns what? | `goals-scope-actors.html` | Separate outcome, in/out boundaries, and actor responsibilities. Use observable success signals rather than unsupported target metrics. |
| What happens normally, and what changes on failure? | `scenario.html` | Preserve trigger, preconditions, postconditions, numbered main path, and alternatives tied to a specific step. State whether each branch resumes or ends. |
| Which result follows from these conditions? | `rules-decision-table.html` | State evaluation order, meaning of “any”/dash, boundary values, and fallback behavior. Keep alternatives mutually exclusive or explicitly prioritize them. |
| What behavior must be demonstrated? | `requirements-acceptance.html` | Give requirements and criteria stable IDs; use concrete Given/When/Then outcomes, including failure and concurrency where relevant. Criteria are not test results. |
| What do these terms and fields mean? | `glossary-data-dictionary.html` | Use a definition list for vocabulary, a table for types, requiredness, units, constraints, ownership, and examples. Split the snippet if only one is needed. |
| What can a caller or consumer rely on? | `api-event-contract.html` | Specify auth, input, output, errors, retries, idempotency scope/window, event delivery, compatibility, and recovery. Remove the API or event portion if it is not relevant. |
| How does one representation become another? | `mapping.html` | Name both sides, transformations, defaults, and missing/invalid behavior. Show a worked input/output pair; avoid vague “map as appropriate.” |
| What is uncertain and how will we resolve it? | `assumptions-questions.html` | Distinguish assumptions from open questions; record impact, accountable role, and the next evidence needed. Do not present an assumption as a decision. |
| What changes, and what remains risky? | `as-is-to-be.html` | Compare the same task before and after. Include trade-offs, coexistence, observation, and rollback boundaries rather than promising only benefits. |

## Existing explanatory patterns

These snippets reuse canonical theme classes; `components.css` does not redefine them.

| Pattern | Snippet | Selection advice |
| --- | --- | --- |
| Definition | `definition.html` | Introduce an unfamiliar concept and its boundaries; the adjacent definition list summarizes input/deadline/outcome. |
| Steps | `steps.html` | Explain a short ordered sequence. Use the scenario snippet when branches and preconditions matter. |
| Note | `notes.html` | Emphasize one important caveat next to the explanation it qualifies; avoid turning every paragraph into a note. |
| Comparison | `comparison.html` | Align the same dimensions across alternatives. Retain `data-label` text matching the column meaning for the theme's narrow-screen presentation. |
| Details | `details.html` | Put optional depth behind a meaningful native `summary`. Keep essential requirements and warnings outside the disclosure; no JavaScript is needed. |
| Conclusion | `conclusions.html` | State the mental model or practical implication already supported by the page. Do not introduce new requirements in the final callout. |
| Native flow | `native-flow.html` | Use a small, linear explanatory path with meaningful connector labels and a caption explaining omissions. For formal gateways, timers, messages, or interactions, see [notations](notations.md). |

Do not stack all patterns just to display them. Use the catalog to browse; compose real documents around the reader's next question.

Keep a sentence together inside a paragraph, including its inline `strong`, `code` and links. For a note with a separate label, use the snippet's label plus one complete paragraph—not separate blocks for fragments of the sentence. A short definition needs a compact text group; add a companion list only when there are real supporting facts, never to fill an empty column. A one-paragraph conclusion does not need an empty label column.

Long technical names are valid in headings, but use `code` only for the identifier itself. Do not shorten or remove meaningful content to disguise a layout defect.

## Styling contract

Callouts use natural text flow by default. Structured columns are reserved for a `.definition` with a direct `.signal-list`, a `.note-strip` with a direct `strong` label followed by its sole `p`, or a `.takeaway` with a direct `.takeaway-label`. These structures stack on narrow screens. Plain callouts and `.doc-facts` follow the prose measure; full data tables and diagram regions retain their wider layout.

`assets/components.css` adds only optional `.doc-*` primitives. Load it after canonical `assets/theme.css` when assembling a catalog or report; shell integration belongs to the builder, not to source authors. No per-snippet stylesheet, runtime library, or custom DSL is needed.

- `.doc-facts`: semantic `dl` with alternating direct `dt` / `dd` children. Two columns become a single reading sequence on narrow screens.
- `.doc-scenario` and `.doc-alternatives`: grouped main path and exceptions, with normal headings and lists.
- `.doc-table-scroll` + `.doc-table`: captioned data tables with local overflow when necessary. Table semantics stay intact at all widths. Prefer a few meaningful columns; split very wide tables before printing.
- `.doc-criteria`: ordered acceptance statements, not interactive checkboxes implying completion.
- `.doc-payload`: wrapping `pre` / `code` examples; escape HTML-sensitive characters in literal source.
- `.doc-change`: two aligned before/after blocks, stacked in DOM order on narrow screens and in print.

Colors use the existing `--ink`, `--wash`, `--rule`, `--line`, and `--accent` tokens. There are no global selectors, navigation rules, root variables, motion, or extra fonts. Existing `.definition`, `.steps`, `.note-strip`, `.boundary-table`, `.deep-dive`, `.takeaway`, `.diagram`, `.flow`, and `.node` styles remain theme-owned.

## Editable diagram figures

Use source figures, not pasted renderer output:

```html
<figure data-diagram="plantuml" data-source="diagrams/exchange.puml">
  <figcaption>Request and response, including the rejection path.</figcaption>
</figure>
```

For BPMN, use `data-diagram="bpmn"` and a `.bpmn` XML file. Paths must remain within the document workspace. PlantUML SVG is rendered during the build; BPMN renders from embedded code in the reader browser. Both paths sanitize and namespace SVG, provide local scrolling and expandable escaped source, and keep original diagram files editable. No installed browser is needed to build; BPMN needs JavaScript when reading. There is no public rendering server or runtime download. See [notations](notations.md) for choosing a notation and concrete source examples.

## Checks and limits

Parse source HTML and CSS, check unique IDs and referenced labels, then build the selected document. The integrated catalog still needs desktop, narrow-screen, keyboard, offline, and print inspection by the parent integrator. Check actual text geometry as well as overflow: a page can fit the viewport while a note is split into grid cells, a short label leaves most of a callout empty, or fact rows and prose use inconsistent reading widths. Exercise short and long labels, inline code inside sentences, long code headings, and single-paragraph callouts. A successful parse or render checks syntax and presentation, not the completeness of business rules or the logical correctness of a process.
