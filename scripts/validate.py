#!/usr/bin/env python3
"""Run dependency-free contract and HTML checks for this skill repository."""

from __future__ import annotations

import argparse
import re
import sys
from html.parser import HTMLParser
from pathlib import Path
from typing import Iterable
from urllib.parse import unquote

ROOT = Path(__file__).resolve().parents[1]
TEMPLATE = ROOT / "assets" / "explanatory-page-template.html"

VOID_ELEMENTS = frozenset(
    {
        "area",
        "base",
        "br",
        "col",
        "embed",
        "hr",
        "img",
        "input",
        "link",
        "meta",
        "param",
        "source",
        "track",
        "wbr",
    }
)

PLACEHOLDER_PATTERNS = (
    ("bracketed authoring marker", re.compile(r"\[[A-Z][A-Z0-9 _./:'’—-]{2,}\]")),
    ("double-curly authoring marker", re.compile(r"\{\{|\}\}")),
    ("unfinished authoring word", re.compile(r"\b(?:TODO|FIXME|PLACEHOLDER|REPLACE_ME)\b", re.IGNORECASE)),
    ("example domain", re.compile(r"\bexample\.com\b", re.IGNORECASE)),
)


class StrictHTMLParser(HTMLParser):
    """A small, readable nesting check on top of Python's HTML parser."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.stack: list[str] = []
        self.elements: list[tuple[str, dict[str, str | None]]] = []
        self.errors: list[str] = []
        self.title_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attributes: dict[str, str | None] = {}
        for key, value in attrs:
            key = key.lower()
            if key in attributes:
                self.errors.append(f"duplicate attribute {key!r} on <{tag}>")
            attributes[key] = value
        self.elements.append((tag, attributes))
        if tag not in VOID_ELEMENTS:
            self.stack.append(tag)

    def handle_startendtag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        tag = tag.lower()
        attributes = {key.lower(): value for key, value in attrs}
        self.elements.append((tag, attributes))

    def handle_endtag(self, tag: str) -> None:
        tag = tag.lower()
        if tag in VOID_ELEMENTS:
            self.errors.append(f"void element </{tag}> must not have an end tag")
            return
        if not self.stack:
            self.errors.append(f"unmatched closing tag </{tag}>")
            return
        if self.stack[-1] != tag:
            expected = self.stack[-1]
            self.errors.append(f"expected </{expected}> before </{tag}>")
            if tag in self.stack:
                self.stack = self.stack[: self.stack.index(tag)]
            return
        self.stack.pop()

    def handle_data(self, data: str) -> None:
        if self.stack and self.stack[-1] == "title":
            self.title_parts.append(data)


def display_path(path: Path) -> str:
    try:
        return str(path.relative_to(ROOT))
    except ValueError:
        return str(path)


def read_text(path: Path, errors: list[str]) -> str:
    try:
        return path.read_text(encoding="utf-8")
    except OSError as exc:
        errors.append(f"{display_path(path)}: cannot read file: {exc}")
        return ""


def check_markers(path: Path, text: str, errors: list[str]) -> None:
    for label, pattern in PLACEHOLDER_PATTERNS:
        match = pattern.search(text)
        if match:
            line = text.count("\n", 0, match.start()) + 1
            errors.append(f"{display_path(path)}:{line}: unresolved {label}")


def parse_html(path: Path, errors: list[str]) -> StrictHTMLParser | None:
    text = read_text(path, errors)
    if not text:
        return None

    check_markers(path, text, errors)
    if not re.match(r"\s*<!doctype\s+html\s*>", text, re.IGNORECASE):
        errors.append(f"{display_path(path)}: missing HTML5 doctype")

    parser = StrictHTMLParser()
    try:
        parser.feed(text)
        parser.close()
    except Exception as exc:  # HTMLParser normally recovers, but expose any parser failure.
        errors.append(f"{display_path(path)}: HTML parser failed: {exc}")
        return None

    for issue in parser.errors:
        errors.append(f"{display_path(path)}: {issue}")
    for tag in reversed(parser.stack):
        errors.append(f"{display_path(path)}: unclosed <{tag}>")
    return parser


def elements(parser: StrictHTMLParser, tag: str) -> list[dict[str, str | None]]:
    return [attrs for name, attrs in parser.elements if name == tag]


def check_template(errors: list[str]) -> None:
    if not TEMPLATE.is_file():
        errors.append("assets/explanatory-page-template.html: required reference asset is missing")
        return

    parser = parse_html(TEMPLATE, errors)
    if parser is None:
        return

    html_nodes = elements(parser, "html")
    if len(html_nodes) != 1 or not html_nodes[0].get("lang"):
        errors.append("assets/explanatory-page-template.html: <html> needs one non-empty lang attribute")

    if not elements(parser, "head") or not elements(parser, "body"):
        errors.append("assets/explanatory-page-template.html: expected <head> and <body> landmarks")

    charset_ok = any((attrs.get("charset") or "").lower() == "utf-8" for attrs in elements(parser, "meta"))
    if not charset_ok:
        errors.append("assets/explanatory-page-template.html: expected UTF-8 charset metadata")

    viewport_ok = any(
        (attrs.get("name") or "").lower() == "viewport"
        and "width=device-width" in (attrs.get("content") or "").lower().replace(" ", "")
        for attrs in elements(parser, "meta")
    )
    if not viewport_ok:
        errors.append("assets/explanatory-page-template.html: expected responsive viewport metadata")

    title = "".join(parser.title_parts).strip()
    if not title:
        errors.append("assets/explanatory-page-template.html: <title> must contain text")

    for landmark in ("header", "main", "footer"):
        if not elements(parser, landmark):
            errors.append(f"assets/explanatory-page-template.html: expected <{landmark}> landmark")

    if len(elements(parser, "h1")) != 1:
        errors.append("assets/explanatory-page-template.html: expected exactly one <h1>")

    sections = elements(parser, "section")
    if len(sections) < 3:
        errors.append("assets/explanatory-page-template.html: expected at least three teaching sections")
    for index, attrs in enumerate(sections, start=1):
        if not attrs.get("aria-labelledby") and not attrs.get("aria-label"):
            errors.append(f"assets/explanatory-page-template.html: section {index} needs an accessible label")

    if not elements(parser, "figure") or not elements(parser, "figcaption"):
        errors.append("assets/explanatory-page-template.html: expected a figure with a figcaption")

    if not elements(parser, "style"):
        errors.append("assets/explanatory-page-template.html: expected inline CSS for a self-contained page")

    for tag in ("script", "img", "iframe", "object", "embed", "audio", "video", "source"):
        for attrs in elements(parser, tag):
            if attrs.get("src"):
                errors.append(f"assets/explanatory-page-template.html: external or local <{tag} src> breaks self-containment")
    for attrs in elements(parser, "link"):
        if attrs.get("href"):
            errors.append("assets/explanatory-page-template.html: external or local <link> breaks self-containment")

    ids = [attrs["id"] for _, attrs in parser.elements if attrs.get("id")]
    if len(ids) != len(set(ids)):
        errors.append("assets/explanatory-page-template.html: IDs must be unique")
    for tag, attrs in parser.elements:
        href = attrs.get("href") or ""
        if tag == "a" and href.startswith("#") and unquote(href[1:]) not in ids:
            errors.append(f"assets/explanatory-page-template.html: missing anchor target {href}")
        for attribute in ("aria-controls", "aria-labelledby"):
            for target in (attrs.get(attribute) or "").split():
                if target not in ids:
                    errors.append(f"assets/explanatory-page-template.html: missing {attribute} target {target}")

    for attrs in elements(parser, "img"):
        if "alt" not in attrs:
            errors.append("assets/explanatory-page-template.html: every image needs an alt attribute")


def check_frontmatter(errors: list[str]) -> None:
    path = ROOT / "SKILL.md"
    text = read_text(path, errors)
    if not text:
        return

    match = re.match(r"\A---\r?\n(.*?)\r?\n---\r?\n", text, re.DOTALL)
    if not match:
        errors.append("SKILL.md: expected YAML frontmatter delimited by ---")
        return

    fields: dict[str, str] = {}
    for line in match.group(1).splitlines():
        if not line.strip():
            continue
        if ":" not in line:
            errors.append(f"SKILL.md: malformed frontmatter line: {line}")
            continue
        key, value = line.split(":", 1)
        key = key.strip()
        if key in fields:
            errors.append(f"SKILL.md: duplicate frontmatter key {key!r}")
        fields[key] = value.strip()

    if fields.get("name") != "explanatory-html-pages":
        errors.append("SKILL.md: frontmatter name must be explanatory-html-pages")
    if not fields.get("description"):
        errors.append("SKILL.md: frontmatter description must not be empty")

    # Validate runnable entry points and real local references, not a frozen essay.
    for entry in ("scripts/document.mjs", "scripts/setup.mjs", "content.html", "document.json"):
        if entry not in text:
            errors.append(f"SKILL.md: missing authoring entry point {entry!r}")
    for target in re.findall(r"\]\(([^)]+)\)", text):
        if "://" not in target and not (ROOT / target.split("#", 1)[0]).is_file():
            errors.append(f"SKILL.md: broken local reference {target}")


def check_repository_files(errors: list[str]) -> None:
    required = (
        "SKILL.md",
        "README.md",
        "LICENSE",
        ".gitignore",
        "assets/explanatory-page-template.html",
        "scripts/validate.py",
        "scripts/document.mjs",
        "scripts/setup.mjs",
        "assets/theme.css",
        "assets/components.css",
        "assets/navigation.js",
        "package.json",
        "package-lock.json",
        "references/authoring.md",
        "references/components.md",
        "references/notations.md",
        "references/rendering.md",
    )
    for relative in required:
        if not (ROOT / relative).is_file():
            errors.append(f"{relative}: required repository file is missing")

    license_text = read_text(ROOT / "LICENSE", errors)
    if "MIT License" not in license_text or "Copyright 2026 Alexandr Kondakov" not in license_text:
        errors.append("LICENSE: expected MIT License and Copyright 2026 Alexandr Kondakov")

    readme_text = read_text(ROOT / "README.md", errors)
    if "npx skills add blockedby/explanatory-html-pages-skill" not in readme_text:
        errors.append("README.md: missing the blockedby/explanatory-html-pages-skill install command")


def resolve_html_paths(raw_paths: Iterable[str]) -> list[Path]:
    paths: list[Path] = []
    for raw in raw_paths:
        candidate = Path(raw)
        if not candidate.is_absolute():
            candidate = Path.cwd() / candidate
        paths.append(candidate.resolve())
    return paths


def main() -> int:
    argument_parser = argparse.ArgumentParser(
        description="Validate this skill repository or specific standalone HTML files."
    )
    argument_parser.add_argument(
        "html",
        nargs="*",
        help="optional HTML paths; without them, validate the repository contract and reference asset",
    )
    args = argument_parser.parse_args()

    errors: list[str] = []
    if args.html:
        for path in resolve_html_paths(args.html):
            if not path.is_file():
                errors.append(f"{path}: file is missing")
            else:
                parse_html(path, errors)
    else:
        check_repository_files(errors)
        check_frontmatter(errors)
        check_template(errors)
        canonical = [read_text(ROOT / relative, errors) for relative in
                     ("assets/theme.css", "assets/components.css", "assets/navigation.js")]
        outputs = [TEMPLATE]
        for name in ("technical-explainer", "business-process", "integration-spec", "component-catalog"):
            path = ROOT / "examples" / f"{name}.html"
            if not path.is_file():
                errors.append(f"{display_path(path)}: built example is missing")
                continue
            parse_html(path, errors)
            outputs.append(path)
        for path in outputs:
            html = read_text(path, errors)
            for asset in canonical:
                if asset and asset not in html:
                    errors.append(f"{display_path(path)}: canonical asset drift; run npm run build:examples")

    if errors:
        print("Validation failed:", file=sys.stderr)
        for error in errors:
            print(f"- {error}", file=sys.stderr)
        return 1

    if args.html:
        print(f"PASS: parsed {len(args.html)} HTML file(s)")
    else:
        print("PASS: repository contract and reference HTML parsed successfully")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
