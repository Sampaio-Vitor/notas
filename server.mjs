import http from 'node:http';
import {DatabaseSync} from 'node:sqlite';
import {mkdirSync, readFileSync, existsSync} from 'node:fs';
import {resolve, dirname, extname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomBytes, randomUUID, createHmac, timingSafeEqual} from 'node:crypto';
import {generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse} from '@simplewebauthn/server';
import {initialState, apply, SHARED_COLLECTIONS, rollover, migrate, normalize, itemKey, itemId, listed, billOpsConflict, cardBillOps, own, shiftDay} from './public/model.js';
import {SPACE_TOOLS, SPACE_TOOL_NAMES, spaceTool} from './mcp-espaco.mjs';
import {validate} from './validacao.mjs';
import webpush from 'web-push';
import {casaAlerts, casaMessages, meetingReminders, stillTrue, choreKey} from './push.mjs';

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
  CREATE TABLE IF NOT EXISTS passkeys (id TEXT PRIMARY KEY, public_key TEXT NOT NULL, counter INTEGER NOT NULL, transports TEXT, name TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP, last_used TEXT);
  CREATE TABLE IF NOT EXISTS push_subscriptions (endpoint TEXT PRIMARY KEY, user_id TEXT NOT NULL, keys TEXT NOT NULL, device TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);`);
if (!db.prepare('PRAGMA table_info(passkeys)').all().some(c => c.name === 'user_id')) db.exec('ALTER TABLE passkeys ADD COLUMN user_id TEXT');
// Passkeys created before accounts existed belong to the first person.
db.prepare('UPDATE passkeys SET user_id=? WHERE user_id IS NULL').run(owner.id);

// One state per person plus the shared "casa" space (shopping, lists, chores and notes).
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
// Casa starts with one list for chores; deleting it keeps it deleted.
if (!spaces.get(SHARED).lists.afazeres) { apply(spaces.get(SHARED), {collection: 'lists', id: 'afazeres', patch: {name: 'Afazeres', order: 0}}); persist(SHARED); }
const sharedCollection = c => SHARED_COLLECTIONS.includes(c);

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

// ---------- Notifications (Web Push) ----------
// Each device that turned notifications on in Ajustes has a subscription, tied to the person
// signed in there. The VAPID keys are made once and kept in the database, like the session
// key: changing them would silence every device until it subscribes again.
if (!db.prepare("SELECT value FROM meta WHERE key='vapid'").get()) db.prepare("INSERT INTO meta VALUES ('vapid',?)").run(JSON.stringify(webpush.generateVAPIDKeys()));
const vapid = JSON.parse(db.prepare("SELECT value FROM meta WHERE key='vapid'").get().value);
const pushOrigin = process.env.PUBLIC_ORIGIN || '';
webpush.setVapidDetails(process.env.VAPID_SUBJECT || (pushOrigin.startsWith('https:') ? pushOrigin : 'mailto:notas@localhost.invalid'), vapid.publicKey, vapid.privateKey);
// Only the browsers' push services (Apple, Google, Mozilla, Microsoft), over HTTPS on the
// default port: a subscription can never make the server call an address of its own network.
// Tests add their fake service with PUSH_ALLOW_HOSTS (and PUSH_ALLOW_HTTP).
const TEST_PUSH_HOSTS = (process.env.PUSH_ALLOW_HOSTS || '').split(',').filter(Boolean);
const PUSH_HOSTS = ['.push.apple.com', 'fcm.googleapis.com', 'android.googleapis.com', '.push.services.mozilla.com', '.notify.windows.com', ...TEST_PUSH_HOSTS];
function pushEndpointOk(endpoint) {
  try {
    const u = new URL(endpoint);
    const http = process.env.PUSH_ALLOW_HTTP === '1' && u.protocol === 'http:' && TEST_PUSH_HOSTS.includes(u.hostname);
    if (!(u.protocol === 'https:' || http) || u.username || u.password || (u.port && !http)) return false;
    return PUSH_HOSTS.some(h => h.startsWith('.') ? u.hostname.endsWith(h) : u.hostname === h);
  } catch { return false; }
}
const b64Bytes = v => typeof v === 'string' && /^[A-Za-z0-9_-]+={0,2}$/.test(v) ? Buffer.from(v, 'base64url').length : 0;
const hasDevices = userId => !!db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id=? LIMIT 1').get(userId);
// Sends to every device of a person (or only `endpoint`); answers how many accepted it.
async function pushTo(userId, message, options = {}, endpoint) {
  const subs = db.prepare('SELECT endpoint, keys FROM push_subscriptions WHERE user_id=?').all(userId).filter(s => !endpoint || s.endpoint === endpoint);
  const sent = await Promise.all(subs.map(async s => {
    try {
      // web-push signs and encrypts; fetch sends, with a timeout and without following redirects.
      const r = webpush.generateRequestDetails({endpoint: s.endpoint, keys: JSON.parse(s.keys)}, JSON.stringify(message), {TTL: 86400, ...options});
      const res = await fetch(r.endpoint, {method: r.method, headers: r.headers, body: r.body, redirect: 'error', signal: AbortSignal.timeout(10000)});
      const text = await res.text().catch(() => '');
      // Gone: the device turned notifications off or the app was removed.
      if (res.status === 404 || res.status === 410) db.prepare('DELETE FROM push_subscriptions WHERE endpoint=?').run(s.endpoint);
      else if (!res.ok) console.error('push:', userId, res.status, text.slice(0, 200));
      return res.ok;
    } catch (e) {
      console.error('push:', userId, e.message);
      return false;
    }
  }));
  return sent.filter(Boolean).length;
}
// Casa changes wait a few seconds per person, so a batch of items typed one by one
// (each one its own request) becomes one notification. When it goes out, each alert is
// checked again: an item removed or a chore handed back in the meantime is left out.
const PUSH_DELAY = Number(process.env.PUSH_DELAY_MS || 8000);
const casaQueue = new Map();
const actorName = id => userById(id)?.name || agents.find(a => a.id === id)?.id || id;
function queueCasaAlerts(alerts, actor) {
  for (const a of alerts) {
    if (!hasDevices(a.to)) continue;
    let q = casaQueue.get(a.to);
    if (!q) {
      q = {alerts: [], timer: setTimeout(() => {
        casaQueue.delete(a.to);
        const casa = spaces.get(SHARED), current = q.alerts.filter(x => stillTrue(casa, x));
        for (const m of casaMessages(current, actorName, id => casa.lists[id]?.name || '')) void pushTo(a.to, m);
      }, PUSH_DELAY)};
      q.timer.unref();
      casaQueue.set(a.to, q);
    }
    q.alerts.push({...a, actor});
  }
}
// Chores deleted in the last two minutes: a copy of one of them is an Undo, not news.
const deletedChores = new Map();
function recentlyDeleted(before, ops) {
  const now = Date.now();
  for (const [k, at] of deletedChores) if (at < now - 120000) deletedChores.delete(k);
  const keys = new Set(deletedChores.keys());
  for (const op of ops) {
    const c = op.collection === 'chores' && op.patch.deleted === true && own(before.chores, op.id);
    if (c) deletedChores.set(choreKey(c), now);
  }
  return keys;
}
// Meeting reminders: checked every few seconds; the ones sent are kept in the database for
// two days, so a restart within a reminder's minute does not send it again.
db.exec('CREATE TABLE IF NOT EXISTS push_sent (key TEXT PRIMARY KEY, at INTEGER NOT NULL)');
const ZONE = process.env.TZ || 'America/Sao_Paulo';
function localClock(now = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23'}).formatToParts(now).map(x => [x.type, x.value]));
  return {date: `${p.year}-${p.month}-${p.day}`, minutes: Number(p.hour) * 60 + Number(p.minute)};
}
function remindMeetings() {
  const {date, minutes} = localClock();
  db.prepare('DELETE FROM push_sent WHERE at < ?').run(Date.now() - 2 * 86400000);
  // Near midnight, tomorrow's first meetings are due too.
  const days = [[date, minutes], ...(minutes >= 24 * 60 - 15 ? [[shiftDay(date, 1), minutes - 24 * 60]] : [])];
  for (const u of users) {
    if (!hasDevices(u.id)) continue;
    for (const [day, at] of days) for (const r of meetingReminders(spaces.get(u.id), day, at)) {
      const key = `${u.id}|${r.key}`;
      if (db.prepare('INSERT OR IGNORE INTO push_sent VALUES (?,?)').run(key, Date.now()).changes === 0) continue;
      const {key: _, ...message} = r;
      void pushTo(u.id, message, {TTL: 600, urgency: 'high'});
    }
  }
}

function today() { return new Intl.DateTimeFormat('en-CA', {timeZone: process.env.TZ || 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit'}).format(new Date()); }
function ensureDay() {
  for (const u of users) {
    const state = spaces.get(u.id), ops = rollover(state, today());
    for (const op of ops) apply(state, op);
    // Bills linked to a card follow it, including the ones the rollover just created.
    const cardOps = cardBillOps(state);
    for (const op of cardOps) apply(state, op);
    if (!ops.length && !cardOps.length) continue;
    persist(u.id); notify(u.id);
  }
}
ensureDay();
setInterval(ensureDay, 30000).unref();
setInterval(remindMeetings, Number(process.env.PUSH_TICK_MS || 20000)).unref();

// What a person sees: their own space with Casa (the shared collections) in it.
const viewFor = user => ({...spaces.get(user.id), ...Object.fromEntries(SHARED_COLLECTIONS.map(c => [c, spaces.get(SHARED)[c]]))});

// Applies operations to one space in a single transaction and logs them with `who`
// (the person, plus the agent when it came through MCP). Repeated opIds are skipped.
function commit(ops, space, who) {
  const fresh = ops.filter(op => !db.prepare('SELECT id FROM operations WHERE id=?').get(op.opId));
  if (!fresh.length) return;
  const before = spaces.get(space), next = structuredClone(before);
  for (const op of fresh) apply(next, op);
  db.exec('BEGIN');
  try {
    for (const op of fresh) db.prepare('INSERT INTO operations(id,value) VALUES (?,?)').run(op.opId, JSON.stringify({...op, ...who, space}));
    db.prepare('INSERT OR REPLACE INTO spaces VALUES (?,?)').run(space, JSON.stringify(next));
    db.exec('COMMIT');
    spaces.set(space, next);
  } catch (e) { db.exec('ROLLBACK'); throw e; }
  notify(space);
  if (space === SHARED) queueCasaAlerts(casaAlerts(before, fresh, who.user, users.map(u => u.id), recentlyDeleted(before, fresh)), who.user);
}

// ---------- Credit card bills ----------
// The finance app answers only inside the Docker network shared with
// it, with a read-only token. Its cards go to FINANCE_USER's space (default: first person).
const finance = process.env.FINANCE_URL && process.env.FINANCE_TOKEN ? {
  url: process.env.FINANCE_URL.replace(/\/+$/, ''), token: process.env.FINANCE_TOKEN,
  user: userById(process.env.FINANCE_USER || owner.id) || (() => { throw Error(`FINANCE_USER deve ser um destes: ${users.map(u => u.id).join(', ')}`); })(),
} : null;
const cents = value => Math.round(Number(value) * 100);
// One record per card, with its bills by due month (amounts in cents, like every bill here).
function cardRecord(card) {
  const bills = {};
  for (const b of card.bills || []) if (/^\d{4}-\d{2}$/.test(b.month) && /^\d{4}-\d{2}-\d{2}$/.test(b.due_date) && Number.isFinite(cents(b.amount))) bills[b.month] = {amount: Math.max(0, cents(b.amount)), due: b.due_date, status: b.status};
  return {name: String(card.name || 'Cartão').slice(0, 200), bills};
}
let financeError = '';
async function syncCards() {
  try {
    const res = await fetch(`${finance.url}/api/integrations/credit-card-bills`, {headers: {Authorization: `Bearer ${finance.token}`}, signal: AbortSignal.timeout(15000)});
    if (!res.ok) throw Error(`HTTP ${res.status}`);
    const {cards} = await res.json();
    const current = spaces.get(finance.user.id).cards;
    const ops = cards.map(card => ({opId: `finance-${randomUUID()}`, collection: 'cards', id: String(card.id), patch: cardRecord(card)}))
      .filter(op => JSON.stringify({...current[op.id], id: undefined}) !== JSON.stringify({...op.patch, id: undefined}));
    if (ops.length) commit(ops, finance.user.id, {user: finance.user.id, agent: 'financas'});
    ensureDay();
    if (financeError) console.log('faturas: sincronização voltou');
    financeError = '';
  } catch (e) {
    // Logged once per kind of failure, not every ten minutes.
    if (e.message !== financeError) console.error('faturas: não foi possível ler o app de finanças:', e.message);
    financeError = e.message;
  }
}
if (finance) { syncCards(); setInterval(syncCards, 10 * 60000).unref(); }

// ---------- Shopping ----------
// When an item goes into the cart, the item records when and who. The time comes from the
// device (it may have been offline in the store), unless it is missing or implausible; the
// person always comes from the session. Taking it back out of the cart, still on the list,
// was a mistake: the record is cleared. Clearing the cart or removing the item keeps it, as
// the last time it was bought.
const BOUGHT_SLACK = 30 * 86400000;
// Casa records say who created them, who checked a chore and who last edited a note; the
// server decides that, never the client. `added` comes from the app (it may be offline) when plausible.
function stampCasa(ops, user) {
  const casa = spaces.get(SHARED), now = Date.now(), created = new Set();
  for (const {collection, id, patch} of ops) {
    if (!['lists', 'chores', 'notes'].includes(collection)) continue;
    for (const k of ['by', 'doneBy', 'doneAt', 'editedBy', 'edited']) delete patch[k];
    const fresh = !casa[collection][id] && !created.has(`${collection}:${id}`);
    if (fresh) {
      created.add(`${collection}:${id}`);
      if (collection !== 'lists') { patch.by = user; if (!(typeof patch.added === 'number' && patch.added > now - BOUGHT_SLACK && patch.added <= now + 60000)) patch.added = now; }
    } else delete patch.added;
    if (collection === 'chores' && patch.done === true) { patch.doneBy = user; patch.doneAt = now; }
    if (collection === 'chores' && patch.done === false) { patch.doneBy = ''; patch.doneAt = 0; }
    if (collection === 'notes' && ('title' in patch || 'body' in patch)) { patch.editedBy = user; patch.edited = now; }
  }
}

function stampBought(patch, user) {
  delete patch.boughtBy;
  const now = Date.now();
  if (patch.done === true) {
    if (!(typeof patch.bought === 'number' && patch.bought > now - BOUGHT_SLACK && patch.bought <= now + 60000)) patch.bought = now;
    patch.boughtBy = user;
  } else if (patch.done === false && patch.listed === undefined) { patch.bought = 0; patch.boughtBy = ''; }
  else delete patch.bought;
}

// ---------- MCP ----------
// Agents (a shopping assistant) reach only the shopping list. An agent whose token names a space
// (MCP_TOKENS="lia:<token>,robo:<token>:ana") also reaches that person's tasks and bills,
// and only theirs: the space comes from the token, never from an argument.
// Each token is sent as "Authorization: Bearer <token>". A last field shaped like an id that
// names nobody is a mistyped space (robo:<token>:vitro), not the end of the token: it stops
// the server instead of silently becoming part of a token that reaches only the shopping list.
const agents = (process.env.MCP_TOKENS || '').split(',').filter(e => e.trim()).map(entry => {
  const [id, ...rest] = entry.trim().split(':');
  if (rest.length >= 2 && /^[a-z0-9-]+$/.test(rest.at(-1)) && !userById(rest.at(-1))) {
    throw Error(`MCP_TOKENS: o espaço "${rest.at(-1)}" do agente "${id}" não é ninguém de APP_USERS (${users.map(u => u.id).join(', ')}). Use id:token ou id:token:espaço.`);
  }
  const space = rest.length >= 2 && userById(rest.at(-1)) ? rest.pop() : undefined;
  const token = rest.join(':');
  if (!/^[a-z0-9-]+$/.test(id || '') || token.length < 24) throw Error(`MCP_TOKENS inválido em "${id}". Use id:token ou id:token:espaço, com token de 24 caracteres ou mais.`);
  return {id, token, space};
});
for (const a of agents.filter(a => a.space)) console.log(`mcp: ${a.id} alcança tarefas e contas de ${a.space}`);
const agentFor = req => {
  const token = req.headers.authorization?.match(/^Bearer (\S+)$/)?.[1];
  return token ? agents.find(a => equal(token, a.token)) : undefined;
};
const MCP_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26'];
const itemsArg = {type: 'array', items: {type: 'string', minLength: 1, maxLength: 200}, minItems: 1, maxItems: 50};
const porArg = {type: 'string', description: 'Id de quem pediu; o item fica com a cor dessa pessoa. Sem ele, fica no nome do agente.'};
const MCP_TOOLS = [
  {name: 'compras_listar', title: 'Ver a lista de compras',
    description: 'A lista de compras da casa: o que falta comprar e o que já está no carrinho, com quem adicionou cada item. Item no carrinho traz quando foi marcado como comprado (comprado_em, ISO 8601) e por quem (comprado_por).',
    inputSchema: {type: 'object', properties: {}}, annotations: {readOnlyHint: true}},
  {name: 'compras_adicionar', title: 'Adicionar à lista de compras',
    description: 'Põe itens na lista de compras da casa. Um item por entrada, só o nome ("leite", "pão de forma"). Item que já está na lista não duplica.',
    inputSchema: {type: 'object', properties: {itens: itemsArg, por: porArg}, required: ['itens']}, annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true}},
  {name: 'compras_remover', title: 'Tirar da lista de compras',
    description: 'Tira itens da lista de compras da casa pelo nome. Se algum não for encontrado, a resposta traz a lista atual para tentar com o nome que está nela.',
    inputSchema: {type: 'object', properties: {itens: itemsArg}, required: ['itens']}, annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true}},
  {name: 'compras_sugerir', title: 'Sugerir itens já comprados',
    description: 'Itens que já estiveram na lista e começam com o texto (acento e maiúscula não importam), os mais recentes primeiro. Para completar o que alguém está digitando. Traz também a última vez que cada um foi comprado (ultima_compra, ISO 8601, ou null) e por quem.',
    inputSchema: {type: 'object', properties: {texto: {type: 'string', minLength: 1, maxLength: 200}}, required: ['texto']}, annotations: {readOnlyHint: true}},
];
const MCP_INSTRUCTIONS = 'Lista de compras compartilhada da casa, a mesma do app Notas. Acentos e maiúsculas não importam nos nomes.';

const personName = id => userById(id)?.name || id || '';
const isoTime = ms => ms ? new Date(ms).toISOString() : null;
const shoppingList = () => listed(spaces.get(SHARED)).sort((a, b) => (a.added || 0) - (b.added || 0))
  .map(i => ({nome: i.text, por: personName(i.by), carrinho: !!i.done,
    ...(i.done ? {comprado_em: isoTime(i.bought), comprado_por: i.boughtBy ? personName(i.boughtBy) : null} : {})}));
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
    return {sugestoes: found.map(i => ({nome: i.text, na_lista: !!current(i.id), ultima_vez: i.added || null,
      ultima_compra: isoTime(i.bought), ...(i.bought && i.boughtBy ? {comprado_por: personName(i.boughtBy)} : {})}))};
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
    commitFromAgent(ops, SHARED, {user: by, agent: agent.id});
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
    commitFromAgent(ops, SHARED, {user: agent.id, agent: agent.id});
    return {removidos: removed, nao_encontrados: missing, ...(missing.length ? {lista: shoppingList().map(i => i.nome)} : {})};
  }
  return null;
}

// What an agent writes passes the same validation as what the app sends, in the same JSON form:
// an operation the app's own sync would have refused never gets in (and then blocks a device's
// queue). One invalid operation means nothing of the call is written.
function commitFromAgent(ops, space, who) {
  const wire = JSON.parse(JSON.stringify(ops));
  const invalid = wire.find(op => !validate(op));
  if (invalid) {
    console.error('mcp: operação inválida recusada:', JSON.stringify(invalid).slice(0, 500));
    throw Error('alteração inválida; nada foi gravado');
  }
  commit(wire, space, who);
}

// Tasks and bills of the agent's space, through the same commit as the app (one transaction,
// an opId per operation, logged with the agent, and a notice to that person's devices).
function callSpaceTool(agent, name, args) {
  if (args === null || typeof args !== 'object' || Array.isArray(args)) throw Error('argumentos devem ser um objeto');
  const {result, ops} = spaceTool(spaces.get(agent.space), name, args, today(), randomUUID, agent.id);
  commitFromAgent(ops.map(op => ({opId: `mcp-${randomUUID()}`, ...op})), agent.space, {user: agent.space, agent: agent.id});
  return result;
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
  if (method === 'tools/list') return ok({tools: agent.space ? [...MCP_TOOLS, ...SPACE_TOOLS] : MCP_TOOLS});
  if (method === 'tools/call') {
    const inSpace = agent.space && SPACE_TOOL_NAMES.has(params.name);
    if (!inSpace && !MCP_TOOLS.some(t => t.name === params.name)) return fail(-32602, `Tool desconhecida: ${params.name}`);
    try {
      const result = inSpace ? callSpaceTool(agent, params.name, params.arguments || {}) : callTool(agent, params.name, params.arguments || {});
      return ok({content: [{type: 'text', text: JSON.stringify(result)}], structuredContent: result, isError: false});
    } catch (e) {
      return ok({content: [{type: 'text', text: e.message}], isError: true});
    }
  }
  return fail(-32601, `Método desconhecido: ${method}`);
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
      if (route('GET', '/api/push')) return json(200, {key: vapid.publicKey});
      if (route('POST', '/api/push/subscribe')) {
        const {endpoint, keys, previous} = await body(req);
        if (typeof endpoint !== 'string' || endpoint.length > 2000 || !pushEndpointOk(endpoint) || b64Bytes(keys?.p256dh) !== 65 || b64Bytes(keys?.auth) !== 16) return json(400, {error: 'Inscrição inválida'});
        // A renewed subscription (pushsubscriptionchange) replaces the old one.
        if (typeof previous === 'string' && previous !== endpoint) db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').run(previous, user.id);
        db.prepare('INSERT OR REPLACE INTO push_subscriptions(endpoint,user_id,keys,device) VALUES (?,?,?,?)').run(endpoint, user.id, JSON.stringify({p256dh: keys.p256dh, auth: keys.auth}), deviceName(req.headers['user-agent']));
        // At most 10 devices per person; the oldest go first.
        db.prepare('DELETE FROM push_subscriptions WHERE user_id=? AND endpoint NOT IN (SELECT endpoint FROM push_subscriptions WHERE user_id=? ORDER BY created DESC, rowid DESC LIMIT 10)').run(user.id, user.id);
        return json(200, {ok: true});
      }
      if (route('POST', '/api/push/unsubscribe')) {
        db.prepare('DELETE FROM push_subscriptions WHERE endpoint=? AND user_id=?').run(String((await body(req)).endpoint || ''), user.id);
        return json(200, {ok: true});
      }
      // A test to this device (`endpoint`), or to all of this person's devices.
      if (route('POST', '/api/push/test')) {
        if (limited(req)) return json(429, {error: 'Aguarde um minuto e tente novamente.'});
        const endpoint = String((await body(req)).endpoint || '') || undefined;
        if (!db.prepare('SELECT 1 FROM push_subscriptions WHERE user_id=? AND (? IS NULL OR endpoint=?)').get(user.id, endpoint ?? null, endpoint ?? null)) return json(404, {error: 'Este aparelho não está inscrito. Desligue e ligue as notificações.'});
        const sent = await pushTo(user.id, {title: 'Notas', body: 'Notificações ligadas neste aparelho.', tag: 'teste', url: '/?aba=ajustes'}, {}, endpoint);
        return sent ? json(200, {ok: true}) : json(502, {error: 'O serviço de notificações recusou o envio.'});
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
        // `invalid`: sending it again will never work, so the app drops it instead of retrying forever.
        if (!ops.length || ops.length > 500 || !ops.every(validate)) return json(400, {error: 'Alteração inválida', invalid: true});
        const space = sharedCollection(ops[0].collection) ? SHARED : user.id;
        if (ops.some(op => (sharedCollection(op.collection) ? SHARED : user.id) !== space)) return json(400, {error: 'Alteração inválida', invalid: true});
        const fresh = ops.filter(op => !db.prepare('SELECT id FROM operations WHERE id=?').get(op.opId));
        if (billOpsConflict(spaces.get(space), fresh)) return json(409, {error: 'As contas mudaram em outro aparelho. Confira os dados e tente novamente.'});
        // Who added an item is decided here, not by the client.
        for (const op of ops) if (op.collection === 'shopping') { delete op.patch.by; if (op.patch.listed === true) op.patch.by = user.id; stampBought(op.patch, user.id); }
        stampCasa(ops, user.id);
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
