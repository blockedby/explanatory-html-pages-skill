import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderBpmn } from '../scripts/renderers/bpmn.mjs';

const simple = await readFile(new URL('./fixtures/bpmn/simple.bpmn', import.meta.url), 'utf8');
const advanced = await readFile(new URL('./fixtures/bpmn/collaboration.bpmn', import.meta.url), 'utf8');
const noDI = advanced.replace(/\s*<bpmndi:BPMNDiagram[\s\S]*<\/bpmndi:BPMNDiagram>/, '');

test('real local auto-layout returns editable DI and real SVG', async () => {
  const result = await renderBpmn(simple);
  assert.equal(result.extension, 'bpmn');
  assert.match(result.source, /BPMNDiagram/);
  assert.match(result.warnings.join(' '), /Generated BPMN DI/);
  assert.match(result.svg, /<svg/);
  for (const id of ['Start', 'Review', 'End', 'Flow_1', 'Flow_2']) assert.ok(result.svg.includes(`data-element-id="${id}"`), id);
  assert.match(result.svg, /Review request/);
  assert.match(result.svg, /viewBox=/);
  assert.doesNotMatch(result.svg, /<(?:script|image)\b/);
  const repeat = await renderBpmn(result.source);
  assert.equal(repeat.source, result.source);
  assert.deepEqual(repeat.warnings, []);
});

test('explicit DI preserves collaboration, lane, message flow and timer glyph', async () => {
  const result = await renderBpmn(advanced);
  assert.equal(result.source, advanced);
  assert.deepEqual(result.warnings, []);
  for (const id of ['Operations', 'Customer', 'Agent', 'Message_flow', 'Wait', 'Notify']) assert.ok(result.svg.includes(`data-element-id="${id}"`), id);
  assert.match(result.svg, /stroke-dasharray/); // message-flow notation
  const timer = result.svg.match(/data-element-id="Wait"[\s\S]*?(?=<g class="djs-element|$)/)?.[0];
  assert.ok((timer.match(/<circle/g) || []).length >= 3, 'double event border and clock circle');
  assert.match(timer, /<path/); // clock ticks/hands
});

test('unsupported no-DI content fails rather than dropping semantics', async () => {
  await assert.rejects(renderBpmn(noDI), /missing DI.*collaboration.*explicit BPMN DI/);
  const lane = simple.replace('<bpmn:startEvent', '<bpmn:laneSet id="LS"><bpmn:lane id="L" /></bpmn:laneSet><bpmn:startEvent');
  await assert.rejects(renderBpmn(lane), /missing DI.*laneSet.*explicit BPMN DI/);
  const annotation = simple.replace('<bpmn:startEvent', '<bpmn:textAnnotation id="A"><bpmn:text>Important</bpmn:text></bpmn:textAnnotation><bpmn:startEvent');
  await assert.rejects(renderBpmn(annotation), /missing DI.*textAnnotation/);
  const withoutFlowRefs = simple.replace(/<bpmn:(incoming|outgoing)>[^<]*<\/bpmn:\1>/g, '');
  await assert.rejects(renderBpmn(withoutFlowRefs), /unrendered elements.*incoming\/outgoing/);
});

test('partial DI and unresolved semantic references produce actionable errors', async () => {
  const missing = advanced.replace(/<bpmndi:BPMNEdge id="Message_flow_di"[\s\S]*?<\/bpmndi:BPMNEdge>/, '');
  await assert.rejects(renderBpmn(missing), /unrendered elements: Message_flow/);
  for (const id of ['Agent', 'Customer']) {
    const partial = advanced.replace(new RegExp(`<bpmndi:BPMNShape id="${id}_di"[\\s\\S]*?<\\/bpmndi:BPMNShape>`), '');
    await assert.rejects(renderBpmn(partial), /unrendered elements|import warnings/);
  }
  await assert.rejects(renderBpmn(simple.replace('targetRef="Review"', 'targetRef="Missing"')), /import warnings.*unresolved reference/);
  await assert.rejects(renderBpmn(advanced.replace('bpmnElement="Wait"', 'bpmnElement="Missing"')), /import.*(?:unresolved|warnings)/);
});

test('XML and resource bounds fail clearly', async () => {
  await assert.rejects(renderBpmn(''), /non-empty/);
  await assert.rejects(renderBpmn('x'.repeat(2 * 1024 * 1024 + 1)), /2 MiB/);
  await assert.rejects(renderBpmn('<!DOCTYPE x SYSTEM "https://example.invalid/a"><x/>'), /DOCTYPE/);
  await assert.rejects(renderBpmn('<!ENTITY x "bad"><x/>'), /entities/);
  await assert.rejects(renderBpmn('<broken>'), /BPMN XML/);
  await assert.rejects(renderBpmn('<definitions/>'), /definitions root/);
  await assert.rejects(renderBpmn(simple.replace('id="End"', 'id="Start"')), /duplicate id/);
  await assert.rejects(renderBpmn(advanced.replace('x="180"', 'x="100001"')), /DI bounds/);
  await assert.rejects(renderBpmn(advanced.replace('</bpmn:definitions>', '<bpmndi:BPMNDiagram id="Second" /></bpmn:definitions>')), /multiple diagrams/);
  await assert.rejects(renderBpmn(simple, { timeoutMs: 0 }), /timeoutMs/);
  await assert.rejects(renderBpmn(simple, { timeoutMs: 1 }), /timed out|Timeout/);
  await assert.rejects(renderBpmn(simple, { toolkitRoot: '/nonexistent-bpmn-toolkit' }), /local runtime unavailable/);
});

test('explicit author colors are monochrome only in the rendered copy', async () => {
  const xml = advanced.replace('xmlns:bpmn=', 'xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" xmlns:bpmn=')
    .replace('id="Notify_di"', 'id="Notify_di" bioc:fill="#ff0000" bioc:stroke="#00ff00"');
  const result = await renderBpmn(xml);
  assert.equal(result.source, xml);
  assert.doesNotMatch(result.svg, /#ff0000|#00ff00|rgb\(255, 0, 0\)|rgb\(0, 255, 0\)/);
});

test('text resembling remote resources stays inert (offline rendering)', async () => {
  const xml = simple.replace('Review request', '&lt;img src=&quot;https://example.invalid/tracker&quot;&gt;');
  const result = await renderBpmn(xml);
  assert.doesNotMatch(result.svg, /<img|<image|<script/);
  assert.match(result.svg.replace(/<[^>]*>/g, ''), /example.invalid/);
});
