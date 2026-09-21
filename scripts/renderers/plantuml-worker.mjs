import { parentPort, workerData } from 'node:worker_threads';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import http2 from 'node:http2';
import net from 'node:net';
import tls from 'node:tls';
import dgram from 'node:dgram';
import dns from 'node:dns';

// Defense in depth for the trusted engine, not a sandbox for arbitrary JS.
// Install before dynamic imports; never load the package's MCP server entrypoint.
const blocked = () => { throw new Error('PlantUML worker network access is disabled'); };
for (const key of ['fetch', 'WebSocket', 'XMLHttpRequest', 'EventSource', 'WebTransport']) {
  Object.defineProperty(globalThis, key, { value: blocked, writable: false, configurable: false });
}
for (const module of [http, https]) {
  module.request = blocked;
  module.get = blocked;
  module.Agent.prototype.createConnection = blocked;
}
net.connect = net.createConnection = net.Socket.prototype.connect = blocked;
tls.connect = http2.connect = blocked;
dgram.createSocket = blocked;
for (const module of [dns, dns.promises, dns.Resolver.prototype, dns.promises.Resolver.prototype]) {
  for (const key of Object.keys(module)) {
    if (/^(?:lookup|resolve|reverse)/.test(key)) module[key] = blocked;
  }
}
syncBuiltinESMExports();

// Viz's Emscripten build grows its linear memory through this JS method.
// V8 resourceLimits do not cover WASM buffers; cap this growth separately.
const grow = WebAssembly.Memory.prototype.grow;
WebAssembly.Memory.prototype.grow = function (pages) {
  if (this.buffer.byteLength + Number(pages) * 65536 > 128 * 1024 * 1024) {
    throw new RangeError('PlantUML WASM memory exceeds the 128 MiB limit');
  }
  return grow.call(this, pages);
};

const { source, maxOutputBytes, maxDiagnosticBytes } = workerData;
function decode(json, phase) {
  // Bound the JSON before parsing/cloning. Escaping can inflate SVG up to 6x.
  if (typeof json !== 'string' || Buffer.byteLength(json) > maxOutputBytes * 6 + maxDiagnosticBytes) {
    throw new Error(`${phase}: engine response exceeds the resource limit`);
  }
  let result;
  try { result = JSON.parse(json); } catch { throw new Error(`${phase}: engine returned invalid JSON`); }
  if (result?.valid !== true) {
    throw new Error(`${phase}: ${result?.errorMessage || 'engine rejected diagram'}${result?.errorLineNumber ? ` (prepared source line ${result.errorLineNumber})` : ''}${result?.errorLine ? `: ${result.errorLine}` : ''}`);
  }
  return result;
}

try {
  const vizModule = await import('@viz-js/viz');
  let memo;
  globalThis.Viz = { instance: () => (memo ??= vizModule.instance()) };
  const engine = await import('@plantuml/mcp-js/engine.js');
  engine.version(); // Initializes the TeaVM runtime before syntax/render calls.
  const syntax = decode(engine.checkSyntax(source), 'syntax check');
  const rendered = decode(await new Promise((resolve) => engine.renderSvg(source, resolve)), 'render');
  if (typeof rendered.svg !== 'string') throw new Error('engine returned no SVG');
  if (Buffer.byteLength(rendered.svg) > maxOutputBytes) throw new Error('PlantUML output exceeds the 8 MiB limit');
  const warnings = [...new Set([...(syntax.warnings ?? []), ...(rendered.warnings ?? [])])];
  if (warnings.some((value) => typeof value !== 'string')) throw new Error('engine returned invalid warnings');
  if (Buffer.byteLength(JSON.stringify(warnings)) > maxDiagnosticBytes) throw new Error('PlantUML warnings exceed the 64 KiB limit');
  parentPort.postMessage({ svg: rendered.svg, warnings });
} catch (error) {
  parentPort.postMessage({ error: String(error?.message ?? error).slice(0, 2000) });
}
