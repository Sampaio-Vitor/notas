// Shared by server and client: state shape, patch application and the
// daily/monthly rollover. Every change is a patch {collection,id,patch}.
// `shopping` lives in the shared space; everything else is per person.
export const COLLECTIONS = ['sections', 'tasks', 'repeats', 'bills', 'days', 'months', 'meetings', 'shopping', 'prefs'];

export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const weekday = date => new Date(`${date}T12:00:00`).getDay();
const lastDayOfMonth = date => new Date(Number(date.slice(0, 4)), Number(date.slice(5, 7)), 0).getDate();

export function initialState(names = ['Pessoal', 'Trabalho']) {
  const state = normalize({});
  names.forEach((name, i) => { state.sections[`s${i}`] = {id: `s${i}`, name, order: i}; });
  return state;
}

// Older saved states may lack collections added later.
export function normalize(state) {
  for (const c of COLLECTIONS) state[c] ??= {};
  return state;
}

export function apply(state, op) {
  const {collection, id, patch} = op;
  normalize(state);
  // Patches affect only the edited fields; a deleted record stays deleted.
  if (state[collection][id]?.deleted && !patch.deleted) return state;
  state[collection][id] = {...state[collection][id], ...patch, id};
  return state;
}

// Which optional tabs a person wants (stored per person in prefs.tabs). Hoje and
// Ajustes always show; Reuniões is off until someone turns it on.
export const TAB_DEFAULTS = {reunioes: false, backlog: true, compras: true, contas: true};
export const tabPrefs = state => ({...TAB_DEFAULTS, ...Object.fromEntries(Object.entries(state.prefs?.tabs || {}).filter(([k, v]) => k in TAB_DEFAULTS && typeof v === 'boolean'))});

export const live = (state, collection) => Object.values(state[collection] || {}).filter(x => !x.deleted);

export function sortedSections(state) {
  return Object.values(state.sections).filter(s => !s.deleted)
    .map((s, i) => ({...s, order: s.order ?? 1000 + i}))
    .sort((a, b) => a.order - b.order);
}

// A repeat has either a day of the month (monthDay > 0) or a set of weekdays ("12345").
export function repeatsOn(repeat, date) {
  if (repeat.deleted) return false;
  if (repeat.monthDay > 0) {
    const day = Number(date.slice(8, 10));
    return day === Math.min(repeat.monthDay, lastDayOfMonth(date));
  }
  return String(repeat.days || '').includes(String(weekday(date)));
}

// ---- Bills: months are 'YYYY-MM'. A bill repeats every `every` months (default 1);
// copies share one chain, named by the id without the trailing '-YYYY-MM' parts.
export const billEvery = b => (Number.isInteger(b.every) && b.every >= 1 ? b.every : 1);
export const billChain = id => id.replace(/(?:-\d{4}-\d{2})+$/, '');
export function shiftMonth(month, n) {
  const t = Number(month.slice(0, 4)) * 12 + Number(month.slice(5, 7)) - 1 + n;
  return `${Math.floor(t / 12)}-${String(t % 12 + 1).padStart(2, '0')}`;
}
// The newest record of each chain, deleted ones included (a deleted newest record ends the chain).
function latestByChain(state) {
  const latest = new Map();
  for (const b of Object.values(state.bills || {})) {
    const key = billChain(b.id), seen = latest.get(key);
    if (!seen || b.month > seen.month) latest.set(key, b);
  }
  return latest;
}
// Chains that will keep coming back: the record that carries the schedule forward.
export const repeatingBills = state => [...latestByChain(state).values()].filter(b => !b.deleted && b.repeat !== false);
// What the rollover will create in the `count` months starting at `from`.
export function scheduledBills(state, from, count = 12) {
  const months = Array.from({length: count}, (_, i) => ({month: shiftMonth(from, i), items: [], total: 0}));
  for (const b of repeatingBills(state)) {
    const every = billEvery(b);
    for (const m of months) {
      const gap = (Number(m.month.slice(0, 4)) - Number(b.month.slice(0, 4))) * 12 + Number(m.month.slice(5, 7)) - Number(b.month.slice(5, 7));
      if (gap > 0 && gap % every === 0) { m.items.push({id: b.id, text: b.text, amount: b.amount || 0, due: b.due || 0, every}); m.total += b.amount || 0; }
    }
  }
  for (const m of months) m.items.sort((x, y) => (x.due || 99) - (y.due || 99) || x.text.localeCompare(y.text, 'pt-BR'));
  return months;
}

export const occurrenceId = (repeatId, date) => `r-${repeatId}-${date}`;

export function rollover(state, date) {
  normalize(state);
  const ops = [];
  const add = (collection, id, patch) => ops.push({collection, id, patch});
  if (!state.days[date]) {
    add('days', date, {date});
    for (const r of live(state, 'repeats').filter(r => repeatsOn(r, date))) {
      add('tasks', occurrenceId(r.id, date), {text: r.text, section: r.section, time: r.time || '', date, done: false, repeat: r.id, ...(r.meeting ? {meeting: true} : {})});
    }
  }
  const month = date.slice(0, 7);
  if (!state.months[month]) {
    add('months', month, {month});
    const previous = Object.keys(state.months).filter(m => m < month).sort().at(-1);
    // A bill comes back `every` months after the month it was last copied to; monthly ones
    // also tolerate a gap (previous = the last month that existed).
    for (const b of live(state, 'bills').filter(b => b.repeat !== false)) {
      const every = billEvery(b);
      if (b.month !== shiftMonth(month, -every) && !(every === 1 && b.month === previous)) continue;
      add('bills', `${billChain(b.id)}-${month}`, {text: b.text, amount: b.amount, due: b.due || 0, month, done: false, repeat: true, ...(every > 1 ? {every} : {})});
    }
  }
  return ops;
}

// The old weekly agenda ("meetings") becomes repeating tasks with a time.
export function migrate(state) {
  normalize(state);
  const ops = [];
  for (const m of live(state, 'meetings')) {
    if (!state.repeats[m.id]) ops.push({collection: 'repeats', id: m.id, patch: {text: m.text, section: m.section, time: m.time || '', days: String(m.weekday), monthDay: 0}});
    ops.push({collection: 'meetings', id: m.id, patch: {deleted: true}});
  }
  return ops;
}

// Carried copies point at the original task, so the same pending item is
// offered only once and never copied twice on the same day.
const origin = t => t.from || t.id;
export function carried(state, task) {
  return live(state, 'tasks').some(x => x.id !== task.id && origin(x) === origin(task) && x.date > task.date);
}

export function pendingOn(state, date) {
  return live(state, 'tasks').filter(t => t.date === date && !t.done && !t.repeat && !t.meeting && !carried(state, t));
}

// The most recent earlier day with tasks, if it still has something left undone.
export function lastPending(state, today) {
  const dates = [...new Set(live(state, 'tasks').map(t => t.date).filter(d => d && d < today))].sort();
  const date = dates.at(-1);
  if (!date || state.days[date]?.reviewed) return null;
  const tasks = pendingOn(state, date);
  return tasks.length ? {date, tasks} : null;
}

export function carryOps(tasks, today) {
  return tasks.map(t => ({collection: 'tasks', id: `c-${origin(t)}-${today}`, patch: {text: t.text, section: t.section, time: t.time || '', date: today, done: false, from: origin(t)}}));
}

// Shopping items are keyed by their normalized name, so "Pão" added on one
// phone and "pao" on the other converge on the same record instead of duplicating.
// Items are never deleted: clearing or removing sets listed:false, and adding
// the same name again lists it again.
export const itemKey = text => String(text).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
export const itemId = text => `i-${itemKey(text)}`.slice(0, 200);
export const listed = state => Object.values(state.shopping || {}).filter(i => !i.deleted && i.listed !== false);
