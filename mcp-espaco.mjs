// MCP tools that reach one person's space: tasks and bills. Only for an agent whose token names
// the space (MCP_TOKENS="robo:<token>:ana"); the space comes from the token, never from an
// argument. Pure functions: the state goes in, the result and the operations to commit come out.
import {createHash} from 'node:crypto';
import {live, sortedSections, origin, occurrenceId, repeatsOn, weekday, toMinutes, fromMinutes, overdueTasks, scheduledTasks, itemKey, linkedCard, tasksForDay, meetingEnd, shiftMonth, own, RESERVED_IDS, billDueDate, monthBills, taskSteps, taskDoneOps} from './public/model.js';

const DATE = /^\d{4}-\d{2}-\d{2}$/, MONTH = /^\d{4}-(0[1-9]|1[0-2])$/, TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const money = n => new Intl.NumberFormat('pt-BR', {style: 'currency', currency: 'BRL'}).format((n || 0) / 100).replace(/ /g, ' ');
const addDays = (date, n) => { const d = new Date(`${date}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const validDate = s => {
  if (!DATE.test(s)) return false;
  const d = new Date(`${s}T12:00:00Z`); // month 13 or 00 is an invalid Date: toISOString would throw
  return Number.isFinite(d.getTime()) && d.toISOString().slice(0, 10) === s;
};

const quandoArg = {type: 'string', description: '"hoje", "amanha", "backlog" ou uma data AAAA-MM-DD.'};
const fimArg = {type: 'string', description: 'HH:MM, depois do horario; só com horario. Sem ele, 30 minutos depois.'};
const reuniaoArg = {type: 'boolean', description: 'true: é uma reunião (aparece na Agenda do app). Só com dia.'};
const RULES = ['diaria', 'dias_uteis', 'semanal', 'quinzenal', 'mensal'];
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sab'];
const repetirArg = stop => ({type: 'object', description: `Repetição. regra: diaria (todo dia), dias_uteis (seg a sex), semanal (nos "dias"), quinzenal (a cada 2 semanas, nos "dias", contando da primeira ocorrência), mensal (no "dia_do_mes")${stop ? ' ou nao (para de repetir)' : ''}. Sem "dias", o dia da semana da tarefa; sem "dia_do_mes", o dia do mês dela. Ex.: {"regra": "semanal", "dias": ["seg", "qua"]}.`,
  properties: {regra: {type: 'string', enum: stop ? [...RULES, 'nao'] : RULES}, dias: {type: 'array', items: {type: 'string', enum: WEEKDAYS}, minItems: 1, maxItems: 7}, dia_do_mes: {type: 'integer', minimum: 1, maximum: 31}}, required: ['regra']});
export const SPACE_TOOLS = [
  {name: 'tarefas_dia', title: 'Tarefas de um dia',
    description: 'As tarefas de um dia (padrão: hoje), por seção, na ordem das seções. Inclui as que as repetições vão criar nesse dia. Cada tarefa traz id, texto, feita, horario e repete; a que tem passos (checklist dentro da tarefa) traz passos, com texto e feito.',
    inputSchema: {type: 'object', properties: {data: {type: 'string', description: 'AAAA-MM-DD; sem ela, hoje.'}}}, annotations: {readOnlyHint: true}},
  {name: 'tarefas_backlog', title: 'Backlog e o que ficou para trás',
    description: 'O backlog por seção, as tarefas que ficaram para trás (de dias passados, não feitas) e as agendadas para os próximos dias.',
    inputSchema: {type: 'object', properties: {}}, annotations: {readOnlyHint: true}},
  {name: 'tarefa_criar', title: 'Criar tarefa',
    description: 'Cria uma tarefa ou reunião, que pode se repetir. "quando": hoje, amanha, backlog ou AAAA-MM-DD. "secao" pelo nome (maiúsculas e acentos não importam); sem ela, a primeira seção; se não existir, o erro traz as seções. "horario" (HH:MM) só se a pessoa disse um, e só com dia: tarefa no backlog não tem horário. "fim" (HH:MM) é o fim da reunião; sem ele, 30 minutos depois do horario. "reuniao": true para reunião (vai para a Agenda do app), só com dia. "repetir": a regra de repetição, que começa no dia de "quando" (hoje ou depois); veja o campo. "chave": um identificador único deste pedido; repetir a chamada com a mesma chave (depois de um erro de rede, por exemplo) devolve a tarefa já criada, com repetida=true, em vez de criar outra. Devolve o id; com repetição, o id da primeira ocorrência e a regra em "repete".',
    inputSchema: {type: 'object', properties: {texto: {type: 'string', minLength: 1, maxLength: 500}, quando: quandoArg, secao: {type: 'string', maxLength: 100}, horario: {type: 'string', description: 'HH:MM; não vale com quando=backlog.'}, fim: fimArg, reuniao: reuniaoArg, repetir: repetirArg(false), chave: {type: 'string', minLength: 1, maxLength: 200, description: 'Opcional. Chave de idempotência: a mesma chave cria a tarefa uma vez só.'}}, required: ['texto', 'quando']},
    annotations: {readOnlyHint: false, destructiveHint: false}},
  {name: 'tarefa_editar', title: 'Editar tarefa',
    description: 'Muda uma tarefa pelo id que tarefas_dia ou tarefas_backlog devolveu: texto, secao, horario, fim, reuniao e repetir. Só os campos enviados mudam; o dia muda pelo tarefa_mover. horario "" tira o horário. Numa ocorrência de repetição, a mudança vale para a repetição inteira, como no app. "repetir" com uma regra faz a tarefa se repetir a partir do dia dela (ou troca a regra); {"regra": "nao"} para de repetir e deixa esta ocorrência como tarefa avulsa.',
    inputSchema: {type: 'object', properties: {id: {type: 'string', minLength: 1, maxLength: 200}, texto: {type: 'string', minLength: 1, maxLength: 500}, secao: {type: 'string', maxLength: 100}, horario: {type: 'string', description: 'HH:MM, ou "" para tirar.'}, fim: fimArg, reuniao: reuniaoArg, repetir: repetirArg(true)}, required: ['id']},
    annotations: {readOnlyHint: false, destructiveHint: false, idempotentHint: true}},
  {name: 'tarefa_concluir', title: 'Concluir tarefa',
    description: 'Marca uma tarefa como feita (ou desmarca, com feita=false), pelo id que tarefas_dia ou tarefas_backlog devolveu. Marcar como feita marca também os passos que faltavam, como no app. Uma ocorrência de repetição ainda não gravada é gravada antes, como no app.',
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
const taskOut = (state, t) => {
  const steps = taskSteps(state, t);
  return {id: t.id, texto: t.text, secao: sectionName(state, t.section), feita: !!t.done, horario: t.time || null, ...timing(t), repete: !!t.repeat, ...(steps.length ? {passos: steps.map(s => ({texto: s.text, feito: !!s.done}))} : {})};
};
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
// As the app shows it: the end only for a meeting or a task with one.
const timing = t => ({...(t.meeting ? {reuniao: true} : {}), ...(t.time && (t.meeting || t.end) ? {fim: meetingEnd(t)} : {})});
const createdOut = (state, t) => ({id: t.id, texto: t.text, secao: sectionName(state, t.section), data: t.date || 'backlog', horario: t.time || null, ...timing(t)});

function findSection(state, name) {
  const sections = sortedSections(state);
  if (!sections.length) throw Error('não há seções no Notas');
  if (name === undefined || name === '') return sections[0];
  const section = sections.find(s => itemKey(s.name) === itemKey(name));
  if (!section) throw Error(`a seção "${name}" não existe; as seções são: ${sectionNames(state).join(', ')}`);
  return section;
}

function checkTime(value, field) {
  const v = value === undefined || value === null ? '' : String(value);
  if (v && !TIME.test(v)) throw Error(`${field} deve ser HH:MM`);
  return v;
}
function endFor(time, fim) {
  if (!time) { if (fim) throw Error('fim só vale com horario'); return ''; }
  if (fim && fim <= time) throw Error('fim precisa ser depois do horario');
  return fim || meetingEnd({time});
}

// The rule's fields in a repeat (the app's form: days as weekday digits, Sunday 0; weeks 2 for
// every other week, counted from the first occurrence on a chosen day; monthDay for monthly).
function repeatRule(arg, date) {
  if (typeof arg !== 'object' || arg === null || Array.isArray(arg)) throw Error('repetir deve ser um objeto, como {"regra": "semanal", "dias": ["seg"]}');
  const rule = itemKey(arg.regra || '').replace(/[\s-]+/g, '_');
  if (!RULES.includes(rule)) throw Error(`repetir.regra deve ser: ${RULES.join(', ')}`);
  if (rule === 'mensal') {
    const day = arg.dia_do_mes === undefined ? Number(date.slice(8, 10)) : arg.dia_do_mes;
    if (!Number.isInteger(day) || day < 1 || day > 31) throw Error('repetir.dia_do_mes deve ser de 1 a 31');
    return {days: '', monthDay: day, weeks: 1, start: date};
  }
  let days = {diaria: '0123456', dias_uteis: '12345'}[rule];
  if (!days) {
    if (arg.dias === undefined) days = String(weekday(date));
    else {
      if (!Array.isArray(arg.dias) || !arg.dias.length) throw Error('repetir.dias deve ser uma lista, como ["seg", "qua"]');
      const set = new Set(arg.dias.map(d => {
        const i = WEEKDAYS.indexOf(itemKey(d).slice(0, 3));
        if (i < 0) throw Error(`dia da semana inválido: "${d}"; use ${WEEKDAYS.join(', ')}`);
        return String(i);
      }));
      days = [...set].sort().join('');
    }
  }
  let start = date;
  // Every other week counts from the first chosen weekday on or after the date, as in the app.
  if (rule === 'quinzenal') while (!days.includes(String(weekday(start)))) start = addDays(start, 1);
  return {days, monthDay: 0, weeks: rule === 'quinzenal' ? 2 : 1, start};
}

const DAY_NAMES = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
function ruleLabel(r) {
  if (r.monthDay > 0) return `todo mês, dia ${r.monthDay}`;
  const names = [...String(r.days)].map(d => DAY_NAMES[d]).join(', ');
  if (r.weeks > 1) return `a cada 2 semanas (${names})`;
  if (r.days === '0123456') return 'todo dia';
  if (r.days === '12345') return 'dias úteis';
  return `toda semana (${names})`;
}
function nextOn(template, from) {
  for (let i = 0; i <= 400; i++) { const d = addDays(from, i); if (repeatsOn(template, d)) return d; }
  return '';
}
const cleanText = value => {
  const text = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!text || text.length > 500) throw Error('texto deve ter de 1 a 500 caracteres');
  return text;
};
// A repeat just created: the id of its first occurrence (from the chosen day on) and the rule.
function createdRepeat(state, rid, template, date) {
  const first = nextOn(template, date);
  return {...createdOut(state, {...template, id: first ? occurrenceId(rid, first) : '', date: first || date}), repete: ruleLabel(template), repeticao: rid};
}
const liveRepeat = (state, id) => { const r = own(state.repeats, id); return r && !r.deleted ? r : undefined; };

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
    const text = cleanText(args.texto);
    const date = resolveDate(args.quando, today);
    const section = findSection(state, args.secao);
    const time = checkTime(args.horario, 'horario'), fim = checkTime(args.fim, 'fim');
    // As in the app's form: a task in the backlog has no day, so no time, meeting or repeat either.
    if (time && !date) throw Error('tarefa no backlog não tem horário; tire o horario ou escolha um dia em quando');
    if (!date && (args.reuniao === true || args.repetir !== undefined)) throw Error('reunião e repetição precisam de um dia em quando, não backlog');
    if (args.reuniao !== undefined && typeof args.reuniao !== 'boolean') throw Error('reuniao deve ser true ou false');
    const end = endFor(time, fim), meeting = args.reuniao === true;
    const rule = args.repetir === undefined || args.repetir === null ? null : repeatRule(args.repetir, date);
    if (rule && date < today) throw Error('a repetição começa hoje ou depois; escolha outro dia em quando');
    let id;
    if (args.chave !== undefined) {
      if (typeof args.chave !== 'string' || !args.chave.trim() || args.chave.length > 200) throw Error('chave deve ter de 1 a 200 caracteres');
      id = keyedId(agent, args.chave);
      const before = own(rule ? state.repeats : state.tasks, id);
      if (before) {
        if (before.text !== text) throw Error(`a chave "${args.chave}" já criou outra tarefa ("${before.text}"); use uma chave nova para cada tarefa`);
        const out = rule ? createdRepeat(state, id, before, date) : createdOut(state, {...before, id});
        return {result: {...out, repetida: true, ...(before.deleted ? {apagada: true} : {})}, ops: []};
      }
    } else id = newId();
    const fields = {text, section: section.id, time, end, meeting};
    if (rule) {
      // The repeat creates each day's task; the first one is written now when it falls on that day.
      const template = {...fields, ...rule};
      const ops = [{collection: 'repeats', id, patch: template}];
      if (repeatsOn(template, date)) ops.push({collection: 'tasks', id: occurrenceId(id, date), patch: {...fields, repeat: id, date, done: false}});
      return {result: createdRepeat(state, id, template, date), ops};
    }
    const patch = {...fields, repeat: '', date, done: false};
    return {result: createdOut(state, {...patch, id}), ops: [{collection: 'tasks', id, patch}]};
  }
  if (name === 'tarefa_editar') {
    const {task, shown} = findTask(state, args.id);
    const {id, ...stored} = task;
    const date = task.date;
    const text = args.texto === undefined ? task.text : cleanText(args.texto);
    const section = args.secao === undefined ? task.section : findSection(state, args.secao).id;
    if (args.reuniao !== undefined && typeof args.reuniao !== 'boolean') throw Error('reuniao deve ser true ou false');
    const meeting = args.reuniao === undefined ? !!task.meeting : args.reuniao;
    const time = args.horario === undefined ? task.time || '' : checkTime(args.horario, 'horario');
    let fim = args.fim === undefined ? '' : checkTime(args.fim, 'fim');
    // A new start keeps the length the meeting had, as in the app's form.
    if (!fim && args.horario !== undefined && time && task.time && task.end > task.time)
      fim = fromMinutes(Math.min(toMinutes(time) + toMinutes(task.end) - toMinutes(task.time), 23 * 60 + 59));
    else if (!fim && args.horario === undefined && time) fim = task.end && task.end > time ? task.end : '';
    const end = endFor(time, fim);
    const stop = args.repetir && typeof args.repetir === 'object' && itemKey(args.repetir.regra || '') === 'nao';
    if (!date && (time || meeting || (args.repetir !== undefined && !stop))) throw Error('tarefa no backlog não tem horário, reunião nem repetição; mova para um dia com tarefa_mover antes');
    const fields = {text, section, time, end, meeting};
    const current = task.repeat ? liveRepeat(state, task.repeat) : undefined;
    const ops = [];
    let outId = id, repeat = current ? {...current, id: task.repeat} : null, taskPatch = {...fields};
    if (stop) {
      if (current) ops.push({collection: 'repeats', id: task.repeat, patch: {deleted: true}});
      taskPatch.repeat = '';
      repeat = null;
    } else if (args.repetir !== undefined && args.repetir !== null) {
      const rule = repeatRule(args.repetir, date);
      if (!current && date < today) throw Error('tarefa de um dia passado não começa a se repetir; mova para hoje ou depois com tarefa_mover');
      const rid = current ? task.repeat : newId();
      // A rule changed on a series keeps where it started, unless every other week needs a new anchor.
      const start = current && rule.weeks === 1 ? current.start || '' : rule.start;
      repeat = {...fields, ...rule, start, id: rid};
      ops.push({collection: 'repeats', id: rid, patch: {...fields, ...rule, start}});
      taskPatch.repeat = rid;
      // A day not opened yet shows the repeat's occurrence by its own id: the task becomes that
      // occurrence (with its steps), or else the day would show it twice.
      if (!current && !state.days?.[date]) {
        const occ = occurrenceId(rid, date);
        if (repeatsOn(repeat, date)) {
          ops.push({collection: 'tasks', id, patch: {deleted: true}});
          ops.push({collection: 'tasks', id: occ, patch: {...fields, repeat: rid, date, done: !!task.done}});
          if (origin(task) === id) for (const st of taskSteps(state, task)) ops.push({collection: 'steps', id: st.id, patch: {task: occ}});
          outId = occ;
          taskPatch = null;
        } else taskPatch.repeat = '';
      }
    } else if (current) {
      // Editing an occurrence edits the repeat too, as in the app.
      ops.push({collection: 'repeats', id: task.repeat, patch: fields});
      repeat = {...repeat, ...fields};
    }
    if (taskPatch) ops.push({collection: 'tasks', id, patch: shown ? {...stored, ...taskPatch} : taskPatch});
    const out = {...createdOut(state, {...fields, id: outId, date}), ...(repeat ? {repete: ruleLabel(repeat)} : {})};
    return {result: out, ops};
  }
  if (name === 'tarefa_concluir') {
    const {task, shown} = findTask(state, args.id);
    const done = args.feita === undefined ? true : args.feita === true;
    if (args.feita !== undefined && typeof args.feita !== 'boolean') throw Error('feita deve ser true ou false');
    const {id, ...fields} = task;
    const ops = !!task.done === done && !shown ? [] : shown ? [{collection: 'tasks', id, patch: {...fields, done}}] : taskDoneOps(state, task, done);
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
