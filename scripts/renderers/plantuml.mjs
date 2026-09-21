import { Worker } from 'node:worker_threads';

const MAX_SOURCE_BYTES = 256 * 1024;
const MAX_OUTPUT_BYTES = 8 * 1024 * 1024;
const MAX_DIAGNOSTIC_BYTES = 64 * 1024;

// Owned by the renderer; Viz.js WASM supplies layout, without a layout pragma.
const STYLE = `skinparam monochrome true
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
skinparam sequenceParticipantBackgroundColor #EEEEEE
skinparam noteBackgroundColor #EEEEEE
skinparam actorBackgroundColor #EEEEEE
' The TeaVM SVG backend omits its default lifeline stroke instead of
' serializing it. A renderer-owned style makes that inherited default explicit.
<style>
sequenceDiagram {
  lifeLine {
    LineColor #333333
    LineThickness 1
    LineStyle 2
  }
}
</style>
hide circle
hide footbox`;

function prepareSource(source) {
  if (typeof source !== 'string') throw new TypeError('PlantUML source must be a string');
  if (Buffer.byteLength(source, 'utf8') > MAX_SOURCE_BYTES) {
    throw new Error('PlantUML source exceeds the 256 KiB limit');
  }
  if (/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/u.test(source)) {
    throw new Error('PlantUML source contains unsupported control characters');
  }
  // Scan comments/quoted text and joined continuations too: deliberately not a
  // full parser. No preprocessor, resource loading, styles or pagination.
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

function run(source, timeoutMs) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./plantuml-worker.mjs', import.meta.url), {
      workerData: { source, maxOutputBytes: MAX_OUTPUT_BYTES, maxDiagnosticBytes: MAX_DIAGNOSTIC_BYTES },
      // Do not inherit CLI preloads or host environment overrides.
      execArgv: [], env: {}, stdout: true, stderr: true,
      resourceLimits: { maxOldGenerationSizeMb: 256, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    });
    let settled = false;
    let diagnosticBytes = 0;
    let diagnostics = '';
    const finish = (error, result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // Await teardown so success, timeout and errors never leave a worker alive.
      worker.terminate().then(() => error ? reject(error) : resolve(result), reject);
    };
    const timer = setTimeout(() => finish(new Error(`PlantUML timed out after ${timeoutMs} ms`)), timeoutMs);
    for (const stream of [worker.stdout, worker.stderr]) {
      stream.on('data', (chunk) => {
        diagnosticBytes += chunk.length;
        if (diagnosticBytes > MAX_DIAGNOSTIC_BYTES) {
          finish(new Error('PlantUML diagnostics exceed the 64 KiB limit'));
        } else if (diagnostics.length < 2000) diagnostics += chunk.toString('utf8').slice(0, 2000 - diagnostics.length);
      });
    }
    worker.on('error', (error) => finish(new Error(`PlantUML JS worker failed: ${error.message}`)));
    worker.on('exit', (code) => finish(new Error(`PlantUML JS worker exited without a result (exit ${code}): ${diagnostics}`)));
    worker.on('message', (result) => {
      if (result?.error) return finish(new Error(`PlantUML rendering failed: ${result.error}`));
      const svg = result?.svg;
      if (typeof svg !== 'string' || Buffer.byteLength(svg) > MAX_OUTPUT_BYTES
          || (svg.match(/<svg\b/g) ?? []).length !== 1 || !/<\/svg>\s*$/u.test(svg)
          || /id=["'](?:error|plantuml-error)["']|data-diagram-type=["']ERROR["']|Syntax Error\? \(Assumed diagram type:/i.test(svg)) {
        return finish(new Error('PlantUML JS engine did not produce a single successful SVG'));
      }
      if (!Array.isArray(result.warnings) || result.warnings.some((value) => typeof value !== 'string')) {
        return finish(new Error('PlantUML JS engine returned invalid warnings'));
      }
      finish(null, result);
    });
  });
}

/** Local JS/WASM rendering. toolkitRoot is retained for compatibility, ignored.
 * Returned SVG is NOT sanitized. Heap/WASM growth caps are not an OS-level RSS limit.
 */
export async function renderPlantUml(source, options = {}) {
  const input = prepareSource(source);
  const timeoutMs = options.timeoutMs ?? 15_000;
  if (!Number.isInteger(timeoutMs) || timeoutMs < 1 || timeoutMs > 120_000) {
    throw new RangeError('PlantUML timeoutMs must be an integer from 1 to 120000');
  }
  const { svg, warnings } = await run(input, timeoutMs);
  return { svg, source, extension: 'puml', warnings };
}
