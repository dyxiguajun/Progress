import {build} from 'vite';
import {mkdir,copyFile,readFile,writeFile} from 'node:fs/promises';
import JSZip from 'jszip';
const output='artifacts/progress-background';await mkdir(output,{recursive:true});
await build({configFile:false,build:{outDir:output,emptyOutDir:true,target:'chrome120',minify:true,lib:{entry:'extension/worker.ts',formats:['es'],fileName:()=> 'worker.js'}}});
for(const name of ['manifest.json','content.js','options.html','options.css','options.js'])await copyFile(`extension/${name}`,`${output}/${name}`);
const zip=new JSZip();for(const name of ['manifest.json','worker.js','content.js','options.html','options.css','options.js'])zip.file(name,await readFile(`${output}/${name}`));zip.file('LICENSE',await readFile('LICENSE'));await writeFile('artifacts/progress-background-v0.6.5.zip',await zip.generateAsync({type:'uint8array',compression:'DEFLATE'}));console.log('Built artifacts/progress-background and v0.6.5 ZIP');
