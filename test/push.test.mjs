import {test} from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import http from 'node:http';
import {createECDH, createHmac, createDecipheriv, randomBytes} from 'node:crypto';
import {casaAlerts, casaMessages, meetingReminders, stillTrue, choreKey} from '../push.mjs';
import {normalize} from '../public/model.js';

const people = ['ana', 'bia'];

test('casaAlerts: item novo nas compras avisa os outros, não quem pôs', () => {
  const before = normalize({shopping: {
    leite: {id: 'leite', text: 'Leite', listed: false}, pao: {id: 'pao', text: 'Pão', listed: true},
    cafe: {id: 'cafe', text: 'Café', listed: true, done: true}, sal: {id: 'sal', text: 'Sal', listed: true, done: true},
  }});
  const alerts = casaAlerts(before, [
    {collection: 'shopping', id: 'leite', patch: {done: false, listed: true, by: 'ana'}},
    {collection: 'shopping', id: 'pao', patch: {listed: true}}, // já estava na lista
    {collection: 'shopping', id: 'ovos', patch: {text: 'Ovos', listed: true}},
    {collection: 'shopping', id: 'ovos', patch: {text: 'Ovos', listed: true}}, // repetido no lote
    {collection: 'shopping', id: 'cafe', patch: {done: false, listed: true, added: 1}}, // estava no carrinho e foi pedido de novo
    {collection: 'shopping', id: 'sal', patch: {done: false}}, // só saiu do carrinho
    {collection: 'shopping', id: 'acucar', patch: {done: true}},
  ], 'ana', people);
  assert.deepEqual(alerts.map(a => [a.to, a.id, a.text]), [['bia', 'leite', 'Leite'], ['bia', 'ovos', 'Ovos'], ['bia', 'cafe', 'Café']]);
  // Um agente sem `por` avisa todo mundo.
  assert.equal(casaAlerts(normalize({}), [{collection: 'shopping', id: 'x', patch: {text: 'X', listed: true}}], 'robo', people).length, 2);
});

test('casaAlerts: afazer para outra pessoa ou para todos; não para si, na próxima do ciclo nem no Desfazer', () => {
  const before = normalize({chores: {c1: {id: 'c1', text: 'Lixo', list: 'afazeres', who: 'ana'}, c2: {id: 'c2', text: 'Regar', list: 'afazeres', who: 'ana', cycle: 'w1', date: '2026-11-20'}}});
  const justDeleted = new Set([choreKey({text: 'Desfeito', list: 'afazeres'})]);
  const alerts = casaAlerts(before, [
    {collection: 'chores', id: 'n1', patch: {text: 'Vacina', list: 'afazeres', who: 'bia', added: 1}}, // criado offline há tempo: avisa
    {collection: 'chores', id: 'n2', patch: {text: 'Mercado', list: 'afazeres', who: ''}},
    {collection: 'chores', id: 'n3', patch: {text: 'Meu', list: 'afazeres', who: 'ana'}},
    {collection: 'chores', id: 'c1', patch: {who: 'bia'}}, // passou para a Bia
    {collection: 'chores', id: 'c2', patch: {done: true, next: 'n4'}},
    {collection: 'chores', id: 'n4', patch: {text: 'Regar', list: 'afazeres', who: ''}},
    {collection: 'chores', id: 'n5', patch: {text: 'Desfeito', list: 'afazeres', who: ''}}, // Desfazer exclusão
  ], 'ana', people, justDeleted);
  assert.deepEqual(alerts.map(a => [a.to, a.text, a.forAll]), [['bia', 'Vacina', false], ['bia', 'Mercado', true], ['bia', 'Lixo', false]]);
});

test('stillTrue: na hora de enviar, só o que continua valendo', () => {
  const casa = normalize({shopping: {a: {id: 'a', text: 'A', listed: true}, b: {id: 'b', text: 'B', listed: false}},
    chores: {x: {id: 'x', text: 'X', who: 'bia'}, y: {id: 'y', text: 'Y', who: 'ana'}, z: {id: 'z', text: 'Z', who: '', deleted: true}}});
  assert.equal(stillTrue(casa, {kind: 'compras', id: 'a'}), true);
  assert.equal(stillTrue(casa, {kind: 'compras', id: 'b'}), false);
  assert.equal(stillTrue(casa, {kind: 'afazeres', id: 'x', to: 'bia'}), true);
  assert.equal(stillTrue(casa, {kind: 'afazeres', id: 'y', to: 'bia'}), false);
  assert.equal(stillTrue(casa, {kind: 'afazeres', id: 'z', to: 'bia'}), false);
});

test('casaMessages: junta por pessoa e tipo, corta textos longos e não usa tag', () => {
  const name = id => ({ana: 'Ana', bia: 'Bia'})[id] || id, list = id => id === 'afazeres' ? 'Afazeres' : '';
  const msgs = casaMessages([
    ...['Leite', 'Pão', 'Ovos', 'Café', 'Sal'].map(text => ({kind: 'compras', actor: 'ana', id: text, text})),
    {kind: 'afazeres', actor: 'ana', id: 'v', text: 'Vacina', list: 'afazeres', forAll: false},
  ], name, list);
  assert.deepEqual(msgs.map(m => [m.title, m.body, m.url]), [['Compras', 'Ana adicionou Leite, Pão, Ovos e mais 2', '/?aba=compras&lista=compras'], ['Afazeres', 'Ana: Vacina · para você', '/?aba=compras&lista=afazeres']]);
  assert.equal(msgs.some(m => 'tag' in m), false);
  assert.equal(casaMessages([{kind: 'compras', actor: 'bia', id: 'a', text: 'A'}, {kind: 'compras', actor: 'bia', id: 'b', text: 'B'}], name, list)[0].body, 'Bia adicionou A e B');
  const long = casaMessages([{kind: 'afazeres', actor: 'ana', id: 'l', text: 'x'.repeat(10000), list: 'afazeres', forAll: true}], name, list)[0];
  assert.ok(JSON.stringify(long).length < 400);
});

test('meetingReminders: 10 e 5 minutos antes, só reuniões com horário e não concluídas', () => {
  const date = '2026-11-24';
  const state = normalize({days: {[date]: {date}}, tasks: {
    m: {id: 'm', text: 'Daily', date, time: '11:00', end: '11:15', meeting: true},
    t: {id: 't', text: 'Tarefa', date, time: '11:00'},
    d: {id: 'd', text: 'Feita', date, time: '11:00', meeting: true, done: true},
    x: {id: 'x', text: 'Hora ruim', date, time: '11h', meeting: true},
  }});
  const at = hm => meetingReminders(state, date, Number(hm.slice(0, 2)) * 60 + Number(hm.slice(3)));
  assert.deepEqual(at('10:49'), []);
  assert.deepEqual(at('10:50').map(r => [r.title, r.body]), [['Daily', 'Começa em 10 min · 11:00–11:15']]);
  assert.equal(at('10:51').length, 1); // ainda dentro da folga
  assert.deepEqual(at('10:52'), []);
  assert.deepEqual(at('10:55').map(r => r.body), ['Começa em 5 min · 11:00–11:15']);
  assert.notEqual(at('10:50')[0].key, at('10:55')[0].key);
  // Sem tag: o de 5 min não substitui o de 10 em silêncio (macOS).
  assert.equal('tag' in at('10:55')[0], false);
  assert.equal(at('10:50')[0].url, '/?aba=hoje');
  // Com a aba Agenda ligada, as reuniões ficam lá.
  state.prefs.tabs = {reunioes: true};
  assert.equal(at('10:50')[0].url, '/?aba=reunioes');
  // Reunião logo depois da meia-noite: 23:50 do dia anterior é -10 minutos.
  const next = normalize({tasks: {m: {id: 'm', text: 'Cedo', date, time: '00:00', meeting: true}}});
  assert.equal(meetingReminders(next, date, -10).length, 1);
});

// Receiving side of RFC 8291 (aes128gcm), to read what the server sent.
function decrypt(body, ua, auth) {
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen), data = body.subarray(21 + idlen);
  const hmac = (key, ...parts) => createHmac('sha256', key).update(Buffer.concat(parts)).digest();
  const ikm = hmac(hmac(auth, ua.computeSecret(asPublic)), Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic, Buffer.from([1]));
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from('Content-Encoding: aes128gcm\0'), Buffer.from([1])).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from('Content-Encoding: nonce\0'), Buffer.from([1])).subarray(0, 12);
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(data.subarray(-16));
  const plain = Buffer.concat([d.update(data.subarray(0, -16)), d.final()]);
  return JSON.parse(plain.subarray(0, plain.lastIndexOf(2)).toString());
}

test('servidor: inscrição, aviso de compras para a outra pessoa e lembrete de reunião', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'notas-push-'));
  const received = [];
  const devices = {};
  const fake = http.createServer((req, res) => {
    const chunks = [];
    req.on('data', c => chunks.push(c)).on('end', () => {
      const who = req.url.slice(1), {ua, auth} = devices[who];
      received.push({who, auth: req.headers.authorization, ttl: req.headers.ttl, message: decrypt(Buffer.concat(chunks), ua, auth)});
      res.writeHead(who === 'sumiu' ? 410 : 201).end();
    });
  });
  await new Promise(r => fake.listen(0, '127.0.0.1', r));
  const pushUrl = `http://127.0.0.1:${fake.address().port}`;
  const device = name => {
    const ua = createECDH('prime256v1'); ua.generateKeys();
    const auth = randomBytes(16);
    devices[name] = {ua, auth};
    return {endpoint: `${pushUrl}/${name}`, keys: {p256dh: ua.getPublicKey('base64url'), auth: auth.toString('base64url')}};
  };
  const now = new Date(), minutes = now.getUTCHours() * 60 + now.getUTCMinutes() + 10;
  const hm = `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
  const child = spawn(process.execPath, ['server.mjs'], {env: {...process.env, PORT: '0', DATA_DIR: dir, APP_PASSWORD: '', APP_USERS: 'ana:Ana:a,bia:Bia:b', TZ: 'UTC', PUSH_ALLOW_HTTP: '1', PUSH_ALLOW_HOSTS: '127.0.0.1', PUSH_DELAY_MS: '300', PUSH_TICK_MS: '200'}, stdio: ['ignore', 'pipe', 'pipe']});
  try {
    const url = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('startup timeout')), 5000);
      child.stdout.on('data', b => { const m = b.toString().match(/http:\/\/[^\s]+/); if (m) { clearTimeout(timer); resolve(m[0]); } });
      child.once('exit', code => reject(Error(`exit ${code}`)));
    });
    const login = async (user, password) => (await fetch(url + '/api/login', {method: 'POST', body: JSON.stringify({user, password})})).headers.get('set-cookie').split(';')[0];
    const ana = await login('ana', 'a'), bia = await login('bia', 'b');
    const post = (cookie, path, body) => fetch(url + path, {method: 'POST', headers: {'Content-Type': 'application/json', cookie}, body: JSON.stringify(body)});
    const until = async (check, ms = 4000) => { const end = Date.now() + ms; while (!check()) { if (Date.now() > end) throw Error('timeout: ' + JSON.stringify(received)); await new Promise(r => setTimeout(r, 50)); } };

    assert.equal((await fetch(url + '/api/push')).status, 401);
    const {key} = await (await fetch(url + '/api/push', {headers: {cookie: ana}})).json();
    assert.match(key, /^[A-Za-z0-9_-]{80,}$/);
    assert.equal((await post(ana, '/api/push/subscribe', {endpoint: 'file:///etc/passwd', keys: {p256dh: 'x', auth: 'y'}})).status, 400);
    // Só serviços de push conhecidos, e chaves com o tamanho certo.
    const valid = device('x');
    for (const endpoint of ['https://169.254.169.254/latest', 'https://localhost/x', 'http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.example/x'])
      assert.equal((await post(ana, '/api/push/subscribe', {...valid, endpoint})).status, 400, endpoint);
    assert.equal((await post(ana, '/api/push/subscribe', {...valid, keys: {...valid.keys, auth: 'curta'}})).status, 400);
    assert.equal((await post(ana, '/api/push/test', {})).status, 404);
    assert.equal((await post(ana, '/api/push/subscribe', device('ana-mac'))).status, 200);
    assert.equal((await post(ana, '/api/push/subscribe', device('ana-iphone'))).status, 200);
    assert.equal((await post(bia, '/api/push/subscribe', device('bia'))).status, 200);

    // Bia adds two items, one request each: Ana's devices get one notification each; Bia gets none.
    await post(bia, '/api/operations', {opId: 'i1', collection: 'shopping', id: 'leite', patch: {text: 'Leite', done: false, listed: true, added: Date.now()}});
    await post(bia, '/api/operations', {opId: 'i2', collection: 'shopping', id: 'pao', patch: {text: 'Pão', done: false, listed: true, added: Date.now()}});
    await until(() => received.length >= 2);
    await new Promise(r => setTimeout(r, 400));
    assert.deepEqual(received.map(r => r.who).sort(), ['ana-iphone', 'ana-mac']);
    assert.deepEqual(received[0].message, {title: 'Compras', body: 'Bia adicionou Leite e Pão', url: '/?aba=compras&lista=compras'});
    assert.match(received[0].auth, /^vapid t=.+, k=/);

    // An item added and removed before the notification goes out is left out of it.
    received.length = 0;
    await post(bia, '/api/operations', {opId: 'i3', collection: 'shopping', id: 'liete', patch: {text: 'Liete', done: false, listed: true, added: Date.now()}});
    await post(bia, '/api/operations', {opId: 'i4', collection: 'shopping', id: 'liete', patch: {listed: false, done: false}});
    await post(bia, '/api/operations', {opId: 'i5', collection: 'shopping', id: 'ovos', patch: {text: 'Ovos', done: false, listed: true, added: Date.now()}});
    await until(() => received.length >= 2);
    assert.equal(received[0].message.body, 'Bia adicionou Ovos');

    // A chore Ana creates for everyone reaches Bia.
    received.length = 0;
    await post(ana, '/api/operations', {opId: 'c1', collection: 'chores', id: 'ch1', patch: {text: 'Trocar lâmpada', list: 'afazeres', who: '', date: '', cycle: '', done: false, added: Date.now()}});
    await until(() => received.length >= 1);
    assert.deepEqual([received[0].who, received[0].message.title, received[0].message.body], ['bia', 'Afazeres', 'Ana: Trocar lâmpada · para todos']);

    // Deleting it and tapping Undo (a copy with a new id) is not news.
    received.length = 0;
    await post(ana, '/api/operations', {opId: 'c2', collection: 'chores', id: 'ch1', patch: {deleted: true}});
    await post(ana, '/api/operations', {opId: 'c3', collection: 'chores', id: 'ch1-copia', patch: {text: 'Trocar lâmpada', list: 'afazeres', who: '', date: '', cycle: '', done: false, added: Date.now()}});
    await new Promise(r => setTimeout(r, 600));
    assert.equal(received.length, 0);

    // A meeting of Ana's 10 minutes from now: a reminder to her devices, once.
    if (minutes < 24 * 60) {
      received.length = 0;
      const date = now.toISOString().slice(0, 10);
      await post(ana, '/api/operations', {opId: 'm1', collection: 'tasks', id: 'm1', patch: {text: 'Daily', section: 's0', date, time: hm, end: '', meeting: true, done: false}});
      await until(() => received.length >= 2);
      await new Promise(r => setTimeout(r, 600));
      assert.equal(received.length, 2);
      assert.equal(received[0].message.body.startsWith('Começa em 10 min'), true);
      assert.equal(received[0].ttl, '600');
    }

    // A device that is gone (410) is forgotten.
    assert.equal((await post(bia, '/api/push/subscribe', device('sumiu'))).status, 200);
    received.length = 0;
    assert.equal((await post(bia, '/api/push/test', {})).status, 200);
    await until(() => received.filter(r => r.who === 'sumiu').length === 1);
    received.length = 0;
    await post(bia, '/api/push/test', {});
    await until(() => received.length >= 1);
    await new Promise(r => setTimeout(r, 200));
    assert.deepEqual(received.map(r => r.who), ['bia']);
    // The test can go to one device only.
    received.length = 0;
    assert.equal((await post(ana, '/api/push/test', {endpoint: `${pushUrl}/ana-mac`})).status, 200);
    await new Promise(r => setTimeout(r, 200));
    assert.deepEqual(received.map(r => r.who), ['ana-mac']);

    // Turning off on a device stops it there.
    await post(bia, '/api/push/unsubscribe', {endpoint: `${pushUrl}/bia`});
    received.length = 0;
    assert.equal((await post(bia, '/api/push/test', {})).status, 404);
    await new Promise(r => setTimeout(r, 300));
    assert.equal(received.length, 0);
  } finally {
    await new Promise(r => { child.once('exit', r); child.kill('SIGTERM'); });
    fake.close();
    await rm(dir, {recursive: true, force: true});
  }
});
