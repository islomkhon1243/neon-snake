import http from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { randomBytes, createHash } from 'node:crypto';
import { mkdirSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=dirname(fileURLToPath(import.meta.url));
const hash=s=>createHash('sha256').update(s).digest('hex');
const token=()=>randomBytes(32).toString('hex');
const validBoard=s=>['classic-walls','classic-wrap','adventure-walls','adventure-wrap'].includes(s);
const fail=(status,message)=>Object.assign(new Error(message),{status});
export function createApp({dbPath=process.env.DB_PATH||resolve(root,'data/snake.sqlite'),clock=Date.now}={}){
  if(dbPath!==':memory:')mkdirSync(dirname(dbPath),{recursive:true});
  const db=new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS players(id TEXT PRIMARY KEY, secret TEXT UNIQUE NOT NULL, name TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS runs(id TEXT PRIMARY KEY, player TEXT NOT NULL, board TEXT NOT NULL, started INTEGER NOT NULL, score INTEGER, ended INTEGER);
    CREATE INDEX IF NOT EXISTS runs_ranking ON runs(board,player,score DESC);
    CREATE INDEX IF NOT EXISTS runs_started ON runs(started);
    CREATE TABLE IF NOT EXISTS best(player TEXT NOT NULL,board TEXT NOT NULL,score INTEGER NOT NULL,achieved INTEGER NOT NULL,PRIMARY KEY(player,board));`);
  const limits=new Map();
  function limit(key,max=90){
    const now=clock();let r=limits.get(key);
    if(!r||now-r.at>60000){r={at:now,n:0};limits.set(key,r);}
    if(++r.n>max)throw fail(429,'Слишком много запросов. Подожди минуту.');
    if(limits.size>10000){for(const [k,v] of limits)if(now-v.at>60000)limits.delete(k);if(limits.size>10000)limits.delete(limits.keys().next().value);}
  }
  function player(req){
    const c=(req.headers.cookie||'').match(/(?:^|;\s*)snake_session=([a-f0-9]{64})(?:;|$)/);
    return c?db.prepare('SELECT id,name FROM players WHERE secret=?').get(hash(c[1])):null;
  }
  function json(res,status,data){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(data));}
  async function body(req){let text='';for await(const b of req){text+=b;if(Buffer.byteLength(text)>4096)throw fail(413,'Слишком большой запрос.');}try{return JSON.parse(text);}catch{throw fail(400,'Некорректный JSON.');}}
  const assets=new Map([['/',['index.html','text/html; charset=utf-8']],['/index.html',['index.html','text/html; charset=utf-8']],['/online.js',['online.js','text/javascript; charset=utf-8']]]);
  const server=http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:; frame-ancestors 'self'; base-uri 'none'; form-action 'self'");
    try{
      const url=new URL(req.url,'http://localhost');
      if(req.method==='GET'&&assets.has(url.pathname)){const [file,type]=assets.get(url.pathname);res.writeHead(200,{'Content-Type':type,'Cache-Control':'no-cache'});res.end(readFileSync(resolve(root,'public',file)));return;}
      if(req.method==='GET'&&url.pathname==='/health'){db.prepare('SELECT 1').get();return json(res,200,{ok:true});}
      if(!url.pathname.startsWith('/api/'))throw fail(404,'Не найдено.');
      if(!['GET','POST'].includes(req.method))throw fail(405,'Метод не поддерживается.');
      if(req.method==='POST'){
        if(req.headers['sec-fetch-site']==='cross-site')throw fail(403,'Чужой источник запроса.');
        if(req.headers.origin&&new URL(req.headers.origin).host!==req.headers.host)throw fail(403,'Чужой источник запроса.');
        if(!(req.headers['content-type']||'').startsWith('application/json'))throw fail(415,'Нужен JSON.');
      }
      let p=player(req);
      limit(p?'p:'+p.id:'ip:'+req.socket.remoteAddress,120);
      if(url.pathname==='/api/session'&&req.method==='POST'){
        if(!p){
          limit('create:'+req.socket.remoteAddress,30);
          const secret=token(),id=token().slice(0,24);p={id,name:'Гость-'+id.slice(0,5)};
          db.prepare('INSERT INTO players VALUES(?,?,?)').run(id,hash(secret),p.name);
          const secure=process.env.NODE_ENV==='production'||req.socket.encrypted;
          res.setHeader('Set-Cookie',`snake_session=${secret}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${secure?'; Secure':''}`);
        }
        return json(res,200,p);
      }
      if(!p)throw fail(401,'Обнови страницу для создания профиля.');
      if(url.pathname==='/api/profile'&&req.method==='POST'){
        const b=await body(req),name=typeof b.name==='string'?b.name.trim().normalize('NFC'):'';
        if(!/^[\p{L}\p{N} _.-]{2,20}$/u.test(name))throw fail(400,'Ник: 2–20 букв, цифр, пробелов, точек, дефисов или подчёркиваний.');
        db.prepare('UPDATE players SET name=? WHERE id=?').run(name,p.id);return json(res,200,{id:p.id,name});
      }
      if(url.pathname==='/api/runs'&&req.method==='POST'){
        const b=await body(req);if(!validBoard(b.board))throw fail(400,'Этот режим не участвует в рейтинге.');
        limit('runs:'+p.id,30);
        db.prepare('DELETE FROM runs WHERE started < ?').run(clock()-86400000);
        const id=token();db.prepare('INSERT INTO runs(id,player,board,started) VALUES(?,?,?,?)').run(id,p.id,b.board,clock());
        return json(res,201,{id});
      }
      if(url.pathname==='/api/scores'&&req.method==='POST'){
        const b=await body(req),r=typeof b.run==='string'?db.prepare('SELECT * FROM runs WHERE id=? AND player=?').get(b.run,p.id):null;
        if(!r)throw fail(400,'Партия не найдена или истекла.');
        if(r.score!==null)return json(res,200,{saved:true,score:r.score});
        const elapsed=clock()-r.started;
        if(![b.score,b.food,b.gold].every(Number.isSafeInteger)||b.score<0||b.score%10||b.food<0||b.gold<0||b.food>100000||b.gold>Math.floor(b.food/5)||elapsed>86400000)throw fail(400,'Некорректный результат.');
        const max=(b.food*10+b.gold*50)*(r.board.startsWith('classic')?1:5);
        if(b.score>max||(b.food+b.gold)*60>elapsed+250)throw fail(400,'Результат не соответствует длительности партии.');
        db.exec('BEGIN IMMEDIATE');
        try{
          db.prepare('UPDATE runs SET score=?,ended=? WHERE id=?').run(b.score,clock(),r.id);
          db.prepare(`INSERT INTO best VALUES(?,?,?,?) ON CONFLICT(player,board) DO UPDATE SET score=excluded.score,achieved=excluded.achieved WHERE excluded.score>best.score`).run(p.id,r.board,b.score,clock());
          db.exec('COMMIT');
        }catch(e){db.exec('ROLLBACK');throw e;}
        return json(res,200,{saved:true,score:b.score});
      }
      if(url.pathname==='/api/leaderboard'&&req.method==='GET'){
        const board=url.searchParams.get('board');if(!validBoard(board))throw fail(400,'Неизвестный режим.');
        const sql=`WITH ranked AS (SELECT b.player,p.name,b.score,ROW_NUMBER() OVER(ORDER BY b.score DESC,b.achieved ASC,b.player ASC) AS rank FROM best b JOIN players p ON p.id=b.player WHERE b.board=? AND b.score>0)`;
        const rows=db.prepare(sql+' SELECT * FROM ranked ORDER BY rank LIMIT 50').all(board);
        const me=db.prepare(sql+' SELECT * FROM ranked WHERE player=?').get(board,p.id)||null;
        const total=db.prepare('SELECT COUNT(*) AS n FROM best WHERE board=? AND score>0').get(board).n;
        return json(res,200,{rows:rows.map(r=>({rank:r.rank,name:r.name,score:r.score,me:r.player===p.id})),me:me?{rank:me.rank,score:me.score}:null,total});
      }
      throw fail(404,'Не найдено.');
    }catch(e){if(!e.status)console.error(e);if(!res.headersSent)json(res,e.status||500,{error:e.status?e.message:'Ошибка сервера. Попробуй позже.'});else res.end();}
  });
  server.requestTimeout=10000;
  return {server,db};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const {server,db}=createApp();server.listen(Number(process.env.PORT)||3000,'0.0.0.0',()=>console.log('NEON SNAKE started'));
  for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>server.close(()=>{db.close();process.exit(0);}));
}
