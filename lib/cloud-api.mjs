import {randomBytes,createHash} from 'node:crypto';
const token=()=>randomBytes(32).toString('hex');
const hash=s=>createHash('sha256').update(s).digest('hex');
const boards=['classic-walls','classic-wrap','adventure-walls','adventure-wrap'];
const error=(status,message)=>Object.assign(new Error(message),{status});
const response=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}});
export function createCloudAPI(store,clock=Date.now){
 async function update(key,fn){
  for(let i=0;i<12;i++){
   const entry=await store.getWithMetadata(key,{type:'json'});
   if(!entry)throw error(401,'Профиль не найден. Обнови страницу.');
   const p=entry.data,result=fn(p);
   const saved=await store.setJSON(key,p,{onlyIfMatch:entry.etag});
   if(saved.modified)return result;
  }
  throw error(409,'Параллельное обновление. Повтори запрос.');
 }
 return async function handle(req){
  try{
   const url=new URL(req.url),path=url.pathname;
   if(req.method==='POST'){
    if(req.headers.get('sec-fetch-site')==='cross-site'||(req.headers.get('origin')&&req.headers.get('origin')!==url.origin))throw error(403,'Чужой источник запроса.');
    if(!req.headers.get('content-type')?.startsWith('application/json'))throw error(415,'Нужен JSON.');
   }else if(req.method!=='GET')throw error(405,'Метод не поддерживается.');
   const cookie=req.headers.get('cookie')?.match(/(?:^|;\s*)snake_cloud=([a-f0-9]{64})(?:;|$)/);
   const key=cookie?'players/'+hash(cookie[1]):null;
   const p=key?await store.get(key,{type:'json'}):null;
   async function body(){
    const reader=req.body?.getReader();let text='',bytes=0;const decoder=new TextDecoder();
    if(reader){while(true){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>4096){await reader.cancel();throw error(413,'Слишком большой запрос.');}text+=decoder.decode(value,{stream:true});}text+=decoder.decode();}
    try{const b=JSON.parse(text);if(!b||typeof b!=='object'||Array.isArray(b))throw Error();return b;}catch{throw error(400,'Некорректный JSON.');}
   }
   if(path==='/api/session'&&req.method==='POST'){
    if(p)return response({id:p.id,name:p.name});
    const secret=token(),id=token().slice(0,24),name='Гость-'+id.slice(0,5);
    const result=await store.setJSON('players/'+hash(secret),{id,name,runs:{},best:{}},{onlyIfNew:true});
    if(!result.modified)throw error(503,'Не удалось создать профиль. Повтори запрос.');
    return response({id,name},200,{'Set-Cookie':`snake_cloud=${secret}; HttpOnly; SameSite=Lax; Path=/; Max-Age=31536000${url.protocol==='https:'?'; Secure':''}`});
   }
   if(path==='/api/leaderboard'&&req.method==='GET'){
    const board=url.searchParams.get('board');if(!boards.includes(board))throw error(400,'Неизвестный режим.');
    const rows=[];
    for await(const page of store.list({prefix:'players/',paginate:true})){
     for(let i=0;i<page.blobs.length;i+=20){
      const players=await Promise.all(page.blobs.slice(i,i+20).map(b=>store.get(b.key,{type:'json'})));
      for(const person of players){const best=person?.best[board];if(best?.score>0)rows.push({id:person.id,name:person.name,...best});}
     }
    }
    rows.sort((a,b)=>b.score-a.score||a.achieved-b.achieved||a.id.localeCompare(b.id));
    const mine=p?rows.findIndex(r=>r.id===p.id):-1;
    return response({rows:rows.slice(0,50).map((r,i)=>({rank:i+1,name:r.name,score:r.score,me:r.id===p?.id})),me:mine<0?null:{rank:mine+1,score:rows[mine].score},total:rows.length});
   }
   if(!p)throw error(401,'Обнови страницу для подключения профиля.');
   if(path==='/api/profile'&&req.method==='POST'){
    const b=await body(),name=typeof b.name==='string'?b.name.trim().normalize('NFC'):'';
    if(!/^[\p{L}\p{N} _.-]{2,20}$/u.test(name))throw error(400,'Ник: 2–20 букв, цифр, пробелов, точек, дефисов или подчёркиваний.');
    return response(await update(key,p=>{p.name=name;return {id:p.id,name};}));
   }
   if(path==='/api/runs'&&req.method==='POST'){
    const b=await body();if(!boards.includes(b.board))throw error(400,'Этот режим вне рейтинга.');
    const id=token();return response(await update(key,p=>{
     p.runs=Object.fromEntries(Object.entries(p.runs).filter(([,r])=>clock()-r.started<86400000));
     if(Object.values(p.runs).filter(r=>clock()-r.started<60000).length>=30)throw error(429,'Подожди минуту перед новой партией.');
     if(Object.keys(p.runs).length>=200)throw error(429,'Достигнут лимит 200 партий за сутки.');
     p.runs[id]={board:b.board,started:clock(),score:null};return {id};
    }),201);
   }
   if(path==='/api/scores'&&req.method==='POST'){
    const b=await body();return response(await update(key,p=>{
     const r=typeof b.run==='string'&&/^[a-f0-9]{64}$/.test(b.run)?p.runs[b.run]:null;
     if(!r||clock()-r.started>86400000)throw error(400,'Партия истекла или не найдена.');
     if(r.score!==null)return {saved:true,score:r.score};
     if(![b.score,b.food,b.gold].every(Number.isSafeInteger)||b.score<0||b.score%10||b.food<0||b.food>100000||b.gold<0||b.gold>Math.floor(b.food/5))throw error(400,'Некорректный результат.');
     const max=(b.food*10+b.gold*50)*(r.board.startsWith('classic')?1:5);
     if(b.score>max||(b.food+b.gold)*60>clock()-r.started+250)throw error(400,'Результат не соответствует партии.');
     r.score=b.score;
     if(!p.best[r.board]||b.score>p.best[r.board].score)p.best[r.board]={score:b.score,achieved:clock()};
     return {saved:true,score:b.score};
    }));
   }
   throw error(404,'Не найдено.');
  }catch(e){if(!e.status)console.error(e);return response({error:e.status?e.message:'Рейтинг временно недоступен. Повтори позже.'},e.status||503);}
 };
}
