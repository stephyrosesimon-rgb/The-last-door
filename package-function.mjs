import { zipFunctions } from '@netlify/zip-it-and-ship-it';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
const destination=path.resolve('verification/function');
await mkdir(destination,{recursive:true});
const functions=await zipFunctions(path.resolve('netlify/functions'),destination,{
 archiveFormat:'zip',basePath:process.cwd(),config:{'*':{nodeBundler:'esbuild',nodeVersion:'22.x'}},
});
if(functions.length!==1||functions[0].name!=='game')throw Error('Expected exactly one standard game function.');
await writeFile(path.join(destination,'manifest.json'),JSON.stringify(functions.map(({name,runtime,runtimeVersion,size,mainFile})=>({name,runtime,runtimeVersion,size,entry:path.relative(process.cwd(),mainFile)})),null,2));
console.log('Packaged one function: game.zip');
