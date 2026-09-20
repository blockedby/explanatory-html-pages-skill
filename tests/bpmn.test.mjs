import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { BpmnModdle } from 'bpmn-moddle';
import { createServer } from 'node:http';
import { prepareBpmn } from '../scripts/renderers/bpmn.mjs';

const simple = await readFile(new URL('./fixtures/bpmn/simple.bpmn', import.meta.url), 'utf8');
const advanced = await readFile(new URL('./fixtures/bpmn/collaboration.bpmn', import.meta.url), 'utf8');
const noDI = advanced.replace(/\s*<bpmndi:BPMNDiagram[\s\S]*<\/bpmndi:BPMNDiagram>/, '');

function withoutShape(xml, id) {
  return xml.replace(new RegExp(`<bpmndi:BPMNShape id="${id}_di"[\\s\\S]*?<\\/bpmndi:BPMNShape>`), '');
}

test('real auto-layout is browser-free and returns editable DI, never SVG', async () => {
  const previous = process.env.BPMN_CHROMIUM_EXECUTABLE;
  const previousCache = process.env.PLAYWRIGHT_BROWSERS_PATH;
  process.env.BPMN_CHROMIUM_EXECUTABLE = '/nonexistent/chromium';
  process.env.PLAYWRIGHT_BROWSERS_PATH = '/nonexistent/browser-cache';
  try {
    const result = await prepareBpmn(simple, { toolkitRoot: '/nonexistent-bpmn-toolkit' });
    assert.deepEqual(Object.keys(result).sort(), ['extension', 'source', 'warnings']);
    assert.equal(result.extension, 'bpmn');
    assert.match(result.source, /BPMNDiagram/);
    assert.match(result.warnings.join(' '), /Generated BPMN DI/);
    const { elementsById, warnings } = await new BpmnModdle().fromXML(result.source);
    assert.deepEqual(warnings, []);
    for (const id of ['Start', 'Review', 'End', 'Flow_1', 'Flow_2']) assert.ok(elementsById[id], id);
    assert.equal(elementsById.Review.name, 'Review request');
    const repeat = await prepareBpmn(result.source);
    assert.equal(repeat.source, result.source);
    assert.deepEqual(repeat.warnings, []);
    assert.equal(await readFile(new URL('./fixtures/bpmn/simple.bpmn', import.meta.url), 'utf8'), simple);
  } finally {
    if (previous === undefined) delete process.env.BPMN_CHROMIUM_EXECUTABLE; else process.env.BPMN_CHROMIUM_EXECUTABLE = previous;
    if (previousCache === undefined) delete process.env.PLAYWRIGHT_BROWSERS_PATH; else process.env.PLAYWRIGHT_BROWSERS_PATH = previousCache;
  }
});

test('explicit DI preserves collaboration, lane, message flow and timer semantics', async () => {
  const result = await prepareBpmn(advanced);
  assert.equal(result.source, advanced);
  assert.deepEqual(result.warnings, []);
  const { elementsById: ids, warnings } = await new BpmnModdle().fromXML(result.source);
  assert.deepEqual(warnings, []);
  for (const id of ['Operations', 'Customer', 'Agent', 'Message_flow', 'Wait', 'Notify']) assert.ok(ids[id], id);
  assert.equal(ids.Operations.processRef, ids.Process_ops);
  assert.ok(ids.Agent.flowNodeRef.includes(ids.Wait));
  assert.equal(ids.Message_flow.sourceRef, ids.Notify);
  assert.equal(ids.Message_flow.targetRef, ids.Customer);
  assert.equal(ids.Message_flow.messageRef, ids.Reminder);
  assert.equal(ids.Wait.eventDefinitions[0].$type, 'bpmn:TimerEventDefinition');
  assert.equal(ids.Timer.timeDuration.body, 'P1D');
});

test('unsupported no-DI content fails rather than dropping semantics', async () => {
  await assert.rejects(prepareBpmn(noDI), /missing DI.*collaboration.*explicit BPMN DI/);
  for (const [tag, content] of [
    ['laneSet', '<bpmn:laneSet id="LS"><bpmn:lane id="L" /></bpmn:laneSet>'],
    ['textAnnotation', '<bpmn:textAnnotation id="A"><bpmn:text>Important</bpmn:text></bpmn:textAnnotation>'],
    ['subProcess', '<bpmn:subProcess id="Sub"><bpmn:task id="Nested" /></bpmn:subProcess>'],
    ['dataObjectReference', '<bpmn:dataObjectReference id="Data" />']
  ]) await assert.rejects(prepareBpmn(simple.replace('<bpmn:startEvent', content + '<bpmn:startEvent')), new RegExp(`missing DI.*${tag}`));
  const withoutFlowRefs = simple.replace(/<bpmn:(incoming|outgoing)>[^<]*<\/bpmn:\1>/g, '');
  await assert.rejects(prepareBpmn(withoutFlowRefs), /unrendered elements.*incoming\/outgoing/);
  await assert.rejects(prepareBpmn(simple.replace('</bpmn:definitions>', '<bpmn:process id="Other" /></bpmn:definitions>')), /exactly one process/);
});

test('partial DI and unresolved semantic references produce actionable errors', async () => {
  const missing = advanced.replace(/<bpmndi:BPMNEdge id="Message_flow_di"[\s\S]*?<\/bpmndi:BPMNEdge>/, '');
  await assert.rejects(prepareBpmn(missing), /unrendered elements: Message_flow/);
  for (const id of ['Agent', 'Customer']) await assert.rejects(prepareBpmn(withoutShape(advanced, id)), /unrendered elements|import warnings/);
  await assert.rejects(prepareBpmn(simple.replace('targetRef="Review"', 'targetRef="Missing"')), /import warnings.*unresolved reference/);
  await assert.rejects(prepareBpmn(advanced.replace('bpmnElement="Wait"', 'bpmnElement="Missing"')), /import.*(?:unresolved|warnings)/);
  await assert.rejects(prepareBpmn(advanced.replace(/<bpmndi:BPMNPlane[\s\S]*?<\/bpmndi:BPMNPlane>/, '')), /partial DI/);
  await assert.rejects(prepareBpmn(advanced.replace(/<\/?bpmndi:BPMNDiagram\b[^>]*>/g, '')), /partial DI/);
  await assert.rejects(prepareBpmn(advanced.replace('bpmnElement="Collaboration"', 'bpmnElement="Notify"')), /plane must reference/);
  await assert.rejects(prepareBpmn(advanced.replace('bpmnElement="Wait"', 'bpmnElement="Start"')), /duplicate DI/);
  await assert.rejects(prepareBpmn(advanced.replace('</bpmndi:BPMNDiagram>', '<bpmndi:BPMNPlane id="OtherPlane" bpmnElement="Collaboration" /></bpmndi:BPMNDiagram>')), /one plane/);
  await assert.rejects(prepareBpmn(advanced.replace('</bpmn:process>', '<bpmn:task /></bpmn:process>')), /unrendered elements: bpmn:Task/);
  await assert.rejects(prepareBpmn(advanced.replace('</bpmn:process>', '<bpmn:notARealElement /></bpmn:process>')), /import warnings/);
});

test('resolved references must have correct types and endpoints', async () => {
  await assert.rejects(prepareBpmn(advanced.replace('targetRef="Wait"', 'targetRef="Reminder"')), /invalid reference/);
  await assert.rejects(prepareBpmn(advanced.replace('processRef="Process_ops"', 'processRef="Wait"')), /invalid reference/);
  await assert.rejects(prepareBpmn(advanced.replace(' targetRef="Wait"', '')), /requires sourceRef and targetRef/);
  await assert.rejects(prepareBpmn(simple.replace('<bpmn:outgoing>Flow_1', '<bpmn:outgoing>Flow_2')), /invalid reference.*outgoing/);
  await assert.rejects(prepareBpmn(advanced.replace('id="F1_di"', 'id="F1_di" sourceElement="Wait_di"')), /invalid DI reference/);
  await assert.rejects(prepareBpmn(advanced.replace('id="Start_di" bpmnElement="Start"', 'id="Start_di" bpmnElement="F1"')), /shape\/edge type/);
});

test('collapsed subprocess children cannot silently disappear even with child DI', async () => {
  const xml = advanced.replace('<bpmn:sendTask id="Notify" name="Notify customer" />', '<bpmn:subProcess id="Notify"><bpmn:task id="Nested" /></bpmn:subProcess>')
    .replace('</bpmndi:BPMNPlane>', '<bpmndi:BPMNShape id="Nested_di" bpmnElement="Nested"><dc:Bounds x="410" y="150" width="60" height="40" /></bpmndi:BPMNShape></bpmndi:BPMNPlane>');
  await assert.rejects(prepareBpmn(xml), /unrendered elements: Nested.*expanded subprocesses/);
  const expanded = xml.replace('id="Notify_di"', 'id="Notify_di" isExpanded="true"');
  assert.equal((await prepareBpmn(expanded)).source, expanded);
  await assert.rejects(prepareBpmn(withoutShape(expanded, 'Nested')), /unrendered elements: Nested/);
});

test('XML and resource bounds fail clearly', async () => {
  for (const input of ['', null, 42]) await assert.rejects(prepareBpmn(input), /non-empty/);
  await assert.rejects(prepareBpmn('x'.repeat(2 * 1024 * 1024 + 1)), /2 MiB/);
  await assert.rejects(prepareBpmn('é'.repeat(1024 * 1024 + 1)), /2 MiB/);
  await assert.rejects(prepareBpmn('<!DOCTYPE x SYSTEM "https://example.invalid/a"><x/>'), /DOCTYPE/);
  await assert.rejects(prepareBpmn('<!ENTITY x "bad"><x/>'), /entities/);
  await assert.rejects(prepareBpmn('<!DOCTYPE x [<!ENTITY a "foo"><!ENTITY b "&a;&a;">]><x>&b;</x>'), /DOCTYPE/);
  for (const xml of ['<broken>', simple.replace('Review request', '&undeclared;'), simple.replace('</bpmn:process>', '</wrong>')]) await assert.rejects(prepareBpmn(xml), /BPMN XML/);
  await assert.rejects(prepareBpmn('<definitions/>'), /definitions root/);
  await assert.rejects(prepareBpmn(simple.replace('id="End"', 'id="Start"')), /duplicate id/);
  await assert.rejects(prepareBpmn(simple.replace('id="End"', 'id=""')), /empty or duplicate id/);
  await assert.rejects(prepareBpmn(simple.replace('</bpmn:process>', '<bpmn:task />'.repeat(10000) + '</bpmn:process>')), /10000 XML elements/);
  await assert.rejects(prepareBpmn(advanced.replace('</bpmn:definitions>', '<bpmndi:BPMNDiagram id="Second" /></bpmn:definitions>')), /multiple diagrams/);
  for (const timeoutMs of [0, -1, Infinity, NaN, 120001, '10']) await assert.rejects(prepareBpmn(simple, { timeoutMs }), /timeoutMs/);
  const start = Date.now();
  await assert.rejects(prepareBpmn(simple, { timeoutMs: 1 }), /timed out|Timeout/);
  assert.ok(Date.now() - start < 5000, 'worker cancellation is bounded');
  // Cancellation must not poison later preparations.
  assert.equal((await prepareBpmn(advanced)).source, advanced);
});

test('invalid DI geometry is rejected before the reader browser', async () => {
  for (const value of ['100001', 'NaN', 'Infinity', '12junk', '']) await assert.rejects(prepareBpmn(advanced.replace('x="180"', `x="${value}"`)), /DI bounds/);
  await assert.rejects(prepareBpmn(advanced.replace('x="180"', '')), /DI bounds/);
  for (const value of ['0', '-1']) await assert.rejects(prepareBpmn(advanced.replace('width="36"', `width="${value}"`)), /DI dimensions/);
  await assert.rejects(prepareBpmn(advanced.replace('x="180"', 'x="99999"')), /DI bounds/);
  await assert.rejects(prepareBpmn(advanced.replace('<di:waypoint x="216" y="180" />', '')), /at least two waypoints/);
  await assert.rejects(prepareBpmn(advanced.replace('<dc:Bounds x="180" y="162" width="36" height="36" />', '')), /DI bounds/);
});

test('author colors remain unchanged; monochrome belongs to the reader browser', async () => {
  const xml = advanced.replace('xmlns:bpmn=', 'xmlns:bioc="http://bpmn.io/schema/bpmn/biocolor/1.0" xmlns:bpmn=')
    .replace('id="Notify_di"', 'id="Notify_di" bioc:fill="#ff0000" bioc:stroke="#00ff00"');
  const result = await prepareBpmn(xml);
  assert.equal(result.source, xml);
  assert.equal('svg' in result, false);
});

test('remote-looking text, imports and stylesheet instructions never request resources', async () => {
  let requests = 0;
  const server = createServer((_req, res) => { requests++; res.end('unexpected'); });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/resource`;
  try {
    const xml = simple.replace('Review request', `&lt;img src=&quot;${url}&quot;&gt;`)
      .replace('?>', `?><?xml-stylesheet href="${url}" type="text/xsl"?>`)
      .replace('<bpmn:process', `<bpmn:import importType="http://www.w3.org/2001/XMLSchema" location="${url}" namespace="urn:external" /><bpmn:process`);
    const result = await prepareBpmn(xml);
    const { elementsById } = await new BpmnModdle().fromXML(result.source);
    assert.equal(elementsById.Review.name, `<img src="${url}">`);
    assert.equal((await prepareBpmn(result.source)).source, result.source);
    assert.equal(requests, 0);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
