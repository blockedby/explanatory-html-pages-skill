import { parentPort, workerData } from 'node:worker_threads';
import { JSDOM } from 'jsdom';
import { BpmnModdle } from 'bpmn-moddle';

const NS = 'http://www.omg.org/spec/BPMN/20100524/MODEL';
const DI = 'http://www.omg.org/spec/BPMN/20100524/DI';
const MAX_BYTES = 2 * 1024 * 1024;
const is = (obj, type) => Boolean(obj?.$instanceOf?.(type));
const edgeTypes = ['bpmn:SequenceFlow', 'bpmn:MessageFlow', 'bpmn:Association', 'bpmn:DataAssociation'];
const visibleTypes = ['bpmn:FlowNode', 'bpmn:Participant', 'bpmn:Lane', 'bpmn:Artifact', 'bpmn:DataObjectReference', 'bpmn:DataStoreReference', ...edgeTypes];
const isEdge = obj => edgeTypes.some(type => is(obj, type));
const visible = obj => visibleTypes.some(type => is(obj, type));
const fail = message => { throw new Error(`BPMN XML: ${message}`); };

function inspectXML(source) {
  if (Buffer.byteLength(source) > MAX_BYTES) fail('laid-out XML exceeds 2 MiB limit');
  // Reject declarations before any parser sees them; only built-in XML escapes
  // and numeric character references are allowed. No entity resolver or network.
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) fail('DOCTYPE/entities are forbidden');
  let dom;
  try {
    // No resources or runScripts option: jsdom cannot load external resources.
    dom = new JSDOM(source, { contentType: 'application/xml' });
    const doc = dom.window.document;
    if (doc.documentElement.namespaceURI !== NS || doc.documentElement.localName !== 'definitions') fail('expected BPMN definitions root');
    const all = [...doc.getElementsByTagName('*')];
    if (all.length > 10000) fail('exceeds 10000 XML elements');
    const ids = new Set();
    for (const el of all) {
      if (el.hasAttribute('id')) {
        const id = el.getAttribute('id');
        if (!id || ids.has(id)) fail(`empty or duplicate id: ${id}`);
        ids.add(id);
      }
      // Moddle supplies defaults for absent coordinates and parseFloat accepts
      // numeric prefixes. Check the authored lexical values before conversion.
      if ((el.namespaceURI === 'http://www.omg.org/spec/DD/20100524/DC' && el.localName === 'Bounds') ||
          (el.namespaceURI === 'http://www.omg.org/spec/DD/20100524/DI' && el.localName === 'waypoint')) {
        const attrs = el.localName === 'Bounds' ? ['x', 'y', 'width', 'height'] : ['x', 'y'];
        for (const attr of attrs) {
          const value = el.getAttribute(attr);
          if (value === null || !/^[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(value.trim()) || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > 100000) fail(`invalid or excessive DI bounds: ${attr}`);
          if (['width', 'height'].includes(attr) && Number(value) <= 0) fail(`invalid DI dimensions: ${attr}`);
        }
      }
    }
    const diagrams = all.filter(el => el.namespaceURI === DI && el.localName === 'BPMNDiagram');
    if (diagrams.length > 1) fail('multiple diagrams are not supported; supply one complete diagram');
    if (diagrams.length) {
      const planes = all.filter(el => el.namespaceURI === DI && el.localName === 'BPMNPlane');
      if (planes.length !== 1 || planes[0].parentElement !== diagrams[0] || diagrams[0].parentElement !== doc.documentElement) fail('partial DI: expected one diagram with one plane');
      if (all.some(el => el.namespaceURI === DI && ['BPMNShape', 'BPMNEdge'].includes(el.localName) && el.parentElement !== planes[0])) fail('partial DI: shape/edge outside plane');
      return false;
    }
    if (all.some(el => el.namespaceURI === DI)) fail('partial DI: missing BPMNDiagram; provide complete explicit DI');
    const elements = all.filter(el => el.namespaceURI === NS);
    const unsupported = elements.find(el => ['collaboration', 'participant', 'lane', 'laneSet', 'messageFlow', 'subProcess', 'adHocSubProcess', 'transaction', 'group', 'textAnnotation', 'association', 'dataObjectReference', 'dataStoreReference', 'dataInputAssociation', 'dataOutputAssociation', 'choreography', 'globalChoreographyTask', 'conversation', 'conversationLink'].includes(el.localName));
    if (unsupported) fail(`missing DI: auto-layout does not safely support ${unsupported.localName}; provide explicit BPMN DI`);
    if (elements.filter(el => el.localName === 'process').length !== 1) fail('missing DI requires exactly one process; provide explicit BPMN DI');
    return true;
  } catch (error) {
    if (error.message.startsWith('BPMN XML:')) throw error;
    fail(error.message.slice(0, 500));
  } finally { dom?.window.close(); }
}

// Traverse containment only, never reference cycles or $parent. Includes objects
// without IDs so they cannot silently escape semantic-to-DI coverage checks.
function objects(root) {
  const result = [], stack = [root], seen = new Set();
  while (stack.length) {
    const obj = stack.pop();
    if (!obj || typeof obj !== 'object' || seen.has(obj)) continue;
    seen.add(obj);
    result.push(obj);
    for (const prop of obj.$descriptor?.properties || []) {
      if (prop.isReference || prop.isAttr || prop.isVirtual) continue;
      const value = obj.get(prop.name);
      if (Array.isArray(value)) stack.push(...value); else if (value && typeof value === 'object') stack.push(value);
    }
  }
  return result;
}

async function parse(source) {
  const result = await new BpmnModdle().fromXML(source);
  if (result.warnings.length) throw new Error(`BPMN import warnings: ${result.warnings.map(w => w.message).join('; ')}`);
  const all = objects(result.rootElement);
  // Resolved references must also have their declared moddle type. Moddle's
  // importer warns about missing IDs, but does not enforce reference types.
  for (const obj of all) {
    for (const prop of obj.$descriptor?.properties || []) {
      if (!prop.isReference || prop.isVirtual) continue;
      const value = obj.get(prop.name);
      for (const ref of (Array.isArray(value) ? value : value ? [value] : [])) {
        if (!is(ref, prop.type)) throw new Error(`BPMN invalid reference: ${obj.id || obj.$type}.${prop.name} expected ${prop.type}`);
      }
    }
    if (is(obj, 'bpmn:SequenceFlow') || is(obj, 'bpmn:MessageFlow') || is(obj, 'bpmn:Association')) {
      if (!obj.sourceRef || !obj.targetRef) throw new Error(`BPMN invalid reference: ${obj.id} requires sourceRef and targetRef`);
    }
    if (is(obj, 'bpmn:SequenceFlow') && (obj.sourceRef.$parent !== obj.$parent || obj.targetRef.$parent !== obj.$parent)) throw new Error(`BPMN invalid reference: ${obj.id} crosses process/subprocess scope`);
    if (is(obj, 'bpmn:DataAssociation') && (!obj.sourceRef?.length || !obj.targetRef)) throw new Error(`BPMN invalid reference: ${obj.id} requires sourceRef and targetRef`);
    if (is(obj, 'bpmn:Lane')) {
      let scope = obj.$parent;
      while (scope && !is(scope, 'bpmn:Process') && !is(scope, 'bpmn:SubProcess')) scope = scope.$parent;
      for (const node of obj.flowNodeRef || []) if (node.$parent !== scope) throw new Error(`BPMN invalid reference: ${obj.id}.flowNodeRef crosses process/subprocess scope`);
    }
    if (is(obj, 'bpmn:FlowNode')) {
      for (const flow of obj.incoming || []) if (flow.targetRef !== obj) throw new Error(`BPMN invalid reference: ${obj.id}.incoming`);
      for (const flow of obj.outgoing || []) if (flow.sourceRef !== obj) throw new Error(`BPMN invalid reference: ${obj.id}.outgoing`);
    }
  }
  return { ...result, all };
}

function validateDI({ rootElement, all }) {
  const plane = rootElement.diagrams?.[0]?.plane;
  if (!plane || !(is(plane.bpmnElement, 'bpmn:Process') || is(plane.bpmnElement, 'bpmn:Collaboration'))) fail('partial DI: plane must reference a process or collaboration');
  const root = plane.bpmnElement;
  const coverage = new Map();
  const coordinate = n => Number.isFinite(n) && Math.abs(n) <= 100000;
  function bounds(b, id) {
    if (!b || ![b.x, b.y, b.x + b.width, b.y + b.height].every(coordinate)) fail(`invalid or excessive DI bounds: ${id}`);
    if (!(b.width > 0) || !(b.height > 0)) fail(`invalid DI dimensions: ${id}`);
  }
  for (const di of plane.planeElement || []) {
    const semantic = di.bpmnElement;
    if (!semantic || !visible(semantic)) fail(`invalid DI reference: ${di.id}`);
    if (coverage.has(semantic)) fail(`duplicate DI for ${semantic.id}`);
    if (isEdge(semantic) !== is(di, 'bpmndi:BPMNEdge')) fail(`invalid DI shape/edge type: ${semantic.id}`);
    coverage.set(semantic, di);
    if (is(di, 'bpmndi:BPMNEdge')) {
      if (!di.waypoint || di.waypoint.length < 2 || di.waypoint.some(p => !coordinate(p.x) || !coordinate(p.y))) fail(`invalid or excessive DI bounds: ${di.id}; edge requires at least two waypoints`);
      for (const [key, ref] of [['sourceElement', semantic.sourceRef], ['targetElement', semantic.targetRef]]) {
        if (di[key] && di[key].bpmnElement !== ref) fail(`invalid DI reference: ${di.id}.${key}`);
      }
    } else bounds(di.bounds, di.id);
    if (di.label?.bounds) bounds(di.label.bounds, `${di.id} label`);
  }
  const missing = [];
  for (const obj of all.filter(visible)) {
    let hidden = !coverage.has(obj);
    for (let parent = obj.$parent; parent && parent !== rootElement; parent = parent.$parent) {
      if (is(parent, 'bpmn:SubProcess') && coverage.get(parent)?.isExpanded !== true) hidden = true;
      if (is(parent, 'bpmn:Process')) {
        if (is(root, 'bpmn:Process') ? parent !== root : !(root.participants || []).some(p => p.processRef === parent && coverage.has(p))) hidden = true;
      }
      if (is(parent, 'bpmn:Collaboration') && parent !== root) hidden = true;
    }
    if (hidden) missing.push(obj.id || obj.$type);
  }
  if (missing.length) throw new Error(`BPMN unrendered elements: ${missing.slice(0, 20).join(', ')}; supply complete explicit DI (including expanded subprocesses); for auto-layout include incoming/outgoing flow references`);
  if (!coverage.size) fail('no renderable elements');
}

async function prepare(source) {
  const needsLayout = inspectXML(source);
  const before = await parse(source);
  const warnings = [];
  if (needsLayout) {
    // Layout supports only a single ordinary process. Reject other semantic
    // roots rather than trusting an engine that might discard them.
    if (before.rootElement.rootElements.some(obj => !is(obj, 'bpmn:Process') && !['bpmn:Message', 'bpmn:Signal', 'bpmn:Error', 'bpmn:Escalation', 'bpmn:ItemDefinition', 'bpmn:Resource', 'bpmn:DataStore'].includes(obj.$type))) fail('missing DI: unsupported root content; provide explicit BPMN DI');
    const { layoutProcess } = await import('bpmn-auto-layout');
    source = await layoutProcess(source);
    if (inspectXML(source)) fail('auto-layout did not generate DI');
    const after = await parse(source);
    const lost = Object.keys(before.elementsById).filter(id => !after.elementsById[id]);
    if (lost.length) fail(`layout lost elements: ${lost.join(', ')}; provide explicit DI`);
    validateDI(after);
    warnings.push('Generated BPMN DI with bpmn-auto-layout; returned source includes editable layout.');
  } else validateDI(before);
  return { source, extension: 'bpmn', warnings };
}

prepare(workerData.source).then(result => parentPort.postMessage(result), error => parentPort.postMessage({ error: `BPMN preparation failed: ${error.message}` }));
