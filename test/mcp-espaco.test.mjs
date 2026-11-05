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
  assert.deepEqual(SPACE_TOOLS.map(t => t.name), ['tarefas_dia', 'tarefas_backlog', 'tarefa_criar', 'tarefa_concluir', 'tarefa_mover', 'contas_mes', 'contas_proximas']);
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
  assert.deepEqual(quinta.secoes, [{secao: 'Saúde', tarefas: [{id: 'r-gym-2026-11-05', texto: 'Academia', secao: 'Saúde', feita: false, horario: '07:00', repete: true}]}]);
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
  assert.deepEqual(r.result, {id: r.ops[0].id, texto: 'Marcar exame', secao: 'Saúde', data: '2026-11-05', horario: '10:30'});
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
