import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
export type Handler = (request: Request) => Promise<Response>;
export function client(handler: Handler) {
 const raw=async(b:any)=>{const response=await handler(new Request('https://manor.test/.netlify/functions/game',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)}));return {status:response.status,body:await response.json() as any};};
 const ok=async(b:any)=>{const result=await raw({...b,requestId:b.requestId||randomUUID()});assert.equal(result.status,200,JSON.stringify(result.body));return result.body;};
 return {raw,ok,state:(s:any)=>ok({op:'state',...s}),act:(s:any,action:string,extra:any={})=>ok({op:'action',...s,action,...extra})};
}
export async function completeGame(handler:Handler) {
 const c=client(handler),a=await c.ok({op:'create',name:'Ada'}),b=await c.ok({op:'join',code:a.code,name:'Ben'});
 let sa=await c.state(a),sb=await c.state(b);
 assert.equal(sa.players.length,2);assert.deepEqual(sa.receipts,[]);assert.equal(sa.me.token,undefined);assert.equal(sa.me.clue,undefined);
 assert.equal((await c.raw({op:'action',...b,action:'start',requestId:randomUUID()})).status,400);
 await c.act(a,'start');
 for(const p of [a,b])await c.act(p,'solve',{answer:'ECHO'});
 const roundScores=[];
 for(const [round,room] of ['Library','Conservatory','Workshop'].entries()){
  for(const p of [a,b]){
   await c.act(p,'move',{location:room});
   let s=await c.state(p);
   for(const object of s.scene.objects)await c.act(p,'inspect',{object:object.id});
   s=await c.state(p);let answer='';
   if(room==='Library'){const text=s.scene.objects.find((x:any)=>x.name==='Dusty bookcase').text;answer=['DUSK','MIDNIGHT','DAWN'].map(name=>text.match(new RegExp(name+' — spine (\\d)'))[1]).join('');}
   if(room==='Conservatory'){const text=s.scene.objects.find((x:any)=>x.name==='Plant labels').text;answer=['IVY','FERN','MOSS'].map(name=>text.match(new RegExp(name+':[^.]+tag (\\d)'))[1]).join('');}
   if(room==='Workshop'){const values=s.scene.objects[0].text.match(/\d+/g).map(Number),last=values.at(-1);answer=''+(last+7)+(last+15);}
   if(p===b)await c.act(p,'hint');
   const requestId=randomUUID();await c.act(p,'solve',{answer,requestId});
   // An identical retried submission must not award the seal twice.
   await c.act(p,'solve',{answer,requestId});
   s=await c.state(p);assert.equal(s.me.seals.length,round+1);assert.equal(s.me.score,(round+1)*(p===a?125:110));
  }
  sa=await c.state(a);sb=await c.state(b);roundScores.push({room,Ada:sa.me.score,Ben:sb.me.score});
 }
 // A pausing guest freezes all actions and the deadline, and the host can resume.
 await c.act(b,'pause');sa=await c.state(a);assert.equal(sa.status,'paused');const pausedEndsAt=sa.endsAt;
 assert.equal((await c.raw({op:'action',...a,action:'chat',text:'blocked',requestId:randomUUID()})).status,400);
 await new Promise(r=>setTimeout(r,25));await c.act(a,'resume');sa=await c.state(a);assert.ok(sa.endsAt>pausedEndsAt);
 await c.act(a,'share',{room:'Library'});sb=await c.state(b);assert.equal(sb.messages.at(-1).verified,true);
 for(const p of [a,b])await c.act(p,'move',{location:'Vault'});
 const final=(s:any)=>['Conservatory','Library','Workshop'].map(room=>{const r=s.receipts.find((x:any)=>x.room===room);return r.answer[r.mark];}).join('');
 sb=await c.state(b);await c.act(b,'solve',{answer:final(sb)});
 sa=await c.state(a);sb=await c.state(b);assert.equal(sa.status,'ended');assert.equal(sa.winner,sb.me.id);assert.equal(sb.winner,sb.me.id);
 assert.equal((await c.raw({op:'action',...a,action:'solve',answer:final(sa),requestId:randomUUID()})).status,400);
 assert.equal((await c.state(a)).winner,sb.me.id);
 return {roundScores,finalScores:{Ada:375,Ben:330},winner:'Ben',reason:sa.reason,verified:'Both players completed the three original puzzle rooms; Ben opened the Vault first despite fewer points.'};
}
