// Escala semanal (5x2, semanas A/B alternadas): horários por dia, cobertura e conferências legais
export const DIAS = [[1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb']];
export const FUNCIONAMENTO = { 1: [420, 1200], 2: [420, 1200], 3: [420, 1200], 4: [420, 1200], 5: [420, 1200], 6: [570, 930] }; // 7h–20h; sáb 9h30–15h30
export const REF_PADRAO = '2027-01-04'; // segunda-feira da 1ª semana A
export const DESDE_PADRAO = '2027-01-01';
export const LIMITE_SEMANA = 44 * 60, LIMITE_DIA = 10 * 60;

const p2 = (n) => String(n).padStart(2, '0');
export const hm = (s) => { const [h, m] = String(s || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
export const mh = (min) => `${p2(Math.floor(min / 60))}:${p2(Math.round(min % 60))}`;
export const fmtH = (min) => `${Math.floor(min / 60)}h${p2(Math.round(min % 60))}`;

// ----- datas -----
const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export const dow = (iso) => new Date(iso + 'T12:00:00').getDay();
export const segundaDe = (iso) => addDias(iso, -((dow(iso) + 6) % 7));
export const sabadoDe = (iso) => addDias(segundaDe(iso), 5); // semana de segunda a sábado
export { addDias };
export function sabadosDoAno(ano) {
  const out = []; let d = `${ano}-01-01`;
  while (dow(d) !== 6) d = addDias(d, 1);
  while (d.startsWith(String(ano))) { out.push(d); d = addDias(d, 7); }
  return out;
}

// ----- modelos de semana de cada pessoa: "sem" (sem sábado) e "com" (semana em que trabalha no sábado) -----
export const trabalhaSabado = (id, sab, sabados) => ((sabados || {})[sab] || []).includes(id);
export const modeloDaSemana = (p, iso, sabados) => ((p.escala || {})[trabalhaSabado(p.id, sabadoDe(iso), sabados) ? 'com' : 'sem']) || {};

// turno de um dia: {e, s, ai, a} em minutos (entrada, saída, início do almoço, duração do almoço)
export function turno(c) {
  if (!c || c.folga) return null;
  const e = hm(c.e), s = hm(c.s);
  if (e == null || s == null || s <= e) return null;
  const a = Number(c.a) || 0, ai = a ? (hm(c.ai) ?? e + Math.round((s - e) / 2) - Math.round(a / 2)) : null;
  return { e, s, a, ai, trab: Math.max(0, s - e - a) };
}
export const turnoNoDia = (p, iso, sabados) => turno(modeloDaSemana(p, iso, sabados)[dow(iso)]);

const presente = (t, m) => t && m >= t.e && m < t.s && !(t.a && m >= t.ai && m < t.ai + t.a);

// cobertura de um dia: por faixa de 15 min, quantos no total e quantos atendentes (caixa)
export function cobertura(pessoas, iso, sabados) {
  const d = dow(iso); if (!FUNCIONAMENTO[d]) return [];
  const [ini, fim] = FUNCIONAMENTO[d], ts = pessoas.map((p) => ({ p, t: turnoNoDia(p, iso, sabados) })), fatias = [];
  for (let m = ini; m < fim; m += 15) {
    let tot = 0, at = 0;
    for (const { p, t } of ts) if (presente(t, m)) { tot++; if (p.atende) at++; }
    fatias.push({ m, tot, at });
  }
  return fatias;
}

// junta faixas seguidas com o mesmo problema
export function buracos(fatias, teste) {
  const out = []; let cur = null;
  for (const f of fatias) {
    if (teste(f)) { if (cur && cur.fim === f.m) cur.fim = f.m + 15; else { cur = { ini: f.m, fim: f.m + 15 }; out.push(cur); } }
  }
  return out;
}

// conferências de um modelo de semana
export function conferirModelo(mod) {
  const avisos = []; let total = 0, dias = 0;
  for (const [d, nome] of DIAS) {
    const t = turno((mod || {})[d]); if (!t) continue;
    dias++; total += t.trab;
    const span = t.s - t.e;
    if (t.trab > LIMITE_DIA) avisos.push(`${nome}: ${fmtH(t.trab)} de trabalho, passa de 10h (8h + 2h extras)`);
    if (t.trab > 360 && t.a < 60) avisos.push(`${nome}: jornada acima de 6h pede almoço de pelo menos 1h`);
    if (span > 240 && span <= 360 && t.a < 15) avisos.push(`${nome}: jornada de 4h a 6h pede pausa de 15 min`);
    const prox = turno((mod || {})[d + 1]);
    if (prox && 1440 - t.s + prox.e < 660) avisos.push(`${nome}: menos de 11h de descanso até o dia seguinte`);
  }
  if (total > LIMITE_SEMANA) avisos.push(`${fmtH(total)} na semana, passa de 44h`);
  return { total, dias, avisos };
}

// rodízio do ano: distribui os sábados entre as pessoas escolhidas, em ordem, N por sábado
export function gerarRodizio(ano, ids, porSabado = 1, desde = '0000') {
  const out = {}; let i = 0;
  if (!ids.length) return out;
  for (const sab of sabadosDoAno(ano)) {
    if (sab < desde) continue;
    const quem = [];
    for (let k = 0; k < Math.min(porSabado, ids.length); k++) quem.push(ids[(i + k) % ids.length]);
    out[sab] = quem; i += Math.min(porSabado, ids.length);
  }
  return out;
}

// proposta 5x2: atendentes de segunda a sexta (abertura e fechamento); lavadores no rodízio do sábado:
// na semana com sábado (5h45) folgam na quinta e compensam nos outros 4 dias (9h33); na outra, 8h48 de seg a sex
export function proposta(atendentes, lavadores) {
  const dia = (e, s, ai, a = 60) => ({ e, s, ai, a });
  const util = (t) => ({ 1: t, 2: t, 3: t, 4: t, 5: t });
  const out = {};
  atendentes.forEach((id, i) => {
    const t = i % 2 ? dia('10:12', '20:00', '14:00') : dia('07:00', '16:48', '11:00');
    const l = i % 2 ? dia('09:27', '20:00', '14:00') : dia('07:00', '17:33', '11:00');
    out[id] = { sem: util(t), com: { 1: l, 2: l, 3: l, 5: l, 6: dia('09:30', '15:30', '12:30', 15) } };
  });
  const longo = dia('08:00', '18:33', '12:00');
  lavadores.forEach((id) => { out[id] = { sem: util(dia('09:00', '18:48', '13:00')), com: { 1: longo, 2: longo, 3: longo, 5: longo, 6: dia('09:30', '15:30', '12:30', 15) } }; });
  return out;
}
