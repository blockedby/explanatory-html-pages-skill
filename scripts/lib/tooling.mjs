import { access, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { toolkitRoot } from './paths.mjs';
const require = createRequire(import.meta.url);

export async function doctor() {
  const checks = [];
  const [major, minor] = process.versions.node.split('.').map(Number);
  checks.push({ tool: 'Node', ok: major > 22 || (major === 22 && minor >= 12), version: process.versions.node });
  for (const name of ['parse5', 'jsdom', 'dompurify', 'bpmn-js', 'bpmn-moddle', 'bpmn-auto-layout', '@plantuml/mcp-js', '@viz-js/viz']) {
    try {
      require.resolve(name);
      const metadata = JSON.parse(await readFile(path.join(toolkitRoot, 'node_modules', name, 'package.json'), 'utf8'));
      checks.push({ tool: name, ok: true, version: metadata.version });
    } catch { checks.push({ tool: name, ok: false, fix: 'Run node scripts/setup.mjs --npm' }); }
  }
  try {
    await access(require.resolve('@plantuml/mcp-js/engine.js'), constants.R_OK);
    checks.push({ tool: 'PlantUML JS engine', ok: true, runtime: 'Node.js + Viz.js WASM; no Java or MCP server' });
  } catch { checks.push({ tool: 'PlantUML JS engine', ok: false, fix: 'Run node scripts/setup.mjs --npm. There is no Java fallback.' }); }
  for (const file of ['node_modules/bpmn-js/dist/bpmn-viewer.production.min.js', 'node_modules/dompurify/dist/purify.min.js', 'assets/bpmn-runtime.js']) {
    try {
      await access(path.join(toolkitRoot, file), constants.R_OK);
      checks.push({ tool: file, ok: true });
    } catch { checks.push({ tool: file, ok: false, fix: 'Restore the toolkit assets and run node scripts/setup.mjs --npm.' }); }
  }
  return { ready: checks.every(check => check.ok), checks, note: 'No downloads performed. No Java or installed browser is needed for builds. BPMN renders in the reader browser from embedded assets; Chromium is optional development/test tooling only.' };
}
