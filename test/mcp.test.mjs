import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

async function launch(dir, env) {
  const child = spawn(process.execPath, ['server.mjs'], {env: {...process.env, PORT: '0', DATA_DIR: dir, APP_PASSWORD: '', APP_USERS: '', MCP_TOKENS: '', ...env}, stdio: ['ignore', 'pipe', 'pipe']});
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('startup timeout')), 5000);
    child.stdout.on('data', b => { const m = b.toString().match(/http:\/\/[^\s]+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
    child.once('exit', code => reject(Error(`exit ${code}`)));
  });
  return {child, url};
}
const stop = child => new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
const TOKEN = 'token-do-lia-com-mais-de-24-caracteres';

test('MCP: só compras, com token, sem duplicar, avisando os aparelhos', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notas-mcp-'));
  let proc;
  try {
    proc = await launch(dir, {APP_USERS: 'ana:Ana:senha-do-ana,bia:Bia:senha-da-bia', MCP_TOKENS: `lia:${TOKEN}`});
    const {url} = proc;
    let n = 0;
    const rpc = (method, params, token = TOKEN) => fetch(url + '/mcp', {method: 'POST', headers: {'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', Authorization: `Bearer ${token}`}, body: JSON.stringify({jsonrpc: '2.0', id: ++n, method, params})});
    const call = async (name, args) => (await (await rpc('tools/call', {name, arguments: args})).json()).result;

    // Token: sem ou errado não entra; o cookie de sessão não serve no /mcp.
    assert.equal((await rpc('tools/list', {}, 'errado')).status, 401);
    assert.equal((await fetch(url + '/mcp', {method: 'POST', body: '{}'})).status, 401);
    assert.equal((await fetch(url + '/mcp', {headers: {Authorization: `Bearer ${TOKEN}`}})).status, 405);
    // O token não abre a API do app.
    assert.equal((await fetch(url + '/api/state', {headers: {Authorization: `Bearer ${TOKEN}`}})).status, 401);

    const init = (await (await rpc('initialize', {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'teste', version: '1'}})).json()).result;
    assert.equal(init.protocolVersion, '2025-06-18');
    assert.equal(init.serverInfo.name, 'notas');
    const notification = await fetch(url + '/mcp', {method: 'POST', headers: {Authorization: `Bearer ${TOKEN}`}, body: JSON.stringify({jsonrpc: '2.0', method: 'notifications/initialized'})});
    assert.equal(notification.status, 202);
    const tools = (await (await rpc('tools/list', {})).json()).result.tools.map(t => t.name);
    assert.deepEqual(tools, ['compras_listar', 'compras_adicionar', 'compras_remover', 'compras_sugerir']);
    assert.equal((await (await rpc('metodo/inexistente', {})).json()).error.code, -32601);

    // A Bia escuta os avisos do app; o que a Lia põe chega nela.
    const login = await fetch(url + '/api/login', {method: 'POST', body: JSON.stringify({user: 'bia', password: 'senha-da-bia'})});
    const cookie = login.headers.get('set-cookie').split(';')[0];
    const controller = new AbortController();
    const stream = (await fetch(url + '/api/events', {headers: {cookie}, signal: controller.signal})).body.getReader();
    assert.match(new TextDecoder().decode((await stream.read()).value), /connected/);

    let r = await call('compras_adicionar', {itens: ['leite', 'Pão de forma', 'pao  de FORMA'], por: 'bia'});
    assert.equal(r.isError, false);
    assert.deepEqual(r.structuredContent, {adicionados: ['Leite', 'Pão de forma'], ja_estavam: []});
    assert.match(new TextDecoder().decode((await stream.read()).value), /changed/);
    controller.abort();

    const state = await (await fetch(url + '/api/state', {headers: {cookie}})).json();
    assert.equal(state.shopping['i-leite'].by, 'bia', 'a cor é de quem pediu à Lia');
    assert.equal(state.shopping['i-leite'].listed, true);

    // Sem `por`, fica no nome do agente; acento e maiúscula não duplicam.
    r = await call('compras_adicionar', {itens: ['LEITE', 'café']});
    assert.deepEqual(r.structuredContent, {adicionados: ['Café'], ja_estavam: ['Leite']});
    assert.equal((await call('compras_adicionar', {itens: ['ovo'], por: 'fulano'})).isError, true);
    assert.equal((await call('compras_adicionar', {itens: []})).isError, true);

    r = await call('compras_listar', {});
    assert.deepEqual(r.structuredContent.itens, [
      {nome: 'Leite', por: 'Bia', carrinho: false},
      {nome: 'Pão de forma', por: 'Bia', carrinho: false},
      {nome: 'Café', por: 'lia', carrinho: false},
    ]);

    // Remover: o que não existe volta com a lista atual.
    r = await call('compras_remover', {itens: ['pão de forma', 'leite integral']});
    assert.deepEqual(r.structuredContent, {removidos: ['Pão de forma'], nao_encontrados: ['leite integral'], lista: ['Leite', 'Café']});
    const after = await (await fetch(url + '/api/state', {headers: {cookie}})).json();
    assert.equal(after.shopping['i-pao de forma'].listed, false, 'remover não apaga: sai da lista, como no app');

    // Sugestões: o que já esteve na lista, começando pelo texto, com o que está nela marcado.
    r = await call('compras_sugerir', {texto: 'PAO'});
    assert.deepEqual(r.structuredContent.sugestoes.map(s => [s.nome, s.na_lista]), [['Pão de forma', false]]);
    assert.ok(r.structuredContent.sugestoes[0].ultima_vez > 0);
    assert.deepEqual((await call('compras_sugerir', {texto: 'forma'})).structuredContent.sugestoes.map(s => s.nome), ['Pão de forma'], 'casa o começo de qualquer palavra');
    assert.deepEqual((await call('compras_sugerir', {texto: 'caf'})).structuredContent.sugestoes.map(s => [s.nome, s.na_lista]), [['Café', true]]);
    assert.equal((await call('compras_sugerir', {texto: ''})).isError, true);

    // Adicionar de novo volta pra lista.
    assert.deepEqual((await call('compras_adicionar', {itens: ['Pão de forma'], por: 'ana'})).structuredContent.adicionados, ['Pão de forma']);

    // As operações ficam no log com a pessoa e o agente.
    const backup = await (await fetch(url + '/api/export', {headers: {cookie}})).json();
    const ops = backup.operations.map(o => JSON.parse(o.value)).filter(v => v.agent === 'lia');
    assert.ok(ops.length >= 5 && ops.every(v => v.space === 'casa'));
  } finally {
    if (proc?.child.exitCode === null) await stop(proc.child);
    await rm(dir, {recursive: true, force: true});
  }
});

test('MCP: desligado sem MCP_TOKENS e token curto não sobe', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notas-mcp-'));
  let proc;
  try {
    proc = await launch(dir, {});
    assert.equal((await fetch(proc.url + '/mcp', {method: 'POST', headers: {Authorization: 'Bearer qualquer'}, body: '{}'})).status, 405, 'sem tokens o /mcp não existe');
    await stop(proc.child);
    await assert.rejects(launch(dir, {MCP_TOKENS: 'lia:curto'}), /exit/);
  } finally {
    if (proc?.child.exitCode === null) await stop(proc.child);
    await rm(dir, {recursive: true, force: true});
  }
});
