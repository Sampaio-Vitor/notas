import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync, existsSync} from 'node:fs';
import {resolve, dirname, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes, createHmac, timingSafeEqual} from 'node:crypto';
import {generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse} from '@simplewebauthn/server';
import {initialState, apply, rollover, migrate, normalize} from './public/model.js';

const root = dirname(fileURLToPath(import.meta.url));
const host = process.env.HOST || '127.0.0.1', port = Number(process.env.PORT || 4329);

// ---------- People ----------
// APP_USERS="ana:Ana:senha,bia:Bia:senha". The login screen asks who is
// signing in, so passwords may repeat. APP_PASSWORD alone still works as a
// single user. Without either, one local user and no login.
const COLORS = ['#64d2ff', '#ff6482', '#30d158', '#bf5af2'];
function parseUsers() {
  if (process.env.APP_USERS) {
    return process.env.APP_USERS.split(',').map(entry => {
      const [id, name, ...rest] = entry.trim().split(':');
      if (!/^[a-z0-9-]+$/.test(id || '') || !name || !rest.join(':')) throw Error(`APP_USERS inválido em "${entry}". Use id:Nome:senha.`);
      return {id, name, password: rest.join(':')};
    });
  }
  return [{id: 'eu', name: 'Eu', password: process.env.APP_PASSWORD || ''}];
}
const users = parseUsers().map((u, i) => ({...u, color: COLORS[i % COLORS.length]}));
const protectedServer = users.every(u => u.password);
if (!protectedServer && !['127.0.0.1', 'localhost', '::1'].includes(host)) throw Error('Defina APP_USERS ou APP_PASSWORD fora do localhost.');
const owner = users[0];
const userById = id => users.find(u => u.id === id);
const publicUser = u => ({id: u.id, name: u.name, color: u.color});

// ---------- Storage ----------
const data = resolve(process.env.DATA_DIR || resolve(root, 'data'));
mkdirSync(data, {recursive: true});
const db = new DatabaseSync(resolve(data, 'notas.sqlite'));
db.exec(`PRAGMA journal_mode=WAL;
  CREATE TABLE IF NOT EXISTS state (id INTEGER PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS spaces (id TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS operations (id TEXT PRIMARY KEY, value TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, public_key TEXT NOT NULL, counter INTEGER NOT NULL, transports TEXT, name TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP, last_used TEXT);`);
if (!db.prepare('PRAGMA table_info(passkeys)').all().some(c => c.name === 'user_id')) db.exec('ALTER TABLE passkeys ADD COLUMN user_id TEXT');
// Passkeys created before accounts existed belong to the first person.
db.prepare('UPDATE passkeys SET user_id=? WHERE user_id IS NULL').run(owner.id);

// One state per person plus the shared "casa" space (only `shopping` is used there).
const SHARED = 'casa';
const spaces = new Map();
const persist = id => db.prepare('INSERT OR REPLACE INTO spaces VALUES (?,?)').run(id, JSON.stringify(spaces.get(id)));
function loadSpace(id, fallback) {
  const row = db.prepare('SELECT value FROM spaces WHERE id=?').get(id);
  const state = normalize(row ? JSON.parse(row.value) : fallback());
  for (const op of migrate(state)) apply(state, op);
  spaces.set(id, state);
  persist(id);
}
// Before accounts there was a single state row; it becomes the first person's space.
const legacy = db.prepare('SELECT value FROM state WHERE id=1').get()?.value;
for (const u of users) loadSpace(u.id, () => u === owner && legacy ? JSON.parse(legacy) : initialState());
loadSpace(SHARED, () => normalize({}));

// ---------- Sessions ----------
// The signing key lives in the database so restarts and deploys keep sessions valid.
if (!db.prepare("SELECT value FROM meta WHERE key='session-secret'").get()) db.prepare("INSERT INTO meta VALUES ('session-secret',?)").run(randomBytes(32).toString('hex'));
const secret = Buffer.from(db.prepare("SELECT value FROM meta WHERE key='session-secret'").get().value, 'hex');
const SESSION_DAYS = 365;
const sign = v => createHmac('sha256', secret).update(v).digest('hex');
const equal = (a, b) => { const x = Buffer.from(a), y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

// Cookie: "<user>.<expiry>.<signature>". Cookies from before accounts ("<expiry>.<signature>") belong to the first person.
function sessionUser(req) {
  if (!protectedServer) return owner;
  const token = req.headers.cookie?.match(/(?:^|; )session=([^;]+)/)?.[1] || '';
  const parts = token.split('.');
  const [id, exp, sig] = parts.length === 2 ? [null, ...parts] : parts;
  const payload = id ? `${id}.${exp}` : exp;
  if (!(Number(exp) > Date.now()) || !equal(sig || '', sign(payload || ''))) return null;
  return id ? userById(id) || null : owner;
}

// ---------- Passkeys ----------
// Bound to the public hostname (rpID); the port does not matter.
const origin = process.env.PUBLIC_ORIGIN || `http://localhost:${port}`, rpID = new URL(origin).hostname;
const challenges = new Map();
function takeChallenge(c) {
  const exp = challenges.get(c);
  challenges.delete(c);
  for (const [k, v] of challenges) if (v < Date.now()) challenges.delete(k);
  return exp > Date.now();
}
const keepChallenge = c => challenges.set(c, Date.now() + 5 * 60000);
const deviceName = (ua = '') => /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Macintosh/.test(ua) ? 'Mac' : /Android/.test(ua) ? 'Android' : /Windows/.test(ua) ? 'Windows' : 'Navegador';

// ---------- Live updates ----------
const clients = new Set();
// A change in someone's space reaches only their devices; the shared space reaches everyone.
function notify(space) {
  for (const c of clients) if (space === SHARED || c.user === space) c.res.write('data: changed\n\n');
}

function today() { return new Intl.DateTimeFormat('en-CA', {timeZone: process.env.TZ || 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date()); }
function ensureDay() {
  for (const u of users) {
    const state = spaces.get(u.id), ops = rollover(state, today());
    if (!ops.length) continue;
    for (const op of ops) apply(state, op);
    persist(u.id); notify(u.id);
  }
}
ensureDay();
setInterval(ensureDay, 30000).unref();

// What a person sees: their own space with the shared shopping list in it.
const viewFor = user => ({...spaces.get(user.id), shopping: spaces.get(SHARED).shopping});

// ---------- Validation ----------
const schema = {
  sections: {name: 'string', order: 'number', deleted: 'boolean'},
  tasks: {text: 'string', section: 'string', date: 'string', time: 'string', done: 'boolean', repeat: 'string', from: 'string', meeting: 'boolean', deleted: 'boolean'},
  repeats: {text: 'string', section: 'string', time: 'string', days: 'string', monthDay: 'number', deleted: 'boolean'},
  bills: {text: 'string', amount: 'number', due: 'number', repeat: 'boolean', group: 'string', month: 'string', done: 'boolean', deleted: 'boolean'},
  meetings: {text: 'string', time: 'string', weekday: 'number', section: 'string', deleted: 'boolean'},
  days: {date: 'string', reviewed: 'boolean'},
  months: {month: 'string'},
  shopping: {text: 'string', done: 'boolean', listed: 'boolean', added: 'number', by: 'string'},
};
// Field formats beyond the type check; time is optional (empty string).
const formats = {
  time: v => v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v), days: v => /^[0-6]{0,7}$/.test(v),
  monthDay: v => Number.isInteger(v) && v <= 31, due: v => Number.isInteger(v) && v <= 31,
  order: v => Number.isInteger(v), weekday: v => Number.isInteger(v) && v <= 6,
};
function validate(op) {
  if (!op || typeof op.opId !== 'string' || op.opId.length > 100 || !Object.hasOwn(schema, op.collection)) return false;
  if (typeof op.id !== 'string' || op.id.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(op.id)) return false;
  if (!op.patch || typeof op.patch !== 'object' || Array.isArray(op.patch)) return false;
  return Object.entries(op.patch).every(([k, v]) => Object.hasOwn(schema[op.collection], k) && typeof v === schema[op.collection][k]
    && (typeof v !== 'string' || v.length <= 10000) && (typeof v !== 'number' || (Number.isFinite(v) && v >= 0)) && (!formats[k] || formats[k](v)));
}

async function body(req) {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 65536) throw Error('Payload muito grande'); }
  return JSON.parse(raw || '{}');
}
const attempts = new Map();
function limited(req) {
  const ip = req.socket.remoteAddress;
  let a = attempts.get(ip);
  if (!a || Date.now() > a.until) { a = {count: 0, until: Date.now() + 60000}; attempts.set(ip, a); }
  return ++a.count > 10;
}

// ---------- HTTP ----------
const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy', "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self' data:; connect-src 'self'; frame-ancestors 'none'");
  const url = new URL(req.url, 'http://localhost');
  const json = (code, value) => { res.writeHead(code, {'Content-Type': 'application/json', 'Cache-Control': 'no-store'}); res.end(JSON.stringify(value)); };
  const route = (method, path) => req.method === method && url.pathname === path;
  const startSession = user => {
    const exp = String(Date.now() + SESSION_DAYS * 86400000);
    res.setHeader('Set-Cookie', `session=${user.id}.${exp}.${sign(`${user.id}.${exp}`)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_DAYS * 86400}${origin.startsWith('https:') ? '; Secure' : ''}`);
    return json(200, {ok: true});
  };
  try {
    if (route('GET', '/healthz')) {
      try {
        db.prepare('SELECT 1 FROM spaces LIMIT 1').get();
        return json(200, {ok: true, revision: process.env.APP_REVISION || 'dev'});
      } catch {
        return json(503, {ok: false});
      }
    }
    if (req.method === 'POST' && req.headers.origin && req.headers.origin !== (process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`)) return json(403, {error: 'Origem inválida'});

    // Public: everything needed to sign in.
    if (route('POST', '/api/login')) {
      if (limited(req)) return json(429, {error: 'Aguarde um minuto e tente novamente.'});
      const input = await body(req), password = String(input.password || '');
      // With one person, the user field is optional.
      const who = users.length === 1 ? owner : userById(String(input.user || ''));
      if (!who) return json(400, {error: 'Escolha quem está entrando.'});
      return !protectedServer || equal(password, who.password) ? startSession(who) : json(401, {error: 'Senha incorreta'});
    }
    // Errors from the browser land in the server log, to diagnose devices we cannot inspect.
    if (route('POST', '/api/client-log')) {
      if (!limited(req)) console.error('cliente:', String((await body(req)).message || '').slice(0, 2000).replace(/\s+/g, ' '), '|', String(req.headers['user-agent'] || '').slice(0, 160));
      return json(200, {ok: true});
    }
    if (route('GET', '/api/login-methods')) return json(200, {passkey: protectedServer && db.prepare('SELECT COUNT(*) AS n FROM passkeys').get().n > 0, users: users.map(publicUser)});
    if (route('POST', '/api/passkey/login-options')) {
      const options = await generateAuthenticationOptions({rpID, userVerification: 'preferred'});
      keepChallenge(options.challenge);
      return json(200, options);
    }
    if (route('POST', '/api/passkey/login')) {
      if (limited(req)) return json(429, {error: 'Aguarde um minuto e tente novamente.'});
      const response = await body(req);
      const row = typeof response.id === 'string' && db.prepare('SELECT * FROM passkeys WHERE id=?').get(response.id);
      const user = row && userById(row.user_id);
      if (!user) return json(401, {error: 'Passkey não reconhecida. Entre com a senha.'});
      const result = await verifyAuthenticationResponse({
        response, expectedChallenge: takeChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false,
        credential: {id: row.id, publicKey: Buffer.from(row.public_key, 'base64url'), counter: row.counter, transports: JSON.parse(row.transports || '[]')},
      }).catch(() => ({verified: false}));
      if (!result.verified) return json(401, {error: 'Não foi possível confirmar a passkey. Entre com a senha.'});
      db.prepare('UPDATE passkeys SET counter=?, last_used=CURRENT_TIMESTAMP WHERE id=?').run(result.authenticationInfo.newCounter, row.id);
      return startSession(user);
    }

    if (url.pathname.startsWith('/api/')) {
      const user = sessionUser(req);
      if (!user) return json(401, {error: 'Entre para sincronizar'});
      ensureDay();
      if (route('GET', '/api/state')) return json(200, viewFor(user));
      if (route('GET', '/api/session')) return json(200, {protected: protectedServer, me: publicUser(user), users: users.map(publicUser)});
      if (route('GET', '/api/passkeys')) return json(200, db.prepare('SELECT id,name,created,last_used FROM passkeys WHERE user_id=? ORDER BY created').all(user.id));
      if (route('POST', '/api/passkey/register-options')) {
        const existing = db.prepare('SELECT id,transports FROM passkeys WHERE user_id=?').all(user.id);
        const options = await generateRegistrationOptions({
          rpName: 'Notas', rpID, userName: user.name, userDisplayName: user.name, userID: new TextEncoder().encode(user.id), attestationType: 'none',
          excludeCredentials: existing.map(r => ({id: r.id, transports: JSON.parse(r.transports || '[]')})),
          authenticatorSelection: {residentKey: 'required', userVerification: 'preferred'},
        });
        keepChallenge(options.challenge);
        return json(200, options);
      }
      if (route('POST', '/api/passkey/register')) {
        const response = await body(req);
        const result = await verifyRegistrationResponse({response, expectedChallenge: takeChallenge, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: false}).catch(() => ({verified: false}));
        if (!result.verified) return json(400, {error: 'Não foi possível criar a passkey.'});
        const {credential} = result.registrationInfo;
        db.prepare('INSERT OR REPLACE INTO passkeys(id,public_key,counter,transports,name,user_id) VALUES (?,?,?,?,?,?)')
          .run(credential.id, Buffer.from(credential.publicKey).toString('base64url'), credential.counter, JSON.stringify(credential.transports || []), deviceName(req.headers['user-agent']), user.id);
        return json(200, {ok: true});
      }
      if (route('POST', '/api/passkey/delete')) {
        db.prepare('DELETE FROM passkeys WHERE id=? AND user_id=?').run(String((await body(req)).id || ''), user.id);
        return json(200, {ok: true});
      }
      if (route('POST', '/api/logout')) {
        res.setHeader('Set-Cookie', 'session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0');
        return json(200, {ok: true});
      }
      if (route('GET', '/api/export')) {
        res.setHeader('Content-Disposition', 'attachment; filename="notas-backup.json"');
        const operations = db.prepare('SELECT * FROM operations ORDER BY created').all().filter(o => { const v = JSON.parse(o.value); return (v.user || owner.id) === user.id || v.space === SHARED; });
        return json(200, {version: 2, user: user.id, state: viewFor(user), operations});
      }
      if (route('GET', '/api/events')) {
        res.writeHead(200, {'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no'});
        res.write('data: connected\n\n');
        const client = {res, user: user.id};
        clients.add(client);
        const ping = setInterval(() => res.write(': heartbeat\n\n'), 20000);
        req.on('close', () => { clearInterval(ping); clients.delete(client); });
        return;
      }
      if (route('POST', '/api/operations')) {
        const op = await body(req);
        if (!validate(op)) return json(400, {error: 'Alteração inválida'});
        const space = op.collection === 'shopping' ? SHARED : user.id;
        // Who added an item is decided here, not by the client.
        if (op.collection === 'shopping') { delete op.patch.by; if (op.patch.listed === true) op.patch.by = user.id; }
        if (!db.prepare('SELECT id FROM operations WHERE id=?').get(op.opId)) {
          const next = structuredClone(spaces.get(space));
          apply(next, op);
          db.exec('BEGIN');
          try {
            db.prepare('INSERT INTO operations(id,value) VALUES (?,?)').run(op.opId, JSON.stringify({...op, user: user.id, space}));
            db.prepare('INSERT OR REPLACE INTO spaces VALUES (?,?)').run(space, JSON.stringify(next));
            db.exec('COMMIT');
            spaces.set(space, next);
          } catch (e) { db.exec('ROLLBACK'); throw e; }
          notify(space);
        }
        return json(200, {ok: true});
      }
      return json(404, {error: 'Não encontrado'});
    }

    if (!['GET', 'HEAD'].includes(req.method)) return json(405, {error: 'Método inválido'});
    const path = resolve(root, 'public', `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`);
    if (!path.startsWith(resolve(root, 'public') + '/') || !existsSync(path)) return json(404, {error: 'Não encontrado'});
    const types = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.svg': 'image/svg+xml', '.png': 'image/png'};
    res.writeHead(200, {'Content-Type': types[extname(path)] || 'application/octet-stream', 'Cache-Control': 'no-cache'});
    res.end(req.method === 'HEAD' ? undefined : readFileSync(path));
  } catch (e) {
    console.error(e.message);
    if (!res.headersSent) json(400, {error: 'Não foi possível processar a solicitação'}); else res.end();
  }
});
server.listen(port, host, () => console.log(`Notas em http://${host}:${server.address().port}`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => { for (const c of clients) c.res.end(); server.close(() => { db.close(); process.exit(0); }); });
