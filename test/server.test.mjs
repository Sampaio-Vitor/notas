import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
async function launch(dir){const child=spawn(process.execPath,['server.mjs'],{env:{...process.env,PORT:'0',DATA_DIR:dir,APP_PASSWORD:'test-only-password'},stdio:['ignore','pipe','pipe']});const url=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('startup timeout')),5000);child.stdout.on('data',b=>{const m=b.toString().match(/http:\/\/[^\s]+/);if(m){clearTimeout(timer);resolve(m[0])}});child.once('exit',code=>reject(Error(`exit ${code}`)))});return {child,url}}
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
 assert.equal((await post({opId:'rep',collection:'repeats',id:'r1',patch:{text:'Daily',section:'s1',time:'09:30',days:'12345',monthDay:0}})).status,200);
 assert.equal((await post({opId:'bad-time',collection:'repeats',id:'r2',patch:{time:'25:00'}})).status,400);
 assert.equal((await post({opId:'bad-days',collection:'repeats',id:'r2',patch:{days:'789'}})).status,400);
 assert.equal((await post({opId:'bad-due',collection:'bills',id:'b1',patch:{due:32}})).status,400);
 assert.equal((await(await fetch(url+'/api/session',{headers:headers()})).json()).protected,true);
 assert.equal((await fetch(url+'/api/operations',{method:'POST',headers:{...headers(),origin:'https://evil.example'},body:JSON.stringify(op)})).status,403);
 let state=await(await fetch(url+'/api/state',{headers:headers()})).json();assert.equal(state.tasks.task.text,'Teste');
 const backup=await(await fetch(url+'/api/export',{headers:headers()})).json();assert.equal(backup.operations.length,2);
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
 await stop(proc.child);proc=await launch(dir);url=proc.url;state=await(await fetch(url+'/api/state',{headers:headers()})).json();assert.equal(state.tasks.task.text,'Teste');
 }finally{if(proc?.child.exitCode===null)await stop(proc.child);await rm(dir,{recursive:true,force:true})}});
