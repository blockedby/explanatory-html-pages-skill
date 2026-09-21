import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, realpath, rm, symlink, truncate, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {
  MAX_IMAGE_BYTES,
  MAX_IMAGE_PIXELS,
  prepareImage,
} from '../scripts/lib/images.mjs';

const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAIAAAADCAYAAAC56t6BAAAAFUlEQVR4nGP8z8Dwn4GBgYEJRKAwADE7AgRVI0g0AAAAAElFTkSuQmCC';
const JPEG = '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAYEBQYFBAYGBQYHBwYIChAKCgkJChQODwwQFxQYGBcUFhYaHSUfGhsjHBYWICwgIyYnKSopGR8tMC0oMCUoKSj/2wBDAQcHBwoIChMKChMoGhYaKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCgoKCj/wAARCAADAAIDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDzqiiivjj+kT//2Q==';
const WEBP_VP8 = 'UklGRjwAAABXRUJQVlA4IDAAAADQAQCdASoCAAMAAUAmJaACdLoB+AADsAD+8ut//NgVzXPv9//S4P0uD9Lg/9KQAAA=';
const WEBP_VP8L = 'UklGRhwAAABXRUJQVlA4TA8AAAAvAYAAAAcQ/Y/+ByKi/wEA';
const WEBP_VP8X = 'UklGRl4AAABXRUJQVlA4WAoAAAAQAAAAAQAAAgAAQUxQSAcAAAAAgICAgICAAFZQOCAwAAAA0AEAnQEqAgADAAFAJiWgAnS6AfgAA7AA/vLrf/zYFc1z7/f/0uD9Lg/S4P/SkAAA';

async function workspace(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'image-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

async function fixture(root, name, base64) {
  const data = Buffer.from(base64, 'base64');
  await writeFile(path.join(root, name), data);
  return data;
}

async function expectPrepared(root, name, base64, mime) {
  const data = await fixture(root, name, base64);
  const result = await prepareImage(root, name);
  assert.deepEqual(result, {
    filename: await realpath(path.join(root, name)),
    dataUrl: `data:${mime};base64,${base64}`,
    width: 2,
    height: 3,
    bytes: data.length,
    mime,
  });
}

test('exports the fixed byte and pixel limits', () => {
  assert.equal(MAX_IMAGE_BYTES, 8 * 1024 * 1024);
  assert.equal(MAX_IMAGE_PIXELS, 40_000_000);
});

test('embeds PNG and JPEG bytes exactly with canonical filenames', async t => {
  const root = await workspace(t);
  await expectPrepared(root, 'pixel.PNG', PNG, 'image/png');
  await expectPrepared(root, 'photo.JpEg', JPEG, 'image/jpeg');
});

test('accepts lossy, lossless, and extended still WebP headers', async t => {
  const root = await workspace(t);
  await expectPrepared(root, 'lossy.webp', WEBP_VP8, 'image/webp');
  await expectPrepared(root, 'lossless.WEBP', WEBP_VP8L, 'image/webp');
  await expectPrepared(root, 'alpha.webp', WEBP_VP8X, 'image/webp');
});

test('supports Unicode, spaces, and confined symlinks', async t => {
  const root = await workspace(t);
  await mkdir(path.join(root, 'assets'));
  const target = await fixture(path.join(root, 'assets'), 'данные image.png', PNG);
  await symlink(path.join('assets', 'данные image.png'), path.join(root, 'ссылка image.png'));
  const result = await prepareImage(root, 'ссылка image.png');
  assert.equal(result.filename, await realpath(path.join(root, 'assets', 'данные image.png')));
  assert.equal(result.bytes, target.length);
  assert.equal(result.dataUrl, `data:image/png;base64,${PNG}`);
});

test('rejects empty and malformed or truncated format structures', async t => {
  const root = await workspace(t);
  const cases = [
    ['empty.png', Buffer.alloc(0)],
    ['short.png', Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')],
    ['short.jpg', Buffer.from([0xff, 0xd8, 0xff])],
    ['short.webp', Buffer.from('RIFF\x04\x00\x00\x00WEBP', 'binary')],
  ];
  for (const [name, data] of cases) {
    await writeFile(path.join(root, name), data);
    await assert.rejects(prepareImage(root, name), /Invalid image|empty|truncated/);
  }

  const noIend = Buffer.from(PNG, 'base64').subarray(0, -12);
  await writeFile(path.join(root, 'no-iend.png'), noIend);
  await assert.rejects(prepareImage(root, 'no-iend.png'), /IEND/);

  const badRiffLength = Buffer.from(WEBP_VP8L, 'base64');
  badRiffLength.writeUInt32LE(1, 4);
  await writeFile(path.join(root, 'bad-riff.webp'), badRiffLength);
  await assert.rejects(prepareImage(root, 'bad-riff.webp'), /RIFF length/);
});

test('detects content independently and rejects extension mismatches', async t => {
  const root = await workspace(t);
  await fixture(root, 'wrong.jpg', PNG);
  await assert.rejects(prepareImage(root, 'wrong.jpg'), /extension does not match detected image\/png/);
  await fixture(root, 'wrong.webp', JPEG);
  await assert.rejects(prepareImage(root, 'wrong.webp'), /extension does not match detected image\/jpeg/);
});

test('rejects unsupported SVG and GIF paths and disguised content', async t => {
  const root = await workspace(t);
  await writeFile(path.join(root, 'vector.svg'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await writeFile(path.join(root, 'animation.gif'), Buffer.from('GIF89a', 'ascii'));
  await writeFile(path.join(root, 'disguised.png'), '<svg xmlns="http://www.w3.org/2000/svg"/>');
  await assert.rejects(prepareImage(root, 'vector.svg'), /only \.png/);
  await assert.rejects(prepareImage(root, 'animation.gif'), /only \.png/);
  await assert.rejects(prepareImage(root, 'disguised.png'), /not a supported PNG/);
});

test('rejects URLs, absolute paths, queries, fragments, and traversal', async t => {
  const root = await workspace(t);
  for (const value of [
    '',
    '/tmp/image.png',
    'C:\\tmp\\image.png',
    '//host/image.png',
    '\\\\host\\image.png',
    'https://example.test/image.png',
    'data:image/png;base64,AAAA',
    'blob:https://example.test/id',
    'file:///tmp/image.png',
    'image.png?size=2',
    'image.png#fragment',
  ]) {
    await assert.rejects(prepareImage(root, value), /path|URLs|query|absolute|supported/i);
  }
  await assert.rejects(prepareImage(root, '../outside.png'), /escapes/);
});

test('rejects outside symlinks while allowing only regular files', async t => {
  const parent = await workspace(t);
  const root = path.join(parent, 'document');
  await mkdir(root);
  await fixture(parent, 'outside.png', PNG);
  await symlink(path.join(parent, 'outside.png'), path.join(root, 'escape.png'));
  await mkdir(path.join(root, 'directory.png'));
  await assert.rejects(prepareImage(root, 'escape.png'), /symlink escapes/);
  await assert.rejects(prepareImage(root, 'directory.png'), /Not a source file|regular file/);
});

test('accepts a confined regular image above the generic 2 MiB source limit', async t => {
  const root = await workspace(t);
  const original = Buffer.from(WEBP_VP8L, 'base64');
  const paddingSize = (2 * 1024 * 1024) + 2;
  const paddingChunk = Buffer.alloc(8 + paddingSize);
  paddingChunk.write('JUNK', 0, 'ascii');
  paddingChunk.writeUInt32LE(paddingSize, 4);
  const image = Buffer.concat([original.subarray(0, 12), paddingChunk, original.subarray(12)]);
  image.writeUInt32LE(image.length - 8, 4);
  await writeFile(path.join(root, 'large.webp'), image);
  const result = await prepareImage(root, 'large.webp');
  assert.equal(result.bytes, image.length);
  assert.equal(result.width, 2);
  assert.equal(result.height, 3);
});

test('rejects regular files over 8 MiB before reading their payload', async t => {
  const root = await workspace(t);
  const oversized = path.join(root, 'oversized.png');
  await writeFile(oversized, Buffer.from(PNG, 'base64'));
  await truncate(oversized, MAX_IMAGE_BYTES + 1);
  await assert.rejects(prepareImage(root, 'oversized.png'), /8388608-byte limit/);
});

test('rejects zero dimensions and dimensions over the pixel cap', async t => {
  const root = await workspace(t);
  const zero = Buffer.from(PNG, 'base64');
  zero.writeUInt32BE(0, 16);
  await writeFile(path.join(root, 'zero.png'), zero);
  await assert.rejects(prepareImage(root, 'zero.png'), /positive integers/);

  const huge = Buffer.from(PNG, 'base64');
  huge.writeUInt32BE(10_000, 16);
  huge.writeUInt32BE(4_001, 20);
  await writeFile(path.join(root, 'huge.png'), huge);
  await assert.rejects(prepareImage(root, 'huge.png'), /40000000-pixel limit/);
});

test('rejects animated PNG and WebP declarations rather than guessing a frame', async t => {
  const root = await workspace(t);
  const png = Buffer.from(PNG, 'base64');
  const animationChunk = Buffer.alloc(20);
  animationChunk.writeUInt32BE(8, 0);
  animationChunk.write('acTL', 4, 'ascii');
  animationChunk.writeUInt32BE(2, 8);
  animationChunk.writeUInt32BE(0, 12);
  const animatedPng = Buffer.concat([png.subarray(0, 33), animationChunk, png.subarray(33)]);
  await writeFile(path.join(root, 'animated.png'), animatedPng);
  await assert.rejects(prepareImage(root, 'animated.png'), /animated PNG/);

  const webp = Buffer.from(WEBP_VP8X, 'base64');
  webp[20] |= 0x02;
  await writeFile(path.join(root, 'animated.webp'), webp);
  await assert.rejects(prepareImage(root, 'animated.webp'), /animated WebP/);
});
