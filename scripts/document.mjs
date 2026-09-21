#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const help = `Documentation toolkit — reuse the theme, author the content.

  node scripts/document.mjs create DIRECTORY --title TEXT [--lang en|ru] [--preset explainer|process|integration]
  node scripts/document.mjs build DIRECTORY --out REPORT.html
  node scripts/document.mjs doctor

Edit document.json, content.html and diagrams/ in the created directory.
No CSS, page shell, navigation or framework authoring is needed.
Create refuses existing directories. Build replaces only its explicit output file.
Run 'node scripts/setup.mjs' once to install npm dependencies (no Java or browser download).
BPMN diagrams render in the reader browser, offline, with JavaScript enabled.
`;
export async function main(argv = process.argv.slice(2)) {
  if (!argv.length || argv.includes('--help') || argv[0] === 'help') { console.log(help); return; }
  const [command, ...args] = argv;
  if (!['create', 'build', 'doctor'].includes(command)) throw new Error(`Unknown command: ${command}. Use --help.`);
  if (command === 'doctor') {
    if (args.length) throw new Error('doctor accepts no arguments.');
    const { doctor } = await import('./lib/tooling.mjs');
    const result = await doctor();
    console.log(JSON.stringify(result, null, 2));
    if (!result.ready) process.exitCode = 1;
    return;
  }
  const directory = args.shift();
  if (!directory || directory.startsWith('--')) throw new Error('Provide a document directory.');
  const allowed = command === 'create' ? ['title', 'lang', 'preset'] : ['out'];
  const options = {};
  while (args.length) {
    const flag = args.shift();
    const key = flag.replace(/^--/, '');
    if (!flag.startsWith('--') || !allowed.includes(key) || key in options) throw new Error(`Unknown or duplicate option: ${flag}`);
    const value = args.shift();
    if (!value || value.startsWith('--')) throw new Error(`Missing value for ${flag}`);
    options[key] = value;
  }
  if (command === 'create') {
    const { createDocument } = await import('./lib/create.mjs');
    console.log(`Created: ${await createDocument(directory, options)}`);
    console.log('Edit content.html and diagram sources, then run build.');
  } else {
    const { buildDocument } = await import('./lib/build.mjs');
    const result = await buildDocument(directory, options);
    console.log(`Built: ${result.output}\nSections: ${result.sections}; diagrams: ${result.diagrams}\nExternal dependencies at reading time: none`);
    if (result.browserRenderedBpmn) console.log('BPMN renders locally in the reader browser with JavaScript enabled. Wait for diagrams before printing.');
    for (const warning of result.warnings) console.warn(`Note: ${warning}`);
  }
}
if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  main().catch(error => {
    const message = error.code === 'ERR_MODULE_NOT_FOUND' ? `${error.message}\nRun node scripts/setup.mjs from the skill directory first.` : error.message;
    console.error(`Error: ${message}`);
    process.exitCode = 1;
  });
}
