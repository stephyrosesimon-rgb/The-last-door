import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {unzipSync} from 'fflate';
import {startBlobsFixture} from './blobs-fixture.js';
import {getStore} from '@netlify/blobs';
import {completeGame} from './scenario.js';

test('actual packaged game function and real Blobs SDK with atomic HTTP fixture: full two-player game',async()=>{
 await mkdir('.netlify/test-work',{recursive:true});const directory=await mkdtemp(path.resolve('.netlify/test-work/last-door-package-'));
 const blobs=await startBlobsFixture();
 const old=globalThis.netlifyBlobsContext;
 try{
  
  // Test-only automatic runtime context; users configure no environment variables or keys.
  globalThis.netlifyBlobsContext=Buffer.from(JSON.stringify(blobs.context)).toString('base64');
  const files=unzipSync(await readFile('verification/function/game.zip'));
  assert.ok(files['___netlify-entry-point.mjs']);assert.ok(files['netlify/functions/game.mjs']);
  for(const [name,bytes] of Object.entries(files)){const target=path.resolve(directory,'bundle',name);assert.ok(target.startsWith(path.resolve(directory,'bundle')+path.sep));await mkdir(path.dirname(target),{recursive:true});await writeFile(target,bytes);}
  const module=await import(pathToFileURL(path.join(directory,'bundle/netlify/functions/game.mjs')).href);
  assert.equal(typeof module.default,'function');
  const result=await completeGame(module.default);
  const store=getStore({name:'conditional-write-check',consistency:'strong'});
  assert.equal((await store.setJSON('value',{n:1},{onlyIfNew:true})).modified,true);
  assert.equal((await store.setJSON('value',{n:99},{onlyIfNew:true})).modified,false);
  const entry=await store.getWithMetadata('value',{type:'json',consistency:'strong'});assert.ok(entry?.etag);
  assert.equal((await store.setJSON('value',{n:2},{onlyIfMatch:entry.etag})).modified,true);
  assert.equal((await store.setJSON('value',{n:3},{onlyIfMatch:entry.etag})).modified,false);
  const script=await readFile('src/main.js','utf8');assert.ok(script.includes("'/.netlify/functions/game'"));assert.ok(!script.includes('EventSource'));assert.ok(!script.includes('/api/'));
  const entrySource=await readFile('netlify/functions/game.ts','utf8');assert.ok(!/export\s+const\s+config/.test(entrySource));
  const html=await readFile('dist/index.html','utf8');assert.match(html,/assets\/index-.*\.js/);
  const report={...result,backend:'Actual packaged default export + real Netlify Blobs SDK + local atomic HTTP contract fixture (not hosted Netlify)',fixtureRequests:blobs.stats(),consistency:'strong (only uncached endpoint reachable in fixture)',conditionalWrites:'onlyIfNew and onlyIfMatch verified; stale writes rejected',productionBuild:'Vite build passed',hostedDeployment:'Not deployed to a live Netlify account',testedAt:new Date().toISOString()};
  await writeFile('verification/results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
 }finally{globalThis.netlifyBlobsContext=old;await blobs.stop();await rm(directory,{recursive:true,force:true});}
});

