import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import vm from 'node:vm';

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const passkeyCode = source.slice(source.indexOf('const passkeySupported ='), source.indexOf('const sqlDate ='));

function client(fetch, get = () => { throw Error('O autenticador não deveria abrir'); }) {
  const context = vm.createContext({fetch, window: {PublicKeyCredential: class {}}, navigator: {credentials: {get}}, atob, btoa});
  vm.runInContext(`let loginOptions = null, loginOptionsError = null, regOptions = null; ${passkeyCode}`, context);
  return expression => vm.runInContext(expression, context);
}

for (const [status, error, expected] of [
  [403, 'Origem inválida', /endereço configurado no servidor/],
  [429, 'Aguarde um minuto e tente novamente.', /Aguarde um minuto/],
  [500, undefined, /Não foi possível preparar a passkey/],
]) {
  test(`passkey: resposta HTTP ${status} não chega ao autenticador`, async () => {
    const run = client(async () => Response.json({error}, {status}));
    await run('prepareLogin()'); // Prefetch must handle errors without rejecting.
    assert.equal(run('loginOptions'), null);
    await assert.rejects(run('passkeyLogin()'), expected);
  });
}

test('passkey: rejeita opções sem desafio válido', async () => {
  for (const value of [{}, null, {challenge: ''}, {challenge: 123}, {challenge: '***'}]) {
    const run = client(async () => Response.json(value));
    await assert.rejects(run('passkeyLogin()'), /Não foi possível preparar a passkey/);
    assert.equal(run('loginOptions'), null);
  }
});

test('passkey: falhas de rede e JSON têm mensagem legível', async () => {
  for (const fetch of [async () => { throw new TypeError('Failed to fetch'); }, async () => new Response('<html>Erro</html>', {status: 502})]) {
    // Use the same Error constructors as fetch/Response in this isolated client.
    const context = vm.createContext({fetch, window: {}, navigator: {}, atob, btoa, TypeError, SyntaxError});
    vm.runInContext(`let loginOptions = null, loginOptionsError = null; ${passkeyCode}`, context);
    await assert.rejects(vm.runInContext('passkeyLogin()', context), /Sem conexão com o servidor ou resposta inválida/);
  }
});

test('passkey: nova tentativa recupera opções e envia a credencial', async () => {
  let available = false, submissions = 0, prompts = 0;
  const run = client(async (url, options) => {
    if (url.endsWith('login-options')) return available ? Response.json({challenge: 'AQID', rpId: 'localhost', allowCredentials: [{type: 'public-key', id: 'BAUG'}]}) : Response.json({error: 'Aguarde um minuto.'}, {status: 429});
    assert.equal(url, '/api/passkey/login');
    const credential = JSON.parse(options.body);
    assert.equal(credential.id, 'BAUG');
    assert.equal(credential.response.signature, 'AQID');
    submissions++;
    return Response.json({ok: true});
  }, async ({publicKey}) => {
    prompts++;
    assert.deepEqual(Array.from(publicKey.challenge), [1, 2, 3]);
    assert.deepEqual(Array.from(publicKey.allowCredentials[0].id), [4, 5, 6]);
    return {id: 'BAUG', rawId: new Uint8Array([4, 5, 6]).buffer, type: 'public-key', getClientExtensionResults: () => ({}), response: {clientDataJSON: new Uint8Array([1]), authenticatorData: new Uint8Array([2]), signature: new Uint8Array([1, 2, 3])}};
  });
  await run('prepareLogin()');
  assert.equal(run('loginOptions'), null);
  available = true;
  await run('passkeyLogin()');
  assert.equal(prompts, 1);
  assert.equal(submissions, 1);
  assert.equal(run('loginOptions'), null, 'desafio consumido não pode ser reutilizado');
  assert.equal(run('loginOptionsError'), null);
});
