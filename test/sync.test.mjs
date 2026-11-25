import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';
import {initialState, normalize, apply} from '../public/model.js';

// The app's real api() and sync(), run against a fake server.
const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const syncCode = source.slice(source.indexOf('async function api('), source.indexOf('// ---------- Helpers over state ----------'));

function device(answer) {
  const posted = [], reports = [], toasts = [];
  const fetch = async (url, options = {}) => {
    if (url === '/api/session') return Response.json({protected: false, me: {id: 'ana'}, users: []});
    if (url === '/api/state') return Response.json({tasks: {}});
    const body = JSON.parse(options.body);
    posted.push(body.opId);
    return answer(body);
  };
  const context = vm.createContext({
    fetch, AbortSignal, Response, console: {warn() {}}, navigator: {onLine: true}, EventSource: class {},
    initialState, normalize, apply,
    report: m => reports.push(m), toast: m => toasts.push(m), closeSheet() {}, render() {}, save() {}, reload() {}, loadPasskeys() {}, refreshPush() {},
    exclusive: fn => Promise.resolve().then(fn),
  });
  vm.runInContext(`let state = initialState(), queue = [], busy = false, events = null, online = true, syncError = '', needsLogin = false, protectedServer = false, me = null, people = [], owner = null, sessionLoaded = false; ${syncCode}`, context);
  const run = expression => vm.runInContext(expression, context);
  run(`queue = [
    {opId: 'recusada', batchId: 'b1', collection: 'tasks', id: 'constructor', patch: {date: '2026-11-05'}},
    {opId: 'depois', batchId: 'b2', collection: 'tasks', id: 'ok', patch: {text: 'Fica', date: ''}},
  ]`);
  return {run, posted, reports, toasts};
}

test('sync: alteração que o servidor nunca vai aceitar sai da fila, com registro, e a fila segue', async () => {
  const d = device(op => op.opId === 'recusada' ? Response.json({error: 'Alteração inválida', invalid: true}, {status: 400}) : Response.json({ok: true}));
  await d.run('sync()');
  assert.deepEqual(d.posted, ['recusada', 'depois']);
  assert.equal(d.run('queue.length'), 0, 'a fila não trava');
  assert.equal(d.run('online'), true);
  assert.equal(d.reports.length, 1);
  assert.match(d.reports[0], /recusada pelo servidor e descartada.*constructor/);
  assert.match(d.toasts[0], /descartada/);
});

test('sync: outras falhas mantêm a alteração na fila para a próxima tentativa', async () => {
  for (const response of [() => Response.json({error: 'Não foi possível processar a solicitação'}, {status: 400}), () => Response.json({error: 'x'}, {status: 500})]) {
    const d = device(response);
    await d.run('sync()');
    assert.deepEqual(d.posted, ['recusada'], 'para na primeira');
    assert.equal(d.run('queue.length'), 2, 'nada descartado');
    assert.equal(d.run('online'), false);
    assert.deepEqual(d.reports, []);
  }
});

test('sync: as alterações seguintes no mesmo registro de um lote recusado também saem (sem registro pela metade)', async () => {
  const d = device(op => op.opId === 'cria' ? Response.json({error: 'Alteração inválida', invalid: true}, {status: 400}) : Response.json({ok: true}));
  d.run(`queue = [
    {opId: 'cria', batchId: 'b1', collection: 'tasks', id: 't9', patch: {text: 'x'.repeat(10), date: '2026-13-01'}},
    {opId: 'feita', batchId: 'b2', collection: 'tasks', id: 't9', patch: {done: true}},
    {opId: 'outra', batchId: 'b3', collection: 'tasks', id: 'ok', patch: {text: 'Fica', date: ''}},
  ]`);
  await d.run('sync()');
  assert.deepEqual(d.posted, ['cria', 'outra'], 'o done sobre t9 não foi');
  assert.match(d.reports[0], /feita/);
});
