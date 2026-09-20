import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
process.env.PLAYWRIGHT_BROWSERS_PATH ||= path.join(root, '.tools/ms-playwright');
const { chromium } = await import('playwright');
const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-background-networking'] });
test.after(() => browser.close());
const viewer = await readFile(path.join(root, 'node_modules/bpmn-js/dist/bpmn-viewer.production.min.js'), 'utf8');
const purifier = await readFile(path.join(root, 'node_modules/dompurify/dist/purify.min.js'), 'utf8');
const runtime = await readFile(path.join(root, 'assets/bpmn-runtime.js'), 'utf8');
const xml = `<bpmn:definitions xmlns:bpmn="http://www.omg.org/spec/BPMN/20100524/MODEL" xmlns:bpmndi="http://www.omg.org/spec/BPMN/20100524/DI" xmlns:dc="http://www.omg.org/spec/DD/20100524/DC" xmlns:di="http://www.omg.org/spec/DD/20100524/DI" xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" targetNamespace="urn:test">
<bpmn:process id="Process"><bpmn:startEvent id="Start" name="Start"/><bpmn:task id="Task" name="Approve"/><bpmn:sequenceFlow id="Flow" sourceRef="Start" targetRef="Task"/></bpmn:process>
<bpmndi:BPMNDiagram id="Diagram"><bpmndi:BPMNPlane id="Plane" bpmnElement="Process">
<bpmndi:BPMNShape id="Start_di" bpmnElement="Start"><dc:Bounds x="100" y="100" width="36" height="36"/></bpmndi:BPMNShape>
<bpmndi:BPMNShape id="Task_di" bpmnElement="Task" bioc:fill="#ff0000" bioc:stroke="#00ff00"><dc:Bounds x="200" y="80" width="100" height="80"/></bpmndi:BPMNShape>
<bpmndi:BPMNEdge id="Flow_di" bpmnElement="Flow"><di:waypoint x="136" y="118"/><di:waypoint x="200" y="118"/></bpmndi:BPMNEdge>
</bpmndi:BPMNPlane></bpmndi:BPMNDiagram></bpmn:definitions>`;
const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
async function fixture(t, sources = [xml], { lang = 'en', setup = '', libraries = true } = {}) {
  const context = await browser.newContext({ offline: true, serviceWorkers: 'block' });
  t.after(() => context.close());
  const requests = [];
  await context.route('**/*', route => { requests.push(route.request().url()); return route.abort(); });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const script = content => `<script>${content.replace(/<\/script/gi, '<\\/script')}</script>`;
  await page.setContent(`<!doctype html><html lang="${lang}"><body>${sources.map((source, i) => `<figure><div class="diagram-viewport" data-bpmn-runtime data-bpmn-source-id="source-${i}" data-bpmn-title="Test ${i}" tabindex="0" role="region" aria-label="Test diagram"><p class="diagram-status" role="status">Loading</p></div><details class="diagram-source"><summary>XML</summary><pre><code id="source-${i}">${escape(source)}</code></pre></details><figcaption>Test ${i}</figcaption></figure>`).join('')}${libraries ? script(viewer) + script(purifier) : ''}${script('window.originalPrint = window.print;')}${script(setup)}${script(runtime)}</body></html>`);
  return { page, requests, errors, ready: () => page.evaluate(() => window.bpmnDiagramsReady) };
}

test('offline static SVG, two isolated copies, monochrome, responsive and print', async t => {
  const { page, ready, requests, errors } = await fixture(t, [xml, xml]);
  assert.deepEqual(await ready(), [{ ok: true }, { ok: true }]);
  assert.equal(await page.locator('[data-bpmn-state="ready"] > svg').count(), 2);
  assert.equal(await page.locator('.bjs-container').count(), 0, 'viewer staging is destroyed');
  assert.equal(await page.evaluate(() => window.print === window.originalPrint), true);
  const result = await page.locator('.diagram-viewport svg').evaluateAll(svgs => svgs.map(svg => {
    const ids = [...svg.querySelectorAll('[id]')].map(el => el.id);
    const references = [...svg.querySelectorAll('*')].flatMap(el => [...el.attributes].flatMap(attr => [...attr.value.matchAll(/url\(#([^)]*)\)/g)].map(match => match[1])));
    return { ids, references, colors: [...svg.querySelectorAll('*')].map(el => [getComputedStyle(el).fill, getComputedStyle(el).stroke]).flat(), box: svg.getBoundingClientRect().toJSON(), label: svg.getAttribute('aria-label') };
  }));
  for (const [i, svg] of result.entries()) {
    assert.ok(svg.box.width > 100 && svg.box.height > 50);
    assert.equal(svg.label, `Test ${i}`);
    assert.ok(svg.references.length > 0, 'sequence-flow markers survive');
    for (const ref of svg.references) assert.ok(svg.ids.includes(ref), ref);
    assert.ok(!svg.colors.includes('rgb(255, 0, 0)') && !svg.colors.includes('rgb(0, 255, 0)'));
    assert.ok(svg.colors.includes('rgb(34, 34, 34)'));
  }
  assert.equal(new Set(result.flatMap(svg => svg.ids)).size, result.flatMap(svg => svg.ids).length);
  await page.setViewportSize({ width: 390, height: 844 });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.diagram-viewport svg').first().isVisible(), true);
  await page.locator('summary').first().click();
  assert.equal(await page.locator('#source-0').textContent(), xml);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
});

test('source text is inert even with script terminators and malicious HTML labels', async t => {
  const label = '</script><img src="https://attacker.invalid/x" onerror="window.pwned=1">';
  const source = xml.replace('name="Approve"', `name="${escape(label)}"`);
  const { page, ready, requests, errors } = await fixture(t, [source, '</code></pre><script>window.pwned=1</script>']);
  const results = await ready();
  assert.equal(results[0].ok, true);
  assert.equal(results[1].ok, false);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.equal(await page.locator('img, .diagram-viewport script, .diagram-viewport foreignObject').count(), 0);
  assert.equal(await page.locator('#source-0').textContent(), source);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
});

test('malformed, dangerous, missing-DI and missing semantic coverage fail visibly in Russian', async t => {
  const sources = [
    '<broken', '<!DOCTYPE x [<!ENTITY x SYSTEM "https://attacker.invalid/x">]>' + xml,
    xml.replace('<bpmn:process id="Process">', '<bpmn:process id="Process"><bpmn:task id="Hidden"/>'),
    xml.replace('<bpmn:startEvent id="Start" name="Start"/>', '<bpmn:startEvent id="Start" name="Start"/><script xmlns="http://www.w3.org/1999/xhtml">alert(1)</script>'),
    xml.replace(/<bpmndi:BPMNDiagram[\s\S]*<\/bpmndi:BPMNDiagram>/, '')
  ];
  const { page, ready, requests } = await fixture(t, sources, { lang: 'ru' });
  const results = await ready();
  assert.ok(results.every(result => !result.ok && result.error));
  assert.match(results[2].error, /Unrendered BPMN elements/);
  await page.emulateMedia({ media: 'print' });
  for (const status of await page.locator('.diagram-status').all()) {
    assert.match(await status.textContent(), /Не удалось показать BPMN/);
    assert.equal(await status.isVisible(), true);
  }
  assert.equal(await page.locator('.diagram-source code').count(), sources.length);
  assert.deepEqual(requests, []);
});

test('BPMN script-task bodies are displayed as model data and never executed', async t => {
  const source = xml.replace('<bpmn:task id="Task" name="Approve"/>', '<bpmn:scriptTask id="Task" name="Document a script"><bpmn:script>window.pwned = 1;</bpmn:script></bpmn:scriptTask>');
  const { page, ready, requests, errors } = await fixture(t, [source]);
  assert.deepEqual(await ready(), [{ ok: true }]);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.equal(await page.locator('.bpmn-attribution .bjs-powered-by').count(), 1);
  assert.deepEqual(requests, []);
  assert.deepEqual(errors, []);
});
test('missing libraries produce a visible error instead of rejecting readiness', async t => {
  const { page, ready } = await fixture(t, [xml], { libraries: false });
  assert.equal((await ready())[0].ok, false);
  assert.match(await page.locator('.diagram-status').textContent(), /Unable to display BPMN/);
});

test('pending remains printable and asynchronous timeout cleans the viewer', async t => {
  const { page, ready } = await fixture(t, [xml], { setup: `
    const originalTimeout = window.setTimeout;
    window.setTimeout = (fn, ms, ...args) => originalTimeout(fn, ms === 15000 ? 300 : ms, ...args);
    window.BpmnJS = class { on() {} importXML() { return new Promise(() => {}); } destroy() { window.destroyed = true; } };
  ` });
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.diagram-status').isVisible(), true);
  const result = await ready();
  assert.match(result[0].error, /timed out/);
  assert.equal(await page.evaluate(() => window.destroyed), true);
  assert.equal(await page.locator('[aria-hidden="true"]').count(), 0);
  assert.equal(await page.locator('.diagram-status').isVisible(), true);
});

test('export sanitation strips active resources and namespaces marker references', async t => {
  const malicious = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><defs><marker id="arrow"><path d="M0 0L10 5L0 10Z"/></marker></defs><rect width="90" height="90" onload="window.pwned=1" style="fill:url(https://attacker.invalid/fill);stroke:#222"/><path d="M0 0L50 50" marker-end="url(#arrow)"/><image href="https://attacker.invalid/image"/><foreignObject><div xmlns="http://www.w3.org/1999/xhtml">unsafe</div></foreignObject><script>window.pwned=1</script><a href="https://attacker.invalid"><text>link</text></a></svg>`;
  const { page, ready, requests } = await fixture(t, [xml, xml], { setup: `
    const Original = window.BpmnJS;
    window.BpmnJS = function(options) { const instance = new Original(options); instance.saveSVG = async () => ({ svg: ${JSON.stringify(malicious)} }); return instance; };
  ` });
  assert.deepEqual(await ready(), [{ ok: true }, { ok: true }]);
  assert.equal(await page.locator('.diagram-viewport image, .diagram-viewport foreignObject, .diagram-viewport a, .diagram-viewport script, .diagram-viewport [onload]').count(), 0);
  assert.equal(await page.evaluate(() => window.pwned), undefined);
  assert.equal(await page.locator('.diagram-viewport').first().evaluate(el => el.innerHTML.includes('attacker.invalid')), false);
  assert.deepEqual(requests, []);
});

test('unexpected SVG declarations, oversized export and import warnings reject', async t => {
  for (const setup of [
    `instance.saveSVG = async () => ({ svg: '<!DOCTYPE svg><svg xmlns="http://www.w3.org/2000/svg"/>' });`,
    `instance.saveSVG = async () => ({ svg: 'x'.repeat(8 * 1024 * 1024 + 1) });`,
    `const originalImport = instance.importXML.bind(instance); instance.importXML = async xml => { await originalImport(xml); return { warnings: [{ message: 'test warning' }] }; };`
  ]) {
    const { ready } = await fixture(t, [xml], { setup: `const Original = window.BpmnJS; window.BpmnJS = function(options) { const instance = new Original(options); ${setup} return instance; };` });
    assert.equal((await ready())[0].ok, false);
  }
});
