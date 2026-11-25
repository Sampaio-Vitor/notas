// Web Push: what deserves a notification and the wording of each one. Server only.
// The pure functions here decide; server.mjs stores subscriptions and sends.
import {tasksForDay, meetingEnd, toMinutes, own, tabPrefs} from './public/model.js';

// Minutes before a meeting that each reminder goes out.
export const MEETING_LEADS = [10, 5];
// A reminder still goes out this long after its minute (a tick may come late, or the
// server may have just started); after that it is skipped instead of arriving late.
const REMINDER_GRACE = 2;
// Push services refuse payloads over 4 KB; names this long are cut.
const clip = (t, n = 120) => { const s = String(t).replace(/\s+/g, ' ').trim(); return s.length > n ? `${s.slice(0, n - 1)}…` : s; };

const live = r => r && !r.deleted;
// On the list and not in the cart: typing an item that is in the cart puts it back, which is news.
export const onList = i => live(i) && i.listed !== false && !i.done && !!i.text;
// A chore restored by Undo comes back as a copy (new id) of one just deleted: same text and list.
export const choreKey = c => `${c.list || ''}\n${c.text || ''}`;

// What someone (`actor`: a person, or an agent's id) just did in Casa that the others should
// hear about: items put on the shopping list, and chores created for one other person or for
// everyone (or handed over to someone). `before` is Casa before these operations; `people`
// are everyone's ids; `justDeleted` holds the choreKey of chores deleted moments ago.
// Each alert has `to`, `kind` ('compras' or 'afazeres'), `id` and `text`.
export function casaAlerts(before, ops, actor, people, justDeleted = new Set()) {
  const alerts = [], seen = new Set();
  const others = people.filter(p => p !== actor);
  // Checking a cycling chore creates the next one in the same batch: that is not news.
  const nextOfCycle = new Set(ops.filter(op => op.collection === 'chores' && op.patch.next).map(op => op.patch.next));
  for (const {collection, id, patch} of ops) {
    const key = `${collection}:${id}`;
    if (seen.has(key)) continue;
    if (collection === 'shopping') {
      const prev = own(before.shopping, id);
      if (patch.listed !== true || patch.done === true || onList(prev) || patch.deleted) continue;
      const text = patch.text || prev?.text;
      if (!text) continue;
      seen.add(key);
      for (const to of others) alerts.push({to, kind: 'compras', id, text});
    }
    if (collection === 'chores') {
      const prev = own(before.chores, id);
      if (patch.deleted || patch.done === true || nextOfCycle.has(id)) continue;
      const fresh = !prev;
      if (fresh && justDeleted.has(choreKey(patch))) continue;
      // An existing chore counts only when it changes hands (to someone, or to everyone).
      if (!fresh && (!live(prev) || prev.done || !('who' in patch) || patch.who === (prev.who || ''))) continue;
      const text = patch.text || prev?.text, who = 'who' in patch ? patch.who : prev?.who || '';
      if (!text) continue;
      seen.add(key);
      const list = patch.list || prev?.list || '';
      const recipients = who === '' ? others : others.includes(who) ? [who] : [];
      for (const to of recipients) alerts.push({to, kind: 'afazeres', id, text, list, forAll: who === ''});
    }
  }
  return alerts;
}

// Whether a queued alert still holds when it is sent, a few seconds later: the item is still
// on the list, the chore still open and still for this person (or for everyone).
export function stillTrue(casa, alert) {
  if (alert.kind === 'compras') return onList(own(casa.shopping, alert.id));
  const c = own(casa.chores, alert.id);
  return !!(live(c) && !c.done && ((c.who || '') === '' || c.who === alert.to));
}

const joinNames = names => {
  const shown = names.slice(0, 3).map(n => clip(n, 60)), rest = names.length - shown.length;
  if (rest > 0) return `${shown.join(', ')} e mais ${rest}`;
  return shown.length > 1 ? `${shown.slice(0, -1).join(', ')} e ${shown.at(-1)}` : shown[0];
};

// Alerts gathered for one person over a few seconds become one notification per kind and
// actor. `name(id)` gives a person's or agent's name; `listName(id)` a Casa list's.
// No tag: a later batch must not replace one still unread.
export function casaMessages(alerts, name, listName) {
  const groups = new Map();
  for (const a of alerts) {
    const key = `${a.kind}:${a.actor}`;
    if (!groups.has(key)) groups.set(key, {kind: a.kind, actor: a.actor, items: []});
    const g = groups.get(key);
    if (!g.items.some(i => i.id === a.id)) g.items.push(a);
  }
  return [...groups.values()].map(({kind, actor, items}) => {
    const who = clip(name(actor), 40);
    if (kind === 'compras') {
      return {title: 'Compras', body: `${who} adicionou ${joinNames(items.map(i => i.text))}`, url: '/?aba=compras&lista=compras'};
    }
    const lists = [...new Set(items.map(i => i.list))];
    const title = lists.length === 1 && listName(lists[0]) ? clip(listName(lists[0]), 60) : 'Casa';
    const url = lists.length === 1 ? `/?aba=compras&lista=${encodeURIComponent(lists[0])}` : '/?aba=compras';
    if (items.length === 1) {
      const [i] = items;
      return {title, body: `${who}: ${clip(i.text)} · ${i.forAll ? 'para todos' : 'para você'}`, url};
    }
    return {title, body: `${who} criou ${items.length} afazeres: ${joinNames(items.map(i => i.text))}`, url};
  });
}

// Reminders due now for one person: meetings of `date` (with a time, not done) whose reminder
// minute came within the last REMINDER_GRACE minutes. `minutes` is the local time of day in
// minutes, counted from the start of `date` (negative or past 1440 for another day). Each
// reminder has a `key`, to send it once.
export function meetingReminders(state, date, minutes) {
  const out = [], aba = tabPrefs(state).reunioes ? 'reunioes' : 'hoje';
  for (const t of tasksForDay(state, date)) {
    if (!t.meeting || !/^\d\d:\d\d$/.test(t.time || '') || t.done) continue;
    const start = toMinutes(t.time);
    for (const lead of MEETING_LEADS) {
      const late = minutes - (start - lead);
      if (!(late >= 0 && late < REMINDER_GRACE)) continue;
      out.push({
        key: `${date}|${t.id}|${t.time}|${lead}`,
        title: clip(t.text),
        body: `Começa em ${lead} min · ${t.time}–${meetingEnd(t)}`,
        tag: `reuniao-${t.id}`,
        url: `/?aba=${aba}`,
      });
    }
  }
  return out;
}
