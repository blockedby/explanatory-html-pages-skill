import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { crc32, deflateSync } from 'node:zlib';
import { JSDOM } from 'jsdom';
import { parseContent } from '../scripts/lib/content.mjs';
import { buildDocument } from '../scripts/lib/build.mjs';
import { sourceFile } from '../scripts/lib/paths.mjs';

function chunk(type, data) {
  const body = Buffer.concat([Buffer.from(type), data]);
  const size = Buffer.alloc(4); size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body));
  return Buffer.concat([size, body, crc]);
}
const header = Buffer.from('00000001000000010806000000', 'hex');
const png = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from([0, 30, 60, 90, 255]))), chunk('IEND', Buffer.alloc(0))]);
const content = fragment => `<section id="picture"><h2>Picture</h2>${fragment}</section>`;
async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'image-build-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await writeFile(path.join(root, 'document.json'), JSON.stringify({ title: 'Image example', lang: 'en' }));
  return root;
}

test('content admits only local image src with explicit alt and builder-owned dimensions', () => {
  assert.equal(parseContent(content('<img src="снимок экрана.png" alt="Screen">')).document.querySelector('img').alt, 'Screen');
  assert.doesNotThrow(() => parseContent(content('<img src="decoration.png" alt="">')));
  for (const markup of [
    '<img src="a.png">', '<img alt="missing source">', '<img src="" alt="empty">',
    '<img src="https://example.test/a.png" alt="x">', '<img src="//example.test/a.png" alt="x">',
    '<img src="data:image/png;base64,AAAA" alt="x">', '<img src="file:///tmp/a.png" alt="x">',
    '<img src="a.png?url=remote" alt="x">', '<img src="a.png#fragment" alt="x">',
    '<img src="/tmp/a.png" alt="x">', '<img src="a.png" alt="x" srcset="https://example.test/a.png 2x">',
    '<img src="a.png" alt="x" onerror="alert(1)">', '<img src="a.png" alt="x" width="999999">',
    '<img src="a.png" alt="x" style="width:999999px">', '<div src="a.png">x</div>',
    '<iframe src="a.html"></iframe>'
  ]) assert.throws(() => parseContent(content(markup)), undefined, markup);
});

test('build embeds exact local bytes with alt, caption and intrinsic dimensions, retaining editable source', async t => {
  const root = await workspace(t);
  const filename = path.join(root, 'снимок экрана.png');
  await writeFile(filename, png);
  const authored = content('<figure><img src="снимок экрана.png" alt="A &quot;quoted&quot; screen"><figcaption>Explain what matters.</figcaption></figure>');
  await writeFile(path.join(root, 'content.html'), authored);
  const out = path.join(root, 'report.html');
  const result = await buildDocument(root, { out });
  assert.equal(result.images, 1);
  assert.equal(result.diagrams, 0);
  const document = new JSDOM(await readFile(out, 'utf8')).window.document;
  const image = document.querySelector('img');
  assert.equal(image.src, `data:image/png;base64,${png.toString('base64')}`);
  assert.equal(image.alt, 'A "quoted" screen');
  assert.equal(image.getAttribute('width'), '1');
  assert.equal(image.getAttribute('height'), '1');
  assert.ok(image.classList.contains('document-image'));
  assert.equal(document.querySelector('figure.image-figure figcaption').textContent, 'Explain what matters.');
  assert.equal(document.querySelectorAll('script[src], iframe, [srcset]').length, 0);
  assert.deepEqual(await readFile(filename), png);
  assert.equal(await readFile(path.join(root, 'content.html'), 'utf8'), authored);
});

test('invalid images and escaping symlinks fail atomically, preserving previous output', async t => {
  const root = await workspace(t);
  const outside = await workspace(t);
  const output = path.join(root, 'report.html');
  await writeFile(output, 'previous report');
  await writeFile(path.join(outside, 'outside.png'), png);
  await symlink(path.join(outside, 'outside.png'), path.join(root, 'escape.png'));
  await writeFile(path.join(root, 'fake.png'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  for (const src of ['missing.png', 'fake.png', 'escape.png', '../outside.png']) {
    await writeFile(path.join(root, 'content.html'), content(`<img src="${src}" alt="Test">`));
    await assert.rejects(buildDocument(root, { out: output }));
    assert.equal(await readFile(output, 'utf8'), 'previous report');
  }
});

test('source byte limit overrides are explicit and validated', async t => {
  const root = await workspace(t);
  await writeFile(path.join(root, 'image.png'), png);
  for (const maxBytes of [0, -1, NaN, Infinity, 1.5, '8']) {
    await assert.rejects(sourceFile(root, 'image.png', { maxBytes }), /positive safe integer/);
  }
  await assert.rejects(sourceFile(root, 'image.png', { maxBytes: 1 }), /1-byte limit/);
  assert.equal(await sourceFile(root, 'image.png', { maxBytes: png.length }), path.join(root, 'image.png'));
});

test('document pixel budget also bounds highly compressed images', async t => {
  const root = await workspace(t);
  const largeHeader = Buffer.alloc(13);
  largeHeader.writeUInt32BE(8000, 0); largeHeader.writeUInt32BE(5000, 4); largeHeader[8] = 8;
  const large = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), chunk('IHDR', largeHeader), chunk('IDAT', deflateSync(Buffer.alloc(8001 * 5000))), chunk('IEND', Buffer.alloc(0))]);
  await writeFile(path.join(root, 'large.png'), large);
  const markup = '<img src="large.png" alt="Compressed raster">';
  const out = path.join(root, 'report.html');
  await writeFile(path.join(root, 'content.html'), content(markup.repeat(2)));
  assert.equal((await buildDocument(root, { out })).images, 2);
  const previous = await readFile(out, 'utf8');
  await writeFile(path.join(root, 'content.html'), content(markup.repeat(3)));
  await assert.rejects(buildDocument(root, { out }), /80 million pixels total/);
  assert.equal(await readFile(out, 'utf8'), previous);
});

test('document total image budget counts repeated occurrences', async t => {
  const root = await workspace(t);
  // Valid PNG with a large ancillary text chunk, without a large decoded image.
  const padded = Buffer.concat([png.subarray(0, -12), chunk('tEXt', Buffer.concat([Buffer.from('Padding\0'), Buffer.alloc(7 * 1024 * 1024, 65)])), png.subarray(-12)]);
  await writeFile(path.join(root, 'large.png'), padded);
  await assert.rejects(sourceFile(root, 'large.png'), /2 MiB limit/, 'ordinary sources retain their smaller default limit');
  await writeFile(path.join(root, 'content.html'), content('<img src="large.png" alt="Test">'.repeat(5)));
  const out = path.join(root, 'report.html');
  await writeFile(out, 'previous report');
  await assert.rejects(buildDocument(root, { out }), /32 MiB total/);
  assert.equal(await readFile(out, 'utf8'), 'previous report');
});
