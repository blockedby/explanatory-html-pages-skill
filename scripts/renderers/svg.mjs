import { JSDOM } from 'jsdom';
import createDOMPurify from 'dompurify';

const cssWindow = new JSDOM('').window;
const purifier = createDOMPurify(cssWindow);
const safeProperties = new Set(('fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-miterlimit opacity color font font-family font-size font-style font-weight text-anchor dominant-baseline alignment-baseline letter-spacing word-spacing text-decoration white-space paint-order visibility display transform transform-origin vector-effect shape-rendering clip-path marker-start marker-mid marker-end').split(' '));

function safeValue(value) {
  if (/expression\s*\(|@import|javascript:|data:|https?:|\/\/|\\/i.test(value)) throw new Error('Unsafe SVG CSS value.');
  for (const match of value.matchAll(/url\s*\(([^)]*)\)/gi)) {
    if (!/^['"]?#[\w:.-]+['"]?$/.test(match[1].trim())) throw new Error('SVG may reference only local resources.');
  }
}
function checkStyle(style) {
  for (const name of Array.from(style)) {
    if (!safeProperties.has(name)) style.removeProperty(name);
    else safeValue(style.getPropertyValue(name));
  }
}

/** Embed a rendered SVG, with no active/remote content or cross-figure IDs. */
export function prepareSvg(rawSvg, { prefix, title = 'Diagram' } = {}) {
  if (!/^[a-zA-Z][\w-]*$/.test(prefix || '')) throw new Error('SVG prefix must be a safe unique identifier.');
  if (typeof rawSvg !== 'string' || rawSvg.length > 10 * 1024 * 1024) throw new Error('Invalid or oversized SVG.');
  // bpmn-js emits this fixed legacy SVG header. Strip it before any XML parser
  // sees it; never accept arbitrary declarations, internal subsets or entities.
  rawSvg = rawSvg.replace('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">', '');
  if (/<!DOCTYPE|<!ENTITY/i.test(rawSvg)) throw new Error('SVG document types and entities are not allowed.');
  let dom;
  try { dom = new JSDOM(rawSvg, { contentType: 'image/svg+xml' }); }
  catch { throw new Error('Renderer returned malformed SVG.'); }
  const root = dom.window.document.documentElement;
  if (root.localName !== 'svg' || root.namespaceURI !== 'http://www.w3.org/2000/svg') throw new Error('Renderer did not return an SVG document.');
  if (root.querySelector('script, foreignObject, image, use[href]:not([href^="#"])')) throw new Error('SVG contains unsupported active or external content.');
  // Flatten renderer styles onto their own SVG nodes, never leak selectors into the document.
  for (const sheetNode of root.querySelectorAll('style')) {
    if (/@|<\/style/i.test(sheetNode.textContent)) throw new Error('Unsupported SVG stylesheet directive.');
    const style = cssWindow.document.createElement('style');
    style.textContent = sheetNode.textContent;
    cssWindow.document.head.append(style);
    try {
      if (!style.sheet) throw new Error('Invalid SVG stylesheet.');
      for (const rule of style.sheet.cssRules) {
        if (!rule.selectorText || !rule.style) throw new Error('Unsupported SVG CSS rule.');
        checkStyle(rule.style);
        for (const node of root.querySelectorAll(rule.selectorText)) {
          for (const name of Array.from(rule.style)) {
            if (!node.style.getPropertyValue(name)) node.style.setProperty(name, rule.style.getPropertyValue(name));
          }
        }
      }
    } finally { style.remove(); }
    sheetNode.remove();
  }
  for (const node of [root, ...root.querySelectorAll('*')]) {
    if (node.style) checkStyle(node.style);
    for (const attribute of [...node.attributes]) {
      const name = attribute.name.toLowerCase();
      if (name.startsWith('on')) throw new Error('SVG event handlers are not allowed.');
      if (name === 'href' || name === 'xlink:href') {
        if (!attribute.value.startsWith('#')) throw new Error('SVG hyperlinks/resources must be local.');
      }
      if (/url\s*\(/i.test(attribute.value)) safeValue(attribute.value);
    }
  }
  const cleaned = purifier.sanitize(root.outerHTML, { USE_PROFILES: { svg: true, svgFilters: true }, FORBID_TAGS: ['style', 'script', 'foreignObject', 'image', 'a', 'animate', 'animateMotion', 'animateTransform', 'set'], ADD_ATTR: ['dominant-baseline'] });
  const safeDom = new JSDOM(cleaned, { contentType: 'image/svg+xml' });
  const svg = safeDom.window.document.documentElement;
  const ids = new Map();
  for (const node of [svg, ...svg.querySelectorAll('[id]')]) {
    if (!node.id) continue;
    if (ids.has(node.id)) throw new Error('SVG contains duplicate IDs.');
    ids.set(node.id, `${prefix}-${ids.size}`);
  }
  for (const node of [svg, ...svg.querySelectorAll('*')]) {
    for (const attribute of [...node.attributes]) {
      let value = attribute.value;
      if (attribute.name === 'id') value = ids.get(value);
      else if (attribute.name === 'href' || attribute.name === 'xlink:href') {
        if (!ids.has(value.slice(1))) throw new Error('SVG contains an unresolved local reference.');
        value = `#${ids.get(value.slice(1))}`;
      } else if (attribute.name === 'aria-labelledby' || attribute.name === 'aria-describedby') {
        value = value.split(/\s+/).map(id => ids.get(id)).filter(Boolean).join(' ');
      } else {
        value = value.replace(/url\s*\(\s*['"]?#([^)'"\s]+)['"]?\s*\)/gi, (_, id) => {
          if (!ids.has(id)) throw new Error('SVG contains an unresolved paint/marker reference.');
          return `url(#${ids.get(id)})`;
        });
      }
      node.setAttribute(attribute.name, value);
    }
  }
  if (!svg.hasAttribute('viewBox')) {
    const width = parseFloat(svg.getAttribute('width'));
    const height = parseFloat(svg.getAttribute('height'));
    if (!(width > 0 && height > 0)) throw new Error('SVG requires a viewBox or positive dimensions.');
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  }
  const bounds = svg.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
  if (bounds.length !== 4 || !bounds.every(Number.isFinite) || bounds[2] <= 0 || bounds[3] <= 0) throw new Error('Invalid SVG viewBox.');
  svg.querySelectorAll('title').forEach(node => node.remove());
  const heading = safeDom.window.document.createElementNS('http://www.w3.org/2000/svg', 'title');
  heading.id = `${prefix}-title`;
  heading.textContent = title;
  svg.prepend(heading);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-labelledby', heading.id);
  svg.setAttribute('focusable', 'false');
  svg.removeAttribute('aria-hidden');
  svg.setAttribute('width', String(bounds[2]));
  svg.setAttribute('height', String(bounds[3]));
  svg.removeAttribute('style');
  return svg.outerHTML;
}
