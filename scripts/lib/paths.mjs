import { realpath, lstat, mkdir, writeFile, rename, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

export const toolkitRoot = fileURLToPath(new URL('../../', import.meta.url));
export function inside(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
export async function sourceFile(root, relative) {
  if (typeof relative !== 'string' || !relative || path.isAbsolute(relative) || relative.includes('\0')) throw new Error('Source path must be a nonempty relative path.');
  const base = await realpath(root);
  const candidate = path.resolve(base, relative);
  if (!inside(base, candidate)) throw new Error(`Source path escapes document directory: ${relative}`);
  const actual = await realpath(candidate);
  if (!inside(base, actual)) throw new Error(`Source symlink escapes document directory: ${relative}`);
  const stat = await lstat(actual);
  if (!stat.isFile()) throw new Error(`Not a source file: ${relative}`);
  if (stat.size > 2 * 1024 * 1024) throw new Error(`Source exceeds 2 MiB limit: ${relative}`);
  return actual;
}
export async function atomicOutput(destination, data, protectedPaths = []) {
  const target = path.resolve(destination);
  await mkdir(path.dirname(target), { recursive: true });
  const parent = await realpath(path.dirname(target));
  const actualTarget = path.join(parent, path.basename(target));
  let existing;
  try { existing = await lstat(actualTarget); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  if (existing && (!existing.isFile() || existing.isSymbolicLink())) throw new Error('Output must be a regular file, not a directory or symlink.');
  if (protectedPaths.includes(actualTarget)) throw new Error('Output would overwrite a document source. Choose another --out path.');
  const temp = path.join(parent, `.document-${randomUUID()}.tmp`);
  try {
    await writeFile(temp, data, { encoding: 'utf8', flag: 'wx' });
    await rename(temp, actualTarget);
  } finally { await unlink(temp).catch(() => {}); }
  return actualTarget;
}
