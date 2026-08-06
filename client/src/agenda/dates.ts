/* Utilidades de data — o núcleo puro vive em shared/ (compartilhado com o
   servidor); aqui ficam apenas os complementos de UI. */
export * from '../../../shared/dates';

export const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
export const MES3 = ['jan','fev','mar','abr','mai','jun','jul','ago','set','out','nov','dez'];
export const DIAS = ['domingo','segunda-feira','terça-feira','quarta-feira','quinta-feira','sexta-feira','sábado'];
export const DIA3 = ['dom','seg','ter','qua','qui','sex','sáb'];
export const DIA1 = ['D','S','T','Q','Q','S','S'];

export const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
export const isWeekend = (d: Date) => d.getDay() === 0 || d.getDay() === 6;
