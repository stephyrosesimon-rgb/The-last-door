import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {handleGame,type RoomStore} from '../src/server/service.js';
import {completeGame,client} from './scenario.js';
class AtomicStore implements RoomStore {
 rows=new Map<string,{data:any;etag:string}>(); counter=0; conflicts=0; writes=0;
 async getWithMetadata(key:string,options:any){assert.equal(options.consistency,'strong');const row=this.rows.get(key);return row?structuredClone(row):null;}
 async setJSON(key:string,data:any,options:any){assert.ok(options.onlyIfNew===true||typeof options.onlyIfMatch==='string','Every write must be conditional');const old=this.rows.get(key);if(options.onlyIfNew?!!old:old?.etag!==options.onlyIfMatch){this.conflicts++;return {modified:false};}this.rows.set(key,{data:structuredClone(data),etag:'"'+(++this.counter)+'"'});this.writes++;return {modified:true};}
}
test('two players complete three rounds, scores and final winner',async()=>{const store=new AtomicStore();const result=await completeGame(req=>handleGame(req,store));assert.equal(result.winner,'Ben');console.log(JSON.stringify(result));});
test('concurrent joins, lost responses, stale writes, duplicate hints, and capacity',async()=>{
 const store=new AtomicStore(),c=client(req=>handleGame(req,store));
 const requestId=randomUUID();const [a,again]=await Promise.all([c.ok({op:'create',name:'Host',requestId}),c.ok({op:'create',name:'Host',requestId})]);assert.deepEqual(a,again);
 const guests=await Promise.all(Array.from({length:7},(_,i)=>c.ok({op:'join',code:a.code,name:'Guest '+i})));
 assert.equal((await c.state(a)).players.length,8);assert.ok(store.conflicts>0,'race exercised CAS conflict retry');
 assert.equal((await c.raw({op:'join',code:a.code,name:'Ninth',requestId:randomUUID()})).status,400);
 await c.act(a,'start');const hintId=randomUUID();await Promise.all([c.act(a,'hint',{requestId:hintId}),c.act(a,'hint',{requestId:hintId})]);assert.equal((await c.state(a)).me.score,-15);
 assert.equal((await c.raw({op:'state',code:a.code,token:'not-a-player'})).status,401);
 const joinId=randomUUID();const r=await c.raw({op:'join',code:a.code,name:'Late',requestId:joinId});assert.equal(r.status,400);
 await c.act(guests[0],'pause');assert.equal((await c.raw({op:'action',...guests[1],action:'resume',requestId:randomUUID()})).status,400);await c.act(a,'resume');
});
test('racing final answers commit exactly one winner and timeout persists',async()=>{
 const store=new AtomicStore(),c=client(req=>handleGame(req,store)),a=await c.ok({op:'create',name:'A'}),b=await c.ok({op:'join',code:a.code,name:'B'});await c.act(a,'start');
 const row=store.rows.get('rooms/'+a.code)!;for(const p of row.data.players){p.foyer=true;p.seals=['Library','Conservatory','Workshop'];p.location='Vault';p.score=300;}
 const answer=row.data.game.answers.Vault;
 const results=await Promise.all([a,b].map(p=>c.raw({op:'action',...p,action:'solve',answer,requestId:randomUUID()})));
 assert.equal(results.filter(x=>x.status===200).length,1);assert.equal(results.filter(x=>x.status===400).length,1);
 const s=await c.state(a);assert.equal(s.winner,(await c.state(b)).winner);assert.equal(s.status,'ended');
 row.data=structuredClone(store.rows.get('rooms/'+a.code)!.data);row.data.status='playing';row.data.endsAt=Date.now()-1;row.data.players[0].score=400;store.rows.set('rooms/'+a.code,row);
 assert.equal((await c.state(b)).reason,'Time expired');assert.equal(store.rows.get('rooms/'+a.code)!.data.status,'ended');assert.equal((await c.state(a)).winner,s.me.id);
});
