import {mkdir,copyFile} from 'node:fs/promises';
await mkdir(new URL('../dist/',import.meta.url),{recursive:true});
for(const file of ['index.html','admin.html','admin.js'])await copyFile(new URL('../'+file,import.meta.url),new URL('../dist/'+file,import.meta.url));
