import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {parseChore, nextCycleDate, choresForToday, liveChores} from '../public/model.js';
import {validate} from '../validacao.mjs';

async function launch(dir, env) {
  const child = spawn(process.execPath, ['server.mjs'], {env: {...process.env, PORT: '0', DATA_DIR: dir, APP_PASSWORD: '', APP_USERS: '', ...env}, stdio: ['ignore', 'pipe', 'pipe']});
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('startup timeout')), 5000);
    child.stdout.on('data', b => { const m = b.toString().match(/http:\/\/[^\s]+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
    child.once('exit', code => reject(Error(`exit ${code}`)));
  });
  return {child, url};
}
const stop = child => new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });

test('Casa: listas, afazeres e notas compartilhados; o servidor diz quem criou e quem fez', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notas-casa-'));
  let proc;
  try {
    proc = await launch(dir, {APP_USERS: 'ana:Ana:a,bia:Bia:b'});
    const {url} = proc;
    const login = async (user, password) => (await fetch(url + '/api/login', {method: 'POST', body: JSON.stringify({user, password})})).headers.get('set-cookie').split(';')[0];
    const ana = await login('ana', 'a'), bia = await login('bia', 'b');
    const as = cookie => ({'Content-Type': 'application/json', cookie});
    const get = async cookie => (await fetch(url + '/api/state', {headers: as(cookie)})).json();
    let n = 0;
    const send = (cookie, ops) => fetch(url + '/api/operations', {method: 'POST', headers: as(cookie), body: JSON.stringify(ops.map(([collection, id, patch]) => ({opId: `op${n++}`, collection, id, patch})))});

    assert.equal((await get(ana)).lists.afazeres.name, 'Afazeres', 'a Casa começa com a lista Afazeres');

    // Ana pede à Bia, tentando se passar por ela: o servidor grava que foi ele.
    assert.equal((await send(ana, [['chores', 'c1', {text: 'Marcar vacina', list: 'afazeres', who: 'bia', date: '2026-11-19', cycle: '', done: false, by: 'bia', doneBy: 'bia', added: Date.now()}]])).status, 200);
    let seen = await get(bia);
    assert.equal(seen.chores.c1.by, 'ana');
    assert.equal(seen.chores.c1.doneBy, '', 'o doneBy enviado pelo app é ignorado');
    assert.equal(seen.chores.c1.who, 'bia');

    // Bia conclui: quem fez e quando vêm do servidor; desmarcar apaga os dois.
    assert.equal((await send(bia, [['chores', 'c1', {done: true, doneBy: 'ana', doneAt: 1}]])).status, 200);
    seen = await get(ana);
    assert.equal(seen.chores.c1.doneBy, 'bia');
    assert.ok(seen.chores.c1.doneAt > Date.now() - 60000);
    assert.equal(seen.chores.c1.by, 'ana', 'editar não troca quem criou');
    await send(bia, [['chores', 'c1', {done: false}]]);
    seen = await get(ana);
    assert.equal(seen.chores.c1.doneBy, '');
    assert.equal(seen.chores.c1.doneAt, 0);

    // Nova lista e nota fixa, vistas pelos dois; a nota guarda quem editou por último.
    await send(bia, [['lists', 'viagem', {name: 'Floripa', order: 1}], ['notes', 'wifi', {title: 'Wi-Fi', body: 'senha 123', order: 0, added: Date.now()}]]);
    await send(ana, [['notes', 'wifi', {body: 'senha 456'}]]);
    seen = await get(bia);
    assert.equal(seen.lists.viagem.name, 'Floripa');
    assert.equal(seen.notes.wifi.by, 'bia');
    assert.equal(seen.notes.wifi.editedBy, 'ana');
    assert.equal(seen.notes.wifi.body, 'senha 456');

    // Casa e coisas pessoais não se misturam numa mesma remessa.
    assert.equal((await send(ana, [['chores', 'c2', {text: 'x', list: 'afazeres'}], ['tasks', 't1', {text: 'y', date: ''}]])).status, 400);
    // A preferência de quando viu a Casa é de cada um.
    await send(ana, [['prefs', 'casa', {seen: 5}]]);
    assert.equal((await get(ana)).prefs.casa.seen, 5);
    assert.equal((await get(bia)).prefs.casa, undefined);
  } finally {
    if (proc) await stop(proc.child);
    await rm(dir, {recursive: true, force: true});
  }
});

test('Casa: validação dos campos', () => {
  const op = (collection, patch) => ({opId: 'x', collection, id: 'a', patch});
  assert.ok(validate(op('chores', {text: 'a', list: 'afazeres', who: '', date: '', cycle: 'm3'})));
  assert.ok(!validate(op('chores', {cycle: 'm2'})));
  assert.ok(!validate(op('chores', {who: 'Bia!'})));
  assert.ok(!validate(op('chores', {list: ''})));
  assert.ok(!validate(op('chores', {list: '__proto__'})));
  assert.ok(!validate(op('chores', {date: '2026-02-30'})));
  assert.ok(validate(op('notes', {title: 'Wi-Fi', body: 'x'})));
  assert.ok(validate(op('lists', {name: 'Viagem', order: 2})));
});

test('Casa: digitar "@bia qui" define quem faz e o dia', () => {
  const people = [{id: 'ana', name: 'Ana'}, {id: 'bia', name: 'Bia'}];
  const parse = s => parseChore(s, people, 'ana', '2026-11-15'); // domingo
  assert.deepEqual(parse('Marcar vacina do Rex @bia qui'), {text: 'Marcar vacina do Rex', who: 'bia', date: '2026-11-19'});
  assert.deepEqual(parse('Trocar lâmpada sáb @eu'), {text: 'Trocar lâmpada', who: 'ana', date: '2026-11-21'});
  assert.deepEqual(parse('Pendurar quadro @nós'), {text: 'Pendurar quadro', who: ''});
  assert.deepEqual(parse('Ceia 24/12'), {text: 'Ceia', date: '2026-12-24'});
  assert.deepEqual(parse('Renovar seguro 10/01'), {text: 'Renovar seguro', date: '2027-01-10'}, 'data que já passou vai para o ano seguinte');
  assert.deepEqual(parse('Ligar amanhã'), {text: 'Ligar', date: '2026-11-16'});
  assert.deepEqual(parse('dom'), {text: '', date: '2026-11-22'}, 'o mesmo dia da semana é a semana que vem');
  assert.deepEqual(parse('Ter que ligar pro banco'), {text: 'Ter que ligar pro banco'}, 'só a última palavra vira dia');
  assert.deepEqual(parse('Falar com @fulano'), {text: 'Falar com @fulano'}, 'quem não existe fica no texto');
});

test('Casa: repetição e o que aparece no Hoje', () => {
  assert.equal(nextCycleDate('2026-01-31', 'm1', '2026-01-31'), '2026-02-28');
  assert.equal(nextCycleDate('2026-11-01', 'w1', '2026-11-15'), '2026-11-22', 'feita com atraso não volta já atrasada');
  assert.equal(nextCycleDate('2026-08-11', 'm3', '2026-11-15'), '2027-02-11');
  assert.equal(nextCycleDate('2026-11-15', '', '2026-11-15'), '');
  const state = {lists: {l: {id: 'l', name: 'Afazeres'}, gone: {id: 'gone', name: 'Velha', deleted: true}}, chores: {
    a: {id: 'a', text: 'Minha hoje', list: 'l', who: 'ana', date: '2026-11-15'},
    b: {id: 'b', text: 'Dela hoje', list: 'l', who: 'bia', date: '2026-11-15'},
    c: {id: 'c', text: 'De qualquer um, atrasada', list: 'l', who: '', date: '2026-11-10'},
    d: {id: 'd', text: 'Sem dia', list: 'l', who: 'ana', date: ''},
    e: {id: 'e', text: 'Amanhã', list: 'l', who: 'ana', date: '2026-11-16'},
    f: {id: 'f', text: 'Feita hoje', list: 'l', who: 'ana', date: '2026-11-14', done: true},
    g: {id: 'g', text: 'Lista excluída', list: 'gone', who: 'ana', date: '2026-11-15'},
  }};
  const ids = choresForToday(state, 'ana', '2026-11-15', c => c.id === 'f').map(c => c.id).sort();
  assert.deepEqual(ids, ['a', 'c', 'f']);
  assert.equal(liveChores(state).length, 6, 'itens de lista excluída somem');
});
