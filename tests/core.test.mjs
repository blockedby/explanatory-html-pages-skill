import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, mkdir, symlink, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createDocument } from '../scripts/lib/create.mjs';
import { parseContent, readMetadata } from '../scripts/lib/content.mjs';
import { sourceFile, atomicOutput } from '../scripts/lib/paths.mjs';

async function workspace(t) { const root = await mkdtemp(path.join(os.tmpdir(), 'document-test-')); t.after(() => rm(root, { recursive: true, force: true })); return root; }
test('scaffold creates only editable source, never overwrites', async t => {
  const root = await workspace(t); const target = path.join(root, 'new');
  await createDocument(target, { title: 'Документ', lang: 'ru' });
  const content = await readFile(path.join(target, 'content.html'), 'utf8');
  assert.doesNotMatch(content, /<style|<script|<html/);
  assert.equal(readMetadata(await readFile(path.join(target, 'document.json'), 'utf8')).title, 'Документ');
  assert.ok(parseContent(content).topics.length > 0);
  await assert.rejects(createDocument(target, { title: 'Overwrite' }), /already exists/);
  assert.equal(await readFile(path.join(target, 'content.html'), 'utf8'), content);
});
test('metadata is explicit and validated', () => {
  assert.throws(() => readMetadata('{'), /JSON/);
  assert.throws(() => readMetadata('{"title":"x","lang":"zz"}'), /languages/);
  assert.throws(() => readMetadata('{"title":"x","lang":"en","css":"evil"}'), /Unknown/);
});
test('Unicode headings create stable distinct IDs; references must exist', () => {
  const content = '<section><h2>Проверка заказа</h2><p>Текст.</p></section><section><h2>Проверка заказа</h2></section>';
  const first = parseContent(content); const second = parseContent(content);
  assert.deepEqual(first.topics, second.topics);
  assert.deepEqual(first.topics.map(topic => topic.id), ['проверка-заказа', 'проверка-заказа-2']);
  assert.throws(() => parseContent('<section id="topic-panel"><h2>Title</h2></section>'), /reserved/);
  assert.throws(() => parseContent('<section><h2>Title</h2><a href="#missing">Go</a></section>'), /Missing anchor/);
});
test('content rejects custom scripts/styles/remote resources and duplicate attributes', () => {
  for (const fragment of ['<script>alert(1)</script>', '<style>body{display:none}</style>', '<img src="https://bad.test/a">', '<p onclick="bad()">x</p>', '<a href="javascript:alert(1)">x</a>', '<p id="a" id="b">x</p>']) {
    assert.throws(() => parseContent(`<section><h2>Title</h2>${fragment}</section>`));
  }
});
test('source paths reject traversal and symlink escape', async t => {
  const root = await workspace(t); const source = path.join(root, 'source'); await mkdir(source);
  await writeFile(path.join(root, 'secret.txt'), 'outside');
  await symlink(path.join(root, 'secret.txt'), path.join(source, 'link.txt'));
  await assert.rejects(sourceFile(source, '../secret.txt'), /escapes/);
  await assert.rejects(sourceFile(source, 'link.txt'), /escapes/);
});
test('atomic output protects sources and refuses symlink targets', async t => {
  const root = await workspace(t); const source = path.join(root, 'content.html'); await writeFile(source, 'original');
  await assert.rejects(atomicOutput(source, 'bad', [source]), /overwrite/);
  await symlink(source, path.join(root, 'out.html'));
  await assert.rejects(atomicOutput(path.join(root, 'out.html'), 'bad'), /symlink/);
  assert.equal(await readFile(source, 'utf8'), 'original');
});
