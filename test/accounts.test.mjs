import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';

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

test('duas pessoas: dados separados, compras compartilhadas, avisos em tempo real', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notas-contas-'));
  // Banco da versão sem contas: uma linha de estado e uma sessão no formato antigo.
  const legacy = new DatabaseSync(join(dir, 'notas.sqlite'));
  legacy.exec("CREATE TABLE state (id INTEGER PRIMARY KEY, value TEXT); INSERT INTO state VALUES (1, '{\"tasks\":{\"antiga\":{\"id\":\"antiga\",\"text\":\"Tarefa antiga\",\"date\":\"\"}}}')");
  legacy.close();
  let proc;
  try {
    proc = await launch(dir, {APP_USERS: 'ana:Ana:senha-do-ana,bia:Bia:senha-da-bia'});
    const {url} = proc;
    const login = async (user, password) => {
      const r = await fetch(url + '/api/login', {method: 'POST', body: JSON.stringify({user, password})});
      return r.status === 200 ? r.headers.get('set-cookie').split(';')[0] : r.status;
    };
    const ana = await login('ana', 'senha-do-ana'), bia = await login('bia', 'senha-da-bia');
    assert.equal(await login('bia', 'senha-do-ana'), 401, 'a senha vale só para a pessoa escolhida');
    assert.equal(await login('', 'senha-do-ana'), 400, 'com duas pessoas é preciso escolher');
    assert.deepEqual((await (await fetch(url + '/api/login-methods')).json()).users.map(u => u.name), ['Ana', 'Bia']);
    const as = cookie => ({'Content-Type': 'application/json', cookie});
    const get = async (cookie, path) => (await fetch(url + path, {headers: as(cookie)})).json();
    let n = 0;
    const post = (cookie, collection, id, patch) => fetch(url + '/api/operations', {method: 'POST', headers: as(cookie), body: JSON.stringify({opId: `op${n++}`, collection, id, patch})});

    assert.deepEqual((await get(bia, '/api/session')).me, {id: 'bia', name: 'Bia', color: '#ff6482'});
    assert.equal((await get(ana, '/api/session')).users.length, 2);
    assert.equal((await get(ana, '/api/state')).tasks.antiga.text, 'Tarefa antiga', 'dados antigos ficam com a primeira pessoa');
    assert.equal((await get(bia, '/api/state')).tasks.antiga, undefined);

    // Bia escuta os avisos; uma tarefa da Ana não a acorda, um item de compra sim.
    const controller = new AbortController();
    const stream = (await fetch(url + '/api/events', {headers: as(bia), signal: controller.signal})).body.getReader();
    assert.match(new TextDecoder().decode((await stream.read()).value), /connected/);
    assert.equal((await post(ana, 'tasks', 'v1', {text: 'Só da Ana', date: '', done: false})).status, 200);
    assert.equal((await post(ana, 'shopping', 'i-leite', {text: 'Leite', done: false, listed: true, added: 1, by: 'bia'})).status, 200);
    assert.match(new TextDecoder().decode((await stream.read()).value), /changed/);
    controller.abort();

    const seen = await get(bia, '/api/state');
    assert.equal(seen.tasks.v1, undefined);
    assert.equal(seen.shopping['i-leite'].by, 'ana', 'o servidor define quem adicionou');
    assert.equal((await post(bia, 'shopping', 'i-leite', {done: true})).status, 200);
    assert.equal((await get(ana, '/api/state')).shopping['i-leite'].done, true);

    // Exportação traz só os dados de quem pediu (mais as compras).
    const backup = await get(bia, '/api/export');
    assert.equal(backup.user, 'bia');
    assert.ok(backup.operations.every(o => { const v = JSON.parse(o.value); return v.user === 'bia' || v.space === 'casa'; }));
    assert.equal((await get(bia, '/api/passkeys')).length, 0);
  } finally {
    if (proc?.child.exitCode === null) await stop(proc.child);
    await rm(dir, {recursive: true, force: true});
  }
});

test('duas pessoas podem ter a mesma senha: quem entra é quem foi escolhido', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notas-contas-'));
  let proc;
  try {
    proc = await launch(dir, {APP_USERS: 'a:Ana:igual,b:Bia:igual'});
    const login = async user => (await fetch(proc.url + '/api/login', {method: 'POST', body: JSON.stringify({user, password: 'igual'})})).headers.get('set-cookie').split(';')[0];
    const me = async cookie => (await (await fetch(proc.url + '/api/session', {headers: {cookie}})).json()).me.id;
    assert.equal(await me(await login('a')), 'a');
    assert.equal(await me(await login('b')), 'b');
  } finally {
    if (proc?.child.exitCode === null) await stop(proc.child);
    await rm(dir, {recursive: true, force: true});
  }
});
