import { JSDOM } from 'jsdom';
import { parseFragment } from 'parse5';

export const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const tags = new Set('p h2 h3 h4 h5 h6 section article aside div span dl dt dd ul ol li table caption thead tbody tfoot tr th td code pre strong em b i small mark blockquote figure figcaption details summary a br hr time abbr sup sub s del ins kbd samp var'.split(' '));
const reserved = new Set(['main-content', 'topic-panel', 'topic-links']);
const safeId = /^[\p{L}_][\p{L}\p{N}_.:-]*$/u;

export function parseContent(source) {
  if (/<!doctype|<\/?(?:html|head|body)\b/i.test(source)) throw new Error('content.html must contain content only, not a document shell. Use the scaffold and shared theme.');
  const errors = [];
  parseFragment(source, { onParseError: error => errors.push(error.code) });
  if (errors.length) throw new Error(`Invalid content HTML: ${[...new Set(errors)].join(', ')}`);
  const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>');
  const document = dom.window.document;
  document.body.innerHTML = source;
  const ids = new Set(reserved);
  for (const element of document.body.querySelectorAll('*')) {
    if (!tags.has(element.localName)) throw new Error(`Unsupported <${element.localName}> in content. Reuse components; the builder owns styles, scripts and the page shell.`);
    for (const { name, value } of [...element.attributes]) {
      if (/^on/i.test(name) || ['style', 'src', 'srcset', 'srcdoc', 'formaction', 'action', 'background', 'xmlns'].includes(name)) throw new Error(`Unsupported content attribute: ${name}`);
      if (name === 'href' && !/^(?:#|https?:\/\/|mailto:)/i.test(value)) throw new Error('Content links must be anchors, HTTPS/HTTP, or mailto links.');
      if (name === 'target' && value === '_blank') element.setAttribute('rel', 'noopener noreferrer');
    }
    if (element.hasAttribute('id')) {
      if (!safeId.test(element.id) || ids.has(element.id)) throw new Error(`Invalid, duplicate or reserved ID: ${element.id}`);
      ids.add(element.id);
    }
  }
  const sections = [...document.body.children].filter(element => element.localName === 'section');
  if (!sections.length) throw new Error('Add at least one top-level <section> with an <h2> heading.');
  const topics = sections.map((section, index) => {
    const heading = [...section.children].find(element => element.localName === 'h2') || section.querySelector('h2');
    if (!heading?.textContent.trim()) throw new Error(`Section ${index + 1} needs a meaningful h2 heading.`);
    if (!section.id) {
      const stem = heading.textContent.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-|-$/g, '') || `section-${index + 1}`;
      let id = /^[\p{L}_]/u.test(stem) ? stem : `section-${stem}`;
      const base = id;
      for (let suffix = 2; ids.has(id); suffix++) id = `${base}-${suffix}`;
      section.id = id;
      ids.add(id);
    }
    if (!heading.id) {
      let id = `${section.id}-heading`;
      while (ids.has(id)) id += '-title';
      heading.id = id;
      ids.add(id);
    }
    section.setAttribute('aria-labelledby', heading.id);
    return { id: section.id, title: section.dataset.navTitle || heading.textContent.trim() };
  });
  for (const anchor of document.body.querySelectorAll('a[href^="#"]')) {
    let target;
    try { target = decodeURIComponent(anchor.getAttribute('href').slice(1)); } catch { throw new Error('Invalid encoded anchor.'); }
    if (!ids.has(target)) throw new Error(`Missing anchor target: ${anchor.getAttribute('href')}`);
  }
  // Existing responsive table component reads the visible heading via data-label.
  for (const table of document.body.querySelectorAll('table')) {
    const headers = [...table.querySelectorAll('thead tr:first-child th')].map(th => th.textContent.trim());
    for (const row of table.querySelectorAll('tbody tr')) [...row.children].forEach((cell, i) => {
      if (headers[i] && !cell.hasAttribute('data-label')) cell.setAttribute('data-label', headers[i]);
    });
  }
  return { document, topics };
}

export function readMetadata(raw) {
  let metadata;
  try { metadata = JSON.parse(raw); } catch { throw new Error('document.json is not valid JSON.'); }
  if (!metadata || Array.isArray(metadata) || typeof metadata !== 'object') throw new Error('document.json must be an object.');
  for (const key of Object.keys(metadata)) if (!['title', 'description', 'lang'].includes(key)) throw new Error(`Unknown document metadata key: ${key}`);
  if (typeof metadata.title !== 'string' || !metadata.title.trim() || metadata.title.length > 300) throw new Error('A title of 1–300 characters is required.');
  if (!['en', 'ru'].includes(metadata.lang)) throw new Error('Supported document languages: en, ru.');
  if (metadata.description !== undefined && (typeof metadata.description !== 'string' || metadata.description.length > 2000)) throw new Error('Description must be text, at most 2000 characters.');
  return { title: metadata.title.trim(), description: metadata.description || '', lang: metadata.lang };
}
