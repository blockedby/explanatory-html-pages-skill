import { access, readdir } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createRequire } from 'node:module';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { toolkitRoot } from './paths.mjs';
const execute = promisify(execFile);
const require = createRequire(import.meta.url);
export const tools = {
  plantuml: { version: '1.2026.8', url: 'https://github.com/plantuml/plantuml/releases/download/v1.2026.8/plantuml.jar', sha256: '5e1ecfa8ecd32c90b03bbf3b1eb6f020943f98ab0fcf4032be31a0002ee2c462' },
  jre: { version: '21.0.12.1+1', url: 'https://github.com/adoptium/temurin21-binaries/releases/download/jdk-21.0.12.1%2B1/OpenJDK21U-jre_x64_linux_hotspot_21.0.12.1_1.tar.gz', sha256: '2413149700df0f7d440500a84a8f764c535f21e5a5e87d38328b64eec2c5b500' }
};
export async function doctor() {
  const checks = [];
  const [major, minor] = process.versions.node.split('.').map(Number);
  checks.push({ tool: 'Node', ok: major > 22 || (major === 22 && minor >= 12), version: process.versions.node });
  for (const name of ['parse5', 'jsdom', 'dompurify', 'bpmn-js', 'bpmn-moddle', 'bpmn-auto-layout', 'playwright', 'esbuild']) {
    try { require.resolve(name); checks.push({ tool: name, ok: true }); }
    catch { checks.push({ tool: name, ok: false, fix: 'Run node scripts/setup.mjs --npm' }); }
  }
  const java = process.env.JAVA_BIN || path.join(toolkitRoot, '.tools/jre/bin/java');
  try {
    const { stderr, stdout } = await execute(java, ['-version'], { timeout: 10000 });
    checks.push({ tool: 'Java', ok: true, path: java, version: (stderr || stdout).split('\n')[0] });
  } catch { checks.push({ tool: 'Java', ok: false, fix: 'Set JAVA_BIN or run node scripts/setup.mjs --plantuml (Linux x64).' }); }
  const jar = process.env.PLANTUML_JAR || path.join(toolkitRoot, '.tools/plantuml.jar');
  try { await access(jar, constants.R_OK); checks.push({ tool: 'PlantUML jar', ok: true, path: jar }); }
  catch { checks.push({ tool: 'PlantUML jar', ok: false, fix: 'Run node scripts/setup.mjs --plantuml or set PLANTUML_JAR.' }); }
  const browserRoot = process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(toolkitRoot, '.tools/ms-playwright');
  try {
    if (process.env.BPMN_CHROMIUM_EXECUTABLE) await access(process.env.BPMN_CHROMIUM_EXECUTABLE, constants.X_OK);
    else {
      const entries = await readdir(browserRoot);
      if (!entries.some(name => /^chromium[-_]/.test(name))) throw new Error('No Chromium');
    }
    checks.push({ tool: 'Playwright Chromium cache', ok: true, path: process.env.BPMN_CHROMIUM_EXECUTABLE || browserRoot });
  } catch { checks.push({ tool: 'Playwright Chromium cache', ok: false, fix: 'Run node scripts/setup.mjs --browser.' }); }
  return { ready: checks.every(check => check.ok), checks, note: 'No downloads performed. Doctor checks installation; rendering tests verify operation. Java is unnecessary for documents without PlantUML.' };
}
