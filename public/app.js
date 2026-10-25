import {createNavigation} from './navigation.js';
// Report uncaught errors to the server log; on a phone there is no console to look at.
const report = message => { try { navigator.sendBeacon?.('/api/client-log', new Blob([JSON.stringify({message})], {type: 'application/json'})); } catch {} };
addEventListener('error', e => report(`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`));
addEventListener('unhandledrejection', e => report(`promise: ${e.reason?.stack || e.reason}`));
import {initialState, normalize, apply, dayKey, weekday, rollover, live, sortedSections, repeatsOn, occurrenceId, lastPending, pendingOn, carryOps, scheduledTasks, itemKey, itemId, listed, tabPrefs, billEvery, scheduledBills, repeatingBills, billRule, billCatalog, editBillOps, deleteBillOps, undoBillOps, guardBillOps, billDates, billIncludedDates, billSnapshot, billSessionMonth, accruingBills, billChain, linkedCard, cardBill, parseQuickTask, meetingLanes, meetingEnd, onAgenda, toMinutes, fromMinutes} from './model.js';

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
  cal: '<svg viewBox="0 0 20 20" aria-hidden="true"><rect x="3" y="4.5" width="14" height="12.5" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M3 8.5h14M7 2.5v4M13 2.5v4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  rep: '<svg viewBox="0 0 16 16" aria-label="Repete"><path d="M3 7a5 5 0 0 1 8.6-3.4L13 5M13 2v3h-3M13 9a5 5 0 0 1-8.6 3.4L3 11M3 14v-3h3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  check: '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5l3 3 6-7" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  plus: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>',
  eye: '<svg viewBox="0 0 20 20" aria-hidden="true"><path d="M2 10s3-5.5 8-5.5S18 10 18 10s-3 5.5-8 5.5S2 10 2 10z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><circle cx="10" cy="10" r="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>',
  search: '<svg viewBox="0 0 20 20" aria-hidden="true"><circle cx="9" cy="9" r="5.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M13 13l4 4" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
  hoje: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 12.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  backlog: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  reunioes: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17M8 3v4M16 3v4M8 14h3" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  contas: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17" stroke="currentColor" stroke-width="1.8"/></svg>',
  compras: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 8.5h13l-1 11a1.5 1.5 0 0 1-1.5 1.4H8a1.5 1.5 0 0 1-1.5-1.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  ajustes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h9M18 7h1M5 17h1M10 17h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
};
const TABS = [['hoje', 'Hoje'], ['reunioes', 'Agenda'], ['backlog', 'Backlog'], ['compras', 'Compras'], ['contas', 'Contas'], ['ajustes', 'Ajustes']];
// Hoje and Ajustes always show; the others follow this person's choices in Ajustes.
const visibleTabs = () => { const prefs = tabPrefs(state); return TABS.filter(([id]) => !(id in prefs) || prefs[id]); };

// ---------- Local state, outbox and sync ----------

let state = initialState(), queue = [], busy = false, events = null, online = navigator.onLine, syncError = '', needsLogin = false, protectedServer = false;
let passkeys = [], regOptions = null, loginOptions = null, loginOptionsError = null;
// Who is signed in. The local cache belongs to one person (`owner`); another
// person signing in on the same device starts from a clean cache.
let me = null, people = [], owner = null, sessionLoaded = false;
let tab = 'hoje', billMonth = today().slice(0, 7), selecting = false, selected = new Set(), historyDate = null, sub = null, dragging = false, billsView = 'mes', openMonths = new Set();
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
  if (!r.ok) throw Object.assign(Error((await r.json()).error || 'Falha de conexão'), {status: r.status});
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
      }
      // Fetch first so an empty new device never uploads its initial defaults.
      let remote = await (await api('/api/state')).json();
      while (queue.length) {
        const first = queue[0], boundary = first.batchId ? queue.findIndex(op => op.batchId !== first.batchId) : 1;
        const batch = queue.slice(0, boundary < 0 ? queue.length : boundary);
        try {
          await api('/api/operations', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(batch.length > 1 ? batch : batch[0])});
        } catch (e) {
          if (e.status !== 409) throw e;
          queue.splice(0, batch.length);
          remote = normalize(await (await api('/api/state')).json());
          for (const op of queue) apply(remote, op);
          state = remote; save(); render();
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
const dayTasks = date => {
  const stored = tasksOn(date);
  if (state.days[date]) return stored;
  return [...stored, ...live(state, 'repeats').filter(r => repeatsOn(r, date) && !state.tasks[occurrenceId(r.id, date)]).map(r => ({id: occurrenceId(r.id, date), text: r.text, section: r.section, time: r.time || '', date, done: false, repeat: r.id, ...(r.time ? {end: r.end || ''} : {}), ...(r.meeting ? {meeting: true} : {})}))];
};
// A repeat's occurrence on a day not reached yet exists only on screen; touching it stores it.
const projected = id => !state.tasks[id] && historyDate ? dayTasks(historyDate).find(t => t.id === id) : null;
// With the Agenda tab on, meetings live there and leave Hoje. Other tasks with a
// time show in both.
const meetingsApart = () => tabPrefs(state).reunioes;
const todayTasks = () => tasksOn(today()).filter(t => !(meetingsApart() && t.meeting));
const todayMeetings = () => tasksOn(today()).filter(onAgenda);
const backlog = () => live(state, 'tasks').filter(t => t.date === '');
const scheduled = () => scheduledTasks(state, today());
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
function toggleTask(id) {
  settling.add(id);
  commit('tasks', id, {done: !state.tasks[id].done});
  clearTimeout(settleTimer);
  settleTimer = setTimeout(() => { settling.clear(); flip(render); }, 450);
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
  for (let i = 1; i <= 62; i++) { const d = addDays(today(), i); if (repeatsOn(r, d)) return d; }
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

function taskRow(t, mode = 'edit') {
  const meta = t.time || t.repeat ? `<span class="n-meta">${t.repeat ? ICONS.rep : ''}${esc(timeLabel(t))}</span>` : '';
  if (mode === 'pick') {
    const on = selected.has(t.id);
    return `<div class="n-row d-pick ${on ? 'is-selected' : ''} ${cursor === t.id ? 'is-cursor' : ''}" data-row="${t.id}" data-pick="${t.id}" draggable="true"><button class="n-check n-square" data-select="${t.id}" aria-pressed="${on}" aria-label="Selecionar ${esc(t.text)}">${ICONS.check}</button><span class="n-text">${esc(t.text)}</span>${meta}</div>`;
  }
  if (mode === 'select') {
    const on = selected.has(t.id);
    return `<div class="n-row ${on ? 'is-selected' : ''}"><button class="n-check n-square" data-select="${t.id}" aria-pressed="${on}" aria-label="Selecionar ${esc(t.text)}">${ICONS.check}</button><button class="n-text" data-select="${t.id}">${esc(t.text)}</button></div>`;
  }
  const row = `<div class="n-row ${t.done ? 'is-done' : ''} ${t.done && settling.has(t.id) ? 'is-settling' : ''} ${cursor === t.id ? 'is-cursor' : ''}" data-row="${t.id}"><button class="n-check" data-toggle="${t.id}" data-collection="tasks" aria-pressed="${!!t.done}" aria-label="${t.done ? 'Desmarcar' : 'Concluir'} ${esc(t.text)}">${ICONS.check}</button><button class="n-text" data-edit-task="${t.id}">${esc(t.text)}</button>${meta}</div>`;
  if (mode === 'swipe') return `<div class="n-swipe" data-swipe="${t.id}"><span class="n-swipe-action" aria-hidden="true">Hoje</span>${row}</div>`;
  return row;
}

function sectionGroups(tasks, mode, count) {
  return sections().map(s => {
    const list = byDone(tasks.filter(t => t.section === s.id));
    if (!list.length) return '';
    return `<section><div class="n-group-h"><h2>${dot(s.id)}${esc(s.name)}</h2><span>${count(list)}</span></div><div class="n-list">${list.map(t => taskRow(t, mode)).join('')}</div></section>`;
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

function viewHoje() {
  const tasks = todayTasks(), banner = hojeBanner();
  const waiting = backlog().length;
  const body = tasks.length
    ? sectionGroups(tasks, 'edit', list => `${doneCount(list)} de ${list.length}`)
    : `<div class="n-empty"><p>Nada para hoje.</p><div class="n-btns"><button class="n-btn n-yellow" data-new-task>Nova tarefa</button>${waiting && tabPrefs(state).backlog ? `<button class="n-btn n-gray" data-tab="backlog">Ver backlog (${waiting})</button>` : ''}</div></div>`;
  const avatar = me && people.length > 1 ? `<button class="n-avatar" data-tab="ajustes" style="background:${me.color}" aria-label="Conta de ${esc(me.name)}. Abrir Ajustes">${esc(me.name[0])}</button>` : '<span></span>';
  return `${statusHtml()}<div class="n-top">${avatar}<button class="n-icon" data-open-history aria-label="Calendário">${ICONS.cal}</button></div>
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

function viewBacklog() {
  const tasks = backlog(), waiting = selecting ? [] : scheduled().filter(t => !(meetingsApart() && t.meeting));
  const agendadas = agendadasGroup(waiting);
  const head = selecting
    ? `<div class="n-top"><span></span><button class="n-link" data-select-mode>Cancelar</button></div><h1 class="n-title">Backlog</h1><p class="n-sub">${selected.size ? plural(selected.size, 'selecionada', 'selecionadas') : 'Toque nas tarefas para selecionar'}</p>`
    : `<div class="n-top"><span></span>${tasks.length ? '<button class="n-link" data-select-mode>Selecionar</button>' : ''}</div><h1 class="n-title">Backlog</h1>`;
  const body = tasks.length
    ? sectionGroups(tasks, selecting ? 'select' : 'swipe', list => list.length)
    : waiting.length ? '' : '<div class="n-empty"><p>Backlog vazio.</p><div class="n-btns"><button class="n-btn n-yellow" data-new-task>Nova tarefa</button></div></div>';
  return `${statusHtml()}${head}${agendadas}${body}`;
}

function billsSegment() {
  return `<div class="n-seg">${[['mes', 'Neste mês'], ['agendadas', 'Agendadas'], ['todas', 'Todas']].map(([id, label]) => `<button class="n-seg-b ${billsView === id ? 'is-on' : ''}" data-bills-view="${id}" aria-pressed="${billsView === id}">${label}</button>`).join('')}</div>`;
}

const billActions = (b, catalog = false) => `<button class="n-bill-more" data-bill-actions="${esc(b.id)}" ${catalog ? 'data-catalog="true"' : ''} aria-label="Ações de ${esc(b.text)}">•••</button>`;
const catalogBill = id => billCatalog(state, today().slice(0, 7)).find(b => b.id === id);
const billDate = b => b.due ? `${Math.min(b.due, new Date(Number(b.month.slice(0, 4)), Number(b.month.slice(5, 7)), 0).getDate())} de ${MONTHS[Number(b.month.slice(5, 7)) - 1]} de ${b.month.slice(0, 4)}` : monthName(b.month);
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

// Bills of a month. In a future month, also what the repeating ones will create there:
// a projection only, so it cannot be paid or edited until the month arrives.
function monthBills(month) {
  const real = live(state, 'bills').filter(b => b.month === month);
  if (month <= today().slice(0, 7)) return {real, projected: []};
  const ids = new Set(real.map(b => b.id));
  return {real, projected: scheduledBills(state, month, 1)[0].items.filter(i => !ids.has(i.id))};
}
const plannedMeta = b => `${b.due ? `Dia ${b.due}` : 'Sem dia'}${b.every > 1 ? ` · <i class="n-every">${everyLabel(b.every)}</i>` : ''}${b.calcMode === 'occurrence' ? ` · ${billCalcLabel(b)}` : ''}${cardLabel(b) ? ` · ${esc(cardLabel(b))}` : ''}`;
const noBills = () => `<div class="n-empty"><p>Nenhuma conta em ${MONTHS[Number(billMonth.slice(5, 7)) - 1]}.</p><div class="n-btns"><button class="n-btn n-yellow" data-new-bill>Adicionar conta</button></div></div>`;

function viewContas() {
  if (billsView === 'todas') return viewAllBills();
  if (billsView === 'agendadas') return viewAgendadas();
  const current = today().slice(0, 7), prev = addMonths(billMonth, -1), next = addMonths(billMonth, 1);
  const {real: bills, projected} = monthBills(billMonth), accruing = accrualRows(billMonth);
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
  const row = b => `<div class="n-row n-bill-row ${b.done ? 'is-done' : ''}"><button class="n-check" data-toggle="${esc(b.id)}" data-collection="bills" aria-pressed="${!!b.done}" aria-label="${b.done ? 'Desmarcar' : 'Marcar como paga'} ${esc(b.text)}">${ICONS.check}</button><button class="n-text n-two" data-edit-bill="${esc(b.id)}"><span>${esc(b.text)}</span>${dueMeta(b)}${b.calcMode === 'occurrence' ? `<span class="n-meta">${billCalcLabel(b)}</span>` : ''}${cardMeta(b)}</button><span class="n-amount">${money(b.amount)}</span>${billActions(b)}</div>`;
  const top = `<div class="n-top"><button class="n-link" data-month="${prev}">‹ ${monthName(prev)}</button><span class="n-top-end"><button class="n-link" data-month="${next}">${monthName(next)} ›</button><button class="n-icon" data-new-bill aria-label="Adicionar conta">${ICONS.plus}</button></span></div>`;
  if (!bills.length && !projected.length && !accruing.length) return `${statusHtml()}${top}<h1 class="n-title">${monthName(billMonth)}</h1>${billsSegment()}${noBills()}`;
  if (billMonth > current) {
    const planned = b => `<div class="n-row n-bill-row n-plain"><span class="n-text n-two"><span>${esc(b.text)}</span><span class="n-meta">${plannedMeta(b)}</span></span><span class="n-amount">${money(b.amount)}</span></div>`;
    return `${statusHtml()}${top}<h1 class="n-title">${monthName(billMonth)}</h1>${billsSegment()}
    <div class="n-total"><span>Previsto</span><strong>${money(left + projected.reduce((n, b) => n + b.amount, 0))}</strong></div>
    ${unpaid.length ? `<div class="n-group-h"><h2>A pagar</h2></div><div class="n-list">${unpaid.map(row).join('')}</div>` : ''}
    ${projected.length ? `<div class="n-group-h"><h2>Previstas</h2></div><div class="n-list">${projected.map(planned).join('')}</div><p class="n-note">Contas que se repetem entram aqui quando ${MONTHS[Number(billMonth.slice(5, 7)) - 1]} chegar.</p>` : ''}
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

function viewCompras() {
  const {toBuy, inCart, row, legend, form} = shoppingParts();
  return `${statusHtml()}<div class="n-top"></div><h1 class="n-title">Compras</h1>${legend}
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

function viewAjustes() {
  const repeats = live(state, 'repeats').length;
  const monthly = repeatingBills(state).length;
  const account = protectedServer && me ? `<div class="n-group-h"><h2>Conta</h2></div>
    <div class="n-list"><div class="n-row n-plain"><span class="n-person-dot" style="background:${me.color}"></span><span class="n-text">${esc(me.name)}</span><button class="n-link n-danger" data-logout>Sair</button></div></div>` : '';
  return `${statusHtml()}<div class="n-top"></div><h1 class="n-title">Ajustes</h1>${account}
    <div class="n-group-h"><h2>Seções</h2></div>
    <div class="n-list" id="section-list">${sections().map(s => `<div class="n-row n-plain" data-section-row="${s.id}"><button class="n-text" data-edit-section="${s.id}">${esc(s.name)}</button><button class="n-handle" data-drag="${s.id}" aria-label="Reordenar ${esc(s.name)}. Use as setas para mover.">≡</button></div>`).join('')}
      <div class="n-row n-plain"><button class="n-text n-accent" data-new-section>Nova seção</button></div></div>
    <p class="n-note">A ordem aqui é a ordem em Hoje e no Backlog${desktop() ? ' e define a cor de cada seção' : ''}.</p>
    <div class="n-group-h"><h2>Abas</h2></div>
    <div class="n-list">${[['reunioes', 'Agenda'], ['backlog', 'Backlog'], ['compras', 'Compras'], ['contas', 'Contas']].map(([id, label]) => `<label class="n-row n-plain"><span class="n-text">${label}</span><input type="checkbox" class="n-switch" data-tab-pref="${id}" ${tabPrefs(state)[id] ? 'checked' : ''}></label>`).join('')}</div>
    <p class="n-note">Hoje e Ajustes sempre aparecem. A Agenda mostra tudo que tem horário; com ela ligada, as reuniões saem do Hoje e ficam só lá.</p>
    <div class="n-group-h"><h2>Repetições</h2></div>
    <div class="n-list">
      <div class="n-row n-plain"><button class="n-text" data-push="repeats">Tarefas que se repetem</button><span class="n-meta">${repeats}</span><span class="n-chev" aria-hidden="true">›</span></div>
      ${tabPrefs(state).contas ? `<div class="n-row n-plain"><button class="n-text" data-push="monthly">Contas recorrentes</button><span class="n-meta">${monthly}</span><span class="n-chev" aria-hidden="true">›</span></div>` : ''}
    </div>
    ${protectedServer ? passkeysHtml() : ''}
    <div class="n-group-h"><h2>Dados</h2></div>
    <div class="n-list">
      <div class="n-row n-plain"><button class="n-text" data-export>Exportar backup</button><span class="n-chev" aria-hidden="true">›</span></div>
    </div>`;
}

// ---------- Secondary pages ----------

function defaultHistoryDate() {
  const dates = [...new Set(live(state, 'tasks').map(t => t.date).filter(d => d && d < today()))].sort();
  return dates.at(-1) || addDays(today(), -1);
}

function pageHistory() {
  const date = historyDate, tasks = dayTasks(date), ahead = date > today();
  const monday = addDays(date, -((weekday(date) + 6) % 7));
  const week = Array.from({length: 7}, (_, i) => addDays(monday, i));
  const dot = d => { const list = dayTasks(d); return !list.length ? 'is-none' : list.every(t => t.done) ? 'is-all' : ''; };
  const sameMonth = date.slice(0, 7) === today().slice(0, 7);
  const title = `${WEEK[weekday(date)]}, ${Number(date.slice(8, 10))}${sameMonth ? '' : ` de ${MONTHS[Number(date.slice(5, 7)) - 1]}`}`;
  const nextWeek = addDays(monday, 7);
  return {
    html: `<div class="n-top"><button class="n-link" data-back>‹ Hoje</button><label class="n-icon" aria-label="Escolher dia">${ICONS.cal}<input type="date" class="n-hidden-input" data-pick-day value="${date}"></label></div>
      <h1 class="n-title">${title}</h1><p class="n-sub">${!tasks.length ? 'Nenhuma tarefa neste dia' : ahead ? plural(tasks.length, 'tarefa prevista', 'tarefas previstas') : `${doneCount(tasks)} de ${tasks.length} feitas`}</p>
      <div class="n-week">
        <button class="n-week-nav" data-day="${addDays(monday, -7)}" aria-label="Semana anterior">‹</button>
        ${week.map(d => `<button class="n-day ${d === date ? 'is-selected' : ''} ${d === today() ? 'is-today' : ''}" data-day="${d}" aria-label="${esc(longDate(d))}"><small>${WEEK_INITIAL[weekday(d)]}</small><b>${Number(d.slice(8, 10))}</b><i class="${dot(d)}"></i></button>`).join('')}
        <button class="n-week-nav" data-day="${nextWeek}" aria-label="Próxima semana">›</button>
      </div>
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
  return {html: `<div class="n-top"><button class="n-link" data-back>‹ Ajustes</button></div><h1 class="n-title">Repetições</h1>${groups || '<div class="n-empty"><p>Nenhuma tarefa se repete.</p><p class="n-note">Ao criar uma tarefa para hoje, escolha Repetir.</p></div>'}`, action: ''};
}

function pageMonthly() {
  const list = billCatalog(state, today().slice(0, 7)).filter(b => b.recurring);
  const rows = list.map(b => `<div class="n-row n-plain"><button class="n-text n-two" data-edit-bill="${esc(b.id)}" data-catalog="true"><span>${esc(b.text)}</span><span class="n-meta">${b.due ? `Dia ${b.due} · ` : ''}${everyLabel(billEvery(billRule(state, b)))}</span></button><span class="n-amount">${money(b.amount)}</span>${billActions(b, true)}</div>`).join('');
  return {html: `<div class="n-top"><button class="n-link" data-back>‹ Ajustes</button></div><h1 class="n-title">Contas recorrentes</h1><p class="n-sub">Voltam no ritmo de cada uma, como não pagas.</p>${rows ? `<div class="n-list n-spaced">${rows}</div>` : '<div class="n-empty"><p>Nenhuma conta se repete.</p></div>'}`, action: ''};
}

const PAGES = {history: pageHistory, repeats: pageRepeats, monthly: pageMonthly};

function render() {
  // Replacing the rows mid-drag would cancel the drag; it renders again when it ends.
  if (dragging || dragIds) return;
  const screen = $('.page[data-name="root"] .n-screen'), wide = desktop();
  document.body.dataset.layout = wide ? 'desktop' : 'phone';
  // A tab turned off (here or on another device) cannot stay selected.
  if (!visibleTabs().some(([id]) => id === tab)) tab = 'hoje';
  // Re-rendering replaces the add fields; keep what is being typed and the keyboard open.
  const typing = ['#add-item input', '#quick-task input'].map(sel => { const field = $(sel); return field && {sel, value: field.value, focused: document.activeElement === field}; }).filter(Boolean);
  const searching = document.activeElement?.matches('[data-bill-search]');
  if (screen) screen.innerHTML = (wide ? DESK_VIEWS : {hoje: viewHoje, reunioes: viewReunioes, backlog: viewBacklog, compras: viewCompras, contas: viewContas, ajustes: viewAjustes})[tab]();
  for (const {sel, value, focused} of typing) { const field = $(sel); if (!field) continue; field.value = value; if (focused) field.focus({preventScroll: true}); }
  if ($('#quick-task')) drawQuickChips();
  if (searching) $('[data-bill-search]')?.focus({preventScroll: true});
  $('#tabbar').innerHTML = wide ? sidebarHtml() : visibleTabs().map(([id, label]) => `<button class="n-tab ${tab === id ? 'is-on' : ''}" data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}>${ICONS[id]}<span>${label}</span></button>`).join('');
  let float = '';
  if (wide) float = tab === 'backlog' && selected.size ? backlogActions() : '';
  else if (tab === 'backlog' && selecting) float = `<button class="n-btn n-yellow n-wide" data-move-selected ${selected.size ? '' : 'disabled'}>${selected.size ? `Mover ${selected.size} para hoje` : 'Selecione tarefas'}</button>`;
  else if (tab === 'reunioes') float = `<button class="n-quick" data-new-meeting>${ICONS.plus}<span>Nova reunião</span></button>`;
  else if ((tab === 'hoje' && todayTasks().length) || (tab === 'backlog' && (backlog().length || scheduled().length))) float = `<button class="n-quick" data-new-task>${ICONS.plus}<span>Nova tarefa</span></button>`;
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
function closeSheet() { if ($('#sheet').open) $('#sheet').close(); }
const sheetTop = (title, ok = 'Salvar') => `<div class="n-sheet-top"><button type="button" class="n-link" data-close>Cancelar</button><h2 id="sheet-title">${title}</h2>${ok ? `<button class="n-link n-ok">${ok}</button>` : '<span></span>'}</div>`;

function autosize(el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }

// Edits a task (from Hoje/Backlog) or, with {repeatId}, the repeat itself.
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
  const dayOptions = Array.from({length: 31}, (_, i) => `<option value="${i + 1}" ${(repeat?.monthDay || Number(today().slice(8, 10))) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('');
  openSheet(`<form class="n-form" id="task-form">${sheetTop(title)}
    <textarea name="text" rows="1" required maxlength="10000" placeholder="Tarefa" aria-label="Tarefa" ${task || editingRepeat ? '' : 'autofocus'}>${esc(source?.text || '')}</textarea>
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
    ${task || editingRepeat ? `<div class="n-sheet-actions">${repeat && !editingRepeat ? '<button type="button" class="n-btn n-gray" data-stop-repeat>Parar de repetir</button>' : ''}${editingRepeat ? '<button type="button" class="n-btn n-gray n-danger" data-stop-repeat>Parar de repetir</button>' : '<button type="button" class="n-btn n-gray n-danger" data-delete>Excluir tarefa</button>'}</div>` : ''}
  </form>`, () => {
    const form = $('#task-form'), text = form.elements.text;
    autosize(text); text.addEventListener('input', () => autosize(text));
    const whenValue = () => editingRepeat ? 'today' : form.elements.when.value;
    const update = () => {
      // Moved off its past day, the task happens once there.
      const chosen = whenValue(), rule = form.elements.rule.value, repeats = chosen === 'day' || (chosen === 'today' && !pastDay);
      $('[data-today-only]', form).hidden = chosen === 'backlog';
      $('[data-later-only]', form).hidden = chosen !== 'later';
      const pull = $('[data-pull-only]', form);
      if (pull) pull.hidden = chosen === 'backlog';
      // A task on another day happens once; repeating starts from Hoje.
      $('[data-repeat-only]', form).hidden = !repeats;
      $('[data-days]', form).hidden = !repeats || !['daily', 'weekdays', 'custom', 'biweekly'].includes(rule);
      $('[data-first-day]', form).hidden = !repeats || rule !== 'biweekly';
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
      const wantsRepeat = (onDay || (onToday && !pastDay)) && (rule === 'monthly' || (rule !== 'none' && chosen));
      let start = '';
      if (wantsRepeat && rule === 'biweekly') {
        const from = form.elements.start.value;
        if (!from) { toast('Escolha a partir de quando repete.'); return form.elements.start.focus(); }
        // Anchor on the first chosen weekday from that date on.
        start = from;
        while (!chosen.includes(String(weekday(start)))) start = addDays(start, 1);
      }
      const ops = [];
      let rid = repeatId || task?.repeat || '';
      let template = null;
      if ((later || leavingPast) && task?.repeat) {
        // Moving one occurrence to another day leaves the repeat itself alone.
        rid = '';
      } else if (wantsRepeat) {
        rid ||= uid();
        template = {text: value, section: sectionId, time, end, days: rule === 'monthly' ? '' : chosen, monthDay: rule === 'monthly' ? Number(form.elements.monthDay.value) : 0, weeks: start ? 2 : 1, start, meeting};
        ops.push({collection: 'repeats', id: rid, patch: template});
      } else if (rid) {
        ops.push({collection: 'repeats', id: rid, patch: {deleted: true}});
        rid = '';
      }
      let message = later && later !== task?.date ? `Agendada para ${nextDayLabel(later)}.` : leavingPast ? (onToday ? 'Tarefa movida para hoje.' : 'Tarefa movida para o backlog.') : '';
      if (!editingRepeat) {
        if (task) {
          const date = later || (onDay ? pastDay : onToday ? today() : '');
          // Brought from a past day, it starts over as not done.
          ops.push({collection: 'tasks', id: task.id, patch: {text: value, section: sectionId, time, end, meeting, repeat: rid, date, ...(leavingPast ? {done: false} : {})}});
        } else if (later) {
          ops.push({collection: 'tasks', id: uid(), patch: {text: value, section: sectionId, time, end, meeting, repeat: '', date: later, done: false}});
        } else if (wantsRepeat && !repeatsOn(template, today())) {
          const next = nextOccurrence(template);
          message = next ? `Repete a partir de ${nextDayLabel(next)}.` : '';
        } else {
          const newId = wantsRepeat ? occurrenceId(rid, today()) : uid();
          ops.push({collection: 'tasks', id: newId, patch: {text: value, section: sectionId, time, end, meeting, repeat: rid, date: onToday ? today() : '', done: false}});
          if (!onToday && tab !== 'backlog') message = 'Tarefa salva no backlog.';
        }
      }
      commitMany([...ops, ...pullOps]);
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
  const bill = id ? (fromCatalog ? catalogBill(id) : state.bills[id]) : null;
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
      $('[data-amount-opt]', form).hidden = !!card;
      $('[data-due-opt]', form).hidden = !!card;
      form.elements.amount.required = !card;
      $('[data-card-note]', form).hidden = !card;
      if (card) $('[data-card-note]', form).textContent = `O valor e o vencimento vêm da fatura do ${card.name}${cardNow ? `: ${money(cardNow.amount)} em ${monthOf(payMonth())}, ${cardNow.status === 'open' ? 'ainda aberta' : 'fechada'}` : ''}. Marcar como paga continua com você.`;
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
      const amount = card ? cardNow?.amount ?? bill?.amount ?? 0 : parseMoney(form.elements.amount.value);
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
  const bill = fromCatalog ? catalogBill(id) : state.bills[id];
  if (!bill || bill.deleted || bill.skipped) return;
  openSheet(`<div class="n-form">${sheetTop(esc(bill.text), '')}<p class="n-note">${billDate(bill)} · ${money(bill.amount)}</p><button class="n-btn n-gray" data-bill-edit-action>Editar</button><button class="n-btn n-gray n-danger" data-bill-delete-action>Excluir</button></div>`, () => {
    $('[data-bill-edit-action]').onclick = () => billSheet(id, fromCatalog);
    $('[data-bill-delete-action]').onclick = () => deleteBillSheet(bill);
  });
}

function deleteBillSheet(bill) {
  const rule = billRule(state, bill), recurring = rule && !rule.deleted && rule.repeat !== false;
  openSheet(`<form class="n-form" id="delete-bill-form">${sheetTop('Excluir conta', '')}<h3 class="n-delete-title">Excluir ${esc(bill.text)}?</h3><p class="n-note">${billDate(bill)} · ${money(bill.amount)}</p>
    ${recurring ? `<fieldset class="n-bill-scope"><legend>O que excluir?</legend><label><input type="radio" name="scope" value="one" checked><span>Somente este vencimento<small>A recorrência continua no próximo vencimento.</small></span></label><label><input type="radio" name="scope" value="future"><span>Este e os próximos<small>Encerra a recorrência. Preserva o histórico anterior e os outros já pagos.</small></span></label></fieldset>` : '<p class="n-text-block">Esta conta será removida.</p>'}
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
  await fetch('/api/logout', {method: 'POST'}).catch(() => {});
  events?.close(); events = null; clearLocal(); needsLogin = true; render(); loginSheet();
}

let suppressClick = false;
document.addEventListener('input', e => {
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
  else if (d.toggle && d.collection === 'tasks' && projected(d.toggle)) { const {id, ...fields} = projected(d.toggle); commit('tasks', id, {...fields, done: true}); }
  else if (d.toggle) { const c = d.collection; c === 'tasks' ? toggleTask(d.toggle) : commit(c, d.toggle, {done: !state[c][d.toggle].done}); }
  else if (d.editTask && projected(d.editTask)) { const {id, ...fields} = projected(d.editTask); commit('tasks', id, fields).then(() => taskSheet({id})); }
  else if (d.editTask) taskSheet({id: d.editTask});
  else if ('newTask' in d) taskSheet({when: tab === 'backlog' ? 'backlog' : 'today'});
  else if ('newMeeting' in d) taskSheet({when: 'today', meeting: true});
  else if (d.editRepeat) taskSheet({repeatId: d.editRepeat});
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
  else if ('openHistory' in d) { historyDate = defaultHistoryDate(); navigation.push('history'); }
  else if (d.day) { historyDate = d.day; render(); }
  else if ('newOnDay' in d) taskSheet(historyDate > today() ? {when: 'later', date: historyDate} : {when: 'today'});
  else if ('carryDay' in d) { carry(pendingOn(state, historyDate), historyDate); navigation.back(); }
  else if (d.push) navigation.push(d.push);
  else if ('export' in d) exportBackup();
  else if ('logout' in d) logout();
  else if ('login' in d) loginSheet();
  else if ('newPasskey' in d) createPasskey();
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
  const counts = {hoje: todayTasks().filter(t => !t.done).length, reunioes: todayMeetings().filter(t => !t.done).length, backlog: backlog().length, compras: listed(state).filter(i => !i.done).length, contas: live(state, 'bills').filter(b => b.month === month && !b.done).length};
  const nav = mainTabs().map(([id, label], i) => `<button class="d-nav ${tab === id ? 'is-on' : ''}" data-tab="${id}" ${id === 'hoje' ? 'data-drop-today' : ''} ${tab === id ? 'aria-current="page"' : ''} title="${label} (${KEY}${i + 1})">${ICONS[id]}<span>${label}</span><em>${counts[id] || ''}</em></button>`).join('');
  const pending = live(state, 'tasks').filter(t => !t.done && (t.date === '' || t.date === today()));
  const secs = sections().map(s => { const n = pending.filter(t => t.section === s.id).length; return `<button class="d-sec" data-find="${esc(s.name)}" title="Buscar em ${esc(s.name)}">${dot(s.id)}<span>${esc(s.name)}</span><em>${n || ''}</em></button>`; }).join('');
  const sync = needsLogin ? '<button class="d-sync is-off" data-login>Entre para sincronizar</button>'
    : `<span class="d-sync ${online ? '' : 'is-off'}">${!online ? 'Sem conexão' : queue.length ? 'Enviando…' : 'Sincronizado'}</span>`;
  const who = me ? `<span class="n-avatar d-avatar" style="background:${me.color || 'var(--yellow)'}" aria-hidden="true">${esc(me.name[0])}</span><span class="d-who"><b>${esc(me.name)}</b>${sync}</span>` : `<span class="d-who">${sync}</span>`;
  return `<div class="d-side-top"></div><div class="d-navs">${nav}</div><h2 class="d-side-h">Seções</h2><div class="d-secs">${secs}</div>
    <div class="d-side-foot">${who}<button class="d-gear ${tab === 'ajustes' ? 'is-on' : ''}" data-tab="ajustes" aria-label="Ajustes" title="Ajustes (${KEY},)">${ICONS.ajustes}</button></div>`;
}

function toolbar(title, sub, end = '') {
  return `<header class="d-tb"><div class="d-tb-title"><h1>${title}</h1>${sub ? `<p>${sub}</p>` : ''}</div><div class="d-tb-end">${end}<button class="d-search" data-find="" title="Buscar (${KEY}K)">${ICONS.search}<span>Buscar</span><kbd>${KEY}K</kbd></button></div></header>`;
}
const deskAdd = (label, attr) => `<button class="d-add" ${attr}>${ICONS.plus}<span>${label}</span></button>`;

function deskHoje() {
  const tasks = todayTasks();
  const sub = `${longDate(today())}${tasks.length ? ` · ${doneCount(tasks)} de ${tasks.length} feitas` : ''}`;
  const end = `<button class="d-tool" data-open-history>${ICONS.cal}<span>Calendário</span></button>${deskAdd('Nova tarefa', 'data-new-task')}`;
  const example = sections()[0]?.name.split(' ')[0] || 'seção';
  const quick = `<form class="d-quick" id="quick-task">${ICONS.plus}<input name="entry" placeholder="Nova tarefa para hoje. Ex.: Revisar PR 15h #${esc(example)}" autocomplete="off" maxlength="10000" aria-label="Nova tarefa para hoje" aria-describedby="quick-chips"><kbd>N</kbd></form><div class="d-chips" id="quick-chips" aria-live="polite"></div>`;
  const body = tasks.length ? sectionGroups(tasks, 'edit', list => `${doneCount(list)} de ${list.length}`) : '<p class="d-empty">Nada para hoje. Escreva acima e tecle Return.</p>';
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
  const meetings = byTime(todayMeetings());
  if (prefs.reunioes || meetings.length) {
    let marked = false;
    const rows = meetings.map(t => {
      const start = t.time ? minutes(t.time) : null, soon = start !== null && start > now && start - now <= 60;
      const line = !marked && start !== null && start > now ? (marked = true, `<div class="d-now"><b>${clock(now)}</b><hr></div>`) : '';
      return `${line}<button class="d-ev ${t.done || (start !== null && minutes(meetingEnd(t)) <= now) ? 'is-past' : ''}" data-edit-task="${t.id}"><b>${t.time ? esc(timeLabel(t)) : '·'}</b><span style="--c:${sectionColor(t.section)}">${esc(t.text)}<small class="${soon ? 'n-accent' : ''}">${soon ? `em ${start - now} min` : esc(sectionName(t.section))}</small></span></button>`;
    }).join('');
    cards.push(`<section class="d-card"><div class="d-card-h"><h2>Agenda de hoje</h2>${prefs.reunioes ? '<button class="n-link" data-tab="reunioes">Semana</button>' : ''}</div>${rows || '<p class="d-card-empty">Nada na agenda hoje.</p>'}</section>`);
  }
  if (prefs.contas) {
    const day = Number(today().slice(8, 10));
    const due = live(state, 'bills').filter(b => b.month === today().slice(0, 7) && !b.done).sort((a, b) => (a.due || 99) - (b.due || 99)).slice(0, 4);
    const rows = due.map(b => { const late = b.due && b.due < day; return `<button class="d-mini" data-edit-bill="${esc(b.id)}"><span>${esc(b.text)}<small class="${late ? 'is-late' : ''}">${b.due ? `${late ? 'Venceu' : 'Vence'} dia ${b.due}` : 'Sem dia'}</small></span><span class="n-amount">${money(b.amount)}</span></button>`; }).join('');
    cards.push(`<section class="d-card"><div class="d-card-h"><h2>Contas a pagar</h2><button class="n-link" data-tab="contas">Ver todas</button></div>${rows || '<p class="d-card-empty">Tudo pago neste mês.</p>'}</section>`);
  }
  if (prefs.compras) {
    const {toBuy} = shoppingParts(), color = id => people.find(p => p.id === id)?.color || 'var(--secondary)';
    const rows = toBuy.slice(0, 5).map(i => `<button class="d-mini" data-tab="compras"><i class="d-ring" style="--who:${color(i.by)}"></i><span>${esc(i.text)}</span></button>`).join('');
    cards.push(`<section class="d-card"><div class="d-card-h"><h2>Compras</h2><button class="n-link" data-tab="compras">${toBuy.length > 5 ? `Mais ${toBuy.length - 5}` : 'Abrir'}</button></div>${rows || '<p class="d-card-empty">Lista vazia.</p>'}</section>`);
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
    const {start, stop} = m, gone = m.done || date < today() || (date === today() && stop <= now);
    const box = `top:${y(start) + 1}px;height:${Math.max(y(stop) - y(start) - 2, 12)}px;left:calc(${m.lane} * 100% / ${m.lanes} + 3px);width:calc(100% / ${m.lanes} - 6px)`;
    const open = m.repeats ? `data-edit-repeat="${m.id}"` : `data-edit-task="${m.id}" data-row="${m.id}"`;
    if (privateWeek) return `<button class="d-evt is-private" ${open} aria-label="Ocupado, ${timeLabel(m)}" style="${box}"></button>`;
    return `<button class="d-evt ${gone ? 'is-past' : ''} ${m.done ? 'is-done' : ''}" ${open} style="--c:${sectionColor(m.section)};${box}" title="${esc(m.text)}, ${timeLabel(m)} · ${esc(sectionName(m.section))}${m.repeats ? ` · ${esc(repeatLabel(m))}` : ''}"><b>${esc(m.text)}</b><span>${timeLabel(m)}</span></button>`;
  };
  const head = `<div class="d-wk-h" style="${cols}"><span></span>${days.map(d => `<div class="d-wk-day ${d.date === today() ? 'is-today' : ''}"><small>${WEEK[weekday(d.date)].slice(0, 3)}</small><b>${Number(d.date.slice(8, 10))}</b></div>`).join('')}</div>`;
  const untimed = !privateWeek && days.some(d => d.list.some(m => !m.time))
    ? `<div class="d-wk-all" style="${cols}"><span>Sem horário</span>${days.map(d => `<div>${d.list.filter(m => !m.time).map(m => `<button class="d-chip d-evt-chip ${m.done ? 'is-done' : ''}" ${m.repeats ? `data-edit-repeat="${m.id}"` : `data-edit-task="${m.id}"`} style="--c:${sectionColor(m.section)}">${esc(m.text)}</button>`).join('')}</div>`).join('')}</div>` : '';
  const hours = [];
  for (let m = first + 60; m < last; m += 60) hours.push(`<span style="top:${y(m)}px">${clock(m)}</span>`);
  const nowLine = !privateWeek && days.some(d => d.date === today()) && now >= first && now <= last;
  const grid = `<div class="d-wk-b" style="${cols};height:${y(last)}px"><div class="d-wk-gut">${hours.join('')}${nowLine ? `<span class="is-now" style="top:${y(now)}px">${clock(now)}</span>` : ''}</div>
    ${days.map(d => `<div class="d-wk-col ${d.date === today() ? 'is-today' : ''}" data-slot-day="${d.date}" data-first="${first}" data-hour="${HOUR}" style="--hour:${HOUR}px">${meetingLanes(d.list.filter(m => m.time).map(m => ({...m, start: minutes(m.time), stop: minutes(meetingEnd(m))}))).map(m => block(m, d.date)).join('')}${d.date === today() && nowLine ? `<div class="d-wk-now" style="top:${y(now)}px"></div>` : ''}</div>`).join('')}${nowLine ? `<div class="d-wk-now-all" style="top:${y(now)}px"></div>` : ''}</div>`;
  const end = `<div class="d-pager"><button class="d-tool" data-week="-1" aria-label="Semana anterior">‹</button><button class="d-tool" data-week="0" ${weekStart ? '' : 'disabled'}>Esta semana</button><button class="d-tool" data-week="1" aria-label="Próxima semana">›</button></div><button class="d-tool ${privateWeek ? 'is-on' : ''}" data-private-week aria-pressed="${privateWeek}" title="${privateWeek ? 'Mostrar a agenda' : 'Só mostrar horários ocupados'}">${ICONS.eye}</button>${deskAdd('Nova reunião', 'data-new-meeting')}`;
  return `${toolbar('Agenda', weekLabel(days[0].date, days.at(-1).date), end)}<div class="d-week">${statusHtml()}${head}${untimed}${grid}</div>`;
}

function deskBacklog() {
  const tasks = backlog(), waiting = scheduled().filter(t => !(meetingsApart() && t.meeting));
  const body = tasks.length ? sectionGroups(tasks, 'pick', list => list.length)
    : waiting.length ? '' : '<div class="n-empty"><p>Backlog vazio.</p><div class="n-btns"><button class="n-btn n-yellow" data-new-task>Nova tarefa</button></div></div>';
  const hint = tasks.length ? `<p class="d-hint">Clique para selecionar, ${KEY === '⌘' ? '⌘' : 'Ctrl'}-clique para somar e Shift-clique para um intervalo. Arraste até Hoje, na barra lateral, ou use ${KEY}Return.</p>` : '';
  return `${toolbar('Backlog', plural(tasks.length, 'tarefa', 'tarefas'), deskAdd('Nova tarefa', 'data-new-task'))}<div class="d-main d-narrow">${statusHtml()}${agendadasGroup(waiting)}${body}${hint}</div>`;
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
  const {real: bills, projected} = monthBills(billMonth), accruing = accrualRows(billMonth);
  if (!bills.length && !projected.length && !accruing.length) return noBills();
  const sortDue = list => [...list].sort((a, b) => (a.due || 99) - (b.due || 99) || a.text.localeCompare(b.text));
  const unpaid = sortDue(bills.filter(b => !b.done)), paid = sortDue(bills.filter(b => b.done));
  const sum = list => list.reduce((n, b) => n + (b.amount || 0), 0), left = sum(unpaid), total = sum(bills);
  const late = b => b.due && !b.done && (billMonth < current || (billMonth === current && b.due < day));
  const overdue = unpaid.filter(late), next = billMonth === current ? unpaid.find(b => b.due && !late(b)) : null;
  const lastDay = new Date(Number(billMonth.slice(0, 4)), Number(billMonth.slice(5, 7)), 0).getDate();
  const nextDay = next && `${billMonth}-${String(Math.min(next.due, lastDay)).padStart(2, '0')}`;
  const planned = sum(projected), future = billMonth > current;
  const stats = future ? `<div class="d-stats"><div class="d-stat is-big"><span>Previsto no mês</span><strong>${money(left + planned)}</strong><small>${plural(unpaid.length + projected.length, 'conta', 'contas')} a pagar</small></div></div>` : `<div class="d-stats">
    <div class="d-stat is-big"><span>${left ? 'Falta pagar' : bills.length ? 'Tudo pago' : 'Nada a pagar'}</span><strong>${money(left)}</strong><div class="n-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${bills.length}" aria-valuenow="${paid.length}" aria-label="Contas pagas"><span style="width:${bills.length ? paid.length / bills.length * 100 : 0}%"></span></div><small>${paid.length} de ${bills.length} pagas · ${money(total)} no mês</small></div>
    <div class="d-stat ${overdue.length ? 'is-late' : ''}"><span>Atrasadas</span><strong>${overdue.length ? esc(overdue.map(b => b.text).join(', ')) : 'Nenhuma'}</strong><small>${overdue.length ? money(sum(overdue)) : 'Tudo em dia'}</small></div>
    ${billMonth === current && accruing.length ? `<div class="d-stat"><span>Acumulando para ${monthOf(addMonths(billMonth, 1))}</span><strong class="n-accent">${money(accruing.reduce((n, b) => n + b.held * b.unitAmount, 0))}</strong><small>${accruing.length === 1 ? `${esc(accruing[0].text)} · ${accruing[0].held} de ${plural(billIncludedDates(accruing[0]).length, 'sessão', 'sessões')}` : plural(accruing.length, 'conta', 'contas')}</small></div>` : billMonth === current ? `<div class="d-stat"><span>Próximo vencimento</span><strong>${next ? esc(next.text) : 'Nenhum'}</strong><small>${next ? `${WEEK[weekday(nextDay)].toLowerCase()}, dia ${next.due} · ${money(next.amount)}` : 'Nada mais a vencer neste mês'}</small></div>` : ''}
  </div>`;
  const row = b => `<tr class="${b.done ? 'is-done' : ''}" data-bill-row="${esc(b.id)}">
    <td class="d-c-check"><button class="n-check" data-toggle="${esc(b.id)}" data-collection="bills" aria-pressed="${!!b.done}" aria-label="${b.done ? 'Desmarcar' : 'Marcar como paga'} ${esc(b.text)}">${ICONS.check}</button></td>
    <td><button class="d-c-name" data-edit-bill="${esc(b.id)}">${esc(b.text)}${b.calcMode === 'occurrence' ? `<small>${billCalcLabel(b)}</small>` : ''}${cardLabel(b) ? `<small>${esc(cardLabel(b))}</small>` : ''}</button></td>
    <td class="${late(b) ? 'is-late' : ''}">${late(b) ? `Venceu dia ${b.due}` : b.due ? `Dia ${b.due}` : 'Sem dia'}${b.done ? ' <small>paga</small>' : ''}</td>
    <td>${b.repeat !== false ? cap(everyLabel(billEvery(b))) : 'Não repete'}</td>
    <td class="d-num">${money(b.amount)}</td>
    <td class="d-c-more">${billActions(b)}</td></tr>`;
  const plannedRow = b => `<tr class="is-planned"><td class="d-c-check"></td><td><span class="d-c-name">${esc(b.text)}${b.calcMode === 'occurrence' ? `<small>${billCalcLabel(b)}</small>` : ''}${cardLabel(b) ? `<small>${esc(cardLabel(b))}</small>` : ''}</span></td><td>${b.due ? `Dia ${b.due}` : 'Sem dia'}</td><td>${cap(everyLabel(b.every))}</td><td class="d-num">${money(b.amount)}</td><td></td></tr>`;
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
const DESK_VIEWS = {hoje: deskHoje, reunioes: deskReunioes, backlog: deskBacklog, compras: deskCompras, contas: deskContas, ajustes: deskAjustes};

function newTask() {
  if (tab === 'hoje' && $('#quick-task input')) return $('#quick-task input').focus();
  taskSheet(tab === 'reunioes' ? {when: 'today', meeting: true} : {when: tab === 'backlog' ? 'backlog' : 'today'});
}

function deleteTasks(ids) {
  const copies = ids.map(id => state.tasks[id]).filter(t => t && !t.deleted).map(({id, deleted, ...rest}) => rest);
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
  const go = [...mainTabs().map(([id, label], i) => ({group: 'Ir para', icon: ICONS[id], text: label, hint: `${KEY}${i + 1}`, run: () => switchTab(id)})), {group: 'Ir para', icon: ICONS.ajustes, text: 'Ajustes', hint: `${KEY},`, run: () => switchTab('ajustes')}];
  const actions = [
    {group: 'Ações', icon: ICONS.plus, text: 'Nova tarefa', hint: 'N', run: () => taskSheet({when: 'today'})},
    prefs.reunioes && {group: 'Ações', icon: ICONS.reunioes, text: 'Nova reunião', run: () => taskSheet({when: 'today', meeting: true})},
    prefs.contas && {group: 'Ações', icon: ICONS.contas, text: 'Nova conta', run: () => billSheet()},
    {group: 'Ações', icon: ICONS.cal, text: 'Calendário', run: () => { historyDate = defaultHistoryDate(); navigation.push('history'); }},
  ].filter(Boolean);
  if (!key) return [...go, ...actions];
  const where = t => t.date === '' ? 'Backlog' : t.date === today() ? 'Hoje' : dayShort(t.date);
  const tasks = live(state, 'tasks').filter(t => t.date === '' || t.date >= today()).sort((a, b) => (a.date || '9').localeCompare(b.date || '9'))
    .map(t => ({group: t.meeting ? 'Reuniões' : 'Tarefas', color: sectionColor(t.section), text: t.text, sub: `${where(t)} · ${sectionName(t.section)}${t.time ? ` · ${timeLabel(t)}` : ''}${t.done ? ' · feita' : ''}`, run: () => taskSheet({id: t.id})}));
  const repeats = live(state, 'repeats').map(r => ({group: 'Repetições', color: sectionColor(r.section), text: r.text, sub: `${repeatLabel(r)}${r.time ? `, ${timeLabel(r)}` : ''} · ${sectionName(r.section)}`, run: () => taskSheet({repeatId: r.id})}));
  const bills = prefs.contas ? live(state, 'bills').filter(b => b.month === today().slice(0, 7)).map(b => ({group: 'Contas', icon: ICONS.contas, text: b.text, sub: `${b.done ? 'Paga' : b.due ? `Dia ${b.due}` : 'Sem dia'} · ${money(b.amount)}`, run: () => billSheet(b.id)})) : [];
  const shop = prefs.compras ? listed(state).map(i => ({group: 'Compras', icon: ICONS.compras, text: i.text, sub: i.done ? 'No carrinho' : 'Para comprar', run: () => switchTab('compras')})) : [];
  return [...go, ...actions, ...tasks, ...repeats, ...bills, ...shop].filter(x => itemKey(`${x.text} ${x.sub || ''} ${x.group}`).includes(key)).slice(0, 40);
}
function openFinder(q = '') {
  closeMenu();
  finder = {q, i: 0, items: []};
  const el = $('#finder');
  el.innerHTML = `<div class="d-finder-box" role="dialog" aria-modal="true" aria-label="Buscar"><label class="d-finder-in">${ICONS.search}<input id="finder-q" value="${esc(q)}" placeholder="Buscar tarefas, reuniões, contas e comandos" autocomplete="off" role="combobox" aria-expanded="true" aria-controls="finder-list"><kbd>esc</kbd></label><div class="d-finder-list" id="finder-list" role="listbox"></div><p class="d-finder-foot">↑↓ para escolher · Return para abrir</p></div>`;
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
    t.date !== today() ? menuItem('Mover para hoje', `data-ctx="today" data-id="${id}"`, tab === 'backlog' ? `${KEY}↩` : '') : '',
    t.date !== '' && tabPrefs(state).backlog ? menuItem('Mover para o Backlog', `data-ctx="backlog" data-id="${id}"`) : '',
    others.length ? `<div class="d-mi d-has" role="menuitem" aria-haspopup="menu" tabindex="-1"><span>Mover para a seção</span><span class="d-arrow" aria-hidden="true">›</span><div class="d-ctx d-sub" role="menu">${others.map(s => menuItem(`${dot(s.id)}${esc(s.name)}`, `data-ctx="section" data-id="${id}" data-section="${s.id}"`)).join('')}</div></div>` : '',
    '<hr>',
    menuItem('Excluir', `data-ctx="delete" data-id="${id}"`, '⌫', 'is-danger'),
  ].join('');
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
  else if (d.ctx === 'today') moveToToday([id]);
  else if (d.ctx === 'backlog') { commit('tasks', id, {date: '', done: false}); toast('Tarefa movida para o Backlog.'); }
  else if (d.ctx === 'section') commit('tasks', id, {section: d.section});
  else if (d.ctx === 'delete') deleteTasks([id]);
  else if (d.ctx === 'pay') commit('bills', id, {done: !state.bills[id].done});
  else if (d.ctx === 'bill-edit') billSheet(id);
  else if (d.ctx === 'bill-delete') deleteBillSheet(state.bills[id]);
  else if (d.ctx === 'item-done') commit('shopping', id, {done: !state.shopping[id].done});
  else if (d.ctx === 'item-edit') itemSheet(id);
  else if (d.ctx === 'item-remove') { commit('shopping', id, {listed: false, done: false}); toast(`${state.shopping[id].text} tirado da lista.`); }
}
document.addEventListener('contextmenu', e => {
  if (!desktop()) return;
  const task = e.target.closest('[data-row]'), bill = e.target.closest('[data-bill-row]'), item = e.target.closest('[data-item-row]');
  const html = task ? taskMenu(task.dataset.row) : bill ? billMenu(bill.dataset.billRow) : item ? itemMenu(item.dataset.itemRow) : '';
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
  if (!col || e.target.closest('button')) return;
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
  else if (key === 'Enter') { e.preventDefault(); taskSheet({id: task.id}); }
  else if (key === 'Backspace' || key === 'Delete') { e.preventDefault(); deleteTasks(tab === 'backlog' && selected.size ? [...selected] : [task.id]); selected.clear(); }
});

// The time and the "em N min" labels move with the clock.
setInterval(() => { if (desktop() && (tab === 'hoje' || tab === 'reunioes') && !finder && $('#ctx').hidden && !dragIds && !document.activeElement?.closest?.('input')) render(); }, 60000);

// ---------- Lifecycle ----------

// Activate updates on the next opening; never force a reload over unsynced edits.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('/sw.js', {updateViaCache: 'none'}).catch(e => console.warn('Offline:', e.message));
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
sync().then(() => { if (needsLogin) loginSheet(); else { ensureLocal().then(() => { render(); void sync(); }); } });
