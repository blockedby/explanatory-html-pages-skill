import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { JSDOM } from 'jsdom';
import { createDocument } from '../scripts/lib/create.mjs';
import { buildDocument } from '../scripts/lib/build.mjs';
import { toolkitRoot } from '../scripts/lib/paths.mjs';
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
test('every localized preset builds with real diagram renderers and retained sources', async t => {
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
      assert.equal(document.querySelector('.diagram-viewport svg').getAttribute('role'), 'img');
      assert.equal(document.querySelector('figure.diagram-rendered').lastElementChild.localName, 'figcaption');
    }
  }
});
test('unknown flags and duplicate flags fail rather than silently changing behavior', async () => {
  const cli = path.join(toolkitRoot, 'scripts/document.mjs');
  await assert.rejects(execute(process.execPath, [cli, 'create', '/tmp/never-created', '--force', 'true']));
  await assert.rejects(execute(process.execPath, [cli, 'create', '/tmp/never-created', '--title', 'one', '--title', 'two']));
});
