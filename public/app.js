import {createNavigation} from './navigation.js';
// Report uncaught errors to the server log; on a phone there is no console to look at.
const report = message => { try { navigator.sendBeacon?.('/api/client-log', new Blob([JSON.stringify({message})], {type: 'application/json'})); } catch {} };
addEventListener('error', e => report(`${e.message} @ ${e.filename}:${e.lineno}:${e.colno}`));
addEventListener('unhandledrejection', e => report(`promise: ${e.reason?.stack || e.reason}`));
import {initialState, normalize, apply, dayKey, weekday, rollover, live, sortedSections, repeatsOn, occurrenceId, lastPending, pendingOn, carryOps, itemKey, itemId, listed} from './model.js';

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
  hoje: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M8.5 12.2l2.4 2.4 4.6-5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  backlog: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h10" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
  contas: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5.5" width="17" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 10h17" stroke="currentColor" stroke-width="1.8"/></svg>',
  compras: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5.5 8.5h13l-1 11a1.5 1.5 0 0 1-1.5 1.4H8a1.5 1.5 0 0 1-1.5-1.4z" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"/><path d="M9 8.5V7a3 3 0 0 1 6 0v1.5" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
  ajustes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 7h9M18 7h1M5 17h1M10 17h9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="7" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/><circle cx="8" cy="17" r="2.2" fill="none" stroke="currentColor" stroke-width="1.8"/></svg>',
};
const TABS = [['hoje', 'Hoje'], ['backlog', 'Backlog'], ['compras', 'Compras'], ['contas', 'Contas'], ['ajustes', 'Ajustes']];

// ---------- Local state, outbox and sync ----------

let state = initialState(), queue = [], busy = false, events = null, online = navigator.onLine, needsLogin = false, protectedServer = false;
let passkeys = [], regOptions = null, loginOptions = null;
// Who is signed in. The local cache belongs to one person (`owner`); another
// person signing in on the same device starts from a clean cache.
let me = null, people = [], owner = null, sessionLoaded = false;
let tab = 'hoje', billMonth = today().slice(0, 7), selecting = false, selected = new Set(), historyDate = null, sub = null, dragging = false;

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
    for (const op of ops) { op.opId = uid(); apply(state, op); queue.push(op); }
    save(); render(); void sync();
  });
}
const commit = (collection, id, patch) => commitMany([{collection, id, patch}]);

function ensureLocal() {
  return exclusive(() => {
    reload();
    for (const op of rollover(state, today())) { op.opId = uid(); apply(state, op); queue.push(op); }
    save();
  });
}

async function api(path, options) {
  const r = await fetch(path, {...options, signal: AbortSignal.timeout(10000)});
  if (r.status === 401) { needsLogin = true; throw Error('login'); }
  if (!r.ok) throw Error((await r.json()).error || 'Falha de conexão');
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
        await api('/api/operations', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(queue[0])});
        queue.shift(); save();
      }
      remote = normalize(await (await api('/api/state')).json());
      // Preserve operations entered while the last request was in flight.
      for (const op of queue) apply(remote, op);
      state = remote; online = true; needsLogin = false; save(); render();
      if (!events) {
        events = new EventSource('/api/events');
        events.onmessage = () => void sync();
        events.onerror = () => { online = false; render(); };
      }
    } catch (e) {
      online = false;
      if (e.message !== 'login' && navigator.onLine) console.warn('Sincronização:', e.message);
    } finally { busy = false; render(); }
  });
}

// ---------- Helpers over state ----------

const sections = () => sortedSections(state);
const sectionName = id => state.sections[id]?.name || 'Sem seção';
const tasksOn = date => live(state, 'tasks').filter(t => t.date === date);
const backlog = () => live(state, 'tasks').filter(t => t.date === '');
const byTime = list => [...list].sort((a, b) => (a.time ? 0 : 1) - (b.time ? 0 : 1) || (a.time || '').localeCompare(b.time || ''));
const doneCount = list => list.filter(t => t.done).length;
function lastSection() {
  const id = localStorage.getItem('notas-section');
  return state.sections[id] && !state.sections[id].deleted ? id : sections()[0]?.id;
}
function repeatKind(r) {
  if (!r) return 'none';
  if (r.monthDay > 0) return 'monthly';
  if (r.days === '0123456') return 'daily';
  if (r.days === '12345') return 'weekdays';
  return r.days ? 'custom' : 'none';
}
function repeatLabel(r) {
  const kind = repeatKind(r);
  if (kind === 'monthly') return `Todo mês, dia ${r.monthDay}`;
  if (kind === 'daily') return 'Todo dia';
  if (kind === 'weekdays') return 'Dias úteis';
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
  return `<p class="n-status">${queue.length ? `Sem conexão. ${queue.length === 1 ? '1 alteração será enviada' : `${queue.length} alterações serão enviadas`} quando voltar.` : 'Sem conexão.'}</p>`;
}

function taskRow(t, mode = 'edit') {
  const meta = t.time || t.repeat ? `<span class="n-meta">${t.repeat ? ICONS.rep : ''}${esc(shortTime(t.time))}</span>` : '';
  if (mode === 'read') {
    return `<div class="n-row ${t.done ? 'is-done' : ''}"><span class="n-check" aria-hidden="true">${ICONS.check}</span><span class="n-text">${esc(t.text)}</span>${meta}</div>`;
  }
  if (mode === 'select') {
    const on = selected.has(t.id);
    return `<div class="n-row ${on ? 'is-selected' : ''}"><button class="n-check n-square" data-select="${t.id}" aria-pressed="${on}" aria-label="Selecionar ${esc(t.text)}">${ICONS.check}</button><button class="n-text" data-select="${t.id}">${esc(t.text)}</button></div>`;
  }
  const row = `<div class="n-row ${t.done ? 'is-done' : ''}"><button class="n-check" data-toggle="${t.id}" data-collection="tasks" aria-pressed="${!!t.done}" aria-label="${t.done ? 'Desmarcar' : 'Concluir'} ${esc(t.text)}">${ICONS.check}</button><button class="n-text" data-edit-task="${t.id}">${esc(t.text)}</button>${meta}</div>`;
  if (mode === 'swipe') return `<div class="n-swipe" data-swipe="${t.id}"><span class="n-swipe-action" aria-hidden="true">Hoje</span>${row}</div>`;
  return row;
}

function sectionGroups(tasks, mode, count) {
  return sections().map(s => {
    const list = byTime(tasks.filter(t => t.section === s.id));
    if (!list.length) return '';
    return `<section><div class="n-group-h"><h2>${esc(s.name)}</h2><span>${count(list)}</span></div><div class="n-list">${list.map(t => taskRow(t, mode)).join('')}</div></section>`;
  }).join('') + orphanGroup(tasks, mode, count);
}
// Tasks whose section no longer exists still need to be reachable.
function orphanGroup(tasks, mode, count) {
  const list = byTime(tasks.filter(t => !state.sections[t.section] || state.sections[t.section].deleted));
  return list.length ? `<section><div class="n-group-h"><h2>Sem seção</h2><span>${count(list)}</span></div><div class="n-list">${list.map(t => taskRow(t, mode)).join('')}</div></section>` : '';
}

function viewHoje() {
  const tasks = tasksOn(today()), pending = lastPending(state, today());
  const banner = pending ? `<div class="n-banner"><p>${pending.tasks.length === 1 ? `1 tarefa ${fromDay(pending.date)} não foi feita.` : `${pending.tasks.length} tarefas ${fromDay(pending.date)} não foram feitas.`}</p><div class="n-btns"><button class="n-btn n-yellow" data-carry-last>Trazer para hoje</button><button class="n-btn n-gray" data-ignore-last>Ignorar</button></div></div>` : '';
  const waiting = backlog().length;
  const body = tasks.length
    ? sectionGroups(tasks, 'edit', list => `${doneCount(list)} de ${list.length}`)
    : `<div class="n-empty"><p>Nada para hoje.</p><div class="n-btns"><button class="n-btn n-yellow" data-new-task>Nova tarefa</button>${waiting ? `<button class="n-btn n-gray" data-tab="backlog">Ver backlog (${waiting})</button>` : ''}</div></div>`;
  const avatar = me && people.length > 1 ? `<button class="n-avatar" data-tab="ajustes" style="background:${me.color}" aria-label="Conta de ${esc(me.name)}. Abrir Ajustes">${esc(me.name[0])}</button>` : '<span></span>';
  return `${statusHtml()}<div class="n-top">${avatar}<button class="n-icon" data-open-history aria-label="Dias anteriores">${ICONS.cal}</button></div>
    <h1 class="n-title">Hoje</h1><p class="n-sub">${longDate(today())}${tasks.length ? `<span class="n-sub-count">${doneCount(tasks)} de ${tasks.length} feitas</span>` : ''}</p>${banner}${body}`;
}

function viewBacklog() {
  const tasks = backlog();
  const head = selecting
    ? `<div class="n-top"><span></span><button class="n-link" data-select-mode>Cancelar</button></div><h1 class="n-title">Backlog</h1><p class="n-sub">${selected.size ? plural(selected.size, 'selecionada', 'selecionadas') : 'Toque nas tarefas para selecionar'}</p>`
    : `<div class="n-top"><span></span>${tasks.length ? '<button class="n-link" data-select-mode>Selecionar</button>' : ''}</div><h1 class="n-title">Backlog</h1>`;
  const body = tasks.length
    ? sectionGroups(tasks, selecting ? 'select' : 'swipe', list => list.length)
    : '<div class="n-empty"><p>Backlog vazio.</p><div class="n-btns"><button class="n-btn n-yellow" data-new-task>Nova tarefa</button></div></div>';
  return `${statusHtml()}${head}${body}`;
}

function viewContas() {
  const current = today().slice(0, 7), prev = addMonths(billMonth, -1), next = addMonths(billMonth, 1);
  const bills = live(state, 'bills').filter(b => b.month === billMonth);
  const sortDue = list => [...list].sort((a, b) => (a.due || 99) - (b.due || 99) || a.text.localeCompare(b.text));
  const unpaid = sortDue(bills.filter(b => !b.done)), paid = sortDue(bills.filter(b => b.done));
  const left = unpaid.reduce((n, b) => n + (b.amount || 0), 0);
  const nowDay = Number(today().slice(8, 10));
  const dueMeta = b => {
    if (!b.due || b.done) return '';
    const late = billMonth < current || (billMonth === current && b.due < nowDay);
    return `<span class="n-meta ${late ? 'is-late' : ''}">${late ? 'Venceu' : 'Vence'} dia ${b.due}</span>`;
  };
  const row = b => `<div class="n-row ${b.done ? 'is-done' : ''}"><button class="n-check" data-toggle="${b.id}" data-collection="bills" aria-pressed="${!!b.done}" aria-label="${b.done ? 'Desmarcar' : 'Marcar como paga'} ${esc(b.text)}">${ICONS.check}</button><button class="n-text n-two" data-edit-bill="${b.id}"><span>${esc(b.text)}</span>${dueMeta(b)}</button><span class="n-amount">${money(b.amount)}</span></div>`;
  const top = `<div class="n-top"><button class="n-link" data-month="${prev}">‹ ${monthName(prev)}</button><span class="n-top-end">${billMonth < current ? `<button class="n-link" data-month="${next}">${monthName(next)} ›</button>` : ''}<button class="n-icon" data-new-bill aria-label="Adicionar conta">${ICONS.plus}</button></span></div>`;
  if (!bills.length) {
    return `${statusHtml()}${top}<h1 class="n-title">${monthName(billMonth)}</h1><div class="n-empty"><p>Nenhuma conta em ${MONTHS[Number(billMonth.slice(5, 7)) - 1]}.</p><div class="n-btns"><button class="n-btn n-yellow" data-new-bill>Adicionar conta</button></div></div>`;
  }
  return `${statusHtml()}${top}<h1 class="n-title">${monthName(billMonth)}</h1>
    <div class="n-total"><span>${left ? 'Falta pagar' : 'Tudo pago'}</span><strong>${money(left)}</strong></div>
    <div class="n-bar" role="progressbar" aria-valuemin="0" aria-valuemax="${bills.length}" aria-valuenow="${paid.length}"><span style="width:${paid.length / bills.length * 100}%"></span></div>
    <p class="n-bar-label">${paid.length} de ${bills.length} pagas</p>
    ${unpaid.length ? `<div class="n-group-h"><h2>A pagar</h2></div><div class="n-list">${unpaid.map(row).join('')}</div>` : ''}
    ${paid.length ? `<div class="n-group-h"><h2>Pagas</h2></div><div class="n-list">${paid.map(row).join('')}</div>` : ''}`;
}

function viewCompras() {
  const items = listed(state);
  const toBuy = items.filter(i => !i.done).sort((a, b) => (b.added || 0) - (a.added || 0));
  const inCart = items.filter(i => i.done).sort((a, b) => a.text.localeCompare(b.text, 'pt-BR'));
  const color = id => people.find(p => p.id === id)?.color || 'var(--secondary)';
  const row = i => `<div class="n-row ${i.done ? 'is-done' : ''}" style="--who:${color(i.by)}"><button class="n-check n-who" data-toggle="${esc(i.id)}" data-collection="shopping" aria-pressed="${!!i.done}" aria-label="${i.done ? 'Tirar do carrinho' : 'Pôr no carrinho'}: ${esc(i.text)}">${ICONS.check}</button><button class="n-text" data-edit-item="${esc(i.id)}">${esc(i.text)}</button></div>`;
  const legend = people.length > 1 ? `<p class="n-legend">${people.map(p => `<span><i style="background:${p.color}"></i>${esc(p.name)}</span>`).join('')}</p>` : '';
  return `${statusHtml()}<div class="n-top"></div><h1 class="n-title">Compras</h1>${legend}
    <form class="n-add" id="add-item"><input name="entry" placeholder="Adicionar item" autocomplete="off" autocapitalize="sentences" enterkeyhint="enter" maxlength="200" aria-label="Adicionar item"><button class="n-icon" data-keep-focus aria-label="Adicionar">${ICONS.plus}</button></form>
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
  const monthly = live(state, 'bills').filter(b => b.month === today().slice(0, 7) && b.repeat !== false).length;
  const account = protectedServer && me ? `<div class="n-group-h"><h2>Conta</h2></div>
    <div class="n-list"><div class="n-row n-plain"><span class="n-person-dot" style="background:${me.color}"></span><span class="n-text">${esc(me.name)}</span><button class="n-link n-danger" data-logout>Sair</button></div></div>` : '';
  return `${statusHtml()}<div class="n-top"></div><h1 class="n-title">Ajustes</h1>${account}
    <div class="n-group-h"><h2>Seções</h2></div>
    <div class="n-list" id="section-list">${sections().map(s => `<div class="n-row n-plain" data-section-row="${s.id}"><button class="n-text" data-edit-section="${s.id}">${esc(s.name)}</button><button class="n-handle" data-drag="${s.id}" aria-label="Reordenar ${esc(s.name)}. Use as setas para mover.">≡</button></div>`).join('')}
      <div class="n-row n-plain"><button class="n-text n-accent" data-new-section>Nova seção</button></div></div>
    <p class="n-note">A ordem aqui é a ordem em Hoje e no Backlog.</p>
    <div class="n-group-h"><h2>Repetições</h2></div>
    <div class="n-list">
      <div class="n-row n-plain"><button class="n-text" data-push="repeats">Tarefas que se repetem</button><span class="n-meta">${repeats}</span><span class="n-chev" aria-hidden="true">›</span></div>
      <div class="n-row n-plain"><button class="n-text" data-push="monthly">Contas mensais</button><span class="n-meta">${monthly}</span><span class="n-chev" aria-hidden="true">›</span></div>
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
  const date = historyDate, tasks = tasksOn(date);
  const monday = addDays(date, -((weekday(date) + 6) % 7));
  const week = Array.from({length: 7}, (_, i) => addDays(monday, i));
  const dot = d => { const list = tasksOn(d); return !list.length || d >= today() ? 'is-none' : list.every(t => t.done) ? 'is-all' : ''; };
  const sameMonth = date.slice(0, 7) === today().slice(0, 7);
  const title = `${WEEK[weekday(date)]}, ${Number(date.slice(8, 10))}${sameMonth ? '' : ` de ${MONTHS[Number(date.slice(5, 7)) - 1]}`}`;
  const nextWeek = addDays(monday, 7);
  return {
    html: `<div class="n-top"><button class="n-link" data-back>‹ Hoje</button><label class="n-icon" aria-label="Escolher dia">${ICONS.cal}<input type="date" class="n-hidden-input" data-pick-day max="${addDays(today(), -1)}" value="${date}"></label></div>
      <h1 class="n-title">${title}</h1><p class="n-sub">${tasks.length ? `${doneCount(tasks)} de ${tasks.length} feitas` : 'Nenhuma tarefa neste dia'}</p>
      <div class="n-week">
        <button class="n-week-nav" data-day="${addDays(monday, -7)}" aria-label="Semana anterior">‹</button>
        ${week.map(d => `<button class="n-day ${d === date ? 'is-selected' : ''}" data-day="${d}" ${d >= today() ? 'disabled' : ''} aria-label="${esc(longDate(d))}"><small>${WEEK_INITIAL[weekday(d)]}</small><b>${Number(d.slice(8, 10))}</b><i class="${dot(d)}"></i></button>`).join('')}
        <button class="n-week-nav" data-day="${nextWeek}" ${nextWeek >= today() ? 'disabled' : ''} aria-label="Próxima semana">›</button>
      </div>
      ${sectionGroups(tasks, 'read', list => `${doneCount(list)} de ${list.length}`)}`,
    action: (() => { const n = date < today() ? pendingOn(state, date).length : 0; return n ? `<button class="n-btn n-yellow n-wide" data-carry-day>${n === 1 ? 'Trazer 1 pendente para hoje' : `Trazer ${n} pendentes para hoje`}</button>` : ''; })(),
  };
}

function pageRepeats() {
  const list = live(state, 'repeats');
  const groups = sections().map(s => {
    const items = list.filter(r => r.section === s.id).sort((a, b) => (a.time || '99').localeCompare(b.time || '99'));
    return items.length ? `<div class="n-group-h"><h2>${esc(s.name)}</h2></div><div class="n-list">${items.map(r => `<div class="n-row n-plain"><button class="n-text n-two" data-edit-repeat="${r.id}"><span>${esc(r.text)}</span><span class="n-meta">${esc(repeatLabel(r))}${r.time ? `, ${shortTime(r.time)}` : ''}</span></button><span class="n-chev" aria-hidden="true">›</span></div>`).join('')}</div>` : '';
  }).join('');
  return {html: `<div class="n-top"><button class="n-link" data-back>‹ Ajustes</button></div><h1 class="n-title">Repetições</h1>${groups || '<div class="n-empty"><p>Nenhuma tarefa se repete.</p><p class="n-note">Ao criar uma tarefa para hoje, escolha Repetir.</p></div>'}`, action: ''};
}

function pageMonthly() {
  const month = today().slice(0, 7);
  const list = live(state, 'bills').filter(b => b.month === month && b.repeat !== false).sort((a, b) => (a.due || 99) - (b.due || 99));
  const rows = list.map(b => `<div class="n-row n-plain"><button class="n-text n-two" data-edit-bill="${b.id}"><span>${esc(b.text)}</span>${b.due ? `<span class="n-meta">Dia ${b.due}</span>` : ''}</button><span class="n-amount">${money(b.amount)}</span></div>`).join('');
  return {html: `<div class="n-top"><button class="n-link" data-back>‹ Ajustes</button></div><h1 class="n-title">Contas mensais</h1><p class="n-sub">Voltam todo mês como não pagas.</p>${rows ? `<div class="n-list n-spaced">${rows}</div>` : '<div class="n-empty"><p>Nenhuma conta mensal.</p></div>'}`, action: ''};
}

const PAGES = {history: pageHistory, repeats: pageRepeats, monthly: pageMonthly};

function render() {
  if (dragging) return;
  const screen = $('.page[data-name="root"] .n-screen');
  // Re-rendering replaces the add field; keep what is being typed and the keyboard open.
  const field = $('#add-item input'), typing = field && {value: field.value, focused: document.activeElement === field};
  if (screen) screen.innerHTML = {hoje: viewHoje, backlog: viewBacklog, compras: viewCompras, contas: viewContas, ajustes: viewAjustes}[tab]();
  if (typing && $('#add-item input')) { $('#add-item input').value = typing.value; if (typing.focused) $('#add-item input').focus({preventScroll: true}); }
  $('#tabbar').innerHTML = TABS.map(([id, label]) => `<button class="n-tab ${tab === id ? 'is-on' : ''}" data-tab="${id}" ${tab === id ? 'aria-current="page"' : ''}>${ICONS[id]}<span>${label}</span></button>`).join('');
  let float = '';
  if (tab === 'backlog' && selecting) float = `<button class="n-btn n-yellow n-wide" data-move-selected ${selected.size ? '' : 'disabled'}>${selected.size ? `Mover ${selected.size} para hoje` : 'Selecione tarefas'}</button>`;
  else if ((tab === 'hoje' && tasksOn(today()).length) || (tab === 'backlog' && backlog().length)) float = `<button class="n-quick" data-new-task>${ICONS.plus}<span>Nova tarefa</span></button>`;
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
  if (id !== tab) { tab = id; selecting = false; selected.clear(); }
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
  ready?.(dialog);
}
function closeSheet() { if ($('#sheet').open) $('#sheet').close(); }
const sheetTop = (title, ok = 'Salvar') => `<div class="n-sheet-top"><button type="button" class="n-link" data-close>Cancelar</button><h2 id="sheet-title">${title}</h2>${ok ? `<button class="n-link n-ok">${ok}</button>` : '<span></span>'}</div>`;

function autosize(el) { el.style.height = 'auto'; el.style.height = `${el.scrollHeight}px`; }

// Edits a task (from Hoje/Backlog) or, with {repeatId}, the repeat itself.
function taskSheet({id, repeatId, when} = {}) {
  const task = id ? state.tasks[id] : null;
  const repeat = state.repeats[repeatId || task?.repeat] && !state.repeats[repeatId || task?.repeat].deleted ? state.repeats[repeatId || task?.repeat] : null;
  const editingRepeat = !!repeatId;
  const source = editingRepeat ? repeat : task;
  const section = source?.section && state.sections[source.section] && !state.sections[source.section].deleted ? source.section : lastSection();
  const isBacklog = editingRepeat ? false : task ? task.date === '' : when === 'backlog';
  const kind = repeatKind(repeat);
  const days = repeat && kind !== 'monthly' ? repeat.days : '12345';
  const title = editingRepeat ? 'Editar repetição' : task ? 'Editar tarefa' : 'Nova tarefa';
  const dayOptions = Array.from({length: 31}, (_, i) => `<option value="${i + 1}" ${(repeat?.monthDay || Number(today().slice(8, 10))) === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('');
  openSheet(`<form class="n-form" id="task-form">${sheetTop(title)}
    <textarea name="text" rows="1" required maxlength="10000" placeholder="Tarefa" aria-label="Tarefa" ${task || editingRepeat ? '' : 'autofocus'}>${esc(source?.text || '')}</textarea>
    <fieldset class="n-fieldset"><legend>Seção</legend><div class="n-chips">${sections().map(s => `<label class="n-chip"><input type="radio" name="section" value="${s.id}" ${s.id === section ? 'checked' : ''}><span>${esc(s.name)}</span></label>`).join('')}</div></fieldset>
    ${editingRepeat ? '' : `<fieldset class="n-seg"><legend class="n-sr">Quando</legend><label><input type="radio" name="when" value="today" ${isBacklog ? '' : 'checked'}><span>Hoje</span></label><label><input type="radio" name="when" value="backlog" ${isBacklog ? 'checked' : ''}><span>Backlog</span></label></fieldset>`}
    <div class="n-opts" data-today-only>
      <label class="n-opt">Horário<input type="time" name="time" value="${esc(source?.time || '')}"></label>
      <label class="n-opt">Repetir<select name="rule">
        ${[['none', 'Não repete'], ['daily', 'Todo dia'], ['weekdays', 'Dias úteis'], ['custom', 'Dias escolhidos'], ['monthly', 'Todo mês']].filter(([v]) => !editingRepeat || v !== 'none').map(([v, l]) => `<option value="${v}" ${v === kind ? 'selected' : ''}>${l}</option>`).join('')}
      </select></label>
      <fieldset class="n-days" data-days><legend class="n-sr">Dias da semana</legend>${[0, 1, 2, 3, 4, 5, 6].map(d => `<label><input type="checkbox" name="day" value="${d}" ${days.includes(String(d)) ? 'checked' : ''}><span aria-label="${WEEK[d]}">${WEEK_INITIAL[d]}</span></label>`).join('')}</fieldset>
      <label class="n-opt" data-month-day>Dia do mês<select name="monthDay">${dayOptions}</select></label>
    </div>
    ${task || editingRepeat ? `<div class="n-sheet-actions">${repeat && !editingRepeat ? '<button type="button" class="n-btn n-gray" data-stop-repeat>Parar de repetir</button>' : ''}${editingRepeat ? '<button type="button" class="n-btn n-gray n-danger" data-stop-repeat>Parar de repetir</button>' : '<button type="button" class="n-btn n-gray n-danger" data-delete>Excluir tarefa</button>'}</div>` : ''}
  </form>`, () => {
    const form = $('#task-form'), text = form.elements.text;
    autosize(text); text.addEventListener('input', () => autosize(text));
    const update = () => {
      const onToday = editingRepeat || form.elements.when.value === 'today', rule = form.elements.rule.value;
      $('[data-today-only]', form).hidden = !onToday;
      $('[data-days]', form).hidden = !['daily', 'weekdays', 'custom'].includes(rule);
      $('[data-month-day]', form).hidden = rule !== 'monthly';
    };
    form.elements.rule.addEventListener('change', () => {
      const preset = {daily: '0123456', weekdays: '12345'}[form.elements.rule.value];
      if (preset) for (const box of form.elements.day) box.checked = preset.includes(box.value);
      update();
    });
    $('[data-days]', form).addEventListener('change', () => {
      const chosen = [...form.elements.day].filter(b => b.checked).map(b => b.value).join('');
      form.elements.rule.value = chosen === '0123456' ? 'daily' : chosen === '12345' ? 'weekdays' : 'custom';
    });
    form.addEventListener('change', e => { if (e.target.name === 'when') update(); });
    update();
    form.onsubmit = e => {
      e.preventDefault();
      const value = text.value.trim();
      if (!value) return text.focus();
      const sectionId = form.elements.section.value || lastSection();
      localStorage.setItem('notas-section', sectionId);
      const onToday = editingRepeat || form.elements.when.value === 'today';
      const time = onToday ? form.elements.time.value : '';
      const rule = form.elements.rule.value;
      const chosen = [...form.elements.day].filter(b => b.checked).map(b => b.value).join('');
      const wantsRepeat = onToday && (rule === 'monthly' || (rule !== 'none' && chosen));
      const ops = [];
      let rid = repeatId || task?.repeat || '';
      let template = null;
      if (wantsRepeat) {
        rid ||= uid();
        template = {text: value, section: sectionId, time, days: rule === 'monthly' ? '' : chosen, monthDay: rule === 'monthly' ? Number(form.elements.monthDay.value) : 0};
        ops.push({collection: 'repeats', id: rid, patch: template});
      } else if (rid) {
        ops.push({collection: 'repeats', id: rid, patch: {deleted: true}});
        rid = '';
      }
      let message = '';
      if (!editingRepeat) {
        if (task) {
          ops.push({collection: 'tasks', id: task.id, patch: {text: value, section: sectionId, time, repeat: rid, date: onToday ? (task.date || today()) : ''}});
        } else if (wantsRepeat && !repeatsOn(template, today())) {
          const next = nextOccurrence(template);
          message = next ? `Repete a partir de ${nextDayLabel(next)}.` : '';
        } else {
          const newId = wantsRepeat ? occurrenceId(rid, today()) : uid();
          ops.push({collection: 'tasks', id: newId, patch: {text: value, section: sectionId, time, repeat: rid, date: onToday ? today() : '', done: false}});
          if (!onToday && tab !== 'backlog') message = 'Tarefa salva no backlog.';
        }
      }
      commitMany(ops);
      closeSheet();
      if (message) toast(message);
    };
    $('[data-delete]', form)?.addEventListener('click', () => { commit('tasks', task.id, {deleted: true}); closeSheet(); });
    $('[data-stop-repeat]', form)?.addEventListener('click', () => {
      const ops = [{collection: 'repeats', id: repeat.id, patch: {deleted: true}}];
      if (task) ops.push({collection: 'tasks', id: task.id, patch: {repeat: ''}});
      commitMany(ops); closeSheet(); toast('A tarefa não vai mais se repetir.');
    });
  });
}

function parseMoney(input) {
  let s = String(input).replace(/[^\d,.-]/g, '');
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : null;
}

function billSheet(id) {
  const bill = id ? state.bills[id] : null;
  const month = bill?.month || billMonth;
  const nextMonth = MONTHS[Number(addMonths(month, 1).slice(5, 7)) - 1];
  openSheet(`<form class="n-form" id="bill-form">${sheetTop(bill ? 'Editar conta' : 'Nova conta')}
    <input name="text" required maxlength="200" placeholder="Nome da conta" aria-label="Nome da conta" value="${esc(bill?.text || '')}" ${bill ? '' : 'autofocus'}>
    <div class="n-opts">
      <label class="n-opt">Valor<input name="amount" inputmode="decimal" required placeholder="R$ 0,00" value="${bill ? esc((bill.amount / 100).toFixed(2).replace('.', ',')) : ''}"></label>
      <label class="n-opt">Vence dia<select name="due"><option value="0">Sem dia</option>${Array.from({length: 31}, (_, i) => `<option value="${i + 1}" ${bill?.due === i + 1 ? 'selected' : ''}>${i + 1}</option>`).join('')}</select></label>
      <label class="n-opt">Repetir todo mês<input type="checkbox" class="n-switch" name="repeat" ${bill?.repeat === false ? '' : 'checked'}></label>
    </div>
    <p class="n-note" data-repeat-note>Em ${nextMonth} ela volta como não paga, com o mesmo valor.</p>
    <p class="n-error" data-error hidden>Informe o valor em reais, por exemplo 119,90.</p>
    ${bill ? '<div class="n-sheet-actions"><button type="button" class="n-btn n-gray n-danger" data-delete>Excluir conta</button></div>' : ''}
  </form>`, () => {
    const form = $('#bill-form');
    const note = () => { $('[data-repeat-note]', form).hidden = !form.elements.repeat.checked; };
    form.elements.repeat.addEventListener('change', note); note();
    form.onsubmit = e => {
      e.preventDefault();
      const amount = parseMoney(form.elements.amount.value);
      if (amount === null) { $('[data-error]', form).hidden = false; return form.elements.amount.focus(); }
      commit('bills', id || uid(), {text: form.elements.text.value.trim(), amount, due: Number(form.elements.due.value), repeat: form.elements.repeat.checked, month, ...(!bill ? {done: false} : {})});
      closeSheet();
    };
    $('[data-delete]', form)?.addEventListener('click', () => { commit('bills', id, {deleted: true}); closeSheet(); });
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
  try { loginOptions = {at: Date.now(), value: await (await fetch('/api/passkey/login-options', {method: 'POST'})).json()}; } catch { loginOptions = null; }
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
  if (!loginOptions) throw Error('Sem conexão com o servidor.');
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
function toast(message) {
  const el = $('#toast');
  el.textContent = message; el.classList.add('is-on');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('is-on'), 3500);
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
document.addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b || b.disabled) return;
  if (suppressClick) { suppressClick = false; e.preventDefault(); return; }
  const d = b.dataset;
  if (d.tab) switchTab(d.tab);
  else if ('close' in d) closeSheet();
  else if ('back' in d) navigation.back();
  else if (d.toggle) { const c = d.collection; commit(c, d.toggle, {done: !state[c][d.toggle].done}); }
  else if (d.editTask) taskSheet({id: d.editTask});
  else if ('newTask' in d) taskSheet({when: tab === 'backlog' ? 'backlog' : 'today'});
  else if (d.editRepeat) taskSheet({repeatId: d.editRepeat});
  else if (d.editBill) billSheet(d.editBill);
  else if ('newBill' in d) billSheet();
  else if (d.month) { billMonth = d.month; render(); }
  else if (d.editSection) sectionSheet(d.editSection);
  else if ('newSection' in d) sectionSheet();
  else if ('selectMode' in d) { selecting = !selecting; selected.clear(); render(); }
  else if (d.select) { selected.has(d.select) ? selected.delete(d.select) : selected.add(d.select); render(); }
  else if ('moveSelected' in d) { moveToToday([...selected]); selecting = false; selected.clear(); render(); }
  else if ('carryLast' in d) { const p = lastPending(state, today()); if (p) carry(p.tasks, p.date); }
  else if ('ignoreLast' in d) { const p = lastPending(state, today()); if (p) commit('days', p.date, {date: p.date, reviewed: true}); }
  else if ('openHistory' in d) { historyDate = defaultHistoryDate(); navigation.push('history'); }
  else if (d.day) { historyDate = d.day > addDays(today(), -1) ? addDays(today(), -1) : d.day; render(); }
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
  if (e.target.matches('[data-pick-day]') && e.target.value) { historyDate = e.target.value < today() ? e.target.value : addDays(today(), -1); render(); }
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

// ---------- Lifecycle ----------

window.addEventListener('online', () => sync());
window.addEventListener('offline', () => { online = false; render(); });
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
