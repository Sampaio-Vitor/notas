import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {initialState, apply, liveMemos, trashedMemos, sortMemos, memoUnseen, memoPurgeOps, memoSnippet, memoTitle, memoTasks, toggleMemoTask, searchMemos, memoTickOnly, tabPrefs, MEMO_MAX, TRASH_DAYS} from '../public/model.js';
import {spaceTool} from '../mcp-espaco.mjs';
import {validate} from '../validacao.mjs';

const HOJE = '2026-11-04', AGORA = Date.UTC(2026, 10, 4, 15), DIA = 864e5;
let n = 0;
const novoId = () => `n${++n}`;
const estado = () => initialState(['Pessoal', 'Trabalho', 'Saúde']);
// Runs a tool and applies what it wrote, as the server would after validating it.
function roda(s, name, args = {}, agora = AGORA) {
  const r = spaceTool(s, name, args, HOJE, novoId, 'robo', agora);
  for (const op of r.ops) { assert.ok(validate(JSON.parse(JSON.stringify({opId: 'x', ...op}))), JSON.stringify(op)); apply(s, op); }
  return r;
}

// ---------- Modelo ----------

test('notas: ordem, novas e Apagadas', () => {
  const s = estado();
  apply(s, {collection: 'memos', id: 'a', patch: {title: 'Antiga', body: '', edited: AGORA - 3 * DIA}});
  apply(s, {collection: 'memos', id: 'b', patch: {title: 'Recente', body: '', edited: AGORA - DIA, agent: 'Robô'}});
  apply(s, {collection: 'memos', id: 'c', patch: {title: 'Fixada', body: '', edited: AGORA - 9 * DIA, pinned: true}});
  apply(s, {collection: 'memos', id: 'd', patch: {title: 'No lixo', body: 'texto', edited: AGORA, trashed: AGORA - 2 * DIA}});
  apply(s, {collection: 'memos', id: 'e', patch: {title: 'Vencida', body: 'texto', edited: AGORA, trashed: AGORA - TRASH_DAYS * DIA}});
  assert.deepEqual(sortMemos(liveMemos(s)).map(m => m.title), ['Fixada', 'Recente', 'Antiga']);
  assert.deepEqual(trashedMemos(s, AGORA).map(m => m.title), ['No lixo'], 'passados os dias, sai de Apagadas');
  // Escrita por agente e ainda não aberta; abrir (seen) tira o aviso.
  assert.equal(memoUnseen(s.memos.b), true);
  assert.equal(memoUnseen(s.memos.a), false);
  apply(s, {collection: 'memos', id: 'b', patch: {seen: AGORA}});
  assert.equal(memoUnseen(s.memos.b), false);
  // A limpeza apaga de vez só a vencida, e esvazia o texto.
  const ops = memoPurgeOps(s, AGORA);
  assert.deepEqual(ops.map(o => o.id), ['e']);
  for (const op of ops) { assert.ok(validate({opId: 'x', ...op})); apply(s, op); }
  assert.deepEqual([s.memos.e.deleted, s.memos.e.body, s.memos.e.title], [true, '', '']);
  assert.deepEqual(memoPurgeOps(s, AGORA), []);
  // Recuperar: trashed volta a 0 (um registro deleted nunca voltaria).
  apply(s, {collection: 'memos', id: 'd', patch: {trashed: 0}});
  assert.ok(liveMemos(s).some(m => m.id === 'd'));
});

test('notas: título, trecho, caixas e busca saem do Markdown', () => {
  const body = '# Viagem\n\nLevar **passaporte** e [seguro](https://exemplo.com).\n- [ ] comprar *adaptador*\n- [x] reservar hotel\n```\n- [ ] dentro do código\n```\n1. [ ] trocar dinheiro\n> - [X] vacina\n\n| Item | Dono |\n| --- | --- |\n| Mala | Ana |';
  assert.equal(memoTitle({title: 'Com título', body}), 'Com título');
  assert.equal(memoTitle({title: '', body}), 'Viagem');
  assert.equal(memoTitle({title: '', body: ''}), 'Sem título');
  assert.equal(memoSnippet({title: 'T', body}, 60), 'Viagem · Levar passaporte e seguro. · comprar adaptador · r…');
  assert.equal(memoSnippet({title: '', body}, 30), 'Levar passaporte e seguro.…', 'sem título, a primeira linha não repete, e o corte não deixa um separador solto');
  assert.match(memoSnippet({title: 'T', body}, 400), /Item · Dono · Mala · Ana$/);
  assert.deepEqual(memoTasks(body), {total: 4, done: 2}, 'a caixa dentro do bloco de código não conta');
  assert.equal(toggleMemoTask(body, 3).split('\n')[3], '- [x] comprar *adaptador*');
  assert.equal(toggleMemoTask(body, 4).split('\n')[4], '- [ ] reservar hotel');
  assert.equal(toggleMemoTask(body, 9).split('\n')[9], '> - [ ] vacina');
  assert.equal(toggleMemoTask(body, 6), null, 'linha de código não é caixa');
  assert.equal(toggleMemoTask(body, 0), null);
  // Marcar uma caixa não é escrever a nota; mudar qualquer outra coisa é.
  assert.equal(memoTickOnly(body, toggleMemoTask(body, 3)), true);
  assert.equal(memoTickOnly(body, body), false);
  assert.equal(memoTickOnly(body, body.replace('hotel', 'pousada')), false);
  assert.equal(memoTickOnly(body, body.replace('- [ ] dentro do código', '- [x] dentro do código')), true, 'dentro do código também é só a marca');
  assert.deepEqual(searchMemos([{title: 'Viagem', body}], 'mala').map(x => x.line), ['Mala · Ana'], 'linha de tabela sem as barras');
  const lista = [{title: 'Viagem', body}, {title: 'Pão de fermentação', body: 'farinha'}];
  assert.deepEqual(searchMemos(lista, 'PAO').map(x => x.memo.title), ['Pão de fermentação']);
  assert.deepEqual(searchMemos(lista, 'hotel viagem').map(x => [x.memo.title, x.line]), [['Viagem', 'reservar hotel']]);
  assert.equal(searchMemos(lista, '  ').length, 2);
});

test('notas: validação aceita 50.000 no texto da nota e mantém 10.000 no resto', () => {
  const op = (patch, collection = 'memos') => validate({opId: 'x', collection, id: 'n', patch});
  assert.equal(op({title: 'a', body: 'x'.repeat(MEMO_MAX)}), true);
  assert.equal(op({body: 'x'.repeat(MEMO_MAX + 1)}), false);
  assert.equal(op({title: 'x'.repeat(201)}), false);
  assert.equal(op({body: 'x'.repeat(10001)}, 'notes'), false, 'nota fixa da Casa continua com o limite de antes');
  assert.equal(op({pinned: true, section: 's0', seen: 1, trashed: 0, trashedAgent: '', agent: ''}), true);
  assert.equal(op({pinned: 'sim'}), false);
  assert.equal(op({cor: 'azul'}), false);
  assert.equal(op({notas: false}, 'prefs'), true);
  assert.equal(tabPrefs(estado()).notas, true, 'a aba vem ligada');
});

// ---------- MCP (funções puras) ----------

test('nota_criar e nota_ler: Markdown inteiro, seção pelo nome, sem seção por padrão', () => {
  const s = estado();
  const r = roda(s, 'nota_criar', {titulo: '  Resumo   da reunião ', texto: '## Decisões\r\n- Migrar em **dezembro**\n\n', secao: 'saude', fixada: true});
  const id = r.ops[0].id;
  assert.deepEqual(r.result, {id, titulo: 'Resumo da reunião', secao: 'Saúde', fixada: true, editada_em: new Date(AGORA).toISOString(), tamanho: 36});
  assert.deepEqual(r.ops[0].patch, {title: 'Resumo da reunião', body: '## Decisões\n- Migrar em **dezembro**', section: 's2', pinned: true, added: AGORA, edited: AGORA, trashed: 0});
  const lida = roda(s, 'nota_ler', {id}).result;
  assert.equal(lida.texto, '## Decisões\n- Migrar em **dezembro**');
  assert.equal(lida.criada_em, new Date(AGORA).toISOString());
  const solta = roda(s, 'nota_criar', {titulo: 'Sem seção'});
  assert.deepEqual([solta.result.secao, solta.result.fixada, solta.ops[0].patch.body], [null, false, '']);
  assert.throws(() => roda(s, 'nota_criar', {titulo: 'x', secao: 'Inexistente'}), /as seções são: Pessoal, Trabalho, Saúde/);
  assert.throws(() => roda(s, 'nota_criar', {texto: 'sem título'}), /titulo deve ter/);
  assert.throws(() => roda(s, 'nota_criar', {titulo: 'x', texto: 'a'.repeat(MEMO_MAX + 1)}), /o limite é 50000/);
  assert.throws(() => roda(s, 'nota_criar', {titulo: 'x', fixada: 'sim'}), /fixada deve ser true ou false/);
  for (const fantasma of ['constructor', '__proto__', 'nao-existe']) assert.throws(() => roda(s, 'nota_ler', {id: fantasma}), /nota não encontrada/);
});

test('nota_criar: a chave não duplica; a mesma chave com outro título é erro', () => {
  const s = estado();
  const pedido = {titulo: 'Resumo de 4/11', texto: 'a', chave: 'resumo-2026-11-04'};
  const uma = roda(s, 'nota_criar', pedido);
  const outra = roda(s, 'nota_criar', pedido);
  assert.equal(outra.result.id, uma.result.id);
  assert.equal(outra.result.repetida, true);
  assert.deepEqual(outra.ops, []);
  assert.equal(liveMemos(s).length, 1);
  assert.throws(() => roda(s, 'nota_criar', {...pedido, titulo: 'Outra coisa'}), /já foi usada na nota "Resumo de 4\/11"/);
  roda(s, 'nota_apagar', {id: uma.result.id});
  assert.equal(roda(s, 'nota_criar', pedido).result.apagada, true, 'apagada no app: não recria calado');
});

test('nota_editar: acrescentar, trocar uma vez só e texto inteiro; um modo por chamada', () => {
  const s = estado();
  const id = roda(s, 'nota_criar', {titulo: 'Lista', texto: '- pão\n- leite'}).result.id;
  let r = roda(s, 'nota_editar', {id, acrescentar: '- café\n'}, AGORA + 1000);
  assert.deepEqual(r.ops[0].patch, {body: '- pão\n- leite\n- café', edited: AGORA + 1000});
  r = roda(s, 'nota_editar', {id, trocar: {de: '- leite', para: '- leite $& sem lactose'}});
  assert.equal(s.memos[id].body, '- pão\n- leite $& sem lactose\n- café', 'o texto novo entra literal');
  assert.throws(() => roda(s, 'nota_editar', {id, trocar: {de: 'manteiga', para: 'x'}}), /não está na nota/);
  assert.throws(() => roda(s, 'nota_editar', {id, trocar: {de: '- ', para: '* '}}), /aparece 3 vezes/);
  assert.throws(() => roda(s, 'nota_editar', {id, trocar: {de: '', para: 'x'}}), /trocar\.de está vazio/);
  assert.throws(() => roda(s, 'nota_editar', {id, trocar: 'pão por bolo'}), /trocar deve ser/);
  assert.throws(() => roda(s, 'nota_editar', {id, texto: 'a', acrescentar: 'b'}), /só um de texto, acrescentar ou trocar/);
  assert.throws(() => roda(s, 'nota_editar', {id}), /nada para mudar/);
  assert.throws(() => roda(s, 'nota_editar', {id, acrescentar: 'x'.repeat(MEMO_MAX)}), /o limite é 50000/);
  assert.equal(s.memos[id].body, '- pão\n- leite $& sem lactose\n- café', 'um erro não grava nada');
  r = roda(s, 'nota_editar', {id, texto: 'Tudo novo'});
  assert.equal(roda(s, 'nota_ler', {id}).result.texto, 'Tudo novo');
  // Em nota vazia, acrescentar começa o texto.
  const vazia = roda(s, 'nota_criar', {titulo: 'Vazia'}).result.id;
  roda(s, 'nota_editar', {id: vazia, acrescentar: '\n\nprimeira linha'});
  assert.equal(s.memos[vazia].body, 'primeira linha');
});

test('nota_editar: título, seção e fixada; o que já está igual não grava', () => {
  const s = estado();
  const id = roda(s, 'nota_criar', {titulo: 'Ideias', texto: 'a', secao: 'Trabalho'}).result.id;
  let r = roda(s, 'nota_editar', {id, titulo: 'Ideias', secao: 'trabalho', fixada: false});
  assert.deepEqual(r.ops, [], 'nada mudou');
  r = roda(s, 'nota_editar', {id, secao: '', fixada: true});
  assert.deepEqual(r.ops[0].patch, {section: '', pinned: true}, 'seção e fixada não contam como escrita: sem edited');
  assert.deepEqual([r.result.secao, r.result.fixada], [null, true]);
  r = roda(s, 'nota_editar', {id, titulo: 'Ideias soltas'}, AGORA + 5);
  assert.deepEqual(r.ops[0].patch, {title: 'Ideias soltas', edited: AGORA + 5});
});

test('nota_apagar: vai para Apagadas, some da lista e do nota_ler, e repetir não grava', () => {
  const s = estado();
  const id = roda(s, 'nota_criar', {titulo: 'Rascunho', texto: 'x'}).result.id;
  const r = roda(s, 'nota_apagar', {id}, AGORA + 9);
  assert.deepEqual(r.result, {id, titulo: 'Rascunho', apagada: true, dias_para_recuperar: 30});
  assert.deepEqual(r.ops, [{collection: 'memos', id, patch: {trashed: AGORA + 9}}]);
  assert.equal(s.memos[id].deleted, undefined, 'não é apagada de vez');
  assert.equal(s.memos[id].body, 'x');
  assert.deepEqual(roda(s, 'notas_listar').result.notas, []);
  assert.throws(() => roda(s, 'nota_ler', {id}), /foi apagada; ela fica em Apagadas/);
  assert.throws(() => roda(s, 'nota_editar', {id, acrescentar: 'y'}), /foi apagada/);
  assert.deepEqual(roda(s, 'nota_apagar', {id}).ops, []);
  // Recuperada no app, volta a existir para o agente com o mesmo id.
  apply(s, {collection: 'memos', id, patch: {trashed: 0}});
  assert.equal(roda(s, 'nota_ler', {id}).result.texto, 'x');
});

test('notas_listar: fixadas primeiro, depois as mais recentes; busca sem acento com o trecho; seção', () => {
  const s = estado();
  const a = roda(s, 'nota_criar', {titulo: 'Receita do pão', texto: '500 g de farinha\n350 g de água', secao: 'Pessoal'}, AGORA).result.id;
  const b = roda(s, 'nota_criar', {titulo: 'Reunião', texto: '## Decisões\n- Migração em dezembro', secao: 'Trabalho'}, AGORA + 1).result.id;
  const c = roda(s, 'nota_criar', {titulo: 'Fixa', texto: 'sempre no topo', fixada: true}, AGORA - 99).result.id;
  apply(s, {collection: 'memos', id: b, patch: {agent: 'Robô'}});
  const todas = roda(s, 'notas_listar').result.notas;
  assert.deepEqual(todas.map(x => x.id), [c, b, a]);
  assert.deepEqual(todas[1], {id: b, titulo: 'Reunião', secao: 'Trabalho', fixada: false, editada_em: new Date(AGORA + 1).toISOString(), por: 'Robô', tamanho: 34});
  assert.equal('texto' in todas[0], false, 'a lista não traz o texto');
  assert.deepEqual(roda(s, 'notas_listar', {busca: 'MIGRACAO'}).result.notas.map(x => [x.id, x.trecho]), [[b, 'Migração em dezembro']]);
  assert.deepEqual(roda(s, 'notas_listar', {busca: 'pao'}).result.notas.map(x => x.id), [a]);
  assert.deepEqual(roda(s, 'notas_listar', {secao: 'pessoal'}).result.notas.map(x => x.id), [a]);
  assert.deepEqual(roda(s, 'notas_listar', {secao: ''}).result.notas.map(x => x.id), [c], '"" é sem seção');
  assert.throws(() => roda(s, 'notas_listar', {secao: 'Lazer'}), /as seções são/);
});

// ---------- Servidor ----------

async function launch(dir, env) {
  const child = spawn(process.execPath, ['server.mjs'], {env: {...process.env, PORT: '0', DATA_DIR: dir, APP_PASSWORD: '', APP_USERS: '', MCP_TOKENS: '', MCP_AGENT_NAMES: '', ...env}, stdio: ['ignore', 'pipe', 'pipe']});
  const url = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('startup timeout')), 5000);
    child.stdout.on('data', b => { const m = b.toString().match(/http:\/\/[^\s]+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
    child.once('exit', code => reject(Error(`exit ${code}`)));
  });
  return {child, url};
}
const stop = child => new Promise(resolve => { child.once('exit', resolve); child.kill('SIGTERM'); });
const LIA = 'token-do-lia-com-mais-de-24-caracteres', ROBO = 'token-do-robo-com-mais-de-24-caracteres';

test('notas no servidor: o agente escreve só no espaço do token, o servidor carimba quem escreveu e quem apagou', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notas-memos-'));
  let proc;
  try {
    proc = await launch(dir, {APP_USERS: 'ana:Ana:senha-do-ana,bia:Bia:senha-da-bia', MCP_TOKENS: `lia:${LIA},robo:${ROBO}:ana`, MCP_AGENT_NAMES: 'robo:Robô'});
    const {url} = proc;
    let k = 0;
    const rpc = (method, params, token) => fetch(url + '/mcp', {method: 'POST', headers: {'Content-Type': 'application/json', Authorization: `Bearer ${token}`}, body: JSON.stringify({jsonrpc: '2.0', id: ++k, method, params})});
    const call = async (token, name, args) => (await (await rpc('tools/call', {name, arguments: args}, token)).json());
    const entrar = async (user, password) => (await fetch(url + '/api/login', {method: 'POST', body: JSON.stringify({user, password})})).headers.get('set-cookie').split(';')[0];
    const ana = await entrar('ana', 'senha-do-ana'), bia = await entrar('bia', 'senha-da-bia');
    const estadoDe = async cookie => (await fetch(url + '/api/state', {headers: {cookie}})).json();
    const envia = (cookie, ops) => fetch(url + '/api/operations', {method: 'POST', headers: {cookie, 'Content-Type': 'application/json'}, body: JSON.stringify(ops)});

    // O token sem espaço não vê nem chama as notas.
    const doLia = (await (await rpc('tools/list', {}, LIA)).json()).result.tools.map(t => t.name);
    assert.ok(!doLia.some(t => t.startsWith('nota')));
    assert.equal((await call(LIA, 'notas_listar', {})).error.code, -32602);
    const doRobo = (await (await rpc('tools/list', {}, ROBO)).json()).result.tools.map(t => t.name);
    for (const t of ['notas_listar', 'nota_ler', 'nota_criar', 'nota_editar', 'nota_apagar']) assert.ok(doRobo.includes(t), t);

    const antes = Date.now();
    const criada = (await call(ROBO, 'nota_criar', {titulo: 'Resumo da reunião', texto: '## Decisões\n- [ ] Revisar o PR'})).result;
    assert.equal(criada.isError, false);
    const id = criada.structuredContent.id;
    let s = await estadoDe(ana);
    assert.equal(s.memos[id].body, '## Decisões\n- [ ] Revisar o PR');
    assert.equal(s.memos[id].agent, 'Robô', 'o nome do agente vem de MCP_AGENT_NAMES');
    assert.ok(s.memos[id].edited >= antes && s.memos[id].added >= antes);
    assert.equal((await estadoDe(bia)).memos[id], undefined, 'o espaço vem do token: a Bia não vê');
    assert.equal((await call(ROBO, 'notas_listar', {})).result.structuredContent.notas[0].por, 'Robô');

    // A Ana edita no app: deixa de ser "escrita pelo agente", e o app não escolhe o carimbo.
    assert.equal((await envia(ana, [{opId: 'ana-1', collection: 'memos', id, patch: {title: 'Resumo', agent: 'Fulano', trashedAgent: 'Fulano', added: 5}}])).status, 200);
    s = await estadoDe(ana);
    assert.deepEqual([s.memos[id].title, s.memos[id].agent, s.memos[id].trashedAgent], ['Resumo', '', '']);
    assert.ok(s.memos[id].added >= antes, 'a criação não muda numa edição');
    // Fixar não é escrever: não mexe em edited nem em quem escreveu.
    const escrita = s.memos[id].edited;
    await call(ROBO, 'nota_editar', {id, fixada: true});
    s = await estadoDe(ana);
    assert.deepEqual([s.memos[id].pinned, s.memos[id].edited, s.memos[id].agent], [true, escrita, '']);

    // Marcar uma caixa (no app ou pelo agente) não muda quem escreveu nem quando.
    await call(ROBO, 'nota_editar', {id, acrescentar: '- [ ] Avisar o time'});
    s = await estadoDe(ana);
    const doAgente1 = s.memos[id].edited;
    assert.equal(s.memos[id].agent, 'Robô');
    assert.equal((await envia(ana, [{opId: 'ana-tick', collection: 'memos', id, patch: {body: s.memos[id].body.replace('- [ ] Avisar', '- [x] Avisar'), edited: Date.now() + 5000}}])).status, 200);
    s = await estadoDe(ana);
    assert.match(s.memos[id].body, /- \[x\] Avisar o time/);
    assert.deepEqual([s.memos[id].agent, s.memos[id].edited], ['Robô', doAgente1], 'marcar a caixa não tira o nome do agente');
    assert.equal((await envia(ana, [{opId: 'ana-escreve', collection: 'memos', id, patch: {body: s.memos[id].body + '\nlinha da Ana'}}])).status, 200);
    s = await estadoDe(ana);
    assert.equal(s.memos[id].agent, '', 'escrever tira');

    // Uma nota no limite, cheia de acentos, chega inteira (o corpo do pedido vem em vários pedaços).
    const longo = 'ação à moda é ótima; '.repeat(2500).slice(0, 50000);
    assert.equal(longo.length, 50000);
    assert.equal((await envia(ana, [{opId: 'ana-2', collection: 'memos', id: 'grande', patch: {title: 'Grande', body: longo, added: Date.now(), edited: Date.now()}}])).status, 200);
    s = await estadoDe(ana);
    assert.equal(s.memos.grande.body, longo);
    assert.equal((await (await call(ROBO, 'nota_ler', {id: 'grande'})).result.structuredContent).texto, longo);
    const demais = await envia(ana, [{opId: 'ana-3', collection: 'memos', id: 'grande', patch: {body: longo + '!'}}]);
    assert.equal(demais.status, 400);
    assert.equal((await demais.json()).invalid, true);
    const estourou = (await call(ROBO, 'nota_editar', {id: 'grande', acrescentar: 'mais'})).result;
    assert.equal(estourou.isError, true);
    assert.match(estourou.content[0].text, /o limite é 50000/);

    // O agente apaga: vai para Apagadas com o nome dele; a Ana recupera e o id continua valendo.
    const apagada = (await call(ROBO, 'nota_apagar', {id})).result.structuredContent;
    assert.deepEqual([apagada.titulo, apagada.apagada], ['Resumo', true]);
    s = await estadoDe(ana);
    assert.ok(s.memos[id].trashed >= antes);
    assert.equal(s.memos[id].trashedAgent, 'Robô');
    assert.match(s.memos[id].body, /^## Decisões\n- \[ \] Revisar o PR\n- \[x\] Avisar o time\nlinha da Ana$/, 'o texto continua lá');
    assert.match((await call(ROBO, 'nota_ler', {id})).result.content[0].text, /Apagadas/);
    await envia(ana, [{opId: 'ana-4', collection: 'memos', id, patch: {trashed: 0}}]);
    s = await estadoDe(ana);
    assert.deepEqual([s.memos[id].trashed, s.memos[id].trashedAgent], [0, '']);
    assert.equal((await call(ROBO, 'nota_ler', {id})).result.isError, false);
    // A Ana apaga no app: sem agente; uma data absurda vinda do aparelho vira a do servidor.
    await envia(ana, [{opId: 'ana-5', collection: 'memos', id, patch: {trashed: 12345}}]);
    s = await estadoDe(ana);
    assert.ok(s.memos[id].trashed >= antes);
    assert.equal(s.memos[id].trashedAgent, '');

    const backup = await (await fetch(url + '/api/export', {headers: {cookie: ana}})).json();
    const doAgente = backup.operations.map(o => JSON.parse(o.value)).filter(v => v.agent === 'robo' && v.collection === 'memos');
    assert.ok(doAgente.length >= 3 && doAgente.every(v => v.space === 'ana'));
  } finally {
    if (proc?.child.exitCode === null) await stop(proc.child);
    await rm(dir, {recursive: true, force: true});
  }
});
