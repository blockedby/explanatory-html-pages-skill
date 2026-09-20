import { spawn } from 'node:child_process';
import { mkdtemp, rm, access } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_STDERR_BYTES = 64 * 1024;

// Owned by the renderer, not supplied through an external config/include file.
const STYLE = `!pragma layout smetana
skinparam monochrome true
skinparam backgroundColor transparent
skinparam shadowing false
skinparam defaultFontName SansSerif
skinparam defaultFontSize 13
skinparam defaultTextAlignment center
skinparam roundCorner 0
skinparam nodesep 25
skinparam ranksep 30
skinparam ArrowColor #333333
skinparam LineColor #333333
skinparam defaultFontColor #222222
skinparam sequenceMessageAlign center
hide footbox`;

function prepareSource(source) {
  if (typeof source !== 'string') throw new TypeError('PlantUML source must be a string');
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    throw new Error('PlantUML source exceeds the 256 KiB limit');
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(source)) {
    throw new Error('PlantUML source contains unsupported control characters');
  }
  // Deliberately conservative subset: no preprocessor, built-in function, image,
  // style/layout replacement or pagination. Scan even comments/quoted text, and
  // joined continuation lines, rather than trying to reproduce PlantUML's parser.
  const scan = source.replace(/\\\r?\n/g, '');
  if (/!|%\s*[a-z_][\w]*\s*\(|<\s*(?:img|image|style)\b|\b(?:skinparam|skin|newpage)\b/iu.test(scan)) {
    throw new Error('PlantUML unsafe or unsupported directive: includes, preprocessors, functions, images, custom styles and newpage are disabled');
  }
  const normalized = source.replace(/^\uFEFF/u, '').replace(/\r\n?/g, '\n').trim();
  if (!/^@startuml\s*\n[\s\S]*\n@enduml$/u.test(normalized)
      || (normalized.match(/@(?:start|end)\w+/giu) ?? []).join(',').toLowerCase() !== '@startuml,@enduml') {
    throw new Error('PlantUML requires exactly one @startuml / @enduml block, without filenames or surrounding content');
  }
  const body = normalized.slice(normalized.indexOf('\n') + 1, normalized.lastIndexOf('\n'));
  if (!body.replace(/\/'[\s\S]*?'\//g, '').replace(/^\s*'.*$/gm, '').trim()) {
    throw new Error('PlantUML source must contain diagram content, not only delimiters or comments');
  }
  return normalized.replace(/^@startuml\s*\n/u, `@startuml\n${STYLE}\n`);
}

function run(java, jar, input, cwd, timeoutMs) {
  return new Promise((resolveResult, reject) => {
    // Never inherit JAVA_TOOL_OPTIONS, JDK_JAVA_OPTIONS, include paths, proxy
    // settings or PlantUML profile overrides from the host. No shell or dot.
    const child = spawn(java, [
      '-Xmx256m', '-Djava.awt.headless=true', '-Dfile.encoding=UTF-8',
      '-DPLANTUML_SECURITY_PROFILE=SANDBOX',
      `-Djava.util.prefs.userRoot=${cwd}`, `-Djava.util.prefs.systemRoot=${cwd}`,
      '-jar', jar, '--svg', '--pipe', '--charset', 'UTF-8',
      '--no-error-image', '--disable-metadata',
    ], {
      cwd, shell: false, windowsHide: true,
      env: { PATH: '', LANG: 'C.UTF-8', HOME: cwd,
        PLANTUML_SECURITY_PROFILE: 'SANDBOX', PLANTUML_LIMIT_SIZE: '4096',
        GRAPHVIZ_DOT: join(cwd, 'disabled-dot') },
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    let failure;
    let outputBytes = 0;
    let errorBytes = 0;
    const stdout = [];
    const stderr = [];
    const stop = (error) => {
      failure ??= error;
      child.kill('SIGKILL');
    };
    const timer = setTimeout(() => stop(new Error(`PlantUML timed out after ${timeoutMs} ms`)), timeoutMs);
    child.on('error', (error) => { failure ??= new Error(`Cannot start PlantUML Java runtime: ${error.message}`); });
    child.stdin.on('error', (error) => {
      // A failed renderer can close its pipe early; retain its exit diagnostics.
      if (error.code !== 'EPIPE') stop(new Error(`PlantUML input failed: ${error.message}`));
    });
    child.stdout.on('data', (chunk) => {
      outputBytes += chunk.length;
      if (outputBytes > MAX_OUTPUT_BYTES) stop(new Error('PlantUML output exceeds the 8 MiB limit'));
      else stdout.push(chunk);
    });
    child.stderr.on('data', (chunk) => {
      errorBytes += chunk.length;
      if (errorBytes > MAX_STDERR_BYTES) stop(new Error('PlantUML diagnostics exceed the 64 KiB limit'));
      else stderr.push(chunk);
    });
    child.on('close', (code, signal) => {
      clearTimeout(timer);
      if (failure) return reject(failure);
      const diagnostics = Buffer.concat(stderr).toString('utf8').trim();
      if (code !== 0) {
        return reject(new Error(`PlantUML rendering failed (exit ${code ?? signal}): ${diagnostics.slice(0, 2000) || 'no diagnostics'}`));
      }
      const svg = Buffer.concat(stdout).toString('utf8');
      // --no-error-image plus exit status is primary; also refuse known renderer
      // error artifacts and multiple SVG documents. Sanitization is the caller's job.
      if (/\b(?:Syntax Error|Error line \d+|java\.lang\.\w*(?:Exception|Error))\b/i.test(diagnostics)
          || /id=["'](?:error|plantuml-error)["']|data-diagram-type=["']ERROR["']|Syntax Error\? \(Assumed diagram type:/i.test(svg)
          || (svg.match(/<svg\b/g) ?? []).length !== 1
          || !/<\/svg>\s*$/u.test(svg)) {
        return reject(new Error(`PlantUML did not produce a single successful SVG: ${diagnostics.slice(0, 2000)}`));
      }
      resolveResult(svg);
    });
    child.stdin.end(input, 'utf8');
  });
}

/** Render a single editable PlantUML diagram locally; returned SVG is NOT sanitized. */
export async function renderPlantUml(source, options = {}) {
  const input = prepareSource(source);
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new RangeError('PlantUML timeoutMs must be an integer from 1 to 120000');
  }
  const root = resolve(options.toolkitRoot ?? DEFAULT_ROOT);
  const java = resolve(process.env.JAVA_BIN || join(root, '.tools/jre/bin/java'));
  const jar = resolve(process.env.PLANTUML_JAR || join(root, '.tools/plantuml.jar'));
  try {
    await access(java, constants.X_OK);
    await access(jar, constants.R_OK);
  } catch (error) {
    throw new Error(`PlantUML local tooling unavailable; prepare .tools/jre/bin/java and .tools/plantuml.jar or set JAVA_BIN and PLANTUML_JAR: ${error.message}`);
  }
  const cwd = await mkdtemp(join(tmpdir(), 'plantuml-render-'));
  try {
    const svg = await run(java, jar, input, cwd, timeoutMs);
    return { svg, source, extension: 'puml', warnings: [] };
  } finally {
    await rm(cwd, { recursive: true, force: true });
  }
}
