import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { toolkitRoot, sourceFile, atomicOutput } from './paths.mjs';
import { parseContent, readMetadata, escapeHtml as e } from './content.mjs';
import { prepareSvg } from '../renderers/svg.mjs';
import { prepareImage } from './images.mjs';

export const messages = {
  en: { topics: 'Topics', sections: 'Document sections', onPage: 'On this page', open: 'Open topics', close: 'Collapse topics', skip: 'Skip to content', source: 'Diagram source', download: 'Download source', scroll: 'Diagram; scroll horizontally to inspect', footer: 'Document / reference' },
  ru: { topics: 'Разделы', sections: 'Разделы документа', onPage: 'На этой странице', open: 'Открыть разделы', close: 'Свернуть разделы', skip: 'К содержимому', source: 'Исходник диаграммы', download: 'Скачать исходник', scroll: 'Диаграмма; прокручивайте по горизонтали для просмотра', footer: 'Документ / справочник' }
};
const icon = '<span class="topic-icon" aria-hidden="true"><svg class="menu-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 6h16M4 12h16M4 18h16"/></svg><svg class="panel-symbol" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></svg></span>';
// Trusted library code is inline; source XML is only ever stored as escaped text.
const inlineScript = code => code.replace(/<\/script/gi, '<\\/script').replace(/\/\/[#@]\s*sourceMappingURL=.*$/gm, '');
const closeIcon = '<span class="topic-close" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="m8 10 4 4 4-4"/></svg></span>';

export async function buildDocument(directory, { out } = {}) {
  if (!out) throw new Error('Provide --out <report.html>.');
  if (path.extname(out).toLowerCase() !== '.html') throw new Error('Output must have an .html extension.');
  const root = await realpath(directory);
  const metadataPath = await sourceFile(root, 'document.json');
  const contentPath = await sourceFile(root, 'content.html');
  const metadata = readMetadata(await readFile(metadataPath, 'utf8'));
  const { document, topics } = parseContent(await readFile(contentPath, 'utf8'));
  const element = (tag, attributes = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, value);
    node.append(...children);
    return node;
  };
  const text = messages[metadata.lang];
  const protectedPaths = [metadataPath, contentPath];
  const warnings = [];
  const images = [...document.querySelectorAll('img')];
  for (const image of images) {
    const prepared = await prepareImage(root, image.getAttribute('src'));
    protectedPaths.push(prepared.filename);
    image.setAttribute('src', prepared.dataUrl);
    image.setAttribute('width', String(prepared.width));
    image.setAttribute('height', String(prepared.height));
    image.classList.add('document-image');
    if (image.parentElement.localName === 'figure') image.parentElement.classList.add('image-figure');
  }
  let count = 0;
  let hasBpmn = false;
  for (const figure of document.querySelectorAll('[data-diagram]')) {
    if (figure.localName !== 'figure') throw new Error('data-diagram belongs on a <figure> with a caption.');
    const kind = figure.dataset.diagram;
    if (!['plantuml', 'bpmn'].includes(kind)) throw new Error(`Unsupported diagram renderer: ${kind}`);
    const caption = figure.querySelector('figcaption');
    if (!caption?.textContent.trim()) throw new Error('Every diagram needs a meaningful figcaption.');
    if ([...figure.children].some(node => node !== caption)) throw new Error('Source diagram figures must contain only their figcaption; rendering is handled by the builder.');
    const filename = await sourceFile(root, figure.dataset.source);
    const expected = kind === 'plantuml' ? '.puml' : '.bpmn';
    if (path.extname(filename).toLowerCase() !== expected) throw new Error(`${kind} source must use ${expected} extension.`);
    protectedPaths.push(filename);
    const source = await readFile(filename, 'utf8');
    const renderer = kind === 'plantuml'
      ? (await import('../renderers/plantuml.mjs')).renderPlantUml
      : (await import('../renderers/bpmn.mjs')).prepareBpmn;
    let rendered;
    try { rendered = await renderer(source, { toolkitRoot }); }
    catch (error) { throw new Error(`${figure.dataset.source}: ${error.message}`, { cause: error }); }
    const prefix = `rendered-diagram-${++count}`;
    // Source IDs cannot collide with embedded renderer-generated IDs.
    for (const node of document.querySelectorAll('[id]')) {
      if (node.id.startsWith(`${prefix}-`)) throw new Error(`Reserved diagram ID prefix: ${prefix}-`);
    }
    const isBpmn = kind === 'bpmn';
    hasBpmn ||= isBpmn;
    warnings.push(...(rendered.warnings || []).map(warning => `${figure.dataset.source}: ${warning}`));
    const viewport = element('div', {
      class: 'diagram-viewport', tabindex: '0', role: 'region',
      'aria-label': `${text.scroll}: ${caption.textContent.trim()}`
    });
    if (isBpmn) {
      viewport.dataset.bpmnRuntime = '';
      viewport.dataset.bpmnSourceId = `${prefix}-source`;
      viewport.dataset.bpmnTitle = caption.textContent.trim();
      viewport.dataset.bpmnState = 'pending';
      viewport.append(
        element('p', { class: 'diagram-status', role: 'status' },
          metadata.lang === 'ru' ? 'Диаграмма BPMN появится при открытии HTML с включённым JavaScript. Перед печатью дождитесь её загрузки.' : 'The BPMN diagram renders when this HTML is opened with JavaScript enabled. Wait for it before printing.'),
        element('noscript', {},
          metadata.lang === 'ru' ? 'Для отображения BPMN включите JavaScript. Исходник доступен ниже.' : 'Enable JavaScript to display BPMN. The diagram source is available below.')
      );
    } else {
      viewport.innerHTML = prepareSvg(rendered.svg, { prefix, title: caption.textContent.trim() });
    }
    figure.prepend(viewport);
    figure.classList.add('diagram-rendered');
    figure.removeAttribute('data-diagram');
    figure.removeAttribute('data-source');
    const details = element('details', { class: 'diagram-source deep-dive' },
      element('summary', {}, text.source),
      element('pre', {}, element('code', isBpmn ? { id: `${prefix}-source` } : {}, rendered.source)),
      element('a', {
        download: `diagram-${count}.${rendered.extension}`,
        href: `data:text/plain;charset=utf-8,${encodeURIComponent(rendered.source)}`
      }, text.download)
    );
    // figcaption must remain the figure's first or last child.
    figure.insertBefore(details, caption);
  }
  const [theme, components, navigation] = await Promise.all([
    readFile(path.join(toolkitRoot, 'assets/theme.css'), 'utf8'),
    readFile(path.join(toolkitRoot, 'assets/components.css'), 'utf8'),
    readFile(path.join(toolkitRoot, 'assets/navigation.js'), 'utf8')
  ]);
  let bpmnScripts = '';
  if (hasBpmn) {
    const bundles = await Promise.all([
      readFile(path.join(toolkitRoot, 'node_modules/bpmn-js/dist/bpmn-viewer.production.min.js'), 'utf8'),
      readFile(path.join(toolkitRoot, 'node_modules/dompurify/dist/purify.min.js'), 'utf8'),
      readFile(path.join(toolkitRoot, 'assets/bpmn-runtime.js'), 'utf8')
    ]);
    const licenses = await Promise.all(['bpmn-js', 'dompurify'].map(async name => `${name}\n${await readFile(path.join(toolkitRoot, 'node_modules', name, 'LICENSE'), 'utf8')}`));
    bpmnScripts = `<template data-bpmn-licenses>${e(licenses.join('\n\n'))}</template>` + bundles.map(bundle => `<script data-bpmn-library>\n${inlineScript(bundle)}\n</script>`).join('\n');
  }
  const nav = topics.map((topic, index) => `<li><a href="#${e(encodeURIComponent(topic.id))}"><span class="toc-number" aria-hidden="true">${String(index + 1).padStart(2, '0')}</span><span>${e(topic.title)}</span></a></li>`).join('\n');
  const html = `<!doctype html>
<html lang="${metadata.lang}"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="description" content="${e(metadata.description)}"><title>${e(metadata.title)}</title>
<style>\n${theme}\n${components}\n</style>
</head><body class="layout-compact">
<a class="skip-link" href="#main-content">${text.skip}</a>
<details class="topic-panel" id="topic-panel" open>
<summary class="topic-toggle" aria-controls="topic-links" data-open-label="${text.open}" data-close-label="${text.close}">${icon}<span class="topic-label">${text.topics}</span>${closeIcon}</summary>
<nav id="topic-links" class="toc" aria-label="${text.sections}"><p class="topic-caption">${text.onPage}</p><ul>${nav}</ul></nav>
</details>
<div class="reading-pane">
<header class="site-header"><div class="page masthead-grid"><h1>${e(metadata.title)}</h1>${metadata.description ? `<p class="lead">${e(metadata.description)}</p>` : ''}</div></header>
<main id="main-content" class="page document-content">${document.body.innerHTML}</main>
<footer class="site-footer"><div class="page"><p class="footer-mark">${text.footer}</p></div></footer>
</div><script>\n${navigation}\n</script>${bpmnScripts}</body></html>\n`;
  const output = await atomicOutput(out, html, protectedPaths);
  return { output, warnings, diagrams: count, images: images.length, sections: topics.length, browserRenderedBpmn: hasBpmn };
}
