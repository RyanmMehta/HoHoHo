import {validPlaceIds} from '../places-data.js';
const encoder=new TextEncoder();
const json=(data,status=200,headers={})=>Response.json(data,{status,headers:{'Cache-Control':'no-store',...headers}});
const hex=bytes=>Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');
const unhex=s=>Uint8Array.from(s.match(/.{2}/g)||[],x=>parseInt(x,16));
export const hash=async text=>hex(await crypto.subtle.digest('SHA-256',encoder.encode(text)));
const token=()=>hex(crypto.getRandomValues(new Uint8Array(32)));
function cookies(request){return Object.fromEntries((request.headers.get('Cookie')||'').split(';').map(s=>s.trim().split('=')))}
function cookie(request,name,value,age){return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${age}${new URL(request.url).protocol==='https:'?'; Secure':''}`}
export function validateResponse(data){
 if(!data||typeof data.name!=='string'||!Array.isArray(data.dates))return null;
 const name=data.name.trim().replace(/\s+/g,' ');
 if(!name||name.length>80||/[\x00-\x1f\x7f]/.test(name)||data.dates.length<1||data.dates.length>40)return null;
 const dates=[...new Set(data.dates)];
 for(const date of dates){if(typeof date!=='string'||!/^2026-(11|12)-\d{2}$/.test(date))return null;const d=new Date(date+'T12:00:00Z');if(Number.isNaN(d.getTime())||d.toISOString().slice(0,10)!==date||![0,4,5,6].includes(d.getUTCDay()))return null}
 return {name,dates:dates.sort()};
}
export function validatePreferences(data){
 if(!data||typeof data.name!=='string'||!Array.isArray(data.choices)||data.choices.length>40)return null;
 const name=data.name.trim().replace(/\s+/g,' ');
 if(!name||name.length>80||/[\x00-\x1f\x7f]/.test(name)||data.choices.some(id=>!validPlaceIds.has(id)))return null;
 return {name,choices:[...new Set(data.choices)].sort()};
}
async function body(request){
 if(!request.headers.get('Content-Type')?.startsWith('application/json'))throw new Error('bad-body');
 const reader=request.body?.getReader();if(!reader)throw new Error('bad-body');let size=0;const chunks=[];
 while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();throw new Error('bad-body')}chunks.push(value)}
 const joined=new Uint8Array(size);let offset=0;for(const part of chunks){joined.set(part,offset);offset+=part.length}try{return JSON.parse(new TextDecoder().decode(joined))}catch{throw new Error('bad-body')}
}
async function throttle(env,key,max,seconds){
 const now=Math.floor(Date.now()/1000);
 const row=await env.DB.prepare(`INSERT INTO attempts(key,count,expires_at) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN expires_at<=? THEN 1 ELSE count+1 END, expires_at=CASE WHEN expires_at<=? THEN excluded.expires_at ELSE expires_at END RETURNING count`).bind(key,now+seconds,now,now).first();
 return row.count<=max;
}
async function passwordMatches(password,encoded){
 const [salt,expected]=encoded.split(':');if(!/^[a-f0-9]{32}$/.test(salt)||!/^[a-f0-9]{64}$/.test(expected))return false;
 const key=await crypto.subtle.importKey('raw',encoder.encode(password),'PBKDF2',false,['deriveBits']);
 const actual=await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations:100000,hash:'SHA-256'},key,256);
 return crypto.subtle.timingSafeEqual(actual,unhex(expected));
}
async function session(request,env){const raw=cookies(request).hoho_admin;if(!raw||!/^[a-f0-9]{64}$/.test(raw))return false;return Boolean(await env.DB.prepare('SELECT token_hash FROM sessions WHERE token_hash=? AND expires_at>?').bind(await hash(raw),Math.floor(Date.now()/1000)).first())}
async function api(request,env){
 const url=new URL(request.url),path=url.pathname;
 if(!env.DB)return json({error:'Storage is not configured yet.'},503);
 if(request.method==='POST'&&request.headers.get('Origin')!==url.origin)return json({error:'Request origin not allowed.'},403);
 if(path==='/api/guest'&&request.method==='POST'){
  const data=validatePreferences({...await body(request),choices:[]});if(!data)return json({error:'Please enter a valid name.'},400);
  const ip=await hash(request.headers.get('CF-Connecting-IP')||'local');if(!await throttle(env,'guest:'+ip,60,3600))return json({error:'Too many updates. Please try again later.'},429);
  let raw=cookies(request).hoho_guest;if(!raw||!/^[a-f0-9]{64}$/.test(raw))raw=token();const key=await hash(raw),now=Date.now();
  await env.DB.batch([
   env.DB.prepare('INSERT INTO guests(edit_hash,name,updated_at) VALUES(?,?,?) ON CONFLICT(edit_hash) DO UPDATE SET name=excluded.name,updated_at=excluded.updated_at').bind(key,data.name,now),
   env.DB.prepare('UPDATE responses SET name=?,updated_at=MAX(updated_at+1,?) WHERE edit_hash=?').bind(data.name,now,key),
   env.DB.prepare('UPDATE preferences SET name=?,updated_at=MAX(updated_at+1,?) WHERE edit_hash=?').bind(data.name,now,key)
  ]);
  return json({ok:true,name:data.name},200,{'Set-Cookie':cookie(request,'hoho_guest',raw,60*60*24*120)});
 }
 if(path==='/api/admin/guests'&&request.method==='GET'){
  if(!await session(request,env))return json({error:'Sign in to view guests.'},401);
  const rows=await env.DB.prepare('SELECT name,updated_at FROM guests ORDER BY updated_at DESC').all();return json({guests:rows.results});
 }
 if(path==='/api/preferences'&&request.method==='GET'){
  const raw=cookies(request).hoho_guest;
  if(!raw||!/^[a-f0-9]{64}$/.test(raw))return json({preference:null});
  const row=await env.DB.prepare('SELECT name,choices,updated_at FROM preferences WHERE edit_hash=?').bind(await hash(raw)).first();
  return json({preference:row?{...row,choices:JSON.parse(row.choices)}:null});
 }
 if(path==='/api/preferences'&&request.method==='POST'){
  const data=validatePreferences(await body(request));if(!data)return json({error:'Enter your name and choose valid activities.'},400);
  const ip=await hash(request.headers.get('CF-Connecting-IP')||'local');if(!await throttle(env,'preferences:'+ip,60,3600))return json({error:'Too many updates. Please try again later.'},429);
  let raw=cookies(request).hoho_guest;if(!raw||!/^[a-f0-9]{64}$/.test(raw))raw=token();const now=Date.now();const profile=await env.DB.prepare('SELECT name FROM guests WHERE edit_hash=?').bind(await hash(raw)).first();if(profile)data.name=profile.name;
  await env.DB.prepare('INSERT INTO preferences(id,edit_hash,name,choices,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(edit_hash) DO UPDATE SET name=excluded.name,choices=excluded.choices,updated_at=MAX(preferences.updated_at+1,excluded.updated_at)').bind(crypto.randomUUID(),await hash(raw),data.name,JSON.stringify(data.choices),now).run();
  return json({ok:true},200,{'Set-Cookie':cookie(request,'hoho_guest',raw,60*60*24*120)});
 }
 if(path==='/api/admin/preferences'&&request.method==='GET'){
  if(!await session(request,env))return json({error:'Sign in to view preferences.'},401);
  const rows=await env.DB.prepare('SELECT id,name,choices,updated_at FROM preferences ORDER BY updated_at DESC').all();
  return json({preferences:rows.results.map(row=>({...row,choices:JSON.parse(row.choices)}))});
 }
 if(path==='/api/hangouts'&&request.method==='GET'){
  const rows=await env.DB.prepare('SELECT id,title,date,location FROM hangouts ORDER BY date').all();return json({hangouts:rows.results});
 }
 if(path==='/api/admin/hangouts'&&request.method==='POST'){
  if(!await session(request,env))return json({error:'Sign in to publish a hangout.'},401);
  const data=await body(request);
  if(typeof data.title!=='string'||!data.title.trim()||data.title.length>100||typeof data.location!=='string'||data.location.length>200||!validateResponse({name:'Hangout',dates:[data.date]}))return json({error:'Enter a title, location and a Thursday–Sunday date in November or December 2026.'},400);
  await env.DB.prepare('INSERT INTO hangouts(id,title,date,location,created_at) VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),data.title.trim(),data.date,data.location.trim(),Date.now()).run();return json({ok:true});
 }
 if(path==='/api/responses'&&request.method==='POST'){
  const data=validateResponse(await body(request));if(!data)return json({error:'Enter a name and valid Thursday–Sunday dates in November or December 2026.'},400);
  const ip=await hash(request.headers.get('CF-Connecting-IP')||'local');if(!await throttle(env,'submit:'+ip,60,3600))return json({error:'Too many submissions. Try again later.'},429);
  let raw=cookies(request).hoho_guest;if(!raw||!/^[a-f0-9]{64}$/.test(raw))raw=token();
  const editHash=await hash(raw),now=Date.now();const profile=await env.DB.prepare('SELECT name FROM guests WHERE edit_hash=?').bind(editHash).first();if(profile)data.name=profile.name;
  const saved=await env.DB.prepare(`INSERT INTO responses(id,edit_hash,name,dates,created_at,updated_at) VALUES(?,?,?,?,?,?) ON CONFLICT(edit_hash) DO UPDATE SET name=excluded.name,dates=excluded.dates,updated_at=MAX(responses.updated_at+1,excluded.updated_at) WHERE responses.deleted_at IS NULL`).bind(crypto.randomUUID(),editHash,data.name,JSON.stringify(data.dates),now,now).run();
  if(!saved.meta.changes)return json({error:'This response has been removed by the host. Please contact Ryan.'},409);
  return json({ok:true},200,{'Set-Cookie':cookie(request,'hoho_guest',raw,60*60*24*120)});
 }
 if(path==='/api/admin/login'&&request.method==='POST'){
  if(!env.ADMIN_PASSWORD_HASH)return json({error:'Admin login is not configured yet.'},503);
  const data=await body(request);if(typeof data.username!=='string'||typeof data.password!=='string'||data.password.length>128)return json({error:'Incorrect name or password.'},401);
  const ip=await hash(request.headers.get('CF-Connecting-IP')||'local');
  if(!await throttle(env,'login-ip:'+ip,5,3600)||!await throttle(env,'login-global',15,3600))return json({error:'Login limit reached. Please wait one hour before trying again.'},429,{'Retry-After':'3600'});
  const correct=await passwordMatches(data.password,env.ADMIN_PASSWORD_HASH);
  if(data.username.trim().toLowerCase()!==(env.ADMIN_NAME||'Ryan Mehta').toLowerCase()||!correct)return json({error:'Incorrect name or password.'},401);
  const raw=token(),now=Math.floor(Date.now()/1000);
  await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE expires_at<=?').bind(now),env.DB.prepare('DELETE FROM attempts WHERE expires_at<=?').bind(now),env.DB.prepare('INSERT INTO sessions(token_hash,expires_at) VALUES(?,?)').bind(await hash(raw),now+28800)]);
  return json({ok:true},200,{'Set-Cookie':cookie(request,'hoho_admin',raw,28800)});
 }
 if(path==='/api/admin/logout'&&request.method==='POST'){
  const raw=cookies(request).hoho_admin;if(raw)await env.DB.prepare('DELETE FROM sessions WHERE token_hash=?').bind(await hash(raw)).run();
  return json({ok:true},200,{'Set-Cookie':cookie(request,'hoho_admin','',0)});
 }
 const action=path.match(/^\/api\/admin\/responses\/([a-f0-9-]{36})\/(edit|trash|restore)$/);
 if(action&&request.method==='POST'){
  if(!await session(request,env))return json({error:'Sign in to manage responses.'},401);
  const data=await body(request);if(!Number.isSafeInteger(data?.updated_at))return json({error:'Refresh the response before editing.'},400);
  const [,id,operation]=action,now=Date.now();let statement;
  if(operation==='edit'){const valid=validateResponse(data);if(!valid)return json({error:'Enter a name and at least one valid Thursday–Sunday date.'},400);statement=env.DB.prepare('UPDATE responses SET name=?,dates=?,updated_at=MAX(updated_at+1,?) WHERE id=? AND updated_at=? AND deleted_at IS NULL').bind(valid.name,JSON.stringify(valid.dates),now,id,data.updated_at)}
  else if(operation==='trash')statement=env.DB.prepare('UPDATE responses SET deleted_at=?,updated_at=MAX(updated_at+1,?) WHERE id=? AND updated_at=? AND deleted_at IS NULL').bind(now,now,id,data.updated_at);
  else statement=env.DB.prepare('UPDATE responses SET deleted_at=NULL,updated_at=MAX(updated_at+1,?) WHERE id=? AND updated_at=? AND deleted_at IS NOT NULL').bind(now,id,data.updated_at);
  const result=await statement.run();if(!result.meta.changes)return json({error:'This response has changed or is no longer available. Refresh and try again.'},409);
  return json({ok:true});
 }
 if(path==='/api/admin/responses'&&request.method==='GET'){
  if(!await session(request,env))return json({error:'Sign in to view responses.'},401);
  const result=await env.DB.prepare('SELECT id,name,dates,created_at,updated_at,deleted_at FROM responses ORDER BY updated_at DESC').all();
  return json({responses:result.results.map(row=>({...row,dates:JSON.parse(row.dates)}))});
 }
 return json({error:'Not found.'},404);
}
export default {async fetch(request,env){
 let response;const path=new URL(request.url).pathname;
 try{
  if(path.startsWith('/api/'))response=await api(request,env);
  else response=await env.ASSETS.fetch(request);
 }catch(error){if(error.message==='bad-body')response=json({error:'Invalid request.'},400);else {console.error(JSON.stringify({event:'request_failed',path}));response=json({error:'Could not complete the request. Please try again.'},500)}}
 const secured=new Response(response.body,response);secured.headers.set('X-Content-Type-Options','nosniff');secured.headers.set('Referrer-Policy','same-origin');secured.headers.set('X-Frame-Options','DENY');
 secured.headers.set('Content-Security-Policy',"default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
 if(path.startsWith('/admin'))secured.headers.set('Cache-Control','no-store');return secured;
}};
