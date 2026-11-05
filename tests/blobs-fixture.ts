import {createServer} from 'node:http';
import type {AddressInfo} from 'node:net';

// Test-only HTTP fixture for the documented Blobs wire contract. The official
// @netlify/blobs 11.1.7 local server omits ETags on GET. No production code uses this.
export async function startBlobsFixture(){
 const rows=new Map<string,{body:Buffer;etag:string}>();let version=0,reads=0,writes=0,conflicts=0;
 const server=createServer(async(req,res)=>{
  const key=req.url||'/';
  if(req.method==='GET'){
   reads++;const row=rows.get(key);if(!row){res.writeHead(404);res.end();return;}
   res.writeHead(200,{'Content-Type':'application/json',etag:row.etag});res.end(row.body);return;
  }
  if(req.method==='PUT'){
   const chunks:Buffer[]=[];for await(const chunk of req)chunks.push(Buffer.from(chunk));
   // No await between condition check and commit: one atomic operation.
   const old=rows.get(key),match=req.headers['if-match'],fresh=req.headers['if-none-match'];
   if(!match&&fresh!=='*'){res.writeHead(400);res.end('Conditional write required');return;}
   if(fresh==='*'&&old||match&&(!old||old.etag!==match)){conflicts++;res.writeHead(412);res.end();return;}
   const etag='"v'+(++version)+'"';rows.set(key,{body:Buffer.concat(chunks),etag});writes++;res.writeHead(200,{etag});res.end();return;
  }
  res.writeHead(405);res.end();
 });
 await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
 const address=`http://127.0.0.1:${(server.address() as AddressInfo).port}`;
 return {context:{siteID:'test-site',token:'fixture-only',edgeURL:'http://127.0.0.1:1',uncachedEdgeURL:address},stats:()=>({reads,writes,conflicts}),stop:()=>new Promise<void>(resolve=>server.close(()=>resolve()))};
}
