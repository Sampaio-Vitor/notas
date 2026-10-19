import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState, apply, rollover, migrate, repeatsOn, lastPending, pendingOn, carryOps, sortedSections, itemKey, itemId, listed} from '../public/model.js';

const run = (s, ops) => ops.forEach(op => apply(s, op));

test('repetição gera a tarefa uma vez, só nos dias escolhidos', () => {
  const s = initialState();
  s.repeats.r = {id: 'r', text: 'Daily', section: 's1', time: '09:30', days: '12345', monthDay: 0};
  run(s, rollover(s, '2026-10-19')); // segunda
  assert.deepEqual(
    {text: s.tasks['r-r-2026-10-19'].text, time: s.tasks['r-r-2026-10-19'].time, repeat: s.tasks['r-r-2026-10-19'].repeat},
    {text: 'Daily', time: '09:30', repeat: 'r'},
  );
  assert.equal(rollover(s, '2026-10-19').length, 0);
  run(s, rollover(s, '2026-10-18')); // domingo
  assert.equal(s.tasks['r-r-2026-10-18'], undefined);
});

test('repetição mensal usa o último dia quando o mês é mais curto', () => {
  const r = {monthDay: 31, days: ''};
  assert.ok(repeatsOn(r, '2026-02-28'));
  assert.ok(!repeatsOn(r, '2026-02-27'));
  assert.ok(repeatsOn(r, '2026-10-31'));
  assert.ok(!repeatsOn({...r, deleted: true}, '2026-10-31'));
});

test('agenda antiga vira repetição e não é migrada duas vezes', () => {
  const s = initialState();
  s.meetings.m = {id: 'm', weekday: 1, time: '11:00', text: 'Engenharia', section: 's1'};
  run(s, migrate(s));
  assert.deepEqual({...s.repeats.m}, {id: 'm', text: 'Engenharia', section: 's1', time: '11:00', days: '1', monthDay: 0});
  assert.equal(s.meetings.m.deleted, true);
  assert.equal(migrate(s).length, 0);
});

test('novo mês copia só contas que repetem, com pagamento desmarcado', () => {
  const s = initialState();
  s.months['2026-09'] = {month: '2026-09'};
  s.bills.b = {id: 'b', text: 'Energia', amount: 18800, due: 10, month: '2026-09', done: true};
  s.bills.v = {id: 'v', text: 'IPVA', amount: 90000, month: '2026-09', done: true, repeat: false};
  run(s, rollover(s, '2026-10-01'));
  assert.deepEqual({...s.bills['b-2026-10'], id: undefined}, {id: undefined, text: 'Energia', amount: 18800, due: 10, month: '2026-10', done: false, repeat: true});
  assert.equal(s.bills['v-2026-10'], undefined);
  assert.equal(s.bills.b.done, true);
});

test('identificador de conta permanece estável ao longo dos meses', () => {
  const s = initialState();
  s.months['2026-01'] = {month: '2026-01'};
  s.bills.original = {id: 'original', text: 'Conta', amount: 100, month: '2026-01', done: true};
  for (let i = 1; i < 36; i++) {
    const d = new Date(2026, i, 1);
    run(s, rollover(s, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`));
  }
  assert.equal(s.bills['original-2028-12'].amount, 100);
  assert.ok(Object.keys(s.bills).every(id => id.length < 30));
});

test('pendências do último dia: ignora repetições, some depois de trazer ou ignorar', () => {
  const s = initialState();
  run(s, [
    {collection: 'tasks', id: 'a', patch: {text: 'Migrar alertas', section: 's1', date: '2026-10-16', done: false}},
    {collection: 'tasks', id: 'b', patch: {text: 'Planejar', section: 's1', date: '2026-10-16', done: true}},
    {collection: 'tasks', id: 'r-x-2026-10-16', patch: {text: 'Daily', section: 's1', date: '2026-10-16', done: false, repeat: 'x'}},
  ]);
  const pending = lastPending(s, '2026-10-19');
  assert.equal(pending.date, '2026-10-16');
  assert.deepEqual(pending.tasks.map(t => t.id), ['a']);

  const copy = carryOps(pending.tasks, '2026-10-19');
  run(s, copy);
  assert.equal(s.tasks['c-a-2026-10-19'].from, 'a');
  assert.equal(s.tasks.a.done, false, 'histórico preservado');
  assert.equal(pendingOn(s, '2026-10-16').length, 0, 'não oferece duas vezes');
  // Um dia depois, a cópia não feita é oferecida e a nova cópia não acumula prefixos.
  const next = lastPending(s, '2026-10-20');
  assert.deepEqual(carryOps(next.tasks, '2026-10-20').map(o => o.id), ['c-a-2026-10-20']);

  const t = initialState();
  run(t, [{collection: 'tasks', id: 'a', patch: {text: 'X', section: 's1', date: '2026-10-16', done: false}}]);
  run(t, [{collection: 'days', id: '2026-10-16', patch: {date: '2026-10-16', reviewed: true}}]);
  assert.equal(lastPending(t, '2026-10-19'), null);
});

test('seções seguem a ordem salva; antigas sem ordem vão para o fim', () => {
  const s = initialState(['A', 'B', 'C', 'D']);
  s.sections.old = {id: 'old', name: 'Antiga'};
  run(s, [{collection: 'sections', id: 's1', patch: {order: -1}}]);
  assert.deepEqual(sortedSections(s).map(x => x.id), ['s1', 's0', 's2', 's3', 'old']);
});

test('edições independentes são preservadas e exclusão não ressuscita', () => {
  const s = initialState();
  apply(s, {collection: 'tasks', id: 'a', patch: {text: 'Inicial', done: false}});
  apply(s, {collection: 'tasks', id: 'a', patch: {text: 'Novo'}});
  apply(s, {collection: 'tasks', id: 'a', patch: {done: true}});
  assert.deepEqual(s.tasks.a, {id: 'a', text: 'Novo', done: true});
  apply(s, {collection: 'tasks', id: 'a', patch: {deleted: true}});
  apply(s, {collection: 'tasks', id: 'a', patch: {text: 'Antigo'}});
  assert.equal(s.tasks.a.text, 'Novo');
});

test('item de compra: mesmo nome com acento ou caixa diferente vira o mesmo registro', () => {
  assert.equal(itemKey('  Pão   Francês '), 'pao frances');
  assert.equal(itemId('PÃO francês'), itemId('pao  Frances'));
  const s = initialState();
  apply(s, {collection: 'shopping', id: itemId('Leite'), patch: {text: 'Leite', done: false, listed: true, by: 'ana'}});
  apply(s, {collection: 'shopping', id: itemId('leite'), patch: {text: 'leite', done: false, listed: true, by: 'bia'}});
  assert.equal(listed(s).length, 1);
  apply(s, {collection: 'shopping', id: itemId('Leite'), patch: {listed: false, done: false}});
  assert.equal(listed(s).length, 0, 'limpar tira da lista sem apagar');
  apply(s, {collection: 'shopping', id: itemId('Leite'), patch: {listed: true}});
  assert.equal(listed(s).length, 1, 'adicionar de novo volta para a lista');
});
