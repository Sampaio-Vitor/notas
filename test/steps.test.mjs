import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState, apply, carryOps, lastPending, taskSteps, taskDoneOps, stepToggleOps} from '../public/model.js';
import {validate} from '../validacao.mjs';
import {spaceTool} from '../mcp-espaco.mjs';

const run = (s, ops) => ops.forEach(op => apply(s, op));
function estado() {
  const s = initialState();
  run(s, [
    {collection: 'tasks', id: 't', patch: {text: 'Revisar relatório', section: 's0', date: '2026-11-23', time: '', done: false, repeat: ''}},
    {collection: 'steps', id: 'p2', patch: {task: 't', text: 'Conferir números', done: false, order: 1}},
    {collection: 'steps', id: 'p1', patch: {task: 't', text: 'Ler seção 3', done: true, order: 0}},
    {collection: 'steps', id: 'p3', patch: {task: 't', text: 'Mandar para revisão', done: false, order: 2}},
    {collection: 'steps', id: 'px', patch: {task: 't', text: 'Apagado', done: false, order: 3, deleted: true}},
  ]);
  return s;
}

test('passos: na ordem, sem os apagados', () => {
  assert.deepEqual(taskSteps(estado(), estado().tasks.t).map(s => s.id), ['p1', 'p2', 'p3']);
});

test('passos: o último marcado conclui a tarefa; desmarcar um a reabre', () => {
  const s = estado();
  assert.deepEqual(stepToggleOps(s, s.tasks.t, 'p2'), [{collection: 'steps', id: 'p2', patch: {done: true}}]);
  run(s, stepToggleOps(s, s.tasks.t, 'p2'));
  run(s, stepToggleOps(s, s.tasks.t, 'p3'));
  assert.equal(s.tasks.t.done, true);
  run(s, stepToggleOps(s, s.tasks.t, 'p1'));
  assert.equal(s.tasks.t.done, false);
  assert.equal(s.steps.p1.done, false);
  assert.deepEqual(stepToggleOps(s, s.tasks.t, 'nao-existe'), []);
});

test('passos: concluir a tarefa marca os que faltavam; reabrir não mexe neles', () => {
  const s = estado();
  const ops = taskDoneOps(s, s.tasks.t, true);
  assert.deepEqual(ops.map(op => op.id), ['t', 'p2', 'p3']);
  run(s, ops);
  assert.ok(taskSteps(s, s.tasks.t).every(p => p.done));
  assert.deepEqual(taskDoneOps(s, s.tasks.t, false), [{collection: 'tasks', id: 't', patch: {done: false}}]);
});

test('passos: tarefa incompleta vai inteira para o dia seguinte, com o que já foi marcado', () => {
  const s = estado();
  const pending = lastPending(s, '2026-11-24');
  assert.deepEqual(pending.tasks.map(t => t.id), ['t']);
  run(s, carryOps(pending.tasks, '2026-11-24'));
  const copy = s.tasks['c-t-2026-11-24'];
  assert.deepEqual(taskSteps(s, copy).map(p => [p.id, p.done]), [['p1', true], ['p2', false], ['p3', false]]);
  // Carried again, still the same steps.
  run(s, carryOps([copy], '2026-11-25'));
  assert.equal(taskSteps(s, s.tasks['c-t-2026-11-25']).length, 3);
});

test('passos: validação', () => {
  const op = patch => ({opId: 'x', collection: 'steps', id: 'p', patch});
  assert.ok(validate(op({task: 't', text: 'a', done: false, order: 0})));
  assert.ok(validate(op({deleted: true})));
  assert.ok(!validate(op({order: 1.5})));
  assert.ok(!validate(op({done: 'sim'})));
  assert.ok(!validate(op({cor: 'azul'})));
});

test('passos no MCP: aparecem na tarefa e concluir marca os que faltavam', () => {
  const s = estado();
  const dia = spaceTool(s, 'tarefas_dia', {data: '2026-11-23'}, '2026-11-23', () => 'n').result;
  assert.deepEqual(dia.secoes[0].tarefas[0].passos, [{texto: 'Ler seção 3', feito: true}, {texto: 'Conferir números', feito: false}, {texto: 'Mandar para revisão', feito: false}]);
  const r = spaceTool(s, 'tarefa_concluir', {id: 't'}, '2026-11-23', () => 'n');
  assert.deepEqual(r.ops.map(op => `${op.collection}:${op.id}`), ['tasks:t', 'steps:p2', 'steps:p3']);
  apply(s, {collection: 'tasks', id: 'u', patch: {text: 'Sem passos', section: 's0', date: '2026-11-23', time: '', done: false, repeat: ''}});
  const semPassos = spaceTool(s, 'tarefas_dia', {data: '2026-11-23'}, '2026-11-23', () => 'n').result.secoes[0].tarefas.find(t => t.id === 'u');
  assert.ok(!('passos' in semPassos));
});
