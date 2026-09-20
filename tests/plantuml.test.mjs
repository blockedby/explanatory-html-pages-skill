import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { JSDOM } from 'jsdom';
import { renderPlantUml } from '../scripts/renderers/plantuml.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
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
  test(`real local Java/Smetana renders ${name}`, async () => {
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
  await assert.rejects(renderPlantUml('@startuml\nAlice -> Bob\nthis is invalid syntax\n@enduml'), /rendering failed.*exit 200[\s\S]*Syntax Error/i);
});

test('real Java render has a bounded deadline', async () => {
  const started = Date.now();
  await assert.rejects(renderPlantUml(simple, { timeoutMs: 1 }), /timed out after 1 ms/);
  assert.ok(Date.now() - started < 5000, 'timed-out process must close promptly');
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

test('missing local tooling has actionable diagnostics', async () => {
  const prior = { JAVA_BIN: process.env.JAVA_BIN, PLANTUML_JAR: process.env.PLANTUML_JAR };
  delete process.env.JAVA_BIN;
  delete process.env.PLANTUML_JAR;
  try {
    await assert.rejects(renderPlantUml(simple, { toolkitRoot: '/missing-toolkit' }), /local tooling unavailable.*JAVA_BIN and PLANTUML_JAR/);
  } finally { restoreEnv(prior); }
});

function restoreEnv(values) {
  for (const [name, value] of Object.entries(values)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
}

test('explicit tool overrides work; hostile Java/profile environment is not inherited', async () => {
  const keys = ['JAVA_BIN', 'PLANTUML_JAR', 'JAVA_TOOL_OPTIONS', 'JDK_JAVA_OPTIONS', 'PLANTUML_SECURITY_PROFILE', 'GRAPHVIZ_DOT'];
  const prior = Object.fromEntries(keys.map((key) => [key, process.env[key]]));
  try {
    process.env.JAVA_BIN = join(root, '.tools/jre/bin/java');
    process.env.PLANTUML_JAR = join(root, '.tools/plantuml.jar');
    process.env.JAVA_TOOL_OPTIONS = '-not-a-real-option';
    process.env.JDK_JAVA_OPTIONS = '-not-a-real-option';
    process.env.PLANTUML_SECURITY_PROFILE = 'UNSECURE';
    process.env.GRAPHVIZ_DOT = '/must-not-run-dot';
    const source = `\uFEFF${simple.replaceAll('\n', '\r\n')}\r\n`;
    const result = await renderPlantUml(source, { toolkitRoot: '/missing-toolkit' });
    assert.equal(result.source, source);
    assert.match(result.svg, /Hello/);
  } finally { restoreEnv(prior); }
});

// Fault injection tests only: every successful-render assertion above uses the
// real prepared JRE/JAR. These exercise OS stream limits and abnormal termination.
test('bounds stdout/stderr and rejects zero-exit non-SVG output', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'plantuml-fault-test-'));
  const prior = { JAVA_BIN: process.env.JAVA_BIN, PLANTUML_JAR: process.env.PLANTUML_JAR };
  try {
    const executable = join(dir, 'fake java; no shell');
    process.env.JAVA_BIN = executable;
    process.env.PLANTUML_JAR = join(root, '.tools/plantuml.jar');
    for (const [program, expected] of [
      ['process.stdout.write("x".repeat(9*1024*1024));', /output exceeds/],
      ['process.stderr.write("x".repeat(70*1024));', /diagnostics exceed/],
      ['process.stdout.write("not SVG");', /single successful SVG/],
      ['process.stdout.write("<svg></svg><svg></svg>");', /single successful SVG/],
      ['process.stdout.write("<svg><text>Syntax Error? (Assumed diagram type: sequence)</text></svg>");', /single successful SVG/],
      ['process.stdout.write("<svg id=\\"error\\"></svg>");', /single successful SVG/],
      ['process.stderr.write("deliberate failure"); process.exit(9);', /exit 9.*deliberate failure/],
    ]) {
      await writeFile(executable, `#!${process.execPath}\nprocess.stdin.resume();\n${program}\n`, { mode: 0o700 });
      await assert.rejects(renderPlantUml(simple), expected);
    }
  } finally {
    restoreEnv(prior);
    await rm(dir, { recursive: true, force: true });
  }
});
