/* Standalone reader runtime. Requires the embedded BpmnJS viewer and DOMPurify. */
(() => {
  'use strict';
  const ru = /^ru(?:-|$)/i.test(document.documentElement.lang);
  const messages = ru ? {
    loading: 'Загрузка BPMN…', error: 'Не удалось показать BPMN. Исходный XML доступен ниже.',
    timeout: 'Превышено время ожидания BPMN.'
  } : {
    loading: 'Loading BPMN…', error: 'Unable to display BPMN. The source XML is available below.',
    timeout: 'BPMN rendering timed out.'
  };
  const modelNS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
  const svgNS = 'http://www.w3.org/2000/svg';
  const bytes = value => new TextEncoder().encode(value).length;
  const fail = message => { throw new Error(message); };

  function validateXML(xml) {
    if (!xml.trim() || bytes(xml) > 2 * 1024 * 1024) fail('Empty or oversized BPMN XML.');
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(xml)) fail('XML declarations are forbidden.');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    if (doc.querySelector('parsererror') || doc.documentElement.namespaceURI !== modelNS || doc.documentElement.localName !== 'definitions') fail('Invalid BPMN XML.');
    const nodes = [...doc.getElementsByTagName('*')];
    if (nodes.length > 10000) fail('Too many XML elements.');
    const ids = new Set();
    for (const node of nodes) {
      // BPMN script-task bodies are inert model data, not HTML/JS to execute.
      const inertScript = node.namespaceURI === modelNS && node.localName === 'script';
      if ((!inertScript && /^(script|foreignObject|image|img|iframe|style|link|object|embed)$/i.test(node.localName)) || [svgNS, 'http://www.w3.org/1999/xhtml'].includes(node.namespaceURI)) fail('Active XML markup is forbidden.');
      for (const attr of node.attributes) {
        if (/^on/i.test(attr.localName) || /^(href|src|style)$/i.test(attr.localName)) fail('Active XML attributes are forbidden.');
      }
      if (node.hasAttribute('id')) {
        const id = node.getAttribute('id');
        if (!id || ids.has(id)) fail('Duplicate or empty XML ID.');
        ids.add(id);
      }
    }
    if (doc.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/DI', 'BPMNDiagram').length !== 1) fail('Supply one complete BPMN diagram with DI.');
  }

  function checkCoverage(viewer) {
    const registry = viewer.get('elementRegistry');
    const seen = new Set();
    const types = ['FlowNode', 'SequenceFlow', 'Participant', 'Lane', 'MessageFlow', 'Artifact', 'DataObjectReference', 'DataStoreReference', 'DataAssociation'];
    function visit(obj) {
      if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
      seen.add(obj);
      if (obj.$instanceOf && types.some(type => obj.$instanceOf(`bpmn:${type}`))) {
        const el = registry.get(obj.id);
        if (!el || el.hidden || !registry.getGraphics(el)) fail('Unrendered BPMN elements; supply complete DI including expanded subprocesses.');
      }
      for (const [key, value] of Object.entries(obj)) {
        if (key.startsWith('$') || key === 'di') continue;
        if (Array.isArray(value)) value.forEach(visit); else visit(value);
      }
    }
    visit(viewer.getDefinitions());
    const elements = registry.getAll().filter(el => !['bpmn:Process', 'bpmn:Collaboration'].includes(el.type));
    if (!elements.length) fail('No renderable BPMN elements.');
    for (const el of elements) {
      const points = el.waypoints || [{ x: el.x, y: el.y }, { x: el.x + el.width, y: el.y + el.height }];
      if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 100000 || Math.abs(p.y) > 100000) || (!el.waypoints && (!(el.width > 0) || !(el.height > 0)))) fail('Invalid BPMN dimensions.');
    }
  }

  function sanitizeSVG(raw, prefix, title) {
    if (typeof raw !== 'string' || bytes(raw) > 8 * 1024 * 1024) fail('BPMN SVG exceeds 8 MiB.');
    raw = raw.replace('<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">', '');
    if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(raw)) fail('SVG declarations are forbidden.');
    const parsed = new DOMParser().parseFromString(raw, 'image/svg+xml');
    if (parsed.querySelector('parsererror') || parsed.documentElement.localName !== 'svg' || parsed.documentElement.namespaceURI !== svgNS) fail('Invalid SVG.');
    const clean = window.DOMPurify.sanitize(parsed.documentElement, {
      USE_PROFILES: { svg: true, svgFilters: true }, RETURN_DOM: true,
      FORBID_TAGS: ['script', 'foreignObject', 'image', 'feImage', 'use', 'a', 'style', 'animate', 'animateMotion', 'animateTransform', 'set'],
      FORBID_ATTR: ['href', 'xlink:href', 'src', 'xml:base'], ALLOW_DATA_ATTR: false
    });
    const svg = clean.localName === 'svg' ? clean : clean.querySelector('svg');
    if (!svg || !svg.querySelector('path,rect,circle,ellipse,polygon,polyline,line,text')) fail('Empty sanitized SVG.');
    const nodes = [svg, ...svg.querySelectorAll('*')];
    const ids = new Map();
    for (const node of nodes) {
      if (node.id) {
        if (ids.has(node.id)) fail('Duplicate SVG ID.');
        ids.set(node.id, `${prefix}-${ids.size}`);
      }
    }
    const css = new Set('fill fill-opacity fill-rule stroke stroke-width stroke-opacity stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-miterlimit opacity color font-family font-size font-style font-weight text-anchor dominant-baseline alignment-baseline letter-spacing word-spacing text-decoration white-space paint-order vector-effect shape-rendering clip-path marker-start marker-mid marker-end'.split(' '));
    function references(value) {
      if (/url\s*\(/i.test(value)) {
        let invalid = false;
        value = value.replace(/url\(\s*['"]?#([^\s)'" ]+)['"]?\s*\)/gi, (_, id) => {
          if (!ids.has(id)) invalid = true;
          return `url(#${ids.get(id) || ''})`;
        });
        if (invalid || /url\s*\((?!#)/i.test(value)) return null;
      }
      // No CSS escapes, imports, protocols, or executable expressions.
      return /[\\@]|(?:https?:|data:|javascript:|expression\s*\()/i.test(value) ? null : value;
    }
    for (const node of nodes) {
      if (node.id) node.id = ids.get(node.id);
      for (const attr of [...node.attributes]) {
        if (attr.name === 'id' || attr.name === 'xmlns' || attr.name.startsWith('xmlns:')) continue;
        if (/^on/i.test(attr.name) || /href|src|base/i.test(attr.localName) || attr.name.startsWith('aria-')) { node.removeAttributeNode(attr); continue; }
        if (attr.name === 'style') {
          const declarations = [];
          for (const prop of node.style) {
            const value = references(node.style.getPropertyValue(prop));
            if (css.has(prop) && value !== null) declarations.push(`${prop}:${value}`);
          }
          node.setAttribute('style', declarations.join(';'));
        } else {
          const value = references(attr.value);
          if (value === null) node.removeAttributeNode(attr); else attr.value = value;
        }
      }
    }
    const viewBox = svg.getAttribute('viewBox')?.trim().split(/[\s,]+/).map(Number);
    if (!viewBox || viewBox.length !== 4 || !viewBox.every(Number.isFinite) || viewBox[2] <= 0 || viewBox[3] <= 0) fail('Invalid SVG viewBox.');
    svg.setAttribute('width', String(viewBox[2]));
    svg.setAttribute('height', String(viewBox[3]));
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', title || 'BPMN');
    return svg;
  }

  async function render(viewport, index) {
    viewport.dataset.bpmnState = 'pending';
    const status = document.createElement('p');
    status.className = 'diagram-status';
    status.setAttribute('role', 'status');
    status.textContent = messages.loading;
    viewport.replaceChildren(status);
    viewport.style.overflow = 'auto';
    let viewer, staging, timer, expired = false;
    const destroy = () => { if (viewer) { const instance = viewer; viewer = null; instance.destroy(); } staging?.remove(); };
    try {
      const work = async () => {
        if (!window.BpmnJS || !window.DOMPurify) fail('Embedded BPMN libraries are unavailable.');
        const source = document.getElementById(viewport.dataset.bpmnSourceId);
        if (!source || source.localName !== 'code') fail('BPMN source is missing.');
        const xml = source.textContent;
        validateXML(xml);
        // Attached but invisible: SVG text measurement requires a live layout tree.
        staging = document.createElement('div');
        staging.setAttribute('aria-hidden', 'true');
        staging.style.cssText = 'position:fixed;left:-100000px;top:0;width:1600px;height:1200px;visibility:hidden;pointer-events:none';
        document.body.append(staging);
        viewer = new window.BpmnJS({ container: staging, bpmnRenderer: { defaultFillColor: '#ffffff', defaultStrokeColor: '#222222', defaultLabelColor: '#222222' } });
        viewer.on('import.parse.complete', ({ definitions }) => {
          for (const diagram of definitions.diagrams || []) for (const di of diagram.plane?.planeElement || []) {
            di.set('bioc:fill', '#ffffff'); di.set('bioc:stroke', '#222222');
            di.set('color:background-color', '#ffffff'); di.set('color:border-color', '#222222');
            if (di.label) di.label.set('color:color', '#222222');
          }
        });
        const result = await viewer.importXML(xml);
        if (expired) return;
        if (result.warnings?.length) fail(`BPMN import reported warnings: ${result.warnings.map(w => w.message).join('; ').slice(0, 500)}`);
        checkCoverage(viewer);
        const { svg } = await viewer.saveSVG();
        if (expired) return;
        return sanitizeSVG(svg, `bpmn-${index}-${Array.from(crypto.getRandomValues(new Uint32Array(2)), n => n.toString(16)).join('')}`, viewport.dataset.bpmnTitle);
      };
      const svg = await Promise.race([work(), new Promise((_, reject) => {
        timer = setTimeout(() => { expired = true; reject(new Error(messages.timeout)); }, 15000);
      })]);
      // Preserve the original, unmodified viewer watermark and its link handler.
      // Its visibility is required by the bpmn.io license, including offline HTML.
      const watermark = staging?.querySelector('.bjs-powered-by');
      if (!watermark) fail('BPMN viewer attribution is unavailable.');
      const attribution = document.createElement('div');
      attribution.className = 'bpmn-attribution';
      attribution.append(watermark);
      destroy();
      viewport.replaceChildren(svg);
      viewport.after(attribution);
      viewport.dataset.bpmnState = 'ready';
      return { ok: true };
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      status.textContent = `${messages.error} ${ru && detail !== messages.timeout ? '' : detail}`.trim();
      viewport.replaceChildren(status);
      viewport.dataset.bpmnState = 'error';
      return { ok: false, error: detail };
    } finally {
      clearTimeout(timer);
      try { destroy(); } catch (_) { /* Source and status remain usable even if cleanup fails. */ }
    }
  }
  const start = () => Promise.all([...document.querySelectorAll('[data-bpmn-runtime]')].map(render));
  window.bpmnDiagramsReady = document.readyState === 'loading'
    ? new Promise(resolve => document.addEventListener('DOMContentLoaded', () => resolve(start()), { once: true }))
    : start();
})();
