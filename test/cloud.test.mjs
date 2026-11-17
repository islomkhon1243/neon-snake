import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createCloudAPI} from '../lib/cloud-api.mjs';

class Store{
 data=new Map(); seq=0;
 async get(k){return structuredClone(this.data.get(k)?.data??null);}
 async getWithMetadata(k){return structuredClone(this.data.get(k)??null);}
 async setJSON(k,v,o={}){const old=this.data.get(k);if((o.onlyIfNew&&old)||(o.onlyIfMatch&&old?.etag!==o.onlyIfMatch))return {modified:false};this.data.set(k,{data:structuredClone(v),etag:String(++this.seq)});return {modified:true};}
 async *list({prefix}){const blobs=[...this.data.keys()].filter(k=>k.startsWith(prefix)).map(key=>({key}));for(let i=0;i<blobs.length;i+=2)yield {blobs:blobs.slice(i,i+2)};}
}
test('cloud leaderboard shared between browsers and cold starts, CAS preserves parallel results',async()=>{
 const store=new Store();let now=10000;
 // A fresh handler per request simulates separate serverless instances.
 async function call(path,data,cookie=''){
  const r=await createCloudAPI(store,()=>now)(new Request('https://game.test/api/'+path,{method:data===undefined?'GET':'POST',headers:{'Content-Type':'application/json',Cookie:cookie},body:data===undefined?undefined:JSON.stringify(data)}));
  return {status:r.status,data:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};
 }
 const a=await call('session',{}),b=await call('session',{});
 assert.notEqual(a.data.id,b.data.id);
 await call('profile',{name:'Первый'},a.cookie);
 const ar=await call('runs',{board:'classic-walls'},a.cookie),br=await call('runs',{board:'classic-walls'},b.cookie);
 now+=10000;
 assert.equal((await call('scores',{run:ar.data.id,score:100,food:10,gold:0},b.cookie)).status,400);
 await Promise.all([call('scores',{run:ar.data.id,score:100,food:10,gold:0},a.cookie),call('scores',{run:br.data.id,score:50,food:5,gold:0},b.cookie)]);
 const ra=await call('leaderboard?board=classic-walls',undefined,a.cookie),rb=await call('leaderboard?board=classic-walls',undefined,b.cookie),guest=await call('leaderboard?board=classic-walls');
 assert.equal(ra.data.rows[0].name,'Первый');assert.equal(rb.data.rows[0].name,'Первый');assert.equal(guest.data.total,2);assert.equal(rb.data.me.rank,2);
 assert.equal((await call('leaderboard?board=adventure-walls')).data.total,0);
 assert.equal((await call('scores',{run:ar.data.id,score:9990,food:999,gold:0},a.cookie)).data.score,100);
 const runs=await Promise.all([call('runs',{board:'classic-walls'},a.cookie),call('runs',{board:'classic-walls'},a.cookie)]);now+=10000;
 const results=await Promise.all(runs.map((r,i)=>call('scores',{run:r.data.id,score:(i+2)*100,food:(i+2)*10,gold:0},a.cookie)));
 assert(results.every(r=>r.status===200));
 assert.equal((await call('leaderboard?board=classic-walls',undefined,a.cookie)).data.me.score,300);
 assert.equal((await call('profile',{name:'<script>'},a.cookie)).status,400);
 assert.equal((await call('runs',{board:'zen-wrap'},a.cookie)).status,400);
 assert.equal((await call('session',{},a.cookie)).data.name,'Первый');
});
