import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {request} from 'node:http';
import {guardBillOps, editBillOps, deleteBillOps, apply, rollover} from '../public/model.js';
async function launch(dir,env={}){const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:dir,APP_PASSWORD:'test-only-password',...env},stdio:['ignore','pipe','pipe']});const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),5000);child.stdout.on('data',b=>{const m=b.toString().match(/http:\/\/[^\s]+/);if(m){clearTimeout(timer);resolve(m[0])}});child.once('exit',code=>reject(Error(`exit ${code}`)))});return {child,url}}
async function stop(child){await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM')})}
test('API: autenticação, sessão, persistência, SSE, idempotência e validação',async()=>{const dir=await mkdtemp(join(tmpdir(),'notas-test-'));let proc;try{
 proc=await launch(dir);let url=proc.url;assert.equal((await fetch(url+'/api/state')).status,401);
 const health=await fetch(url+'/healthz');assert.equal(health.status,200);assert.equal(health.headers.get('cache-control'),'no-store');assert.deepEqual(await health.json(),{ok:true,revision:process.env.APP_REVISION||'dev'});
 assert.equal((await fetch(url+'/api/login',{method:'POST',body:JSON.stringify({password:'wrong'})})).status,401);
 async function login(){const r=await fetch(url+'/api/login',{method:'POST',body:JSON.stringify({password:'test-only-password'})});assert.equal(r.status,200);return r.headers.get('set-cookie').split(';')[0]}
 let cookie=await login();const headers=()=>({'Content-Type':'application/json',cookie});
 const controller=new AbortController();const stream=await fetch(url+'/api/events',{headers:headers(),signal:controller.signal});const reader=stream.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/connected/);
 const op={opId:'unique',collection:'tasks',id:'task',patch:{text:'Teste',done:false,section:'s0',date:'2026-10-16'}};
 const post=o=>fetch(url+'/api/operations',{method:'POST',headers:headers(),body:JSON.stringify(o)});
 assert.equal((await post(op)).status,200);assert.match(new TextDecoder().decode((await reader.read()).value),/changed/);controller.abort();
 assert.equal((await post({...op,patch:{text:'Não deve sobrescrever'}})).status,200);
 assert.equal((await post({...op,opId:'invalid',id:'__proto__'})).status,400);
 assert.equal((await post({...op,opId:'invalid2',collection:'constructor'})).status,400);
 // A refused change says so (`invalid`), so the app drops it instead of retrying it forever; a malformed request does not.
 const refused=await post({...op,opId:'invalid3',id:'constructor'});assert.equal(refused.status,400);assert.deepEqual(await refused.json(),{error:'Alteração inválida',invalid:true});
 const malformed=await fetch(url+'/api/operations',{method:'POST',headers:headers(),body:'{nao é json'});assert.equal(malformed.status,400);assert.equal((await malformed.json()).invalid,undefined);
 assert.equal((await post({opId:'rep',collection:'repeats',id:'r1',patch:{text:'Daily',section:'s1',time:'09:30',days:'12345',monthDay:0}})).status,200);
 assert.equal((await post({opId:'rep-meeting',collection:'repeats',id:'r3',patch:{text:'Daily',section:'s1',time:'11:00',days:'12345',monthDay:0,meeting:true}})).status,200);
 assert.equal((await post({opId:'pref-ok',collection:'prefs',id:'tabs',patch:{reunioes:true,contas:false}})).status,200);
 assert.equal((await post({opId:'pref-bad',collection:'prefs',id:'tabs',patch:{reunioes:'sim'}})).status,400);
 assert.equal((await post({opId:'pref-unknown',collection:'prefs',id:'tabs',patch:{outra:true}})).status,400);
 assert.equal((await post({opId:'bad-time',collection:'repeats',id:'r2',patch:{time:'25:00'}})).status,400);
 assert.equal((await post({opId:'rep-end',collection:'repeats',id:'r3',patch:{end:'12:15'}})).status,200);
 assert.equal((await post({opId:'bad-end',collection:'tasks',id:'t-end',patch:{end:'9h'}})).status,400);
 assert.equal((await post({opId:'bad-date',collection:'tasks',id:'t-date',patch:{date:'2026-02-30'}})).status,400);
 assert.equal((await post({opId:'free-date',collection:'tasks',id:'t-date',patch:{date:'amanhã'}})).status,400);
 assert.equal((await post({opId:'future-date',collection:'tasks',id:'t-date',patch:{text:'Kickoff',date:'2026-11-05'}})).status,200);
 assert.equal((await post({opId:'bad-weeks',collection:'repeats',id:'r2',patch:{weeks:0}})).status,400);
 assert.equal((await post({opId:'bad-start',collection:'repeats',id:'r2',patch:{start:'2026-02-30'}})).status,400);
 assert.equal((await post({opId:'bad-days',collection:'repeats',id:'r2',patch:{days:'789'}})).status,400);
 assert.equal((await post({opId:'bill-every',collection:'bills',id:'b2',patch:{every:2}})).status,200);
 assert.equal((await post({opId:'bill-every-0',collection:'bills',id:'b2',patch:{every:0}})).status,400);
 assert.equal((await post({opId:'bill-every-25',collection:'bills',id:'b2',patch:{every:25}})).status,400);
 assert.equal((await post({opId:'bill-every-frac',collection:'bills',id:'b2',patch:{every:1.5}})).status,400);
 assert.equal((await post({opId:'bill-rule',collection:'billRules',id:'recurring',patch:{text:'Internet',amount:11990,due:25,month:'2026-10',every:2,repeat:true}})).status,200);
 assert.equal((await post({opId:'bill-rule-invalid',collection:'billRules',id:'recurring',patch:{month:'2026-13'}})).status,400);
 assert.equal((await post({opId:'bill-rule-invalid-every',collection:'billRules',id:'recurring',patch:{every:25}})).status,400);
 assert.equal((await post({opId:'bill-skip',collection:'bills',id:'b2',patch:{skipped:true}})).status,200);
 assert.equal((await post({opId:'bill-unskip',collection:'bills',id:'b2',patch:{skipped:false}})).status,200);
 assert.equal((await post({opId:'bill-occurrence',collection:'bills',id:'therapy',patch:{text:'Terapia',amount:80000,month:'2026-10',repeat:true,calcMode:'occurrence',unitAmount:20000,weekdays:'4',starts:'2026-10-01',excluded:'2026-10-29'}})).status,200);
 for(const [field,value] of [['calcMode','other'],['unitAmount',1.5],['unitAmount',100000001],['weekdays','44'],['weekdays','7'],['starts','2026-02-30'],['excluded','ontem'],['lag',2],['lag','1']])assert.equal((await post({opId:'bad-calc-'+field+'-'+value,collection:'bills',id:'therapy',patch:{[field]:value}})).status,400);
 assert.equal((await post({opId:'bad-due',collection:'bills',id:'b1',patch:{due:32}})).status,400);
 assert.equal((await(await fetch(url+'/api/session',{headers:headers()})).json()).protected,true);
 assert.equal((await fetch(url+'/api/operations',{method:'POST',headers:{...headers(),origin:'https://evil.example'},body:JSON.stringify(op)})).status,403);
 let state=await(await fetch(url+'/api/state',{headers:headers()})).json();assert.equal(state.tasks.task.text,'Teste');
 const backup=await(await fetch(url+'/api/export',{headers:headers()})).json();assert.equal(backup.operations.length,11);assert.equal(state.prefs.tabs.reunioes,true);assert.equal(state.repeats.r3.meeting,true);assert.equal(state.repeats.r3.end,'12:15');
 const out=await fetch(url+'/api/logout',{method:'POST',headers:headers()});assert.match(out.headers.get('set-cookie'),/Max-Age=0/);
 assert.match(cookie,/^session=/);const maxAge=(await fetch(url+'/api/login',{method:'POST',body:JSON.stringify({password:'test-only-password'})})).headers.get('set-cookie');assert.match(maxAge,/Max-Age=31536000/);
 // Passkeys: público só o necessário para entrar; cadastro exige sessão.
 assert.equal((await(await fetch(url+'/api/login-methods')).json()).passkey,false);
 const loginOptions=await(await fetch(url+'/api/passkey/login-options',{method:'POST'})).json();assert.ok(loginOptions.challenge.length>20);
 assert.equal((await fetch(url+'/api/passkey/login',{method:'POST',body:JSON.stringify({id:'desconhecida',response:{}})})).status,401);
 assert.equal((await fetch(url+'/api/passkey/register-options',{method:'POST'})).status,401);
 const reg=await(await fetch(url+'/api/passkey/register-options',{method:'POST',headers:headers()})).json();assert.equal(reg.rp.id,'localhost');assert.equal(reg.authenticatorSelection.residentKey,'required');
 assert.equal((await fetch(url+'/api/passkey/register',{method:'POST',headers:headers(),body:JSON.stringify({id:'x',rawId:'x',type:'public-key',response:{clientDataJSON:'e30',attestationObject:'oA'},clientExtensionResults:{}})})).status,400);
 assert.deepEqual(await(await fetch(url+'/api/passkeys',{headers:headers()})).json(),[]);
 // A sessão continua válida depois de reiniciar: a chave de assinatura fica no banco.
 await stop(proc.child);proc=await launch(dir);url=proc.url;state=await(await fetch(url+'/api/state',{headers:headers()})).json();assert.equal(state.tasks.task.text,'Teste');assert.equal(state.billRules.recurring.every,2);assert.equal(state.bills.b2.skipped,false);assert.equal(state.bills.therapy.excluded,'2026-10-29');assert.equal(state.bills.therapy.unitAmount,20000);
 }finally{if(proc?.child.exitCode===null)await stop(proc.child);await rm(dir,{recursive:true,force:true})}});
test('limite de login por cliente atrás do proxy',async()=>{const dir=await mkdtemp(join(tmpdir(),'notas-test-'));const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:dir,APP_PASSWORD:'test-only-password',TRUST_PROXY:'1'},stdio:['ignore','pipe','pipe']});try{
 const url=await new Promise((resolve,reject)=>{child.stdout.on('data',b=>{const m=b.toString().match(/http:\/\/[^\s]+/);if(m)resolve(m[0])});child.once('exit',code=>reject(Error(`exit ${code}`)))});
 const attempt=xff=>fetch(url+'/api/login',{method:'POST',headers:{'x-forwarded-for':xff},body:JSON.stringify({password:'wrong'})}).then(r=>r.status);
 for(let i=0;i<10;i++)assert.equal(await attempt('203.0.113.9, 198.51.100.1'),401);
 assert.equal(await attempt('203.0.113.7, 198.51.100.1'),429,'só o último salto conta; o cliente não escolhe o próprio IP');
 assert.equal(await attempt('198.51.100.2'),401,'outro cliente não fica bloqueado');
}finally{await stop(child);await rm(dir,{recursive:true,force:true})}});

test('API rejeita atomicamente edição offline após encerramento remoto e aceita retry idempotente', async () => {
 const dir = await mkdtemp(join(tmpdir(), 'notas-bill-conflict-'));
 const proc = await launch(dir);
 try {
  const login = await fetch(proc.url + '/api/login', {method: 'POST', body: JSON.stringify({password: 'test-only-password'})});
  const cookie = login.headers.get('set-cookie').split(';')[0];
  const headers = {cookie, 'Content-Type': 'application/json'};
  const getState = () => fetch(proc.url + '/api/state', {headers}).then(r => r.json());
  const post = ops => fetch(proc.url + '/api/operations', {method: 'POST', headers, body: JSON.stringify(ops)});
  const identified = (ops, prefix) => ops.map((op, i) => ({...op, opId: `${prefix}-${i}`}));
  const base = {text: 'Internet', amount: 11990, due: 25, repeat: true, every: 1, done: false};
  assert.equal((await post([
   {opId: 'seed-oct', collection: 'bills', id: 'internet', patch: {...base, month: '2026-10'}},
   {opId: 'seed-nov', collection: 'bills', id: 'internet-2026-11', patch: {...base, month: '2026-11'}},
  ])).status, 200);
  const offlineA = await getState(), deviceB = await getState();
  const offlineBatch = identified(guardBillOps(offlineA, editBillOps(offlineA, offlineA.bills.internet, {...base, amount: 14990}, 'future')), 'offline');
  for (const op of offlineBatch) apply(offlineA, op);
  const offlineRollover = identified(guardBillOps(offlineA, rollover(offlineA, '2026-12-01')), 'offline-rollover');
  const stopBatch = identified(guardBillOps(deviceB, deleteBillOps(deviceB, deviceB.bills['internet-2026-11'], 'future')), 'stop');
  assert.equal((await post(stopBatch)).status, 200);
  assert.equal((await post(stopBatch)).status, 200, 'retry ignora precondições dos opIds já aplicados');
  assert.equal((await post(offlineBatch)).status, 409);
  assert.equal((await post(offlineRollover)).status, 409, 'virada derivada da edição offline também precisa rejeitar o conflito');
  let state = await getState();
  assert.equal(state.billRules.internet.repeat, false);
  assert.equal(state.bills['internet-2026-11'].skipped, true);
  assert.equal(state.bills.internet.amount, 11990, 'nenhuma parte do gesto conflitante foi aplicada');
  assert.equal(state.bills['internet-2026-12'], undefined);
  assert.equal(state.months['2026-12'], undefined);
  const freshEdit = identified(guardBillOps(state, editBillOps(state, state.bills.internet, {...base, amount: 12990, repeat: false})), 'fresh');
  assert.equal((await post(freshEdit)).status, 200);
  assert.equal((await getState()).bills.internet.amount, 12990);
  // A conflict in one occurrence rejects unrelated operations in the same gesture too.
  state = await getState();
  const stalePayment = identified(guardBillOps(state, [{collection: 'bills', id: 'internet', patch: {done: true}}]), 'payment');
  assert.equal((await post({opId: 'remote-payment', collection: 'bills', id: 'internet', patch: {amount: 13990}})).status, 200);
  assert.equal((await post([...stalePayment, {opId: 'atomic-task', collection: 'tasks', id: 'atomic', patch: {text: 'Not applied'}}])).status, 409);
  state = await getState();
  assert.equal(state.bills.internet.done, false);
  assert.equal(state.tasks.atomic, undefined);
  assert.equal((await post([{opId: 'mixed-space', collection: 'shopping', id: 'i-test', patch: {text: 'Test'}}, {opId: 'mixed-private', collection: 'tasks', id: 'private', patch: {text: 'Test'}}])).status, 400);
 } finally {
  await stop(proc.child);
  await rm(dir, {recursive: true, force: true});
 }
});

test('API: o mesmo hostname em outra porta pode salvar só quando a página vem de lá',async()=>{const dir=await mkdtemp(join(tmpdir(),'notas-test-'));let proc;try{
 proc=await launch(dir,{PUBLIC_ORIGIN:'https://notas.example:8443'});const url=proc.url;
 const cookie=(await fetch(url+'/api/login',{method:'POST',body:JSON.stringify({password:'test-only-password'})})).headers.get('set-cookie').split(';')[0];
 const op=JSON.stringify({opId:'legacy',collection:'tasks',id:'t',patch:{text:'Velho endereço'}});
 const post=(host,origin)=>new Promise((resolve,reject)=>{const r=request(url+'/api/operations',{method:'POST',headers:{host,origin,cookie,'Content-Type':'application/json'}},res=>{res.resume();resolve(res.statusCode)});r.on('error',reject);r.end(op)});
 assert.equal(await post('notas.example:4329','https://notas.example:4329'),200);
 assert.equal(await post('notas.example:8443','https://notas.example:8443'),200);
 assert.equal(await post('notas.example:8443','https://notas.example:4329'),403);
 assert.equal(await post('evil.example:4329','https://evil.example:4329'),403);
}finally{if(proc)await stop(proc.child);await rm(dir,{recursive:true,force:true})}});
