// What the server accepts as an operation, from the app (POST /api/operations) or from an
// agent (MCP): the collection, the id, and each field's type and format. Server only.
import {RESERVED_IDS} from './public/model.js';

const billCalculation = {calcMode: 'string', unitAmount: 'number', weekdays: 'string', starts: 'string', excluded: 'string', lag: 'number'};
const schema = {
  sections: {name: 'string', order: 'number', deleted: 'boolean'},
  tasks: {text: 'string', section: 'string', date: 'string', time: 'string', end: 'string', done: 'boolean', repeat: 'string', from: 'string', meeting: 'boolean', deleted: 'boolean'},
  repeats: {text: 'string', section: 'string', time: 'string', end: 'string', days: 'string', monthDay: 'number', weeks: 'number', start: 'string', meeting: 'boolean', deleted: 'boolean'},
  bills: {text: 'string', amount: 'number', due: 'number', repeat: 'boolean', every: 'number', group: 'string', month: 'string', done: 'boolean', skipped: 'boolean', skipReason: 'string', deleted: 'boolean', ...billCalculation},
  billRules: {text: 'string', amount: 'number', due: 'number', repeat: 'boolean', every: 'number', month: 'string', ...billCalculation},
  meetings: {text: 'string', time: 'string', weekday: 'number', section: 'string', deleted: 'boolean'},
  days: {date: 'string', reviewed: 'boolean'},
  months: {month: 'string'},
  prefs: {reunioes: 'boolean', backlog: 'boolean', compras: 'boolean', contas: 'boolean'},
  // `cards` is written only by the server, from the finance app.
  cardLinks: {card: 'string'},
  shopping: {text: 'string', done: 'boolean', listed: 'boolean', added: 'number', by: 'string'},
};
// Field formats beyond the type check; time and a meeting's end are optional (empty string).
const clockTime = v => v === '' || /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
const formats = {
  time: clockTime, end: clockTime, days: v => /^[0-6]{0,7}$/.test(v),
  every: v => Number.isInteger(v) && v >= 1 && v <= 24, weeks: v => Number.isInteger(v) && v >= 1 && v <= 8, monthDay: v => Number.isInteger(v) && v <= 31, due: v => Number.isInteger(v) && v <= 31,
  month: v => /^\d{4}-(0[1-9]|1[0-2])$/.test(v),
  calcMode: v => ['fixed', 'occurrence'].includes(v),
  lag: v => v === 0 || v === 1,
  skipReason: v => ['', 'frequency', 'removed'].includes(v),
  unitAmount: v => Number.isSafeInteger(v) && v <= 100000000,
  weekdays: v => /^[0-6]{0,7}$/.test(v) && new Set(v).size === v.length,
  starts: v => v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v),
  excluded: v => v === '' || (v.split(',').length <= 31 && v.split(',').every(date => /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(date))),
  start: v => formats.date(v),
  date: v => v === '' || (/^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(`${v}T12:00:00Z`)) && new Date(`${v}T12:00:00Z`).toISOString().slice(0, 10) === v),
  order: v => Number.isInteger(v), weekday: v => Number.isInteger(v) && v <= 6,
  card: v => /^\d{0,18}$/.test(v),
};
export function validate(op) {
  if (!op || typeof op.opId !== 'string' || op.opId.length > 100 || !Object.hasOwn(schema, op.collection)) return false;
  if (typeof op.id !== 'string' || op.id.length > 200 || RESERVED_IDS.includes(op.id)) return false;
  if (!op.patch || typeof op.patch !== 'object' || Array.isArray(op.patch)) return false;
  if (op.batchId !== undefined && (typeof op.batchId !== 'string' || op.batchId.length > 100)) return false;
  if (['expectedBill', 'expectedBillRule'].some(k => op[k] !== undefined && (typeof op[k] !== 'string' || op[k].length > 20000 || !['bills', 'billRules'].includes(op.collection)))) return false;
  return Object.entries(op.patch).every(([k, v]) => Object.hasOwn(schema[op.collection], k) && typeof v === schema[op.collection][k]
    && (typeof v !== 'string' || v.length <= 10000) && (typeof v !== 'number' || (Number.isFinite(v) && v >= 0)) && (!formats[k] || formats[k](v)));
}
