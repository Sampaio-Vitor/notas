export const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export function initialState() {
  return {sections: Object.fromEntries(['Pessoal','Acme','Globex','Initech'].map((name,i)=>[`s${i}`,{id:`s${i}`,name}])), tasks:{}, bills:{}, meetings:{}, days:{}, months:{}};
}
export function apply(state, op) {
  const {collection,id,patch}=op;
  // Patches affect only the edited fields; a deleted record stays deleted.
  if (state[collection][id]?.deleted && !patch.deleted) return state;
  state[collection][id]={...state[collection][id],...patch,id};
  return state;
}
export function rollover(state, date) {
  const ops=[];
  const add=(collection,id,patch)=>ops.push({collection,id,patch});
  if (!state.days[date]) {
    add('days',date,{date});
    const weekday=new Date(`${date}T12:00:00`).getDay();
    for (const m of Object.values(state.meetings).filter(m=>!m.deleted && m.weekday===weekday)) {
      add('tasks',`meeting-${m.id}-${date}`,{text:`${m.time} ${m.text}`,section:m.section,date,done:false,meeting:true});
    }
  }
  const month=date.slice(0,7);
  if (!state.months[month]) {
    add('months',month,{month});
    const previous=Object.keys(state.months).filter(m=>m<month).sort().at(-1);
    for (const b of Object.values(state.bills).filter(b=>!b.deleted && b.month===previous)) {
      add('bills',`${b.id.replace(/(?:-\d{4}-\d{2})+$/, '')}-${month}`,{text:b.text,amount:b.amount,group:b.group,month,done:false});
    }
  }
  return ops;
}
