import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { JSDOM } from 'jsdom';
import { createDocument } from '../scripts/lib/create.mjs';
import { buildDocument } from '../scripts/lib/build.mjs';
import { toolkitRoot } from '../scripts/lib/paths.mjs';
import { prepareBpmn } from '../scripts/renderers/bpmn.mjs';
const execute = promisify(execFile);
async function workspace(t) { const root = await mkdtemp(path.join(os.tmpdir(), 'document-build-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }

test('scaffold/build works from another cwd and embeds canonical assets', async t => {
  const root = await workspace(t); const source = path.join(root, 'doc');
  const cli = path.join(toolkitRoot, 'scripts/document.mjs');
  await execute(process.execPath, [cli, 'create', source, '--title', 'A <safe> title', '--lang', 'ru'], { cwd: os.tmpdir() });
  await execute(process.execPath, [cli, 'build', source, '--out', path.join(root, 'result.html')], { cwd: os.tmpdir() });
  const html = await readFile(path.join(root, 'result.html'), 'utf8');
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelectorAll('h1').length, 1);
  assert.equal(document.querySelector('h1').textContent, 'A <safe> title');
  assert.equal(document.documentElement.lang, 'ru');
  assert.equal(document.querySelectorAll('.toc a').length, 2);
  assert.equal(document.querySelectorAll('script[src],link[rel="stylesheet"],img[src],iframe').length, 0);
  assert.ok(html.includes(await readFile(path.join(toolkitRoot, 'assets/theme.css'), 'utf8')));
  assert.ok(html.includes(await readFile(path.join(toolkitRoot, 'assets/components.css'), 'utf8')));
  assert.ok(html.includes(await readFile(path.join(toolkitRoot, 'assets/navigation.js'), 'utf8')));
});
test('CLI runs through a skill-directory symlink used by agent installers', async t => {
  const root = await workspace(t);
  const link = path.join(root, 'installed-skill');
  await symlink(toolkitRoot, link, 'junction');
  const cli = path.join(link, 'scripts/document.mjs');
  const source = path.join(root, 'document');
  const options = { cwd: os.tmpdir() };
  const created = await execute(process.execPath, [cli, 'create', source, '--title', 'Linked skill'], options);
  assert.match(created.stdout, /Created:/);
  const output = path.join(root, 'report.html');
  const built = await execute(process.execPath, [cli, 'build', source, '--out', output], options);
  assert.match(built.stdout, /Built:/);
  assert.match(await readFile(output, 'utf8'), /Linked skill/);
  const diagnosed = await execute(process.execPath, [cli, 'doctor'], options);
  assert.equal(JSON.parse(diagnosed.stdout).ready, true);
});
test('failed builds preserve previous output and cannot overwrite source', async t => {
  const root = await workspace(t); const source = path.join(root, 'doc');
  await createDocument(source, { title: 'Build recovery' });
  const out = path.join(root, 'report.html');
  await buildDocument(source, { out });
  const previous = await readFile(out, 'utf8');
  await writeFile(path.join(source, 'content.html'), '<section><h2>Diagram</h2><figure data-diagram="plantuml" data-source="diagrams/missing.puml"><figcaption>Missing source</figcaption></figure></section>');
  await assert.rejects(buildDocument(source, { out }));
  assert.equal(await readFile(out, 'utf8'), previous);
  await writeFile(path.join(source, 'content.html'), '<section><h2>Valid content</h2></section>');
  await assert.rejects(buildDocument(source, { out: path.join(source, 'content.html') }), /overwrite/);
});
test('every localized preset builds with retained sources and BPMN reader assets', async t => {
  const root = await workspace(t);
  for (const lang of ['en', 'ru']) for (const preset of ['explainer', 'process', 'integration']) {
    const source = path.join(root, `${preset}-${lang}`);
    await createDocument(source, { title: `${preset} ${lang}`, lang, preset });
    const out = path.join(root, `${preset}-${lang}.html`);
    const result = await buildDocument(source, { out });
    const document = new JSDOM(await readFile(out, 'utf8')).window.document;
    assert.equal(result.diagrams, preset === 'explainer' ? 0 : 1);
    if (result.diagrams) {
      const raw = document.querySelector('.diagram-source code').textContent;
      const download = document.querySelector('.diagram-source a[download]').getAttribute('href');
      assert.equal(decodeURIComponent(download.split(',').slice(1).join(',')), raw);
      assert.match(raw, preset === 'process' ? /BPMNDiagram/ : /@startuml/);
      if (preset === 'process') {
        assert.equal(document.querySelector('.diagram-viewport svg'), null, 'BPMN is rendered by the reader, not the builder');
        const viewport = document.querySelector('[data-bpmn-runtime]');
        assert.equal(viewport.dataset.bpmnState, 'pending');
        assert.equal(document.getElementById(viewport.dataset.bpmnSourceId).textContent, raw);
        assert.equal(document.querySelectorAll('script[data-bpmn-library]').length, 3);
        assert.ok(document.querySelector('noscript').textContent.length > 0);
      } else {
        assert.equal(document.querySelector('.diagram-viewport svg').getAttribute('role'), 'img');
        assert.equal(document.querySelectorAll('script[data-bpmn-library]').length, 0);
      }
      assert.equal(document.querySelector('figure.diagram-rendered').lastElementChild.localName, 'figcaption');
    }
  }
});
test('localized figure assembly preserves text, serialization, IDs and accessible fallbacks', async t => {
  const root = await workspace(t);
  const caption = `Quotes "double" 'single' & </figcaption><script>window.INJECTED=1</script>`;
  const payload = `"quoted" & </code></pre><script>window.INJECTED=1</script>`;
  const escape = value => value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  const attribute = value => escape(value).replaceAll('"', '&quot;');
  for (const lang of ['en', 'ru']) {
    const source = path.join(root, lang);
    await createDocument(source, { title: 'Figure regression', lang, preset: 'process' });
    const bpmnFile = path.join(source, 'diagrams/process.bpmn');
    // Pre-existing DI keeps authored XML byte-for-byte rather than generating layout.
    const prepared = await prepareBpmn(await readFile(bpmnFile, 'utf8'));
    const bpmn = prepared.source.replace('</bpmn:definitions>', `<!-- ${payload} -->\n</bpmn:definitions>`);
    assert.ok(bpmn.includes(payload));
    const puml = `@startuml\n' ${payload}\nAlice -> Bob: Hello\n@enduml\n`;
    await writeFile(bpmnFile, bpmn);
    await writeFile(path.join(source, 'diagrams/message.puml'), puml);
    await writeFile(path.join(source, 'content.html'), `<section id="figures"><h2>Figures</h2><figure id="uml" data-diagram="plantuml" data-source="diagrams/message.puml"><figcaption>${escape(caption)}</figcaption></figure><figure id="bpmn" data-diagram="bpmn" data-source="diagrams/process.bpmn"><figcaption>${escape(caption)}</figcaption></figure></section>`);
    const out = path.join(root, `${lang}.html`);
    await buildDocument(source, { out });
    const document = new JSDOM(await readFile(out, 'utf8')).window.document;
    const labels = lang === 'ru'
      ? ['Исходник диаграммы', 'Скачать исходник', 'Диаграмма; прокручивайте по горизонтали для просмотра', 'Для отображения BPMN включите JavaScript. Исходник доступен ниже.', 'Диаграмма BPMN появится при открытии HTML с включённым JavaScript. Перед печатью дождитесь её загрузки.']
      : ['Diagram source', 'Download source', 'Diagram; scroll horizontally to inspect', 'Enable JavaScript to display BPMN. The diagram source is available below.', 'The BPMN diagram renders when this HTML is opened with JavaScript enabled. Wait for it before printing.'];
    for (const [index, raw] of [puml, bpmn].entries()) {
      const isBpmn = index === 1;
      const prefix = `rendered-diagram-${index + 1}`;
      const figure = document.getElementById(isBpmn ? 'bpmn' : 'uml');
      const viewport = figure.firstElementChild;
      assert.deepEqual([...figure.children].map(node => node.localName), ['div', 'details', 'figcaption']);
      assert.equal(figure.lastElementChild.textContent, caption);
      assert.equal(figure.className, 'diagram-rendered');
      assert.equal(figure.hasAttribute('data-diagram') || figure.hasAttribute('data-source'), false);
      const attributes = [['class', 'diagram-viewport'], ['tabindex', '0'], ['role', 'region'], ['aria-label', `${labels[2]}: ${caption}`]];
      if (isBpmn) attributes.push(['data-bpmn-runtime', ''], ['data-bpmn-source-id', `${prefix}-source`], ['data-bpmn-title', caption], ['data-bpmn-state', 'pending']);
      assert.deepEqual([...viewport.attributes].map(({ name, value }) => [name, value]), attributes);
      const details = figure.querySelector('details');
      const href = `data:text/plain;charset=utf-8,${encodeURIComponent(raw)}`;
      assert.equal(details.outerHTML, `<details class="diagram-source deep-dive"><summary>${labels[0]}</summary><pre><code${isBpmn ? ` id="${prefix}-source"` : ''}>${escape(raw)}</code></pre><a download="diagram-${index + 1}.${isBpmn ? 'bpmn' : 'puml'}" href="${attribute(href)}">${labels[1]}</a></details>`);
      assert.equal(details.querySelector('code').textContent, raw);
      assert.equal(decodeURIComponent(details.querySelector('a').getAttribute('href').split(',')[1]), raw);
      if (isBpmn) {
        assert.equal(viewport.innerHTML, `<p class="diagram-status" role="status">${labels[4]}</p><noscript>${labels[3]}</noscript>`);
        assert.equal(document.getElementById(`${prefix}-source`), details.querySelector('code'));
      } else {
        const svg = viewport.querySelector('svg');
        assert.equal(svg.getAttribute('role'), 'img');
        assert.equal(document.getElementById(svg.getAttribute('aria-labelledby')).textContent, caption);
        for (const node of svg.querySelectorAll('[id]')) assert.ok(node.id.startsWith(`${prefix}-`));
      }
    }
    const ids = [...document.querySelectorAll('[id]')].map(node => node.id);
    assert.equal(new Set(ids).size, ids.length);
    assert.equal(document.querySelectorAll('script').length, 4);
    assert.equal(document.querySelectorAll('script[data-bpmn-library]').length, 3);
    assert.equal(document.querySelectorAll('figure script, figure img').length, 0);
  }
});
test('BPMN builds without an installed browser and embeds XML only as inert escaped text', async t => {
  const root = await workspace(t);
  const source = path.join(root, 'process');
  await createDocument(source, { title: 'Offline BPMN', preset: 'process' });
  const file = path.join(source, 'diagrams/process.bpmn');
  const original = await readFile(file, 'utf8');
  await writeFile(file, original.replace('Review expense evidence', '&lt;/script&gt;&lt;script&gt;window.INJECTED=1&lt;/script&gt;'));
  const out = path.join(root, 'process.html');
  await execute(process.execPath, [path.join(toolkitRoot, 'scripts/document.mjs'), 'build', source, '--out', out], {
    env: { ...process.env, BPMN_CHROMIUM_EXECUTABLE: '/missing/browser', PLAYWRIGHT_BROWSERS_PATH: '/missing/browser-cache', JAVA_BIN: '/missing/java' }
  });
  const html = await readFile(out, 'utf8');
  const document = new JSDOM(html).window.document;
  assert.equal(document.querySelectorAll('script[data-bpmn-library]').length, 3);
  assert.equal(document.querySelectorAll('script').length, 4);
  assert.equal(document.querySelectorAll('script[src],link[rel="stylesheet"],iframe,img').length, 0);
  assert.match(document.querySelector('.diagram-source code').textContent, /INJECTED/);
  assert.equal(await readFile(file, 'utf8'), original.replace('Review expense evidence', '&lt;/script&gt;&lt;script&gt;window.INJECTED=1&lt;/script&gt;'));
});
test('unknown flags and duplicate flags fail rather than silently changing behavior', async () => {
  const cli = path.join(toolkitRoot, 'scripts/document.mjs');
  await assert.rejects(execute(process.execPath, [cli, 'create', '/tmp/never-created', '--force', 'true']));
  await assert.rejects(execute(process.execPath, [cli, 'create', '/tmp/never-created', '--title', 'one', '--title', 'two']));
});
