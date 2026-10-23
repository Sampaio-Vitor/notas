import {test} from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {initialState, apply, rollover, scheduledBills, cardBillOps} from '../public/model.js';

const run = (state, ops) => ops.forEach(op => apply(state, op));
function fixture() {
  const s = initialState();
  s.months['2026-10'] = {month: '2026-10'};
  s.bills.nubank = {id: 'nubank', text: 'Nubank', amount: 100000, due: 10, month: '2026-10', repeat: true, done: false};
  s.cards['7'] = {id: '7', name: 'Nubank', bills: {
    '2026-10': {amount: 123456, due: '2026-10-15', status: 'closed'},
    '2026-11': {amount: 50000, due: '2026-11-15', status: 'open'},
  }};
  s.cardLinks.nubank = {id: 'nubank', card: '7'};
  return s;
}

test('conta ligada a um cartão segue o valor e o vencimento da fatura', () => {
  const s = fixture();
  run(s, cardBillOps(s));
  assert.deepEqual([s.bills.nubank.amount, s.bills.nubank.due, s.bills.nubank.cardStatus], [123456, 15, 'closed']);
  assert.deepEqual(cardBillOps(s), [], 'nada muda quando já está igual');
});

test('conta paga mantém o valor com que foi paga', () => {
  const s = fixture();
  s.bills.nubank.done = true;
  assert.deepEqual(cardBillOps(s), []);
});

test('sem vínculo ou por ocorrência, o cartão não mexe na conta', () => {
  const s = fixture();
  s.cardLinks.nubank.card = '';
  assert.deepEqual(cardBillOps(s), []);
  const t = fixture();
  Object.assign(t.bills.nubank, {calcMode: 'occurrence', unitAmount: 100, weekdays: '1'});
  assert.deepEqual(cardBillOps(t), []);
});

test('previsão e virada do mês usam a fatura do cartão', () => {
  const s = fixture();
  assert.equal(scheduledBills(s, '2026-11', 1)[0].total, 50000);
  assert.equal(scheduledBills(s, '2026-12', 1)[0].total, 100000, 'sem fatura no mês, vale a regra');
  run(s, rollover(s, '2026-11-01'));
  assert.equal(s.bills['nubank-2026-11'].amount, 50000);
});

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
const FINANCE_TOKEN = randomBytes(24).toString('hex');

test('servidor: lê as faturas do app de finanças e atualiza a conta ligada', async () => {
  const month = new Intl.DateTimeFormat('en-CA', {timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit'}).format(new Date());
  const seen = [];
  const finance = http.createServer((req, res) => {
    seen.push({path: req.url, auth: req.headers.authorization});
    if (req.headers.authorization !== `Bearer ${FINANCE_TOKEN}`) { res.writeHead(401); return res.end(); }
    res.writeHead(200, {'Content-Type': 'application/json'});
    res.end(JSON.stringify({cards: [{id: 7, name: 'Nubank', currency: 'BRL', bills: [{month, due_date: `${month}-15`, amount: '1234.56', status: 'open', source: 'inferred'}]}]}));
  });
  await new Promise(resolve => finance.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(join(tmpdir(), 'notas-cards-'));
  let proc;
  try {
    proc = await launch(dir, {FINANCE_URL: `http://127.0.0.1:${finance.address().port}/`, FINANCE_TOKEN});
    const {url} = proc;
    const state = async () => (await fetch(url + '/api/state')).json();
    let s;
    for (let i = 0; i < 50 && !(s = await state()).cards['7']; i++) await new Promise(r => setTimeout(r, 100));
    assert.deepEqual(s.cards['7'].bills[month], {amount: 123456, due: `${month}-15`, status: 'open'});
    assert.deepEqual(seen[0], {path: '/api/integrations/credit-card-bills', auth: `Bearer ${FINANCE_TOKEN}`});

    const post = ops => fetch(url + '/api/operations', {method: 'POST', body: JSON.stringify(ops)});
    // Só o servidor escreve os cartões.
    assert.equal((await post([{opId: 'x1', collection: 'cards', id: '7', patch: {name: 'Outro'}}])).status, 400);
    assert.equal((await post([{opId: 'x2', collection: 'cardLinks', id: 'fatura', patch: {card: 'abc'}}])).status, 400);

    const ok = await post([
      {opId: 'b1', collection: 'bills', id: 'fatura', patch: {text: 'Nubank', amount: 0, due: 0, month, repeat: true, every: 1, done: false}},
      {opId: 'b2', collection: 'cardLinks', id: 'fatura', patch: {card: '7'}},
    ]);
    assert.equal(ok.status, 200);
    s = await state();
    assert.deepEqual([s.bills.fatura.amount, s.bills.fatura.due, s.bills.fatura.cardStatus], [123456, 15, 'open']);

    // Paga à mão, a conta não muda mais.
    await post([{opId: 'b3', collection: 'bills', id: 'fatura', patch: {done: true}}]);
    s = await state();
    assert.equal(s.bills.fatura.done, true);
    assert.equal(s.bills.fatura.amount, 123456);
  } finally {
    if (proc) await stop(proc.child);
    finance.close();
    await rm(dir, {recursive: true, force: true});
  }
});

test('servidor: app de finanças fora do ar não impede o resto', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notas-cards-'));
  let proc;
  try {
    proc = await launch(dir, {FINANCE_URL: 'http://127.0.0.1:9', FINANCE_TOKEN});
    const s = await (await fetch(proc.url + '/api/state')).json();
    assert.deepEqual(s.cards, {});
  } finally {
    if (proc) await stop(proc.child);
    await rm(dir, {recursive: true, force: true});
  }
});
