import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import path from 'node:path';
import { toolkitRoot } from '../scripts/lib/paths.mjs';
const execute = promisify(execFile);

test('setup explains Node-only PlantUML and rejects retired Java installation flag', async () => {
  const setup = path.join(toolkitRoot, 'scripts/setup.mjs');
  const { stdout } = await execute(process.execPath, [setup, '--help']);
  assert.match(stdout, /No Java\/JRE\/JAR is needed/);
  await assert.rejects(execute(process.execPath, [setup, '--plantuml']), error => {
    assert.match(error.stderr, /Use --npm; Java setup has been removed/);
    return true;
  });
});
test('doctor needs no Java executable or jar and reports the pinned JS engine', async () => {
  const { stdout } = await execute(process.execPath, [path.join(toolkitRoot, 'scripts/document.mjs'), 'doctor'], {
    env: { ...process.env, JAVA_BIN: '/missing/forbidden-java', PLANTUML_JAR: '/missing/forbidden.jar' }
  });
  const report = JSON.parse(stdout);
  assert.equal(report.ready, true);
  assert.ok(report.checks.some(check => check.tool === 'PlantUML JS engine' && check.ok));
  assert.ok(report.checks.some(check => check.tool === '@plantuml/mcp-js' && check.version === '0.2.2'));
  assert.ok(!report.checks.some(check => /^(Java|JRE|PlantUML jar)$/.test(check.tool)));
});
