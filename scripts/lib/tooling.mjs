import { access, readdir, readFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { toolkitRoot } from './paths.mjs';
const require = createRequire(import.meta.url);

export async function doctor() {
  const checks = [];
  const [major, minor] = process.versions.node.split('.').map(Number);
  checks.push({ tool: 'Node', ok: major > 22 || (major === 22 && minor >= 12), version: process.versions.node });
  for (const name of ['parse5', 'jsdom', 'dompurify', 'bpmn-js', 'bpmn-moddle', 'bpmn-auto-layout', 'playwright', '@plantuml/mcp-js', '@viz-js/viz']) {
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
  const browserRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(toolkitRoot, '.tools/ms-playwright');
  try {
    if (process.env.BPMN_CHROMIUM_EXECUTABLE) await access(process.env.BPMN_CHROMIUM_EXECUTABLE, constants.X_OK);
    else {
      const entries = await readdir(browserRoot);
      if (!entries.some(name => /^chromium[-_]/.test(name))) throw new Error('No Chromium');
    }
    checks.push({ tool: 'Playwright Chromium cache (BPMN only)', ok: true, path: process.env.BPMN_CHROMIUM_EXECUTABLE || browserRoot });
  } catch { checks.push({ tool: 'Playwright Chromium cache (BPMN only)', ok: false, fix: 'Run node scripts/setup.mjs --browser.' }); }
  return { ready: checks.every(check => check.ok), checks, note: 'No downloads performed. Doctor checks installation; rendering tests verify operation. Java is never required. Chromium is required only for BPMN.' };
}
