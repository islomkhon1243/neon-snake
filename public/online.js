(function(){
  'use strict';
  const $=id=>document.getElementById(id);
  let session,active=null,pending=null,loading=false;
  function say(text){$('onlineStatus').textContent=text;}
  async function api(path,data){
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),10000);
    try{
      const r=await fetch('/api/'+path,{method:data===undefined?'GET':'POST',credentials:'same-origin',headers:data===undefined?{}:{'Content-Type':'application/json'},body:data===undefined?undefined:JSON.stringify(data),signal:controller.signal});
      const b=await r.json();if(!r.ok)throw Error(b.error||'Ошибка сервера');return b;
    }catch(e){throw Error(e.name==='AbortError'?'Сервер не отвечает. Повтори позже.':e.message);}
    finally{clearTimeout(timer);}
  }
  async function refresh(){
    if(loading)return;loading=true;
    const board=$('rankBoard').value;
    try{
      await session;const b=await api('leaderboard?board='+encodeURIComponent(board));
      if(board!==$('rankBoard').value)return;
      $('rankRows').replaceChildren();
      b.rows.forEach(r=>{
        const tr=document.createElement('tr');if(r.me)tr.className='my-rank';
        [r.rank,r.name+(r.me?' · ты':''),r.score].forEach(v=>{const td=document.createElement('td');td.textContent=v;tr.appendChild(td);});$('rankRows').appendChild(tr);
      });
      $('rankSummary').textContent=b.total?('Игроков: '+b.total+(b.me?' · Твоё место: '+b.me.rank+' · Рекорд: '+b.me.score:' · Сыграй партию, чтобы попасть в рейтинг')):'Пока нет результатов. Будь первым!';
    }catch(e){$('rankSummary').textContent='Рейтинг недоступен: '+e.message;}
    finally{loading=false;if(board!==$('rankBoard').value)refresh();}
  }
  function connect(){
    session=api('session',{}).then(p=>{$('playerName').value=p.name;say('Онлайн · результаты завершённых партий публикуются под твоим ником.');return p;});
    session.catch(e=>say('Офлайн: '+e.message+' Игра доступна без рейтинга.'));
    return session;
  }
  async function submit(){
    if(!pending)return;
    const result=pending;
    $('retryScore').disabled=true;
    try{
      const run=await result.run;
      await api('scores',{run:run.id,score:result.score,food:result.food,gold:result.gold});
      if(pending===result){pending=null;$('retryScore').hidden=true;}
      say('Результат сохранён в общем рейтинге.');refresh();
    }catch(e){say('Результат не отправлен: '+e.message);$('retryScore').hidden=false;}
    finally{$('retryScore').disabled=false;}
  }
  window.addEventListener('snake:start',e=>{
    active=null;
    if(e.detail.mode==='zen'){say('Zen — спокойная игра вне рейтинга.');return;}
    const board=e.detail.mode+'-'+(e.detail.walls?'walls':'wrap');
    $('rankBoard').value=board;refresh();
    const started=Date.now();
    const run=session.then(()=>api('runs',{board}));
    run.catch(e=>say('Эта партия без рейтинга: '+e.message));
    active={run,started};
  });
  window.addEventListener('snake:end',e=>{
    const match=active;active=null;if(!match||e.detail.mode==='zen')return;
    // Capture this party, so a quick restart cannot submit the next run's data.
    pending={...e.detail,run:match.run};submit();
  });
  $('saveName').onclick=async()=>{
    $('saveName').disabled=true;
    try{await session;await api('profile',{name:$('playerName').value});say('Ник сохранён.');refresh();}catch(e){say(e.message);}finally{$('saveName').disabled=false;}
  };
  $('retryScore').onclick=submit;
  $('rankRefresh').onclick=()=>{connect().then(refresh).catch(()=>{});};
  $('rankBoard').onchange=refresh;
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)refresh();});
  setInterval(()=>{if(!document.hidden)refresh();},30000);
  connect();refresh();
})();
