import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { Worker } from 'node:worker_threads';
import { JSDOM } from 'jsdom';
import { renderPlantUml } from '../scripts/renderers/plantuml.mjs';

const simple = '@startuml\nAlice -> Bob: Hello\n@enduml';
const cases = {
  sequence: ['Customer', 'API', 'Ledger', 'Accepted', 'Explain limit'],
  state: ['Draft', 'Submitted', 'Approved', 'Rejected'],
  activity: ['Receive request', 'Save order', 'Return validation errors'],
  usecase: ['Customer', 'Reviewer', 'Place order', 'Check credit'],
  component: ['Gateway', 'Orders', 'Ledger', 'OrderAccepted'],
  deployment: ['Client device', 'Application host', 'PostgreSQL', 'HTTPS'],
  er: ['Customer', 'Purchase', 'customer_id', 'purchase_id', 'places'],
};

for (const [name, labels] of Object.entries(cases)) {
  test(`real offline JS/Viz.js renders ${name}`, async () => {
    const source = await readFile(new URL(`./fixtures/plantuml/${name}.puml`, import.meta.url), 'utf8');
    const result = await renderPlantUml(source);
    assert.equal(result.source, source);
    assert.equal(result.extension, 'puml');
    assert.deepEqual(result.warnings, []);
    const dom = new JSDOM(result.svg, { contentType: 'image/svg+xml' });
    try {
      const svg = dom.window.document.documentElement;
      assert.equal(svg.localName, 'svg');
      assert.equal(svg.namespaceURI, 'http://www.w3.org/2000/svg');
      assert.ok(svg.getAttribute('viewBox'));
      const text = [...svg.querySelectorAll('text')].map((node) => node.textContent).join(' ');
      for (const label of labels) assert.ok(text.includes(label), `missing ${label}: ${text}`);
      assert.ok(svg.querySelector('path, line, polygon'), 'real diagram geometry');
      assert.equal(svg.querySelector('image'), null);
      assert.doesNotMatch(result.svg, /Syntax Error|An error has occurred|SRC=|plantuml-error|Please.use.CSS.style/i);
      for (const color of result.svg.matchAll(/#[0-9a-f]{6}\b/gi)) {
        const rgb = color[0].slice(1).toLowerCase();
        assert.ok(rgb.slice(0, 2) === rgb.slice(2, 4) && rgb.slice(2, 4) === rgb.slice(4, 6), `not monochrome: ${color[0]}`);
      }
    } finally { dom.window.close(); }
  });
}

test('real syntax failure is rejected, never returned as an error SVG', async () => {
  await assert.rejects(renderPlantUml('@startuml\nAlice -> Bob\nthis is invalid syntax\n@enduml'), /rendering failed.*syntax check.*Syntax Error/i);
});

test('real JS render has a bounded deadline', async () => {
  const started = Date.now();
  await assert.rejects(renderPlantUml(simple, { timeoutMs: 1 }), /timed out after 1 ms/);
  assert.ok(Date.now() - started < 5000, 'timed-out worker must close promptly');
});

test('deadline interrupts a busy engine without blocking the parent event loop', async () => {
  let ticks = 0;
  const interval = setInterval(() => { ticks++; }, 20);
  const started = Date.now();
  try {
    const source = `@startuml\n${'A -> B: message\n'.repeat(15000)}@enduml`;
    await assert.rejects(renderPlantUml(source, { timeoutMs: 800 }), /timed out after 800 ms/);
    assert.ok(ticks >= 5, `parent only ticked ${ticks} times`);
    assert.ok(Date.now() - started < 5000, 'busy worker must terminate promptly');
  } finally { clearInterval(interval); }
});

test('rejects includes, preprocessors, resource loading and renderer overrides before launch', async () => {
  for (const directive of [
    '!include /etc/passwd', '!includeurl https://example.invalid/a', '!include <C4/C4>',
    '!theme plain', '!pragma layout dot', '!define X test', '!function $f()',
    '!$x = %load_json("https://example.invalid")', '!while true',
    'title %getenv("HOME")', 'title %load_file("/etc/passwd")',
    'note "<img:https://example.invalid/a.png>" as N',
    'note "<img:/etc/passwd>" as N', '<style>\nroot { FontColor red }\n</style>',
    'skinparam monochrome false', 'skin rose', 'newpage',
    '!inc\\\nlude /etc/passwd', 'title %load_\\\njson("file")',
  ]) {
    await assert.rejects(renderPlantUml(`@startuml\n${directive}\nAlice -> Bob\n@enduml`, { toolkitRoot: '/missing-toolkit' }), /unsafe or unsupported directive/, directive);
  }
});

test('rejects invalid envelopes, types, control characters and excess source', async () => {
  for (const source of ['', 'Alice -> Bob', '@startuml output.svg\nAlice -> Bob\n@enduml',
    `${simple}\n${simple}`, `${simple}\ntrailing`, '@startjson\n{}\n@endjson',
    '@startuml\nAlice -> Bob\u0000\n@enduml']) {
    await assert.rejects(renderPlantUml(source), /exactly one|control characters/);
  }
  for (const body of ['', "' comment only", "/' block comment '/"]) {
    await assert.rejects(renderPlantUml(`@startuml\n${body}\n@enduml`), /must contain diagram content/);
  }
  await assert.rejects(renderPlantUml(null), /must be a string/);
  await assert.rejects(renderPlantUml(`@startuml\n${'я'.repeat(140000)}\n@enduml`), /256 KiB/);
  for (const timeoutMs of [0, -1, 1.5, Infinity, NaN, 120001, '100']) {
    await assert.rejects(renderPlantUml(simple, { timeoutMs }), /timeoutMs/);
  }
});

test('renders with no toolkit, executable PATH or inherited runtime options', async () => {
  const keys = ['PATH', 'NODE_OPTIONS', 'JAVA_BIN', 'PLANTUML_JAR', 'JAVA_TOOL_OPTIONS', 'GRAPHVIZ_DOT'];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    for (const key of keys) process.env[key] = '/must-not-be-used';
    const source = `\uFEFF${simple.replaceAll('\n', '\r\n')}\r\n`;
    const result = await renderPlantUml(source, { toolkitRoot: '/missing-toolkit' });
    assert.equal(result.source, source);
    assert.match(result.svg, /Hello/);
  } finally {
    for (const [key, value] of Object.entries(prior)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test('resource URLs are rejected without contacting a local server', async () => {
  let requests = 0;
  const server = createServer((_request, response) => { requests++; response.end('unexpected'); });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const url = `http://127.0.0.1:${server.address().port}/resource`;
    for (const body of [`!includeurl ${url}`, `Alice -> Bob: <img:${url}>`, `title %load_json("${url}")`]) {
      await assert.rejects(renderPlantUml(`@startuml\n${body}\n@enduml`), /unsafe/);
    }
    assert.match((await renderPlantUml(simple)).svg, /Hello/);
    assert.equal(requests, 0);
  } finally { await new Promise((resolve) => server.close(resolve)); }
});

test('worker blocks network APIs and WASM growth; real engine enforces output cap', async () => {
  const workerUrl = new URL('../scripts/renderers/plantuml-worker.mjs', import.meta.url).href;
  // Load the actual worker/engine, then probe its isolation in that same realm.
  const program = `
    const { parentPort } = await import('node:worker_threads');
    await import(${JSON.stringify(workerUrl)});
    const assert = (await import('node:assert/strict')).default;
    for (const name of ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'WebTransport']) {
      assert.throws(() => globalThis[name]('http://127.0.0.1:9'), /network access is disabled/);
    }
    for (const [module, method] of [['http', 'request'], ['https', 'get'], ['http2', 'connect'], ['net', 'connect'], ['tls', 'connect'], ['dgram', 'createSocket'], ['dns', 'lookup']]) {
      assert.throws(() => require('node:' + module)[method]('127.0.0.1'), /network access is disabled/);
    }
    assert.throws(() => new WebAssembly.Memory({ initial: 1 }).grow(2048), /128 MiB/);
    parentPort.postMessage({ probesPassed: true });
  `;
  const worker = new Worker(`(async () => { ${program} })().catch(error => { throw error; });`, {
    eval: true, execArgv: [], env: {}, stdout: true, stderr: true,
    workerData: { source: simple, maxOutputBytes: 128, maxDiagnosticBytes: 65536 },
    resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32 },
  });
  const messages = [];
  let timer;
  try {
    await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error('worker probes timed out')), 15000);
      worker.on('error', reject);
      worker.on('message', (message) => { messages.push(message); if (message.probesPassed) resolve(); });
      worker.on('exit', () => { if (!messages.some((message) => message.probesPassed)) reject(new Error('probe worker exited early')); });
      worker.stdout.resume();
      worker.stderr.resume();
    });
    assert.match(messages[0].error, /output exceeds the 8 MiB limit/);
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
});

test('real large diagram is bounded and the renderer recovers', async () => {
  const source = `@startuml\n${'A -> B: message\n'.repeat(15000)}@enduml`;
  assert.ok(Buffer.byteLength(source) < 256 * 1024);
  await assert.rejects(renderPlantUml(source, { timeoutMs: 120000 }), /8 MiB|resource limit|memory limit|heap|diagnostics exceed/i);
  assert.match((await renderPlantUml(simple)).svg, /Hello/);
});
