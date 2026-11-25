import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState, apply, rollover} from '../public/model.js';
import {spaceTool, SPACE_TOOLS} from '../mcp-espaco.mjs';
import {validate} from '../validacao.mjs';

// Wednesday, 4 November 2026.
const HOJE = '2026-11-04';
let n = 0;
const novoId = () => `t${++n}`;

function estado() {
  const s = initialState(['Pessoal', 'Trabalho', 'Saúde']);
  const ops = [
    {collection: 'tasks', id: 'a', patch: {text: 'Pagar luz', section: 's0', date: HOJE, time: '', done: false, repeat: ''}},
    {collection: 'tasks', id: 'b', patch: {text: 'Reunião', section: 's1', date: HOJE, time: '09:00', done: false, repeat: ''}},
    {collection: 'tasks', id: 'c', patch: {text: 'Ler artigo', section: 's1', date: '', time: '', done: false, repeat: ''}},
    {collection: 'tasks', id: 'd', patch: {text: 'Ficou pra trás', section: 's0', date: '2026-11-02', time: '', done: false, repeat: ''}},
    {collection: 'tasks', id: 'e', patch: {text: 'Dentista', section: 's2', date: '2026-11-10', time: '14:00', done: false, repeat: ''}},
    // Every Thursday (4) and Friday (5).
    {collection: 'repeats', id: 'gym', patch: {text: 'Academia', section: 's2', time: '07:00', end: '08:00', days: '45', monthDay: 0}},
    {collection: 'bills', id: 'net-2026-11', patch: {text: 'Internet', amount: 12990, due: 10, month: '2026-11', done: false, repeat: true}},
    {collection: 'bills', id: 'agua-2026-11', patch: {text: 'Água', amount: 8000, due: 2, month: '2026-11', done: false, repeat: true}},
    {collection: 'bills', id: 'gas-2026-11', patch: {text: 'Gás', amount: 5000, due: 1, month: '2026-11', done: true, repeat: true}},
  ];
  for (const op of ops) apply(s, op);
  for (const op of rollover(s, HOJE)) apply(s, op);
  return s;
}

const roda = (s, name, args = {}, hoje = HOJE, agente = 'robo') => spaceTool(s, name, args, hoje, novoId, agente);

test('ferramentas: nomes e esquemas', () => {
  assert.deepEqual(SPACE_TOOLS.map(t => t.name), ['tarefas_dia', 'tarefas_backlog', 'tarefa_criar', 'tarefa_editar', 'tarefa_concluir', 'tarefa_mover', 'contas_mes', 'contas_proximas']);
  for (const t of SPACE_TOOLS) assert.equal(t.inputSchema.type, 'object');
});

test('tarefas_dia: por seção, com hora primeiro, e as repetições de um dia ainda não aberto', () => {
  const s = estado();
  const hoje = roda(s, 'tarefas_dia').result;
  assert.equal(hoje.data, HOJE);
  assert.deepEqual(hoje.secoes.map(g => [g.secao, g.tarefas.map(t => t.texto)]), [['Pessoal', ['Pagar luz']], ['Trabalho', ['Reunião']]]);
  assert.deepEqual(hoje.secoes[1].tarefas[0], {id: 'b', texto: 'Reunião', secao: 'Trabalho', feita: false, horario: '09:00', repete: false});
  // Quinta: a academia aparece, ainda não gravada.
  const quinta = roda(s, 'tarefas_dia', {data: '2026-11-05'}).result;
  assert.deepEqual(quinta.secoes, [{secao: 'Saúde', tarefas: [{id: 'r-gym-2026-11-05', texto: 'Academia', secao: 'Saúde', feita: false, horario: '07:00', fim: '08:00', repete: true}]}]);
  assert.throws(() => roda(s, 'tarefas_dia', {data: '2026-02-30'}), /AAAA-MM-DD/);
});

test('tarefas_backlog: backlog, o que ficou para trás e as agendadas', () => {
  const r = roda(estado(), 'tarefas_backlog').result;
  assert.deepEqual(r.backlog.map(g => [g.secao, g.tarefas.map(t => t.texto)]), [['Trabalho', ['Ler artigo']]]);
  assert.deepEqual(r.ficaram_para_tras.map(t => [t.texto, t.data]), [['Ficou pra trás', '2026-11-02']]);
  assert.deepEqual(r.agendadas.map(t => [t.texto, t.data]), [['Dentista', '2026-11-10']]);
});

test('tarefa_criar: seção pelo nome sem acento, hora com o fim, e o erro com as seções', () => {
  const s = estado();
  let r = roda(s, 'tarefa_criar', {texto: '  Marcar   exame ', quando: 'amanhã', secao: 'saude', horario: '10:30'});
  assert.deepEqual(r.result, {id: r.ops[0].id, texto: 'Marcar exame', secao: 'Saúde', data: '2026-11-05', horario: '10:30', fim: '11:00'});
  assert.deepEqual(r.ops[0].patch, {text: 'Marcar exame', section: 's2', time: '10:30', end: '11:00', meeting: false, repeat: '', date: '2026-11-05', done: false});
  r = roda(s, 'tarefa_criar', {texto: 'Comprar pilha', quando: 'backlog'});
  assert.equal(r.ops[0].patch.section, 's0', 'sem seção, a primeira');
  assert.equal(r.ops[0].patch.date, '');
  assert.equal(r.result.data, 'backlog');
  assert.throws(() => roda(s, 'tarefa_criar', {texto: 'x', quando: 'hoje', secao: 'Casa'}), /as seções são: Pessoal, Trabalho, Saúde/);
  assert.throws(() => roda(s, 'tarefa_criar', {texto: 'x', quando: 'ontem'}), /quando/);
  assert.throws(() => roda(s, 'tarefa_criar', {texto: 'x', quando: 'hoje', horario: '25:00'}), /HH:MM/);
  assert.throws(() => roda(s, 'tarefa_criar', {texto: '   ', quando: 'hoje'}), /texto/);
});

test('tarefa_concluir: gravada, e a ocorrência de repetição gravada antes, como no app', () => {
  const s = estado();
  let r = roda(s, 'tarefa_concluir', {id: 'a'});
  assert.deepEqual(r.ops, [{collection: 'tasks', id: 'a', patch: {done: true}}]);
  for (const op of r.ops) apply(s, op);
  assert.deepEqual(roda(s, 'tarefa_concluir', {id: 'a'}).ops, [], 'já feita: nada a gravar');
  assert.deepEqual(roda(s, 'tarefa_concluir', {id: 'a', feita: false}).ops[0].patch, {done: false});
  r = roda(s, 'tarefa_concluir', {id: 'r-gym-2026-11-05'});
  assert.equal(r.ops[0].id, 'r-gym-2026-11-05');
  assert.deepEqual(r.ops[0].patch, {text: 'Academia', section: 's2', time: '07:00', end: '08:00', date: '2026-11-05', done: true, repeat: 'gym'});
  assert.throws(() => roda(s, 'tarefa_concluir', {id: 'r-gym-2026-11-04'}), /não encontrada/, 'quarta não tem academia');
  assert.throws(() => roda(s, 'tarefa_concluir', {id: 'zzz'}), /não encontrada/);
});

test('tarefa_mover: ocorrência sai da repetição; tarefa do passado volta a não estar feita', () => {
  const s = estado();
  let r = roda(s, 'tarefa_mover', {id: 'r-gym-2026-11-05', quando: '2026-11-07'});
  assert.equal(r.ops[0].patch.repeat, '');
  assert.equal(r.ops[0].patch.date, '2026-11-07');
  apply(s, {collection: 'tasks', id: 'd', patch: {done: true}});
  r = roda(s, 'tarefa_mover', {id: 'd', quando: 'hoje'});
  assert.deepEqual(r.ops[0].patch, {date: HOJE, done: false});
  assert.deepEqual(roda(s, 'tarefa_mover', {id: 'a', quando: 'hoje'}).ops, [], 'já está lá');
  assert.deepEqual(roda(s, 'tarefa_mover', {id: 'a', quando: 'backlog'}).ops[0].patch, {date: ''});
});

test('contas_mes e contas_proximas', () => {
  const s = estado();
  const mes = roda(s, 'contas_mes').result;
  assert.equal(mes.mes, '2026-11');
  assert.deepEqual(mes.contas.map(c => [c.nome, c.vencimento, c.paga, c.prevista]), [['Gás', 1, true, false], ['Água', 2, false, false], ['Internet', 10, false, false]]);
  assert.equal(mes.contas[2].valor, 'R$ 129,90');
  assert.equal(mes.a_pagar_centavos, 20990);
  const dezembro = roda(s, 'contas_mes', {mes: '2026-12'}).result;
  assert.ok(dezembro.contas.every(c => c.prevista), 'mês futuro: o que a repetição vai criar');
  assert.deepEqual(dezembro.contas.map(c => c.nome).sort(), ['Gás', 'Internet', 'Água'].sort());
  const proximas = roda(s, 'contas_proximas', {dias: 7}).result;
  assert.deepEqual(proximas.contas.map(c => [c.nome, c.vence_em, c.atrasada]), [['Água', '2026-11-02', true], ['Internet', '2026-11-10', false]]);
  assert.throws(() => roda(s, 'contas_proximas', {dias: 90}), /1 a 60/);
  const longe = roda(s, 'contas_proximas', {dias: 40}).result;
  assert.ok(longe.contas.some(c => c.vence_em.startsWith('2026-12') && c.prevista), 'inclui as previstas do mês seguinte');
});

test('ids herdados do protótipo não são tarefas nem seções', () => {
  const s = estado();
  for (const id of ['constructor', 'toString', 'hasOwnProperty', '__proto__', 'prototype', 'valueOf']) {
    assert.throws(() => roda(s, 'tarefa_mover', {id, quando: 'hoje'}), /não/, id);
    assert.throws(() => roda(s, 'tarefa_concluir', {id}), /não/, id);
  }
  assert.equal(Object.hasOwn(s.tasks, 'constructor'), false);
  // Uma tarefa cuja seção tem nome de propriedade herdada aparece, em "Sem seção".
  apply(s, {collection: 'tasks', id: 'f', patch: {text: 'Órfã', section: 'toString', date: HOJE, time: '', done: false, repeat: ''}});
  const grupos = roda(s, 'tarefas_dia').result.secoes;
  assert.deepEqual(grupos.at(-1), {secao: 'Sem seção', tarefas: [{id: 'f', texto: 'Órfã', secao: 'Sem seção', feita: false, horario: null, repete: false}]});
});

test('toda operação das ferramentas passa no validate do servidor', () => {
  const s = estado();
  const escritas = [
    roda(s, 'tarefa_criar', {texto: 'Com hora', quando: 'amanha', secao: 'Saúde', horario: '10:30'}),
    roda(s, 'tarefa_criar', {texto: 'No backlog', quando: 'backlog', chave: 'pedido-1'}),
    roda(s, 'tarefa_concluir', {id: 'a'}),
    roda(s, 'tarefa_concluir', {id: 'r-gym-2026-11-05'}),
    roda(s, 'tarefa_mover', {id: 'r-gym-2026-11-06', quando: '2026-11-09'}),
    roda(s, 'tarefa_mover', {id: 'd', quando: 'hoje'}),
  ];
  const ops = escritas.flatMap(r => r.ops).map((op, i) => JSON.parse(JSON.stringify({opId: `mcp-${i}`, ...op})));
  assert.equal(ops.length, 6);
  for (const op of ops) assert.ok(validate(op), JSON.stringify(op));
  assert.equal(validate({opId: 'x', collection: 'tasks', id: 'constructor', patch: {date: HOJE}}), false, 'id reservado: recusado');
});

test('tarefa_mover: ocorrência projetada movida para o próprio dia continua na repetição', () => {
  const s = estado();
  assert.deepEqual(roda(s, 'tarefa_mover', {id: 'r-gym-2026-11-06', quando: '2026-11-06'}), {result: {id: 'r-gym-2026-11-06', texto: 'Academia', data: '2026-11-06'}, ops: []});
  assert.equal(roda(s, 'tarefa_mover', {id: 'r-gym-2026-11-06', quando: '2026-11-07'}).ops[0].patch.repeat, '', 'para outro dia, sai');
});

test('tarefa_criar: horário não vale no backlog', () => {
  const s = estado();
  assert.throws(() => roda(s, 'tarefa_criar', {texto: 'Ligar pro banco', quando: 'backlog', horario: '10:00'}), /backlog não tem horário/);
  assert.equal(roda(s, 'tarefa_criar', {texto: 'Ligar pro banco', quando: 'backlog', horario: ''}).ops[0].patch.time, '');
});

test('tarefa_criar: a mesma chave do mesmo agente não duplica', () => {
  const s = estado();
  const primeira = roda(s, 'tarefa_criar', {texto: 'Pagar IPVA', quando: 'amanha', chave: 'msg-42'});
  assert.equal(primeira.ops.length, 1);
  for (const op of primeira.ops) apply(s, op);
  const de_novo = roda(s, 'tarefa_criar', {texto: 'Pagar IPVA', quando: 'amanha', chave: 'msg-42'});
  assert.deepEqual(de_novo.ops, [], 'nada a gravar');
  assert.deepEqual(de_novo.result, {...primeira.result, repetida: true});
  // Outro agente com a mesma chave cria a sua; sem chave, cada chamada cria uma.
  const outro = roda(s, 'tarefa_criar', {texto: 'Pagar IPVA', quando: 'amanha', chave: 'msg-42'}, HOJE, 'lia');
  assert.notEqual(outro.result.id, primeira.result.id);
  assert.notEqual(roda(s, 'tarefa_criar', {texto: 'x', quando: 'hoje'}).result.id, roda(s, 'tarefa_criar', {texto: 'x', quando: 'hoje'}).result.id);
  // A chave reaproveitada para outra tarefa é um erro, não a tarefa antiga.
  assert.throws(() => roda(s, 'tarefa_criar', {texto: 'Outra coisa', quando: 'hoje', chave: 'msg-42'}), /já criou outra tarefa/);
  // Apagada no app depois: a repetição diz isso em vez de criar de novo (o registro apagado não volta).
  apply(s, {collection: 'tasks', id: primeira.result.id, patch: {deleted: true}});
  const apagada = roda(s, 'tarefa_criar', {texto: 'Pagar IPVA', quando: 'amanha', chave: 'msg-42'});
  assert.deepEqual([apagada.ops, apagada.result.repetida, apagada.result.apagada], [[], true, true]);
  assert.throws(() => roda(s, 'tarefa_criar', {texto: 'y', quando: 'hoje', chave: '  '}), /chave/);
});

test('contas_mes: prevista é só a projeção; conta já gravada num mês futuro não é', () => {
  const s = estado();
  apply(s, {collection: 'bills', id: 'iptu-2026-12', patch: {text: 'IPTU', amount: 30000, due: 15, month: '2026-12', done: false, repeat: false}});
  const dezembro = roda(s, 'contas_mes', {mes: '2026-12'}).result.contas;
  assert.deepEqual(dezembro.map(c => [c.nome, c.prevista]).sort(), [['Gás', true], ['IPTU', false], ['Internet', true], ['Água', true]].sort());
});

test('contas_proximas: dia limitado ao fim do mês; sem dia nunca sai atrasada', () => {
  const s = estado();
  apply(s, {collection: 'bills', id: 'aluguel-2026-11', patch: {text: 'Aluguel', amount: 200000, due: 31, month: '2026-11', done: false, repeat: true}});
  const novembro = roda(s, 'contas_proximas', {dias: 30}).result.contas;
  assert.equal(novembro.find(c => c.id === 'aluguel-2026-11').vence_em, '2026-11-30', '31 em novembro é o dia 30');
  // Em fevereiro de 2027: o 31 vira 28, a conta sem dia vence no dia 28, e a de janeiro sem dia não sai atrasada.
  const t = initialState();
  apply(t, {collection: 'bills', id: 'aluguel-2027-02', patch: {text: 'Aluguel', amount: 1, due: 31, month: '2027-02', done: false, repeat: false}});
  apply(t, {collection: 'bills', id: 'feira-2027-02', patch: {text: 'Feira', amount: 1, due: 0, month: '2027-02', done: false, repeat: false}});
  apply(t, {collection: 'bills', id: 'avulsa-2027-01', patch: {text: 'Avulsa', amount: 1, due: 0, month: '2027-01', done: false, repeat: false}});
  apply(t, {collection: 'bills', id: 'luz-2027-01', patch: {text: 'Luz', amount: 1, due: 20, month: '2027-01', done: false, repeat: false}});
  const fevereiro = roda(t, 'contas_proximas', {dias: 30}, '2027-02-10').result.contas;
  assert.deepEqual(fevereiro.map(c => [c.nome, c.vence_em, c.atrasada]), [
    ['Luz', '2027-01-20', true],
    ['Avulsa', '2027-01-31', false],
    ['Aluguel', '2027-02-28', false],
    ['Feira', '2027-02-28', false],
  ]);
});

test('contas_mes recusa mês que não existe; mover para o backlog leva o horário junto', () => {
  const s = estado();
  assert.throws(() => roda(s, 'contas_mes', {mes: '2026-13'}), /AAAA-MM/);
  assert.throws(() => roda(s, 'contas_mes', {mes: '2026-00'}), /AAAA-MM/);
  assert.deepEqual(roda(s, 'tarefa_mover', {id: 'b', quando: 'backlog'}).ops[0].patch, {date: '', time: '', end: ''});
});

test('data com mês 00 ou 13 é recusada com a mensagem certa', () => {
  const s = estado();
  assert.throws(() => roda(s, 'tarefas_dia', {data: '2026-13-01'}), /AAAA-MM-DD|data/);
  assert.throws(() => roda(s, 'tarefa_criar', {texto: 'x', quando: '2026-00-10'}), /AAAA-MM-DD|data|quando/);
});

test('tarefa_criar: reunião com fim e repetição semanal, como o app grava', () => {
  const s = estado();
  // Quarta, 4/11: repete às segundas e quartas, e a de hoje já sai gravada.
  const r = roda(s, 'tarefa_criar', {texto: 'DS Check-In', quando: 'hoje', secao: 'trabalho', horario: '09:30', fim: '10:00', reuniao: true, repetir: {regra: 'semanal', dias: ['seg', 'quarta']}});
  const rid = r.ops[0].id;
  assert.deepEqual(r.ops, [
    {collection: 'repeats', id: rid, patch: {text: 'DS Check-In', section: 's1', time: '09:30', end: '10:00', meeting: true, days: '13', monthDay: 0, weeks: 1, start: HOJE}},
    {collection: 'tasks', id: `r-${rid}-${HOJE}`, patch: {text: 'DS Check-In', section: 's1', time: '09:30', end: '10:00', meeting: true, repeat: rid, date: HOJE, done: false}},
  ]);
  assert.deepEqual(r.result, {id: `r-${rid}-${HOJE}`, texto: 'DS Check-In', secao: 'Trabalho', data: HOJE, horario: '09:30', reuniao: true, fim: '10:00', repete: 'toda semana (seg, qua)', repeticao: rid});
  for (const op of r.ops) apply(s, op);
  const segunda = roda(s, 'tarefas_dia', {data: '2026-11-09'}).result.secoes[0].tarefas;
  assert.deepEqual(segunda, [{id: `r-${rid}-2026-11-09`, texto: 'DS Check-In', secao: 'Trabalho', feita: false, horario: '09:30', reuniao: true, fim: '10:00', repete: true}]);
  assert.equal(roda(s, 'tarefas_dia', {data: '2026-11-10'}).result.secoes.some(g => g.tarefas.some(t => t.texto === 'DS Check-In')), false, 'terça não');
});

test('tarefa_criar: quinzenal conta da primeira ocorrência; mensal no dia; erros', () => {
  const s = estado();
  // De quinta, 5/11, a cada 2 semanas às quartas: a primeira é 11/11, e a seguinte 25/11.
  const q = roda(s, 'tarefa_criar', {texto: '1:1 Felix', quando: '2026-11-05', horario: '10:00', reuniao: true, repetir: {regra: 'quinzenal', dias: ['qua']}});
  assert.equal(q.ops.length, 1, 'quinta não é dia dela: só a repetição');
  assert.deepEqual([q.ops[0].patch.days, q.ops[0].patch.weeks, q.ops[0].patch.start], ['3', 2, '2026-11-11']);
  assert.equal(q.result.data, '2026-11-11');
  for (const op of q.ops) apply(s, op);
  const tem = d => roda(s, 'tarefas_dia', {data: d}).result.secoes.some(g => g.tarefas.some(t => t.texto === '1:1 Felix'));
  assert.deepEqual(['2026-11-11', '2026-11-18', '2026-11-25'].map(tem), [true, false, true]);
  const m = roda(s, 'tarefa_criar', {texto: 'Aluguel', quando: '2026-11-10', repetir: {regra: 'mensal'}});
  assert.deepEqual([m.ops[0].patch.monthDay, m.ops[0].patch.days, m.result.repete], [10, '', 'todo mês, dia 10']);
  // Sem dias, o dia da semana da data.
  assert.equal(roda(s, 'tarefa_criar', {texto: 'x', quando: '2026-11-06', repetir: {regra: 'semanal'}}).ops[0].patch.days, '5');
  assert.throws(() => roda(s, 'tarefa_criar', {texto: 'x', quando: 'backlog', repetir: {regra: 'diaria'}}), /precisam de um dia/);
  assert.throws(() => roda(s, 'tarefa_criar', {texto: 'x', quando: 'backlog', reuniao: true}), /precisam de um dia/);
  assert.throws(() => roda(s, 'tarefa_criar', {texto: 'x', quando: '2026-11-01', repetir: {regra: 'diaria'}}), /hoje ou depois/);
  assert.throws(() => roda(s, 'tarefa_criar', {texto: 'x', quando: 'hoje', repetir: {regra: 'anual'}}), /regra/);
  assert.throws(() => roda(s, 'tarefa_criar', {texto: 'x', quando: 'hoje', repetir: {regra: 'semanal', dias: ['xyz']}}), /dia da semana/);
  assert.throws(() => roda(s, 'tarefa_criar', {texto: 'x', quando: 'hoje', horario: '10:00', fim: '09:00'}), /depois do horario/);
  assert.throws(() => roda(s, 'tarefa_criar', {texto: 'x', quando: 'hoje', fim: '09:00'}), /só vale com horario/);
  // Repetição com chave: a mesma chave não cria outra.
  const k = roda(s, 'tarefa_criar', {texto: 'Daily', quando: 'hoje', repetir: {regra: 'dias_uteis'}, chave: 'daily-1'});
  for (const op of k.ops) apply(s, op);
  const de_novo = roda(s, 'tarefa_criar', {texto: 'Daily', quando: 'hoje', repetir: {regra: 'dias_uteis'}, chave: 'daily-1'});
  assert.deepEqual([de_novo.ops, de_novo.result.repetida, de_novo.result.id], [[], true, k.result.id]);
});

test('tarefa_editar: vira reunião que repete; numa data futura, a tarefa vira a ocorrência, com os passos', () => {
  const s = estado();
  // Dentista, 10/11 às 14:00, com um passo.
  apply(s, {collection: 'steps', id: 'p1', patch: {task: 'e', text: 'Levar exame', done: false, order: 0}});
  const r = roda(s, 'tarefa_editar', {id: 'e', reuniao: true, fim: '15:00', repetir: {regra: 'quinzenal'}});
  const rid = r.ops[0].id, occ = `r-${rid}-2026-11-10`;
  assert.deepEqual(r.ops, [
    {collection: 'repeats', id: rid, patch: {text: 'Dentista', section: 's2', time: '14:00', end: '15:00', meeting: true, days: '2', monthDay: 0, weeks: 2, start: '2026-11-10'}},
    {collection: 'tasks', id: 'e', patch: {deleted: true}},
    {collection: 'tasks', id: occ, patch: {text: 'Dentista', section: 's2', time: '14:00', end: '15:00', meeting: true, repeat: rid, date: '2026-11-10', done: false}},
    {collection: 'steps', id: 'p1', patch: {task: occ}},
  ]);
  assert.equal(r.result.id, occ);
  assert.equal(r.result.repete, 'a cada 2 semanas (ter)');
  for (const op of r.ops) apply(s, op);
  const dia = roda(s, 'tarefas_dia', {data: '2026-11-10'}).result.secoes.flatMap(g => g.tarefas).filter(t => t.texto === 'Dentista');
  assert.equal(dia.length, 1, 'uma só, sem a cópia da repetição');
  assert.deepEqual(dia[0].passos, [{texto: 'Levar exame', feito: false}]);
  // Para de repetir: a ocorrência fica como tarefa avulsa.
  const p = roda(s, 'tarefa_editar', {id: occ, repetir: {regra: 'nao'}});
  assert.deepEqual(p.ops, [{collection: 'repeats', id: rid, patch: {deleted: true}}, {collection: 'tasks', id: occ, patch: {text: 'Dentista', section: 's2', time: '14:00', end: '15:00', meeting: true, repeat: ''}}]);
});

test('tarefa_editar: hoje fica com o mesmo id; ocorrência edita a repetição; horário novo mantém a duração', () => {
  const s = estado();
  // Hoje (dia já aberto): a tarefa fica com o id dela, agora na repetição.
  const r = roda(s, 'tarefa_editar', {id: 'b', texto: 'Daily', repetir: {regra: 'dias_uteis'}});
  assert.deepEqual(r.ops.map(o => [o.collection, o.id === 'b' ? 'b' : 'nova']), [['repeats', 'nova'], ['tasks', 'b']]);
  assert.equal(r.ops[1].patch.repeat, r.ops[0].id);
  // Ocorrência ainda não gravada (academia, sexta): grava a tarefa inteira e muda a repetição.
  const g = roda(s, 'tarefa_editar', {id: 'r-gym-2026-11-06', horario: '06:30'});
  assert.deepEqual(g.ops, [
    {collection: 'repeats', id: 'gym', patch: {text: 'Academia', section: 's2', time: '06:30', end: '07:30', meeting: false}},
    {collection: 'tasks', id: 'r-gym-2026-11-06', patch: {text: 'Academia', section: 's2', time: '06:30', end: '07:30', date: '2026-11-06', done: false, repeat: 'gym', meeting: false}},
  ]);
  // Troca de regra mantém o início da série.
  assert.deepEqual(roda(s, 'tarefa_editar', {id: 'r-gym-2026-11-06', repetir: {regra: 'semanal', dias: ['seg']}}).ops[0].patch.days, '1');
  // Tirar o horário tira o fim.
  assert.deepEqual(roda(s, 'tarefa_editar', {id: 'b', horario: ''}).ops[0].patch, {text: 'Reunião', section: 's1', time: '', end: '', meeting: false});
  assert.throws(() => roda(s, 'tarefa_editar', {id: 'c', reuniao: true}), /backlog/);
  assert.throws(() => roda(s, 'tarefa_editar', {id: 'd', repetir: {regra: 'diaria'}}), /dia passado/);
  assert.throws(() => roda(s, 'tarefa_editar', {id: 'zzz', texto: 'x'}), /não encontrada/);
});

test('reunião e repetição pelo MCP passam no validate do servidor', () => {
  const s = estado();
  apply(s, {collection: 'steps', id: 'p1', patch: {task: 'e', text: 'Levar exame', done: false, order: 0}});
  const ops = [
    roda(s, 'tarefa_criar', {texto: 'Check-in', quando: 'hoje', horario: '09:30', reuniao: true, repetir: {regra: 'semanal', dias: ['seg', 'qua']}}),
    roda(s, 'tarefa_criar', {texto: 'Aluguel', quando: 'amanha', repetir: {regra: 'mensal', dia_do_mes: 31}}),
    roda(s, 'tarefa_editar', {id: 'e', reuniao: true, repetir: {regra: 'semanal'}}),
    roda(s, 'tarefa_editar', {id: 'r-gym-2026-11-06', repetir: {regra: 'nao'}}),
  ].flatMap(r => r.ops).map((op, i) => JSON.parse(JSON.stringify({opId: `mcp-${i}`, ...op})));
  for (const op of ops) assert.ok(validate(op), JSON.stringify(op));
});
