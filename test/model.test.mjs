import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState, apply, rollover, migrate, repeatsOn, lastPending, pendingOn, carryOps, scheduledTasks, sortedSections, itemKey, itemId, listed, tabPrefs, shiftMonth, scheduledBills, repeatingBills, parseQuickTask, meetingLanes, meetingEnd, onAgenda} from '../public/model.js';

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

test('ocorrência marcada antes do dia chegar não é refeita pela virada', () => {
  const s = initialState();
  s.repeats.r = {id: 'r', text: 'Daily', section: 's1', time: '09:30', days: '12345', monthDay: 0};
  run(s, [{collection: 'tasks', id: 'r-r-2026-10-20', patch: {text: 'Daily movida', section: 's1', time: '10:00', date: '2026-10-20', done: true, repeat: 'r'}}]);
  run(s, rollover(s, '2026-10-20'));
  assert.equal(s.tasks['r-r-2026-10-20'].done, true);
  assert.equal(s.tasks['r-r-2026-10-20'].time, '10:00');
});

test('repetição a cada 2 semanas conta as semanas a partir do início', () => {
  // 2026-10-21 é quarta; segundas e quartas, semana sim, semana não.
  const r = {days: '13', monthDay: 0, weeks: 2, start: '2026-10-21'};
  assert.ok(!repeatsOn(r, '2026-10-19'));
  assert.ok(repeatsOn(r, '2026-10-21'));
  assert.ok(!repeatsOn(r, '2026-10-26'));
  assert.ok(!repeatsOn(r, '2026-10-28'));
  assert.ok(repeatsOn(r, '2026-11-02'));
  assert.ok(repeatsOn(r, '2026-11-04'));
  assert.ok(!repeatsOn(r, '2026-11-05'));
  assert.ok(repeatsOn(r, '2027-03-24'));
  assert.ok(!repeatsOn(r, '2027-03-31'));
  assert.ok(repeatsOn({days: '3', monthDay: 0, weeks: 1}, '2026-10-28'));
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

test('tarefa com data futura espera o dia e então vira tarefa comum do dia', () => {
  const s = initialState();
  run(s, [
    {collection: 'tasks', id: 'k', patch: {text: 'Kickoff', section: 's1', date: '2026-11-05', time: '14:00', meeting: true, done: false}},
    {collection: 'tasks', id: 'd', patch: {text: 'Dentista', section: 's1', date: '2026-10-26', time: '', done: false}},
    {collection: 'tasks', id: 'h', patch: {text: 'Hoje', section: 's1', date: '2026-10-21', done: false}},
    {collection: 'tasks', id: 'b', patch: {text: 'Backlog', section: 's1', date: '', done: false}},
  ]);
  assert.deepEqual(scheduledTasks(s, '2026-10-21').map(t => t.id), ['d', 'k'], 'só datas futuras, a mais próxima primeiro');
  assert.equal(lastPending(s, '2026-10-21'), null, 'data futura não conta como pendência');
  assert.equal(rollover(s, '2026-11-05').some(op => op.collection === 'tasks'), false, 'nada é copiado no dia');
  assert.deepEqual(scheduledTasks(s, '2026-11-05').map(t => t.id), [], 'no dia sai de Agendadas');
  assert.deepEqual(lastPending(s, '2026-11-06'), null, 'reunião não feita não vira pendência');
  run(s, [{collection: 'tasks', id: 'k', patch: {meeting: false}}]);
  assert.deepEqual(lastPending(s, '2026-11-06').tasks.map(t => t.id), ['k'], 'tarefa não feita vira pendência como as outras');
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

test('ocorrência de uma repetição marcada como reunião herda a marca', () => {
  const s = initialState();
  s.repeats.a = {id: 'a', text: 'Daily', section: 's1', time: '11:00', days: '12345', monthDay: 0, meeting: true};
  s.repeats.b = {id: 'b', text: 'Correr', section: 's0', time: '13:30', days: '12345', monthDay: 0};
  run(s, rollover(s, '2026-10-19'));
  assert.equal(s.tasks['r-a-2026-10-19'].meeting, true);
  assert.equal(s.tasks['r-b-2026-10-19'].meeting, undefined);
});

test('abas opcionais: padrão e escolhas da pessoa', () => {
  const s = initialState();
  assert.deepEqual(tabPrefs(s), {reunioes: false, backlog: true, compras: true, contas: true});
  apply(s, {collection: 'prefs', id: 'tabs', patch: {reunioes: true}});
  apply(s, {collection: 'prefs', id: 'tabs', patch: {contas: false}});
  assert.deepEqual(tabPrefs(s), {reunioes: true, backlog: true, compras: true, contas: false});
  s.prefs.tabs.backlog = 'sim';
  assert.equal(tabPrefs(s).backlog, true);
});

test('conta a cada 2 meses só volta de dois em dois meses e mantém o ritmo', () => {
  const s = initialState();
  s.months['2026-10'] = {id: '2026-10', month: '2026-10'};
  s.bills.f = {id: 'f', text: 'Faxina', amount: 60000, due: 25, month: '2026-10', done: true, repeat: true, every: 2};
  s.bills.l = {id: 'l', text: 'Luz', amount: 28000, due: 28, month: '2026-10', done: false, repeat: true};
  run(s, rollover(s, '2026-11-02'));
  assert.equal(s.bills['f-2026-11'], undefined);
  assert.equal(s.bills['l-2026-11'].amount, 28000);
  run(s, rollover(s, '2026-12-01'));
  assert.deepEqual({...s.bills['f-2026-12'], id: undefined}, {id: undefined, text: 'Faxina', amount: 60000, due: 25, month: '2026-12', done: false, repeat: true, every: 2});
  assert.equal(s.bills['l-2026-12'].every, undefined);
  run(s, rollover(s, '2027-01-03'));
  assert.equal(s.bills['f-2027-01'], undefined);
  run(s, rollover(s, '2027-02-01'));
  assert.ok(s.bills['f-2027-02']);
});

test('conta sem repetir, ou excluída no mês, não volta', () => {
  const s = initialState();
  s.months['2026-09'] = {id: '2026-09', month: '2026-09'};
  s.bills.a = {id: 'a', text: 'A', amount: 1, month: '2026-10', repeat: true, every: 3, deleted: true};
  s.bills.a0 = {id: 'a-2026-07', text: 'A', amount: 1, month: '2026-07', repeat: true, every: 3};
  s.bills.b = {id: 'b', text: 'B', amount: 1, month: '2026-07', repeat: true, every: 3};
  run(s, rollover(s, '2026-10-05'));
  assert.equal(s.bills['b-2026-10'].every, 3);
  assert.equal(s.bills['a-2027-01'], undefined);
  assert.deepEqual(repeatingBills(s).map(b => b.id), ['b-2026-10']);
  assert.equal(scheduledBills(s, '2027-01', 1)[0].items.map(i => i.text).join(), 'B');
});

test('agendadas projeta os próximos meses pelo ritmo de cada conta', () => {
  const s = initialState();
  s.bills.l = {id: 'l-2026-09', text: 'Luz', amount: 100, due: 5, month: '2026-09', repeat: true};
  s.bills.l2 = {id: 'l-2026-10', text: 'Luz', amount: 100, due: 5, month: '2026-10', repeat: true};
  s.bills.f = {id: 'f-2026-10', text: 'Faxina', amount: 600, due: 25, month: '2026-10', repeat: true, every: 2};
  s.bills.x = {id: 'x', text: 'Avulsa', amount: 9, month: '2026-10', repeat: false};
  s.bills.y = {id: 'y-2026-08', text: 'Antiga', amount: 7, month: '2026-08', repeat: true};
  s.bills.y2 = {id: 'y-2026-09', text: 'Antiga', amount: 7, month: '2026-09', repeat: true, deleted: true};
  const m = scheduledBills(s, '2026-11', 4);
  assert.deepEqual(m.map(x => x.month), ['2026-11', '2026-12', '2027-01', '2027-02']);
  assert.deepEqual(m.map(x => x.items.map(i => i.text)), [['Luz'], ['Luz', 'Faxina'], ['Luz'], ['Luz', 'Faxina']]);
  assert.deepEqual(m.map(x => x.total), [100, 700, 100, 700]);
  assert.equal(shiftMonth('2026-11', 14), '2028-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('captura rápida entende seção e horário e deixa o resto como texto', () => {
  const secs = [{id: 'a', name: 'Acme'}, {id: 'b', name: 'Pessoal'}, {id: 'c', name: 'Globex Ads'}];
  assert.deepEqual(parseQuickTask('Revisar PR 15h #acm', secs), {text: 'Revisar PR', section: 'a', time: '15:00'});
  assert.deepEqual(parseQuickTask('#pess Dentista às 9h30', secs), {text: 'Dentista', section: 'b', time: '09:30'});
  assert.deepEqual(parseQuickTask('Call 14:05 #globexads', secs), {text: 'Call', section: 'c', time: '14:05'});
  assert.deepEqual(parseQuickTask('Ler #livro', secs), {text: 'Ler #livro', section: '', time: ''});
  assert.deepEqual(parseQuickTask('Comprar 2h de crédito? não: 25h', secs), {text: 'Comprar de crédito? não: 25h', section: '', time: '02:00'});
  assert.deepEqual(parseQuickTask('Versão 1.15h', secs), {text: 'Versão 1.15h', section: '', time: ''});
});

test('reuniões que se sobrepõem dividem a coluna do dia', () => {
  const half = (id, start) => ({id, start, stop: start + 30});
  const out = meetingLanes([half('c', 16 * 60), half('a', 11 * 60), half('b', 11 * 60), half('d', 16 * 60 + 30)]);
  const by = Object.fromEntries(out.map(x => [x.id, [x.lane, x.lanes]]));
  assert.deepEqual(by, {a: [0, 2], b: [1, 2], c: [0, 1], d: [0, 1]});
  const chain = Object.fromEntries(meetingLanes([half('x', 0), half('y', 20), half('z', 40)]).map(x => [x.id, [x.lane, x.lanes]]));
  assert.deepEqual(chain, {x: [0, 2], y: [1, 2], z: [0, 2]});
});

test('reuniões longas ocupam a coluna até o fim', () => {
  const out = meetingLanes([{id: 'long', start: 600, stop: 720}, {id: 'mid', start: 660, stop: 690}, {id: 'after', start: 720, stop: 750}]);
  const by = Object.fromEntries(out.map(x => [x.id, [x.lane, x.lanes]]));
  assert.deepEqual(by, {long: [0, 2], mid: [1, 2], after: [0, 1]});
});

test('reunião sem fim, ou com fim antes do início, dura 30 minutos', () => {
  assert.equal(meetingEnd({time: '14:00', end: '15:30'}), '15:30');
  assert.equal(meetingEnd({time: '14:00'}), '14:30');
  assert.equal(meetingEnd({time: '14:00', end: '13:00'}), '14:30');
  assert.equal(meetingEnd({time: '23:45', end: ''}), '23:59');
});

test('a ocorrência de uma reunião repetida leva o fim junto', () => {
  const s = initialState();
  s.repeats.r = {id: 'r', text: 'Planning', section: 's1', time: '10:00', end: '11:30', days: '1', monthDay: 0, meeting: true};
  for (const op of rollover(s, '2026-10-19')) apply(s, op);
  assert.equal(s.tasks['r-r-2026-10-19'].end, '11:30');
});

test('tarefa com horário entra na agenda e a repetição leva início e fim', () => {
  assert.equal(onAgenda({time: '09:00'}), true);
  assert.equal(onAgenda({meeting: true, time: ''}), true);
  assert.equal(onAgenda({time: ''}), false);
  const s = initialState();
  s.repeats.r = {id: 'r', text: 'Academia', section: 's1', time: '07:00', end: '08:00', days: '1', monthDay: 0};
  s.repeats.u = {id: 'u', text: 'Ler', section: 's1', time: '', days: '1', monthDay: 0};
  for (const op of rollover(s, '2026-10-19')) apply(s, op);
  assert.equal(s.tasks['r-r-2026-10-19'].end, '08:00');
  assert.equal(s.tasks['r-r-2026-10-19'].meeting, undefined);
  assert.equal(s.tasks['r-u-2026-10-19'].end, undefined);
});
