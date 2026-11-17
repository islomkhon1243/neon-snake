import {getStore} from '@netlify/blobs';
import {createCloudAPI} from '../../lib/cloud-api.mjs';

export default async function handler(request){
 try{
  const store=getStore({name:'neon-snake-global-v1',consistency:'strong'});
  return await createCloudAPI(store)(request);
 }catch(e){
  console.error('Leaderboard storage unavailable',e.message);
  return Response.json({error:'Общее хранилище недоступно. Проверь деплой Netlify Functions.'},{status:503,headers:{'Cache-Control':'no-store'}});
 }
}
export const config={path:'/api/*'};
