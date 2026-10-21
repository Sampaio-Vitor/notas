import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync, existsSync} from 'node:fs';
import {resolve, dirname, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes, randomUUID, createHmac, timingSafeEqual} from 'node:crypto';
import {generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse} from '@simplewebauthn/server';
import {initialState, apply, rollover, migrate, normalize, itemKey, itemId, listed, billOpsConflict} from './public/model.js';

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

// Applies operations to one space in a single transaction and logs them with `who`
// (the person, plus the agent when it came through MCP). Repeated opIds are skipped.
function commit(ops, space, who) {
  const fresh = ops.filter(op => !db.prepare('SELECT id FROM operations WHERE id=?').get(op.opId));
  if (!fresh.length) return;
  const next = structuredClone(spaces.get(space));
  for (const op of fresh) apply(next, op);
  db.exec('BEGIN');
  try {
    for (const op of fresh) db.prepare('INSERT INTO operations(id,value) VALUES (?,?)').run(op.opId, JSON.stringify({...op, ...who, space}));
    db.prepare('INSERT OR REPLACE INTO spaces VALUES (?,?)').run(space, JSON.stringify(next));
    db.exec('COMMIT');
    spaces.set(space, next);
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  notify(space);
}

// ---------- MCP ----------
// Agents (a shopping assistant) reach only the shopping list, never anyone's personal space.
// MCP_TOKENS="lia:<token>,..."; each token is sent as "Authorization: Bearer <token>".
const agents = (process.env.MCP_TOKENS || '').split(',').filter(e => e.trim()).map(entry => {
  const [id, ...rest] = entry.trim().split(':'), token = rest.join(':');
  if (!/^[a-z0-9-]+$/.test(id || '') || token.length < 24) throw Error(`MCP_TOKENS inválido em "${id}". Use id:token, com token de 24 caracteres ou mais.`);
  return {id, token};
});
const agentFor = req => {
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  return token ? agents.find(a => equal(token, a.token)) : undefined;
};
const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const itemsArg = {type: 'array', items: {type: 'string', minLength: 1, maxLength: 200}, minItems: 1, maxItems: 50};
const porArg = {type: 'string', description: 'Id de quem pediu; o item fica com a cor dessa pessoa. Sem ele, fica no nome do agente.'};
const MCP_TOOLS = [
  {name: 'compras_listar', title: 'Ver a lista de compras',
    description: 'A lista de compras da casa: o que falta comprar e o que já está no carrinho, com quem adicionou cada item.',
    inputSchema: {type: 'object', properties: {}}, annotations: {readOnlyHint: true}},
  {name: 'compras_adicionar', title: 'Adicionar à lista de compras',
    description: 'Põe itens na lista de compras da casa. Um item por entrada, só o nome ("leite", "pão de forma"). Item que já está na lista não duplica.',
    inputSchema: {type: 'object', properties: {itens: itemsArg, por: porArg}, required: ['itens']}, annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true}},
  {name: 'compras_remover', title: 'Tirar da lista de compras',
    description: 'Tira itens da lista de compras da casa pelo nome. Se algum não for encontrado, a resposta traz a lista atual para tentar com o nome que está nela.',
    inputSchema: {type: 'object', properties: {itens: itemsArg}, required: ['itens']}, annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true}},
  {name: 'compras_sugerir', title: 'Sugerir itens já comprados',
    description: 'Itens que já estiveram na lista e começam com o texto (acento e maiúscula não importam), os mais recentes primeiro. Para completar o que alguém está digitando.',
    inputSchema: {type: 'object', properties: {texto: {type: 'string', minLength: 1, maxLength: 200}}, required: ['texto']}, annotations: {readOnlyHint: true}},
];
const MCP_INSTRUCTIONS = 'Lista de compras compartilhada da casa, a mesma do app Notas. Acentos e maiúsculas não importam nos nomes.';

const shoppingList = () => listed(spaces.get(SHARED)).sort((a, b) => (a.added || 0) - (b.added || 0))
  .map(i => ({nome: i.text, por: userById(i.by)?.name || i.by || '', carrinho: !!i.done}));
function itemsFrom(args) {
  const items = args.itens;
  if (!Array.isArray(items) || !items.length || items.length > 50 || !items.every(t => typeof t === 'string' && t.trim() && t.length <= 200)) throw Error('itens deve ser uma lista de 1 a 50 nomes');
  // Same name twice in one call counts once, with the first spelling.
  const unique = new Map();
  for (const t of items) if (!unique.has(itemKey(t))) unique.set(itemKey(t), t.trim().replace(/\s+/g, ' '));
  return [...unique.values()];
}
const capitalized = t => t.charAt(0).toLocaleUpperCase('pt-BR') + t.slice(1);

function callTool(agent, name, args = {}) {
  const shopping = spaces.get(SHARED).shopping;
  const current = id => (shopping[id] && !shopping[id].deleted && shopping[id].listed !== false) ? shopping[id] : null;
  const op = (id, patch) => ({opId: `mcp-${randomUUID()}`, collection: 'shopping', id, patch});
  if (name === 'compras_listar') return {itens: shoppingList()};
  if (name === 'compras_sugerir') {
    const prefix = itemKey(typeof args.texto === 'string' ? args.texto : '');
    if (!prefix || prefix.length > 200) throw Error('texto deve ter de 1 a 200 caracteres');
    const starts = i => itemKey(i.text).startsWith(prefix) ? 0 : itemKey(i.text).split(' ').some(w => w.startsWith(prefix)) ? 1 : null;
    const found = Object.values(shopping).filter(i => !i.deleted && i.text && starts(i) !== null)
      .sort((a, b) => starts(a) - starts(b) || (b.added || 0) - (a.added || 0)).slice(0, 5);
    return {sugestoes: found.map(i => ({nome: i.text, na_lista: !!current(i.id), ultima_vez: i.added || null}))};
  }
  if (name === 'compras_adicionar') {
    const items = itemsFrom(args);
    if (args.por !== undefined && !userById(String(args.por))) throw Error(`por deve ser um destes: ${users.map(u => u.id).join(', ')}`);
    const by = args.por !== undefined ? String(args.por) : agent.id;
    const added = [], already = [], ops = [];
    for (const text of items) {
      const id = itemId(text), item = current(id);
      if (item) { already.push(item.done ? `${item.text} (no carrinho)` : item.text); continue; }
      const label = capitalized(text);
      ops.push(op(id, {text: label, done: false, listed: true, added: Date.now(), by}));
      added.push(label);
    }
    commit(ops, SHARED, {user: by, agent: agent.id});
    return {adicionados: added, ja_estavam: already};
  }
  if (name === 'compras_remover') {
    const removed = [], missing = [], ops = [];
    for (const text of itemsFrom(args)) {
      const id = itemId(text), item = current(id);
      if (!item) { missing.push(text); continue; }
      ops.push(op(id, {listed: false, done: false}));
      removed.push(item.text);
    }
    commit(ops, SHARED, {user: agent.id, agent: agent.id});
    return {removidos: removed, nao_encontrados: missing, ...(missing.length ? {lista: shoppingList().map(i => i.nome)} : {})};
  }
  return null;
}

// Streamable HTTP without sessions: one JSON-RPC request in, one JSON response out.
function mcpResponse(agent, message) {
  const {id, method, params = {}} = message;
  const ok = result => ({jsonrpc: '2.0', id, result});
  const fail = (code, msg) => ({jsonrpc: '2.0', id: id ?? null, error: {code, message: msg}});
  if (message.jsonrpc !== '2.0' || typeof method !== 'string') return fail(-32600, 'Requisição inválida');
  if (id === undefined) return null; // notification
  if (method === 'initialize') {
    const asked = params.protocolVersion;
    return ok({protocolVersion: MCP_VERSIONS.includes(asked) ? asked : MCP_VERSIONS[0], capabilities: {tools: {}}, serverInfo: {name: 'notas', version: '0.1.0'}, instructions: MCP_INSTRUCTIONS});
  }
  if (method === 'ping') return ok({});
  if (method === 'tools/list') return ok({tools: MCP_TOOLS});
  if (method === 'tools/call') {
    if (!MCP_TOOLS.some(t => t.name === params.name)) return fail(-32602, `Tool desconhecida: ${params.name}`);
    try {
      const result = callTool(agent, params.name, params.arguments || {});
      return ok({content: [{type: 'text', text: JSON.stringify(result)}], structuredContent: result, isError: false});
    } catch (e) {
      return ok({content: [{type: 'text', text: e.message}], isError: true});
    }
  }
  return fail(-32601, `Método desconhecido: ${method}`);
}

// ---------- Validation ----------
const billCalculation = {calcMode: 'string', unitAmount: 'number', weekdays: 'string', starts: 'string', excluded: 'string', lag: 'number'};
const schema = {
  sections: {name: 'string', order: 'number', deleted: 'boolean'},
  tasks: {text: 'string', section: 'string', date: 'string', time: 'string', end: 'string', done: 'boolean', repeat: 'string', from: 'string', meeting: 'boolean', deleted: 'boolean'},
  repeats: {text: 'string', section: 'string', time: 'string', end: 'string', days: 'string', monthDay: 'number', meeting: 'boolean', deleted: 'boolean'},
  bills: {text: 'string', amount: 'number', due: 'number', repeat: 'boolean', every: 'number', group: 'string', month: 'string', done: 'boolean', skipped: 'boolean', skipReason: 'string', deleted: 'boolean', ...billCalculation},
  billRules: {text: 'string', amount: 'number', due: 'number', repeat: 'boolean', every: 'number', month: 'string', ...billCalculation},
  meetings: {text: 'string', time: 'string', weekday: 'number', section: 'string', deleted: 'boolean'},
  days: {date: 'string', reviewed: 'boolean'},
  months: {month: 'string'},
  prefs: {reunioes: 'boolean', backlog: 'boolean', compras: 'boolean', contas: 'boolean'},
  shopping: {text: 'string', done: 'boolean', listed: 'boolean', added: 'number', by: 'string'},
};
// Field formats beyond the type check; time and a meeting's end are optional (empty string).
const clockTime = v => v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const formats = {
  time: clockTime, end: clockTime, days: v => /^[0-6]{0,7}$/.test(v),
  every: v => Number.isInteger(v) && v >= 1 && v <= 24, monthDay: v => Number.isInteger(v) && v <= 31, due: v => Number.isInteger(v) && v <= 31,
  month: v => /^\d{4}-(0[1-9]|1[0-2])$/.test(v),
  calcMode: v => ['fixed', 'occurrence'].includes(v),
  lag: v => v === 0 || v === 1,
  skipReason: v => ['', 'frequency', 'removed'].includes(v),
  unitAmount: v => Number.isSafeInteger(v) && v <= 100000000,
  weekdays: v => /^[0-6]{0,7}$/.test(v) && new Set(v).size === v.length,
  starts: v => v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v),
  excluded: v => v === '' || (v.split(',').length <= 31 && v.split(',').every(date => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date))),
  date: v => v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v),
  order: v => Number.isInteger(v), weekday: v => Number.isInteger(v) && v <= 6,
};
function validate(op) {
  if (!op || typeof op.opId !== 'string' || op.opId.length > 100 || !Object.hasOwn(schema, op.collection)) return false;
  if (typeof op.id !== 'string' || op.id.length > 200 || ['__proto__', 'constructor', 'prototype'].includes(op.id)) return false;
  if (!op.patch || typeof op.patch !== 'object' || Array.isArray(op.patch)) return false;
  if (op.batchId !== undefined && (typeof op.batchId !== 'string' || op.batchId.length > 100)) return false;
  if (['expectedBill', 'expectedBillRule'].some(k => op[k] !== undefined && (typeof op[k] !== 'string' || op[k].length > 20000 || !['bills', 'billRules'].includes(op.collection)))) return false;
  return Object.entries(op.patch).every(([k, v]) => Object.hasOwn(schema[op.collection], k) && typeof v === schema[op.collection][k]
    && (typeof v !== 'string' || v.length <= 10000) && (typeof v !== 'number' || (Number.isFinite(v) && v >= 0)) && (!formats[k] || formats[k](v)));
}

async function body(req) {
  let raw = '';
  for await (const c of req) { raw += c; if (raw.length > 65536) throw Error('Payload muito grande'); }
  return JSON.parse(raw || '{}');
}
// Besides PUBLIC_ORIGIN, the same hostname on another port (the old tailnet-only
// address) may still write when the page really is served from there; otherwise
// an app installed from it keeps reading but queues every change forever.
function trustedOrigin(req) {
  if (req.headers.origin === (process.env.PUBLIC_ORIGIN || `http://${req.headers.host}`)) return true;
  try { const o = new URL(req.headers.origin); return o.hostname === rpID && o.host === req.headers.host; } catch { return false; }
}
const attempts = new Map();
// Behind the local HTTPS proxy every socket comes from the proxy; its last X-Forwarded-For hop is the real client.
const trustProxy = process.env.TRUST_PROXY === '1';
const clientIp = req => (trustProxy && String(req.headers['x-forwarded-for'] || '').split(',').pop().trim()) || req.socket.remoteAddress;
function limited(req) {
  const ip = clientIp(req), now = Date.now();
  if (attempts.size > 10000) for (const [k, v] of attempts) if (now > v.until) attempts.delete(k);
  let a = attempts.get(ip);
  if (!a || now > a.until) { a = {count: 0, until: now + 60000}; attempts.set(ip, a); }
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
    if (req.method === 'POST' && req.headers.origin && !trustedOrigin(req)) return json(403, {error: 'Origem inválida'});

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
    // MCP for agents: bearer token instead of the session cookie.
    if (url.pathname === '/mcp' && agents.length) {
      const agent = agentFor(req);
      if (!agent) {
        if (limited(req)) return json(429, {error: 'Aguarde um minuto e tente novamente.'});
        res.setHeader('WWW-Authenticate', 'Bearer');
        return json(401, {error: 'Token inválido'});
      }
      if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return json(405, {error: 'Use POST'}); }
      const message = await body(req).catch(() => null);
      if (!message || typeof message !== 'object' || Array.isArray(message)) return json(400, {jsonrpc: '2.0', id: null, error: {code: -32700, message: 'JSON inválido'}});
      const reply = mcpResponse(agent, message);
      if (!reply) { res.writeHead(202); return res.end(); }
      if (message.method === 'tools/call') console.log('mcp:', agent.id, message.params?.name, reply.result?.isError ? 'erro' : 'ok');
      return json(200, reply);
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
        const request = await body(req), ops = Array.isArray(request) ? request : [request];
        if (!ops.length || ops.length > 500 || !ops.every(validate)) return json(400, {error: 'Alteração inválida'});
        const space = ops[0].collection === 'shopping' ? SHARED : user.id;
        if (ops.some(op => (op.collection === 'shopping' ? SHARED : user.id) !== space)) return json(400, {error: 'Alteração inválida'});
        const fresh = ops.filter(op => !db.prepare('SELECT id FROM operations WHERE id=?').get(op.opId));
        if (billOpsConflict(spaces.get(space), fresh)) return json(409, {error: 'As contas mudaram em outro aparelho. Confira os dados e tente novamente.'});
        // Who added an item is decided here, not by the client.
        for (const op of ops) if (op.collection === 'shopping') { delete op.patch.by; if (op.patch.listed === true) op.patch.by = user.id; }
        commit(ops, space, {user: user.id});
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
