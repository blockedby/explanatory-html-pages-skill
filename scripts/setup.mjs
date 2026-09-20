#!/usr/bin/env node
// Explicit online setup, never called implicitly by scaffold/build.
import { mkdir, access } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { toolkitRoot } from './lib/paths.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/setup.mjs [--npm] [--browser]\nNo flags installs all. This command downloads dependencies. Builds never download.\nPlantUML uses the pinned JavaScript engine and Viz.js WASM from npm. No Java/JRE/JAR is needed.\nChromium is needed only to build BPMN diagrams.');
  process.exit(0);
}
if (args.includes('--plantuml')) { console.error('PlantUML now installs with npm dependencies. Use --npm; Java setup has been removed.'); process.exit(1); }
if (args.some(arg => !['--npm', '--browser'].includes(arg))) { console.error('Unknown setup option. Use --help.'); process.exit(1); }
const selected = flag => !args.length || args.includes(flag);
const run = (program, argv, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(program, argv, { cwd: toolkitRoot, stdio: 'inherit', env, shell: false });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`)));
});
try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node >=22.12 is required.');
  await mkdir(path.join(toolkitRoot, '.tools'), { recursive: true });
  if (selected('--npm')) await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund']);
  if (selected('--browser')) {
    const cli = path.join(toolkitRoot, 'node_modules/playwright/cli.js');
    await access(cli).catch(() => { throw new Error('Install npm dependencies first: node scripts/setup.mjs --npm'); });
    await run(process.execPath, [cli, 'install', 'chromium'], { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(toolkitRoot, '.tools/ms-playwright') });
  }
  console.log('Setup complete. Run node scripts/document.mjs doctor, then build.');
} catch (error) { console.error(`Setup failed: ${error.message}`); process.exitCode = 1; }
