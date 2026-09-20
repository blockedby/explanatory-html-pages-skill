import test from 'node:test';
import assert from 'node:assert/strict';
import { prepareSvg } from '../scripts/renderers/svg.mjs';

const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="60"><defs><marker id="arrow" markerWidth="5" markerHeight="5"><path d="M0 0L5 2L0 4Z"/></marker></defs><path d="M1 1L50 50" marker-end="url(#arrow)"/><text x="10" y="20">Привет</text></svg>';
test('SVG retains text, geometry and namespaced marker references', () => {
  const result = prepareSvg(svg, { prefix: 'figure-1', title: 'Сообщение' });
  assert.match(result, /Привет/); assert.match(result, /viewBox="0 0 100 60"/);
  assert.match(result, /id="figure-1-0"/); assert.match(result, /url\(#figure-1-0\)/);
  assert.match(result, /aria-labelledby="figure-1-title"/);
});
test('rejects active SVG, remote references, external entities and unsafe CSS', () => {
  for (const body of ['<script>alert(1)</script>', '<foreignObject/>', '<image href="https://bad.test/a"/>', '<path onclick="alert(1)"/>', '<path fill="url(https://bad.test/a)"/>', '<style>@import "https://bad.test/a";</style>']) {
    assert.throws(() => prepareSvg(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1">${body}</svg>`, { prefix: 'safe' }));
  }
  assert.throws(() => prepareSvg('<!DOCTYPE svg><svg/>', { prefix: 'safe' }));
  assert.throws(() => prepareSvg('<p>No diagram</p>', { prefix: 'safe' }));
});
test('stylesheet rules are restricted to SVG and flattened', () => {
  const result = prepareSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><style>text { fill: black; font-size: 12px; }</style><text>Hello</text></svg>', { prefix: 'safe', title: 'Test' });
  assert.doesNotMatch(result, /<style/); assert.match(result, /fill: black/);
});
test('fixed bpmn-js legacy header is removed before parsing, not resolved', () => {
  const header = '<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">';
  const result = prepareSvg(header + svg, { prefix: 'bpmn' });
  assert.doesNotMatch(result, /DOCTYPE|svg11.dtd/);
  assert.throws(() => prepareSvg(header.replace('svg11.dtd', 'evil.dtd') + svg, { prefix: 'bpmn' }));
});
test('unique prefixes isolate two copies and invalid IDs fail', () => {
  const first = prepareSvg(svg, { prefix: 'one' }); const second = prepareSvg(svg, { prefix: 'two' });
  assert.notEqual(first, second);
  assert.throws(() => prepareSvg(svg, { prefix: 'bad id' }));
  assert.throws(() => prepareSvg('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><g id="a"/><g id="a"/></svg>', { prefix: 'one' }));
});
