# explanatory-html-pages

A standalone, `skills.sh`-compatible skill for turning a technical concept into a clear explanatory HTML page. It favors reader-first teaching, semantic structure, readable diagrams, responsive composition, and a short handoff over decoration.

## Install

Install the skill with the public repository path:

```sh
npx skills add blockedby/explanatory-html-pages-skill
```

The installed skill accepts a concept, the project context already available to the agent, an audience, and optional visual constraints.

## What it produces

- One self-contained HTML page with inline CSS and meaningful content in the document.
- A teaching structure chosen for the concept: definition, relationship graph, transformation, process, comparison, rationale, or a focused combination.
- Responsive diagrams that become a readable vertical sequence on narrow screens.
- A concise handoff naming the page path, structure, audience, dependencies, and HTML parse result.

The skill does not require web research, a browser run, a framework, a build step, or remote assets. Those may be introduced only when the request makes them useful and intentional.

## Included reference asset

`assets/explanatory-page-template.html` is a complete, dependency-free sample page about the path of a web request. It demonstrates progressive disclosure, a definition panel, an HTML/CSS flow diagram, a numbered sequence, a responsive table, accessible focus states, reduced motion, and print rules. It also includes a reusable topic-navigation shell: an expanded, collapsible left panel from `80rem` up, and a sticky burger disclosure on smaller screens. The current section is highlighted as you scroll. Native links and disclosure remain usable without JavaScript.

### Reuse the layout

1. Copy `assets/explanatory-page-template.html` to your new page.
2. Keep the navigation shell, inline CSS, and bottom script. Replace the header, main sections, and footer inside `.reading-pane`, between the `PAGE CONTENT` comments.
3. Give each topic a unique section `id` and update the links in `#topic-links` to match. Keep `#main-content` for the skip link.
4. Update `<html lang>`, title, description, and navigation labels for your audience. Keep only the teaching sections you need; the layout does not prescribe the explanation.

The script handles responsive defaults, Escape, mobile focus transfer, and current-section indication. There are no dependencies or build steps. Open the HTML file directly, or preview locally:

```sh
python3 -m http.server 8765 --bind 127.0.0.1
# http://localhost:8765/assets/explanatory-page-template.html
```

## Validate locally

The repository includes a standard-library-only validator for the skill contract and reference asset:

```sh
python3 scripts/validate.py
```

It checks frontmatter, required repository files, unresolved authoring markers, semantic HTML landmarks, required metadata, tag nesting, and accidental external dependencies in the reference page. It exits non-zero when a check fails.

## Repository layout

```text
SKILL.md                              Skill instructions and contract
assets/explanatory-page-template.html  Reusable standalone HTML reference
scripts/validate.py                   Dependency-free validation
LICENSE                               MIT license
```

## License

MIT © 2026 Alexandr Kondakov. See [LICENSE](LICENSE).
