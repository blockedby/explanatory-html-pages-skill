import { Worker } from 'node:worker_threads';

const MAX_BYTES = 2 * 1024 * 1024;

/** Browser-free preparation. toolkitRoot is accepted for caller compatibility;
 * dependencies resolve locally from this module, not a browser/toolkit cache.
 * Authored XML (including colors) is preserved; generated DI is returned only.
 */
export async function prepareBpmn(source, options = {}) {
  if (typeof source !== 'string' || !source.trim()) throw new Error('BPMN source must be non-empty XML');
  if (Buffer.byteLength(source) > MAX_BYTES) throw new Error('BPMN source exceeds 2 MiB limit');
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source)) throw new Error('BPMN XML DOCTYPE/entities are forbidden');
  const timeoutMs = options.timeoutMs ?? 30000;
  if (!Number.isFinite(timeoutMs) || timeoutMs < 1 || timeoutMs > 120000) throw new Error('BPMN timeoutMs must be between 1 and 120000');

  // Parsing as well as layout is off-thread: synchronous XML/engine CPU work
  // must not prevent the parent deadline from cancelling an untrusted input.
  const worker = new Worker(new URL('./bpmn-layout-worker.mjs', import.meta.url), {
    workerData: { source },
    resourceLimits: { maxOldGenerationSizeMb: 256 }
  });
  let timer;
  try {
    return await new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(new Error(`BPMN preparation timed out after ${timeoutMs}ms`)), timeoutMs);
      worker.once('message', result => result.error ? reject(new Error(result.error)) : resolve(result));
      worker.once('error', error => reject(new Error(`BPMN preparation: ${error.message}`, { cause: error })));
      worker.once('exit', code => reject(new Error(`BPMN preparation worker exited (${code})`)));
    });
  } finally {
    clearTimeout(timer);
    await worker.terminate();
  }
}
