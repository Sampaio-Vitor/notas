import {test} from 'node:test';
import assert from 'node:assert/strict';
import {initialState, apply, rollover, live, repeatingBills, scheduledBills, billCatalog, editBillOps, deleteBillOps, undoBillOps, billRule, billDates, billIncludedDates, billSnapshot} from '../public/model.js';

const run = (state, ops) => ops.forEach(op => apply(state, op));
function fixture() {
  const s = initialState();
  s.months['2026-09'] = {month: '2026-09'};
  s.bills.internet = {id: 'internet', text: 'Internet', amount: 11990, due: 25, month: '2026-09', repeat: true, done: true};
  run(s, rollover(s, '2026-10-01'));
  return s;
}
const value = {text: 'Fibra', amount: 13990, due: 28, repeat: true, every: 1};

test('editar apenas um vencimento preserva a regra, o pagamento e o histórico', () => {
  const s = fixture();
  run(s, editBillOps(s, s.bills['internet-2026-10'], value));
  assert.equal(s.bills['internet-2026-10'].amount, 13990);
  assert.equal(s.bills.internet.amount, 11990);
  assert.equal(s.bills.internet.done, true);
  assert.equal(scheduledBills(s, '2026-11', 1)[0].total, 11990);
  run(s, rollover(s, '2026-11-01'));
  assert.equal(s.bills['internet-2026-11'].amount, 11990);
  assert.equal(s.bills['internet-2026-11'].text, 'Internet');
  assert.equal(s.bills['internet-2026-11'].done, false);
});

test('editar uma ocorrência antiga não redefine o modelo mais recente', () => {
  const s = fixture();
  s.bills['internet-2026-10'].amount = 15000;
  run(s, editBillOps(s, s.bills.internet, value));
  assert.equal(s.bills.internet.done, true);
  assert.equal(scheduledBills(s, '2026-11', 1)[0].total, 15000);
});

test('editar este e os próximos atualiza os pendentes, preservando os já pagos', () => {
  const s = fixture();
  run(s, rollover(s, '2026-11-01'));
  run(s, rollover(s, '2026-12-01'));
  s.bills['internet-2026-12'].done = true;
  run(s, editBillOps(s, s.bills['internet-2026-10'], value, 'future'));
  assert.equal(s.bills.internet.amount, 11990);
  assert.equal(s.bills['internet-2026-11'].amount, 13990);
  assert.equal(s.bills['internet-2026-12'].amount, 11990);
  run(s, rollover(s, '2027-01-01'));
  assert.equal(s.bills['internet-2027-01'].amount, 13990);
});

test('mudança de frequência respeita o novo ritmo mesmo com meses já gerados', () => {
  const s = fixture();
  run(s, rollover(s, '2026-11-01'));
  run(s, rollover(s, '2026-12-01'));
  run(s, editBillOps(s, s.bills['internet-2026-10'], {...value, every: 2}, 'future'));
  assert.equal(s.bills['internet-2026-11'].skipped, true);
  assert.equal(s.bills['internet-2026-12'].amount, 13990);
  assert.equal(scheduledBills(s, '2027-01', 1)[0].total, 0);
  run(s, rollover(s, '2027-02-01'));
  assert.equal(s.bills['internet-2027-02'].amount, 13990);
});

test('excluir só um vencimento deixa a recorrência ativa e não o recria', () => {
  const s = fixture();
  run(s, deleteBillOps(s, s.bills['internet-2026-10']));
  assert.equal(live(s, 'bills').length, 1);
  assert.equal(repeatingBills(s).length, 1);
  assert.equal(s.bills.internet.done, true);
  delete s.months['2026-10'];
  run(s, rollover(s, '2026-10-02'));
  assert.equal(s.bills['internet-2026-10'].skipped, true);
  run(s, rollover(s, '2026-11-01'));
  assert.equal(s.bills['internet-2026-11'].amount, 11990);
});

test('excluir este e os próximos encerra a série sem apagar pagamentos', () => {
  const s = fixture();
  run(s, rollover(s, '2026-11-01'));
  run(s, rollover(s, '2026-12-01'));
  s.bills['internet-2026-12'].done = true;
  run(s, deleteBillOps(s, s.bills['internet-2026-10'], 'future'));
  assert.equal(repeatingBills(s).length, 0);
  assert.equal(s.bills['internet-2026-11'].skipped, true);
  assert.equal(s.bills.internet.done, true);
  assert.equal(s.bills['internet-2026-12'].skipped, undefined);
  run(s, rollover(s, '2027-01-01'));
  assert.equal(s.bills['internet-2027-01'], undefined);
  assert.equal(billCatalog(s, '2027-01').length, 0);
});

test('Todas inclui contas além de 12 meses e só avulsas pendentes', () => {
  const s = fixture();
  s.bills['internet-2026-10'].done = true;
  s.bills.domain = {id: 'domain', text: 'Domínio', amount: 8000, due: 12, month: '2026-09', repeat: true, every: 24, done: true};
  s.bills.single = {id: 'single', text: 'Avulsa', amount: 10000, month: '2026-10', repeat: false, done: false};
  s.bills.paid = {id: 'paid', text: 'Paga', month: '2026-10', repeat: false, done: true};
  const list = billCatalog(s, '2026-10');
  assert.equal(list.length, 3);
  assert.equal(list.filter(b => b.text === 'Internet').length, 1);
  const domain = list.find(b => b.text === 'Domínio');
  assert.equal(domain.month, '2028-09');
  assert.equal(domain.virtual, true);
  assert.equal(domain.recurring, true);
  assert.equal(list.find(b => b.id === 'single').recurring, false);
});

test('editar e pular um vencimento projetado não antecipa nem duplica a conta', () => {
  const s = fixture();
  s.bills['internet-2026-10'].done = true;
  const next = billCatalog(s, '2026-10')[0];
  assert.equal(next.month, '2026-11');
  run(s, editBillOps(s, next, value));
  assert.equal(scheduledBills(s, '2026-11', 1)[0].total, 13990);
  run(s, rollover(s, '2026-11-01'));
  assert.equal(s.bills[next.id].amount, 13990);
  run(s, deleteBillOps(s, s.bills[next.id]));
  assert.equal(scheduledBills(s, '2026-11', 1)[0].total, 0);
  assert.equal(billCatalog(s, '2026-11')[0].month, '2026-12');
  run(s, rollover(s, '2026-12-01'));
  assert.equal(s.bills['internet-2026-12'].amount, 11990);
});

test('não repetir encerra a série e uma avulsa pode passar a repetir', () => {
  const s = fixture();
  const b = s.bills['internet-2026-10'];
  run(s, editBillOps(s, b, {...value, repeat: false}, 'future'));
  assert.equal(repeatingBills(s).length, 0);
  assert.equal(billCatalog(s, '2026-10')[0].recurring, false);
  run(s, editBillOps(s, s.bills[b.id], value));
  assert.equal(repeatingBills(s).length, 1);
  run(s, rollover(s, '2026-11-01'));
  assert.equal(s.bills['internet-2026-11'].amount, 13990);
});

test('lacunas de meses conservam a frequência sem ressuscitar séries excluídas', () => {
  const s = fixture();
  s.bills['internet-2026-10'].every = 2;
  run(s, rollover(s, '2027-02-01'));
  assert.equal(s.bills['internet-2027-02'].every, 2);
  run(s, deleteBillOps(s, s.bills['internet-2027-02'], 'future'));
  run(s, rollover(s, '2027-06-01'));
  assert.equal(s.bills['internet-2027-06'], undefined);
});

test('formulário antigo não recria uma conta removida nem desmarca um pagamento recente', () => {
  const s = fixture();
  s.bills['internet-2026-10'].done = true;
  const next = billCatalog(s, '2026-10')[0];
  s.bills[next.id] = {...next, virtual: undefined, done: true};
  run(s, editBillOps(s, next, value));
  assert.equal(s.bills[next.id].done, true);
  const old = {...s.bills[next.id]};
  run(s, deleteBillOps(s, old));
  assert.deepEqual(editBillOps(s, old, value), []);
  assert.deepEqual(deleteBillOps(s, old), []);
  assert.equal(s.bills[next.id].skipped, true);
});

test('formulário de ocorrência projetada não reativa série encerrada em outro aparelho', () => {
  const s = fixture();
  s.bills['internet-2026-10'].done = true;
  const next = billCatalog(s, '2026-10')[0];
  run(s, deleteBillOps(s, s.bills['internet-2026-10'], 'future'));
  assert.deepEqual(editBillOps(s, next, value, 'future'), []);
  assert.deepEqual(deleteBillOps(s, next), []);
});

const therapy = {id: 'therapy', text: 'Terapia', calcMode: 'occurrence', unitAmount: 20000, weekdays: '4', starts: '2026-10-01', excluded: '', repeat: true, every: 1, due: 30, month: '2026-10'};
function therapyState() {
  const s = initialState();
  s.bills.therapy = {...therapy, ...billSnapshot(therapy), done: false};
  s.months['2026-10'] = {month: '2026-10'};
  return s;
}

test('valor por ocorrência usa as quintas reais de cada mês, inclusive fevereiro bissexto', () => {
  assert.deepEqual(billDates(therapy), ['2026-10-01', '2026-10-08', '2026-10-15', '2026-10-22', '2026-10-29']);
  assert.equal(billSnapshot(therapy).amount, 100000);
  assert.equal(billSnapshot(therapy, '2026-11').amount, 80000);
  assert.equal(billDates({...therapy, starts: '2024-01-01'}, '2024-02').length, 5);
  assert.equal(billSnapshot({...therapy, starts: '2024-01-01'}, '2024-02').amount, 100000);
});

test('início no meio do mês, múltiplos dias, preço em centavos e meses sem sessões', () => {
  assert.equal(billSnapshot({...therapy, starts: '2026-10-15'}).amount, 60000);
  assert.equal(billSnapshot({...therapy, starts: '2026-11-01'}).amount, 0);
  assert.equal(billSnapshot({...therapy, weekdays: '14'}).amount, 180000);
  assert.equal(billSnapshot({...therapy, unitAmount: 19999}).amount, 99995);
  assert.equal(billSnapshot({...therapy, calcMode: 'fixed', amount: 99999}, '2026-11').amount, 99999);
});

test('a virada e a projeção calculam cada mês e não propagam exclusões', () => {
  const s = therapyState();
  s.bills.therapy.excluded = '2026-10-29';
  s.bills.therapy.amount = 80000;
  const projected = scheduledBills(s, '2026-11', 2);
  assert.deepEqual(projected.map(m => m.total), [80000, 100000]);
  assert.equal(projected[0].items[0].excluded, '');
  run(s, rollover(s, '2026-11-01'));
  assert.equal(s.bills['therapy-2026-11'].amount, 80000);
  assert.equal(s.bills['therapy-2026-11'].excluded, '');
  assert.equal(s.bills['therapy-2026-11'].unitAmount, 20000);
  assert.equal(s.bills.therapy.excluded, '2026-10-29');
});

test('excluir uma sessão só afeta o total daquele mês e preserva a regra', () => {
  const s = therapyState();
  run(s, editBillOps(s, s.bills.therapy, {...therapy, excluded: '2026-10-29'}));
  assert.equal(s.bills.therapy.amount, 80000);
  assert.equal(billIncludedDates(s.bills.therapy).length, 4);
  assert.equal(s.billRules.therapy.excluded, '');
  run(s, rollover(s, '2026-12-01'));
  assert.equal(s.bills['therapy-2026-12'].amount, 100000);
  assert.equal(s.bills['therapy-2026-12'].excluded, '');
});

test('reajuste de sessão recalcula pendentes e respeita exceções, preservando pagamentos', () => {
  const s = therapyState();
  run(s, rollover(s, '2026-11-01'));
  const november = s.bills['therapy-2026-11'];
  run(s, editBillOps(s, november, {...november, excluded: '2026-11-05'}));
  run(s, rollover(s, '2026-12-01'));
  s.bills['therapy-2026-12'].done = true;
  run(s, editBillOps(s, s.bills.therapy, {...therapy, unitAmount: 25000, excluded: '2026-10-29'}, 'future'));
  assert.equal(s.bills.therapy.amount, 100000);
  assert.equal(s.bills['therapy-2026-11'].amount, 75000);
  assert.equal(s.bills['therapy-2026-11'].excluded, '2026-11-05');
  assert.equal(s.bills['therapy-2026-12'].amount, 100000);
  assert.equal(s.bills['therapy-2026-12'].unitAmount, 20000);
  assert.equal(s.billRules.therapy.excluded, '');
  run(s, rollover(s, '2027-01-01'));
  assert.equal(s.bills['therapy-2027-01'].amount, 100000);
  assert.equal(s.bills['therapy-2027-01'].unitAmount, 25000);
});

test('catálogo calcula a próxima cobrança e mudar de modo não altera o histórico', () => {
  const s = therapyState();
  s.bills.therapy.done = true;
  let next = billCatalog(s, '2026-10')[0];
  assert.equal(next.month, '2026-11');
  assert.equal(next.amount, 80000);
  run(s, editBillOps(s, next, {...next, calcMode: 'fixed', amount: 12345}, 'future'));
  assert.equal(s.bills.therapy.calcMode, 'occurrence');
  assert.equal(s.bills.therapy.amount, 100000);
  run(s, rollover(s, '2026-12-01'));
  assert.equal(s.bills['therapy-2026-12'].amount, 12345);
  assert.equal(s.bills['therapy-2026-12'].calcMode, 'fixed');
});

test('formulário antigo de ocorrência real não reativa série encerrada a partir de outro mês', () => {
  const s = fixture();
  const october = {...s.bills['internet-2026-10']};
  const expectedRule = structuredClone(billRule(s, october));
  run(s, rollover(s, '2026-11-01'));
  run(s, deleteBillOps(s, s.bills['internet-2026-11'], 'future'));
  assert.equal(s.bills[october.id].skipped, undefined);
  assert.deepEqual(editBillOps(s, october, value, 'future', expectedRule), []);
  assert.equal(repeatingBills(s).length, 0);
  // A fresh form can still deliberately make a one-off bill recur.
  const freshRule = structuredClone(billRule(s, october));
  run(s, editBillOps(s, s.bills[october.id], value, 'one', freshRule));
  assert.equal(repeatingBills(s).length, 1);
});

test('mensal → bimestral → mensal restaura supressões de frequência e mantém exclusões explícitas', () => {
  const s = fixture();
  for (const month of ['2026-11', '2026-12', '2027-01']) run(s, rollover(s, `${month}-01`));
  run(s, deleteBillOps(s, s.bills['internet-2027-01']));
  run(s, editBillOps(s, s.bills['internet-2026-10'], {...value, every: 2}, 'future'));
  assert.equal(s.bills['internet-2026-11'].skipReason, 'frequency');
  run(s, editBillOps(s, s.bills['internet-2026-10'], value, 'future'));
  assert.equal(s.bills['internet-2026-11'].skipped, false);
  assert.equal(s.bills['internet-2026-11'].amount, 13990);
  assert.equal(s.bills['internet-2027-01'].skipped, true);
  assert.equal(s.bills['internet-2027-01'].skipReason, 'removed');
  assert.equal(scheduledBills(s, '2026-11', 1)[0].total, 13990);
});

test('desfazer exclusão futura de conta legada restaura defaults e a recorrência', () => {
  const s = fixture();
  delete s.bills.internet.repeat;
  delete s.bills['internet-2026-10'].repeat;
  const selected = s.bills['internet-2026-10'];
  const ops = deleteBillOps(s, selected, 'future');
  const undo = undoBillOps(s, selected, ops);
  run(s, ops);
  assert.equal(repeatingBills(s).length, 0);
  run(s, undo);
  assert.equal(repeatingBills(s).length, 1);
  assert.equal(s.billRules.internet.repeat, true);
  assert.equal(s.billRules.internet.every, 1);
  assert.equal(s.bills[selected.id].skipped, false);
  run(s, rollover(s, '2026-11-01'));
  assert.equal(s.bills['internet-2026-11'].amount, 11990);
});
