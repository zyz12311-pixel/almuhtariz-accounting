import {nowRiyadh} from './lib.js';
export function validDate(value){const date=String(value||'');if(!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(Date.parse(date+'T00:00:00Z'))||new Date(date+'T00:00:00Z').toISOString().slice(0,10)!==date||date>nowRiyadh().date)throw Error('حدد تاريخًا صحيحًا لا يتجاوز اليوم');return date;}
