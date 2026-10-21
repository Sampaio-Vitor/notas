// Shared by server and client: state shape, patch application and the
// daily/monthly rollover. Every change is a patch {collection,id,patch}.
// `shopping` lives in the shared space; everything else is per person.
export const COLLECTIONS = ['sections', 'tasks', 'repeats', 'bills', 'billRules', 'days', 'months', 'meetings', 'shopping', 'prefs'];

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
// Ajustes always show; Agenda (id `reunioes`, its old name) is off until someone turns it on.
export const TAB_DEFAULTS = {reunioes: false, backlog: true, compras: true, contas: true};
export const tabPrefs = state => ({...TAB_DEFAULTS, ...Object.fromEntries(Object.entries(state.prefs?.tabs || {}).filter(([k, v]) => k in TAB_DEFAULTS && typeof v === 'boolean'))});

export const live = (state, collection) => Object.values(state[collection] || {}).filter(x => !x.deleted && !(collection === 'bills' && x.skipped));

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
// Explicit rules take precedence; untouched legacy chains infer their latest record.
export function billRule(state, bill) {
  const key = billChain(bill.id);
  return state.billRules?.[key] || latestByChain(state).get(key);
}
export function repeatingBills(state) {
  const rules = latestByChain(state);
  for (const r of Object.values(state.billRules || {})) rules.set(r.id, r);
  return [...rules.values()].filter(b => !b.deleted && b.repeat !== false && /^\d{4}-(0[1-9]|1[0-2])$/.test(b.month));
}
const monthGap = (a, b) => (Number(a.slice(0, 4)) - Number(b.slice(0, 4))) * 12 + Number(a.slice(5, 7)) - Number(b.slice(5, 7));
// With lag 1 a bill pays the sessions of the month before its own (October's, paid in November).
export const billSessionMonth = (b, month = b.month) => shiftMonth(month, -(b.lag === 1 ? 1 : 0));
export function billDates(b, month = b.month) {
  if (b.calcMode !== 'occurrence') return [];
  const dates = [], source = billSessionMonth(b, month);
  for (let day = 1; day <= lastDayOfMonth(`${source}-01`); day++) {
    const date = `${source}-${String(day).padStart(2, '0')}`;
    if (date >= (b.starts || '') && String(b.weekdays || '').includes(String(weekday(date)))) dates.push(date);
  }
  return dates;
}
export const billIncludedDates = b => billDates(b).filter(date => !String(b.excluded || '').split(',').includes(date));
// Each occurrence stores its own pricing inputs and total. Rules never carry exclusions.
const calcFields = b => b.calcMode ? {calcMode: b.calcMode, unitAmount: b.unitAmount || 0, weekdays: b.weekdays || '', starts: b.starts || '', excluded: b.excluded || '', lag: b.lag === 1 ? 1 : 0} : {};
export function billSnapshot(b, month = b.month) {
  const value = {...b, month};
  return {...calcFields(value), amount: value.calcMode === 'occurrence' ? billIncludedDates(value).length * (value.unitAmount || 0) : value.amount || 0};
}
const billFields = b => ({text: b.text, amount: b.amount || 0, due: b.due || 0, repeat: b.repeat !== false, every: billEvery(b), month: b.month, ...calcFields(b)});
const ruleFields = b => ({...billFields(b), ...(b.calcMode ? {excluded: ''} : {})});
const ruleFingerprint = b => JSON.stringify(b ? {...ruleFields(b), deleted: !!b.deleted} : null);
const recordFingerprint = b => JSON.stringify(b ? Object.fromEntries(Object.keys(b).sort().map(key => [key, b[key]])) : null);
// Compare against the state before the entire gesture, never against partially applied patches.
export function guardBillOps(state, ops) {
  return ops.map(op => !['bills', 'billRules'].includes(op.collection) ? op : {...op,
    ...(op.collection === 'bills' ? {expectedBill: recordFingerprint(state.bills[op.id])} : {}),
    expectedBillRule: ruleFingerprint(billRule(state, {id: op.id})),
  });
}
export function billOpsConflict(state, ops) {
  return ops.some(op => (op.expectedBill !== undefined && op.expectedBill !== recordFingerprint(state.bills[op.id]))
    || (op.expectedBillRule !== undefined && op.expectedBillRule !== ruleFingerprint(billRule(state, {id: op.id}))));
}
const billOp = (id, patch, collection = 'bills') => ({collection, id, patch});
function occurrence(state, rule, month) {
  const chain = billChain(rule.id);
  return Object.values(state.bills || {}).find(b => billChain(b.id) === chain && b.month === month);
}
export function nextBillMonth(rule, from) {
  return shiftMonth(rule.month, Math.max(1, Math.ceil(monthGap(from, rule.month) / billEvery(rule))) * billEvery(rule));
}
// One row per active series, including a virtual next occurrence outside the projection window.
// Pending one-off bills are included individually; payment history stays in the monthly view.
export function billCatalog(state, month) {
  const rows = repeatingBills(state).map(rule => {
    const chain = billChain(rule.id);
    const pending = live(state, 'bills').filter(b => billChain(b.id) === chain && b.month >= month && !b.done).sort((a, b) => a.month.localeCompare(b.month))[0];
    if (pending) return {...pending, recurring: true};
    let next = nextBillMonth(rule, month);
    // Skip exceptions already paid, removed or skipped; there is no fixed month horizon.
    while (occurrence(state, rule, next)) next = shiftMonth(next, billEvery(rule));
    return {...billFields(rule), ...billSnapshot({...rule, excluded: ''}, next), id: `${chain}-${next}`, month: next, done: false, recurring: true, virtual: true};
  });
  rows.push(...live(state, 'bills').filter(b => b.repeat === false && !b.done).map(b => ({...b, recurring: false})));
  return rows.sort((a, b) => a.month.localeCompare(b.month) || (a.due || 32) - (b.due || 32) || a.text.localeCompare(b.text, 'pt-BR'));
}
// Freeze the legacy inferred rule before changing an occurrence, so exceptions never
// become the template for the next month. Existing installations need no bulk migration.
export function editBillOps(state, bill, patch, scope = 'one', expectedRule) {
  bill = state.bills[bill.id] || bill;
  if (bill.deleted || bill.skipped) return [];
  const chain = billChain(bill.id), rule = billRule(state, bill), ops = [];
  if (expectedRule !== undefined && ruleFingerprint(rule) !== ruleFingerprint(expectedRule)) return [];
  const recurring = rule && !rule.deleted && rule.repeat !== false;
  if (bill.virtual && !recurring) return [];
  if (recurring && !state.billRules?.[chain]) ops.push(billOp(chain, ruleFields(rule), 'billRules'));
  if (!recurring && patch.repeat === true) ops.push(billOp(chain, ruleFields({...billFields(bill), ...patch, month: bill.month}), 'billRules'));
  if (scope === 'future' && recurring) {
    ops.push(billOp(chain, ruleFields({...billFields(rule), ...patch, month: bill.month}), 'billRules'));
    for (const b of Object.values(state.bills).filter(b => !b.deleted && (!b.skipped || b.skipReason === 'frequency') && billChain(b.id) === chain && b.month > bill.month && !b.done)) {
      const updated = {...b, ...patch, month: b.month, excluded: b.excluded || ''};
      const suppressed = patch.repeat === false || monthGap(b.month, bill.month) % patch.every !== 0;
      ops.push(billOp(b.id, suppressed ? {skipped: true, skipReason: patch.repeat === false ? 'removed' : 'frequency'} : {text: patch.text, ...billSnapshot(updated), due: patch.due, repeat: true, every: patch.every, skipped: false, skipReason: ''}));
    }
  }
  const value = scope === 'one' && recurring ? {text: patch.text, ...billSnapshot({...bill, ...patch}), due: patch.due} : {...patch, ...billSnapshot({...bill, ...patch})};
  ops.push(billOp(bill.id, {...(bill.virtual ? {...billFields(bill), done: false} : {}), ...value, month: bill.month}));
  return ops;
}
export function deleteBillOps(state, bill, scope = 'one') {
  bill = state.bills[bill.id] || bill;
  if (bill.deleted || bill.skipped) return [];
  const chain = billChain(bill.id), rule = billRule(state, bill), ops = [];
  const recurring = rule && !rule.deleted && rule.repeat !== false;
  if (bill.virtual && !recurring) return [];
  if (recurring) {
    if (!state.billRules?.[chain] || scope === 'future') ops.push(billOp(chain, {...ruleFields(rule), ...(scope === 'future' ? {repeat: false} : {})}, 'billRules'));
    if (scope === 'future') for (const b of Object.values(state.bills).filter(b => !b.deleted && (!b.skipped || b.skipReason === 'frequency') && billChain(b.id) === chain && b.month > bill.month && !b.done)) ops.push(billOp(b.id, {skipped: true, skipReason: 'removed'}));
  }
  ops.push(billOp(bill.id, {...(bill.virtual ? {...billFields(bill), done: false} : {}), skipped: true, skipReason: 'removed'}));
  return ops;
}
export function undoBillOps(state, bill, ops) {
  const rule = billRule(state, bill);
  return ops.map(op => {
    const before = state[op.collection][op.id] || (op.collection === 'billRules' && rule ? ruleFields(rule) : null);
    const patch = {};
    for (const [key, value] of Object.entries(op.patch)) {
      if (before?.[key] !== undefined) patch[key] = before[key];
      else if (key === 'skipped') patch[key] = false;
      else if (key === 'skipReason') patch[key] = '';
      else if (op.collection === 'billRules') patch[key] = value;
    }
    return {collection: op.collection, id: op.id, patch};
  });
}
// What the rollover will create in the `count` months starting at `from`.
export function scheduledBills(state, from, count = 12) {
  const months = Array.from({length: count}, (_, i) => ({month: shiftMonth(from, i), items: [], total: 0}));
  for (const b of repeatingBills(state)) {
    const every = billEvery(b);
    for (const m of months) {
      const gap = monthGap(m.month, b.month), existing = occurrence(state, b, m.month);
      if (existing) {
        if (!existing.deleted && !existing.skipped && !existing.done) { m.items.push({...existing, every}); m.total += existing.amount || 0; }
      } else if (gap > 0 && gap % every === 0) { const snapshot = billSnapshot({...b, excluded: ''}, m.month); m.items.push({id: b.id, text: b.text, ...snapshot, month: m.month, due: b.due || 0, every}); m.total += snapshot.amount; }
    }
  }
  for (const m of months) m.items.sort((x, y) => (x.due || 99) - (y.due || 99) || x.text.localeCompare(y.text, 'pt-BR'));
  return months;
}

// Bills paid next month whose sessions happen in `month`: the next record of the chain
// when it already exists, otherwise what the rule will create there.
export function accruingBills(state, month) {
  const pay = shiftMonth(month, 1), rows = [];
  for (const rule of repeatingBills(state).filter(r => r.calcMode === 'occurrence' && r.lag === 1)) {
    const existing = occurrence(state, rule, pay), gap = monthGap(pay, rule.month);
    if (existing) { if (!existing.deleted && !existing.skipped) rows.push({...existing, every: billEvery(rule)}); }
    else if (gap > 0 && gap % billEvery(rule) === 0) rows.push({...billFields(rule), ...billSnapshot({...rule, excluded: ''}, pay), id: `${billChain(rule.id)}-${pay}`, month: pay, done: false, virtual: true});
  }
  return rows.filter(b => billDates(b).length).sort((a, b) => (a.due || 99) - (b.due || 99) || a.text.localeCompare(b.text, 'pt-BR'));
}

export const occurrenceId = (repeatId, date) => `r-${repeatId}-${date}`;

export function rollover(state, date) {
  normalize(state);
  const ops = [];
  const add = (collection, id, patch) => ops.push({collection, id, patch});
  if (!state.days[date]) {
    add('days', date, {date});
    for (const r of live(state, 'repeats').filter(r => repeatsOn(r, date))) {
      add('tasks', occurrenceId(r.id, date), {text: r.text, section: r.section, time: r.time || '', date, done: false, repeat: r.id, ...(r.time ? {end: r.end || ''} : {}), ...(r.meeting ? {meeting: true} : {})});
    }
  }
  const month = date.slice(0, 7);
  if (!state.months[month]) {
    add('months', month, {month});
    // Generate only this month's due occurrences; keep cadence across server downtime.
    for (const b of repeatingBills(state)) {
      const every = billEvery(b);
      const gap = monthGap(month, b.month);
      if (gap <= 0 || gap % every !== 0 || occurrence(state, b, month)) continue;
      add('bills', `${billChain(b.id)}-${month}`, {text: b.text, ...billSnapshot({...b, excluded: ''}, month), due: b.due || 0, month, done: false, repeat: true, ...(every > 1 ? {every} : {})});
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

// Tasks given a later date wait for their day, soonest first; on the day they
// are ordinary tasks of that day, so nothing has to copy or generate them.
export function scheduledTasks(state, today) {
  return live(state, 'tasks').filter(t => t.date > today)
    .sort((a, b) => a.date.localeCompare(b.date) || (a.time || '99').localeCompare(b.time || '99'));
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

// Quick add on the desktop: "Revisar PR 15h #trab" → text, section id and time.
// A #tag that matches no section stays in the text.
export function parseQuickTask(input, sections) {
  let text = ` ${String(input).replace(/\s+/g, ' ').trim()} `, section = '', time = '';
  const tag = text.match(/ #(\S+)/);
  if (tag) {
    const key = itemKey(tag[1]).replace(/ /g, '');
    const found = key && sections.find(s => itemKey(s.name).replace(/ /g, '').startsWith(key));
    if (found) { section = found.id; text = text.replace(tag[0], ' '); }
  }
  const at = text.match(/ (?:(?:às|as) )?([01]?\d|2[0-3])(?:h([0-5]\d)?|:([0-5]\d))(?= )/i);
  if (at) { time = `${at[1].padStart(2, '0')}:${at[2] || at[3] || '00'}`; text = text.replace(at[0], ' '); }
  return {text: text.replace(/\s+/g, ' ').trim(), section, time};
}

// Anything with a time runs from `time` to `end` ("HH:MM", same day) and shows in
// Agenda. Ones saved before they had an end, or with an end not after the start,
// last 30 minutes.
export const onAgenda = t => !!(t.meeting || t.time);
export const toMinutes = time => Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
export const fromMinutes = m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
export const meetingEnd = m => m.end && m.end > m.time ? m.end : fromMinutes(Math.min(toMinutes(m.time) + 30, 23 * 60 + 59));

// Week view: meetings that overlap share the width side by side. Each item has
// `start` and `stop` in minutes.
export function meetingLanes(items) {
  const placed = [];
  let cluster = [], ends = [], clusterEnd = -Infinity;
  const close = () => { for (const item of cluster) item.lanes = ends.length; cluster = []; ends = []; };
  for (const item of [...items].sort((a, b) => a.start - b.start || b.stop - a.stop)) {
    if (item.start >= clusterEnd) close();
    let lane = ends.findIndex(end => end <= item.start);
    if (lane < 0) lane = ends.length;
    ends[lane] = item.stop;
    clusterEnd = Math.max(clusterEnd, item.stop);
    const out = {...item, lane};
    cluster.push(out); placed.push(out);
  }
  close();
  return placed;
}
