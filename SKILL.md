---
name: explanatory-html-pages
description: Create self-contained explanatory HTML pages that make technical concepts clear through plain language, readable diagrams, and responsive editorial structure.
---

# Explanatory HTML Pages

Build one page that helps a defined reader answer a concrete technical question. Favor clarity over decoration: the page should teach a model, not advertise a product.

## Contract

### Input

- **Technical concept:** the system, term, mechanism, or workflow the reader needs to understand.
- **Available project context:** supplied files, documentation, product conventions, terminology, and constraints that are already available.
- **Audience:** what the reader knows, what they are trying to do, and the language level that will help them.
- **Optional visual constraints:** brand rules, colors, type choices, viewport range, print needs, motion preferences, or required diagram style.

### Output

- **A self-contained explanatory HTML page:** semantic HTML with inline CSS, readable diagrams, and no required network access. Add JavaScript or local assets only when they materially improve the explanation.
- **A concise handoff:** the created path, chosen teaching structure, audience or language level, and any intentional dependencies. Include the parse result.

## Default workflow

### 1. Start with the reader

Use the request and immediately available context as the main specification. Identify the reader's next question, the actors and boundaries involved, and the one idea the page must make memorable. Ask one focused question only when a missing answer would materially change the explanation. Do not perform separate research or verification unless the user asks for it.

### 2. Choose a teaching structure

Choose only the sections that answer the reader's next questions. Useful patterns include:

- a direct definition for a new term;
- a relationship graph for actors, boundaries, or data flow;
- a before-and-after or filter view for a transformation;
- a numbered sequence for a process;
- an aligned table for meaningful differences or responsibilities;
- a short rationale for why the design works this way;
- source links only when supplied or explicitly requested.

Use progressive disclosure by default: orient the reader first, define the core idea, show the main model, unpack the mechanism, then reveal edge cases or deeper detail. Do not force a fixed page schema or add empty sections.

### 3. Compose the page

- Use a single `h1`, meaningful heading order, and semantic landmarks such as `header`, `nav`, `main`, `section`, `figure`, `figcaption`, lists, and tables where they match the content.
- Write in plain language. Define necessary technical terms, keep one main idea per paragraph, and explain cause and effect directly. Use realistic copy, not authoring tokens or generic filler.
- Keep meaningful diagram text in the document. Give nodes concrete names and short role labels. Make the meaning and direction of every arrow clear in visible text or a caption; do not rely on color alone.
- Prefer readable HTML and CSS diagrams to flattened images. On narrow screens, recompose flows vertically and preserve the logical reading order rather than hiding overflow.
- Use inline CSS and a restrained editorial system by default: strong ink-and-paper contrast, a purposeful accent, consistent spacing, readable line lengths, visible focus, and print treatment when the page may be saved or shared.
- Respect supplied visual constraints. When none exist, avoid turning the explanation into a decorative landing page. Use motion only when it explains a state or relationship, and honor `prefers-reduced-motion`.
- Remove unused sections and any unresolved sample markers before handoff. A finished page must stand on its own.

The included `assets/explanatory-page-template.html` is a complete, dependency-free reference for this structure. Copy its patterns selectively; it is not a required schema.

### 4. Parse before handoff

Parse the finished HTML and fix parse errors before reporting it. In this repository, the dependency-free check is:

```sh
python3 scripts/validate.py
```

When validating a page elsewhere, use the project's equivalent parser or a standard-library HTML parser. Parsing is the required default check; do not substitute a screenshot, browser run, link check, or factual review unless the request calls for one.

### 5. Hand off briefly

Use this shape unless the caller requests another format:

```text
Created: <page path>
Structure: <definition, graph, sequence, comparison, or other selected pattern>
Audience: <language level and reader>
Dependencies: <none, or intentional dependencies>
Validation: HTML parsed successfully
```

Keep the handoff concise. The page should carry the explanation.

## Quality bar

Before handoff, confirm that:

- the opening tells the reader what they will understand;
- the definition is direct before detail appears;
- each visual relationship is also understandable from text and caption content;
- later sections add depth instead of repeating the lead;
- responsive layout changes preserve reading order, required content, and usable line lengths;
- focus and contrast remain visible, and status or role is not communicated by color alone;
- no external font, script, image, or stylesheet is required unless it is intentional and disclosed;
- the page parses cleanly and contains no unresolved authoring markers.

## Non-goals

- Mandatory web research or external fact gathering.
- Decorative landing-page generation without a teaching purpose.
- Forcing every concept into the same collection of sections.
- Adding JavaScript, a framework, a build step, or remote assets when HTML and CSS are enough.
- Unnecessary browser testing, screenshot collection, or rendering work when the request only requires a parsed standalone page.
