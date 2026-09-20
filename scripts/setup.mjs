#!/usr/bin/env node
// Explicit online setup, never called implicitly by scaffold/build.
import { mkdir, readFile, writeFile, rename, rm, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { toolkitRoot } from './lib/paths.mjs';
import { tools } from './lib/tooling.mjs';

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('Usage: node scripts/setup.mjs [--npm] [--plantuml] [--browser]\nNo flags installs all. This command downloads dependencies. Builds never download.\nAutomatic Java installation supports Linux x64; other platforms should provide JAVA_BIN.');
  process.exit(0);
}
if (args.some(arg => !['--npm', '--plantuml', '--browser'].includes(arg))) { console.error('Unknown setup option. Use --help.'); process.exit(1); }
const selected = flag => !args.length || args.includes(flag);
const run = (program, argv, env = process.env) => new Promise((resolve, reject) => {
  const child = spawn(program, argv, { cwd: toolkitRoot, stdio: 'inherit', env, shell: false });
  child.on('error', reject);
  child.on('exit', code => code === 0 ? resolve() : reject(new Error(`${program} exited ${code}`)));
});
async function download(tool, filename) {
  const target = path.join(toolkitRoot, '.tools', filename);
  try { if (createHash('sha256').update(await readFile(target)).digest('hex') === tool.sha256) return target; } catch { /* download below */ }
  const response = await fetch(tool.url, { signal: AbortSignal.timeout(180000) });
  if (!response.ok) throw new Error(`Download failed: ${response.status} ${tool.url}`);
  const data = Buffer.from(await response.arrayBuffer());
  if (createHash('sha256').update(data).digest('hex') !== tool.sha256) throw new Error(`Checksum mismatch for ${filename}`);
  const temp = `${target}.download-${process.pid}`;
  try { await writeFile(temp, data, { flag: 'wx' }); await rename(temp, target); }
  finally { await rm(temp, { force: true }); }
  return target;
}
try {
  const [major, minor] = process.versions.node.split('.').map(Number);
  if (major < 22 || (major === 22 && minor < 12)) throw new Error('Node >=22.12 is required.');
  await mkdir(path.join(toolkitRoot, '.tools'), { recursive: true });
  if (selected('--npm')) await run(process.platform === 'win32' ? 'npm.cmd' : 'npm', ['ci', '--no-audit', '--no-fund']);
  if (selected('--plantuml')) {
    await download(tools.plantuml, 'plantuml.jar');
    if (!process.env.JAVA_BIN) {
      if (process.platform !== 'linux' || process.arch !== 'x64') throw new Error('Automatic JRE setup supports Linux x64 only. Install Java 21 and set JAVA_BIN, then rerun --plantuml.');
      const archive = await download(tools.jre, 'jre.tar.gz');
      const javaRoot = path.join(toolkitRoot, '.tools/jre');
      await mkdir(javaRoot, { recursive: true });
      await run('tar', ['-xzf', archive, '-C', javaRoot, '--strip-components=1']);
    } else await access(process.env.JAVA_BIN);
  }
  if (selected('--browser')) {
    const cli = path.join(toolkitRoot, 'node_modules/playwright/cli.js');
    await access(cli).catch(() => { throw new Error('Install npm dependencies first: node scripts/setup.mjs --npm'); });
    await run(process.execPath, [cli, 'install', 'chromium'], { ...process.env, PLAYWRIGHT_BROWSERS_PATH: process.env.PLAYWRIGHT_BROWSERS_PATH || path.join(toolkitRoot, '.tools/ms-playwright') });
  }
  console.log('Setup complete. Run node scripts/document.mjs doctor, then build.');
} catch (error) { console.error(`Setup failed: ${error.message}`); process.exitCode = 1; }
