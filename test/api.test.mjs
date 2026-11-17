import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,readFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createApp} from '../server.mjs';
import vm from 'node:vm';

test('two visitors, persistence, ranking isolation, idempotency, rejected forgery and injection',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'snake-test-'));let now=100000;
 let app=createApp({dbPath:join(dir,'game.sqlite'),clock:()=>now});
 const listen=async()=>{await new Promise(r=>app.server.listen(0,'127.0.0.1',r));return 'http://127.0.0.1:'+app.server.address().port;};
 let base=await listen();
 async function req(path,data,cookie='',headers={}){const r=await fetch(base+path,{method:data===undefined?'GET':'POST',headers:{...(data===undefined?{}:{'Content-Type':'application/json'}),Cookie:cookie,...headers},body:data===undefined?undefined:JSON.stringify(data)});return {status:r.status,body:await r.json(),cookie:r.headers.get('set-cookie')?.split(';')[0]};}
 const close=async()=>{await new Promise(r=>app.server.close(r));app.db.close();};
 try{
  const a=await req('/api/session',{}),b=await req('/api/session',{});
  assert.notEqual(a.body.id,b.body.id);assert.match(a.cookie,/snake_session=/);
  assert.equal((await req('/api/session',{},a.cookie)).body.id,a.body.id);
  assert.equal((await req('/api/profile',{name:'Али'},a.cookie)).status,200);
  assert.equal((await req('/api/profile',{name:'<script>alert(1)</script>'},b.cookie)).status,400);
  assert.equal((await req('/api/runs',{board:'zen-wrap'},a.cookie)).status,400);
  assert.equal((await req('/api/runs',{board:'classic-walls'},'',{Origin:'https://evil.test'})).status,403);
  const run=await req('/api/runs',{board:'classic-walls'},a.cookie);now+=10000;
  assert.equal((await req('/api/scores',{run:run.body.id,score:100,food:10,gold:0},b.cookie)).status,400);
  assert.equal((await req('/api/scores',{run:run.body.id,score:9999990,food:10,gold:0},a.cookie)).status,400);
  assert.equal((await req('/api/scores',{run:run.body.id,score:100,food:10,gold:0},a.cookie)).status,200);
  assert.equal((await req('/api/scores',{run:run.body.id,score:200,food:20,gold:0},a.cookie)).body.score,100);
  const rb=await req('/api/runs',{board:'classic-walls'},b.cookie);now+=10000;
  await req('/api/scores',{run:rb.body.id,score:50,food:5,gold:0},b.cookie);
  const ranking=await req('/api/leaderboard?board=classic-walls',undefined,b.cookie);
  assert.equal(ranking.body.rows.length,2);assert.equal(ranking.body.rows[0].name,'Али');assert.equal(ranking.body.me.rank,2);
  assert.equal((await req('/api/leaderboard?board=adventure-walls',undefined,a.cookie)).body.total,0);
  await close();app=createApp({dbPath:join(dir,'game.sqlite'),clock:()=>now});base=await listen();
  assert.equal((await req('/api/leaderboard?board=classic-walls',undefined,a.cookie)).body.me.score,100);
  const tooFast=await req('/api/runs',{board:'adventure-wrap'},a.cookie);
  assert.equal((await req('/api/scores',{run:tooFast.body.id,score:1000,food:100,gold:0},a.cookie)).status,400);
  assert.equal((await req('/health')).body.ok,true);
  assert.equal((await fetch(base+'/')).status,200);
  assert.equal((await fetch(base+'/online.js')).status,200);
  assert.equal((await fetch(base+'/server.mjs')).status,404);
 }finally{await close();rmSync(dir,{recursive:true,force:true});}
});

test('browser scripts parse and game emits captured run data',()=>{
 const html=readFileSync(new URL('../dist/index.html',import.meta.url),'utf8');
 const game=html.match(/<script>([\s\S]*?)<\/script>/)[1];
 new vm.Script(game);new vm.Script(readFileSync(new URL('../dist/online.js',import.meta.url),'utf8'));
 assert.match(game,/snake:start/);assert.match(game,/snake:end/);assert.match(game,/G.gold\+\+/);
});
