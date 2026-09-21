import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import { toolkitRoot } from './paths.mjs';

export async function createDocument(directory, { title, lang = 'en', preset = 'explainer' } = {}) {
  if (!title?.trim() || title.length > 300) throw new Error('Provide --title with 1–300 characters.');
  if (!['en', 'ru'].includes(lang)) throw new Error('Supported languages: en, ru.');
  if (!['explainer', 'process', 'integration'].includes(preset)) throw new Error('Presets: explainer, process, integration.');
  const content = await readFile(path.join(toolkitRoot, 'assets/starters', `${preset}.${lang}.html`), 'utf8');
  const root = path.resolve(directory);
  // Exclusive directory creation is intentional: never merge with an existing document.
  await mkdir(root, { recursive: false }).catch(error => {
    if (error.code === 'EEXIST') throw new Error(`Destination already exists; refusing to overwrite: ${root}`);
    if (error.code === 'ENOENT') throw new Error('Create the parent directory first, then run create again.');
    throw error;
  });
  try {
    await mkdir(path.join(root, 'diagrams'));
    await writeFile(path.join(root, 'document.json'), JSON.stringify({ title: title.trim(), description: '', lang }, null, 2) + '\n', { flag: 'wx' });
    await writeFile(path.join(root, 'content.html'), content, { flag: 'wx' });
    if (preset !== 'explainer') {
      const name = preset === 'process' ? 'process.bpmn' : 'exchange.puml';
      await writeFile(path.join(root, 'diagrams', name), await readFile(path.join(toolkitRoot, 'assets/starters', name)), { flag: 'wx' });
    }
    await writeFile(path.join(root, 'EDITING.md'), `${lang === 'ru' ? '# Как редактировать\n\nМеняйте название и описание в document.json, содержание в content.html, исходники схем в diagrams/. Не копируйте CSS, навигацию или оболочку страницы: сборщик добавит их сам.' : '# Editing\n\nEdit document.json for the title and description, content.html for the document, and diagrams/ for diagram sources. Do not copy CSS, navigation or the page shell: the builder adds them.'}\n\nBuild:\n\n\`node ${JSON.stringify(path.join(toolkitRoot, 'scripts/document.mjs'))} build ${JSON.stringify(root)} --out ${JSON.stringify(path.join(root, 'report.html'))}\`\n`);
  } catch (error) { await rm(root, { recursive: true, force: true }); throw error; }
  return root;
}
