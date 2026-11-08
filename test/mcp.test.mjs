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
// A server that must refuse to start: its exit code and what it wrote to stderr.
function refusedStart(dir, env) {
  const child = spawn(process.execPath, ['server.mjs'], {env: {...process.env, PORT: '0', DATA_DIR: dir, APP_PASSWORD: '', APP_USERS: '', MCP_TOKENS: '', ...env}, stdio: ['ignore', 'pipe', 'pipe']});
  let stderr = '';
  child.stderr.on('data', b => { stderr += b; });
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(Error('não deveria ter subido')); }, 5000);
    child.stdout.on('data', b => { if (/http:\/\//.test(b)) { clearTimeout(timer); child.kill(); reject(Error('não deveria ter subido')); } });
    child.once('exit', code => { clearTimeout(timer); resolve({code, stderr}); });
  });
}
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

    // Marcar como comprado no app grava quando e quem; o MCP informa.
    const send = patch => fetch(url + '/api/operations', {method: 'POST', headers: {cookie}, body: JSON.stringify({opId: `op-${Math.random()}`, collection: 'shopping', id: 'i-leite', patch})});
    const naLoja = Date.now() - 3600000;
    assert.equal((await send({done: true, bought: naLoja, boughtBy: 'ana'})).status, 200);
    let leite = (await (await fetch(url + '/api/state', {headers: {cookie}})).json()).shopping['i-leite'];
    assert.equal(leite.bought, naLoja, 'vale a hora do aparelho (pode ter ficado sem internet no mercado)');
    assert.equal(leite.boughtBy, 'bia', 'quem comprou vem da sessão, não do aparelho');
    r = await call('compras_listar', {});
    assert.deepEqual(r.structuredContent.itens.find(i => i.nome === 'Leite'), {nome: 'Leite', por: 'Bia', carrinho: true, comprado_em: new Date(naLoja).toISOString(), comprado_por: 'Bia'});
    assert.equal(r.structuredContent.itens.find(i => i.nome === 'Café').comprado_em, undefined);
    // Hora impossível vira a do servidor; tirar do carrinho (ainda na lista) apaga o registro.
    await send({done: true, bought: Date.now() + 86400000});
    leite = (await (await fetch(url + '/api/state', {headers: {cookie}})).json()).shopping['i-leite'];
    assert.ok(leite.bought <= Date.now());
    await send({done: false, bought: 0});
    leite = (await (await fetch(url + '/api/state', {headers: {cookie}})).json()).shopping['i-leite'];
    assert.equal(leite.bought, 0); assert.equal(leite.boughtBy, '');
    // Limpar o carrinho guarda a última compra, que as sugestões mostram.
    await send({done: true, bought: naLoja});
    await send({listed: false, done: false, bought: 0});
    r = await call('compras_sugerir', {texto: 'leite'});
    assert.deepEqual(r.structuredContent.sugestoes.map(s => [s.na_lista, s.ultima_compra, s.comprado_por]), [[false, new Date(naLoja).toISOString(), 'Bia']]);
    assert.equal((await call('compras_sugerir', {texto: 'caf'})).structuredContent.sugestoes[0].ultima_compra, null);

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

test('MCP: token com espaço alcança tarefas e contas só desse espaço', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notas-mcp-'));
  const ROBO = 'token-do-robo-com-mais-de-24-caracteres';
  let proc;
  try {
    proc = await launch(dir, {APP_USERS: 'ana:Ana:senha-do-ana,bia:Bia:senha-da-bia', MCP_TOKENS: `lia:${TOKEN},robo:${ROBO}:ana`});
    const {url} = proc;
    let n = 0;
    const rpc = (method, params, token) => fetch(url + '/mcp', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: JSON.stringify({jsonrpc: '2.0', id: ++n, method, params})});
    const call = async (token, name, args) => (await (await rpc('tools/call', {name, arguments: args}, token)).json());

    const doLia = (await (await rpc('tools/list', {}, TOKEN)).json()).result.tools.map(t => t.name);
    assert.ok(!doLia.includes('tarefa_criar'), 'token sem espaço: só compras');
    assert.equal((await call(TOKEN, 'tarefa_criar', {texto: 'x', quando: 'hoje'})).error.code, -32602);
    const doRobo = (await (await rpc('tools/list', {}, ROBO)).json()).result.tools.map(t => t.name);
    assert.ok(doRobo.includes('compras_listar') && doRobo.includes('tarefa_criar') && doRobo.includes('contas_mes'));

    const criada = (await call(ROBO, 'tarefa_criar', {texto: 'Comprar ração', quando: 'hoje'})).result;
    assert.equal(criada.isError, false);
    const id = criada.structuredContent.id;
    // Uma seção que não existe: o erro traz as seções.
    const errada = (await call(ROBO, 'tarefa_criar', {texto: 'x', quando: 'hoje', secao: 'Inexistente'})).result;
    assert.equal(errada.isError, true);
    assert.match(errada.content[0].text, /as seções são/);

    const entrar = async (user, password) => (await fetch(url + '/api/login', {method: 'POST', body: JSON.stringify({user, password})})).headers.get('set-cookie').split(';')[0];
    const doAna = await (await fetch(url + '/api/state', {headers: {cookie: await entrar('ana', 'senha-do-ana')}})).json();
    assert.equal(doAna.tasks[id].text, 'Comprar ração');
    const daBia = await (await fetch(url + '/api/state', {headers: {cookie: await entrar('bia', 'senha-da-bia')}})).json();
    assert.equal(daBia.tasks[id], undefined, 'o espaço vem do token: a Bia não vê');
    // Nenhum argumento muda o espaço.
    const outra = (await call(ROBO, 'tarefas_dia', {espaco: 'bia'})).result;
    assert.ok(outra.structuredContent.secoes.flatMap(s => s.tarefas).some(t => t.id === id));

    assert.equal((await call(ROBO, 'tarefa_concluir', {id})).result.structuredContent.feita, true);

    // Ids herdados do protótipo: erro, e nada gravado (antes virava uma tarefa fantasma).
    for (const fantasma of ['constructor', 'toString', '__proto__']) {
      const r = (await call(ROBO, 'tarefa_mover', {id: fantasma, quando: 'hoje'})).result;
      assert.equal(r.isError, true, fantasma);
    }
    const semFantasma = await (await fetch(url + '/api/state', {headers: {cookie: await entrar('ana', 'senha-do-ana')}})).json();
    assert.equal(Object.hasOwn(semFantasma.tasks, 'constructor'), false);
    assert.equal(Object.hasOwn(semFantasma.tasks, 'toString'), false);

    // Horário no backlog: erro claro.
    const backlog = (await call(ROBO, 'tarefa_criar', {texto: 'x', quando: 'backlog', horario: '10:00'})).result;
    assert.equal(backlog.isError, true);
    assert.match(backlog.content[0].text, /backlog não tem horário/);

    // A mesma chave, repetida (como depois de um erro de rede): uma tarefa só.
    const pedido = {texto: 'Renovar CNH', quando: 'amanha', chave: 'telegram-981'};
    const uma = (await call(ROBO, 'tarefa_criar', pedido)).result.structuredContent;
    const outraVez = (await call(ROBO, 'tarefa_criar', pedido)).result.structuredContent;
    assert.equal(outraVez.id, uma.id);
    assert.equal(outraVez.repetida, true);
    const depois = await (await fetch(url + '/api/state', {headers: {cookie: await entrar('ana', 'senha-do-ana')}})).json();
    assert.equal(Object.values(depois.tasks).filter(t => t.text === 'Renovar CNH').length, 1);
    const contas = (await call(ROBO, 'contas_mes', {})).result;
    assert.equal(contas.isError, false);
    assert.deepEqual(contas.structuredContent.contas, []);

    const backup = await (await fetch(url + '/api/export', {headers: {cookie: await entrar('ana', 'senha-do-ana')}})).json();
    const ops = backup.operations.map(o => JSON.parse(o.value)).filter(v => v.agent === 'robo');
    assert.ok(ops.length >= 2 && ops.every(v => v.space === 'ana' && v.user === 'ana'));
  } finally {
    if (proc?.child.exitCode === null) await stop(proc.child);
    await rm(dir, {recursive: true, force: true});
  }
});

test('MCP: espaço digitado errado no MCP_TOKENS não sobe; token sem espaço continua igual', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notas-mcp-'));
  const ROBO = 'token-do-robo-com-mais-de-24-caracteres';
  const users = 'ana:Ana:senha-do-ana,bia:Bia:senha-da-bia';
  let proc;
  try {
    const {code, stderr} = await refusedStart(dir, {APP_USERS: users, MCP_TOKENS: `lia:${TOKEN},robo:${ROBO}:vitro`});
    assert.notEqual(code, 0);
    assert.match(stderr, /o espaço "vitro" do agente "robo" não é ninguém de APP_USERS \(ana, bia\)/);

    // A Lia (sem espaço) segue como antes; um último campo que não tem forma de id continua sendo parte do token.
    proc = await launch(dir, {APP_USERS: users, MCP_TOKENS: `lia:${TOKEN},velho:${ROBO}:Com-Maiuscula`});
    const tools = async token => (await (await fetch(proc.url + '/mcp', {method: 'POST', headers: {Authorization: `Bearer ${token}`}, body: JSON.stringify({jsonrpc: '2.0', id: 1, method: 'tools/list'})})).json()).result.tools.map(t => t.name);
    assert.deepEqual(await tools(TOKEN), ['compras_listar', 'compras_adicionar', 'compras_remover', 'compras_sugerir']);
    assert.deepEqual(await tools(`${ROBO}:Com-Maiuscula`), ['compras_listar', 'compras_adicionar', 'compras_remover', 'compras_sugerir']);
  } finally {
    if (proc?.child.exitCode === null) await stop(proc.child);
    await rm(dir, {recursive: true, force: true});
  }
});
