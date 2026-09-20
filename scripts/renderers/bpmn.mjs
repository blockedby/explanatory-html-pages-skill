import { readFile, access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { chromium } from 'playwright';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MAX_BYTES = 2 * 1024 * 1024;

// Run the ready-made layout engine off-thread so its CPU work is cancellable.
async function layout(source, timeoutMs) {
  const moduleUrl = import.meta.resolve('bpmn-auto-layout');
  const moddleUrl = import.meta.resolve('bpmn-moddle');
  const worker = new Worker(`const { parentPort, workerData } = require('node:worker_threads');
    (async () => {
      const { BpmnModdle: Moddle } = await import(workerData.moddleUrl);
      const moddle = new Moddle();
      const before = await moddle.fromXML(workerData.source);
      if (before.warnings.length) throw new Error('input import warnings: ' + before.warnings.map(w => w.message).join('; '));
      const m = await import(workerData.moduleUrl);
      const xml = await m.layoutProcess(workerData.source);
      const after = await moddle.fromXML(xml);
      const lost = Object.keys(before.elementsById).filter(id => !after.elementsById[id]);
      if (lost.length) throw new Error('layout lost elements: ' + lost.join(', ') + '; provide explicit DI');
      return xml;
    })().then(xml => parentPort.postMessage({ xml }), e => parentPort.postMessage({ error: e.message }));`,
  { eval: true, workerData: { source, moduleUrl, moddleUrl }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('BPMN layout timed out')), timeoutMs);
      worker.once('message', result => result.error ? reject(new Error(`BPMN layout: ${result.error}`)) : resolve(result.xml));
      worker.once('error', error => reject(new Error(`BPMN layout: ${error.message}`)));
      worker.once('exit', code => reject(new Error(`BPMN layout worker exited (${code})`)));
    });
  } finally { clearTimeout(timer); await worker.terminate(); }
}

/** Local, bounded BPMN rendering. Raw SVG must pass through the shared sanitizer. */
export async function renderBpmn(source, options = {}) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('BPMN source must be non-empty XML');
  if (Buffer.byteLength(source) > MAX_BYTES) throw new Error('BPMN source exceeds 2 MiB limit');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) throw new Error('BPMN XML DOCTYPE/entities are forbidden');
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('BPMN timeoutMs must be between 1 and 120000');
  const root = resolve(options.toolkitRoot ?? ROOT);
  // Playwright owns the platform/revision-specific executable suffix. Relocate
  // that suffix into the toolkit cache instead of hardcoding Linux or a revision.
  const revisionPath = chromium.executablePath().match(/(?:^|[\\/])(chromium-[^\\/]+[\\/].+)$/)?.[1];
  if (!revisionPath && !process.env.BPMN_CHROMIUM_EXECUTABLE) throw new Error('Cannot resolve the local Playwright Chromium layout; set BPMN_CHROMIUM_EXECUTABLE.');
  const executablePath = process.env.BPMN_CHROMIUM_EXECUTABLE
    ? resolve(process.env.BPMN_CHROMIUM_EXECUTABLE)
    : resolve(process.env.PLAYWRIGHT_BROWSERS_PATH || resolve(root, '.tools/ms-playwright'), revisionPath);
  const bundlePath = resolve(root, 'node_modules/bpmn-js/dist/bpmn-viewer.production.min.js');
  try { await access(executablePath); await access(bundlePath); }
  catch (error) { throw new Error(`BPMN local runtime unavailable; prepare Chromium and bpmn-js under ${root}: ${error.message}`); }
  const deadline = Date.now() + timeoutMs;
  const remaining = () => Math.max(1, deadline - Date.now());
  let browser, timer;
  let expired = false;
  const warnings = [];
  const work = async () => {
    browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox', '--disable-background-networking'], timeout: remaining() });
    if (expired) { await browser.close(); throw new Error('BPMN launch exceeded runtime deadline'); }
    const context = await browser.newContext({ serviceWorkers: 'block', offline: true });
    const requests = [];
    await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<!doctype html><html><body><div id="canvas" style="width:1600px;height:1200px"></div></body></html>');
    const needsLayout = await page.evaluate(xml => {
      const doc = new DOMParser().parseFromString(xml, 'application/xml');
      const fail = message => { throw new Error(`BPMN XML: ${message}`); };
      if (doc.querySelector('parsererror')) fail(doc.querySelector('parsererror').textContent.slice(0, 500));
      const ns = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
      if (doc.documentElement.namespaceURI !== ns || doc.documentElement.localName !== 'definitions') fail('expected BPMN definitions root');
      const all = [...doc.getElementsByTagName('*')];
      if (all.length > 10000) fail('exceeds 10000 XML elements');
      const ids = new Set();
      for (const el of all) {
        if (el.hasAttribute('id')) {
          const id = el.getAttribute('id');
          if (!id || ids.has(id)) fail(`empty or duplicate id: ${id}`);
          ids.add(id);
        }
      }
      const diagrams = doc.getElementsByTagNameNS('http://www.omg.org/spec/BPMN/20100524/DI', 'BPMNDiagram');
      if (diagrams.length > 1) fail('multiple diagrams are not supported; supply one complete diagram');
      if (diagrams.length) return false;
      const elements = all.filter(el => el.namespaceURI === ns);
      const unsupported = elements.find(el => ['collaboration', 'participant', 'lane', 'laneSet', 'messageFlow', 'subProcess', 'adHocSubProcess', 'transaction', 'group', 'textAnnotation', 'association', 'dataObjectReference', 'dataStoreReference', 'dataInputAssociation', 'dataOutputAssociation'].includes(el.localName));
      if (unsupported) fail(`missing DI: auto-layout does not safely support ${unsupported.localName}; provide explicit BPMN DI`);
      if (elements.filter(el => el.localName === 'process').length !== 1) fail('missing DI requires exactly one process; provide explicit BPMN DI');
      return true;
    }, source);
    if (needsLayout) {
      source = await layout(source, remaining());
      if (Buffer.byteLength(source) > MAX_BYTES) throw new Error('BPMN laid-out XML exceeds 2 MiB limit');
      warnings.push('Generated BPMN DI with bpmn-auto-layout; returned source includes editable layout.');
    }
    await page.addScriptTag({ content: await readFile(bundlePath, 'utf8') });
    const svg = await page.evaluate(async xml => {
      const viewer = new window.BpmnJS({ container: '#canvas', bpmnRenderer: { defaultFillColor: '#ffffff', defaultStrokeColor: '#222222', defaultLabelColor: '#222222' } });
      // Ignore author colors in the rendered copy only; notation markers remain intact.
      viewer.on('import.parse.complete', ({ definitions }) => {
        for (const diagram of definitions.diagrams || []) {
          for (const di of diagram.plane?.planeElement || []) {
            di.set('bioc:fill', '#ffffff');
            di.set('bioc:stroke', '#222222');
            di.set('color:background-color', '#ffffff');
            di.set('color:border-color', '#222222');
            if (di.label) di.label.set('color:color', '#222222');
          }
        }
      });
      try {
        const result = await viewer.importXML(xml);
        if (result.warnings.length) throw new Error(`import warnings: ${result.warnings.map(w => w.message).join('; ')}`);
        const registry = viewer.get('elementRegistry');
        const seen = new Set();
        const missing = [];
        const visit = obj => {
          if (!obj || typeof obj !== 'object' || seen.has(obj)) return;
          seen.add(obj);
          if (obj.$instanceOf && ['bpmn:FlowNode', 'bpmn:SequenceFlow', 'bpmn:Participant', 'bpmn:Lane', 'bpmn:MessageFlow', 'bpmn:Artifact', 'bpmn:DataObjectReference', 'bpmn:DataStoreReference', 'bpmn:DataAssociation'].some(type => obj.$instanceOf(type))) {
            const element = registry.get(obj.id);
            if (!element || !registry.getGraphics(element) || element.hidden) missing.push(obj.id || obj.$type);
          }
          for (const [key, value] of Object.entries(obj)) {
            if (key.startsWith('$') || key === 'di') continue;
            if (Array.isArray(value)) value.forEach(visit); else visit(value);
          }
        };
        visit(viewer.getDefinitions());
        if (missing.length) throw new Error(`unrendered elements: ${missing.slice(0, 20).join(', ')}; supply complete explicit DI (including expanded subprocesses); for auto-layout include incoming/outgoing flow references`);
        const elements = registry.getAll().filter(el => el.type !== 'bpmn:Process' && el.type !== 'bpmn:Collaboration');
        if (!elements.length) throw new Error('no renderable elements');
        for (const el of elements) {
          const points = el.waypoints || [{ x: el.x, y: el.y }, { x: el.x + el.width, y: el.y + el.height }];
          if (points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || Math.abs(p.x) > 100000 || Math.abs(p.y) > 100000)) throw new Error(`invalid or excessive DI bounds: ${el.id}`);
          if (!el.waypoints && (!(el.width > 0) || !(el.height > 0))) throw new Error(`invalid DI dimensions: ${el.id}`);
        }
        return (await viewer.saveSVG()).svg;
      } catch (error) { throw new Error(`BPMN import/render: ${error.message}`); }
      finally { viewer.destroy(); }
    }, source);
    if (requests.length) throw new Error('BPMN rendering attempted a forbidden network request');
    if (errors.length) throw new Error(`BPMN browser runtime: ${errors.join('; ')}`);
    if (Buffer.byteLength(svg) > 8 * 1024 * 1024) throw new Error('BPMN SVG exceeds 8 MiB limit');
    return { svg, source, extension: 'bpmn', warnings };
  };
  try {
    return await Promise.race([work(), new Promise((_, reject) => {
      timer = setTimeout(() => { expired = true; reject(new Error(`BPMN runtime timed out after ${timeoutMs}ms`)); }, remaining());
    })]);
  } catch (error) { throw new Error(`BPMN rendering failed: ${error.message}`, { cause: error }); }
  finally { clearTimeout(timer); if (browser) await browser.close(); }
}
