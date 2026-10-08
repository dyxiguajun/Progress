import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import JSZip from 'jszip';

const root = resolve(import.meta.dirname, '..');
await mkdir(resolve(root, 'artifacts'), { recursive: true });
for (const name of ['countdown', 'transfer', 'http']) {
  const zip = new JSZip(), directory = resolve(root, 'examples', name);
  for (const file of await readdir(directory)) zip.file(file, await readFile(resolve(directory, file)));
  await writeFile(resolve(root, 'artifacts', `${name}.progressmod`), await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
  console.log(`artifacts/${name}.progressmod`);
}
