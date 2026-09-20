#!/usr/bin/env node
import { mkdir, readdir, readFile, writeFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import { toolkitRoot } from './lib/paths.mjs';
import { buildDocument } from './lib/build.mjs';

const catalogRoot = path.join(toolkitRoot, 'examples/component-catalog');
await mkdir(catalogRoot, { recursive: true });
const snippets = (await readdir(path.join(toolkitRoot, 'assets/components'))).filter(file => file.endsWith('.html')).sort();
const catalog = [];
for (const [index, file] of snippets.entries()) {
  const dom = new JSDOM(await readFile(path.join(toolkitRoot, 'assets/components', file), 'utf8'));
  const mapping = new Map([...dom.window.document.querySelectorAll('[id]')].map(node => [node.id, `catalog-${index + 1}-${node.id}`]));
  for (const node of dom.window.document.body.querySelectorAll('*')) {
    if (node.id) node.id = mapping.get(node.id);
    for (const name of ['aria-labelledby', 'aria-describedby']) if (node.hasAttribute(name)) node.setAttribute(name, node.getAttribute(name).split(/\s+/).map(id => mapping.get(id) || id).join(' '));
    if (node.getAttribute('href')?.startsWith('#')) node.setAttribute('href', `#${mapping.get(node.getAttribute('href').slice(1)) || node.getAttribute('href').slice(1)}`);
  }
  const section = dom.window.document.body.querySelector('section');
  if (!section) throw new Error(`Component snippet requires a section: ${file}`);
  const label = dom.window.document.createElement('p');
  label.className = 'section-kicker';
  label.textContent = `assets/components/${file}`;
  section.prepend(label);
  catalog.push(dom.window.document.body.innerHTML);
}
await writeFile(path.join(catalogRoot, 'document.json'), JSON.stringify({ title: 'Documentation component catalog', description: 'Reusable semantic HTML for explanations, business analysis and integration specifications. Choose components that answer the reader’s question; do not include every component in every document.', lang: 'en' }, null, 2) + '\n');
await writeFile(path.join(catalogRoot, 'content.html'), '<!-- Generated from assets/components/*.html by scripts/build-examples.mjs. -->\n' + catalog.join('\n'));
for (const name of ['technical-explainer', 'business-process', 'integration-spec', 'component-catalog']) {
  const result = await buildDocument(path.join(toolkitRoot, 'examples', name), { out: path.join(toolkitRoot, 'examples', `${name}.html`) });
  console.log(`${name}: ${result.sections} sections, ${result.diagrams} diagrams`);
  for (const warning of result.warnings) console.log(`  ${warning}`);
}
await copyFile(path.join(toolkitRoot, 'examples/technical-explainer.html'), path.join(toolkitRoot, 'assets/explanatory-page-template.html'));
console.log('Standalone template refreshed from canonical technical explainer.');
