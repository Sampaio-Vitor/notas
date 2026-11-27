import {createNavigation} from './navigation.js';
// Report uncaught errors to the server log; on a phone there is no console to look at.
const report = message => { try { navigator.sendBeacon?.('/api/client-log', new Blob([JSON.stringify({message})], {type: 'application/json'})); } catch {} };
addEventListener('error', e => report(`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`));
addEventListener('unhandledrejection', e => report(`promise: ${e.reason?.stack || e.reason}`));
import {initialState, normalize, apply, dayKey, weekday, rollover, live, sortedSections, repeatsOn, occurrenceId, lastPending, pendingOn, carryOps, scheduledTasks, overdueTasks, itemKey, itemId, listed, tabPrefs, billEvery, scheduledBills, repeatingBills, billRule, billCatalog, virtualBill, editBillOps, deleteBillOps, undoBillOps, guardBillOps, billPayable, payBillOps, billDates, billIncludedDates, billSnapshot, billSessionMonth, accruingBills, billChain, linkedCard, cardBill, parseQuickTask, meetingLanes, meetingEnd, onAgenda, toMinutes, fromMinutes, tasksForDay, billDueDate, monthBills, liveLists, liveChores, choresForToday, parseChore, nextCycleDate, CYCLES, origin, taskSteps, taskDoneOps, stepToggleOps, own, liveMemos, trashedMemos, sortMemos, memoUnseen, memoStamp, memoSnippet, memoTitle, memoTasks, toggleMemoTask, searchMemos, memoGone, MEMO_MAX, MEMO_TITLE_MAX, TRASH_DAYS} from './model.js';
import MarkdownIt from './vendor/markdown-it.js';
import {createMarkdown} from './markdown.js';

const $ = (s, el = document) => el.querySelector(s);
const $$ = (s, el = document) => [...el.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const uid = () => crypto.randomUUID();
const money = n => new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'}).format((n || 0) / 100);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const WEEK = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const WEEK_INITIAL = ['D', 'S', 'T', 'Q', 'Q', 'S', 'S'];
const MONTHS = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const cap = s => s[0].toUpperCase() + s.slice(1);
const today = () => dayKey();
const addDays = (date, n) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); return dayKey(d); };
const addMonths = (month, n) => { const d = new Date(`${month}-01T12:00:00`); d.setMonth(d.getMonth() + n); return dayKey(d).slice(0, 7); };
const monthName = month => { const name = cap(MONTHS[Number(month.slice(5, 7)) - 1]); return month.slice(0, 4) === today().slice(0, 4) ? name : `${name} de ${month.slice(0, 4)}`; };
const longDate = date => `${WEEK[weekday(date)]}, ${Number(date.slice(8, 10))} de ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
const shortTime = t => t ? t.replace(/^0/, '') : '';
// "14:00–15:30" for anything with a time; tasks saved before they had an end show
// just the start, meetings their old 30 minutes.
const timeLabel = t => t.time && (t.meeting || t.end) ? `${shortTime(t.time)}–${shortTime(meetingEnd(t))}` : shortTime(t.time);

// "de ontem", "de sexta", "de 3 de outubro"
function fromDay(date) {
  if (date === addDays(today(), -1)) return 'de ontem';
  if (date >= addDays(today(), -6)) return `de ${WEEK[weekday(date)].toLowerCase()}`;
  return `de ${Number(date.slice(8, 10))} de ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}
// "amanhã", "segunda", "5 de novembro"
function nextDayLabel(date) {
  if (date === addDays(today(), 1)) return 'amanhã';
  if (date <= addDays(today(), 6)) return WEEK[weekday(date)].toLowerCase();
  return `${Number(date.slice(8, 10))} de ${MONTHS[Number(date.slice(5, 7)) - 1]}`;
}

const ICONS = {
  prev: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M12.5 4.5 7 10l5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  next: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 4.5 13 10l-5.5 5.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  cal: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 8.5h14M7 2.5v4M13 2.5v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  rep: '<svg viewBox="0 0 16 16" aria-label="Repete"><path d="M3 7a5 5 0 0 1 8.6-3.4L13 5M13 2v3h-3M13 9a5 5 0 0 1-8.6 3.4L3 11M3 14v-3h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  casa: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 11 12 4.5 20 11v8a1.5 1.5 0 0 1-1.5 1.5h-13A1.5 1.5 0 0 1 4 19z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M10 20.5v-5.5h4v5.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/></svg>',
  more: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="4.5" cy="10" r="1.6" fill="currentColor"/><circle cx="10" cy="10" r="1.6" fill="currentColor"/><circle cx="15.5" cy="10" r="1.6" fill="currentColor"/></svg>',
  eye: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  search: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M13 13l4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  hoje: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 12.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  backlog: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  reunioes: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  contas: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17" stroke="currentColor" stroke-width="1.8"/></svg>',
  compras: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 8.5h13l-1 11a1.5 1.5 0 0 1-1.5 1.4H8a1.5 1.5 0 0 1-1.5-1.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  notas: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3.5h7.5L19 8v11a1.5 1.5 0 0 1-1.5 1.5h-10A1.5 1.5 0 0 1 5.5 19V5A1.5 1.5 0 0 1 7 3.5z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M14.5 3.5V8H19M8.8 12.5h6.4M8.8 16h4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  pin: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M7.5 3h5l-.7 5 2.7 3h-9l2.7-3zM10 11v6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  spark: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 1.5l1.7 4.3 4.3 1.7-4.3 1.7L8 13.5 6.3 9.2 2 7.5l4.3-1.7z" fill="currentColor"/></svg>',
  ajustes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h9M18 7h1M5 17h1M10 17h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
};
// The tab id `compras` is kept for saved preferences; the tab is Casa (Compras is one of its lists).
const TABS = [['hoje', 'Hoje'], ['reunioes', 'Agenda'], ['backlog', 'Backlog'], ['notas', 'Notas'], ['compras', 'Casa'], ['contas', 'Contas'], ['ajustes', 'Ajustes']];
const tabIcon = id => ICONS[id === 'compras' ? 'casa' : id];
// Hoje and Ajustes always show; the others follow this person's choices in Ajustes.
const visibleTabs = () => { const prefs = tabPrefs(state); return TABS.filter(([id]) => !(id in prefs) || prefs[id]); };

// ---------- Local state, outbox and sync ----------

let state = initialState(), queue = [], busy = false, events = null, online = navigator.onLine, syncError = '', needsLogin = false, protectedServer = false;
let passkeys = [], regOptions = null, loginOptions = null, loginOptionsError = null;
// Who is signed in. The local cache belongs to one person (`owner`); another
// person signing in on the same device starts from a clean cache.
let me = null, people = [], owner = null, sessionLoaded = false;
let tab = 'hoje', billMonth = today().slice(0, 7), selecting = false, selected = new Set(), historyDate = null, hojeDate = null, railDate = null, sub = null, dragging = false, billsView = 'mes', openMonths = new Set();
let billSearch = '', billFilter = 'all';

try {
  const saved = JSON.parse(localStorage.getItem('notas-v1') || 'null');
  if (saved) { state = normalize(saved.state); queue = saved.queue; owner = saved.user || null; }
} catch { alert('Não foi possível ler os dados salvos neste aparelho. Os dados do servidor serão usados.'); }

function save() {
  try { localStorage.setItem('notas-v1', JSON.stringify({user: owner, state, queue})); }
  catch { toast('Sem espaço para salvar neste aparelho. Mantenha o app aberto até sincronizar.'); }
}
function reload() {
  const saved = JSON.parse(localStorage.getItem('notas-v1') || 'null');
  if (saved) { state = normalize(saved.state); queue = saved.queue; owner = saved.user || null; }
}
function clearLocal() {
  localStorage.removeItem('notas-v1');
  state = initialState(); queue = []; owner = null; me = null; sessionLoaded = false; passkeys = [];
}
const exclusive = fn => navigator.locks ? navigator.locks.request('notas-outbox', fn) : Promise.resolve().then(fn);

function commitMany(ops) {
  return exclusive(() => {
    reload();
    if (typeof ops === 'function') ops = ops();
    const batchId = uid();
    for (const op of guardBillOps(state, ops)) { op.opId = uid(); op.batchId = batchId; apply(state, op); queue.push(op); }
    save(); render(); void sync();
  });
}
const commit = (collection, id, patch) => commitMany([{collection, id, patch}]);

function ensureLocal() {
  return exclusive(() => {
    reload();
    const batchId = uid();
    for (const op of guardBillOps(state, rollover(state, today()))) { op.opId = uid(); op.batchId = batchId; apply(state, op); queue.push(op); }
    save();
  });
}

async function api(path, options) {
  const r = await fetch(path, {...options, signal: AbortSignal.timeout(10000)});
  if (r.status === 401) { needsLogin = true; throw Error('login'); }
  if (!r.ok) { const body = await r.json(); throw Object.assign(Error(body.error || 'Falha de conexão'), {status: r.status, invalid: body.invalid === true}); }
  return r;
}

async function sync() {
  if (busy) return;
  busy = true;
  return exclusive(async () => {
    reload();
    try {
      if (!sessionLoaded) {
        const session = await (await api('/api/session')).json();
        protectedServer = session.protected; me = session.me; people = session.users; sessionLoaded = true;
        // Never send someone else's pending changes under this session.
        if (owner && owner !== me.id) { state = initialState(); queue = []; }
        owner = me.id; save();
        if (protectedServer) void loadPasskeys();
        void refreshPush();
      }
      // Fetch first so an empty new device never uploads its initial defaults.
      let remote = await (await api('/api/state')).json();
      while (queue.length) {
        const first = queue[0], boundary = first.batchId ? queue.findIndex(op => op.batchId !== first.batchId) : 1;
        const batch = queue.slice(0, boundary < 0 ? queue.length : boundary);
        try {
          await api('/api/operations', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(batch.length > 1 ? batch : batch[0])});
        } catch (e) {
          // A conflict, or a change the server will never accept (`invalid`), leaves the queue;
          // anything else (offline, a server error) keeps it there for the next try.
          const refused = e.status === 400 && e.invalid;
          if (e.status !== 409 && !refused) throw e;
          queue.splice(0, batch.length);
          if (refused) {
            // The refused batch may have been creating a record: later ops on the same records would
            // create it half-made on the server (a `done` without text). They go too, logged together.
            const keys = new Set(batch.map(op => `${op.collection}:${op.id}`));
            const dependent = queue.filter(op => keys.has(`${op.collection}:${op.id}`));
            for (let i = queue.length - 1; i >= 0; i--) if (keys.has(`${queue[i].collection}:${queue[i].id}`)) queue.splice(i, 1);
            report(`sync: alteração recusada pelo servidor e descartada: ${JSON.stringify([...batch, ...dependent]).slice(0, 1500)}`);
          }
          remote = normalize(await (await api('/api/state')).json());
          for (const op of queue) apply(remote, op);
          state = remote; save(); render();
          if (refused) { toast('O servidor recusou uma alteração deste aparelho; ela foi descartada.'); continue; }
          closeSheet();
          toast('As contas mudaram em outro aparelho. Esta alteração não foi aplicada; confira e tente novamente.');
          continue;
        }
        queue.splice(0, batch.length); save();
      }
      remote = normalize(await (await api('/api/state')).json());
      // Preserve operations entered while the last request was in flight.
      for (const op of queue) apply(remote, op);
      state = remote; online = true; needsLogin = false; syncError = ''; save(); render();
      if (!events) {
        events = new EventSource('/api/events');
        events.onmessage = () => void sync();
        events.onerror = () => { online = false; render(); };
      }
    } catch (e) {
      online = false; syncError = e.status ? e.message : '';
      if (e.message !== 'login' && navigator.onLine) console.warn('Sincronização:', e.message);
    } finally { busy = false; render(); }
  });
}

// ---------- Helpers over state ----------

const sections = () => sortedSections(state);
const sectionName = id => state.sections[id]?.name || 'Sem seção';
const tasksOn = date => live(state, 'tasks').filter(t => t.date === date);
// A day not opened yet also shows what its repeats will create there.
const dayTasks = date => tasksForDay(state, date);
// A repeat's occurrence on a day not reached yet exists only on screen; touching it stores it.
const projected = id => {
  if (state.tasks[id]) return null;
  for (const date of [historyDate, tab === 'hoje' && hojeDate, tab === 'hoje' && railDate]) { const t = date && dayTasks(date).find(t => t.id === id); if (t) return t; }
  return null;
};
// With the Agenda tab on, meetings live there and leave Hoje. Other tasks with a
// time show in both.
const meetingsApart = () => tabPrefs(state).reunioes;
const todayTasks = () => tasksOn(today()).filter(t => !(meetingsApart() && t.meeting));
const todayMeetings = (date = today()) => tasksOn(date).filter(onAgenda);
const backlog = () => live(state, 'tasks').filter(t => t.date === '');
const scheduled = () => scheduledTasks(state, today());
const overdue = () => overdueTasks(state, today());
// "qui, 5 de nov"
const dayShort = date => `${WEEK[weekday(date)].slice(0, 3).toLowerCase()}, ${Number(date.slice(8, 10))} de ${MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3)}`;
const byTime = list => [...list].sort((a, b) => (a.time ? 0 : 1) - (b.time ? 0 : 1) || (a.time || '').localeCompare(b.time || ''));
const doneCount = list => list.filter(t => t.done).length;
// Done tasks sink to the bottom of their group. A task just toggled keeps its old place
// for a beat, so the check registers before the row moves.
const settling = new Set();
let settleTimer;
const sunk = t => settling.has(t.id) ? !t.done : !!t.done;
const byDone = list => byTime(list).sort((a, b) => sunk(a) - sunk(b));
function settle(id) {
  settling.add(id);
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { settling.clear(); flip(render); }, 450);
}
function toggleTask(id) {
  settle(id);
  commitMany(taskDoneOps(state, state.tasks[id], !state.tasks[id].done));
}
// Checking the last step completes the task; it settles like a task checked by hand.
function toggleStep(taskId, stepId) {
  const task = state.tasks[taskId];
  if (!task) return;
  const ops = stepToggleOps(state, task, stepId);
  if (ops.some(op => op.collection === 'tasks')) settle(taskId);
  commitMany(ops);
}
// Which tasks show their steps, on this device.
const openSteps = new Set((() => { try { return JSON.parse(localStorage.getItem('notas-open-steps') || '[]'); } catch { return []; } })());
function showSteps(id, open = !openSteps.has(id)) {
  open ? openSteps.add(id) : openSteps.delete(id);
  try { localStorage.setItem('notas-open-steps', JSON.stringify([...openSteps].slice(-100))); } catch {}
  render();
}
// Opens the steps with the cursor in "Passo", for the first step or the next one.
function addStepField(id) {
  showSteps(id, true);
  $(`[data-add-step="${CSS.escape(id)}"] input`)?.focus();
}
function addStep(task, text) {
  const steps = taskSteps(state, task), order = steps.reduce((n, s) => Math.max(n, (s.order ?? 0) + 1), 0);
  // A new step means the task is not done yet.
  commitMany([{collection: 'steps', id: uid(), patch: {task: origin(task), text, done: false, order}}, ...(task.done ? [{collection: 'tasks', id: task.id, patch: {done: false}}] : [])]);
}
// Re-renders, then slides each task row from where it was to where it landed.
function flip(update) {
  const rows = () => $$('.page[data-name="root"] [data-row]');
  const before = new Map(rows().map(r => [r.dataset.row, r.getBoundingClientRect().top]));
  update();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  for (const r of rows()) {
    const dy = (before.get(r.dataset.row) ?? NaN) - r.getBoundingClientRect().top;
    if (dy) r.animate([{transform: `translateY(${dy}px)`, zIndex: 1}, {transform: 'none', zIndex: 1}], {duration: 420, easing: 'cubic-bezier(.2, .8, .2, 1)'});
  }
}
function lastSection() {
  const id = localStorage.getItem('notas-section');
  return state.sections[id] && !state.sections[id].deleted ? id : sections()[0]?.id;
}
const everyLabel = n => n === 1 ? 'todo mês' : n === 12 ? 'todo ano' : `a cada ${n} meses`;
const monthLabel = m => `${MONTHS[Number(m.slice(5, 7)) - 1]}${m.slice(0, 4) === today().slice(0, 4) ? '' : ` de ${m.slice(0, 4)}`}`;
function repeatKind(r) {
  if (!r) return 'none';
  if (r.monthDay > 0) return 'monthly';
  if (r.weeks > 1 && r.days) return 'biweekly';
  if (r.days === '0123456') return 'daily';
  if (r.days === '12345') return 'weekdays';
  return r.days ? 'custom' : 'none';
}
function repeatLabel(r) {
  const kind = repeatKind(r);
  if (kind === 'monthly') return `Todo mês, dia ${r.monthDay}`;
  if (kind === 'daily') return 'Todo dia';
  if (kind === 'weekdays') return 'Dias úteis';
  if (kind === 'biweekly') return `A cada ${r.weeks} semanas: ${[...r.days].map(d => WEEK[d].slice(0, 3).toLowerCase()).join(', ')}`;
  if (r.days.length === 1) return `${['0', '6'].includes(r.days) ? 'Todo' : 'Toda'} ${WEEK[r.days].toLowerCase()}`;
  return [...r.days].map(d => WEEK[d].slice(0, 3)).join(', ');
}
function nextOccurrence(r) {
  for (let i = 1; i <= 400; i++) { const d = addDays(today(), i); if (repeatsOn(r, d)) return d; }
  return null;
}

// ---------- Rendering ----------

function statusHtml() {
  if (needsLogin) return '<button class="n-status n-status-action" data-login>Entre para sincronizar</button>';
  if (online) return '';
  const pending = queue.length === 1 ? '1 alteração' : `${queue.length} alterações`;
  // The server answered and refused: retrying alone will not fix it, so say why.
  if (syncError) return `<p class="n-status">Não foi possível salvar: ${esc(syncError)}${queue.length ? ` ${pending} aguardando envio.` : ''}</p>`;
  return `<p class="n-status">${queue.length ? `Sem conexão. ${queue.length === 1 ? '1 alteração será enviada' : `${queue.length} alterações serão enviadas`} quando voltar.` : 'Sem conexão.'}</p>`;
}

// A late note (the day a task was planned for) takes the place of its time.
function taskRow(t, mode = 'edit', late = '') {
  const steps = taskSteps(state, t), k = doneCount(steps), n = steps.length;
  const count = n ? `<span class="n-meta">${k}/${n}</span>` : '';
  const meta = late ? `<span class="n-meta is-late">${esc(late)}</span>` : t.time || t.repeat ? `<span class="n-meta">${t.repeat ? ICONS.rep : ''}${esc(timeLabel(t))}</span>` : '';
  if (mode === 'pick') {
    const on = selected.has(t.id);
    return `<div class="n-row d-pick ${on ? 'is-selected' : ''} ${cursor === t.id ? 'is-cursor' : ''}" data-row="${t.id}" data-pick="${t.id}" draggable="true"><button class="n-check n-square" data-select="${t.id}" aria-pressed="${on}" aria-label="Selecionar ${esc(t.text)}">${ICONS.check}</button><span class="n-text">${esc(t.text)}</span>${meta}${count}</div>`;
  }
  if (mode === 'select') {
    const on = selected.has(t.id);
    return `<div class="n-row ${on ? 'is-selected' : ''}"><button class="n-check n-square" data-select="${t.id}" aria-pressed="${on}" aria-label="Selecionar ${esc(t.text)}">${ICONS.check}</button><button class="n-text" data-select="${t.id}">${esc(t.text)}</button>${count}</div>`;
  }
  // With steps, the circle fills as they get done and, while they are closed, the next one
  // shows under the name.
  const open = n > 0 && openSteps.has(t.id), next = !t.done && !open && steps.find(s => !s.done);
  const ring = n && !t.done ? ` n-ring" style="--p:${k / n}` : '';
  const text = next ? `<button class="n-text n-two" data-edit-task="${t.id}"><span>${esc(t.text)}</span><span class="n-meta n-next">${esc(next.text)}</span></button>` : `<button class="n-text" data-edit-task="${t.id}">${esc(t.text)}</button>`;
  const toggle = n ? `<button class="n-steps ${open ? 'is-open' : ''} ${k === n ? 'is-full' : ''}" data-steps="${t.id}" aria-expanded="${open}" aria-label="${open ? 'Ocultar' : 'Mostrar'} passos, ${k} de ${n} feitos">${k}/${n}${ICONS.next}</button>` : '';
  const row = `<div class="n-row ${t.done ? 'is-done' : ''} ${t.done && settling.has(t.id) ? 'is-settling' : ''} ${cursor === t.id ? 'is-cursor' : ''}" data-row="${t.id}"><button class="n-check${ring}" data-toggle="${t.id}" data-collection="tasks" aria-pressed="${!!t.done}" aria-label="${t.done ? 'Desmarcar' : 'Concluir'} ${esc(t.text)}">${ICONS.check}</button>${text}${meta}${toggle}</div>`;
  const list = open ? stepsList(t, steps) : '';
  if (mode === 'swipe') return `<div class="n-swipe" data-swipe="${t.id}"><span class="n-swipe-action" aria-hidden="true">Hoje</span>${row}</div>${list}`;
  return row + list;
}
const stepsList = (t, steps) => `<div class="n-passos" data-passos="${t.id}">${steps.map(s => `<div class="n-passo ${s.done ? 'is-done' : ''}"><button class="n-check" data-step="${s.id}" data-step-task="${t.id}" aria-pressed="${!!s.done}" aria-label="${s.done ? 'Desmarcar' : 'Concluir'} ${esc(s.text)}">${ICONS.check}</button><span class="n-text">${esc(s.text)}</span></div>`).join('')}<form class="n-passo n-passo-add" data-add-step="${t.id}">${ICONS.plus}<input name="entry" placeholder="Passo" autocomplete="off" autocapitalize="sentences" enterkeyhint="enter" maxlength="500" aria-label="Novo passo de ${esc(t.text)}"></form></div>`;

function sectionGroups(tasks, mode, count) {
  // In edit mode each group takes dropped tasks; empty sections only show up mid-drag.
  const drop = mode === 'edit';
  return sections().map(s => {
    const list = byDone(tasks.filter(t => t.section === s.id));
    if (!list.length) return drop ? `<section class="n-drop-only" data-drop-section="${s.id}"><div class="n-group-h"><h2>${dot(s.id)}${esc(s.name)}</h2></div><div class="n-list"><p class="n-drop-hint">Solte aqui</p></div></section>` : '';
    return `<section${drop ? ` data-drop-section="${s.id}"` : ''}><div class="n-group-h"><h2>${dot(s.id)}${esc(s.name)}</h2><span>${count(list)}</span></div><div class="n-list">${list.map(t => taskRow(t, mode)).join('')}</div></section>`;
  }).join('') + orphanGroup(tasks, mode, count);
}
// Tasks whose section no longer exists still need to be reachable.
function orphanGroup(tasks, mode, count) {
  const list = byDone(tasks.filter(t => !state.sections[t.section] || state.sections[t.section].deleted));
  return list.length ? `<section><div class="n-group-h"><h2>Sem seção</h2><span>${count(list)}</span></div><div class="n-list">${list.map(t => taskRow(t, mode)).join('')}</div></section>` : '';
}

function hojeBanner() {
  const pending = lastPending(state, today());
  return pending ? `<div class="n-banner"><p>${pending.tasks.length === 1 ? `1 tarefa ${fromDay(pending.date)} não foi feita.` : `${pending.tasks.length} tarefas ${fromDay(pending.date)} não foram feitas.`}</p><div class="n-btns"><button class="n-btn n-yellow" data-carry-last>Trazer para hoje</button><button class="n-btn n-gray" data-ignore-last>Ignorar</button></div></div>` : '';
}

// Hoje also pages to the days around it (hojeDate; null is today).
const hojeTasks = () => hojeDate ? dayTasks(hojeDate).filter(t => !(meetingsApart() && t.meeting)) : todayTasks();
// "Ontem", "Amanhã", "Quinta, 30" (with the month when it is another one)
function dayTitle(date) {
  if (date === addDays(today(), -1)) return 'Ontem';
  if (date === addDays(today(), 1)) return 'Amanhã';
  return `${WEEK[weekday(date)]}, ${Number(date.slice(8, 10))}${date.slice(0, 7) === today().slice(0, 7) ? '' : ` de ${MONTHS[Number(date.slice(5, 7)) - 1]}`}`;
}
const dayArrows = cls => `<button class="${cls}" data-shift-day="-1" aria-label="Dia anterior" title="Dia anterior (←)">${ICONS.prev}</button><button class="${cls}" data-shift-day="1" aria-label="Próximo dia" title="Próximo dia (→)">${ICONS.next}</button>`;
function newTaskOn(date) { taskSheet(date > today() ? {when: 'later', date} : {when: 'today'}); }

function viewOtherDay(date) {
  const tasks = hojeTasks(), ahead = date > today();
  const body = tasks.length
    ? sectionGroups(tasks, 'edit', list => ahead ? list.length : `${doneCount(list)} de ${list.length}`)
    : `<div class="n-empty"><p>${ahead ? 'Nada previsto para este dia.' : 'Nada neste dia.'}</p></div>`;
  const count = !tasks.length ? '' : ahead ? plural(tasks.length, 'prevista', 'previstas') : `${doneCount(tasks)} de ${tasks.length} feitas`;
  return `${statusHtml()}<div class="n-top"><button class="n-link" data-shift-day="0">Hoje</button><div class="n-top-end n-tight">${dayArrows('n-icon')}<button class="n-icon" data-open-history aria-label="Calendário">${ICONS.cal}</button></div></div>
    <h1 class="n-title">${dayTitle(date)}</h1><p class="n-sub">${longDate(date)}${count ? `<span class="n-sub-count">${count}</span>` : ''}</p>${body}`;
}

function viewHoje() {
  if (hojeDate) return viewOtherDay(hojeDate);
  const tasks = todayTasks(), banner = hojeBanner(), casa = hojeCasaGroup();
  const waiting = backlog().length;
  const body = tasks.length || casa
    ? sectionGroups(tasks, 'edit', list => `${doneCount(list)} de ${list.length}`) + casa
    : `<div class="n-empty"><p>Nada para hoje.</p><div class="n-btns"><button class="n-btn n-yellow" data-new-task>Nova tarefa</button>${waiting && tabPrefs(state).backlog ? `<button class="n-btn n-gray" data-tab="backlog">Ver backlog (${waiting})</button>` : ''}</div></div>`;
  // Ajustes is not in the tab bar: the avatar (or, with one person, the gear) is the way in.
  const avatar = me && people.length > 1 ? `<button class="n-avatar" data-tab="ajustes" style="background:${me.color}" aria-label="Conta de ${esc(me.name)}. Abrir Ajustes">${esc(me.name[0])}</button>` : `<button class="n-icon" data-tab="ajustes" aria-label="Ajustes">${ICONS.ajustes}</button>`;
  return `${statusHtml()}<div class="n-top">${avatar}<div class="n-top-end n-tight">${dayArrows('n-icon')}<button class="n-icon" data-open-history aria-label="Calendário">${ICONS.cal}</button></div></div>
    <h1 class="n-title">Hoje</h1><p class="n-sub">${longDate(today())}${tasks.length ? `<span class="n-sub-count">${doneCount(tasks)} de ${tasks.length} feitas</span>` : ''}</p>${banner}${body}`;
}

function viewReunioes() {
  const now = todayMeetings(), days = Array.from({length: 6}, (_, i) => addDays(today(), i + 1));
  const once = scheduled().filter(onAgenda), horizon = days.at(-1);
  const row = (item, date) => `<div class="n-row n-plain"><button class="n-text n-two" ${item.repeats ? `data-edit-repeat="${item.id}"` : `data-edit-task="${item.id}"`}><span>${esc(item.text)}</span><span class="n-meta">${date ? `<span class="n-accent">${dayShort(date)}</span> · ` : ''}${esc(sectionName(item.section))}</span></button>${item.time || item.repeats ? `<span class="n-meta">${item.repeats ? ICONS.rep : ''}${esc(timeLabel(item))}</span>` : ''}</div>`;
  const group = (title, rows, count) => `<section><div class="n-group-h"><h2>${title}</h2><span>${count}</span></div><div class="n-list">${rows}</div></section>`;
  const upcoming = days.map(date => {
    const list = [...live(state, 'repeats').filter(r => onAgenda(r) && repeatsOn(r, date)).map(r => ({...r, repeats: true})), ...once.filter(t => t.date === date)].sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    return list.length ? group(cap(nextDayLabel(date)), list.map(item => row(item)).join(''), list.length) : '';
  }).join('');
  const later = once.filter(t => t.date > horizon);
  const laterGroup = later.length ? group('Mais adiante', later.map(t => row(t, t.date)).join(''), later.length) : '';
  const today_ = now.length
    ? `<section><div class="n-group-h"><h2>Hoje</h2><span>${doneCount(now)} de ${now.length}</span></div><div class="n-list">${byDone(now).map(t => taskRow(t)).join('')}</div></section>`
    : '<div class="n-empty"><p>Nada na agenda hoje.</p></div>';
  return `${statusHtml()}<div class="n-top"><span></span></div><h1 class="n-title">Agenda</h1><p class="n-sub">${longDate(today())}</p>${today_}${upcoming}${laterGroup}`;
}

const agendadasGroup = waiting => waiting.length ? `<section><div class="n-group-h"><h2>Agendadas</h2><span>${waiting.length}</span></div><div class="n-list">${waiting.map(t => `<div class="n-row n-plain"><button class="n-text n-two" data-edit-task="${t.id}"><span>${esc(t.text)}</span><span class="n-meta"><span class="n-accent">${dayShort(t.date)}</span> · ${esc(sectionName(t.section))}</span></button>${t.time ? `<span class="n-meta">${esc(timeLabel(t))}</span>` : ''}</div>`).join('')}</div></section>` : '';

// Planned for a day that went by without them: they wait on top of the backlog until
// they are moved, done or deleted.
function overdueGroup(mode) {
  const list = overdue();
  return list.length ? `<section class="n-overdue"><div class="n-group-h"><h2>Ficaram para trás</h2><span>${list.length}</span></div><div class="n-list">${list.map(t => taskRow(t, mode, dayShort(t.date))).join('')}</div></section>` : '';
}

function viewBacklog() {
  const tasks = backlog(), waiting = selecting ? [] : scheduled().filter(t => !(meetingsApart() && t.meeting)), late = overdue().length;
  const agendadas = agendadasGroup(waiting);
  const head = selecting
    ? `<div class="n-top"><span></span><button class="n-link" data-select-mode>Cancelar</button></div><h1 class="n-title">Backlog</h1><p class="n-sub">${selected.size ? plural(selected.size, 'selecionada', 'selecionadas') : 'Toque nas tarefas para selecionar'}</p>`
    : `<div class="n-top"><span></span>${tasks.length || late ? '<button class="n-link" data-select-mode>Selecionar</button>' : ''}</div><h1 class="n-title">Backlog</h1>`;
  const body = tasks.length
    ? sectionGroups(tasks, selecting ? 'select' : 'swipe', list => list.length)
    : waiting.length || late ? '' : '<div class="n-empty"><p>Backlog vazio.</p><div class="n-btns"><button class="n-btn n-yellow" data-new-task>Nova tarefa</button></div></div>';
  return `${statusHtml()}${head}${overdueGroup(selecting ? 'select' : 'swipe')}${agendadas}${body}`;
}

function billsSegment() {
  return `<div class="n-seg">${[['mes', 'Neste mês'], ['agendadas', 'Agendadas'], ['todas', 'Todas']].map(([id, label]) => `<button class="n-seg-b ${billsView === id ? 'is-on' : ''}" data-bills-view="${id}" aria-pressed="${billsView === id}">${label}</button>`).join('')}</div>`;
}

const billActions = (b, catalog = false) => `<button class="n-bill-more" data-bill-actions="${esc(b.id)}" ${catalog ? 'data-catalog="true"' : ''} aria-label="Ações de ${esc(b.text)}">•••</button>`;
const catalogBill = id => billCatalog(state, today().slice(0, 7)).find(b => b.id === id);
// A stored bill or, in a future month, one the rollover has not created yet.
const findBill = (id, fromCatalog) => fromCatalog ? catalogBill(id) : state.bills[id] || virtualBill(state, id);
const billDate = b => b.due ? `${Number(billDueDate(b).slice(8, 10))} de ${MONTHS[Number(b.month.slice(5, 7)) - 1]} de ${b.month.slice(0, 4)}` : monthName(b.month);
const monthOf = month => MONTHS[Number(month.slice(5, 7)) - 1];
const billCalcLabel = b => b.calcMode === 'occurrence' ? `${plural(billIncludedDates(b).length, 'sessão', 'sessões')}${b.lag === 1 ? ` de ${monthOf(billSessionMonth(b))}` : ''} × ${money(b.unitAmount)}` : '';
const payWhen = b => billDate(b).replace(/ de \d{4}$/, '');
// A bill tied to a card: the card's name and, while unpaid, whether its amount can still change.
const cardLabel = b => {
  const card = linkedCard(state, b);
  if (!card) return '';
  return b.done || !b.cardStatus ? card.name : `${card.name} · ${b.cardStatus === 'open' ? 'fatura aberta, valor parcial' : 'fatura fechada'}`;
};
const cardMeta = b => cardLabel(b) ? `<span class="n-meta">${esc(cardLabel(b))}</span>` : '';
// Sessions held in `month` but paid in the next one. Kept out of the month's totals;
// in the current month, also how much the sessions so far add up to.
function accrualRows(month) {
  if (month < today().slice(0, 7)) return [];
  return accruingBills(state, month).map(b => {
    const dates = billIncludedDates(b), held = month === today().slice(0, 7) ? dates.filter(d => d <= today()).length : null;
    return {...b, held, progress: held === null ? plural(dates.length, 'sessão prevista', 'sessões previstas') : `${held} de ${plural(dates.length, 'sessão', 'sessões')} até hoje · ${money(held * b.unitAmount)}`};
  });
}
function allBillRows() {
  const list = billCatalog(state, today().slice(0, 7)).filter(b => itemKey(b.text).includes(itemKey(billSearch)) && (billFilter === 'all' || b.recurring === (billFilter === 'recurring')));
  return `<p class="n-note">${plural(list.length, 'conta', 'contas')} · sem limite de data</p>${list.length ? `<div class="n-list">${list.map(b => `<div class="n-row n-plain"><button class="n-text n-two" data-edit-bill="${esc(b.id)}" data-catalog="true"><span>${esc(b.text)}</span><span class="n-meta">${b.recurring ? everyLabel(billEvery(billRule(state, b))) : 'Não repete'}${b.calcMode === 'occurrence' ? ` · ${money(b.unitAmount)}/sessão${b.lag === 1 ? ' · paga no mês seguinte' : ''}` : ''}</span><span class="n-meta n-accent">${b.month < today().slice(0, 7) ? 'Pendente' : 'Próxima'}: ${billDate(b)}</span>${cardMeta(b)}</button><span class="n-amount">${money(b.amount)}</span>${billActions(b, true)}</div>`).join('')}</div>` : `<div class="n-empty"><p>${billSearch || billFilter !== 'all' ? 'Nenhuma conta encontrada.' : 'Nenhuma conta cadastrada.'}</p>${!billSearch && billFilter === 'all' ? '<button class="n-btn n-yellow" data-new-bill>Adicionar conta</button>' : ''}</div>`}`;
}
function viewAllBills() {
  return `${statusHtml()}<div class="n-top"><span></span><button class="n-icon" data-new-bill aria-label="Adicionar conta">${ICONS.plus}</button></div><h1 class="n-title">Contas</h1>${billsSegment()}${allBillsBody()}`;
}
function allBillsBody() {
  return `<input class="n-bill-search" type="search" aria-label="Buscar conta" placeholder="Buscar conta" value="${esc(billSearch)}" data-bill-search>
    <div class="n-bill-filters" aria-label="Filtrar contas">${[['all', 'Todas'], ['recurring', 'Recorrentes'], ['single', 'Avulsas']].map(([id, label]) => `<button class="n-chip-filter ${billFilter === id ? 'is-on' : ''}" data-bill-filter="${id}" aria-pressed="${billFilter === id}">${label}</button>`).join('')}</div><div id="all-bill-rows">${allBillRows()}</div>`;
}

// Next 12 months, projected from the bills that repeat; tap a month to see its bills.
function viewAgendadas() {
  return `${statusHtml()}<div class="n-top"><span></span></div><h1 class="n-title">Contas</h1>${billsSegment()}${agendadasBody()}`;
}
function agendadasBody() {
  const months = scheduledBills(state, addMonths(today().slice(0, 7), 1), 12);
  if (!repeatingBills(state).length) return `<div class="n-empty"><p>Nenhuma conta se repete.</p><p class="n-note">Ao criar uma conta, escolha Repetir.</p></div>`;
  const row = m => {
    const base = m.items.filter(i => i.every === 1), extra = m.items.filter(i => i.every !== 1), open = openMonths.has(m.month);
    const summary = m.items.length ? `${esc(base.map(i => i.text).join(', '))}${extra.map(i => ` <em>+ ${esc(i.text)}</em>`).join('')}` : 'Nada agendado';
    const detail = open ? `<div class="n-month-items">${m.items.map(i => `<div class="n-month-item"><span>${esc(i.text)}<small>${i.due ? `Dia ${i.due}` : 'Sem dia'}${i.every > 1 ? ` · <i class="n-every">${everyLabel(i.every)}</i>` : ''}${i.calcMode === 'occurrence' ? ` · ${billCalcLabel(i)}` : ''}</small></span><span class="n-amount">${money(i.amount)}</span></div>`).join('')}</div>` : '';
    return `<div class="n-month"><button class="n-month-head" data-open-month="${m.month}" aria-expanded="${open}"><span class="n-month-name">${monthName(m.month)}</span><span class="n-amount">${m.items.length ? money(m.total) : ''}</span><span class="n-month-sum">${summary}</span></button>${detail}</div>`;
  };
  return `<p class="n-sub">Projeção a partir das contas que se repetem.</p><div class="n-list n-spaced">${months.map(row).join('')}</div><p class="n-note">Toque num mês para ver as contas e os valores.</p>`;
}

// Bills of a month (monthBills, in model.js). In a future month, also what the repeating ones
// will create there; editing or deleting one stores that month ahead of time.
const billsOf = month => monthBills(state, month, today().slice(0, 7));
const plannedMeta = b => `${b.due ? `Dia ${b.due}` : 'Sem dia'}${b.every > 1 ? ` · <i class="n-every">${everyLabel(b.every)}</i>` : ''}${b.calcMode === 'occurrence' ? ` · ${billCalcLabel(b)}` : ''}${cardLabel(b) ? ` · ${esc(cardLabel(b))}` : ''}`;
const noBills = () => `<div class="n-empty"><p>Nenhuma conta em ${MONTHS[Number(billMonth.slice(5, 7)) - 1]}.</p><div class="n-btns"><button class="n-btn n-yellow" data-new-bill>Adicionar conta</button></div></div>`;

function viewContas() {
  if (billsView === 'todas') return viewAllBills();
  if (billsView === 'agendadas') return viewAgendadas();
  const current = today().slice(0, 7), prev = addMonths(billMonth, -1), next = addMonths(billMonth, 1);
  const {real: bills, projected} = billsOf(billMonth), accruing = accrualRows(billMonth);
  const sortDue = list => [...list].sort((a, b) => (a.due || 99) - (b.due || 99) || a.text.localeCompare(b.text));
  const unpaid = sortDue(bills.filter(b => !b.done)), paid = sortDue(bills.filter(b => b.done));
  const left = unpaid.reduce((n, b) => n + (b.amount || 0), 0);
  const accrual = accruing.length ? `<div class="n-group-h"><h2>Acumulando</h2></div><div class="n-list">${accruing.map(b => `<div class="n-row n-bill-row n-plain"><span class="n-text n-two"><span>${esc(b.text)}</span><span class="n-meta">${b.progress}</span><span class="n-meta n-accent">Vence em ${payWhen(b)}</span></span><span class="n-amount">${money(b.amount)}</span></div>`).join('')}</div><p class="n-note">Sessões de ${monthOf(billMonth)} pagas no mês seguinte. Não entram no total deste mês.</p>` : '';
  const nowDay = Number(today().slice(8, 10));
  // Due day (red when late) plus, for bills that are not monthly, how often they come back.
  const dueMeta = b => {
    const every = b.repeat !== false ? billEvery(b) : 1;
    const late = b.due && !b.done && (billMonth < current || (billMonth === current && b.due < nowDay));
    const due = b.due && !b.done ? `${late ? 'Venceu' : 'Vence'} dia ${b.due}` : '';
    if (!due && every === 1) return '';
    return `<span class="n-meta ${late ? 'is-late' : ''}">${due}${due && every > 1 ? ' · ' : ''}${every > 1 ? `<i class="n-every">${everyLabel(every)}</i>` : ''}</span>`;
  };
  const row = b => `<div class="n-row n-bill-row ${b.done ? 'is-done' : ''} ${payable(b) ? '' : 'n-plain'}">${payable(b) ? billCheck(b) : ''}<button class="n-text n-two" data-edit-bill="${esc(b.id)}"><span>${esc(b.text)}</span>${dueMeta(b)}${b.calcMode === 'occurrence' ? `<span class="n-meta">${billCalcLabel(b)}</span>` : ''}${cardMeta(b)}</button><span class="n-amount">${money(b.amount)}</span>${billActions(b)}</div>`;
  const top = `<div class="n-top"><button class="n-link" data-month="${prev}">‹ ${monthName(prev)}</button><span class="n-top-end"><button class="n-link" data-month="${next}">${monthName(next)} ›</button><button class="n-icon" data-new-bill aria-label="Adicionar conta">${ICONS.plus}</button></span></div>`;
  if (!bills.length && !projected.length && !accruing.length) return `${statusHtml()}${top}<h1 class="n-title">${monthName(billMonth)}</h1>${billsSegment()}${noBills()}`;
  if (billMonth > current) {
    const planned = b => `<div class="n-row n-bill-row ${payable(b) ? '' : 'n-plain'}">${payable(b) ? billCheck(b) : ''}<button class="n-text n-two" data-edit-bill="${esc(b.id)}"><span>${esc(b.text)}</span><span class="n-meta">${plannedMeta(b)}</span></button><span class="n-amount">${money(b.amount)}</span>${billActions(b)}</div>`;
    return `${statusHtml()}${top}<h1 class="n-title">${monthName(billMonth)}</h1>${billsSegment()}
    <div class="n-total"><span>Previsto</span><strong>${money(left + projected.reduce((n, b) => n + b.amount, 0))}</strong></div>
    ${unpaid.length ? `<div class="n-group-h"><h2>A pagar</h2></div><div class="n-list">${unpaid.map(row).join('')}</div>` : ''}
    ${projected.length ? `<div class="n-group-h"><h2>Previstas</h2></div><div class="n-list">${projected.map(planned).join('')}</div><p class="n-note">Contas que se repetem entram aqui quando ${MONTHS[Number(billMonth.slice(5, 7)) - 1]} chegar. Já dá para marcar como paga${[...unpaid, ...projected].some(b => !payable(b)) ? ', menos as cobradas por sessão' : ''}. Toque numa para ajustar ou excluir.</p>` : ''}
    ${accrual}
    ${paid.length ? `<div class="n-group-h"><h2>Pagas</h2></div><div class="n-list">${paid.map(row).join('')}</div>` : ''}`;
  }
  return `${statusHtml()}${top}<h1 class="n-title">${monthName(billMonth)}</h1>${billsSegment()}
    ${bills.length ? `<div class="n-total"><span>${left ? 'Falta pagar' : 'Tudo pago'}</span><strong>${money(left)}</strong></div>
    <div class="n-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${bills.length}" aria-valuenow="${paid.length}"><span style="width:${paid.length / bills.length * 100}%"></span></div>
    <p class="n-bar-label">${paid.length} de ${bills.length} pagas</p>` : ''}
    ${unpaid.length ? `<div class="n-group-h"><h2>A pagar</h2></div><div class="n-list">${unpaid.map(row).join('')}</div>` : ''}
    ${accrual}
    ${paid.length ? `<div class="n-group-h"><h2>Pagas</h2></div><div class="n-list">${paid.map(row).join('')}</div>` : ''}`;
}

// Paid or not. A bill still projected in a future month is stored as paid; one charged per
// session only once its month comes (billPayable).
function toggleBill(id) {
  const stored = state.bills[id];
  if (stored?.done) return commit('bills', id, {done: false});
  const bill = stored || virtualBill(state, id);
  if (!bill) return;
  if (!billPayable(bill, today().slice(0, 7))) return toast(`${bill.text} é cobrada por sessão: dá para pagar quando ${monthOf(bill.month)} chegar.`);
  commitMany(payBillOps(state, bill, today().slice(0, 7)));
}
const payable = b => b.done || billPayable(b, today().slice(0, 7));
const billCheck = b => `<button class="n-check" data-toggle="${esc(b.id)}" data-collection="bills" aria-pressed="${!!b.done}" aria-label="${b.done ? 'Desmarcar' : 'Marcar como paga'} ${esc(b.text)}">${ICONS.check}</button>`;

// Into the cart = bought now (the server keeps the time and who); out of it again clears that.
const toggleCart = id => commit('shopping', id, state.shopping[id].done ? {done: false, bought: 0} : {done: true, bought: Date.now()});

function shoppingParts() {
  const items = listed(state);
  const toBuy = items.filter(i => !i.done).sort((a, b) => (b.added || 0) - (a.added || 0));
  const inCart = items.filter(i => i.done).sort((a, b) => a.text.localeCompare(b.text, 'pt-BR'));
  const color = id => people.find(p => p.id === id)?.color || 'var(--secondary)';
  const row = i => `<div class="n-row ${i.done ? 'is-done' : ''}" style="--who:${color(i.by)}" data-item-row="${esc(i.id)}"><button class="n-check n-who" data-toggle="${esc(i.id)}" data-collection="shopping" aria-pressed="${!!i.done}" aria-label="${i.done ? 'Tirar do carrinho' : 'Pôr no carrinho'}: ${esc(i.text)}">${ICONS.check}</button><button class="n-text" data-edit-item="${esc(i.id)}">${esc(i.text)}</button></div>`;
  const legend = people.length > 1 ? `<p class="n-legend">${people.map(p => `<span><i style="background:${p.color}"></i>${esc(p.name)}</span>`).join('')}</p>` : '';
  const form = `<form class="n-add" id="add-item"><input name="entry" placeholder="Adicionar item" autocomplete="off" autocapitalize="sentences" enterkeyhint="enter" maxlength="200" aria-label="Adicionar item"><button class="n-icon" data-keep-focus aria-label="Adicionar">${ICONS.plus}</button></form>`;
  return {toBuy, inCart, row, legend, form};
}

function viewCompras(back = '') {
  const {toBuy, inCart, row, legend, form} = shoppingParts();
  return `${statusHtml()}<div class="n-top">${back}</div><h1 class="n-title">Compras</h1>${legend}
    ${form}
    ${toBuy.length ? `<div class="n-list n-spaced">${toBuy.map(row).join('')}</div>` : inCart.length ? '' : '<p class="n-note n-spaced">Lista vazia.</p>'}
    ${inCart.length ? `<div class="n-group-h"><h2>No carrinho</h2><button class="n-link" data-clear-cart>Limpar</button></div><div class="n-list">${inCart.map(row).join('')}</div>` : ''}`;
}

function addItem(raw) {
  const text = raw.trim().replace(/\s+/g, ' '), key = itemKey(text);
  if (!key) return;
  const same = listed(state).find(i => itemKey(i.text) === key);
  if (same && !same.done) { toast(`${same.text} já está na lista.`); return; }
  // In the cart already, or removed earlier: put it back on the list.
  const id = same ? same.id : itemId(text);
  commit('shopping', id, {...(same ? {} : {text}), done: false, listed: true, added: Date.now(), by: me?.id || ''});
}

function itemSheet(id) {
  const item = state.shopping[id];
  if (!item) return;
  openSheet(`<form class="n-form" id="item-form">${sheetTop('Editar item')}
    <input name="text" required maxlength="200" aria-label="Item" value="${esc(item.text)}">
    <div class="n-sheet-actions"><button type="button" class="n-btn n-gray n-danger" data-remove-item>Remover da lista</button></div>
  </form>`, () => {
    const form = $('#item-form');
    form.onsubmit = e => {
      e.preventDefault();
      const text = form.elements.text.value.trim().replace(/\s+/g, ' ');
      if (text) commit('shopping', id, {text});
      closeSheet();
    };
    $('[data-remove-item]', form).addEventListener('click', () => { commit('shopping', id, {listed: false, done: false}); closeSheet(); });
  });
}


// ---------- Casa ----------
// Shared by everyone in APP_USERS: Compras plus lists of chores and pinned notes. A chore
// says who does it (`who`, '' for anyone) and maybe a day; the ones for you show in your Hoje.

const meId = () => me?.id || '';
const shared = () => people.length > 1;
const person = id => people.find(p => p.id === id);
const personColor = id => person(id)?.color || 'var(--secondary)';
const personName = id => id === meId() ? 'Você' : person(id)?.name || '';
const others = () => people.filter(p => p.id !== meId());
const listName = id => id === 'compras' ? 'Compras' : state.lists[id]?.name || '';
const doneToday = c => !!c.doneAt && dayKey(new Date(c.doneAt)) === today();
const hojeChores = () => choresForToday(state, meId(), today(), doneToday);
// "Pra você": what someone else asked you to do.
const forYou = () => liveChores(state).filter(c => !c.done && c.who === meId() && c.by && c.by !== meId())
  .sort((a, b) => (a.date || '9999').localeCompare(b.date || '9999') || (a.added || 0) - (b.added || 0));
const casaSeen = () => state.prefs?.casa?.seen || 0;

// What the others did in Casa, newest first: added, asked, checked, edited.
function casaNews(days = 7) {
  const since = Date.now() - days * 864e5, mine = meId(), events = [];
  for (const c of liveChores(state)) {
    if (c.by && c.by !== mine && c.added > since) events.push({at: c.added, who: c.by, text: c.who === mine ? `pediu <b>${esc(c.text)}</b> pra você` : `adicionou <b>${esc(c.text)}</b>`, where: listName(c.list), fresh: true});
    if (c.done && c.doneBy && c.doneBy !== mine && c.doneAt > since) events.push({at: c.doneAt, who: c.doneBy, text: `fez <b>${esc(c.text)}</b>`, where: listName(c.list)});
  }
  for (const i of listed(state)) {
    if (i.by && i.by !== mine && i.added > since && !i.done) events.push({at: i.added, who: i.by, text: `pôs <b>${esc(i.text)}</b>`, where: 'Compras', fresh: true});
    if (i.done && i.boughtBy && i.boughtBy !== mine && i.bought > since) events.push({at: i.bought, who: i.boughtBy, text: `pegou <b>${esc(i.text)}</b>`, where: 'Compras'});
  }
  for (const n of live(state, 'notes')) if (n.editedBy && n.editedBy !== mine && n.edited > since) events.push({at: n.edited, who: n.editedBy, text: `editou <b>${esc(n.title || 'uma nota')}</b>`, where: 'Notas fixas', fresh: true});
  return events.sort((a, b) => b.at - a.at);
}
// The dot on the Casa tab: someone else added or asked something since you last opened it.
const casaUnseen = () => shared() && casaNews(30).some(e => e.fresh && e.at > casaSeen());
let seenPending = false;
function markCasaSeen() {
  if (seenPending || !casaUnseen()) return;
  seenPending = true;
  setTimeout(() => { seenPending = false; if (tab === 'compras' && casaUnseen()) commit('prefs', 'casa', {seen: Date.now()}); });
}

function whenAgo(ms) {
  const min = Math.round((Date.now() - ms) / 60000);
  if (min < 1) return 'agora';
  if (min < 60) return `há ${min} min`;
  const date = dayKey(new Date(ms));
  if (date === today()) return `há ${Math.round(min / 60)} h`;
  if (date === addDays(today(), -1)) return 'ontem';
  return dayShort(date).replace(/^\S+ /, '');
}
// "Hoje", "Amanhã", "Qui" this week, "5 de dez" further away or in the past ("Ontem").
function choreDay(date) {
  if (date === today()) return 'Hoje';
  if (date === addDays(today(), 1)) return 'Amanhã';
  if (date === addDays(today(), -1)) return 'Ontem';
  if (date > today() && date <= addDays(today(), 6)) return WEEK[weekday(date)].slice(0, 3);
  return `${Number(date.slice(8, 10))} de ${MONTHS[Number(date.slice(5, 7)) - 1].slice(0, 3)}`;
}
// A small disc with the initial of whoever does it; half and half when anyone can.
function whoDisc(who) {
  if (!shared()) return '';
  if (!who) return `<i class="c-who c-any" title="Qualquer um" aria-label="Qualquer um"></i>`;
  const p = person(who);
  return p ? `<i class="c-who" style="background:${p.color}" title="${esc(personName(who))}" aria-label="${esc(who === meId() ? 'Você faz' : `${p.name} faz`)}">${esc(p.name[0])}</i>` : '';
}

// `showToday`: the "Hoje" chip, left out where the group already says it is today.
function choreRow(c, {showList = false, showToday = true} = {}) {
  // "Bia pediu" only on what someone asked you; the circle's color already says who added it.
  const asked = shared() && c.who === meId() && c.by && c.by !== meId() && !c.done ? `${personName(c.by)} pediu` : '';
  const did = c.done && c.doneBy ? `${c.doneBy === meId() ? 'Você fez' : `${personName(c.doneBy)} fez`} ${whenAgo(c.doneAt)}` : '';
  const sub = [showList && listName(c.list), did || asked].filter(Boolean).join(' · ');
  const late = c.date && c.date < today() && !c.done;
  const day = c.date && !c.done && (showToday || c.date !== today()) ? `<span class="c-day ${late ? 'is-late' : c.date === today() ? 'is-today' : ''}">${c.cycle ? ICONS.rep : ''}${choreDay(c.date)}</span>` : '';
  return `<div class="n-row ${c.done ? 'is-done' : ''} ${c.done && settling.has(c.id) ? 'is-settling' : ''}" style="--who:${personColor(c.by)}" data-chore-row="${esc(c.id)}"><button class="n-check n-who" data-toggle="${esc(c.id)}" data-collection="chores" aria-pressed="${!!c.done}" aria-label="${c.done ? 'Desmarcar' : 'Concluir'} ${esc(c.text)}">${ICONS.check}</button><button class="n-text ${sub ? 'n-two' : ''}" data-edit-chore="${esc(c.id)}"><span>${esc(c.text)}</span>${sub ? `<span class="n-meta">${esc(sub)}</span>` : ''}</button>${day}${whoDisc(c.who)}</div>`;
}

// Checking a cycling chore schedules the next one; unchecking it takes that one back.
function toggleChore(id) {
  const c = state.chores[id];
  if (!c) return;
  settling.add(id);
  const ops = [];
  if (!c.done) {
    const next = c.cycle && c.date && !(c.next && state.chores[c.next] && !state.chores[c.next].deleted) ? nextCycleDate(c.date, c.cycle, today()) : '';
    const nextId = next ? uid() : '';
    ops.push({collection: 'chores', id, patch: {done: true, ...(nextId ? {next: nextId} : {})}});
    if (nextId) ops.push({collection: 'chores', id: nextId, patch: {text: c.text, list: c.list, who: c.who || '', date: next, cycle: c.cycle, done: false, added: Date.now()}});
  } else {
    ops.push({collection: 'chores', id, patch: {done: false, next: ''}});
    const next = c.next && state.chores[c.next];
    if (next && !next.done && !next.deleted) ops.push({collection: 'chores', id: next.id, patch: {deleted: true}});
  }
  commitMany(ops);
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { settling.clear(); render(); }, 450);
}

// Groups of a list by when: late, today, this week, later, someday; done at the end.
function choreGroups(list, filter = () => true) {
  const items = liveChores(state, list).filter(filter), t = today(), week = addDays(t, 6);
  const open = items.filter(c => !c.done || settling.has(c.id)), done = items.filter(c => c.done && !settling.has(c.id)).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const byDate = (a, b) => (a.date || '').localeCompare(b.date || '') || (a.added || 0) - (b.added || 0);
  const groups = [['Atrasadas', c => c.date && c.date < t], ['Hoje', c => c.date === t], ['Esta semana', c => c.date > t && c.date <= week], ['Mais adiante', c => c.date > week], ['Quando der', c => !c.date]]
    .map(([title, test]) => [title, open.filter(test).sort(byDate)]).filter(([, rows]) => rows.length);
  return {groups, done, open};
}
const choreFilter = () => casaFilter === 'mine' ? c => c.who === meId() || c.who === '' : casaFilter === 'others' ? c => c.who && c.who !== meId() : () => true;
let casaView = null, casaFilter = 'all';

function choreListBody(list) {
  const {groups, done, open} = choreGroups(list, choreFilter());
  const filters = shared() ? `<div class="n-seg c-filter">${[['all', 'Todos'], ['mine', 'Meus'], ['others', others().length === 1 ? others()[0].name : 'Outros']].map(([id, label]) => `<button class="n-seg-b ${casaFilter === id ? 'is-on' : ''}" data-casa-filter="${id}" aria-pressed="${casaFilter === id}">${esc(label)}</button>`).join('')}</div>` : '';
  const example = shared() ? ` Ex.: Trocar o filtro @${itemKey(others()[0].name).split(' ')[0]} sáb` : ' Ex.: Trocar o filtro sáb';
  const form = `<form class="n-add" id="add-chore" data-list="${esc(list)}"><input name="entry" placeholder="Adicionar" autocomplete="off" autocapitalize="sentences" enterkeyhint="enter" maxlength="10000" aria-label="Adicionar em ${esc(listName(list))}" aria-describedby="chore-hint"><button class="n-icon" data-keep-focus aria-label="Adicionar">${ICONS.plus}</button></form><p class="n-note" id="chore-hint">${shared() ? '@nome diz quem faz; ' : ''}dia no fim: hoje, amanhã, sáb, 20/12.${example}</p>`;
  const body = groups.map(([title, rows]) => `<section><div class="n-group-h"><h2>${title}</h2><span>${rows.length}</span></div><div class="n-list">${rows.map(c => choreRow(c, {showToday: title !== 'Hoje'})).join('')}</div></section>`).join('');
  const doneHtml = done.length ? `<section><div class="n-group-h"><h2>Feitas</h2><button class="n-link" data-clear-done="${esc(list)}">Limpar</button></div><div class="n-list">${done.slice(0, 20).map(c => choreRow(c)).join('')}</div></section>` : '';
  const empty = !open.length && !done.length ? `<p class="n-note n-spaced">${casaFilter === 'all' ? 'Nada nesta lista.' : 'Nada com este filtro.'}</p>` : '';
  return {html: `${filters}${form}${body}${doneHtml}${empty}`, count: open.filter(c => !c.done).length};
}

function casaTiles() {
  const toBuy = listed(state).filter(i => !i.done);
  const tile = (id, name, color, count, sub) => `<button class="c-tile" data-casa-open="${esc(id)}"><span class="c-tile-ic" style="background:${color}">${id === 'compras' ? ICONS.compras : ICONS.check}</span><span class="c-tile-nm"><span>${esc(name)}</span><em>${count || ''}</em></span><small>${sub}</small></button>`;
  const tiles = [tile('compras', 'Compras', 'var(--yellow)', toBuy.length, toBuy.length ? esc(toBuy.slice(0, 3).map(i => i.text).join(', ')) : 'Lista vazia')];
  casaLists().forEach((l, i) => {
    const open = liveChores(state, l.id).filter(c => !c.done), late = open.filter(c => c.date && c.date < today()).length;
    tiles.push(tile(l.id, l.name, LIST_COLORS[i % LIST_COLORS.length], open.length, late ? `<span class="is-late">${plural(late, 'atrasada', 'atrasadas')}</span>` : open.length ? esc(open.slice(0, 2).map(c => c.text).join(', ')) : 'Nada pendente'));
  });
  tiles.push('<button class="c-tile c-tile-new" data-new-list><span class="c-tile-ic">+</span><span class="c-tile-nm"><span>Nova lista</span></span><small>Viagem, presentes…</small></button>');
  return `<div class="c-tiles">${tiles.join('')}</div>`;
}
const LIST_COLORS = ['#30d158', '#64d2ff', '#bf5af2', '#ff9f0a', '#ff375f', '#5e5ce6', '#ac8e68'];
const casaLists = () => liveLists(state);
const listColor = id => { const i = casaLists().findIndex(l => l.id === id); return id === 'compras' ? 'var(--yellow)' : i < 0 ? '#8e8e93' : LIST_COLORS[i % LIST_COLORS.length]; };

function notesGroup() {
  const notes = live(state, 'notes').filter(n => n.title || n.body).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.added || 0) - (b.added || 0));
  const rows = notes.map(n => `<div class="n-row n-plain"><button class="n-text n-two" data-edit-note="${esc(n.id)}"><span>${esc(n.title || n.body.split('\n')[0])}</span>${n.body && n.title ? `<span class="n-meta c-note-body">${esc(memoSnippet(n, 200))}</span>` : ''}</button></div>`).join('');
  return `<section><div class="n-group-h"><h2>Notas fixas</h2><span>${notes.length || ''}</span></div><div class="n-list">${rows}<div class="n-row n-plain"><button class="n-text n-accent" data-new-note>Nova nota</button></div></div></section>`;
}

function forYouGroup() {
  const mine = forYou();
  return mine.length ? `<section class="c-foryou"><div class="n-group-h"><h2>Pra você</h2><span>${mine.length}</span></div><div class="n-list">${mine.map(c => choreRow(c, {showList: true})).join('')}</div></section>` : '';
}

const casaNames = () => { const names = people.map(p => p.name); return names.length < 2 ? 'Listas e notas' : `${names.slice(0, -1).join(', ')} e ${names.at(-1)}`; };

function viewCasa() {
  markCasaSeen();
  return `${statusHtml()}<div class="n-top"><span></span><button class="n-icon" data-new-chore aria-label="Novo afazer">${ICONS.plus}</button></div>
    <h1 class="n-title">Casa</h1><p class="n-sub">${esc(casaNames())}</p>
    ${forYouGroup()}
    <div class="n-group-h"><h2>Listas</h2></div>${casaTiles()}
    ${notesGroup()}`;
}

// A Casa list (or Compras) as a page over the Casa tab.
function pageCasa() {
  const id = casaView;
  const back = '<button class="n-link n-back" data-back>' + ICONS.prev + 'Casa</button>';
  if (id === 'compras') return {html: viewCompras(back), action: ''};
  if (!state.lists[id] || state.lists[id].deleted) return {html: `<div class="n-top">${back}</div><div class="n-empty"><p>Esta lista foi excluída.</p></div>`, action: ''};
  const {html, count} = choreListBody(id);
  return {html: `${statusHtml()}<div class="n-top">${back}<button class="n-icon" data-edit-list="${esc(id)}" aria-label="Renomear ou excluir a lista">${ICONS.more}</button></div><h1 class="n-title">${esc(listName(id))}</h1><p class="n-sub">${count ? plural(count, 'pendente', 'pendentes') : 'Nada pendente'}</p>${html}`, action: ''};
}

function openCasa(id) {
  casaView = id;
  if (desktop()) { if (tab !== 'compras') { tab = 'compras'; selecting = false; selected.clear(); cursor = null; } if (navigation.current !== 'root') navigation.back(); render(); return; }
  navigation.push('casa');
}

function addChore(raw, list) {
  const parsed = parseChore(raw, people, meId(), today());
  if (!parsed.text) return;
  commit('chores', uid(), {text: parsed.text, list, who: parsed.who ?? '', date: parsed.date || '', cycle: '', done: false, added: Date.now()});
  const bits = [parsed.who !== undefined && shared() ? (parsed.who ? (parsed.who === meId() ? 'pra você' : `pra ${personName(parsed.who)}`) : 'pra qualquer um') : '', parsed.date ? choreDay(parsed.date).toLowerCase() : ''].filter(Boolean);
  if (bits.length) toast(`Adicionado ${bits.join(', ')}.`);
}

function choreSheet({id, list} = {}) {
  const c = id ? state.chores[id] : null;
  const lists = casaLists();
  if (!lists.length) { toast('Crie uma lista primeiro.'); return; }
  const listId = c?.list || (list && state.lists[list] && !state.lists[list].deleted ? list : lists[0].id);
  const who = c ? c.who || '' : '';
  const date = c?.date || '';
  const when = !date ? 'none' : date === today() ? 'today' : date === addDays(today(), 1) ? 'tomorrow' : 'day';
  const whoOptions = [...people.map(p => [p.id, p.id === meId() ? 'Eu' : p.name, p.color]), ['', 'Qualquer um', '']];
  openSheet(`<form class="n-form" id="chore-form">${sheetTop(c ? 'Editar' : 'Novo na Casa')}
    <textarea name="text" rows="1" required maxlength="10000" placeholder="O que fazer" aria-label="O que fazer" ${c ? '' : 'autofocus'}>${esc(c?.text || '')}</textarea>
    ${lists.length > 1 ? `<fieldset class="n-fieldset"><legend>Lista</legend><div class="n-chips">${lists.map(l => `<label class="n-chip"><input type="radio" name="list" value="${esc(l.id)}" ${l.id === listId ? 'checked' : ''}><span>${esc(l.name)}</span></label>`).join('')}</div></fieldset>` : `<input type="hidden" name="list" value="${esc(listId)}">`}
    ${shared() ? `<fieldset class="n-fieldset"><legend>Quem faz</legend><div class="n-seg">${whoOptions.map(([v, l, color]) => `<label><input type="radio" name="who" value="${esc(v)}" ${v === who ? 'checked' : ''}><span>${color ? `<i class="c-who" style="background:${color}">${esc(l === 'Eu' ? me.name[0] : l[0])}</i>` : '<i class="c-who c-any"></i>'}${esc(l)}</span></label>`).join('')}</div></fieldset>` : '<input type="hidden" name="who" value="">'}
    <fieldset class="n-fieldset"><legend>Quando</legend><div class="n-seg">${[['none', 'Sem dia'], ['today', 'Hoje'], ['tomorrow', 'Amanhã'], ['day', 'Outro dia']].map(([v, l]) => `<label><input type="radio" name="when" value="${v}" ${v === when ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div></fieldset>
    <div class="n-opts" data-dated>
      <label class="n-opt" data-day-only>Data<input type="date" name="date" value="${when === 'day' ? date : addDays(today(), 2)}"></label>
      <label class="n-opt">Repetir<select name="cycle"><option value="">Não repete</option>${Object.entries(CYCLES).map(([v, l]) => `<option value="${v}" ${c?.cycle === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    </div>
    ${c && c.by ? `<p class="n-note">${shared() ? `${c.by === meId() ? 'Você adicionou' : `${esc(personName(c.by))} adicionou`} ${whenAgo(c.added || 0)}.` : ''}${c.done && c.doneBy ? ` ${c.doneBy === meId() ? 'Você fez' : `${esc(personName(c.doneBy))} fez`} ${whenAgo(c.doneAt)}.` : ''}</p>` : ''}
    ${c ? '<div class="n-sheet-actions"><button type="button" class="n-btn n-gray n-danger" data-delete-chore>Excluir</button></div>' : ''}
  </form>`, () => {
    const form = $('#chore-form'), text = form.elements.text;
    autosize(text); text.addEventListener('input', () => autosize(text));
    const update = () => {
      const w = form.elements.when.value;
      $('[data-dated]', form).hidden = w === 'none';
      $('[data-day-only]', form).hidden = w !== 'day';
    };
    form.addEventListener('change', e => { if (e.target.name === 'when') update(); });
    update();
    form.onsubmit = e => {
      e.preventDefault();
      const value = text.value.trim();
      if (!value) return;
      const w = form.elements.when.value;
      const day = w === 'none' ? '' : w === 'today' ? today() : w === 'tomorrow' ? addDays(today(), 1) : form.elements.date.value;
      if (w === 'day' && !day) { form.elements.date.focus(); return; }
      const patch = {text: value, list: form.elements.list.value, who: form.elements.who.value, date: day, cycle: day ? form.elements.cycle.value : ''};
      if (c) commit('chores', id, patch); else commit('chores', uid(), {...patch, done: false, added: Date.now()});
      closeSheet();
    };
    $('[data-delete-chore]', form)?.addEventListener('click', () => {
      deleteChores([id]);
      closeSheet();
    });
  });
}

// Who added it and who did it are the server's to stamp; a copy keeps the rest.
function deleteChores(ids) {
  const copies = ids.map(id => state.chores[id]).filter(c => c && !c.deleted).map(({text, list, who, date, cycle, done, added}) => ({text, list, who: who || '', date: date || '', cycle: cycle || '', done: !!done, ...(added ? {added} : {})}));
  if (!copies.length) return;
  commitMany(ids.map(id => ({collection: 'chores', id, patch: {deleted: true}})));
  toast(copies.length === 1 ? 'Excluído.' : `${copies.length} excluídos.`, () => {
    commitMany(copies.map(patch => ({collection: 'chores', id: uid(), patch})));
    toast('Exclusão desfeita.');
  });
}

function listSheet(id) {
  const l = id ? state.lists[id] : null;
  const count = id ? liveChores(state, id).length : 0;
  openSheet(`<form class="n-form" id="list-form">${sheetTop(l ? 'Lista' : 'Nova lista', l ? 'Salvar' : 'Criar')}
    <input name="name" required maxlength="60" placeholder="Nome (ex.: Viagem, Presentes)" aria-label="Nome da lista" value="${esc(l?.name || '')}" ${l ? '' : 'autofocus'}>
    ${l ? `<div class="n-sheet-actions"><button type="button" class="n-btn n-gray n-danger" data-delete-list>Excluir lista${count ? ` e ${plural(count, 'item', 'itens')}` : ''}</button></div>` : ''}
  </form>`, () => {
    const form = $('#list-form');
    form.onsubmit = e => {
      e.preventDefault();
      const name = form.elements.name.value.trim().replace(/\s+/g, ' ');
      if (!name) return;
      if (l) commit('lists', id, {name});
      else { const newId = uid(); commit('lists', newId, {name, order: Math.max(0, ...casaLists().map(x => x.order ?? 0)) + 1}); closeSheet(); openCasa(newId); return; }
      closeSheet();
    };
    $('[data-delete-list]', form)?.addEventListener('click', () => {
      if (!confirm(`Excluir a lista ${l.name}${count ? ` e ${plural(count, 'item', 'itens')}` : ''} para todos?`)) return;
      const chores = liveChores(state, id).map(c => c.id);
      commitMany([{collection: 'lists', id, patch: {deleted: true}}, ...chores.map(cid => ({collection: 'chores', id: cid, patch: {deleted: true}}))]);
      closeSheet();
      if (desktop()) { casaView = null; render(); } else navigation.back();
    });
  });
}

// An existing note opens to be read, with its Markdown rendered like in the Notas tab; Editar
// brings the form.
function noteSheet(id, editing = !id) {
  const n = id ? state.notes[id] : null;
  if (n && !n.deleted && !editing) {
    openSheet(`<div class="n-form"><div class="n-sheet-top"><button type="button" class="n-link" data-close>Fechar</button><h2 id="sheet-title">Nota fixa</h2><button type="button" class="n-link n-ok" data-note-edit>Editar</button></div>
      ${n.title ? `<h3 class="m-h">${esc(n.title)}</h3>` : ''}${n.body ? `<div class="n-md" data-md-body="notes:${esc(id)}">${renderMarkdown(n.body)}</div>` : ''}
      ${n.editedBy && shared() ? `<p class="n-note">${n.editedBy === meId() ? 'Você editou' : `${esc(personName(n.editedBy))} editou`} ${whenAgo(n.edited)}.</p>` : ''}</div>`, () => { $('[data-note-edit]').onclick = () => noteSheet(id, true); });
    return;
  }
  openSheet(`<form class="n-form" id="note-form">${sheetTop(n ? 'Nota fixa' : 'Nova nota fixa')}
    <input name="title" maxlength="200" placeholder="Título (ex.: Wi-Fi)" aria-label="Título" value="${esc(n?.title || '')}" ${n ? '' : 'autofocus'}>
    <textarea name="body" rows="4" maxlength="10000" placeholder="Texto" aria-label="Texto">${esc(n?.body || '')}</textarea>
    ${n?.editedBy && shared() ? `<p class="n-note">${n.editedBy === meId() ? 'Você editou' : `${esc(personName(n.editedBy))} editou`} ${whenAgo(n.edited)}.</p>` : ''}
    ${n ? '<div class="n-sheet-actions"><button type="button" class="n-btn n-gray n-danger" data-delete-note>Excluir nota</button></div>' : ''}
  </form>`, () => {
    const form = $('#note-form'), body = form.elements.body;
    autosize(body); body.addEventListener('input', () => autosize(body));
    form.onsubmit = e => {
      e.preventDefault();
      const title = form.elements.title.value.trim(), text = body.value.replace(/\s+$/, '');
      if (!title && !text.trim()) { closeSheet(); return; }
      if (n) { if (title !== (n.title || '') || text !== (n.body || '')) commit('notes', id, {title, body: text}); }
      else commit('notes', uid(), {title, body: text, order: Date.now() % 1e9, added: Date.now()});
      closeSheet();
    };
    $('[data-delete-note]', form)?.addEventListener('click', () => {
      commit('notes', id, {deleted: true});
      closeSheet();
      // Deleted records stay deleted; undoing brings back a copy.
      const {title, body: text, order} = n;
      toast('Nota excluída.', () => { commit('notes', uid(), {title: title || '', body: text || '', order: order ?? 0, added: Date.now()}); toast('Exclusão desfeita.'); });
    });
  });
}

// The Casa section of Hoje: chores for you (or anyone) due today or late, and the ones checked today.
function hojeCasaGroup() {
  if (!tabPrefs(state).compras) return '';
  const list = hojeChores().sort((a, b) => (settling.has(a.id) ? !a.done : !!a.done) - (settling.has(b.id) ? !b.done : !!b.done) || (a.date || '').localeCompare(b.date || ''));
  if (!list.length) return '';
  return `<section><div class="n-group-h"><h2><span class="c-house">${ICONS.casa}</span>Casa</h2><span>${doneCount(list)} de ${list.length}</span></div><div class="n-list">${list.map(c => choreRow(c, {showList: true, showToday: false})).join('')}</div></section>`;
}

// ---------- Casa on the computer ----------

function casaSidebar() {
  if (!tabPrefs(state).compras) return '';
  const on = id => tab === 'compras' && casaView === id ? 'is-on' : '';
  const toBuy = listed(state).filter(i => !i.done).length;
  const mine = forYou().length;
  const rows = [
    ...(mine ? [`<button class="d-sec ${on('foryou')}" data-casa-open="foryou"><i class="d-dot" style="background:${me?.color || 'var(--yellow)'}"></i><span>Pra você</span><em>${mine}</em></button>`] : []),
    `<button class="d-sec ${on('compras')}" data-casa-open="compras"><i class="d-dot" style="background:var(--yellow)"></i><span>Compras</span><em>${toBuy || ''}</em></button>`,
    ...casaLists().map(l => { const n = liveChores(state, l.id).filter(c => !c.done).length; return `<button class="d-sec ${on(l.id)}" data-casa-open="${esc(l.id)}"><i class="d-dot" style="background:${listColor(l.id)}"></i><span>${esc(l.name)}</span><em>${n || ''}</em></button>`; }),
    '<button class="d-sec c-side-new" data-new-list><span>Nova lista</span></button>',
  ];
  const faces = shared() ? `<span class="c-faces">${people.map(p => `<i style="background:${p.color}">${esc(p.name[0])}</i>`).join('')}</span>` : '';
  return `<h2 class="d-side-h c-side-h"><span>Casa</span>${faces}</h2><div class="d-secs">${rows.join('')}</div>`;
}

function casaRail() {
  const news = shared() ? casaNews().slice(0, 8) : [];
  const feed = news.map(e => `<div class="c-ev"><i class="c-who" style="background:${personColor(e.who)}">${esc(person(e.who)?.name[0] || '?')}</i><div>${esc(person(e.who)?.name || '')} ${e.text}<small>${whenAgo(e.at)} · ${esc(e.where)}</small></div></div>`).join('');
  const notes = live(state, 'notes').filter(n => n.title || n.body).sort((a, b) => (a.order ?? 0) - (b.order ?? 0) || (a.added || 0) - (b.added || 0));
  const noteRows = notes.map(n => `<button class="d-mini" data-edit-note="${esc(n.id)}"><span>${esc(n.title || n.body.split('\n')[0])}${n.title && n.body ? `<small class="c-note-body">${esc(memoSnippet(n, 200))}</small>` : ''}</span></button>`).join('');
  return `<aside class="d-rail" aria-label="Casa">
    ${shared() ? `<section class="d-card"><div class="d-card-h"><h2>Novidades</h2></div>${feed ? `<div class="c-feed">${feed}</div>` : '<p class="d-card-empty">Nada novo nos últimos 7 dias.</p>'}</section>` : ''}
    <section class="d-card"><div class="d-card-h"><h2>Notas fixas</h2><button class="n-link" data-new-note>Nova</button></div>${noteRows || '<p class="d-card-empty">Wi-Fi, tamanhos, senha do portão…</p>'}</section>
  </aside>`;
}

function deskCasa() {
  markCasaSeen();
  if (casaView === 'compras') return deskCompras();
  const known = casaView === 'foryou' || (casaView && state.lists[casaView] && !state.lists[casaView].deleted);
  if (!known) casaView = null;
  if (!casaView) {
    return `${toolbar('Casa', esc(casaNames()), deskAdd('Novo', 'data-new-chore'))}<div class="d-split"><div class="d-main d-legacy">${statusHtml()}${forYouGroup()}<div class="n-group-h"><h2>Listas</h2></div>${casaTiles()}</div>${casaRail()}</div>`;
  }
  if (casaView === 'foryou') {
    const mine = forYou();
    return `${toolbar('Pra você', `Casa · ${plural(mine.length, 'pedido', 'pedidos')}`, deskAdd('Novo', 'data-new-chore'))}<div class="d-split"><div class="d-main">${statusHtml()}${mine.length ? `<div class="n-list">${mine.map(c => choreRow(c, {showList: true})).join('')}</div>` : '<p class="d-empty">Ninguém pediu nada pra você.</p>'}</div>${casaRail()}</div>`;
  }
  const {html, count} = choreListBody(casaView);
  const end = `<button class="d-tool" data-edit-list="${esc(casaView)}">${ICONS.more}<span>Lista</span></button>${deskAdd('Novo', `data-new-chore="${esc(casaView)}"`)}`;
  return `${toolbar(esc(listName(casaView)), `Casa · ${count ? plural(count, 'pendente', 'pendentes') : 'nada pendente'}`, end)}<div class="d-split"><div class="d-main">${statusHtml()}${html}</div>${casaRail()}</div>`;
}
// ---------- Notas (Markdown) ----------
// Each person's notes (`memos`): a list by last edit, a note rendered from Markdown and an editor
// of the raw text. Agents write here too (MCP): what one wrote carries its name, and a dot until
// the note is opened.

const markdown = createMarkdown(MarkdownIt, {check: ICONS.check});
// The screen is redrawn on every sync and parsing is the costly part: keep the last few.
const renderedNotes = new Map();
function renderMarkdown(body) {
  let html = renderedNotes.get(body);
  if (html === undefined) {
    html = markdown.render(body);
    if (renderedNotes.size >= 8) renderedNotes.delete(renderedNotes.keys().next().value);
    renderedNotes.set(body, html);
  }
  return html;
}

// Note open (on the computer, the one in the reading column), section filter, search, and
// whether the computer's list shows Apagadas.
let memoId = null, memoSection = '', memoSearch = '', memoTrash = false;
const memos = () => liveMemos(state);
const memoOf = id => { const m = own(state.memos, id); return m && !m.deleted ? m : null; };
const memosUnseen = () => memos().filter(memoUnseen).length;
const trashNow = () => trashedMemos(state, Date.now());
const memoSectionOf = m => { const s = own(state.sections, m.section); return s && !s.deleted ? s : null; };
const memoDot = m => { const s = memoSectionOf(m); return s ? `<i class="m-dot" style="background:${sectionColor(s.id)}" title="${esc(s.name)}"></i>` : ''; };
const agentTag = name => `<span class="m-agent">${ICONS.spark}${esc(name)}</span>`;
const clockOf = d => `${d.getHours()}:${String(d.getMinutes()).padStart(2, '0')}`;
const dayMonth = d => `${d.getDate()}/${String(d.getMonth() + 1).padStart(2, '0')}${d.getFullYear() === new Date().getFullYear() ? '' : `/${String(d.getFullYear()).slice(2)}`}`;
// In a list: "10:42" today, "qua" in the last week, "21/11" before that.
function memoWhen(ms) {
  const d = new Date(ms), date = dayKey(d);
  if (date >= today()) return clockOf(d);
  return date > addDays(today(), -7) ? WEEK[d.getDay()].slice(0, 3).toLowerCase() : dayMonth(d);
}
// In a sentence: "hoje às 10:42", "ontem às 18:05", "em 21 de novembro".
function memoWhenLong(ms) {
  const d = new Date(ms), date = dayKey(d);
  if (date >= today()) return `hoje às ${clockOf(d)}`;
  if (date === addDays(today(), -1)) return `ontem às ${clockOf(d)}`;
  return `em ${d.getDate()} de ${MONTHS[d.getMonth()]}${d.getFullYear() === new Date().getFullYear() ? '' : ` de ${d.getFullYear()}`}`;
}
function memoMeta(m) {
  const s = memoSectionOf(m), when = memoWhenLong(memoStamp(m));
  return `${s ? `${memoDot(m)}<span>${esc(s.name)} ·</span>` : ''}<span>${m.agent ? `${agentTag(m.agent)} escreveu ${when}` : `Editada ${when}`}</span>`;
}
const memoProgress = m => { const t = memoTasks(m.body); return t.total ? `${t.done} de ${t.total}` : ''; };

// `line` is where a search matched, shown in place of the start of the note.
function memoRow(m, line = '') {
  const parts = [memoWhen(memoStamp(m)), m.agent ? agentTag(m.agent) : '', memoProgress(m), esc(line || memoSnippet(m))].filter(Boolean);
  const fresh = memoUnseen(m);
  return `<div class="n-row n-plain m-row ${fresh ? 'is-new' : ''} ${desktop() && m.id === memoId ? 'is-on' : ''}"><button class="n-text n-two" data-open-memo="${esc(m.id)}"><span class="m-row-t">${fresh ? '<span class="n-sr">Nova: </span>' : ''}${esc(memoTitle(m))}</span><span class="m-row-s">${parts.join(' · ')}</span></button>${memoDot(m)}</div>`;
}
const memoTile = m => `<button class="m-tile ${memoUnseen(m) ? 'is-new' : ''}" data-open-memo="${esc(m.id)}"><b>${esc(memoTitle(m))}</b><span>${esc(memoSnippet(m, 90))}</span><small>${memoDot(m)}${[memoProgress(m), memoWhen(memoStamp(m))].filter(Boolean).join(' · ')}</small></button>`;

// By when each was last written: today, the last 7 days, then month by month.
function memoGroups(list) {
  const week = addDays(today(), -7), groups = [];
  for (const m of list) {
    const date = dayKey(new Date(memoStamp(m)));
    const name = date >= today() ? 'Hoje' : date > week ? 'Últimos 7 dias' : monthName(date.slice(0, 7));
    if (groups.at(-1)?.name !== name) groups.push({name, items: []});
    groups.at(-1).items.push(m);
  }
  return groups;
}

function trashRows() {
  const list = trashNow(), now = Date.now();
  if (!list.length) return '<p class="d-empty">Nada em Apagadas.</p>';
  const left = m => plural(Math.max(1, Math.ceil((m.trashed + TRASH_DAYS * 864e5 - now) / 864e5)), 'dia', 'dias');
  const when = ms => { const d = new Date(ms), date = dayKey(d); return date >= today() ? 'hoje' : date === addDays(today(), -1) ? 'ontem' : dayMonth(d); };
  return `<div class="n-list n-spaced">${list.map(m => `<div class="n-row n-plain m-row"><span class="n-text n-two"><span class="m-row-t">${esc(memoTitle(m))}</span><span class="m-row-s">${m.trashedAgent ? `${agentTag(m.trashedAgent)} apagou` : 'Você apagou'} ${when(m.trashed)} · ${left(m)}</span></span><button class="n-link m-rec" data-restore-memo="${esc(m.id)}">Recuperar</button></div>`).join('')}</div>
    <p class="n-note">Recuperar devolve a nota para a lista, com o mesmo texto.</p>
    <div class="n-sheet-actions"><button class="n-btn n-gray n-danger" data-empty-trash>${list.length === 1 ? 'Apagar esta nota de vez' : `Apagar estas ${list.length} notas de vez`}</button></div>`;
}

function memoRows() {
  const wide = desktop();
  if (wide && memoTrash) return trashRows();
  const found = searchMemos(sortMemos(memos()).filter(m => !memoSection || m.section === memoSection), memoSearch), searching = !!itemKey(memoSearch);
  const trash = trashNow().length;
  const trashLink = trash ? `<div class="n-list n-spaced m-trash-link"><div class="n-row n-plain"><button class="n-text" data-memo-trash>Apagadas</button><span class="n-meta">${trash}</span><span class="n-chev" aria-hidden="true">›</span></div></div>` : '';
  if (!found.length) return `<p class="d-empty">${searching || memoSection ? 'Nenhuma nota encontrada.' : 'Nenhuma nota.'}</p>${trashLink}`;
  const rows = items => `<div class="n-list">${items.join('')}</div>`;
  if (searching) return `<div class="m-found">${rows(found.map(({memo, line}) => memoRow(memo, line)))}</div>${trashLink}`;
  const list = found.map(f => f.memo), pinned = list.filter(m => m.pinned);
  const group = (name, html) => `<section><div class="n-group-h"><h2>${name}</h2></div>${html}</section>`;
  // On the phone the pinned ones are cards, like Casa's lists; the computer's column keeps rows.
  return `${pinned.length ? group('Fixadas', wide ? rows(pinned.map(m => memoRow(m))) : `<div class="m-tiles">${pinned.map(memoTile).join('')}</div>`) : ''}
    ${memoGroups(list.filter(m => !m.pinned)).map(g => group(g.name, rows(g.items.map(m => memoRow(m))))).join('')}${trashLink}`;
}

// Only sections that have notes; the tasks' sections and their colors.
function memoChips() {
  const used = new Set(memos().map(m => m.section)), list = sections().filter(s => used.has(s.id));
  if (!list.some(s => s.id === memoSection)) memoSection = '';
  if (!list.length) return '';
  return `<div class="m-chips" role="group" aria-label="Filtrar por seção"><button class="n-chip-filter ${memoSection ? '' : 'is-on'}" data-memo-section="" aria-pressed="${!memoSection}">Todas</button>${list.map(s => `<button class="n-chip-filter ${memoSection === s.id ? 'is-on' : ''}" data-memo-section="${esc(s.id)}" aria-pressed="${memoSection === s.id}"><i class="m-dot" style="background:${sectionColor(s.id)}"></i>${esc(s.name)}</button>`).join('')}</div>`;
}

function viewNotas() {
  const all = memos(), fresh = all.filter(memoUnseen).length;
  if (!all.length && !trashNow().length) return `${statusHtml()}<div class="m-head"><h1 class="n-title">Notas</h1></div><div class="n-empty"><p>Nenhuma nota ainda.</p><p class="n-note">Texto livre em Markdown, para o que não é tarefa, conta nem lista.</p><div class="n-btns"><button class="n-btn n-yellow" data-new-memo>Nova nota</button></div></div>`;
  return `${statusHtml()}<div class="m-head"><h1 class="n-title">Notas</h1><p class="n-sub"><span>${plural(all.length, 'nota', 'notas')}</span>${fresh ? `<span class="n-accent">${plural(fresh, 'nova', 'novas')}</span>` : ''}</p></div>
    <input class="n-bill-search m-search" type="search" aria-label="Buscar nas notas" placeholder="Buscar" value="${esc(memoSearch)}" autocomplete="off" data-memo-search>
    ${memoChips()}<div id="memo-rows">${memoRows()}</div>`;
}

// A note without a title is called by its first line, which is already in the text. `under` goes between the title and the text.
const memoArticle = (m, under = '') => `${m.title ? `<h1 class="m-h">${esc(m.title)}</h1>` : ''}${under}${m.body ? `<div class="n-md" data-md-body="memos:${esc(m.id)}">${renderMarkdown(m.body)}</div>` : '<p class="d-empty">Nota sem texto.</p>'}`;

// Opening a note an agent wrote clears its dot. The time is never before the note's own:
// with this device's clock behind the server's, the note would stay new forever.
let memoSeenPending = false;
function markMemoSeen(m) {
  if (memoSeenPending || !memoUnseen(m) || document.hidden) return;
  memoSeenPending = true;
  const id = m.id;
  setTimeout(() => {
    memoSeenPending = false;
    const now = memoOf(id);
    if (now && memoUnseen(now) && memoId === id && tab === 'notas') commit('memos', id, {seen: Math.max(Date.now(), now.edited || 0)});
  });
}

// A note as a page over the Notas tab (phone).
function pageMemo() {
  const m = memoOf(memoId), back = `<button class="n-link n-back" data-back>${ICONS.prev}Notas</button>`;
  if (!m) return {html: `<div class="n-top">${back}</div><div class="n-empty"><p>Esta nota foi apagada.</p></div>`, action: ''};
  if (m.trashed) return {html: `<div class="n-top">${back}</div><article class="m-note">${memoArticle(m, `<p class="m-meta">${m.trashedAgent ? `${agentTag(m.trashedAgent)} apagou` : 'Você apagou'} esta nota. Ela fica ${TRASH_DAYS} dias em Apagadas.</p>`)}</article>`, action: `<button class="n-btn n-yellow n-wide" data-restore-memo="${esc(m.id)}">Recuperar nota</button>`};
  markMemoSeen(m);
  return {html: `${statusHtml()}<div class="n-top">${back}<span class="n-top-end"><button class="n-icon" data-memo-menu="${esc(m.id)}" aria-label="Fixar, seção, copiar e apagar">${ICONS.more}</button><button class="n-link" data-edit-memo="${esc(m.id)}">Editar</button></span></div>
    <article class="m-note">${memoArticle(m, `<p class="m-meta">${memoMeta(m)}</p>`)}</article>`, action: ''};
}

function pageTrash() {
  return {html: `<div class="n-top"><button class="n-link n-back" data-back>${ICONS.prev}Notas</button></div><h1 class="n-title">Apagadas</h1><p class="n-sub">Depois de ${TRASH_DAYS} dias somem de vez.</p>${trashRows()}`, action: ''};
}

function openMemo(id) {
  memoId = id; memoTrash = false;
  if (tab !== 'notas') { tab = 'notas'; selecting = false; selected.clear(); cursor = null; }
  if (desktop()) {
    if (navigation.current !== 'root') navigation.back();
    render();
    const content = $('.page[data-name="root"] .page-content');
    if (content) content.scrollTop = 0;
  } else if (navigation.current === 'root') navigation.push('nota');
  else render();
}

function trashMemo(id) {
  const m = memoOf(id);
  if (!m || m.trashed) return;
  // On the computer the next note in the list takes its place in the reading column.
  const ids = $$('#memo-rows [data-open-memo]').map(b => b.dataset.openMemo), i = ids.indexOf(id);
  if (desktop() && memoId === id) memoId = ids[i + 1] || ids[i - 1] || null;
  commit('memos', id, {trashed: Date.now()});
  if (!desktop() && navigation.current !== 'root') navigation.back();
  toast('Nota apagada.', () => { commit('memos', id, {trashed: 0}); toast('Nota recuperada.'); });
}
function restoreMemo(id) {
  if (!memoOf(id)?.trashed) return;
  commit('memos', id, {trashed: 0});
  toast('Nota recuperada.');
}
function emptyTrash() {
  const list = trashNow();
  if (!list.length || !confirm(`${list.length === 1 ? 'Apagar esta nota' : `Apagar estas ${list.length} notas`} de vez? Não dá para desfazer.`)) return;
  commitMany(list.map(m => ({collection: 'memos', id: m.id, patch: memoGone})));
  memoTrash = false;
  if (!desktop() && navigation.current !== 'root') navigation.back();
  toast(list.length === 1 ? 'Nota apagada de vez.' : `${list.length} notas apagadas de vez.`);
}
// A box ticked in the rendered note rewrites its line of the Markdown: in a note of this tab
// (`memos`) or in one of Casa's pinned notes (`notes`), which is read in a sheet that the
// redraw does not reach.
function toggleMemoBox(button) {
  const holder = button.closest('[data-md-body]'), where = holder?.dataset.mdBody || '', cut = where.indexOf(':');
  const collection = where.slice(0, cut), id = where.slice(cut + 1), record = collection === 'memos' ? memoOf(id) : collection === 'notes' ? own(state.notes, id) : null;
  if (!record || record.deleted || record.trashed) return;
  const body = toggleMemoTask(record.body, Number(button.dataset.mdTask));
  if (body === null) return;
  commit(collection, id, {body});
  if (holder.closest('#sheet')) holder.innerHTML = renderMarkdown(body);
}

function memoMenuSheet(id) {
  const m = memoOf(id);
  if (!m || m.trashed) return;
  openSheet(`<div class="n-form"><div class="n-sheet-top"><span></span><h2 id="sheet-title">${esc(memoTitle(m))}</h2><button type="button" class="n-link n-ok" data-close>OK</button></div>
    <div class="n-opts"><label class="n-opt">Fixada<input type="checkbox" class="n-switch" data-m-pin ${m.pinned ? 'checked' : ''}></label>
      <label class="n-opt">Seção<select data-m-section aria-label="Seção"><option value="">Nenhuma</option>${sections().map(s => `<option value="${esc(s.id)}" ${memoSectionOf(m)?.id === s.id ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label></div>
    <div class="n-sheet-actions"><button type="button" class="n-btn n-gray" data-m-copy>Copiar Markdown</button><button type="button" class="n-btn n-gray n-danger" data-m-trash>Apagar nota</button></div></div>`, () => {
    $('[data-m-pin]').onchange = e => commit('memos', id, {pinned: e.target.checked});
    $('[data-m-section]').onchange = e => commit('memos', id, {section: e.target.value});
    $('[data-m-copy]').onclick = async () => {
      try { await navigator.clipboard.writeText(memoOf(id)?.body || ''); toast('Markdown copiado.'); } catch { toast('Não foi possível copiar.'); }
      closeSheet();
    };
    $('[data-m-trash]').onclick = () => { closeSheet(); trashMemo(id); };
  });
}

// The editor's shortcuts: a mark at the start of the selected lines (again takes it off), or
// around the selection.
const MD_TOOLS = [['h', 'H', 'Título'], ['b', 'B', 'Negrito'], ['i', 'I', 'Itálico'], ['ul', '•', 'Lista'], ['task', '☐', 'Caixa de marcar'], ['quote', '❝', 'Citação'], ['code', '&lt;/&gt;', 'Código'], ['link', '[ ]( )', 'Link']];
function mdFormat(area, kind) {
  const {selectionStart: a, selectionEnd: b, value} = area, chosen = value.slice(a, b);
  // insertText keeps the field's own undo; where it is refused, the text goes in directly.
  const put = (from, to, text, selectFrom, selectTo = selectFrom) => {
    area.focus();
    area.setSelectionRange(from, to);
    if (!document.execCommand?.('insertText', false, text)) { area.setRangeText(text, from, to, 'end'); area.dispatchEvent(new Event('input', {bubbles: true})); }
    area.setSelectionRange(selectFrom, selectTo);
  };
  const prefix = {h: '## ', ul: '- ', task: '- [ ] ', quote: '> '}[kind];
  if (prefix) {
    const from = value.lastIndexOf('\n', a - 1) + 1, end = value.indexOf('\n', b), to = end < 0 ? value.length : end;
    const lines = value.slice(from, to).split('\n'), marked = lines.every(l => l.startsWith(prefix));
    const text = lines.map(l => marked ? l.slice(prefix.length) : prefix + l).join('\n');
    return put(from, to, text, from + text.length);
  }
  if (kind === 'link') { const label = chosen || 'texto'; return put(a, b, `[${label}](https://)`, a + label.length + 3, a + label.length + 11); }
  if (kind === 'code' && chosen.includes('\n')) return put(a, b, `\`\`\`\n${chosen}\n\`\`\``, a + 4, a + 4 + chosen.length);
  const mark = {b: '**', i: '*', code: '`'}[kind];
  put(a, b, `${mark}${chosen}${mark}`, a + mark.length, a + mark.length + chosen.length);
}

// Writing a note takes longer than filling a form: leaving with something typed asks first.
function memoSheet(id) {
  const m = id ? memoOf(id) : null;
  if (id && (!m || m.trashed)) return;
  const base = {title: m?.title || '', body: m?.body || ''};
  // The parser drops a line break right after <textarea>; the extra one keeps the note's own.
  openSheet(`<form class="n-form m-form" id="memo-form">${sheetTop(m ? 'Editar nota' : 'Nova nota', 'OK')}
    <input name="title" maxlength="${MEMO_TITLE_MAX}" placeholder="Título" aria-label="Título" value="${esc(base.title)}" autocomplete="off" ${m ? '' : 'autofocus'}>
    <div class="m-edit"><div class="m-src"><div class="m-fmt" role="toolbar" aria-label="Formatação">${MD_TOOLS.map(([kind, label, name]) => `<button type="button" data-md="${kind}" data-keep-focus aria-label="${name}" title="${name}">${label}</button>`).join('')}</div>
      <textarea name="body" maxlength="${MEMO_MAX}" placeholder="Texto em Markdown" aria-label="Texto em Markdown">\n${esc(base.body)}</textarea></div>
      <div class="m-preview"><p class="m-preview-h">Prévia</p><div class="n-md" data-preview></div></div></div>
    <p class="n-note" data-left hidden></p>
  </form>`, dialog => {
    dialog.classList.add('is-memo');
    const form = $('#memo-form'), title = form.elements.title, area = form.elements.body, preview = $('[data-preview]', form), left = $('[data-left]', form);
    const name = () => title.value.trim().replace(/\s+/g, ' '), text = () => area.value.replace(/\r\n?/g, '\n').replace(/\s+$/, '');
    let drawn = null, frame = 0;
    const draw = () => {
      // The preview is beside the text only on a wide window.
      if (preview.offsetParent && area.value !== drawn) { drawn = area.value; preview.innerHTML = drawn.trim() ? markdown.render(drawn) : '<p class="d-empty">O texto aparece aqui como vai ficar.</p>'; }
      const room = MEMO_MAX - area.value.length;
      left.hidden = room > 2000;
      left.textContent = room > 0 ? `Cabem mais ${room.toLocaleString('pt-BR')} caracteres.` : 'A nota chegou ao limite de tamanho.';
    };
    draw();
    area.addEventListener('input', () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(draw); });
    form.addEventListener('click', e => { const tool = e.target.closest('[data-md]'); if (tool) mdFormat(area, tool.dataset.md); });
    form.addEventListener('keydown', e => {
      if (!(e.metaKey || e.ctrlKey) || e.altKey) return;
      const key = e.key.toLowerCase();
      if (key === 'enter') { e.preventDefault(); form.requestSubmit(); }
      else if (e.target === area && (key === 'b' || key === 'i')) { e.preventDefault(); mdFormat(area, key); }
    });
    sheetGuard = () => (name() === base.title && text() === base.body) || confirm('Descartar o que você escreveu?');
    dialog.addEventListener('close', () => { dialog.classList.remove('is-memo'); sheetGuard = null; cancelAnimationFrame(frame); }, {once: true});
    // On the computer the caret waits at the end of the text; on the phone the keyboard only comes when the text is touched.
    if (m && desktop()) { area.focus(); area.setSelectionRange(area.value.length, area.value.length); area.scrollTop = area.scrollHeight; }
    form.onsubmit = e => {
      e.preventDefault();
      const t = name(), b = text(), at = Date.now(), now = id ? memoOf(id) : null;
      const create = () => { const nid = uid(); commit('memos', nid, {title: t, body: b, section: (id ? m.section : memoSection) || '', pinned: false, added: at, edited: at, trashed: 0}); memoId = nid; memoTrash = false; };
      if (!id) { if (t || b) create(); }
      // Apagada (or deleted for good) while it was open here: what was typed is not lost.
      else if (!now || now.trashed) { create(); toast('A nota tinha sido apagada. O que você escreveu ficou numa nota nova.'); }
      else {
        // The text changed under the editor (the agent, another device): saving goes over it.
        const under = (now.body || '') !== base.body;
        if (under && b !== base.body && !confirm(`${now.agent || 'Outro aparelho'} mudou o texto desta nota enquanto você editava. Gravar o seu por cima?`)) return;
        const patch = {};
        if (t !== base.title && t !== (now.title || '')) patch.title = t;
        if (b !== base.body && b !== (now.body || '')) patch.body = b;
        if (Object.keys(patch).length) commit('memos', id, {...patch, edited: at});
      }
      sheetGuard = null;
      closeSheet();
    };
  });
}

// On the computer: the list in one column and the note open beside it.
function deskNotas() {
  const all = memos(), fresh = all.filter(memoUnseen).length;
  let current = memoTrash ? null : memoOf(memoId);
  if (current?.trashed) current = null;
  // Nothing chosen: the most recent one opens, unless opening it would clear a dot unread.
  if (!current && !memoTrash) { current = sortMemos(all).filter(m => !memoSection || m.section === memoSection).find(m => !memoUnseen(m)) || null; memoId = current?.id || null; }
  if (current) markMemoSeen(current);
  const head = memoTrash ? `<div class="m-col-h"><button class="n-link n-back" data-memo-trash-close>${ICONS.prev}Notas</button><b>Apagadas</b></div><p class="n-note">Depois de ${TRASH_DAYS} dias somem de vez.</p>`
    : `<input class="m-find" type="search" aria-label="Buscar nas notas" placeholder="Buscar nas notas" value="${esc(memoSearch)}" autocomplete="off" data-memo-search>`;
  const reader = current ? `<div class="m-read-bar"><p class="m-meta">${memoMeta(current)}</p><span class="m-read-end"><button class="d-tool ${current.pinned ? 'is-on' : ''}" data-pin-memo="${esc(current.id)}" aria-pressed="${!!current.pinned}" aria-label="Fixar" title="${current.pinned ? 'Desafixar' : 'Fixar'}">${ICONS.pin}</button><button class="d-tool" data-edit-memo="${esc(current.id)}">Editar<kbd>↩</kbd></button><button class="d-tool" data-memo-menu="${esc(current.id)}" aria-label="Seção, copiar e apagar" title="Seção, copiar e apagar">${ICONS.more}</button></span></div><div class="m-read-body">${memoArticle(current)}</div>`
    : `<div class="m-none">${memoTrash ? `<p>O que você ou um agente apagou fica aqui por ${TRASH_DAYS} dias.</p>` : all.length ? '<p>Escolha uma nota na lista.</p>' : '<p>Nenhuma nota ainda.</p><p>Texto livre em Markdown, para o que não é tarefa, conta nem lista.</p><button class="n-btn n-yellow" data-new-memo>Nova nota</button>'}</div>`;
  return `${toolbar('Notas', `${plural(all.length, 'nota', 'notas')}${fresh ? ` · ${plural(fresh, 'nova', 'novas')}` : ''}`, deskAdd('Nova nota', 'data-new-memo'))}
    <div class="m-desk"><div class="m-col">${head}<div id="memo-rows">${memoRows()}</div></div><article class="m-read">${statusHtml()}${reader}</article></div>`;
}

function viewAjustes() {
  const repeats = live(state, 'repeats').length;
  const monthly = repeatingBills(state).length;
  const account = protectedServer && me ? `<div class="n-group-h"><h2>Conta</h2></div>
    <div class="n-list"><div class="n-row n-plain"><span class="n-person-dot" style="background:${me.color}"></span><span class="n-text">${esc(me.name)}</span><button class="n-link n-danger" data-logout>Sair</button></div></div>` : '';
  const back = desktop() ? '' : `<button class="n-link n-back" data-tab="hoje">${ICONS.prev}Hoje</button>`;
  return `${statusHtml()}<div class="n-top">${back}</div><h1 class="n-title">Ajustes</h1>${account}
    <div class="n-group-h"><h2>Seções</h2></div>
    <div class="n-list" id="section-list">${sections().map(s => `<div class="n-row n-plain" data-section-row="${s.id}"><button class="n-text" data-edit-section="${s.id}">${esc(s.name)}</button><button class="n-handle" data-drag="${s.id}" aria-label="Reordenar ${esc(s.name)}. Use as setas para mover.">≡</button></div>`).join('')}
      <div class="n-row n-plain"><button class="n-text n-accent" data-new-section>Nova seção</button></div></div>
    <p class="n-note">A ordem aqui é a ordem em Hoje e no Backlog${desktop() ? ' e define a cor de cada seção' : ''}.</p>
    <div class="n-group-h"><h2>Abas</h2></div>
    <div class="n-list">${[['reunioes', 'Agenda'], ['backlog', 'Backlog'], ['notas', 'Notas'], ['compras', 'Casa'], ['contas', 'Contas']].map(([id, label]) => `<label class="n-row n-plain"><span class="n-text">${label}</span><input type="checkbox" class="n-switch" data-tab-pref="${id}" ${tabPrefs(state)[id] ? 'checked' : ''}></label>`).join('')}</div>
    <p class="n-note">Hoje sempre aparece; Ajustes abre pelo seu nome no topo de Hoje. A Agenda mostra tudo que tem horário; com ela ligada, as reuniões saem do Hoje e ficam só lá.</p>
    <div class="n-group-h"><h2>Repetições</h2></div>
    <div class="n-list">
      <div class="n-row n-plain"><button class="n-text" data-push="repeats">Tarefas que se repetem</button><span class="n-meta">${repeats}</span><span class="n-chev" aria-hidden="true">›</span></div>
      ${tabPrefs(state).contas ? `<div class="n-row n-plain"><button class="n-text" data-push="monthly">Contas recorrentes</button><span class="n-meta">${monthly}</span><span class="n-chev" aria-hidden="true">›</span></div>` : ''}
    </div>
    ${protectedServer ? passkeysHtml() : ''}
    ${pushHtml()}
    <div class="n-group-h"><h2>Dados</h2></div>
    <div class="n-list">
      <div class="n-row n-plain"><button class="n-text" data-export>Exportar backup</button><span class="n-chev" aria-hidden="true">›</span></div>
    </div>`;
}

// ---------- Secondary pages ----------

// The calendar's week, also the drop targets when a task is dragged to another day.
function weekStrip(monday, selectedDate) {
  const mark = d => { const list = dayTasks(d); return !list.length ? 'is-none' : list.every(t => t.done) ? 'is-all' : ''; };
  const days = Array.from({length: 7}, (_, i) => addDays(monday, i));
  return `<button class="n-week-nav" data-day="${addDays(monday, -7)}" data-week-step="-7" aria-label="Semana anterior">‹</button>
    ${days.map(d => `<button class="n-day ${d === selectedDate ? 'is-selected' : ''} ${d === today() ? 'is-today' : ''}" data-day="${d}" aria-label="${esc(longDate(d))}"><small>${WEEK_INITIAL[weekday(d)]}</small><b>${Number(d.slice(8, 10))}</b><i class="${mark(d)}"></i></button>`).join('')}
    <button class="n-week-nav" data-day="${addDays(monday, 7)}" data-week-step="7" aria-label="Próxima semana">›</button>`;
}

function pageHistory() {
  const date = historyDate, tasks = dayTasks(date), ahead = date > today();
  const sameMonth = date.slice(0, 7) === today().slice(0, 7);
  const title = `${WEEK[weekday(date)]}, ${Number(date.slice(8, 10))}${sameMonth ? '' : ` de ${MONTHS[Number(date.slice(5, 7)) - 1]}`}`;
  return {
    // The header and week strip stay put; only the day's tasks scroll.
    html: `<div class="n-day-head"><div class="n-top"><button class="n-link" data-back>‹ Hoje</button><label class="n-icon" aria-label="Escolher dia">${ICONS.cal}<input type="date" class="n-hidden-input" data-pick-day value="${date}"></label></div>
      <h1 class="n-title">${title}</h1><p class="n-sub">${!tasks.length ? 'Nenhuma tarefa neste dia' : ahead ? plural(tasks.length, 'tarefa prevista', 'tarefas previstas') : `${doneCount(tasks)} de ${tasks.length} feitas`}</p>
      <div class="n-week">${weekStrip(mondayOf(date), date)}</div></div>
      ${sectionGroups(tasks, 'edit', list => ahead ? list.length : `${doneCount(list)} de ${list.length}`)}`,
    action: (() => {
      // Today and later days take new tasks and meetings; earlier days only hand back what was left.
      if (date >= today()) return `<button class="n-quick" data-new-on-day>${ICONS.plus}<span>Nova tarefa</span></button>`;
      const n = pendingOn(state, date).length;
      return n ? `<button class="n-btn n-yellow n-wide" data-carry-day>${n === 1 ? 'Trazer 1 pendente para hoje' : `Trazer ${n} pendentes para hoje`}</button>` : '';
    })(),
  };
}

function pageRepeats() {
  const list = live(state, 'repeats');
  const groups = sections().map(s => {
    const items = list.filter(r => r.section === s.id).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    return items.length ? `<div class="n-group-h"><h2>${esc(s.name)}</h2></div><div class="n-list">${items.map(r => `<div class="n-row n-plain"><button class="n-text n-two" data-edit-repeat="${r.id}"><span>${esc(r.text)}</span><span class="n-meta">${esc(repeatLabel(r))}${r.time ? `, ${timeLabel(r)}` : ''}</span></button><span class="n-chev" aria-hidden="true">›</span></div>`).join('')}</div>` : '';
  }).join('');
  return {html: `<div class="n-top"><button class="n-link" data-back>‹ Ajustes</button></div><h1 class="n-title">Repetições</h1>${groups || '<div class="n-empty"><p>Nenhuma tarefa se repete.</p><p class="n-note">Ao criar uma tarefa, escolha Repetir.</p></div>'}`, action: ''};
}

function pageMonthly() {
  const list = billCatalog(state, today().slice(0, 7)).filter(b => b.recurring);
  const rows = list.map(b => `<div class="n-row n-plain"><button class="n-text n-two" data-edit-bill="${esc(b.id)}" data-catalog="true"><span>${esc(b.text)}</span><span class="n-meta">${b.due ? `Dia ${b.due} · ` : ''}${everyLabel(billEvery(billRule(state, b)))}</span></button><span class="n-amount">${money(b.amount)}</span>${billActions(b, true)}</div>`).join('');
  return {html: `<div class="n-top"><button class="n-link" data-back>‹ Ajustes</button></div><h1 class="n-title">Contas recorrentes</h1><p class="n-sub">Voltam no ritmo de cada uma, como não pagas.</p>${rows ? `<div class="n-list n-spaced">${rows}</div>` : '<div class="n-empty"><p>Nenhuma conta se repete.</p></div>'}`, action: ''};
}

const PAGES = {history: pageHistory, repeats: pageRepeats, monthly: pageMonthly, casa: pageCasa, nota: pageMemo, apagadas: pageTrash};

function render() {
  // Replacing the rows mid-drag would cancel the drag; it renders again when it ends.
  if (dragging || dragIds) return;
  const screen = $('.page[data-name="root"] .n-screen'), wide = desktop();
  document.body.dataset.layout = wide ? 'desktop' : 'phone';
  // "Anyone" in Casa is drawn half in each person's color.
  if (people.length > 1) { document.body.style.setProperty('--who-a', people[0].color); document.body.style.setProperty('--who-b', people[1].color); }
  // A tab turned off (here or on another device) cannot stay selected.
  if (!visibleTabs().some(([id]) => id === tab)) tab = 'hoje';
  // Paged to tomorrow and the day turned: that is today now.
  if (hojeDate === today()) hojeDate = null;
  if (railDate === today()) railDate = null;
  // Re-rendering replaces the add fields; keep what is being typed and the keyboard open.
  const typing = ['#add-item input', '#add-chore input', '#quick-task input'].map(sel => { const field = $(sel); return field && {sel, value: field.value, focused: document.activeElement === field}; }).filter(Boolean);
  const searching = document.activeElement?.matches('[data-bill-search]');
  // Notas: the search keeps the caret, and the computer's list column its scroll.
  const memoFind = document.activeElement?.matches('[data-memo-search]') ? [document.activeElement.selectionStart, document.activeElement.selectionEnd] : null, memoColTop = $('.m-col')?.scrollTop || 0;
  const stepForm = document.activeElement?.closest?.('[data-add-step]'), stepTyping = stepForm && {id: stepForm.dataset.addStep, value: stepForm.elements.entry.value};
  if (screen) screen.innerHTML = (wide ? DESK_VIEWS : {hoje: viewHoje, reunioes: viewReunioes, backlog: viewBacklog, notas: viewNotas, compras: viewCasa, contas: viewContas, ajustes: viewAjustes})[tab]();
  for (const {sel, value, focused} of typing) { const field = $(sel); if (!field) continue; field.value = value; if (focused) field.focus({preventScroll: true}); }
  if ($('#quick-task')) drawQuickChips();
  if (searching) $('[data-bill-search]')?.focus({preventScroll: true});
  if (memoFind) { const field = $('[data-memo-search]'); if (field) { field.focus({preventScroll: true}); try { field.setSelectionRange(...memoFind); } catch {} } }
  if (memoColTop && $('.m-col')) $('.m-col').scrollTop = memoColTop;
  if (stepTyping) { const field = $(`[data-add-step="${CSS.escape(stepTyping.id)}"] input`); if (field) { field.value = stepTyping.value; field.focus({preventScroll: true}); } }
  $('#tabbar').innerHTML = wide ? sidebarHtml() : mainTabs().map(([id, label]) => `<button class="n-tab ${tab === id ? 'is-on' : ''}" data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}>${tabIcon(id)}<span>${label}</span>${id === 'backlog' && overdue().length ? '<i class="n-tab-dot" aria-label="Há tarefas que ficaram para trás"></i>' : ''}${id === 'compras' && casaUnseen() ? '<i class="n-tab-dot c-tab-dot" aria-label="Novidades na Casa"></i>' : ''}${id === 'notas' && memosUnseen() ? '<i class="n-tab-dot c-tab-dot" aria-label="Há notas novas"></i>' : ''}</button>`).join('');
  let float = '';
  if (wide) float = tab === 'backlog' && selected.size ? backlogActions() : '';
  else if (tab === 'backlog' && selecting) float = `<button class="n-btn n-yellow n-wide" data-move-selected ${selected.size ? '' : 'disabled'}>${selected.size ? `Mover ${selected.size} para hoje` : 'Selecione tarefas'}</button>`;
  else if (tab === 'hoje' && hojeDate) {
    // Days ahead take new tasks; earlier days only hand back what was left.
    const n = hojeDate > today() ? 0 : pendingOn(state, hojeDate).length;
    float = hojeDate > today() ? `<button class="n-quick" data-new-on-day="${hojeDate}">${ICONS.plus}<span>Nova tarefa</span></button>` : n ? `<button class="n-btn n-yellow n-wide" data-carry-day="${hojeDate}">${n === 1 ? 'Trazer 1 pendente para hoje' : `Trazer ${n} pendentes para hoje`}</button>` : '';
  }
  else if (tab === 'reunioes') float = `<button class="n-quick" data-new-meeting>${ICONS.plus}<span>Nova reunião</span></button>`;
  else if (tab === 'notas' && (memos().length || trashNow().length)) float = `<button class="n-quick" data-new-memo>${ICONS.plus}<span>Nova nota</span></button>`;
  else if ((tab === 'hoje' && (todayTasks().length || hojeCasaGroup())) || (tab === 'backlog' && (backlog().length || scheduled().length || overdue().length))) float = `<button class="n-quick" data-new-task>${ICONS.plus}<span>Nova tarefa</span></button>`;
  $('#float').innerHTML = float;
  document.body.dataset.float = float ? 'yes' : 'no';
  if (sub && document.contains(sub.el)) {
    const page = PAGES[sub.name]();
    $('.n-screen', sub.el).innerHTML = page.html;
    $('.n-page-action', sub.el).innerHTML = page.action;
    sub.el.dataset.action = page.action ? 'yes' : 'no';
  }
}

function switchTab(id) {
  // The Hoje tab always comes back to today.
  if (id === 'hoje') hojeDate = railDate = null;
  // The Casa tab (or its sidebar entry) always opens on the overview.
  if (id === 'compras') casaView = null;
  if (id === 'notas') memoTrash = false;
  if (id !== tab) { tab = id; selecting = false; selected.clear(); cursor = null; }
  // The sidebar stays visible over secondary pages; choosing an area leaves them.
  if (desktop() && navigation.current !== 'root') navigation.back();
  if (id === 'ajustes' && protectedServer && passkeySupported) void prepareRegister();
  render();
  const content = $('.page[data-name="root"] .page-content');
  if (content) content.scrollTop = 0;
}

// ---------- Sheets ----------

function openSheet(html, ready) {
  $('#sheet-content').innerHTML = html;
  const dialog = $('#sheet');
  if (!dialog.open) dialog.showModal();
  fitSheet();
  ready?.(dialog);
}
// On iOS the keyboard shrinks only the visual viewport; the sheet is anchored to the
// layout viewport, so it would sit behind the keyboard. Lift it above and cap its height.
function fitSheet() {
  const dialog = $('#sheet'), vv = window.visualViewport;
  if (!vv || !dialog.open) return;
  const covered = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
  dialog.style.setProperty('--kb', `${covered}px`);
  dialog.style.setProperty('--vvh', `${Math.round(vv.height)}px`);
  dialog.classList.toggle('is-kb', covered > 80);
  if (covered > 80) document.activeElement?.scrollIntoView?.({block: 'nearest'});
}
window.visualViewport?.addEventListener('resize', fitSheet);
window.visualViewport?.addEventListener('scroll', fitSheet);
// A sheet may ask before closing (the note editor, with something typed); Esc goes the same way.
let sheetGuard = null;
function closeSheet() { if ($('#sheet').open && (!sheetGuard || sheetGuard())) $('#sheet').close(); }
$('#sheet').addEventListener('cancel', e => { if (sheetGuard && !sheetGuard()) e.preventDefault(); });
const sheetTop = (title, ok = 'Salvar') => `<div class="n-sheet-top"><button type="button" class="n-link" data-close>Cancelar</button><h2 id="sheet-title">${title}</h2>${ok ? `<button class="n-link n-ok">${ok}</button>` : '<span></span>'}</div>`;

function autosize(el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }

// Edits a task (from Hoje/Backlog) or, with {repeatId}, the repeat itself.
const passoField = (id, text) => `<div class="n-opt n-passo-field" data-passo-id="${id}"><input value="${esc(text)}" maxlength="500" autocomplete="off" autocapitalize="sentences" enterkeyhint="next" aria-label="Passo"><button type="button" class="n-passo-remove" data-remove-passo aria-label="Remover passo">×</button></div>`;
// The sheet's steps, in their order, against the ones the task had. What was typed in
// "Adicionar passo" counts too; a step left empty goes away.
function stepOps(form, owner, before, task) {
  const field = $('[data-new-passo]', form);
  if (!field) return [];
  const typed = field.value.trim();
  const rows = [...$$('[data-passo-id]', form).map(r => ({id: r.dataset.passoId, text: $('input', r).value.trim()})), ...(typed ? [{id: '', text: typed}] : [])].filter(r => r.text);
  const ops = [], kept = new Set();
  rows.forEach(({id, text}, order) => {
    const old = id && state.steps[id];
    if (old) {
      kept.add(id);
      if (old.text !== text || old.order !== order || old.task !== owner) ops.push({collection: 'steps', id, patch: {text, order, task: owner}});
    } else ops.push({collection: 'steps', id: uid(), patch: {task: owner, text, done: false, order}});
  });
  for (const s of before) if (!kept.has(s.id)) ops.push({collection: 'steps', id: s.id, patch: {deleted: true}});
  // A new step means the task is not done yet.
  if (task?.done && owner === origin(task) && rows.some(r => !r.id)) ops.push({collection: 'tasks', id: task.id, patch: {done: false}});
  return ops;
}
// A repeat's day not created yet (a future day in the week): create that day's task and edit it,
// so it can be changed or deleted alone.
function editOccurrence(repeatId, date) {
  const id = occurrenceId(repeatId, date);
  if (state.tasks[id]) { taskSheet({id}); return; }
  const t = dayTasks(date).find(t => t.id === id);
  if (!t) { taskSheet({repeatId}); return; }
  const {id: _, ...fields} = t;
  commit('tasks', id, fields).then(() => taskSheet({id}));
}
function toggleOccurrence(repeatId, date) {
  const id = occurrenceId(repeatId, date);
  if (state.tasks[id]) { toggleTask(id); return; }
  const t = dayTasks(date).find(t => t.id === id);
  if (!t) return;
  const {id: _, ...fields} = t;
  settle(id);
  commit('tasks', id, {...fields, done: true});
}
function deleteOccurrence(repeatId, date) {
  const id = occurrenceId(repeatId, date);
  if (state.tasks[id]) { deleteTasks([id]); return; }
  const t = dayTasks(date).find(t => t.id === id);
  if (!t) return;
  const {id: _, ...fields} = t;
  commit('tasks', id, {...fields, deleted: true});
  toast('Reunião excluída só neste dia.', () => {
    commit('tasks', id, {...fields, deleted: false});
    toast('Exclusão desfeita.');
  });
}
function taskSheet({id, repeatId, when, meeting: asMeeting, date: presetDate, time: presetTime} = {}) {
  const task = id ? state.tasks[id] : null;
  const repeat = state.repeats[repeatId || task?.repeat] && !state.repeats[repeatId || task?.repeat].deleted ? state.repeats[repeatId || task?.repeat] : null;
  const editingRepeat = !!repeatId;
  const source = editingRepeat ? repeat : task;
  const section = source?.section && state.sections[source.section] && !state.sections[source.section].deleted ? source.section : lastSection();
  // A task from a past day can stay there, or move to today, a future day or the backlog.
  const pastDay = !editingRepeat && task?.date && task.date < today() ? task.date : '';
  // day (its past day), today, later (a chosen future day) or backlog
  const initialWhen = editingRepeat ? 'today' : pastDay ? 'day' : task ? (task.date === '' ? 'backlog' : task.date > today() ? 'later' : 'today') : when;
  const isBacklog = initialWhen === 'backlog';
  const isMeeting = source ? !!source.meeting : !!asMeeting;
  const kind = repeatKind(repeat);
  const days = repeat && kind !== 'monthly' ? repeat.days : '12345';
  // An every-other-week repeat counts its weeks from the first occurrence.
  const firstDay = kind === 'biweekly' && repeat.start ? repeat.start : presetDate || today();
  const title = editingRepeat ? 'Editar repetição' : task ? 'Editar tarefa' : isMeeting ? 'Nova reunião' : 'Nova tarefa';
  // A new task can also pull tasks from the backlog onto the chosen day.
  const pullable = !task && !editingRepeat && tabPrefs(state).backlog && backlog().length > 0;
  const stepList = task ? taskSteps(state, task) : [];
  const dayOptions = Array.from({length: 31}, (_, i) => `<option value="${i + 1}" ${(repeat?.monthDay || Number(today().slice(8, 10))) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('');
  openSheet(`<form class="n-form" id="task-form">${sheetTop(title)}
    <textarea name="text" rows="1" required maxlength="10000" placeholder="Tarefa" aria-label="Tarefa" ${task || editingRepeat ? '' : 'autofocus'}>${esc(source?.text || '')}</textarea>
    ${task && !editingRepeat ? `<div class="n-opts"><label class="n-opt">Concluída<input type="checkbox" class="n-switch" name="done" ${task.done ? 'checked' : ''}></label></div>` : ''}
    ${editingRepeat ? '' : `<fieldset class="n-fieldset"><legend>Passos</legend><div class="n-opts n-passos-edit" data-passos-edit>${stepList.map(st => passoField(st.id, st.text)).join('')}<label class="n-opt n-passo-new">${ICONS.plus}<input data-new-passo placeholder="Adicionar passo" autocomplete="off" autocapitalize="sentences" enterkeyhint="enter" maxlength="500" aria-label="Adicionar passo"></label></div></fieldset>`}
    <fieldset class="n-fieldset"><legend>Seção</legend><div class="n-chips">${sections().map(s => `<label class="n-chip"><input type="radio" name="section" value="${s.id}" ${s.id === section ? 'checked' : ''}><span>${esc(s.name)}</span></label>`).join('')}</div></fieldset>
    ${editingRepeat ? '' : `<fieldset class="n-seg"><legend class="n-sr">Quando</legend>${[...(pastDay ? [['day', cap(dayShort(pastDay).replace(/ de \S+$/, ''))]] : []), ['today', 'Hoje'], ['later', 'Outro dia'], ['backlog', 'Backlog']].filter(([v]) => v !== 'backlog' || tabPrefs(state).backlog || isBacklog).map(([v, l]) => `<label><input type="radio" name="when" value="${v}" ${v === initialWhen ? 'checked' : ''}><span>${l}</span></label>`).join('')}</fieldset>`}
    <div class="n-opts" data-today-only>
      <label class="n-opt" data-later-only>Data<input type="date" name="date" min="${addDays(today(), 1)}" value="${initialWhen === 'later' ? task?.date || presetDate : addDays(today(), 1)}"></label>
      <label class="n-opt">Reunião<input type="checkbox" class="n-switch" name="meeting" ${isMeeting ? 'checked' : ''}></label>
      <label class="n-opt"><span data-time-label>Horário</span><input type="time" name="time" value="${esc(source?.time || presetTime || '')}"></label>
      <label class="n-opt" data-end-only>Fim<input type="time" name="end" value="${esc(source?.time || presetTime ? meetingEnd({time: source?.time || presetTime, end: source?.end}) : '')}"></label>
      <label class="n-opt" data-repeat-only>Repetir<select name="rule">
        ${[['none', 'Não repete'], ['daily', 'Todo dia'], ['weekdays', 'Dias úteis'], ['custom', 'Dias escolhidos'], ['biweekly', 'A cada 2 semanas'], ['monthly', 'Todo mês']].filter(([v]) => !editingRepeat || v !== 'none').map(([v, l]) => `<option value="${v}" ${v === kind ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
      <fieldset class="n-days" data-days><legend class="n-sr">Dias da semana</legend>${[0, 1, 2, 3, 4, 5, 6].map(d => `<label><input type="checkbox" name="day" value="${d}" ${days.includes(String(d)) ? 'checked' : ''}><span aria-label="${WEEK[d]}">${WEEK_INITIAL[d]}</span></label>`).join('')}</fieldset>
      <label class="n-opt" data-first-day>A partir de<input type="date" name="start" value="${firstDay}"></label>
      <label class="n-opt" data-month-day>Dia do mês<select name="monthDay">${dayOptions}</select></label>
    </div>
    ${pullable ? `<div class="n-pull" data-pull-only><button type="button" class="n-pull-link" data-bl-open>ou trazer do backlog ›</button><div class="n-list n-pick-list" data-bl-chosen hidden></div></div>${pickPane()}` : ''}
    ${task || editingRepeat ? `<div class="n-sheet-actions">${repeat && !editingRepeat ? '<button type="button" class="n-btn n-gray" data-stop-repeat>Parar de repetir</button>' : ''}${editingRepeat ? '<button type="button" class="n-btn n-gray n-danger" data-stop-repeat>Parar de repetir</button>' : `<button type="button" class="n-btn n-gray n-danger" data-delete>${repeat ? 'Excluir só este dia' : isMeeting ? 'Excluir reunião' : 'Excluir tarefa'}</button>`}</div>` : ''}
  </form>`, () => {
    const form = $('#task-form'), text = form.elements.text;
    autosize(text); text.addEventListener('input', () => autosize(text));
    // Return in a step adds the next one instead of saving; × takes it out.
    const newPasso = $('[data-new-passo]', form);
    if (newPasso) {
      form.addEventListener('keydown', e => {
        if (e.key !== 'Enter' || !e.target.closest('[data-passos-edit] input')) return;
        e.preventDefault();
        if (e.target === newPasso && newPasso.value.trim()) { newPasso.closest('label').insertAdjacentHTML('beforebegin', passoField('', newPasso.value.trim())); newPasso.value = ''; }
        else if (e.target !== newPasso) newPasso.focus();
      });
      form.addEventListener('click', e => {
        const b = e.target.closest('[data-remove-passo]');
        if (!b) return;
        e.stopPropagation();
        b.closest('[data-passo-id]').replaceWith();
        newPasso.focus();
      });
    }
    const whenValue = () => editingRepeat ? 'today' : form.elements.when.value;
    const update = () => {
      // Moved off its past day, the task happens once there.
      // Another day can start a repeat too, except when moving one occurrence of a repeat.
      const chosen = whenValue(), rule = form.elements.rule.value, repeats = chosen === 'day' || (chosen === 'today' && !pastDay) || (chosen === 'later' && !task?.repeat);
      $('[data-today-only]', form).hidden = chosen === 'backlog';
      $('[data-later-only]', form).hidden = chosen !== 'later';
      const pull = $('[data-pull-only]', form);
      if (pull) pull.hidden = chosen === 'backlog';
      $('[data-repeat-only]', form).hidden = !repeats;
      $('[data-days]', form).hidden = !repeats || !['daily', 'weekdays', 'custom', 'biweekly'].includes(rule);
      // On another day, the chosen date is where the repeat starts.
      $('[data-first-day]', form).hidden = !repeats || rule !== 'biweekly' || chosen === 'later';
      $('[data-month-day]', form).hidden = !repeats || rule !== 'monthly';
      const timed = !!form.elements.time.value;
      $('[data-end-only]', form).hidden = !timed;
      $('[data-time-label]', form).textContent = timed ? 'Início' : 'Horário';
    };
    // Moving the start keeps the length; a first start gets 30 minutes.
    let lastStart = form.elements.time.value;
    form.elements.time.addEventListener('change', () => {
      const start = form.elements.time.value, end = form.elements.end.value;
      if (start) {
        const length = lastStart && end > lastStart ? toMinutes(end) - toMinutes(lastStart) : 30;
        form.elements.end.value = fromMinutes(Math.min(toMinutes(start) + length, 23 * 60 + 59));
      }
      lastStart = start;
      update();
    });
    form.elements.rule.addEventListener('change', () => {
      const rule = form.elements.rule.value;
      let preset = {daily: '0123456', weekdays: '12345'}[rule];
      // Every other week usually means one day: start from the chosen first day's weekday.
      if (rule === 'biweekly' && [...form.elements.day].filter(b => b.checked).length !== 1) preset = String(weekday(form.elements.start.value || today()));
      if (preset) for (const box of form.elements.day) box.checked = preset.includes(box.value);
      update();
    });
    $('[data-days]', form).addEventListener('change', () => {
      if (form.elements.rule.value === 'biweekly') return;
      const chosen = [...form.elements.day].filter(b => b.checked).map(b => b.value).join('');
      form.elements.rule.value = chosen === '0123456' ? 'daily' : chosen === '12345' ? 'weekdays' : 'custom';
    });
    form.addEventListener('change', e => { if (e.target.name === 'when') update(); });
    const picked = pullable ? pickBacklog(form, () => {
      const when = whenValue(), date = form.elements.date.value;
      return when === 'today' ? 'hoje' : date > today() ? dayShort(date) : '';
    }) : new Set();
    update();
    form.onsubmit = e => {
      e.preventDefault();
      const value = text.value.trim();
      const pulling = whenValue() !== 'backlog' && picked.size > 0;
      if (!value && !pulling) return text.focus();
      const sectionId = form.elements.section.value || lastSection();
      localStorage.setItem('notas-section', sectionId);
      const chosenWhen = whenValue(), onDay = chosenWhen === 'day', onToday = chosenWhen === 'today', dated = chosenWhen !== 'backlog';
      const leavingPast = !!pastDay && !onDay;
      const later = chosenWhen === 'later' ? form.elements.date.value : '';
      if (chosenWhen === 'later' && !(later > today())) { toast('Escolha uma data a partir de amanhã.'); return form.elements.date.focus(); }
      // Pulled tasks keep their own section and time; only the day changes.
      const pulled = pulling ? [...picked].filter(id => state.tasks[id] && !state.tasks[id].deleted && state.tasks[id].date === '') : [];
      const pullOps = pulled.map(id => ({collection: 'tasks', id, patch: {date: later || today(), done: false}}));
      const pullMessage = pulled.length ? `${pulled.length === 1 ? '1 tarefa trazida' : `${pulled.length} tarefas trazidas`} para ${later ? nextDayLabel(later) : 'hoje'}.` : '';
      if (!value) {
        commitMany(pullOps);
        closeSheet();
        if (pullMessage) toast(pullMessage);
        return;
      }
      const time = dated ? form.elements.time.value : '';
      const meeting = dated && form.elements.meeting.checked;
      const end = time ? form.elements.end.value || meetingEnd({time}) : '';
      if (end && end <= time) { toast('O fim precisa ser depois do início.'); return form.elements.end.focus(); }
      const rule = form.elements.rule.value;
      const chosen = [...form.elements.day].filter(b => b.checked).map(b => b.value).join('');
      const wantsRepeat = (onDay || (onToday && !pastDay) || (!!later && !task?.repeat)) && (rule === 'monthly' || (rule !== 'none' && chosen));
      // A repeat set on another day starts on that day; editing keeps the start it had.
      let start = later || repeat?.start || '';
      if (wantsRepeat && rule === 'biweekly') {
        const from = later || form.elements.start.value;
        if (!from) { toast('Escolha a partir de quando repete.'); return form.elements.start.focus(); }
        // Anchor on the first chosen weekday from that date on.
        start = from;
        while (!chosen.includes(String(weekday(start)))) start = addDays(start, 1);
      }
      const ops = [];
      // The task the steps end up on (its origin); none when no task is saved.
      let owner = '';
      let rid = repeatId || task?.repeat || '';
      let template = null;
      if ((later || leavingPast) && task?.repeat) {
        // Moving one occurrence to another day leaves the repeat itself alone.
        rid = '';
      } else if (wantsRepeat) {
        rid ||= uid();
        template = {text: value, section: sectionId, time, end, days: rule === 'monthly' ? '' : chosen, monthDay: rule === 'monthly' ? Number(form.elements.monthDay.value) : 0, weeks: rule === 'biweekly' ? 2 : 1, start: wantsRepeat ? start : '', meeting};
        ops.push({collection: 'repeats', id: rid, patch: template});
      } else if (rid) {
        ops.push({collection: 'repeats', id: rid, patch: {deleted: true}});
        rid = '';
      }
      let message = later && later !== task?.date ? `Agendada para ${nextDayLabel(later)}.` : leavingPast ? (onToday ? 'Tarefa movida para hoje.' : 'Tarefa movida para o backlog.') : '';
      if (!editingRepeat && later && wantsRepeat) {
        // The repeat creates each day's task, the first one included.
        const first = repeatsOn(template, later) ? later : nextOccurrence(template);
        if (task) {
          ops.push({collection: 'tasks', id: task.id, patch: {deleted: true}});
          if (first === later) owner = occurrenceId(rid, later);
          if (first === later) ops.push({collection: 'tasks', id: occurrenceId(rid, later), patch: {text: value, section: sectionId, time, end, meeting, repeat: rid, date: later, done: false}});
        }
        message = first ? `Repete a partir de ${nextDayLabel(first)}.` : '';
      } else if (!editingRepeat) {
        if (task) {
          const date = later || (onDay ? pastDay : onToday ? today() : '');
          // Brought from a past day, it starts over as not done, unless marked done here.
          const done = form.elements.done.checked, doneChanged = done !== !!task.done;
          if (doneChanged) settle(task.id);
          ops.push({collection: 'tasks', id: task.id, patch: {text: value, section: sectionId, time, end, meeting, repeat: rid, date, ...(doneChanged ? {done} : leavingPast ? {done: false} : {})}});
          if (doneChanged && done) ops.push(...taskDoneOps(state, task, true).slice(1));
          owner = origin(task);
        } else if (later) {
          owner = uid();
          ops.push({collection: 'tasks', id: owner, patch: {text: value, section: sectionId, time, end, meeting, repeat: '', date: later, done: false}});
        } else if (wantsRepeat && !repeatsOn(template, today())) {
          const next = nextOccurrence(template);
          message = next ? `Repete a partir de ${nextDayLabel(next)}.` : '';
        } else {
          const newId = wantsRepeat ? occurrenceId(rid, today()) : uid();
          owner = newId;
          ops.push({collection: 'tasks', id: newId, patch: {text: value, section: sectionId, time, end, meeting, repeat: rid, date: onToday ? today() : '', done: false}});
          if (!onToday && tab !== 'backlog') message = 'Tarefa salva no backlog.';
        }
      }
      commitMany([...ops, ...(owner ? stepOps(form, owner, stepList, task) : []), ...pullOps]);
      closeSheet();
      if (message || pullMessage) toast([message, pullMessage].filter(Boolean).join(' '));
    };
    $('[data-delete]', form)?.addEventListener('click', () => { commit('tasks', task.id, {deleted: true}); closeSheet(); });
    $('[data-stop-repeat]', form)?.addEventListener('click', () => {
      const ops = [{collection: 'repeats', id: repeat.id, patch: {deleted: true}}];
      if (task) ops.push({collection: 'tasks', id: task.id, patch: {repeat: ''}});
      commitMany(ops); closeSheet(); toast('A tarefa não vai mais se repetir.');
    });
  });
}

// The backlog list the new-task sheet slides to. Only the explicit link opens it.
function pickPane() {
  const tasks = backlog(), known = new Set(sections().map(s => s.id));
  const groups = [...sections().map(s => [s.name, tasks.filter(t => t.section === s.id)]), ['Outras', tasks.filter(t => !known.has(t.section))]].filter(([, list]) => list.length);
  return `<div class="n-pick" data-bl-pane hidden>
    <div class="n-sheet-top"><button type="button" class="n-link" data-bl-back>‹ Voltar</button><h2>Backlog</h2><span></span></div>
    <input type="search" class="n-pick-search" placeholder="Buscar" aria-label="Buscar no backlog" autocomplete="off" data-bl-search>
    ${groups.map(([name, list]) => `<section data-bl-group><h3 class="n-pick-h">${esc(name)}</h3><div class="n-list n-pick-list">${list.map(t => `<button type="button" class="n-row n-pick-row" data-bl-pick="${t.id}" data-key="${esc(itemKey(t.text))}" aria-pressed="false"><span class="n-check" aria-hidden="true">${ICONS.check}</span><span class="n-text">${esc(t.text)}</span></button>`).join('')}</div></section>`).join('')}
    <p class="n-note" data-bl-none hidden>Nada encontrado.</p>
    <div class="n-pick-cta"><button type="button" class="n-btn n-yellow n-wide" data-bl-bring disabled>Selecione tarefas</button></div>
  </div>`;
}
// Wires the backlog pane inside the task form; returns the set of task ids brought back.
// Marks are drafts until "Trazer"; Voltar drops them.
function pickBacklog(form, destination) {
  const picked = new Set(), marking = new Set(), dialog = $('#sheet');
  const pane = $('[data-bl-pane]', form), chosen = $('[data-bl-chosen]', form), cta = $('[data-bl-bring]', form), search = $('[data-bl-search]', form);
  const slide = (to, name) => { if (!matchMedia('(prefers-reduced-motion: reduce)').matches) form.animate([{transform: `translateX(${name === 'in' ? 24 : -24}px)`, opacity: .4}, {transform: 'none', opacity: 1}], {duration: 260, easing: 'cubic-bezier(.2, .8, .2, 1)'}); dialog.scrollTop = 0; to?.focus({preventScroll: true}); };
  const label = () => {
    const where = destination();
    cta.disabled = !marking.size;
    cta.textContent = !marking.size ? 'Selecione tarefas' : where ? `Trazer para ${where}` : 'Trazer';
  };
  const showChosen = () => {
    chosen.hidden = !picked.size;
    chosen.innerHTML = [...picked].map(id => state.tasks[id]).filter(Boolean).map(t => `<div class="n-row n-plain"><i class="n-pick-dot" style="background:${sectionColor(t.section)}" aria-hidden="true"></i><span class="n-text">${esc(t.text)}</span><button type="button" class="n-pick-x" data-bl-drop="${t.id}" aria-label="Tirar ${esc(t.text)}">✕</button></div>`).join('');
    form.elements.text.required = !picked.size;
  };
  const open = () => {
    marking.clear(); for (const id of picked) marking.add(id);
    for (const row of $$('[data-bl-pick]', pane)) { const on = marking.has(row.dataset.blPick); row.classList.toggle('is-selected', on); row.setAttribute('aria-pressed', on); }
    search.value = ''; filter(); label();
    form.classList.add('is-picking'); pane.hidden = false;
    slide($('[data-bl-back]', pane), 'in');
  };
  const close = () => { form.classList.remove('is-picking'); pane.hidden = true; slide($('[data-bl-open]', form), 'out'); };
  const filter = () => {
    const q = itemKey(search.value);
    let any = false;
    for (const group of $$('[data-bl-group]', pane)) {
      let shown = 0;
      for (const row of $$('[data-bl-pick]', group)) { row.hidden = !!q && !row.dataset.key.includes(q); if (!row.hidden) shown++; }
      group.hidden = !shown; any ||= shown > 0;
    }
    $('[data-bl-none]', pane).hidden = any;
  };
  search.addEventListener('input', filter);
  form.addEventListener('keydown', e => {
    if (!form.classList.contains('is-picking')) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if (e.key === 'Enter' && e.target === search) e.preventDefault();
  });
  form.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b) return;
    const d = b.dataset;
    if ('blOpen' in d) open();
    else if ('blBack' in d) close();
    else if (d.blPick) {
      marking.has(d.blPick) ? marking.delete(d.blPick) : marking.add(d.blPick);
      b.classList.toggle('is-selected', marking.has(d.blPick)); b.setAttribute('aria-pressed', marking.has(d.blPick)); label();
    } else if ('blBring' in d) { picked.clear(); for (const id of marking) picked.add(id); showChosen(); close(); }
    else if (d.blDrop) { picked.delete(d.blDrop); showChosen(); }
    else return;
    // These buttons belong to the sheet; keep the app-wide click handler out of it.
    e.stopPropagation();
  });
  return picked;
}

function parseMoney(input) {
  let s = String(input).replace(/[^\d,.-]/g, '');
  if (!s.trim()) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function billSheet(id, fromCatalog = false) {
  const bill = id ? findBill(id, fromCatalog) : null;
  if (id && (!bill || bill.deleted || bill.skipped)) { closeSheet(); toast('Esta conta não está mais disponível.'); return; }
  const month = bill?.month || (billsView === 'mes' ? billMonth : today().slice(0, 7));
  const activeRule = bill && billRule(state, bill);
  const expectedRule = structuredClone(activeRule || null);
  const recurring = activeRule && !activeRule.deleted && activeRule.repeat !== false;
  const PRESETS = [[1, 'Todo mês'], [2, 'A cada 2 meses'], [3, 'A cada 3 meses'], [6, 'A cada 6 meses'], [12, 'Todo ano']];
  const every = billEvery(bill || {}), preset = PRESETS.some(([n]) => n === every);
  const rule = (bill ? !recurring : false) ? 'none' : preset ? String(every) : 'custom';
  const perOccurrence = bill?.calcMode === 'occurrence';
  const exclusions = new Set(String(bill?.excluded || '').split(',').filter(Boolean));
  // Cards come from the finance app; a series linked to one takes its amount and due day.
  const cards = Object.values(state.cards || {}).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  const chain = billChain(bill?.id || uid()), linked = state.cardLinks?.[chain]?.card || '';
  openSheet(`<form class="n-form" id="bill-form">${sheetTop(bill ? 'Editar conta' : 'Nova conta')}
    ${bill ? `<p class="n-note">Vencimento: ${billDate(bill)}${bill.done ? ' · paga' : ''}</p>` : ''}
    <input name="text" required maxlength="200" placeholder="Nome da conta" aria-label="Nome da conta" value="${esc(bill?.text || '')}" ${bill ? '' : 'autofocus'}>
    <div class="n-opts">
      <label class="n-opt">Cálculo<select name="calcMode" aria-label="Cálculo do valor"><option value="fixed" ${perOccurrence ? '' : 'selected'}>Fixo</option><option value="occurrence" ${perOccurrence ? 'selected' : ''}>Por ocorrência</option></select></label>
      ${cards.length ? `<label class="n-opt" data-card-opt>Fatura do cartão<select name="card" aria-label="Fatura do cartão"><option value="">Nenhum</option>${cards.map(c => `<option value="${esc(c.id)}" ${linked === c.id ? 'selected' : ''}>${esc(c.name)}</option>`).join('')}</select></label>` : ''}
      <label class="n-opt" data-amount-opt><span data-amount-label>${perOccurrence ? 'Por sessão' : 'Valor'}</span><input name="amount" inputmode="decimal" required placeholder="R$ 0,00" value="${bill ? esc(((perOccurrence ? bill.unitAmount : bill.amount) / 100).toFixed(2).replace('.', ',')) : ''}"></label>
      <label class="n-opt" data-occurrence-lag>Cobrar<select name="lag" aria-label="Mês das sessões cobradas"><option value="0">Mês atual</option><option value="1" ${bill?.lag === 1 ? 'selected' : ''}>Mês anterior</option></select></label>
      <label class="n-opt" data-occurrence-start>Contar desde<input name="starts" type="date" aria-label="Contar desde" value="${esc(bill?.starts || `${month}-01`)}"></label>
      <label class="n-opt" data-due-opt>Vence dia<select name="due"><option value="0">Sem dia</option>${Array.from({length: 31}, (_, i) => `<option value="${i + 1}" ${bill?.due === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
      <label class="n-opt">Repetir<select name="rule"><option value="none" ${rule === 'none' ? 'selected' : ''}>Não repete</option>${PRESETS.map(([n, l]) => `<option value="${n}" ${rule === String(n) ? 'selected' : ''}>${l}</option>`).join('')}<option value="custom" ${rule === 'custom' ? 'selected' : ''}>Outro…</option></select></label>
      <div class="n-opt" data-custom>A cada (meses)<span class="n-step"><button type="button" data-step="-1" aria-label="Menos um mês">−</button><output data-n aria-live="polite">${preset ? 4 : every}</output><button type="button" data-step="1" aria-label="Mais um mês">+</button></span></div>
    </div>
    <fieldset class="n-fieldset" data-occurrence-days><legend>Dias da semana</legend><div class="n-days">${[1, 2, 3, 4, 5, 6, 0].map(d => `<label><input type="checkbox" name="billWeekdays" value="${d}" aria-label="${WEEK[d]}" ${String(bill?.weekdays || '4').includes(String(d)) ? 'checked' : ''}><span>${['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'][d]}</span></label>`).join('')}</div></fieldset>
    <p class="n-note" data-card-note hidden></p>
    <div class="n-bill-calculation" data-calculation hidden aria-live="polite"></div>
    <fieldset class="n-fieldset" data-occurrence-dates hidden><legend data-dates-legend>Incluir na cobrança deste mês</legend><div class="n-opts" data-date-list></div><p class="n-note">Desmarcar tira a sessão só desta cobrança. Feriados e faltas não são descontados automaticamente.</p></fieldset>
    ${recurring ? `<fieldset class="n-bill-scope"><legend>Aplicar alterações a</legend><label><input type="radio" name="scope" value="one" ${fromCatalog ? '' : 'checked'}><span>Só este vencimento<small>Os próximos mantêm os dados atuais.</small></span></label><label><input type="radio" name="scope" value="future" ${fromCatalog ? 'checked' : ''}><span>Este e os próximos<small>Preserva os vencimentos anteriores e os outros já pagos.</small></span></label></fieldset>` : ''}
    <p class="n-note" data-repeat-note></p>
    <p class="n-error" data-error hidden>Informe o valor em reais, por exemplo 119,90.</p>
    ${bill ? '<div class="n-sheet-actions"><button type="button" class="n-btn n-gray n-danger" data-delete>Excluir conta</button></div>' : ''}
  </form>`, () => {
    const form = $('#bill-form');
    const out = $('[data-n]', form);
    // A new bill that pays last month's sessions starts one month later.
    const payMonth = () => bill ? month : addMonths(month, form.elements.calcMode.value === 'occurrence' ? Number(form.elements.lag.value) : 0);
    const calculationFields = () => {
      const lag = form.elements.calcMode.value === 'occurrence' ? Number(form.elements.lag.value) : 0, source = billSessionMonth({lag}, payMonth());
      return {calcMode: form.elements.calcMode.value, unitAmount: parseMoney(form.elements.amount.value) ?? 0, weekdays: $$('[name="billWeekdays"]:checked', form).map(input => input.value).sort().join(''), starts: form.elements.starts.value, excluded: [...exclusions].filter(date => date.startsWith(`${source}-`)).sort().join(','), lag};
    };
    // The card picked in the form (fixed amounts only) and its bill for the paying month.
    const pickedCard = () => form.elements.card && form.elements.calcMode.value === 'fixed' ? state.cards[form.elements.card.value] : undefined;
    const pickedBill = () => pickedCard()?.bills?.[payMonth()];
    const preview = () => {
      const calculation = calculationFields(), occurrence = calculation.calcMode === 'occurrence';
      const card = pickedCard(), cardNow = pickedBill();
      if (form.elements.card) $('[data-card-opt]', form).hidden = occurrence;
      // Until the card has a bill for that month, the amount typed here is the estimate.
      $('[data-amount-opt]', form).hidden = !!cardNow;
      $('[data-due-opt]', form).hidden = !!cardNow;
      form.elements.amount.required = !cardNow;
      $('[data-card-note]', form).hidden = !card;
      if (card) $('[data-card-note]', form).textContent = `O valor e o vencimento vêm da fatura do ${card.name}${cardNow ? `: ${money(cardNow.amount)} em ${monthOf(payMonth())}, ${cardNow.status === 'open' ? 'ainda aberta' : 'fechada'}` : `. A de ${monthOf(payMonth())} ainda não saiu: até lá vale o valor acima`}. Marcar como paga continua com você.`;
      $('[data-amount-label]', form).textContent = occurrence ? 'Por sessão' : 'Valor';
      $('[data-occurrence-start]', form).hidden = !occurrence;
      $('[data-occurrence-lag]', form).hidden = !occurrence;
      form.elements.starts.required = occurrence;
      form.elements.starts.disabled = !occurrence;
      $('[data-occurrence-days]', form).hidden = !occurrence;
      $('[data-calculation]', form).hidden = !occurrence;
      $('[data-occurrence-dates]', form).hidden = !occurrence;
      if (!occurrence) return;
      const draft = {...calculation, month: payMonth()}, snapshot = billSnapshot(draft);
      $('[data-dates-legend]', form).textContent = calculation.lag ? `Sessões de ${monthOf(billSessionMonth(draft))} · pagas em ${monthOf(draft.month)}` : 'Incluir na cobrança deste mês';
      $('[data-calculation]', form).innerHTML = `<span>${monthName(draft.month)} · total previsto</span><strong>${money(snapshot.amount)}</strong><small>${billCalcLabel(draft)}</small>`;
      $('[data-date-list]', form).innerHTML = billDates(draft).map(date => `<label class="n-bill-date"><input type="checkbox" data-bill-date="${date}" ${exclusions.has(date) ? '' : 'checked'}><span>${Number(date.slice(8))} de ${monthOf(date)}<small>${WEEK[weekday(date)]}</small></span><span>${exclusions.has(date) ? 'Não cobrar' : money(calculation.unitAmount)}</span></label>`).join('') || '<p class="n-note">Nenhuma sessão neste mês.</p>';
    };
    form.addEventListener('change', e => {
      if (e.target.dataset.billDate) e.target.checked ? exclusions.delete(e.target.dataset.billDate) : exclusions.add(e.target.dataset.billDate);
      if (e.target.matches('[name="calcMode"], [name="lag"], [name="starts"], [name="billWeekdays"], [data-bill-date], [name="card"]')) preview();
      if (['calcMode', 'lag', 'card'].includes(e.target.name)) note();
    });
    form.elements.amount.addEventListener('input', preview);
    const months = () => form.elements.rule.value === 'custom' ? Number(out.textContent) : Number(form.elements.rule.value);
    const note = () => {
      const n = months(), none = form.elements.rule.value === 'none';
      const one = recurring && form.elements.scope.value === 'one';
      form.elements.rule.disabled = one;
      $$('[data-step]', form).forEach(b => { b.disabled = one; });
      $('[data-custom]', form).hidden = form.elements.rule.value !== 'custom';
      $('[data-repeat-note]', form).hidden = none && !one;
      if (one) { $('[data-repeat-note]', form).textContent = 'Para mudar a repetição, escolha “Este e os próximos”.'; return; }
      const lag = form.elements.calcMode.value === 'occurrence' ? Number(form.elements.lag.value) : 0;
      // Switching an existing bill to last month's sessions would count a month already charged.
      const shifted = bill && lag !== (bill.lag === 1 ? 1 : 0) ? ` Esta cobrança passa a contar as sessões de ${monthOf(billSessionMonth({lag}, month))}; confira se elas já foram pagas.` : '';
      if (!none && form.elements.calcMode.value === 'occurrence') { $('[data-repeat-note]', form).textContent = (lag ? 'Cada cobrança soma as sessões do mês anterior pelo preço por sessão.' : 'Cada cobrança será calculada pelas datas daquele mês e pelo preço por sessão.') + ' As exceções valem só para o mês ajustado.' + shifted; return; }
      $('[data-repeat-note]', form).textContent = none ? shifted.trim() : n === 1
        ? `Em ${monthLabel(addMonths(payMonth(), 1))} ela volta como não paga, com ${pickedCard() ? 'o valor da fatura' : 'o mesmo valor'}.`
        : `Próximas: ${[1, 2, 3].map(j => monthLabel(addMonths(payMonth(), j * n))).join(', ')}.`;
    };
    form.elements.rule.addEventListener('change', note);
    $$('[name="scope"]', form).forEach(input => input.addEventListener('change', note));
    form.addEventListener('click', e => {
      const step = e.target.closest('[data-step]');
      if (step) { out.textContent = Math.min(24, Math.max(1, Number(out.textContent) + Number(step.dataset.step))); note(); }
    });
    note();
    preview();
    form.onsubmit = async e => {
      e.preventDefault();
      const card = pickedCard() ? form.elements.card.value : '', cardNow = pickedBill();
      const amount = cardNow ? cardNow.amount : parseMoney(form.elements.amount.value);
      if (amount === null) { $('[data-error]', form).hidden = false; return form.elements.amount.focus(); }
      const text = form.elements.text.value.trim();
      if (!text) return form.elements.text.focus();
      const calculation = calculationFields();
      if (calculation.calcMode === 'occurrence' && !calculation.weekdays) { toast('Escolha ao menos um dia da semana.'); return; }
      if (calculation.unitAmount > 100000000) { toast('O valor máximo por sessão é R$ 1.000.000,00.'); return; }
      const due = card && cardNow ? Number(cardNow.due.slice(8, 10)) : Number(form.elements.due.value);
      const patch = {text, ...billSnapshot({...calculation, amount, month: payMonth()}), due, repeat: form.elements.rule.value !== 'none', every: form.elements.rule.value === 'none' ? 1 : months(), month: payMonth()};
      const scope = recurring ? form.elements.scope.value : 'one';
      $('.n-ok', form).disabled = true;
      let changed = false;
      await commitMany(() => {
        const ops = bill ? editBillOps(state, bill, patch, scope, expectedRule) : [{collection: 'bills', id: chain, patch: {...patch, done: false}}];
        changed = ops.length > 0;
        if (changed && card !== (state.cardLinks?.[chain]?.card || '')) ops.push({collection: 'cardLinks', id: chain, patch: {card}});
        return ops;
      });
      closeSheet();
      toast(!changed ? 'Esta conta mudou ou foi removida. Abra novamente.' : bill ? 'Conta atualizada.' : 'Conta adicionada.');
    };
    $('[data-delete]', form)?.addEventListener('click', () => deleteBillSheet(bill));
  });
}

function billActionsSheet(id, fromCatalog) {
  const bill = findBill(id, fromCatalog);
  if (!bill || bill.deleted || bill.skipped) return;
  openSheet(`<div class="n-form">${sheetTop(esc(bill.text), '')}<p class="n-note">${billDate(bill)} · ${money(bill.amount)}</p><button class="n-btn n-gray" data-bill-edit-action>Editar</button><button class="n-btn n-gray n-danger" data-bill-delete-action>Excluir</button></div>`, () => {
    $('[data-bill-edit-action]').onclick = () => billSheet(id, fromCatalog);
    $('[data-bill-delete-action]').onclick = () => deleteBillSheet(bill);
  });
}

function deleteBillSheet(bill) {
  const rule = billRule(state, bill), recurring = rule && !rule.deleted && rule.repeat !== false;
  // Deleting only this one keeps the series: say where it shows up next, so it is not a surprise.
  const after = recurring && billCatalog(state, addMonths(bill.month, 1)).find(b => b.recurring && billChain(b.id) === billChain(bill.id));
  openSheet(`<form class="n-form" id="delete-bill-form">${sheetTop('Excluir conta', '')}<h3 class="n-delete-title">Excluir ${esc(bill.text)}?</h3><p class="n-note">${billDate(bill)} · ${money(bill.amount)}</p>
    ${recurring ? `<fieldset class="n-bill-scope"><legend>O que excluir?</legend><label><input type="radio" name="scope" value="one" checked><span>Somente este vencimento<small>A recorrência continua${after ? `: volta em ${monthName(after.month)} com ${money(after.amount)}` : ' no próximo vencimento'}. Para parar de vez, escolha “Este e os próximos”.</small></span></label><label><input type="radio" name="scope" value="future"><span>Este e os próximos<small>Encerra a recorrência. Preserva o histórico anterior e os outros já pagos.</small></span></label></fieldset>` : '<p class="n-text-block">Esta conta será removida.</p>'}
    <button class="n-btn n-red n-wide" type="submit" data-confirm-delete>${recurring ? 'Excluir este vencimento' : 'Excluir conta'}</button></form>`, () => {
    const form = $('#delete-bill-form');
    $$('[name="scope"]', form).forEach(input => input.onchange = () => { $('[data-confirm-delete]', form).textContent = form.elements.scope.value === 'future' ? 'Excluir este e os próximos' : 'Excluir este vencimento'; });
    form.onsubmit = async e => {
      e.preventDefault();
      const scope = recurring ? form.elements.scope.value : 'one';
      $('[data-confirm-delete]', form).disabled = true;
      let inverse = [], applied = [], user = owner;
      await commitMany(() => {
        applied = deleteBillOps(state, bill, scope);
        inverse = undoBillOps(state, bill, applied);
        return applied;
      });
      closeSheet();
      if (!applied.length) { toast('Esta conta mudou ou foi removida. Abra novamente.'); return; }
      toast(scope === 'future' ? 'Conta excluída e recorrência encerrada.' : 'Vencimento excluído.', async () => {
        await commitMany(() => {
          if (owner !== user || applied.some(op => Object.entries(op.patch).some(([k, v]) => state[op.collection][op.id]?.[k] !== v))) { toast('A conta mudou. Não foi possível desfazer.'); return []; }
          toast('Exclusão desfeita.');
          return inverse;
        });
      });
    };
  });
}

function sectionSheet(id) {
  const section = id ? state.sections[id] : null;
  const canDelete = section && sections().length > 1;
  openSheet(`<form class="n-form" id="section-form">${sheetTop(section ? 'Editar seção' : 'Nova seção')}
    <input name="name" required maxlength="100" placeholder="Nome da seção" aria-label="Nome da seção" value="${esc(section?.name || '')}" autofocus>
    ${canDelete ? '<div class="n-sheet-actions"><button type="button" class="n-btn n-gray n-danger" data-delete>Excluir seção</button></div>' : ''}
  </form>`, () => {
    const form = $('#section-form');
    form.onsubmit = e => {
      e.preventDefault();
      const name = form.elements.name.value.trim();
      if (!name) return;
      const order = section ? {} : {order: Math.max(-1, ...sections().map(s => s.order)) + 1};
      commit('sections', id || uid(), {name, ...order});
      closeSheet();
    };
    $('[data-delete]', form)?.addEventListener('click', () => deleteSectionSheet(id));
  });
}

function deleteSectionSheet(id) {
  const items = [...live(state, 'tasks'), ...live(state, 'repeats')].filter(x => x.section === id);
  const others = sections().filter(s => s.id !== id);
  if (!items.length) { commit('sections', id, {deleted: true}); closeSheet(); return; }
  const count = items.filter(x => state.tasks[x.id] === x).length, repeats = items.length - count;
  const what = [count ? plural(count, 'tarefa', 'tarefas') : '', repeats ? plural(repeats, 'repetição', 'repetições') : ''].filter(Boolean).join(' e ');
  openSheet(`<form class="n-form" id="move-form">${sheetTop(`Excluir ${esc(state.sections[id].name)}`, '')}
    <p class="n-text-block">${cap(what)} desta seção ${items.length === 1 ? 'vai' : 'vão'} para:</p>
    <div class="n-chips">${others.map((s, i) => `<label class="n-chip"><input type="radio" name="target" value="${s.id}" ${i === 0 ? 'checked' : ''}><span>${esc(s.name)}</span></label>`).join('')}</div>
    <button class="n-btn n-red n-wide">Excluir e mover</button>
  </form>`, () => {
    $('#move-form').onsubmit = e => {
      e.preventDefault();
      const target = e.target.elements.target.value;
      commitMany([...items.map(x => ({collection: state.tasks[x.id] === x ? 'tasks' : 'repeats', id: x.id, patch: {section: target}})), {collection: 'sections', id, patch: {deleted: true}}]);
      closeSheet();
    };
  });
}

async function loginSheet() {
  const methods = await fetch('/api/login-methods').then(r => r.json()).catch(() => ({passkey: false}));
  const withPasskey = methods.passkey && passkeySupported;
  if (withPasskey) void prepareLogin();
  const choices = methods.users || [];
  const last = localStorage.getItem('notas-who');
  const chosen = choices.some(u => u.id === last) ? last : choices[0]?.id;
  // The hidden username lets the password manager keep one entry per person.
  const who = choices.length > 1 ? `<fieldset class="n-fieldset"><legend>Quem está entrando?</legend><div class="n-chips">${choices.map(u => `<label class="n-chip n-person"><input type="radio" name="user" value="${esc(u.id)}" ${u.id === chosen ? 'checked' : ''}><span><i style="background:${u.color}"></i>${esc(u.name)}</span></label>`).join('')}</div></fieldset>
    <input class="n-sr" type="text" name="username" autocomplete="username" tabindex="-1" aria-hidden="true" value="${esc(chosen || '')}">` : '';
  openSheet(`<form class="n-form" id="login-form">${sheetTop('Entrar', '')}
    ${withPasskey ? '<button type="button" class="n-btn n-yellow n-wide" data-passkey-login>Entrar com passkey</button>' : ''}
    ${who}
    <input name="password" type="password" autocomplete="current-password" required placeholder="Senha" aria-label="Senha" ${withPasskey ? '' : 'autofocus'}>
    <p class="n-error" data-error hidden></p>
    <button class="n-btn ${withPasskey ? 'n-gray' : 'n-yellow'} n-wide">Entrar com senha</button>
  </form>`, () => {
    const form = $('#login-form');
    const userField = () => form.elements.user?.value || '';
    form.addEventListener('change', e => { if (e.target.name === 'user' && form.elements.username) form.elements.username.value = e.target.value; });
    const fail = message => { const el = $('[data-error]', form); el.textContent = message; el.hidden = false; };
    const done = async () => { closeSheet(); needsLogin = false; sessionLoaded = false; await sync(); await ensureLocal(); render(); void sync(); };
    form.onsubmit = async e => {
      e.preventDefault();
      try {
        const r = await fetch('/api/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({user: userField(), password: form.elements.password.value})});
        if (!r.ok) throw Error((await r.json()).error);
        if (userField()) localStorage.setItem('notas-who', userField());
        await done();
      } catch (err) { fail(err.message === 'Senha incorreta' ? 'Senha incorreta.' : err.message); }
    };
    $('[data-passkey-login]', form)?.addEventListener('click', async () => {
      try { await passkeyLogin(); await done(); }
      catch (err) {
        void prepareLogin();
        if (err.name !== 'NotAllowedError' && err.name !== 'AbortError') fail(err.message || 'Não foi possível entrar com a passkey.');
      }
    });
  });
}

// ---------- Passkeys ----------
// The browser API takes and returns ArrayBuffers; the server speaks base64url JSON.
// Options are fetched ahead of the tap: Safari only opens Face ID while the tap's
// user activation is still fresh, and a network round trip can use it up.

const passkeySupported = !!window.PublicKeyCredential;
const b64u = {
  enc: buf => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''),
  dec: s => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(s.length / 4) * 4, '=')), c => c.charCodeAt(0)),
};
const fresh = o => o && Date.now() - o.at < 4 * 60000;
const credentialIds = list => (list || []).map(c => ({...c, id: b64u.dec(c.id)}));

async function prepareRegister() {
  try { regOptions = {at: Date.now(), value: await (await api('/api/passkey/register-options', {method: 'POST'})).json()}; } catch { regOptions = null; }
}
async function prepareLogin() {
  loginOptions = null;
  loginOptionsError = null;
  try {
    const r = await fetch('/api/passkey/login-options', {method: 'POST'});
    const value = await r.json();
    if (!r.ok) throw Error(value?.error === 'Origem inválida'
      ? 'Este endereço não permite entrar. Abra o Notas pelo endereço configurado no servidor.'
      : value?.error || 'Não foi possível preparar a passkey. Tente novamente ou entre com a senha.');
    if (typeof value?.challenge !== 'string' || !/^[A-Za-z0-9_-]+$/.test(value.challenge)) throw Error('Não foi possível preparar a passkey. Tente novamente ou entre com a senha.');
    loginOptions = {at: Date.now(), value};
  } catch (e) {
    loginOptionsError = e instanceof TypeError || e instanceof SyntaxError ? Error('Sem conexão com o servidor ou resposta inválida. Tente novamente.') : e;
  }
}
async function loadPasskeys() {
  try { passkeys = await (await api('/api/passkeys')).json(); render(); } catch {}
}

async function createPasskey() {
  try {
    if (!fresh(regOptions)) await prepareRegister();
    if (!regOptions) throw Error('Sem conexão com o servidor.');
    const o = regOptions.value; regOptions = null;
    const cred = await navigator.credentials.create({publicKey: {...o, challenge: b64u.dec(o.challenge), user: {...o.user, id: b64u.dec(o.user.id)}, excludeCredentials: credentialIds(o.excludeCredentials)}});
    await api('/api/passkey/register', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
      id: cred.id, rawId: b64u.enc(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment, clientExtensionResults: cred.getClientExtensionResults(),
      response: {clientDataJSON: b64u.enc(cred.response.clientDataJSON), attestationObject: b64u.enc(cred.response.attestationObject), transports: cred.response.getTransports?.() || []},
    })});
    await loadPasskeys();
    toast('Passkey criada. Da próxima vez, entre com ela.');
  } catch (e) {
    if (e.name === 'InvalidStateError') toast('Este aparelho já tem uma passkey do Notas.');
    else if (e.name !== 'NotAllowedError' && e.name !== 'AbortError') toast(e.message === 'login' ? 'Entre para criar a passkey.' : 'Não foi possível criar a passkey.');
  } finally { void prepareRegister(); }
}

// ---------- Notifications ----------
// Web Push: the server sends, the service worker shows. On iPhone and iPad only the app added
// to the Home Screen can receive them, and permission must be asked from a tap.
const pushSupported = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window;
const iOSDevice = /iPhone|iPad/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const iosBrowser = iOSDevice && !(navigator.standalone === true || matchMedia('(display-mode: standalone)').matches);
let pushOn = false, pushBusy = false;
const pushSubscription = async () => pushSupported ? (await navigator.serviceWorker.ready).pushManager.getSubscription() : null;
const sendSubscription = sub => api('/api/push/subscribe', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(sub.toJSON())});
const sameKey = (sub, key) => { const k = sub.options?.applicationServerKey; return !k || b64u.enc(k) === key; };
// On each opening, a device already subscribed tells the server again (it may have signed in
// as someone else, or the server may have dropped it). A subscription made with other server
// keys can never work again: it is dropped, and the switch shows off.
async function refreshPush() {
  try {
    let sub = Notification.permission === 'granted' ? await pushSubscription() : null;
    if (sub) {
      const {key} = await (await api('/api/push')).json();
      if (!sameKey(sub, key)) { await sub.unsubscribe(); sub = null; }
    }
    pushOn = !!sub;
    if (sub) await sendSubscription(sub);
  } catch {}
  if (tab === 'ajustes') render();
}
// The worker that shows notifications must be this version's: after an update the new one
// may still be waiting for the old windows to close.
async function currentWorker() {
  const reg = await navigator.serviceWorker.ready;
  await reg.update().catch(() => {});
  const w = reg.installing || reg.waiting;
  if (w) await new Promise(done => {
    const check = () => { if (w.state === 'installed') w.postMessage('skip-waiting'); if (w.state === 'activated' || w.state === 'redundant') done(); };
    w.addEventListener('statechange', check);
    check();
    setTimeout(done, 15000);
  });
  return navigator.serviceWorker.ready;
}
async function setPush(on) {
  if (pushBusy) return;
  pushBusy = true;
  try {
    if (on) {
      if (await Notification.requestPermission() !== 'granted') { toast('Permita notificações para o Notas nos ajustes do sistema.'); return; }
      const {key} = await (await api('/api/push')).json();
      const reg = await currentWorker();
      let sub = await reg.pushManager.getSubscription();
      if (sub && !sameKey(sub, key)) { await sub.unsubscribe(); sub = null; }
      sub ||= await reg.pushManager.subscribe({userVisibleOnly: true, applicationServerKey: b64u.dec(key)});
      await sendSubscription(sub);
      pushOn = true;
      toast('Notificações ligadas neste aparelho.');
    } else {
      await stopPush();
    }
  } catch (e) {
    toast(e.message === 'login' ? 'Entre para ligar as notificações.' : on ? 'Não foi possível ligar as notificações.' : 'Não foi possível desligar as notificações.');
  } finally { pushBusy = false; render(); }
}
// Off on this device: the server forgets it and the browser drops the subscription.
async function stopPush() {
  const sub = await pushSubscription().catch(() => null);
  if (sub) { await api('/api/push/unsubscribe', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({endpoint: sub.endpoint})}).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
  pushOn = false;
}
async function testPush() {
  try {
    const sub = await pushSubscription();
    await api('/api/push/test', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({endpoint: sub?.endpoint || ''})});
    toast('Enviada. Deve chegar em alguns segundos.');
  } catch (e) { toast(e.message === 'login' ? 'Entre para testar.' : e.message || 'Não foi possível enviar.'); }
}
function pushHtml() {
  const head = '<div class="n-group-h"><h2>Notificações</h2></div>';
  const what = 'Avisa quando outra pessoa põe algo nas Compras ou cria um afazer para você ou para todos, e 10 e 5 minutos antes de cada reunião.';
  if (iosBrowser) return `${head}<p class="n-note">No iPhone e no iPad, adicione o Notas à Tela de Início (Compartilhar → Adicionar à Tela de Início) e abra por lá para ligar as notificações.</p>`;
  if (!pushSupported) return `${head}<p class="n-note">Este navegador não recebe notificações.</p>`;
  const denied = Notification.permission === 'denied';
  return `${head}<div class="n-list"><label class="n-row n-plain"><span class="n-text">Neste aparelho</span><input type="checkbox" class="n-switch" data-push-toggle ${pushOn ? 'checked' : ''} ${denied ? 'disabled' : ''}></label>
    ${pushOn ? '<div class="n-row n-plain"><button class="n-text n-accent" data-push-test>Enviar notificação de teste</button></div>' : ''}</div>
    <p class="n-note">${denied ? 'As notificações do Notas estão bloqueadas nos ajustes do sistema ou do navegador. ' : ''}${what} Ligue em cada aparelho onde quer recebê-las.</p>`;
}
// A tapped notification opens its place: in a window already open (message from the service
// worker) or in a new one (?aba= and ?lista= in the address). Whatever was on top (a sheet,
// a page over the tabs) closes first.
function openFromNotification(href) {
  const params = new URL(href, location.href).searchParams, aba = params.get('aba'), lista = params.get('lista');
  if (!aba || !TABS.some(([id]) => id === aba)) return;
  if ($('#sheet')?.open) closeSheet();
  const covered = navigation.current !== 'root';
  if (covered) navigation.back({animate: false});
  switchTab(aba);
  // The router takes a moment to settle after going back before it opens another page.
  if (aba === 'compras' && lista && (lista === 'compras' || (state.lists[lista] && !state.lists[lista].deleted))) setTimeout(() => openCasa(lista), covered ? 350 : 0);
}

async function passkeyLogin() {
  if (!fresh(loginOptions)) await prepareLogin();
  if (!loginOptions) throw loginOptionsError || Error('Sem conexão com o servidor.');
  const o = loginOptions.value; loginOptions = null;
  const cred = await navigator.credentials.get({publicKey: {...o, challenge: b64u.dec(o.challenge), allowCredentials: credentialIds(o.allowCredentials)}});
  const r = await fetch('/api/passkey/login', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({
    id: cred.id, rawId: b64u.enc(cred.rawId), type: cred.type, authenticatorAttachment: cred.authenticatorAttachment, clientExtensionResults: cred.getClientExtensionResults(),
    response: {clientDataJSON: b64u.enc(cred.response.clientDataJSON), authenticatorData: b64u.enc(cred.response.authenticatorData), signature: b64u.enc(cred.response.signature), userHandle: cred.response.userHandle ? b64u.enc(cred.response.userHandle) : undefined},
  })});
  if (!r.ok) throw Error((await r.json()).error);
}

const sqlDate = s => s ? new Date(`${s.replace(' ', 'T')}Z`) : null;
const shortDate = d => `${d.getDate()} de ${MONTHS[d.getMonth()]}`;

function passkeysHtml() {
  const rows = passkeys.map(k => `<div class="n-row n-plain"><button class="n-text n-two" data-passkey="${esc(k.id)}"><span>${esc(k.name)}</span><span class="n-meta">Criada em ${shortDate(sqlDate(k.created))}</span></button><span class="n-chev" aria-hidden="true">›</span></div>`).join('');
  return `<div class="n-group-h"><h2>Passkeys</h2></div>
    <div class="n-list">${rows}${passkeySupported ? '<div class="n-row n-plain"><button class="n-text n-accent" data-new-passkey>Criar passkey neste aparelho</button></div>' : ''}</div>
    <p class="n-note">${passkeySupported ? 'Com uma passkey, você entra com Face ID ou Touch ID, sem digitar a senha.' : 'Este navegador não permite passkeys.'}</p>`;
}

function passkeySheet(id) {
  const k = passkeys.find(x => x.id === id);
  if (!k) return;
  const used = sqlDate(k.last_used);
  openSheet(`<form class="n-form" id="passkey-form">${sheetTop(`Passkey ${esc(k.name)}`, '')}
    <p class="n-text-block">Criada em ${shortDate(sqlDate(k.created))}. ${used ? `Último uso em ${shortDate(used)}.` : 'Ainda não usada.'}</p>
    <p class="n-note">Remover aqui impede o login com ela. Para apagá-la do aparelho, use o app Senhas.</p>
    <button type="button" class="n-btn n-gray n-danger n-wide" data-remove-passkey>Remover passkey</button>
  </form>`, () => {
    $('[data-remove-passkey]').addEventListener('click', async () => {
      try { await api('/api/passkey/delete', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({id})}); closeSheet(); await loadPasskeys(); toast('Passkey removida.'); }
      catch { toast('Não foi possível remover. Verifique a conexão.'); }
    });
  });
}

// ---------- Actions ----------

let toastTimer;
function toast(message, undo) {
  const el = $('#toast');
  el.textContent = message; el.classList.add('is-on');
  if (undo) {
    const button = document.createElement('button'); button.type = 'button'; button.textContent = 'Desfazer';
    button.onclick = () => { button.disabled = true; void undo(); }; el.append(button);
  }
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('is-on'), undo ? 10000 : 3500);
}

function moveToToday(ids) {
  commitMany(ids.map(id => ({collection: 'tasks', id, patch: {date: today(), done: false}})));
  toast(ids.length === 1 ? 'Tarefa movida para hoje.' : `${ids.length} tarefas movidas para hoje.`);
}

function carry(tasks, date) {
  commitMany([...carryOps(tasks, today()), {collection: 'days', id: date, patch: {date, reviewed: true}}]);
  toast(tasks.length === 1 ? '1 tarefa trazida para hoje.' : `${tasks.length} tarefas trazidas para hoje.`);
}

async function exportBackup() {
  try {
    await sync();
    if (queue.length) throw Error('Ainda há alterações sem enviar. Conecte-se e tente de novo.');
    const r = await api('/api/export');
    const url = URL.createObjectURL(await r.blob()), a = document.createElement('a');
    a.href = url; a.download = `notas-${today()}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (e) { toast(e.message === 'login' ? 'Entre para exportar o backup.' : e.message); }
}

async function logout() {
  await sync();
  if (queue.length && !confirm('Há alterações que ainda não foram enviadas e serão perdidas. Sair mesmo assim?')) return;
  // This device stops receiving the notifications of the person leaving.
  await stopPush();
  await fetch('/api/logout', {method: 'POST'}).catch(() => {});
  events?.close(); events = null; clearLocal(); needsLogin = true; render(); loginSheet();
}

let suppressClick = false;
document.addEventListener('input', e => {
  if (e.target.matches('[data-memo-search]')) { memoSearch = e.target.value; const rows = $('#memo-rows'); if (rows) rows.innerHTML = memoRows(); }
  if (!e.target.matches('[data-bill-search]')) return;
  billSearch = e.target.value;
  $('#all-bill-rows').innerHTML = allBillRows();
});
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
  const d = b.dataset;
  if (d.tab) switchTab(d.tab);
  else if ('find' in d) openFinder(d.find);
  else if (d.finderI) runFinder(Number(d.finderI));
  else if (d.ctx) menuAction(d);
  else if ('privateWeek' in d) { privateWeek = !privateWeek; render(); }
  else if (d.week) { weekStart = d.week === '0' ? null : addDays(weekStart || mondayOf(today()), 7 * Number(d.week)); render(); }
  else if ('deleteSelected' in d) { deleteTasks([...selected]); selected.clear(); render(); }
  else if ('clearSelection' in d) { selected.clear(); render(); }
  else if ('close' in d) closeSheet();
  else if ('back' in d) navigation.back();
  else if (d.step) toggleStep(d.stepTask, d.step);
  else if (d.steps) showSteps(d.steps);
  else if (d.toggleOcc) toggleOccurrence(d.toggleOcc, d.date);
  else if (d.toggle && d.collection === 'tasks' && projected(d.toggle)) { const {id, ...fields} = projected(d.toggle); commit('tasks', id, {...fields, done: true}); }
  else if (d.toggle && d.collection === 'bills') toggleBill(d.toggle);
  else if (d.toggle) { const c = d.collection; c === 'tasks' ? toggleTask(d.toggle) : c === 'shopping' ? toggleCart(d.toggle) : c === 'chores' ? toggleChore(d.toggle) : commit(c, d.toggle, {done: !state[c][d.toggle].done}); }
  else if (d.casaOpen) openCasa(d.casaOpen);
  else if (d.casaFilter) { casaFilter = d.casaFilter; render(); }
  else if (d.editChore) choreSheet({id: d.editChore});
  else if ('newChore' in d) choreSheet({list: d.newChore || (casaView !== 'compras' && casaView !== 'foryou' ? casaView : null)});
  else if ('newList' in d) listSheet();
  else if (d.editList) listSheet(d.editList);
  else if ('newNote' in d) noteSheet();
  else if (d.editNote) noteSheet(d.editNote);
  else if (d.openMemo) { if (desktop()) b.blur(); openMemo(d.openMemo); }
  else if ('newMemo' in d) memoSheet();
  else if (d.editMemo) memoSheet(d.editMemo);
  else if (d.memoMenu) memoMenuSheet(d.memoMenu);
  else if (d.pinMemo) commit('memos', d.pinMemo, {pinned: !memoOf(d.pinMemo)?.pinned});
  else if (d.restoreMemo) restoreMemo(d.restoreMemo);
  else if ('emptyTrash' in d) emptyTrash();
  else if ('memoTrashClose' in d) { memoTrash = false; render(); }
  else if ('memoTrash' in d) { if (desktop()) { memoTrash = true; render(); } else navigation.push('apagadas'); }
  else if ('memoSection' in d) { memoSection = memoSection === d.memoSection ? '' : d.memoSection; if (desktop()) memoTrash = false; render(); }
  else if ('mdTask' in d) toggleMemoBox(b);
  else if (d.clearDone) deleteChores(liveChores(state, d.clearDone).filter(c => c.done).map(c => c.id));
  else if (d.editTask && projected(d.editTask)) { const {id, ...fields} = projected(d.editTask); commit('tasks', id, fields).then(() => taskSheet({id})); }
  else if (d.editTask) taskSheet({id: d.editTask});
  else if ('newTask' in d) tab === 'hoje' && hojeDate ? newTaskOn(hojeDate) : taskSheet({when: tab === 'backlog' ? 'backlog' : 'today'});
  else if ('newMeeting' in d) taskSheet({when: 'today', meeting: true});
  else if (d.editRepeat) taskSheet({repeatId: d.editRepeat});
  else if (d.editOccurrence) editOccurrence(d.editOccurrence, d.date);
  else if (d.editBill) billSheet(d.editBill, !!d.catalog);
  else if (d.billActions) billActionsSheet(d.billActions, !!d.catalog);
  else if (d.billFilter) { billFilter = d.billFilter; render(); }
  else if ('newBill' in d) billSheet();
  else if (d.month) { billMonth = d.month; render(); }
  else if (d.billsView) { billsView = d.billsView; render(); }
  else if (d.openMonth) { openMonths.has(d.openMonth) ? openMonths.delete(d.openMonth) : openMonths.add(d.openMonth); render(); }
  else if (d.editSection) sectionSheet(d.editSection);
  else if ('newSection' in d) sectionSheet();
  else if ('selectMode' in d) { selecting = !selecting; selected.clear(); render(); }
  else if (d.select) { selected.has(d.select) ? selected.delete(d.select) : selected.add(d.select); render(); }
  else if ('moveSelected' in d) { moveToToday([...selected]); selecting = false; selected.clear(); render(); }
  else if ('carryLast' in d) { const p = lastPending(state, today()); if (p) carry(p.tasks, p.date); }
  else if ('ignoreLast' in d) { const p = lastPending(state, today()); if (p) commit('days', p.date, {date: p.date, reviewed: true}); }
  else if ('openHistory' in d) { historyDate = (tab === 'hoje' && hojeDate) || today(); navigation.push('history'); }
  else if (d.day) { historyDate = d.day; render(); }
  else if ('shiftDay' in d) shiftHoje(Number(d.shiftDay));
  else if ('railDay' in d) { const step = Number(d.railDay); railDate = step ? addDays(railDate || today(), step) : null; if (railDate === today()) railDate = null; render(); }
  else if ('newOnDay' in d) newTaskOn(d.newOnDay || historyDate);
  else if ('carryDay' in d) { const date = d.carryDay || historyDate; carry(pendingOn(state, date), date); if (d.carryDay) shiftHoje(0); else navigation.back(); }
  else if (d.push) navigation.push(d.push);
  else if ('export' in d) exportBackup();
  else if ('logout' in d) logout();
  else if ('login' in d) loginSheet();
  else if ('newPasskey' in d) createPasskey();
  else if ('pushTest' in d) testPush();
  else if (d.editItem) itemSheet(d.editItem);
  else if ('clearCart' in d) {
    const cart = listed(state).filter(i => i.done);
    commitMany(cart.map(i => ({collection: 'shopping', id: i.id, patch: {listed: false, done: false}})));
    toast(cart.length === 1 ? '1 item tirado da lista.' : `${cart.length} itens tirados da lista.`);
  }
  else if (d.passkey) passkeySheet(d.passkey);
});
document.addEventListener('change', e => {
  if (e.target.matches('[data-tab-pref]')) commit('prefs', 'tabs', {[e.target.dataset.tabPref]: e.target.checked});
  if (e.target.matches('[data-push-toggle]')) setPush(e.target.checked);
  if (e.target.matches('[data-pick-day]') && e.target.value) { const content = e.target.closest('.page-content'); historyDate = e.target.value; render(); if (content) content.scrollLeft = 0; }
});
$('#sheet').addEventListener('click', e => {
  // A click on the backdrop lands on the dialog itself, outside its box.
  if (e.target !== $('#sheet')) return;
  const r = e.target.getBoundingClientRect();
  if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) closeSheet();
});

// Backlog: press and hold to start selecting; swipe left to move one task to today.
let press = null;
// A new touch starts a new gesture; forget any click we meant to swallow.
document.addEventListener('pointerdown', () => { suppressClick = false; }, true);
document.addEventListener('pointerdown', e => {
  const swipe = e.target.closest('[data-swipe]');
  if (!swipe || selecting || e.target.closest('.n-check')) return;
  const row = $('.n-row', swipe);
  press = {id: swipe.dataset.swipe, row, x: e.clientX, y: e.clientY, dx: 0, axis: null, pointer: e.pointerId};
  press.timer = setTimeout(() => {
    if (!press || press.axis) return;
    selecting = true; selected = new Set([press.id]); suppressClick = true; press = null;
    navigator.vibrate?.(10); render();
  }, 450);
});
document.addEventListener('pointermove', e => {
  if (!press || e.pointerId !== press.pointer) return;
  const dx = e.clientX - press.x, dy = e.clientY - press.y;
  if (!press.axis && Math.hypot(dx, dy) > 8) {
    press.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
    clearTimeout(press.timer);
    if (press.axis === 'y') { press = null; return; }
  }
  if (press.axis === 'x') {
    press.dx = Math.min(0, dx);
    press.row.style.transform = `translateX(${press.dx}px)`;
    press.row.closest('.n-swipe').classList.toggle('is-armed', press.dx < -90);
  }
});
function endPress() {
  if (!press) return;
  clearTimeout(press.timer);
  const {row, dx, id, axis} = press;
  press = null;
  if (axis !== 'x') return;
  suppressClick = true;
  row.style.transition = 'transform .2s'; row.style.transform = '';
  setTimeout(() => { row.style.transition = ''; }, 200);
  if (dx < -90) moveToToday([id]);
}
document.addEventListener('pointerup', endPress);
document.addEventListener('pointercancel', endPress);

// Ajustes: drag the handle to reorder sections; arrow keys do the same.
function saveSectionOrder(ids) {
  const ops = ids.map((id, order) => ({collection: 'sections', id, patch: {order}})).filter(op => state.sections[op.id].order !== op.patch.order);
  if (ops.length) commitMany(ops);
}
document.addEventListener('pointerdown', e => {
  const handle = e.target.closest('[data-drag]');
  if (!handle) return;
  e.preventDefault();
  const list = $('#section-list'), row = handle.closest('[data-section-row]');
  // Listen on window: moving the row in the DOM drops any pointer capture on the handle.
  dragging = true; row.classList.add('is-dragging');
  const move = ev => {
    const rows = $$('[data-section-row]', list).filter(r => r !== row);
    const after = rows.find(r => { const box = r.getBoundingClientRect(); return ev.clientY < box.top + box.height / 2; });
    list.insertBefore(row, after || $$('.n-row', list).at(-1));
  };
  const up = () => {
    window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); window.removeEventListener('pointercancel', up);
    row.classList.remove('is-dragging'); dragging = false;
    saveSectionOrder($$('[data-section-row]', list).map(r => r.dataset.sectionRow));
  };
  window.addEventListener('pointermove', move); window.addEventListener('pointerup', up); window.addEventListener('pointercancel', up);
});
document.addEventListener('keydown', e => {
  const handle = e.target.closest?.('[data-drag]');
  if (!handle || !['ArrowUp', 'ArrowDown'].includes(e.key)) return;
  e.preventDefault();
  const ids = sections().map(s => s.id), i = ids.indexOf(handle.dataset.drag), j = i + (e.key === 'ArrowUp' ? -1 : 1);
  if (j < 0 || j >= ids.length) return;
  [ids[i], ids[j]] = [ids[j], ids[i]];
  saveSectionOrder(ids);
  requestAnimationFrame(() => $(`[data-drag="${handle.dataset.drag}"]`)?.focus());
});

// Hoje pages a day back or forward; 0 comes back to today. On the phone the page slides.
function shiftHoje(step, slide = !desktop()) {
  const go = () => { hojeDate = step ? addDays(hojeDate || today(), step) : null; if (hojeDate === today()) hojeDate = null; railDate = hojeDate; cursor = null; render(); const content = $('.page[data-name="root"] .page-content'); if (content) content.scrollTop = 0; };
  const screen = $('.page[data-name="root"] .n-screen'), dir = step > 0 ? 1 : step < 0 ? -1 : hojeDate > today() ? -1 : 1;
  if (!slide || !screen || matchMedia('(prefers-reduced-motion: reduce)').matches) { if (screen) Object.assign(screen.style, {transform: '', opacity: '', transition: ''}); return go(); }
  Object.assign(screen.style, {transition: 'transform .16s ease-in, opacity .16s', transform: `translateX(${-dir * innerWidth * .6}px)`, opacity: '0'});
  setTimeout(() => {
    go();
    Object.assign(screen.style, {transition: 'none', transform: `translateX(${dir * 60}px)`});
    screen.getBoundingClientRect();
    Object.assign(screen.style, {transition: 'transform .2s ease-out, opacity .2s', transform: '', opacity: ''});
  }, 160);
}
// Hoje on the phone: swipe sideways to the day before or after. A mostly vertical move
// keeps scrolling; a held row is a drag, not a swipe.
let daySwipe = null;
document.addEventListener('touchstart', e => {
  daySwipe = null;
  if (tab !== 'hoje' || desktop() || e.touches.length !== 1 || navigation.current !== 'root') return;
  // Anywhere on the page, also the empty space below a short list.
  const screen = e.target.closest('.page[data-name="root"] .page-content')?.querySelector('.n-screen');
  if (!screen || e.target.closest('input, textarea')) return;
  daySwipe = {screen, x0: e.touches[0].clientX, y0: e.touches[0].clientY, dx: 0, on: false, t0: e.timeStamp};
}, {passive: true});
document.addEventListener('touchmove', e => {
  const s = daySwipe;
  if (!s) return;
  if (rowDrag?.active) { daySwipe = null; Object.assign(s.screen.style, {transform: '', opacity: ''}); return; }
  const dx = e.touches[0].clientX - s.x0, dy = e.touches[0].clientY - s.y0;
  if (!s.on) {
    if (Math.abs(dy) > 10 && Math.abs(dy) > Math.abs(dx)) { daySwipe = null; return; }
    if (Math.abs(dx) < 12 || Math.abs(dx) < Math.abs(dy) * 1.5) return;
    s.on = true; s.screen.style.transition = 'none';
  }
  if (e.cancelable) e.preventDefault();
  s.dx = dx;
  Object.assign(s.screen.style, {transform: `translateX(${dx}px)`, opacity: String(1 - Math.min(.5, Math.abs(dx) / 700))});
}, {passive: false});
function endDaySwipe(e) {
  const s = daySwipe;
  daySwipe = null;
  if (!s?.on) return;
  const fast = Math.abs(s.dx) > 40 && e.timeStamp - s.t0 < 300;
  const step = e.type === 'touchend' && (Math.abs(s.dx) > innerWidth * .25 || fast) ? (s.dx < 0 ? 1 : -1) : 0;
  if (step) return shiftHoje(step, true);
  Object.assign(s.screen.style, {transition: 'transform .18s ease-out, opacity .18s', transform: '', opacity: ''});
}
document.addEventListener('touchend', endDaySwipe);
document.addEventListener('touchcancel', endDaySwipe);

// Hoje and the calendar day: drag a task onto another section, or up past the week strip
// onto another day. A touch has to press and hold first, so a quick swipe still scrolls;
// the mouse drags as soon as it moves.
let rowDrag = null;
function moveToSection(id, section) {
  const shown = projected(id), t = shown || state.tasks[id];
  if (!t || t.section === section) return;
  const {id: _, ...fields} = t, before = t.section;
  const ops = [{collection: 'tasks', id, patch: shown ? {...fields, section} : {section}}];
  // As in the form: today's occurrence takes its repeat along to the next days.
  const r = t.date === today() && t.repeat && state.repeats[t.repeat];
  if (r && !r.deleted) ops.push({collection: 'repeats', id: t.repeat, patch: {section}});
  const undo = [{collection: 'tasks', id, patch: {section: before}}, ...(ops[1] ? [{...ops[1], patch: {section: r.section}}] : [])];
  commitMany(ops);
  toast(`Movida para ${sectionName(section)}.`, () => commitMany(undo));
}
// "hoje", "amanhã", "qui, 5 de nov"
const dropDayLabel = date => date === today() ? 'hoje' : date === addDays(today(), 1) ? 'amanhã' : dayShort(date);
function moveToDay(id, date) {
  const shown = projected(id), t = shown || state.tasks[id];
  if (!t || t.date === date) return render();
  const {id: _, ...fields} = t;
  // As in the form: a repeat's occurrence moved to another day leaves the repeat behind,
  // and a task brought from a past day starts over as not done.
  const patch = {date, ...(t.repeat ? {repeat: ''} : {}), ...(t.date < today() && date >= today() ? {done: false} : {})};
  const undo = {date: t.date, ...(t.repeat ? {repeat: t.repeat} : {}), ...('done' in patch ? {done: !!t.done} : {})};
  commitMany([{collection: 'tasks', id, patch: shown ? {...fields, ...patch} : patch}]);
  toast(`Movida para ${dropDayLabel(date)}.`, () => commitMany([{collection: 'tasks', id, patch: undo}]));
}
function startRowDrag() {
  const d = rowDrag;
  if (!d || d.active) return;
  d.active = true; dragging = true; suppressClick = true;
  navigator.vibrate?.(10);
  const box = d.row.getBoundingClientRect();
  d.dx = d.x - box.left; d.dy = d.y - box.top;
  d.ghost = d.row.cloneNode(true);
  d.ghost.classList.add('n-ghost');
  d.ghost.classList.toggle('is-mouse', d.mouse);
  // The ghost sits at the pointer; its offset is a margin, so compacting can animate it.
  d.ghost.style.setProperty('--w', `${box.width}px`);
  d.ghost.style.setProperty('--mx', `${-d.dx}px`);
  d.ghost.style.setProperty('--my', `${-d.dy}px`);
  document.body.append(d.ghost);
  d.row.classList.add('is-lifted');
  document.body.classList.add('is-moving-task');
  d.scroller = d.row.closest('.page-content');
  d.date = (projected(d.id) || state.tasks[d.id])?.date || '';
  // The calendar day has its week strip on top. Hoje has none, so one slides in for the drag.
  d.strip = $('.n-week', d.scroller || document);
  if (!d.strip && d.date && d.scroller) {
    const area = (d.row.closest('.d-main') || d.scroller).getBoundingClientRect();
    d.dock = document.createElement('div');
    d.dock.className = 'n-drop-dock';
    Object.assign(d.dock.style, {left: `${area.left}px`, width: `${area.width}px`, top: `${Math.max(0, d.scroller.getBoundingClientRect().top)}px`});
    d.dock.innerHTML = `<p>Arraste até um dia</p><div class="n-week">${weekStrip(mondayOf(d.date), d.date)}</div>`;
    document.body.append(d.dock);
    d.strip = $('.n-week', d.dock);
  }
  d.monday = mondayOf(d.date || today());
  const tick = () => {
    if (rowDrag !== d) return;
    // Near the top or bottom edge, scroll so far-away sections can be reached. Above the
    // week strip's limit the task is aiming at a day, so the list holds still.
    const area = d.scroller?.getBoundingClientRect();
    if (area && !d.compact) {
      const top = d.strip ? d.limit : area.top;
      const edge = 70, up = top + edge - d.y, down = d.y - (area.bottom - edge);
      if (up > 0 || down > 0) { d.scroller.scrollTop += up > 0 ? -Math.ceil(up / 6) : Math.ceil(down / 6); aimRowDrag(); }
    }
    requestAnimationFrame(tick);
  };
  aimRowDrag();
  requestAnimationFrame(tick);
}
function aimRowDrag() {
  const d = rowDrag;
  d.ghost.style.transform = `translate(${d.x}px, ${d.y}px)`;
  // Dragged up past the week strip, the task shrinks into a chip and aims at a day.
  d.limit = d.strip ? d.strip.getBoundingClientRect().bottom + 24 : -Infinity;
  const compact = d.y < d.limit;
  if (compact !== d.compact) { d.compact = compact; if (compact) navigator.vibrate?.(5); }
  d.ghost.classList.toggle('is-compact', compact);
  // Near a side of the screen the chip slides in so it stays whole.
  const left = d.mouse ? d.x + 14 : d.x - 88, right = left + 176, top = d.mouse ? d.y + 12 : d.y - 66;
  d.ghost.style.setProperty('--cx', `${Math.max(0, 8 - left) + Math.min(0, innerWidth - 8 - right)}px`);
  d.ghost.style.setProperty('--cy', `${Math.max(0, 4 - top)}px`);
  d.strip?.classList.toggle('is-aiming', compact);
  d.dock?.classList.toggle('is-near', compact);
  const groups = $$('[data-drop-section]', d.scroller || document).filter(g => g.offsetParent);
  // The group under the finger, or the closest one when between groups.
  const distance = g => { const b = g.getBoundingClientRect(); return d.y < b.top ? b.top - d.y : d.y > b.bottom ? d.y - b.bottom : 0; };
  const target = compact ? null : groups.reduce((best, g) => !best || distance(g) < distance(best) ? g : best, null);
  d.target = target && target.dataset.dropSection !== d.from ? target.dataset.dropSection : null;
  groups.forEach(g => g.classList.toggle('is-target', g.dataset.dropSection === d.target));
  // The day (or ‹ ›) closest to the pointer across; the task's own day takes nothing.
  const centre = b => { const r = b.getBoundingClientRect(); return Math.abs(r.left + r.width / 2 - d.x); };
  const near = compact ? $$('[data-day]', d.strip).reduce((best, b) => !best || centre(b) < centre(best) ? b : best, null) : null;
  const step = near?.dataset.weekStep ? Number(near.dataset.weekStep) : 0;
  d.day = near && !step && near.dataset.day !== d.date ? near.dataset.day : null;
  if (d.strip) $$('.n-day', d.strip).forEach(b => b.classList.toggle('is-drop', b.dataset.day === d.day));
  // Held over ‹ or ›, the strip turns a week every half second.
  if (step !== d.step) {
    clearTimeout(d.pageTimer);
    d.step = step;
    if (step) d.pageTimer = setTimeout(() => {
      if (rowDrag !== d) return;
      d.monday = addDays(d.monday, step); d.step = 0;
      d.strip.innerHTML = weekStrip(d.monday, d.date);
      navigator.vibrate?.(5);
      aimRowDrag();
    }, 550);
  }
}
function endRowDrag(e) {
  const d = rowDrag;
  if (!d || (e && e.pointerId !== d.pointer)) return;
  clearTimeout(d.timer);
  clearTimeout(d.pageTimer);
  rowDrag = null;
  if (!d.active) return;
  d.ghost.remove();
  d.dock?.remove();
  d.row.classList.remove('is-lifted');
  document.body.classList.remove('is-moving-task');
  $$('[data-drop-section].is-target').forEach(g => g.classList.remove('is-target'));
  dragging = false;
  if (d.day && e?.type === 'pointerup') moveToDay(d.id, d.day);
  else if (d.target && e?.type === 'pointerup') moveToSection(d.id, d.target);
  else render();
}
document.addEventListener('pointerdown', e => {
  if (rowDrag || e.button !== 0) return;
  const row = e.target.closest('[data-drop-section] .n-row[data-row]');
  if (!row || e.target.closest('.n-check')) return;
  rowDrag = {id: row.dataset.row, row, from: row.closest('[data-drop-section]').dataset.dropSection, x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY, pointer: e.pointerId, mouse: e.pointerType === 'mouse', active: false};
  if (!rowDrag.mouse) rowDrag.timer = setTimeout(startRowDrag, 380);
});
document.addEventListener('pointermove', e => {
  const d = rowDrag;
  if (!d || e.pointerId !== d.pointer) return;
  d.x = e.clientX; d.y = e.clientY;
  if (d.active) { aimRowDrag(); return; }
  if (Math.hypot(d.x - d.x0, d.y - d.y0) > (d.mouse ? 5 : 8)) {
    // The mouse starts dragging; a finger that moves before the hold is scrolling.
    if (d.mouse) startRowDrag(); else { clearTimeout(d.timer); rowDrag = null; }
  }
});
document.addEventListener('pointerup', endRowDrag);
document.addEventListener('pointercancel', endRowDrag);
// Once a held row is moving, the finger must not scroll the page or open a menu.
document.addEventListener('touchmove', e => { if (rowDrag?.active) e.preventDefault(); }, {passive: false});
document.addEventListener('contextmenu', e => { if (rowDrag && !desktop()) e.preventDefault(); });
addEventListener('keydown', e => { if (e.key === 'Escape' && rowDrag) endRowDrag(); });

// Casa lists: Return adds (with @who and the day parsed) and keeps the keyboard open.
document.addEventListener('submit', e => {
  if (e.target.id !== 'add-chore') return;
  e.preventDefault();
  const input = e.target.elements.entry;
  addChore(input.value, e.target.dataset.list);
  input.value = '';
  input.focus({preventScroll: true});
});
// Passos: Return adds the step and keeps the keyboard open for the next one.
document.addEventListener('submit', e => {
  const form = e.target.closest?.('[data-add-step]');
  if (!form) return;
  e.preventDefault();
  const input = form.elements.entry, text = input.value.trim(), task = state.tasks[form.dataset.addStep];
  if (!text || !task || task.deleted) return;
  input.value = '';
  addStep(task, text);
});
// Compras: Return adds the item and keeps the keyboard open for the next one.
document.addEventListener('submit', e => {
  if (e.target.id !== 'add-item') return;
  e.preventDefault();
  const input = e.target.elements.entry;
  addItem(input.value);
  input.value = '';
  input.focus({preventScroll: true});
});
document.addEventListener('pointerdown', e => { if (e.target.closest('[data-keep-focus]')) e.preventDefault(); });

// ---------- Desktop ----------
// From 960px wide (the app installed on a computer) the same data gets a sidebar,
// a toolbar and layouts that use the width: Hoje with a side column, Agenda as a
// week, Contas as a table. Mouse and keyboard replace swipes and long presses.

const wideQuery = matchMedia('(min-width: 960px)');
const desktop = () => wideQuery.matches;
wideQuery.addEventListener('change', () => { selecting = false; selected.clear(); cursor = null; closeFinder(); closeMenu(); render(); });
const KEY = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent) ? '⌘' : 'Ctrl+';
// Week shown in Agenda (its Monday; null follows today), keyboard cursor, range anchor.
// The private week paints every meeting as the same dark block, with no text and no
// current-time line, so a screenshot shows only when you are busy.
let weekStart = null, privateWeek = false, cursor = null, anchor = null, finder = null, dragIds = null;

// A meeting on the agenda: its task row, or a repeat's day not created yet (for the right-click menu).
const rowAttr = (m, date) => m.repeats ? `data-occ-row="${esc(m.id)}" data-occ-date="${date}"` : `data-row="${m.id}"`;

// Sections have no color of their own; the order in Ajustes picks one.
const SECTION_COLORS = ['#64d2ff', '#bf5af2', '#ff9f0a', '#30d158', '#ff375f', '#5e5ce6', '#ffd60a', '#ac8e68'];
function sectionColor(id) {
  const i = sections().findIndex(s => s.id === id);
  return i < 0 ? '#8e8e93' : SECTION_COLORS[i % SECTION_COLORS.length];
}
const dot = id => `<i class="d-dot" style="background:${sectionColor(id)}" aria-hidden="true"></i>`;
const minutes = toMinutes;
const clock = m => `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`;
const nowMinutes = () => { const d = new Date(); return d.getHours() * 60 + d.getMinutes(); };
const mondayOf = date => addDays(date, -((weekday(date) + 6) % 7));
const mainTabs = () => visibleTabs().filter(([id]) => id !== 'ajustes');

function sidebarHtml() {
  const month = today().slice(0, 7);
  const counts = {hoje: todayTasks().filter(t => !t.done).length, reunioes: todayMeetings().filter(t => !t.done).length, backlog: backlog().length, notas: memosUnseen(), compras: forYou().length, contas: live(state, 'bills').filter(b => b.month === month && !b.done).length};
  const nav = mainTabs().map(([id, label], i) => `<button class="d-nav ${tab === id ? 'is-on' : ''}" data-tab="${id}" ${id === 'hoje' ? 'data-drop-today' : ''} ${tab === id ? 'aria-current="page"' : ''} title="${label} (${KEY}${i + 1})">${tabIcon(id)}<span>${label}</span><em>${counts[id] || ''}</em></button>`).join('');
  const pending = live(state, 'tasks').filter(t => !t.done && (t.date === '' || t.date === today()));
  // In Notas a section filters the notes (and counts them); elsewhere it searches its tasks.
  const noted = tab === 'notas' ? memos() : null;
  const secs = sections().map(s => {
    const n = (noted || pending).filter(t => t.section === s.id).length;
    return noted ? `<button class="d-sec ${memoSection === s.id ? 'is-on' : ''}" data-memo-section="${esc(s.id)}" aria-pressed="${memoSection === s.id}" title="Só as notas de ${esc(s.name)}">${dot(s.id)}<span>${esc(s.name)}</span><em>${n || ''}</em></button>`
      : `<button class="d-sec" data-find="${esc(s.name)}" title="Buscar em ${esc(s.name)}">${dot(s.id)}<span>${esc(s.name)}</span><em>${n || ''}</em></button>`;
  }).join('');
  const sync = needsLogin ? '<button class="d-sync is-off" data-login>Entre para sincronizar</button>'
    : `<span class="d-sync ${online ? '' : 'is-off'}">${!online ? 'Sem conexão' : queue.length ? 'Enviando…' : 'Sincronizado'}</span>`;
  const who = me ? `<span class="n-avatar d-avatar" style="background:${me.color || 'var(--yellow)'}" aria-hidden="true">${esc(me.name[0])}</span><span class="d-who"><b>${esc(me.name)}</b>${sync}</span>` : `<span class="d-who">${sync}</span>`;
  return `<div class="d-side-top"></div><div class="d-navs">${nav}</div>${casaSidebar()}<h2 class="d-side-h">Seções</h2><div class="d-secs">${secs}</div>
    <div class="d-side-foot">${who}<button class="d-gear ${tab === 'ajustes' ? 'is-on' : ''}" data-tab="ajustes" aria-label="Ajustes" title="Ajustes (${KEY},)">${ICONS.ajustes}</button></div>`;
}

function toolbar(title, sub, end = '') {
  return `<header class="d-tb"><div class="d-tb-title"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="d-tb-end">${end}<button class="d-search" data-find="" title="Buscar (${KEY}K)">${ICONS.search}<span>Buscar</span><kbd>${KEY}K</kbd></button></div></header>`;
}
const deskAdd = (label, attr) => `<button class="d-add" ${attr}>${ICONS.plus}<span>${label}</span></button>`;

function deskHoje() {
  const date = hojeDate, tasks = hojeTasks(), ahead = date > today();
  const sub = `${longDate(date || today())}${tasks.length ? ` · ${ahead ? plural(tasks.length, 'prevista', 'previstas') : `${doneCount(tasks)} de ${tasks.length} feitas`}` : ''}`;
  const pending = date && !ahead ? pendingOn(state, date).length : 0;
  const pages = `<span class="d-steps">${date ? '<button class="d-tool" data-shift-day="0">Hoje</button>' : ''}${dayArrows('d-tool')}</span>`;
  const end = `${pages}<button class="d-tool" data-open-history>${ICONS.cal}<span>Calendário</span></button>${pending ? `<button class="d-tool" data-carry-day="${date}">Trazer ${pending === 1 ? '1 pendente' : `${pending} pendentes`}</button>` : ''}${!date || ahead ? deskAdd('Nova tarefa', 'data-new-task') : ''}`;
  if (date) {
    const body = tasks.length ? sectionGroups(tasks, 'edit', list => ahead ? list.length : `${doneCount(list)} de ${list.length}`) : `<p class="d-empty">${ahead ? 'Nada previsto para este dia.' : 'Nada neste dia.'}</p>`;
    return `${toolbar(dayTitle(date), sub, end)}<div class="d-split"><div class="d-main">${statusHtml()}${body}</div>${hojeRail()}</div>`;
  }
  const example = sections()[0]?.name.split(' ')[0] || 'seção';
  const quick = `<form class="d-quick" id="quick-task">${ICONS.plus}<input name="entry" placeholder="Nova tarefa para hoje. Ex.: Revisar PR 15h #${esc(example)}" autocomplete="off" maxlength="10000" aria-label="Nova tarefa para hoje" aria-describedby="quick-chips"><kbd>N</kbd></form><div class="d-chips" id="quick-chips" aria-live="polite"></div>`;
  const casa = hojeCasaGroup();
  const body = tasks.length || casa ? sectionGroups(tasks, 'edit', list => `${doneCount(list)} de ${list.length}`) + casa : '<p class="d-empty">Nada para hoje. Escreva acima e tecle Return.</p>';
  return `${toolbar('Hoje', sub, end)}<div class="d-split"><div class="d-main">${statusHtml()}${hojeBanner()}${quick}${body}</div>${hojeRail()}</div>`;
}

function drawQuickChips() {
  const input = $('#quick-task input'), out = $('#quick-chips');
  if (!input || !out) return;
  const parsed = parseQuickTask(input.value, sections()), section = parsed.section || lastSection();
  out.innerHTML = parsed.text ? `<span class="d-chip">${dot(section)}${esc(sectionName(section))}</span>${parsed.time ? `<span class="d-chip">${shortTime(parsed.time)}</span>` : ''}<span class="d-chip-hint">Return adiciona em Hoje</span>` : '';
}

function hojeRail() {
  const prefs = tabPrefs(state), cards = [], now = nowMinutes();
  // The agenda card pages through days on its own (railDate; null is today) and follows Hoje when it pages.
  const date = railDate || today(), past = date < today(), isToday = date === today();
  const meetings = byTime(date > today() ? weekMeetings(date) : todayMeetings(date));
  if (prefs.reunioes || meetings.length || railDate) {
    let marked = false;
    const rows = meetings.map(t => {
      const start = t.time ? minutes(t.time) : null, soon = isToday && start !== null && start > now && start - now <= 60;
      const line = isToday && !marked && start !== null && start > now ? (marked = true, `<div class="d-now"><b>${clock(now)}</b><hr></div>`) : '';
      const gone = past || (isToday && start !== null && minutes(meetingEnd(t)) <= now);
      const timeHtml = t.time ? (t.meeting || t.end ? `${esc(shortTime(t.time))}<br>${esc(shortTime(meetingEnd(t)))}` : esc(shortTime(t.time))) : '·';
      const openAttr = t.repeats ? `data-edit-occurrence="${t.id}" data-date="${date}"` : `data-edit-task="${t.id}"`;
      const toggleAttr = t.repeats ? `data-toggle-occ="${t.id}" data-date="${date}"` : `data-toggle="${t.id}" data-collection="tasks"`;
      return `${line}<div class="d-ev ${t.done ? 'is-done' : ''} ${gone && !t.done ? 'is-past' : ''} ${t.done && settling.has(t.id) ? 'is-settling' : ''}" ${rowAttr(t, date)}><b class="d-ev-time">${timeHtml}</b><button class="d-ev-body" ${openAttr} style="--c:${sectionColor(t.section)}"><span class="d-ev-name">${esc(t.text)}</span><small class="${!t.done && soon ? 'n-accent' : ''}">${!t.done && soon ? `em ${start - now} min` : esc(sectionName(t.section))}</small></button><button class="n-check d-ev-check" ${toggleAttr} aria-pressed="${!!t.done}" aria-label="${t.done ? 'Desmarcar' : 'Concluir'} ${esc(t.text)}" title="${t.done ? 'Desmarcar' : 'Marcar como concluída'}">${ICONS.check}</button></div>`;
    }).join('');
    const title = isToday ? 'Agenda de hoje' : `Agenda · ${dayTitle(date)}`;
    const count = meetings.length ? `<span class="d-card-count">${doneCount(meetings)}/${meetings.length}</span>` : '';
    const steps = `<span class="d-card-steps">${isToday ? '' : '<button class="n-link" data-rail-day="0">Hoje</button>'}<button class="d-tool" data-rail-day="-1" aria-label="Agenda do dia anterior" title="Dia anterior">${ICONS.prev}</button><button class="d-tool" data-rail-day="1" aria-label="Agenda do próximo dia" title="Próximo dia">${ICONS.next}</button>${prefs.reunioes ? '<button class="n-link" data-tab="reunioes">Semana</button>' : ''}</span>`;
    const empty = isToday ? 'Nada na agenda hoje.' : 'Nada na agenda neste dia.';
    cards.push(`<section class="d-card"><div class="d-card-h"><h2>${title}${count}</h2>${steps}</div>${rows || `<p class="d-card-empty">${empty}</p>`}</section>`);
  }
  if (prefs.contas) {
    const day = Number(today().slice(8, 10));
    const due = live(state, 'bills').filter(b => b.month === today().slice(0, 7) && !b.done).sort((a, b) => (a.due || 99) - (b.due || 99)).slice(0, 4);
    const rows = due.map(b => { const late = b.due && b.due < day; return `<button class="d-mini" data-edit-bill="${esc(b.id)}"><span>${esc(b.text)}<small class="${late ? 'is-late' : ''}">${b.due ? `${late ? 'Venceu' : 'Vence'} dia ${b.due}` : 'Sem dia'}</small></span><span class="n-amount">${money(b.amount)}</span></button>`; }).join('');
    cards.push(`<section class="d-card"><div class="d-card-h"><h2>Contas a pagar</h2><button class="n-link" data-tab="contas">Ver todas</button></div>${rows || '<p class="d-card-empty">Tudo pago neste mês.</p>'}</section>`);
  }
  if (prefs.compras) {
    const {toBuy} = shoppingParts(), color = id => people.find(p => p.id === id)?.color || 'var(--secondary)';
    const rows = toBuy.slice(0, 5).map(i => `<button class="d-mini" data-casa-open="compras"><i class="d-ring" style="--who:${color(i.by)}"></i><span>${esc(i.text)}</span></button>`).join('');
    cards.push(`<section class="d-card"><div class="d-card-h"><h2>Compras</h2><button class="n-link" data-casa-open="compras">${toBuy.length > 5 ? `Mais ${toBuy.length - 5}` : 'Abrir'}</button></div>${rows || '<p class="d-card-empty">Lista vazia.</p>'}</section>`);
  }
  return `<aside class="d-rail" aria-label="Resumo do dia">${cards.join('')}</aside>`;
}

// Agenda of one day (meetings and anything with a time): the ones already on that date (one-off, or a repeat's
// occurrence) plus the repeats whose occurrence was not created for it, such as
// future days or days the app was not opened.
function weekMeetings(date) {
  const projected = live(state, 'repeats').filter(r => onAgenda(r) && repeatsOn(r, date) && !state.tasks[occurrenceId(r.id, date)]).map(r => ({...r, repeats: true}));
  return [...tasksOn(date).filter(onAgenda), ...projected];
}
function weekLabel(first, last) {
  const day = d => Number(d.slice(8, 10)), month = d => MONTHS[Number(d.slice(5, 7)) - 1];
  return first.slice(0, 7) === last.slice(0, 7) ? `${day(first)} a ${day(last)} de ${month(last)}` : `${day(first)} de ${month(first)} a ${day(last)} de ${month(last)}`;
}

function deskReunioes() {
  const monday = weekStart || mondayOf(today()), now = nowMinutes(), HOUR = 56;
  const days = Array.from({length: 7}, (_, i) => addDays(monday, i)).map(date => ({date, list: weekMeetings(date)})).filter((d, i) => i < 5 || d.list.length);
  const timed = days.flatMap(d => d.list.filter(m => m.time));
  const first = Math.min(8 * 60, ...timed.map(m => Math.floor(minutes(m.time) / 60) * 60)), last = Math.max(19 * 60, ...timed.map(m => Math.ceil(minutes(meetingEnd(m)) / 60) * 60));
  const y = m => (m - first) / 60 * HOUR;
  const cols = `--days:${days.length}`;
  const block = (m, date) => {
    const {start, stop} = m, gone = date < today() || (date === today() && stop <= now);
    const heightPx = Math.max(y(stop) - y(start) - 2, 18);
    const box = `top:${y(start) + 1}px;height:${heightPx}px;left:calc(${m.lane} * 100% / ${m.lanes} + 3px);width:calc(100% / ${m.lanes} - 6px)`;
    if (privateWeek) {
      const open = m.repeats ? `data-edit-occurrence="${m.id}" data-date="${date}"` : `data-edit-task="${m.id}" data-row="${m.id}"`;
      return `<button class="d-evt is-private" ${open} aria-label="Ocupado, ${timeLabel(m)}" style="${box}"></button>`;
    }
    const open = m.repeats ? `data-edit-occurrence="${m.id}" data-date="${date}"` : `data-edit-task="${m.id}"`;
    const toggle = m.repeats ? `data-toggle-occ="${m.id}" data-date="${date}"` : `data-toggle="${m.id}" data-collection="tasks"`;
    return `<div class="d-evt ${gone && !m.done ? 'is-past' : ''} ${m.done ? 'is-done' : ''} ${m.done && settling.has(m.id) ? 'is-settling' : ''} ${heightPx < 34 ? 'is-short' : ''}" ${rowAttr(m, date)} style="--c:${sectionColor(m.section)};${box}" title="${esc(m.text)}, ${timeLabel(m)} · ${esc(sectionName(m.section))}${m.repeats ? ` · ${esc(repeatLabel(m))}` : ''}"><button class="d-evt-hit" ${open}><b>${esc(m.text)}</b><span>${timeLabel(m)}</span></button><button class="d-evt-check" ${toggle} aria-pressed="${!!m.done}" aria-label="${m.done ? 'Desmarcar' : 'Concluir'} ${esc(m.text)}" title="${m.done ? 'Desmarcar' : 'Marcar como concluída'}">${ICONS.check}</button></div>`;
  };
  const head = `<div class="d-wk-h" style="${cols}"><span></span>${days.map(d => `<div class="d-wk-day ${d.date === today() ? 'is-today' : ''}"><small>${WEEK[weekday(d.date)].slice(0, 3)}</small><b>${Number(d.date.slice(8, 10))}</b></div>`).join('')}</div>`;
  const untimed = !privateWeek && days.some(d => d.list.some(m => !m.time))
    ? `<div class="d-wk-all" style="${cols}"><span>Sem horário</span>${days.map(d => `<div>${d.list.filter(m => !m.time).map(m => `<div class="d-chip d-evt-chip ${m.done ? 'is-done' : ''}" ${rowAttr(m, d.date)} style="--c:${sectionColor(m.section)}"><button class="d-evt-chip-hit" ${m.repeats ? `data-edit-occurrence="${m.id}" data-date="${d.date}"` : `data-edit-task="${m.id}"`}>${esc(m.text)}</button><button class="d-evt-check" ${m.repeats ? `data-toggle-occ="${m.id}" data-date="${d.date}"` : `data-toggle="${m.id}" data-collection="tasks"`} aria-pressed="${!!m.done}" aria-label="${m.done ? 'Desmarcar' : 'Concluir'} ${esc(m.text)}" title="${m.done ? 'Desmarcar' : 'Marcar como concluída'}">${ICONS.check}</button></div>`).join('')}</div>`).join('')}</div>` : '';
  const hours = [];
  for (let m = first + 60; m < last; m += 60) hours.push(`<span style="top:${y(m)}px">${clock(m)}</span>`);
  const nowLine = !privateWeek && days.some(d => d.date === today()) && now >= first && now <= last;
  const grid = `<div class="d-wk-b" style="${cols};height:${y(last)}px"><div class="d-wk-gut">${hours.join('')}${nowLine ? `<span class="is-now" style="top:${y(now)}px">${clock(now)}</span>` : ''}</div>
    ${days.map(d => `<div class="d-wk-col ${d.date === today() ? 'is-today' : ''}" data-slot-day="${d.date}" data-first="${first}" data-hour="${HOUR}" style="--hour:${HOUR}px">${meetingLanes(d.list.filter(m => m.time).map(m => ({...m, start: minutes(m.time), stop: minutes(meetingEnd(m))}))).map(m => block(m, d.date)).join('')}${d.date === today() && nowLine ? `<div class="d-wk-now" style="top:${y(now)}px"></div>` : ''}</div>`).join('')}${nowLine ? `<div class="d-wk-now-all" style="top:${y(now)}px"></div>` : ''}</div>`;
  const end = `<div class="d-pager"><button class="d-tool" data-week="-1" aria-label="Semana anterior">‹</button><button class="d-tool" data-week="0" ${weekStart ? '' : 'disabled'}>Esta semana</button><button class="d-tool" data-week="1" aria-label="Próxima semana">›</button></div><button class="d-tool ${privateWeek ? 'is-on' : ''}" data-private-week aria-pressed="${privateWeek}" title="${privateWeek ? 'Mostrar a agenda' : 'Só mostrar horários ocupados'}">${ICONS.eye}</button>${deskAdd('Nova reunião', 'data-new-meeting')}`;
  return `${toolbar('Agenda', weekLabel(days[0].date, days.at(-1).date), end)}<div class="d-week">${statusHtml()}${head}${untimed}${grid}</div>`;
}

function deskBacklog() {
  const tasks = backlog(), waiting = scheduled().filter(t => !(meetingsApart() && t.meeting)), late = overdue().length;
  const body = tasks.length ? sectionGroups(tasks, 'pick', list => list.length)
    : waiting.length || late ? '' : '<div class="n-empty"><p>Backlog vazio.</p><div class="n-btns"><button class="n-btn n-yellow" data-new-task>Nova tarefa</button></div></div>';
  const hint = tasks.length || late ? `<p class="d-hint">Clique para selecionar, ${KEY === '⌘' ? '⌘' : 'Ctrl'}-clique para somar e Shift-clique para um intervalo. Arraste até Hoje, na barra lateral, ou use ${KEY}Return.</p>` : '';
  return `${toolbar('Backlog', `${plural(tasks.length, 'tarefa', 'tarefas')}${late ? ` · ${late} ${late === 1 ? 'ficou' : 'ficaram'} para trás` : ''}`, deskAdd('Nova tarefa', 'data-new-task'))}<div class="d-main d-narrow">${statusHtml()}${overdueGroup('pick')}${agendadasGroup(waiting)}${body}${hint}</div>`;
}
function backlogActions() {
  const n = selected.size;
  return `<div class="d-actbar" role="toolbar" aria-label="Tarefas selecionadas"><b>${plural(n, 'selecionada', 'selecionadas')}</b><button class="d-add" data-move-selected>Mover para Hoje<kbd>${KEY}↩</kbd></button><button class="d-tool is-danger" data-delete-selected>Excluir</button><button class="d-tool" data-clear-selection aria-label="Limpar seleção" title="Limpar seleção (esc)">✕</button></div>`;
}

function deskContas() {
  const current = today().slice(0, 7), prev = addMonths(billMonth, -1), next = addMonths(billMonth, 1);
  const pager = billsView === 'mes' ? `<div class="d-pager"><button class="d-tool" data-month="${prev}" aria-label="${monthName(prev)}">‹</button>${billMonth === current ? '' : `<button class="d-tool" data-month="${current}">Este mês</button>`}<button class="d-tool" data-month="${next}" aria-label="${monthName(next)}">›</button></div>` : '';
  const title = billsView === 'mes' ? monthName(billMonth) : 'Contas';
  const sub = {mes: 'Contas do mês', agendadas: 'Próximos 12 meses', todas: 'Todas as contas cadastradas'}[billsView];
  const body = billsView === 'todas' ? allBillsBody() : billsView === 'agendadas' ? agendadasBody() : billTable();
  return `${toolbar(title, sub, `${pager}${billsSegment()}${deskAdd('Nova conta', 'data-new-bill')}`)}<div class="d-main ${billsView === 'mes' ? 'd-wide' : 'd-narrow'}">${statusHtml()}${body}</div>`;
}

function billTable() {
  const current = today().slice(0, 7), day = Number(today().slice(8, 10));
  const {real: bills, projected} = billsOf(billMonth), accruing = accrualRows(billMonth);
  if (!bills.length && !projected.length && !accruing.length) return noBills();
  const sortDue = list => [...list].sort((a, b) => (a.due || 99) - (b.due || 99) || a.text.localeCompare(b.text));
  const unpaid = sortDue(bills.filter(b => !b.done)), paid = sortDue(bills.filter(b => b.done));
  const sum = list => list.reduce((n, b) => n + (b.amount || 0), 0), left = sum(unpaid), total = sum(bills);
  const late = b => b.due && !b.done && (billMonth < current || (billMonth === current && b.due < day));
  const overdue = unpaid.filter(late), next = billMonth === current ? unpaid.find(b => b.due && !late(b)) : null;
  const nextDay = next && billDueDate(next, billMonth);
  const planned = sum(projected), future = billMonth > current;
  const stats = future ? `<div class="d-stats"><div class="d-stat is-big"><span>Previsto no mês</span><strong>${money(left + planned)}</strong><small>${plural(unpaid.length + projected.length, 'conta', 'contas')} a pagar</small></div></div>` : `<div class="d-stats">
    <div class="d-stat is-big"><span>${left ? 'Falta pagar' : bills.length ? 'Tudo pago' : 'Nada a pagar'}</span><strong>${money(left)}</strong><div class="n-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${bills.length}" aria-valuenow="${paid.length}" aria-label="Contas pagas"><span style="width:${bills.length ? paid.length / bills.length * 100 : 0}%"></span></div><small>${paid.length} de ${bills.length} pagas · ${money(total)} no mês</small></div>
    <div class="d-stat ${overdue.length ? 'is-late' : ''}"><span>Atrasadas</span><strong>${overdue.length ? esc(overdue.map(b => b.text).join(', ')) : 'Nenhuma'}</strong><small>${overdue.length ? money(sum(overdue)) : 'Tudo em dia'}</small></div>
    ${billMonth === current && accruing.length ? `<div class="d-stat"><span>Acumulando para ${monthOf(addMonths(billMonth, 1))}</span><strong class="n-accent">${money(accruing.reduce((n, b) => n + b.held * b.unitAmount, 0))}</strong><small>${accruing.length === 1 ? `${esc(accruing[0].text)} · ${accruing[0].held} de ${plural(billIncludedDates(accruing[0]).length, 'sessão', 'sessões')}` : plural(accruing.length, 'conta', 'contas')}</small></div>` : billMonth === current ? `<div class="d-stat"><span>Próximo vencimento</span><strong>${next ? esc(next.text) : 'Nenhum'}</strong><small>${next ? `${WEEK[weekday(nextDay)].toLowerCase()}, dia ${next.due} · ${money(next.amount)}` : 'Nada mais a vencer neste mês'}</small></div>` : ''}
  </div>`;
  const row = b => `<tr class="${b.done ? 'is-done' : ''}" data-bill-row="${esc(b.id)}">
    <td class="d-c-check">${payable(b) ? billCheck(b) : ''}</td>
    <td><button class="d-c-name" data-edit-bill="${esc(b.id)}">${esc(b.text)}${b.calcMode === 'occurrence' ? `<small>${billCalcLabel(b)}</small>` : ''}${cardLabel(b) ? `<small>${esc(cardLabel(b))}</small>` : ''}</button></td>
    <td class="${late(b) ? 'is-late' : ''}">${late(b) ? `Venceu dia ${b.due}` : b.due ? `Dia ${b.due}` : 'Sem dia'}${b.done ? ' <small>paga</small>' : ''}</td>
    <td>${b.repeat !== false ? cap(everyLabel(billEvery(b))) : 'Não repete'}</td>
    <td class="d-num">${money(b.amount)}</td>
    <td class="d-c-more">${billActions(b)}</td></tr>`;
  const plannedRow = b => `<tr class="is-planned"><td class="d-c-check">${payable(b) ? billCheck(b) : ''}</td><td><button class="d-c-name" data-edit-bill="${esc(b.id)}">${esc(b.text)}${b.calcMode === 'occurrence' ? `<small>${billCalcLabel(b)}</small>` : ''}${cardLabel(b) ? `<small>${esc(cardLabel(b))}</small>` : ''}</button></td><td>${b.due ? `Dia ${b.due}` : 'Sem dia'}</td><td>${cap(everyLabel(b.every))}</td><td class="d-num">${money(b.amount)}</td><td class="d-c-more">${billActions(b)}</td></tr>`;
  const accrualRow = b => `<tr class="is-planned"><td class="d-c-check"></td><td><span class="d-c-name">${esc(b.text)}<small>${b.progress}</small></span></td><td>${payWhen(b)}</td><td>${cap(everyLabel(billEvery(b)))}</td><td class="d-num">${money(b.amount)}</td><td></td></tr>`;
  return `${stats}<table class="d-table"><thead><tr><th><span class="n-sr">Paga</span></th><th>Conta</th><th>Vencimento</th><th>Repetição</th><th class="d-num">Valor</th><th><span class="n-sr">Ações</span></th></tr></thead>
    <tbody>${unpaid.map(row).join('')}${projected.length ? `<tr class="d-t-group"><td colspan="6">Previstas · entram quando o mês chegar</td></tr>${projected.map(plannedRow).join('')}` : ''}${accruing.length ? `<tr class="d-t-group"><td colspan="6">Acumulando · paga em ${monthOf(addMonths(billMonth, 1))}</td></tr>${accruing.map(accrualRow).join('')}` : ''}${paid.length ? `<tr class="d-t-group"><td colspan="6">Pagas</td></tr>${paid.map(row).join('')}` : ''}</tbody></table>`;
}

function deskCompras() {
  const {toBuy, inCart, row, legend, form} = shoppingParts();
  return `${toolbar('Compras', people.length > 1 ? 'Lista compartilhada' : '')}<div class="d-main d-wide">${statusHtml()}${legend}${form}
    <div class="d-cols">
      <section><div class="n-group-h"><h2>Para comprar</h2><span>${toBuy.length}</span></div>${toBuy.length ? `<div class="n-list">${toBuy.map(row).join('')}</div>` : '<p class="d-empty">Lista vazia. Escreva acima e tecle Return.</p>'}</section>
      <section><div class="n-group-h"><h2>No carrinho</h2>${inCart.length ? '<button class="n-link" data-clear-cart>Limpar</button>' : '<span>0</span>'}</div>${inCart.length ? `<div class="n-list">${inCart.map(row).join('')}</div>` : '<p class="d-empty">Marque o círculo de um item ao pegá-lo.</p>'}</section>
    </div></div>`;
}

const deskAjustes = () => `${toolbar('Ajustes', '')}<div class="d-main d-narrow d-legacy">${viewAjustes()}</div>`;
const DESK_VIEWS = {hoje: deskHoje, reunioes: deskReunioes, backlog: deskBacklog, notas: deskNotas, compras: deskCasa, contas: deskContas, ajustes: deskAjustes};

function newTask() {
  if (tab === 'notas') return memoSheet();
  if (tab === 'compras') { const field = $('#add-chore input, #add-item input'); if (field) field.focus(); else choreSheet(); return; }
  if (tab === 'hoje' && hojeDate) return newTaskOn(hojeDate);
  if (tab === 'hoje' && $('#quick-task input')) return $('#quick-task input').focus();
  taskSheet(tab === 'reunioes' ? {when: 'today', meeting: true} : {when: tab === 'backlog' ? 'backlog' : 'today'});
}

function deleteTasks(ids) {
  // A copy keeps the origin, so it keeps the steps.
  const copies = ids.map(id => state.tasks[id]).filter(t => t && !t.deleted).map(({id, deleted, ...rest}) => ({...rest, from: rest.from || id}));
  if (!copies.length) return;
  commitMany(ids.map(id => ({collection: 'tasks', id, patch: {deleted: true}})));
  if (ids.includes(cursor)) cursor = null;
  // Deleted records stay deleted; undoing brings back a copy.
  toast(copies.length === 1 ? 'Tarefa excluída.' : `${copies.length} tarefas excluídas.`, () => {
    commitMany(copies.map(task => ({collection: 'tasks', id: uid(), patch: task})));
    toast('Exclusão desfeita.');
  });
}

// ----- Busca (⌘K) -----

function finderItems(q) {
  const key = itemKey(q), prefs = tabPrefs(state);
  const go = [...mainTabs().map(([id, label], i) => ({group: 'Ir para', icon: tabIcon(id), text: label, hint: `${KEY}${i + 1}`, run: () => switchTab(id)})), {group: 'Ir para', icon: ICONS.ajustes, text: 'Ajustes', hint: `${KEY},`, run: () => switchTab('ajustes')}];
  const actions = [
    {group: 'Ações', icon: ICONS.plus, text: 'Nova tarefa', hint: 'N', run: () => taskSheet({when: 'today'})},
    prefs.reunioes && {group: 'Ações', icon: ICONS.reunioes, text: 'Nova reunião', run: () => taskSheet({when: 'today', meeting: true})},
    prefs.contas && {group: 'Ações', icon: ICONS.contas, text: 'Nova conta', run: () => billSheet()},
    prefs.notas && {group: 'Ações', icon: ICONS.notas, text: 'Nova nota', run: () => memoSheet()},
    {group: 'Ações', icon: ICONS.cal, text: 'Calendário', run: () => { historyDate = (tab === 'hoje' && hojeDate) || today(); navigation.push('history'); }},
  ].filter(Boolean);
  if (!key) return [...go, ...actions];
  const where = t => t.date === '' ? 'Backlog' : t.date === today() ? 'Hoje' : dayShort(t.date);
  const tasks = live(state, 'tasks').filter(t => t.date === '' || t.date >= today()).sort((a, b) => (a.date || '9').localeCompare(b.date || '9'))
    .map(t => ({group: t.meeting ? 'Reuniões' : 'Tarefas', color: sectionColor(t.section), text: t.text, sub: `${where(t)} · ${sectionName(t.section)}${t.time ? ` · ${timeLabel(t)}` : ''}${t.done ? ' · feita' : ''}`, run: () => taskSheet({id: t.id})}));
  const repeats = live(state, 'repeats').map(r => ({group: 'Repetições', color: sectionColor(r.section), text: r.text, sub: `${repeatLabel(r)}${r.time ? `, ${timeLabel(r)}` : ''} · ${sectionName(r.section)}`, run: () => taskSheet({repeatId: r.id})}));
  const bills = prefs.contas ? live(state, 'bills').filter(b => b.month === today().slice(0, 7)).map(b => ({group: 'Contas', icon: ICONS.contas, text: b.text, sub: `${b.done ? 'Paga' : b.due ? `Dia ${b.due}` : 'Sem dia'} · ${money(b.amount)}`, run: () => billSheet(b.id)})) : [];
  const shop = prefs.compras ? listed(state).map(i => ({group: 'Compras', icon: ICONS.compras, text: i.text, sub: i.done ? 'No carrinho' : 'Para comprar', run: () => openCasa('compras')})) : [];
  const casa = prefs.compras ? [
    ...liveChores(state).filter(c => !c.done).map(c => ({group: 'Casa', icon: ICONS.casa, text: c.text, sub: `${listName(c.list)}${c.date ? ` · ${choreDay(c.date)}` : ''}${shared() ? ` · ${c.who ? personName(c.who) : 'qualquer um'}` : ''}`, run: () => choreSheet({id: c.id})})),
    ...live(state, 'notes').filter(n => n.title || n.body).map(n => ({group: 'Notas fixas', icon: ICONS.casa, text: n.title || n.body.split('\n')[0], sub: n.title ? n.body.replace(/\s*\n\s*/g, ' · ').slice(0, 80) : '', run: () => noteSheet(n.id)})),
  ] : [];
  // A note is found by any word of its text; the line that matched takes the place of its start.
  const notes = prefs.notas ? searchMemos(sortMemos(memos()), q).map(({memo, line}) => ({group: 'Notas', color: memoSectionOf(memo) ? sectionColor(memo.section) : '', icon: ICONS.notas, text: memoTitle(memo), sub: line || memoSnippet(memo, 80), found: true, run: () => openMemo(memo.id)})) : [];
  return [...go, ...actions, ...tasks, ...repeats, ...bills, ...shop, ...casa, ...notes].filter(x => x.found || itemKey(`${x.text} ${x.sub || ''} ${x.group}`).includes(key)).slice(0, 40);
}
function openFinder(q = '') {
  closeMenu();
  finder = {q, i: 0, items: []};
  const el = $('#finder');
  el.innerHTML = `<div class="d-finder-box" role="dialog" aria-modal="true" aria-label="Buscar"><label class="d-finder-in">${ICONS.search}<input id="finder-q" value="${esc(q)}" placeholder="Buscar tarefas, notas, contas e comandos" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="finder-list"><kbd>esc</kbd></label><div class="d-finder-list" id="finder-list" role="listbox"></div><p class="d-finder-foot">↑↓ para escolher · Return para abrir</p></div>`;
  el.hidden = false;
  drawFinder();
  const input = $('#finder-q'); input.focus(); input.setSelectionRange(q.length, q.length);
}
function drawFinder() {
  finder.items = finderItems(finder.q);
  finder.i = Math.min(finder.i, Math.max(0, finder.items.length - 1));
  let group = '';
  $('#finder-list').innerHTML = finder.items.map((x, i) => `${x.group !== group ? `<p class="d-finder-g">${esc(group = x.group)}</p>` : ''}<button class="d-finder-i ${i === finder.i ? 'is-on' : ''}" data-finder-i="${i}" role="option" aria-selected="${i === finder.i}" tabindex="-1">${x.color ? `<i style="background:${x.color}"></i>` : x.icon}<span>${esc(x.text)}${x.sub ? `<small>${esc(x.sub)}</small>` : ''}</span>${x.hint ? `<kbd>${x.hint}</kbd>` : ''}</button>`).join('')
    || `<p class="d-finder-empty">Nada encontrado para “${esc(finder.q)}”.</p>`;
  $('.d-finder-i.is-on')?.scrollIntoView({block: 'nearest'});
}
function closeFinder() {
  if (!finder) return;
  finder = null; $('#finder').hidden = true; $('#finder').innerHTML = '';
}
function runFinder(i) { const item = finder?.items[i]; closeFinder(); item?.run(); }
$('#finder').addEventListener('mousedown', e => { if (e.target === $('#finder')) closeFinder(); });
$('#finder').addEventListener('mousemove', e => {
  const item = e.target.closest('[data-finder-i]');
  if (!item || !finder || Number(item.dataset.finderI) === finder.i) return;
  finder.i = Number(item.dataset.finderI);
  $$('.d-finder-i').forEach(b => { const on = b === item; b.classList.toggle('is-on', on); b.setAttribute('aria-selected', on); });
});

// ----- Menu de contexto -----

const menuItem = (label, attrs, key = '', extra = '') => `<button class="d-mi ${extra}" role="menuitem" ${attrs}><span>${label}</span>${key ? `<kbd>${key}</kbd>` : ''}</button>`;
function taskMenu(id) {
  const t = state.tasks[id];
  if (!t || t.deleted) return '';
  const others = sections().filter(s => s.id !== t.section);
  return [
    menuItem(t.done ? 'Reabrir' : 'Concluir', `data-ctx="done" data-id="${id}"`, tab === 'backlog' ? '' : 'Espaço'),
    menuItem('Editar…', `data-ctx="edit" data-id="${id}"`, '↩'),
    menuItem('Adicionar passo', `data-ctx="add-step" data-id="${id}"`, '⇧↩'),
    taskSteps(state, t).length ? menuItem(openSteps.has(id) ? 'Ocultar passos' : 'Mostrar passos', `data-ctx="steps" data-id="${id}"`, 'P') : '',
    t.date !== today() ? menuItem('Mover para hoje', `data-ctx="today" data-id="${id}"`, tab === 'backlog' ? `${KEY}↩` : '') : '',
    t.date !== '' && tabPrefs(state).backlog ? menuItem('Mover para o Backlog', `data-ctx="backlog" data-id="${id}"`) : '',
    others.length ? `<div class="d-mi d-has" role="menuitem" aria-haspopup="menu" tabindex="-1"><span>Mover para a seção</span><span class="d-arrow" aria-hidden="true">›</span><div class="d-ctx d-sub" role="menu">${others.map(s => menuItem(`${dot(s.id)}${esc(s.name)}`, `data-ctx="section" data-id="${id}" data-section="${s.id}"`)).join('')}</div></div>` : '',
    '<hr>',
    menuItem('Excluir', `data-ctx="delete" data-id="${id}"`, '⌫', 'is-danger'),
  ].join('');
}
// A repeat's day not created yet (another day of the week): done, edit or delete just that day.
function occurrenceMenu(repeatId, date) {
  const r = state.repeats[repeatId];
  if (!r || r.deleted || !date) return '';
  const a = `data-id="${esc(repeatId)}" data-date="${esc(date)}"`;
  return [menuItem('Concluir', `data-ctx="occ-done" ${a}`), menuItem('Editar…', `data-ctx="occ-edit" ${a}`), '<hr>', menuItem('Excluir só este dia', `data-ctx="occ-delete" ${a}`, '', 'is-danger')].join('');
}
function billMenu(id) {
  const b = state.bills[id];
  if (!b || b.deleted || b.skipped) return '';
  return [menuItem(b.done ? 'Desmarcar como paga' : 'Marcar como paga', `data-ctx="pay" data-id="${esc(id)}"`), menuItem('Editar…', `data-ctx="bill-edit" data-id="${esc(id)}"`), '<hr>', menuItem('Excluir…', `data-ctx="bill-delete" data-id="${esc(id)}"`, '', 'is-danger')].join('');
}
function itemMenu(id) {
  const i = state.shopping[id];
  if (!i || i.deleted) return '';
  return [menuItem(i.done ? 'Tirar do carrinho' : 'Pôr no carrinho', `data-ctx="item-done" data-id="${esc(id)}"`), menuItem('Editar…', `data-ctx="item-edit" data-id="${esc(id)}"`), '<hr>', menuItem('Remover da lista', `data-ctx="item-remove" data-id="${esc(id)}"`, '', 'is-danger')].join('');
}
function openMenu(x, y, html) {
  const el = $('#ctx');
  el.innerHTML = html; el.hidden = false;
  el.style.left = `${Math.max(8, Math.min(x, innerWidth - el.offsetWidth - 8))}px`;
  el.style.top = `${Math.max(8, Math.min(y, innerHeight - el.offsetHeight - 8))}px`;
  // Submenus open to the left when there is no room on the right.
  el.classList.toggle('is-flip', x + el.offsetWidth * 2 > innerWidth);
  // Focus the menu itself: arrows then walk the items, and Space no longer reaches the row behind it.
  el.focus({preventScroll: true});
}
function closeMenu() { const el = $('#ctx'); if (!el.hidden) { el.hidden = true; el.innerHTML = ''; } }
function menuAction(d) {
  closeMenu();
  const id = d.id;
  if (d.ctx === 'done') toggleTask(id);
  else if (d.ctx === 'edit') taskSheet({id});
  else if (d.ctx === 'add-step') addStepField(id);
  else if (d.ctx === 'steps') showSteps(id);
  else if (d.ctx === 'today') moveToToday([id]);
  else if (d.ctx === 'backlog') { commit('tasks', id, {date: '', done: false}); toast('Tarefa movida para o Backlog.'); }
  else if (d.ctx === 'section') commit('tasks', id, {section: d.section});
  else if (d.ctx === 'delete') deleteTasks([id]);
  else if (d.ctx === 'occ-done') toggleOccurrence(id, d.date);
  else if (d.ctx === 'occ-edit') editOccurrence(id, d.date);
  else if (d.ctx === 'occ-delete') deleteOccurrence(id, d.date);
  else if (d.ctx === 'pay') commit('bills', id, {done: !state.bills[id].done});
  else if (d.ctx === 'bill-edit') billSheet(id);
  else if (d.ctx === 'bill-delete') deleteBillSheet(state.bills[id]);
  else if (d.ctx === 'item-done') toggleCart(id);
  else if (d.ctx === 'item-edit') itemSheet(id);
  else if (d.ctx === 'item-remove') { commit('shopping', id, {listed: false, done: false}); toast(`${state.shopping[id].text} tirado da lista.`); }
}
document.addEventListener('contextmenu', e => {
  if (!desktop()) return;
  const task = e.target.closest('[data-row]'), occ = e.target.closest('[data-occ-row]'), bill = e.target.closest('[data-bill-row]'), item = e.target.closest('[data-item-row]');
  const html = task ? taskMenu(task.dataset.row) : occ ? occurrenceMenu(occ.dataset.occRow, occ.dataset.occDate) : bill ? billMenu(bill.dataset.billRow) : item ? itemMenu(item.dataset.itemRow) : '';
  if (!html) return;
  e.preventDefault();
  if (task && task.matches('.n-row')) { cursor = task.dataset.row; $$('.n-row.is-cursor').forEach(r => r.classList.remove('is-cursor')); task.classList.add('is-cursor'); }
  openMenu(e.clientX, e.clientY, html);
});
document.addEventListener('pointerdown', e => { if (!e.target.closest('#ctx')) closeMenu(); }, true);
addEventListener('blur', closeMenu);
addEventListener('resize', closeMenu);
document.addEventListener('scroll', closeMenu, true);

// ----- Seleção no Backlog, captura rápida, horários livres -----

function setCursor(id, extend) {
  cursor = id;
  if (tab === 'backlog') {
    if (!extend) selected = new Set([id]); else selected.add(id);
    anchor = extend ? anchor || id : id;
  }
  render();
  $(`.n-row[data-row="${CSS.escape(id)}"]`)?.scrollIntoView({block: 'nearest'});
}
document.addEventListener('click', e => {
  const row = e.target.closest('[data-pick]');
  if (!row || e.target.closest('button')) return;
  const id = row.dataset.pick;
  if (e.metaKey || e.ctrlKey) { selected.has(id) ? selected.delete(id) : selected.add(id); anchor = id; }
  else if (e.shiftKey && anchor) {
    const ids = $$('[data-pick]').map(r => r.dataset.pick), a = ids.indexOf(anchor), b = ids.indexOf(id);
    selected = new Set(a < 0 ? [id] : ids.slice(Math.min(a, b), Math.max(a, b) + 1));
  } else { selected = new Set([id]); anchor = id; }
  cursor = id;
  render();
});
document.addEventListener('dblclick', e => {
  const row = e.target.closest('[data-pick]');
  if (row && !e.target.closest('button')) { taskSheet({id: row.dataset.pick}); return; }
  const col = e.target.closest('[data-slot-day]');
  if (!col || e.target.closest('button, .d-evt')) return;
  const date = col.dataset.slotDay;
  if (date < today()) { toast('Escolha um dia a partir de hoje.'); return; }
  const offset = e.clientY - col.getBoundingClientRect().top;
  const start = Math.min(23 * 60 + 30, Number(col.dataset.first) + Math.floor(offset / Number(col.dataset.hour) * 2) * 30);
  taskSheet({when: date === today() ? 'today' : 'later', meeting: true, date, time: fromMinutes(start)});
});

document.addEventListener('submit', e => {
  if (e.target.id !== 'quick-task') return;
  e.preventDefault();
  const input = e.target.elements.entry, parsed = parseQuickTask(input.value, sections());
  if (!parsed.text) return;
  const section = parsed.section || lastSection();
  input.value = '';
  commit('tasks', uid(), {text: parsed.text, section, time: parsed.time, end: parsed.time ? meetingEnd({time: parsed.time}) : '', meeting: false, repeat: '', date: today(), done: false});
  drawQuickChips();
});
document.addEventListener('input', e => {
  if (e.target.matches('#quick-task input')) drawQuickChips();
  if (e.target.id === 'finder-q' && finder) { finder.q = e.target.value; finder.i = 0; drawFinder(); }
});

// Backlog rows are dragged with the mouse onto "Hoje" in the sidebar.
function endDrag() {
  if (!dragIds) return;
  dragIds = null;
  document.body.classList.remove('is-dragging-tasks');
  $$('.is-over').forEach(el => el.classList.remove('is-over'));
  render();
}
document.addEventListener('dragstart', e => {
  const row = e.target.closest?.('[data-pick]');
  if (!row) return;
  const id = row.dataset.pick;
  if (!selected.has(id)) { selected = new Set([id]); $$('.d-pick.is-selected').forEach(r => r.classList.remove('is-selected')); row.classList.add('is-selected'); }
  dragIds = [...selected];
  e.dataTransfer.effectAllowed = 'move';
  e.dataTransfer.setData('text/plain', dragIds.map(i => state.tasks[i]?.text || '').join('\n'));
  document.body.classList.add('is-dragging-tasks');
});
document.addEventListener('dragover', e => {
  const target = e.target.closest?.('[data-drop-today]');
  if (!target || !dragIds) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'move';
  target.classList.add('is-over');
});
document.addEventListener('dragleave', e => {
  const target = e.target.closest?.('[data-drop-today]');
  if (target && !target.contains(e.relatedTarget)) target.classList.remove('is-over');
});
document.addEventListener('drop', e => {
  const target = e.target.closest?.('[data-drop-today]');
  if (!target || !dragIds) return;
  e.preventDefault();
  const ids = dragIds;
  endDrag(); selected.clear();
  moveToToday(ids);
});
document.addEventListener('dragend', endDrag);

// ----- Atalhos -----

document.addEventListener('keydown', e => {
  if (!desktop()) return;
  const mod = e.metaKey || e.ctrlKey, key = e.key;
  // A sheet is a modal dialog; the search would open behind it.
  if (mod && key.toLowerCase() === 'k' && !$('#sheet').open) { e.preventDefault(); finder ? closeFinder() : openFinder(); return; }
  if (finder) {
    if (key === 'Escape') { e.preventDefault(); closeFinder(); }
    else if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      const n = finder.items.length;
      if (n) { finder.i = (finder.i + (key === 'ArrowDown' ? 1 : -1) + n) % n; drawFinder(); }
    } else if (key === 'Enter') { e.preventDefault(); runFinder(finder.i); }
    return;
  }
  if (!$('#ctx').hidden) {
    const items = $$('#ctx > .d-mi'), i = items.indexOf(document.activeElement);
    if (key === 'Escape') { e.preventDefault(); closeMenu(); }
    else if ((key === ' ' || key === 'Enter') && !e.target.closest?.('#ctx .d-mi')) e.preventDefault();
    else if (key === 'ArrowDown' || key === 'ArrowUp') {
      e.preventDefault();
      const down = key === 'ArrowDown', n = items.length;
      items[i < 0 ? (down ? 0 : n - 1) : (i + (down ? 1 : -1) + n) % n]?.focus();
    }
    return;
  }
  if ($('#sheet').open) return;
  if (mod && /^[1-9]$/.test(key)) { const target = mainTabs()[Number(key) - 1]; if (target) { e.preventDefault(); switchTab(target[0]); } return; }
  if (mod && key === ',') { e.preventDefault(); switchTab('ajustes'); return; }
  if (e.target.closest?.('input, textarea, select, [contenteditable], [data-drag]')) { if (key === 'Escape') e.target.blur?.(); return; }
  if (navigation.current !== 'root') return;
  if (!e.altKey && ((mod && key.toLowerCase() === 'n') || (!mod && key === 'n'))) { e.preventDefault(); newTask(); return; }
  if (tab === 'backlog') {
    if (mod && key === 'Enter' && selected.size) { e.preventDefault(); const ids = [...selected]; selected.clear(); moveToToday(ids); return; }
    if (mod && key.toLowerCase() === 'a') { e.preventDefault(); selected = new Set(backlog().map(t => t.id)); render(); return; }
    if (key === 'Escape' && selected.size) { selected.clear(); render(); return; }
  }
  if (mod || e.altKey) return;
  // Space and Return on a focused button already click it.
  if ((key === ' ' || key === 'Enter') && e.target.closest?.('button, a, label')) return;
  if (tab === 'notas') {
    if (memoTrash) return;
    const ids = $$('#memo-rows [data-open-memo]').map(b => b.dataset.openMemo);
    if (['j', 'k', 'ArrowDown', 'ArrowUp'].includes(key) && ids.length) {
      e.preventDefault();
      const i = ids.indexOf(memoId), down = key === 'j' || key === 'ArrowDown';
      document.activeElement?.blur?.();
      openMemo(ids[i < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, i + (down ? 1 : -1)))]);
      $('.m-row.is-on')?.scrollIntoView({block: 'nearest'});
    } else if (memoOf(memoId) && key === 'Enter') { e.preventDefault(); memoSheet(memoId); }
    else if (memoOf(memoId) && (key === 'Backspace' || key === 'Delete')) { e.preventDefault(); trashMemo(memoId); }
    return;
  }
  if ((key === 'ArrowLeft' || key === 'ArrowRight') && tab === 'hoje') { e.preventDefault(); shiftHoje(key === 'ArrowLeft' ? -1 : 1); return; }
  if (['j', 'k', 'ArrowDown', 'ArrowUp'].includes(key) && (tab === 'hoje' || tab === 'backlog' || tab === 'reunioes')) {
    const ids = $$('.page[data-name="root"] .n-row[data-row]').map(r => r.dataset.row);
    if (!ids.length) return;
    e.preventDefault();
    const i = ids.indexOf(cursor), down = key === 'j' || key === 'ArrowDown';
    document.activeElement?.blur?.();
    setCursor(ids[i < 0 ? 0 : Math.max(0, Math.min(ids.length - 1, i + (down ? 1 : -1)))], e.shiftKey);
    return;
  }
  const task = cursor && state.tasks[cursor] && !state.tasks[cursor].deleted && $(`.n-row[data-row="${CSS.escape(cursor)}"]`) ? state.tasks[cursor] : null;
  if (!task) return;
  if (key === ' ') { e.preventDefault(); if (tab === 'backlog') { selected.has(task.id) ? selected.delete(task.id) : selected.add(task.id); render(); } else toggleTask(task.id); }
  else if (key === 'Enter' && e.shiftKey) { e.preventDefault(); addStepField(task.id); }
  else if (key === 'Enter') { e.preventDefault(); taskSheet({id: task.id}); }
  else if (key.toLowerCase() === 'p' && taskSteps(state, task).length) { e.preventDefault(); showSteps(task.id); }
  else if (key === 'Backspace' || key === 'Delete') { e.preventDefault(); deleteTasks(tab === 'backlog' && selected.size ? [...selected] : [task.id]); selected.clear(); }
});

// The time and the "em N min" labels move with the clock.
setInterval(() => { if (desktop() && (tab === 'hoje' || tab === 'reunioes') && !finder && $('#ctx').hidden && !dragIds && !document.activeElement?.closest?.('input')) render(); }, 60000);

// ---------- Lifecycle ----------

// Activate updates on the next opening; never force a reload over unsynced edits.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', {updateViaCache: 'none'}).catch(e => console.warn('Offline:', e.message));
  navigator.serviceWorker.addEventListener('message', e => { if (typeof e.data?.open === 'string') openFromNotification(e.data.open); });
}

window.addEventListener('online', () => sync());
window.addEventListener('offline', () => { online = false; syncError = ''; render(); });
window.addEventListener('storage', e => {
  if (e.key !== 'notas-v1' || busy) return;
  const data = JSON.parse(e.newValue || 'null');
  if (data) { state = normalize(data.state); queue = data.queue; render(); void sync(); }
});
let currentDay = today();
setInterval(() => {
  if (currentDay !== today()) { currentDay = today(); billMonth = currentDay.slice(0, 7); ensureLocal().then(render); }
  void sync();
}, 15000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) { ensureLocal().then(render); void sync(); } });

const navigation = createNavigation({
  onRoot() { sub = null; render(); },
  onPage(name, el) { sub = {name, el}; render(); },
});
render();
if (new URLSearchParams(location.search).has('aba')) { openFromNotification(location.href); history.replaceState(history.state, '', '/'); }
sync().then(() => { if (needsLogin) loginSheet(); else { ensureLocal().then(() => { render(); void sync(); }); } });
