const fs=require('fs'),vm=require('vm'),assert=require('assert');
const html=fs.readFileSync(require('path').join(__dirname,'../dist/index.html'),'utf8');
let js=html.match(/<script>([\s\S]*?)<\/script>/)[1];
const elements={};
function el(id){return elements[id]||(elements[id]={textContent:'',innerHTML:'',value:'',disabled:false,children:[],classList:{toggle(){},add(){}},addEventListener(){},replaceChildren(){this.children=[]},appendChild(x){this.children.push(x)},getBoundingClientRect(){return {width:480,height:480}},getContext(){return {setTransform(){}}}})}
const storage={};
const events=[];
const sandbox={CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},console,Math,JSON,Number,parseInt,performance:{now:()=>1},setTimeout:()=>{},requestAnimationFrame:()=>{},navigator:{maxTouchPoints:0},localStorage:{getItem:k=>storage[k]??null,setItem:(k,v)=>storage[k]=v},document:{getElementById:el,querySelectorAll:()=>[],createElement:()=>el('created'+Math.random()),addEventListener(){},body:el('body')},window:{dispatchEvent(e){events.push(e)},addEventListener(){},devicePixelRatio:1}};
js=js.replace('})();',`globalThis.test={G,start,step,pause,useSkill,upgrades,collect,menu,status,turn,reset,loadBest,toggleMode,die,setMode:v=>{mode=v},setWalls:v=>{walls=v},getBest:()=>best,getMode:()=>mode};})();`);
vm.runInNewContext(js,sandbox);
const t=sandbox.test,g=t.G;
function setup(mode='adventure'){t.setMode(mode);t.setWalls(true);t.start();}
function foodAhead(){g.food={x:g.snake[0].x+g.dir.x,y:g.snake[0].y+g.dir.y};}
setup();foodAhead();t.step();assert.equal(g.score,10);foodAhead();t.step();assert.equal(g.score,30);assert.equal(g.combo,2);
setup('classic');foodAhead();t.step();foodAhead();t.step();assert.equal(g.score,20);
setup();t.useSkill();assert.equal(g.active,4000);assert.equal(g.cooldown,18000);t.pause(true);t.useSkill();assert.equal(g.active,4000);
setup();g.skill='shed';g.snake=Array.from({length:10},(_,i)=>({x:12-i,y:12}));g.score=100;t.useSkill();assert.equal(g.snake.length,5);assert.equal(g.score,70);
setup();g.snake=[{x:5,y:5},{x:5,y:6},{x:6,y:6},{x:6,y:5},{x:7,y:5}];g.food={x:20,y:20};t.step();assert.equal(g.state,'dead');
setup();g.skill='ghost';t.useSkill();g.snake=[{x:5,y:5},{x:5,y:6},{x:6,y:6},{x:6,y:5},{x:7,y:5}];g.food={x:20,y:20};t.step();assert.equal(g.state,'playing');
setup('zen');g.snake=[{x:5,y:5},{x:5,y:6},{x:6,y:6},{x:6,y:5},{x:7,y:5}];g.food={x:20,y:20};t.step();assert.equal(g.state,'playing');assert.equal(new Set(g.snake.map(p=>p.x+','+p.y)).size,g.snake.length);
setup('zen');g.snake=[{x:23,y:5},{x:22,y:5},{x:21,y:5}];t.step();assert.equal(g.snake[0].x,0);
setup();g.eaten=14;foodAhead();t.step();assert.equal(g.state,'upgrade');assert.equal(el('choices').children.length,3);const n=g.snake.length;t.turn('down');assert.equal(g.queue.length,0);el('choices').children[0].onclick();assert.equal(g.state,'paused');
setup();t.toggleMode();g.score=123;t.die(false);assert.equal(storage['neonSnake.v2.best.adventure.walls'],123);t.setWalls(false);t.loadBest();assert.equal(t.getBest(),0);
t.menu();assert.equal(el('modeSelect').disabled,false);
console.log('PASS: combo, classic scoring, skill cooldown, pause, tail shedding, collisions, ghost, Zen wrap/recovery, upgrade selection, separate records, menu.');

assert(events.some(e=>e.type==='snake:start'));assert(events.some(e=>e.type==='snake:end'));
