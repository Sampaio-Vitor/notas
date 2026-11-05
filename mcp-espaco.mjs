// MCP tools that reach one person's space: tasks and bills. Only for an agent whose token names
// the space (MCP_TOKENS="robo:<token>:ana"); the space comes from the token, never from an
// argument. Pure functions: the state goes in, the result and the operations to commit come out.
import {createHash} from 'node:crypto';
import {live, sortedSections, occurrenceId, overdueTasks, scheduledTasks, itemKey, linkedCard, tasksForDay, meetingEnd, shiftMonth, own, RESERVED_IDS, billDueDate, monthBills} from './public/model.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/, MONTH = /^\d{4}-(0[1-9]|1[0-2])$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const money = n => new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'}).format((n || 0) / 100).replace(/ /g, ' ');
const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const validDate = s => {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`); // month 13 or 00 is an invalid Date: toISOString would throw
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const quandoArg = {type: 'string', description: '"hoje", "amanha", "backlog" ou uma data AAAA-MM-DD.'};
export const SPACE_TOOLS = [
  {name: 'tarefas_dia', title: 'Tarefas de um dia',
    description: 'As tarefas de um dia (padrão: hoje), por seção, na ordem das seções. Inclui as que as repetições vão criar nesse dia. Cada tarefa traz id, texto, feita, horario e repete.',
    inputSchema: {type: 'object', properties: {data: {type: 'string', description: 'AAAA-MM-DD; sem ela, hoje.'}}}, annotations: {readOnlyHint: true}},
  {name: 'tarefas_backlog', title: 'Backlog e o que ficou para trás',
    description: 'O backlog por seção, as tarefas que ficaram para trás (de dias passados, não feitas) e as agendadas para os próximos dias.',
    inputSchema: {type: 'object', properties: {}}, annotations: {readOnlyHint: true}},
  {name: 'tarefa_criar', title: 'Criar tarefa',
    description: 'Cria uma tarefa. "quando": hoje, amanha, backlog ou AAAA-MM-DD. "secao" pelo nome (maiúsculas e acentos não importam); sem ela, a primeira seção; se não existir, o erro traz as seções. "horario" (HH:MM) só se a pessoa disse um, e só com dia: tarefa no backlog não tem horário. "chave": um identificador único deste pedido; repetir a chamada com a mesma chave (depois de um erro de rede, por exemplo) devolve a tarefa já criada, com repetida=true, em vez de criar outra. Devolve o id.',
    inputSchema: {type: 'object', properties: {texto: {type: 'string', minLength: 1, maxLength: 500}, quando: quandoArg, secao: {type: 'string', maxLength: 100}, horario: {type: 'string', description: 'HH:MM; não vale com quando=backlog.'}, chave: {type: 'string', minLength: 1, maxLength: 200, description: 'Opcional. Chave de idempotência: a mesma chave cria a tarefa uma vez só.'}}, required: ['texto', 'quando']},
    annotations: {readOnlyHint: false, destructiveHint: false}},
  {name: 'tarefa_concluir', title: 'Concluir tarefa',
    description: 'Marca uma tarefa como feita (ou desmarca, com feita=false), pelo id que tarefas_dia ou tarefas_backlog devolveu. Uma ocorrência de repetição ainda não gravada é gravada antes, como no app.',
    inputSchema: {type: 'object', properties: {id: {type: 'string', minLength: 1, maxLength: 200}, feita: {type: 'boolean'}}, required: ['id']},
    annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true}},
  {name: 'tarefa_mover', title: 'Mover tarefa',
    description: 'Move uma tarefa para hoje, amanha, o backlog ou outra data (AAAA-MM-DD). Uma ocorrência de repetição movida para outro dia sai da repetição, sem apagá-la; mover para o dia em que ela já está não muda nada. Uma tarefa de um dia passado trazida para hoje ou depois volta a não estar feita.',
    inputSchema: {type: 'object', properties: {id: {type: 'string', minLength: 1, maxLength: 200}, quando: quandoArg}, required: ['id', 'quando']},
    annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true}},
  {name: 'contas_mes', title: 'Contas do mês',
    description: 'As contas de um mês (AAAA-MM; padrão: o atual): nome, valor em centavos e em texto, dia do vencimento, paga, prevista (num mês futuro, a que a repetição ainda vai criar; uma conta já gravada nunca é prevista) e o cartão, quando é fatura.',
    inputSchema: {type: 'object', properties: {mes: {type: 'string', description: 'AAAA-MM'}}}, annotations: {readOnlyHint: true}},
  {name: 'contas_proximas', title: 'Contas que vencem logo',
    description: 'As contas não pagas que vencem nos próximos dias (padrão 7, até 60), incluindo as atrasadas, da mais antiga para a mais nova. vence_em é a data (dia 31 num mês de 30 dias vence no dia 30). Conta sem dia de vencimento vence no último dia do mês dela e, como no app, nunca sai como atrasada.',
    inputSchema: {type: 'object', properties: {dias: {type: 'integer', minimum: 1, maximum: 60}}}, annotations: {readOnlyHint: true}},
];
export const SPACE_TOOL_NAMES = new Set(SPACE_TOOLS.map(t => t.name));

function sectionNames(state) { return sortedSections(state).map(s => s.name); }
const liveSection = (state, id) => { const s = own(state.sections, id); return s && !s.deleted ? s : undefined; };
const sectionName = (state, id) => liveSection(state, id)?.name || 'Sem seção';
const taskOut = (state, t) => ({id: t.id, texto: t.text, secao: sectionName(state, t.section), feita: !!t.done, horario: t.time || null, repete: !!t.repeat});
const byTime = list => [...list].sort((a, b) => (a.time ? 0 : 1) - (b.time ? 0 : 1) || (a.time || '').localeCompare(b.time || ''));

function bySection(state, tasks) {
  const groups = [];
  const order = [...sortedSections(state).map(s => s.id), ...new Set(tasks.map(t => t.section).filter(id => !liveSection(state, id)))];
  for (const id of order) {
    const list = byTime(tasks.filter(t => t.section === id));
    if (list.length) groups.push({secao: sectionName(state, id), tarefas: list.map(t => taskOut(state, t))});
  }
  return groups;
}

function resolveDate(quando, today) {
  const q = itemKey(typeof quando === 'string' ? quando : '');
  if (q === 'hoje') return today;
  if (q === 'amanha') return addDays(today, 1);
  if (q === 'backlog') return '';
  if (validDate(String(quando).trim())) return String(quando).trim();
  throw Error('quando deve ser "hoje", "amanha", "backlog" ou uma data AAAA-MM-DD');
}

// The stored task, or the occurrence a repeat will create on a day not opened yet. Only the
// state's own records count: "constructor" or "toString" is no task.
function findTask(state, id) {
  if (typeof id !== 'string' || !id) throw Error('id da tarefa faltando');
  if (RESERVED_IDS.includes(id)) throw Error(`"${id}" não é um id de tarefa; peça a lista de novo (tarefas_dia ou tarefas_backlog)`);
  const stored = own(state.tasks, id);
  if (stored && !stored.deleted) return {task: {...stored, id}, shown: false};
  const m = /^r-(.+)-(\d{4}-\d{2}-\d{2})$/.exec(id);
  const shown = m && tasksForDay(state, m[2]).find(t => t.id === id && t.id === occurrenceId(m[1], m[2]));
  if (shown) return {task: shown, shown: true};
  throw Error('tarefa não encontrada; peça a lista de novo (tarefas_dia ou tarefas_backlog)');
}

// Only a projection is `prevista`; a bill already stored in a future month is a real one.
function billOut(state, b) {
  const card = linkedCard(state, b);
  return {id: b.id, nome: b.text, valor_centavos: b.amount || 0, valor: money(b.amount), vencimento: b.due || null, paga: !!b.done, prevista: !!b.virtual, ...(card ? {cartao: card.name || card.id} : {})};
}

// A task created with an idempotency key gets an id derived from the agent and the key, so a
// repeated call finds it instead of creating another one.
const keyedId = (agent, key) => `k-${createHash('sha256').update(`${agent}\n${key}`).digest('hex').slice(0, 32)}`;
const createdOut = (state, t) => ({id: t.id, texto: t.text, secao: sectionName(state, t.section), data: t.date || 'backlog', horario: t.time || null});

export function spaceTool(state, name, args, today, newId, agent = '') {
  if (name === 'tarefas_dia') {
    const date = args.data === undefined ? today : String(args.data);
    if (!validDate(date)) throw Error('data deve ser AAAA-MM-DD');
    return {result: {data: date, secoes: bySection(state, tasksForDay(state, date))}, ops: []};
  }
  if (name === 'tarefas_backlog') {
    const withDate = t => ({...taskOut(state, t), data: t.date});
    return {result: {
      backlog: bySection(state, live(state, 'tasks').filter(t => t.date === '')),
      ficaram_para_tras: overdueTasks(state, today).map(withDate),
      agendadas: scheduledTasks(state, today).map(withDate),
    }, ops: []};
  }
  if (name === 'tarefa_criar') {
    const text = typeof args.texto === 'string' ? args.texto.trim().replace(/\s+/g, ' ') : '';
    if (!text || text.length > 500) throw Error('texto deve ter de 1 a 500 caracteres');
    const date = resolveDate(args.quando, today);
    const sections = sortedSections(state);
    if (!sections.length) throw Error('não há seções no Notas');
    let section = sections[0];
    if (args.secao !== undefined && args.secao !== '') {
      section = sections.find(s => itemKey(s.name) === itemKey(args.secao));
      if (!section) throw Error(`a seção "${args.secao}" não existe; as seções são: ${sectionNames(state).join(', ')}`);
    }
    const time = args.horario === undefined || args.horario === '' ? '' : String(args.horario);
    if (time && !TIME.test(time)) throw Error('horario deve ser HH:MM');
    // As in the app's form: a task in the backlog has no day, so no time either.
    if (time && !date) throw Error('tarefa no backlog não tem horário; tire o horario ou escolha um dia em quando');
    let id;
    if (args.chave !== undefined) {
      if (typeof args.chave !== 'string' || !args.chave.trim() || args.chave.length > 200) throw Error('chave deve ter de 1 a 200 caracteres');
      id = keyedId(agent, args.chave);
      const before = own(state.tasks, id);
      if (before) {
        if (before.text !== text) throw Error(`a chave "${args.chave}" já criou outra tarefa ("${before.text}"); use uma chave nova para cada tarefa`);
        return {result: {...createdOut(state, {...before, id}), repetida: true, ...(before.deleted ? {apagada: true} : {})}, ops: []};
      }
    } else id = newId();
    const patch = {text, section: section.id, time, end: time ? meetingEnd({time}) : '', meeting: false, repeat: '', date, done: false};
    return {result: createdOut(state, {...patch, id}), ops: [{collection: 'tasks', id, patch}]};
  }
  if (name === 'tarefa_concluir') {
    const {task, shown} = findTask(state, args.id);
    const done = args.feita === undefined ? true : args.feita === true;
    if (args.feita !== undefined && typeof args.feita !== 'boolean') throw Error('feita deve ser true ou false');
    const {id, ...fields} = task;
    const ops = !!task.done === done && !shown ? [] : [{collection: 'tasks', id, patch: shown ? {...fields, done} : {done}}];
    return {result: {id, texto: task.text, feita: done}, ops};
  }
  if (name === 'tarefa_mover') {
    const {task, shown} = findTask(state, args.id);
    const date = resolveDate(args.quando, today);
    const {id, ...fields} = task;
    // Already on that day: nothing changes, and an occurrence stays in its repeat (as in the app).
    if (task.date === date) return {result: {id, texto: task.text, data: date || 'backlog'}, ops: []};
    // As in the app (moveToDay): a repeat's occurrence leaves the repeat behind, and a task brought
    // from an earlier day to today or later starts over as not done.
    // To the backlog, the time goes too (the app's form clears it, and tarefa_criar refuses a time
    // in the backlog): otherwise a 15:00 meeting dragged back to a day would land in the agenda.
    const patch = {date, ...(task.repeat ? {repeat: ''} : {}), ...(task.date < today && date >= today ? {done: false} : {}),
      ...(date === '' && (task.time || task.end) ? {time: '', end: ''} : {})};
    return {result: {id, texto: task.text, data: date || 'backlog'}, ops: [{collection: 'tasks', id, patch: shown ? {...fields, ...patch} : patch}]};
  }
  if (name === 'contas_mes') {
    const current = today.slice(0, 7);
    const month = args.mes === undefined ? current : String(args.mes);
    if (!MONTH.test(month)) throw Error('mes deve ser AAAA-MM');
    const {real, projected} = monthBills(state, month, current);
    const contas = [...real, ...projected].sort((a, b) => (a.due || 99) - (b.due || 99) || a.text.localeCompare(b.text, 'pt-BR')).map(b => billOut(state, b));
    const aPagar = contas.filter(c => !c.paga).reduce((n, c) => n + c.valor_centavos, 0);
    return {result: {mes: month, contas, a_pagar_centavos: aPagar, a_pagar: money(aPagar)}, ops: []};
  }
  if (name === 'contas_proximas') {
    const days = args.dias === undefined ? 7 : args.dias;
    if (!Number.isInteger(days) || days < 1 || days > 60) throw Error('dias deve ser um inteiro de 1 a 60');
    const until = addDays(today, days), current = today.slice(0, 7), last = until.slice(0, 7);
    const real = live(state, 'bills').filter(b => !b.done && b.month <= last);
    const projected = [];
    for (let m = shiftMonth(current, 1); m <= last; m = shiftMonth(m, 1)) projected.push(...monthBills(state, m, current).projected);
    // The due day is held to the month's last day; a bill without one falls due on that last day
    // and, as in the app, is never late.
    const contas = [...real, ...projected]
      .map(b => ({b, due: billDueDate(b)}))
      .filter(({due}) => due <= until)
      .sort((x, y) => x.due.localeCompare(y.due) || x.b.text.localeCompare(y.b.text, 'pt-BR'))
      .map(({b, due}) => ({...billOut(state, b), vence_em: due, atrasada: !!b.due && due < today}));
    return {result: {hoje: today, ate: until, contas}, ops: []};
  }
  throw Error(`ferramenta desconhecida: ${name}`);
}
