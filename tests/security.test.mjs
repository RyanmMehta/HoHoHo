import {test,before,after} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {pbkdf2Sync,randomBytes} from 'node:crypto';
import {Miniflare,convertV4MiniflareOptions} from 'miniflare';
import {validateResponse} from '../server/worker.js';
let mf,db;
const password='test-password-only';const salt=randomBytes(16);const digest=pbkdf2Sync(password,salt,100000,32,'sha256').toString('hex');
before(async()=>{mf=new Miniflare(convertV4MiniflareOptions({workers:[{name:"hohoho-test",modulesRoot:new URL('../',import.meta.url).pathname,modules:[{type:'ESModule',path:new URL('../server/worker.js',import.meta.url).pathname},{type:'ESModule',path:new URL('../places-data.js',import.meta.url).pathname}],scriptPath:new URL('../server/worker.js',import.meta.url).pathname,compatibilityDate:'2026-10-29',d1Databases:['DB'],bindings:{ADMIN_NAME:'Ryan Mehta',ADMIN_PASSWORD_HASH:salt.toString('hex')+':'+digest}}]}));db=await mf.getD1Database('DB');for(const file of ['0001_initial.sql','0002_response_trash.sql','0003_hangouts.sql','0004_preferences.sql','0005_guests.sql','0006_suggestions.sql'])await db.exec(readFileSync(new URL('../migrations/'+file,import.meta.url),'utf8').replace(/\n/g,' '))});
after(()=>mf?.dispose());
const request=(path,data,cookie='',origin='https://example.com',ip='test')=>mf.dispatchFetch('https://example.com'+path,{method:data?'POST':'GET',headers:{'Content-Type':'application/json',Origin:origin,Cookie:cookie,'CF-Connecting-IP':ip},body:data?JSON.stringify(data):undefined});
const cookieOf=r=>r.headers.get('set-cookie').split(';')[0];
test('dates reject weekdays, malformed and out-of-season values',()=>{assert.equal(validateResponse({name:'Guest',dates:['2026-11-02']}),null);assert.equal(validateResponse({name:'Guest',dates:['2026-11-31']}),null);assert.equal(validateResponse({name:'Guest',dates:['2027-12-03']}),null);assert.equal(validateResponse({name:'  ',dates:['2026-11-05']}),null);assert.deepEqual(validateResponse({name:' Guest ',dates:['2026-12-03','2026-11-05','2026-11-05']}),{name:'Guest',dates:['2026-11-05','2026-12-03']})});
test('private data requires a valid session, not a name or forged cookie',async()=>{assert.equal((await request('/api/admin/responses')).status,401);assert.equal((await request('/api/admin/responses',null,'hoho_admin='+'a'.repeat(64))).status,401)});
test('submission isolation and same-browser update',async()=>{const a=await request('/api/responses',{name:'Test guest A',dates:['2026-11-05']});assert.equal(a.status,200);assert.match(a.headers.get('set-cookie'),/HttpOnly/);assert.match(a.headers.get('set-cookie'),/Secure/);const guestCookie=cookieOf(a);assert.equal((await request('/api/admin/responses',null,guestCookie)).status,401);await request('/api/responses',{name:'Test guest A',dates:['2026-12-03']},guestCookie);await request('/api/responses',{name:'Test guest A',dates:['2026-11-06']});const rows=await db.prepare('SELECT name,dates FROM responses').all();assert.equal(rows.results.length,2);assert.ok(rows.results.some(r=>r.dates==='["2026-12-03"]'))});
test('cross-origin mutations fail before any write',async()=>{assert.equal((await request('/api/responses',{name:'Test',dates:['2026-11-05']},'','https://evil.example')).status,403)});
test('valid admin can read; incorrect password fails; logout revokes cookie',async()=>{assert.equal((await request('/api/admin/login',{username:'Ryan Mehta',password:'wrong'})).status,401);const login=await request('/api/admin/login',{username:'Ryan Mehta',password});assert.equal(login.status,200);const cookie=cookieOf(login);const view=await request('/api/admin/responses',null,cookie);assert.equal(view.status,200);assert.equal(view.headers.get('cache-control'),'no-store');assert.equal((await view.json()).responses.length,2);await request('/api/admin/logout',{},cookie);assert.equal((await request('/api/admin/responses',null,cookie)).status,401)});
test('repeated login attempts are blocked',async()=>{for(let i=0;i<5;i++)assert.equal((await request('/api/admin/login',{username:'Ryan Mehta',password:'wrong'},'','https://example.com','rate-test')).status,401);assert.equal((await request('/api/admin/login',{username:'Ryan Mehta',password},'','https://example.com','rate-test')).status,429)});
test('overlarge request bodies are rejected',async()=>{assert.equal((await request('/api/responses',{name:'x'.repeat(5000),dates:['2026-11-05']})).status,400)});

test('host edits, optimistic concurrency, recoverable trash and guest isolation',async()=>{
 const guest=await request('/api/responses',{name:'Management test',dates:['2026-11-05']});const guestCookie=cookieOf(guest);
 const login=await request('/api/admin/login',{username:'Ryan Mehta',password},'','https://example.com','management');const cookie=cookieOf(login);
 const getRow=async()=> (await (await request('/api/admin/responses',null,cookie)).json()).responses.find(r=>r.name.startsWith('Management'));
 let row=await getRow();const path=`/api/admin/responses/${row.id}`;
 assert.equal((await request(path+'/edit',{name:'Intruder',dates:row.dates,updated_at:row.updated_at})).status,401);
 assert.equal((await request(path+'/edit',{name:'Management edited',dates:['2026-11-02'],updated_at:row.updated_at},cookie)).status,400);
 const edit={name:'Management edited',dates:['2026-12-03'],updated_at:row.updated_at};
 assert.equal((await request(path+'/edit',edit,cookie,'https://evil.example')).status,403);
 assert.equal((await request(path+'/edit',edit,cookie)).status,200);
 assert.equal((await request(path+'/edit',edit,cookie)).status,409);
 row=await getRow();assert.deepEqual(row.dates,['2026-12-03']);
 assert.equal((await request(path+'/trash',{updated_at:row.updated_at},cookie)).status,200);
 row=await getRow();assert.ok(row.deleted_at);
 assert.equal((await request('/api/responses',{name:'Management resurrected',dates:['2026-11-05']},guestCookie)).status,409);
 assert.equal((await request(path+'/restore',{updated_at:row.updated_at},cookie)).status,200);
 row=await getRow();assert.equal(row.deleted_at,null);assert.equal(row.name,'Management edited');
});

test('only host can publish valid hangouts; public listing contains event details only',async()=>{
 const event={title:'Movie night',date:'2026-12-31',location:'TBC'};
 assert.equal((await request('/api/admin/hangouts',event)).status,401);
 const login=await request('/api/admin/login',{username:'Ryan Mehta',password},'','https://example.com','hangouts');const cookie=cookieOf(login);
 assert.equal((await request('/api/admin/hangouts',{...event,date:'2026-11-02'},cookie)).status,400);
 assert.equal((await request('/api/admin/hangouts',event,cookie)).status,200);
 const result=await (await request('/api/hangouts')).json();assert.equal(result.hangouts[0].title,event.title);assert.equal(result.hangouts[0].date,event.date);
});

test('activity preferences persist privately, replace votes, and allow clearing',async()=>{
 const payload={name:'Preference guest',choices:['angelina','white-elephant','angelina']};
 assert.equal((await request('/api/preferences',{...payload,choices:['invented']})).status,400);
 assert.equal((await request('/api/preferences',payload,'','https://evil.example')).status,403);
 const saved=await request('/api/preferences',payload);assert.equal(saved.status,200);const own=cookieOf(saved);
 assert.deepEqual((await (await request('/api/preferences',null,own)).json()).preference.choices,['angelina','white-elephant']);
 assert.equal((await (await request('/api/preferences')).json()).preference,null);
 assert.equal((await request('/api/admin/preferences',null,own)).status,401);
 const second=await request('/api/preferences',payload);const secondCookie=cookieOf(second);
 await request('/api/preferences',{...payload,choices:['stuytown-rink']},own);
 assert.deepEqual((await (await request('/api/preferences',null,secondCookie)).json()).preference.choices,['angelina','white-elephant']);
 const login=await request('/api/admin/login',{username:'Ryan Mehta',password},'','https://example.com','prefs-admin');const admin=cookieOf(login);
 const list=await (await request('/api/admin/preferences',null,admin)).json();assert.equal(list.preferences.length,2);assert.ok(list.preferences.every(r=>!('edit_hash' in r)));
 await request('/api/preferences',{...payload,choices:[]},own);
 assert.deepEqual((await (await request('/api/preferences',null,own)).json()).preference.choices,[]);
});

test('shared guest identity is required by UI and remains consistent across both submissions',async()=>{
 assert.equal((await request('/api/guest',{name:'   '})).status,400);
 assert.equal((await request('/api/guest',{name:'Guest'},'','https://evil.example')).status,403);
 assert.equal((await request('/api/admin/guests')).status,401);
 const registered=await request('/api/guest',{name:' Shared Guest '});assert.equal(registered.status,200);const cookie=cookieOf(registered);
 await request('/api/responses',{name:'Stale name',dates:['2026-11-05']},cookie);
 await request('/api/preferences',{name:'Other stale name',choices:['angelina']},cookie);
 assert.equal((await (await request('/api/preferences',null,cookie)).json()).preference.name,'Shared Guest');
 await request('/api/guest',{name:'Corrected Guest'},cookie);
 const updated=await db.prepare("SELECT name FROM responses WHERE name='Corrected Guest'").first();assert.ok(updated);
 assert.equal((await (await request('/api/preferences',null,cookie)).json()).preference.name,'Corrected Guest');
});

test('suggestions require a registered guest and stay private, editable and clearable',async()=>{
 assert.equal((await request('/api/suggestion',{text:'Idea'})).status,401);
 assert.equal((await request('/api/admin/suggestions')).status,401);
 const guest=await request('/api/guest',{name:'Suggestion guest'});const cookie=cookieOf(guest);
 assert.equal((await request('/api/suggestion',{text:'x'.repeat(801)},cookie)).status,400);
 assert.equal((await request('/api/suggestion',{text:'Cookie swap'},cookie,'https://evil.example')).status,403);
 assert.equal((await request('/api/suggestion',{text:'Cookie swap'},cookie)).status,200);
 assert.equal((await (await request('/api/suggestion',null,cookie)).json()).suggestion.text,'Cookie swap');
 const other=cookieOf(await request('/api/guest',{name:'Other guest'}));assert.equal((await (await request('/api/suggestion',null,other)).json()).suggestion,null);
 await request('/api/suggestion',{text:'Pottery night'},cookie);
 assert.equal((await (await request('/api/suggestion',null,cookie)).json()).suggestion.text,'Pottery night');
 await request('/api/suggestion',{text:''},cookie);
 assert.equal((await (await request('/api/suggestion',null,cookie)).json()).suggestion.text,'');
});
