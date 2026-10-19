import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync,readFileSync,existsSync} from 'node:fs';
import {resolve,dirname,extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes,createHmac,timingSafeEqual} from 'node:crypto';
import {initialState,apply,rollover} from './public/model.js';
const root=dirname(fileURLToPath(import.meta.url));
const host=process.env.HOST||'127.0.0.1', port=Number(process.env.PORT||4329);
const password=process.env.APP_PASSWORD;
if (!password && !['127.0.0.1','localhost','::1'].includes(host)) throw Error('APP_PASSWORD é obrigatória fora do localhost.');
const data=resolve(process.env.DATA_DIR||resolve(root,'data')); mkdirSync(data,{recursive:true});
const db=new DatabaseSync(resolve(data,'notas.sqlite'));
db.exec('PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, value TEXT); CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, value TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);');
let state=JSON.parse(db.prepare('SELECT value FROM state WHERE id=1').get()?.value||JSON.stringify(initialState()));
const persist=()=>db.prepare('INSERT OR REPLACE INTO state VALUES (1,?)').run(JSON.stringify(state)); persist();
const clients=new Set(), secret=randomBytes(32);
const sign=v=>createHmac('sha256',secret).update(v).digest('hex');
const equal=(a,b)=>{const x=Buffer.from(a),y=Buffer.from(b);return x.length===y.length&&timingSafeEqual(x,y)};
function authorized(req){if(!password)return true;const token=req.headers.cookie?.match(/(?:^|; )session=([^;]+)/)?.[1]||'';const [exp,sig]=token.split('.');return Number(exp)>Date.now()&&equal(sig||'',sign(exp||''));}
const notify=()=>{for(const res of clients)res.write(`data: changed\n\n`)};
function today(){return new Intl.DateTimeFormat('en-CA',{timeZone:process.env.TZ||'America/Sao_Paulo',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());}
function ensureDay(){const ops=rollover(state,today());if(ops.length){for(const op of ops)apply(state,op);persist();notify()}}
ensureDay(); const timer=setInterval(ensureDay,30000);timer.unref();
const schema={sections:{name:'string',deleted:'boolean'},tasks:{text:'string',section:'string',date:'string',done:'boolean',meeting:'boolean',deleted:'boolean'},bills:{text:'string',amount:'number',group:'string',month:'string',done:'boolean',deleted:'boolean'},meetings:{text:'string',time:'string',weekday:'number',section:'string',deleted:'boolean'},days:{date:'string'},months:{month:'string'}};
function validate(op){if(!op||typeof op.opId!=='string'||op.opId.length>100||!Object.hasOwn(schema,op.collection)||typeof op.id!=='string'||op.id.length>200||['__proto__','constructor','prototype'].includes(op.id)||!op.patch||Array.isArray(op.patch))return false;return Object.entries(op.patch).every(([k,v])=>Object.hasOwn(schema[op.collection],k)&&typeof v===schema[op.collection][k]&&(typeof v!=='string'||v.length<=10000)&&(typeof v!=='number'||Number.isFinite(v)&&v>=0)&&(k!=='weekday'||v<=6&&Number.isInteger(v)));}
async function body(req){let raw='';for await(const c of req){raw+=c;if(raw.length>65536)throw Error('Payload muito grande')}return JSON.parse(raw||'{}')}
const attempts=new Map();
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('Content-Security-Policy',"default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  const url=new URL(req.url,'http://localhost');
  const json=(code,value)=>{res.writeHead(code,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(value))};
  try{
    if(req.method==='POST' && req.headers.origin && req.headers.origin!==`${process.env.PUBLIC_ORIGIN||`http://${req.headers.host}`}`)return json(403,{error:'Origem inválida'});
    if(url.pathname==='/api/login'&&req.method==='POST'){
      const ip=req.socket.remoteAddress;let a=attempts.get(ip);if(!a||Date.now()>a.until){a={count:0,until:Date.now()+60000};attempts.set(ip,a)}
      if(++a.count>10)return json(429,{error:'Aguarde um minuto e tente novamente.'});
      const input=await body(req);if(password&&!equal(String(input.password||''),password))return json(401,{error:'Senha incorreta'});
      const exp=String(Date.now()+30*86400000);res.setHeader('Set-Cookie',`session=${exp}.${sign(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=2592000${process.env.PUBLIC_ORIGIN?.startsWith('https:')?'; Secure':''}`);return json(200,{ok:true});
    }
    if(url.pathname.startsWith('/api/')){
      if(!authorized(req))return json(401,{error:'Entre para sincronizar'});
      ensureDay();
      if(url.pathname==='/api/state'&&req.method==='GET')return json(200,state);
      if(url.pathname==='/api/export'&&req.method==='GET'){res.setHeader('Content-Disposition','attachment; filename="notas-backup.json"');return json(200,{version:1,state,operations:db.prepare('SELECT * FROM operations ORDER BY created').all()})}
      if(url.pathname==='/api/events'&&req.method==='GET'){
        res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive','X-Accel-Buffering':'no'});res.write('data: connected\n\n');clients.add(res);
        const ping=setInterval(()=>res.write(': heartbeat\n\n'),20000);req.on('close',()=>{clearInterval(ping);clients.delete(res)});return;
      }
      if(url.pathname==='/api/operations'&&req.method==='POST'){
        const op=await body(req);if(!validate(op))return json(400,{error:'Alteração inválida'});
        if(!db.prepare('SELECT id FROM operations WHERE id=?').get(op.opId)){
          const next=structuredClone(state);apply(next,op);db.exec('BEGIN');try{db.prepare('INSERT INTO operations(id,value) VALUES (?,?)').run(op.opId,JSON.stringify(op));db.prepare('INSERT OR REPLACE INTO state VALUES(1,?)').run(JSON.stringify(next));db.exec('COMMIT');state=next}catch(e){db.exec('ROLLBACK');throw e}notify();
        }return json(200,{ok:true});
      }return json(404,{error:'Não encontrado'});
    }
    if(!['GET','HEAD'].includes(req.method))return json(405,{error:'Método inválido'});
    const path=resolve(root,'public',`.${decodeURIComponent(url.pathname==='/'?'/index.html':url.pathname)}`);
    if(!path.startsWith(resolve(root,'public')+'/')||!existsSync(path))return json(404,{error:'Não encontrado'});
    const types={'.html':'text/html; charset=utf-8','.js':'text/javascript','.css':'text/css','.json':'application/json','.webmanifest':'application/manifest+json','.svg':'image/svg+xml','.png':'image/png'};
    res.writeHead(200,{'Content-Type':types[extname(path)]||'application/octet-stream','Cache-Control':'no-cache'});res.end(req.method==='HEAD'?undefined:readFileSync(path));
  }catch(e){console.error(e.message);if(!res.headersSent)json(400,{error:'Não foi possível processar a solicitação'});else res.end()}
});
server.listen(port,host,()=>console.log(`Notas em http://${host}:${server.address().port}`));
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{for(const c of clients)c.end();server.close(()=>{db.close();process.exit(0)})});
