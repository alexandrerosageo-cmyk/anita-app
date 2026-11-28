// Escala 5x2: horário de cada funcionário dia a dia (cadastro), rodízio dos sábados,
// folga na semana seguinte ao sábado trabalhado, horário de cobertura, cobertura do caixa e conferências legais
export const DIAS = [[1, 'Seg'], [2, 'Ter'], [3, 'Qua'], [4, 'Qui'], [5, 'Sex'], [6, 'Sáb']];
export const FUNC_PADRAO = { 1: ['07:00', '20:00'], 2: ['07:00', '20:00'], 3: ['07:00', '20:00'], 4: ['07:00', '20:00'], 5: ['07:00', '20:00'], 6: ['09:30', '15:30'] };
export const DESDE_PADRAO = '2027-01-01';
export const LIMITE_SEMANA = 44 * 60, LIMITE_DIA = 10 * 60;

const p2 = (n) => String(n).padStart(2, '0');
export const hm = (s) => { if (s == null || String(s).trim() === '') return null; const [h, m] = String(s).split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
export const mh = (min) => `${p2(Math.floor(min / 60))}:${p2(Math.round(min % 60))}`;
export const fmtH = (min) => `${Math.floor(min / 60)}h${p2(Math.round(min % 60))}`;

// ----- datas -----
export const addDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export const dow = (iso) => new Date(iso + 'T12:00:00').getDay();
export const segundaDe = (iso) => addDias(iso, -((dow(iso) + 6) % 7));
export const sabadoDe = (iso) => addDias(segundaDe(iso), 5);
export const sabadoAnterior = (iso) => addDias(segundaDe(iso), -2);
export function sabadosDoAno(ano) {
  const out = []; let d = `${ano}-01-01`;
  while (dow(d) !== 6) d = addDias(d, 1);
  while (d.startsWith(String(ano))) { out.push(d); d = addDias(d, 7); }
  return out;
}

// horário de funcionamento do dia, em minutos
export function funcionamento(ce, d) {
  const f = ((ce && ce.funcionamento) || {})[d] || FUNC_PADRAO[d];
  return f && f[0] && f[1] ? [hm(f[0]), hm(f[1])] : null;
}

// turno: {e, s, ai, a} em minutos (entrada, saída, início do almoço, duração)
export function turno(c) {
  if (!c || c.folga) return null;
  const e = hm(c.e), s = hm(c.s);
  if (e == null || s == null || s <= e) return null;
  const a = Number(c.a) || 0, ai = a ? (hm(c.ai) ?? e + Math.round((s - e) / 2) - Math.round(a / 2)) : null;
  return { e, s, a, ai, trab: Math.max(0, s - e - a) };
}

// horário dia a dia do cadastro (aceita o formato antigo: entrada/saída únicos + sábado)
export function diasDoCadastro(h) {
  h = h || {};
  if (h.dias && Object.keys(h.dias).length) return h.dias;
  const out = {};
  if (h.entrada && h.saida) for (let d = 1; d <= 5; d++) out[d] = { e: h.entrada, s: h.saida, a: Number(h.almoco ?? 60) || 0, ...(h.almocoIni ? { ai: h.almocoIni } : {}) };
  if (h.sabEntrada && h.sabSaida) out[6] = { e: h.sabEntrada, s: h.sabSaida, a: hm(h.sabSaida) - hm(h.sabEntrada) <= 360 ? 15 : Number(h.almoco ?? 60) || 0 };
  return out;
}
export const pessoaDe = (f) => ({
  id: f.id, nome: f.nome, funcao: f.funcao || 'lavador', atende: f.funcao === 'atendente',
  dias: diasDoCadastro(f.horario), folgaApos: Number((f.horario || {}).folgaApos || 3), cobertura: (f.horario || {}).cobertura || null,
});

export const trabalhaSabado = (id, sab, sabados) => ((sabados || {})[sab] || []).includes(id);
const rodizioValendo = (ctx, iso) => iso >= (ctx.desde || DESDE_PADRAO);

// folga neste dia útil porque trabalhou no sábado anterior?
export const folgaAposSabado = (p, iso, ctx) => rodizioValendo(ctx, iso) && dow(iso) === p.folgaApos && trabalhaSabado(p.id, sabadoAnterior(iso), ctx.sabados);

// o que a pessoa faz no dia: {t: turno|null, motivo}
export function diaDe(p, iso, ctx) {
  const d = dow(iso);
  if ((ctx.fechados || {})[iso] || d === 0) return { t: null, motivo: 'fechado' };
  if (d === 6) {
    const marcado = (ctx.sabados || {})[iso];
    const vai = marcado ? marcado.includes(p.id) : !rodizioValendo(ctx, iso) && !!p.dias[6];
    return vai ? { t: turno(p.dias[6] || { e: '09:30', s: '15:30', a: 15 }), motivo: 'sábado' } : { t: null, motivo: 'folga' };
  }
  if (folgaAposSabado(p, iso, ctx)) return { t: null, motivo: 'folga do sábado' };
  if (p.cobertura && (ctx.pessoas || []).some((o) => o.id !== p.id && o.funcao === p.funcao && folgaAposSabado(o, iso, ctx))) {
    const t = turno(p.cobertura); if (t) return { t, motivo: 'cobertura' };
  }
  const t = turno(p.dias[d]);
  return { t, motivo: t ? 'normal' : 'folga' };
}

// o horário do intervalo é só referência (eles revezam no dia): conta presente de entrada a saída
const presente = (t, m) => t && m >= t.e && m < t.s;

// por faixa de 15 min: quantos no total, quantos atendentes (caixa) e quantos lavadores
export function cobertura(iso, ctx) {
  const d = dow(iso), fn = funcionamento(ctx, d);
  if (!fn || (ctx.fechados || {})[iso]) return [];
  const ts = ctx.pessoas.map((p) => ({ p, t: diaDe(p, iso, ctx).t })), out = [];
  for (let m = fn[0]; m < fn[1]; m += 15) {
    let tot = 0, at = 0, lv = 0;
    for (const { p, t } of ts) if (presente(t, m)) { tot++; if (p.atende) at++; else lv++; }
    out.push({ m, tot, at, lv });
  }
  return out;
}

// dá para essa pessoa tirar o intervalo revezando com alguém? (alguém presente durante a duração dele,
// entre 1h depois da entrada e 1h antes da saída). caixa: no caso de atendente, se outro atendente cobre
export function intervalo(p, iso, ctx) {
  const { t } = diaDe(p, iso, ctx); if (!t || !t.a) return null;
  const outros = ctx.pessoas.filter((o) => o.id !== p.id).map((o) => ({ o, t: diaDe(o, iso, ctx).t })).filter((x) => x.t);
  const cabe = (filtro) => {
    let corrida = 0;
    for (let m = t.e + 60; m < t.s - 60; m += 15) {
      corrida = outros.some((x) => filtro(x.o) && m >= x.t.e && m < x.t.s) ? corrida + 15 : 0;
      if (corrida >= t.a) return true;
    }
    return false;
  };
  return { a: t.a, alguem: cabe(() => true), caixa: !p.atende || cabe((o) => o.atende) };
}

export function buracos(fatias, teste) {
  const out = []; let cur = null;
  for (const f of fatias) {
    if (teste(f)) { if (cur && cur.fim === f.m) cur.fim = f.m + 15; else { cur = { ini: f.m, fim: f.m + 15 }; out.push(cur); } }
  }
  return out;
}

// horas de uma semana (segunda a sábado) com avisos
export function conferirSemana(p, segunda, ctx) {
  const avisos = []; let total = 0, dias = 0, ant = null;
  for (const [d, nome] of DIAS) {
    const iso = addDias(segunda, d - 1), { t } = diaDe(p, iso, ctx);
    if (t) {
      dias++; total += t.trab;
      const span = t.s - t.e;
      if (t.trab > LIMITE_DIA) avisos.push(`${nome}: ${fmtH(t.trab)}, passa de 10h`);
      if (t.trab > 360 && t.a < 60) avisos.push(`${nome}: acima de 6h pede almoço de 1h`);
      if (t.a > 120) avisos.push(`${nome}: intervalo acima de 2h só com acordo escrito`);
      if (span > 240 && span <= 360 && t.a < 15) avisos.push(`${nome}: de 4h a 6h pede pausa de 15 min`);
      if (ant && 1440 - ant.s + t.e < 660) avisos.push(`${nome}: menos de 11h de descanso desde o dia anterior`);
    }
    ant = t;
  }
  return { total, dias, avisos };
}

// rodízio do ano: distribui os sábados entre as pessoas escolhidas, em ordem, N por sábado
export function gerarRodizio(ano, ids, porSabado = 1, desde = '0000', fechados = {}) {
  const out = {}; let i = 0;
  if (!ids.length) return out;
  for (const sab of sabadosDoAno(ano)) {
    if (sab < desde || fechados[sab]) continue;
    const n = Math.min(porSabado, ids.length), quem = [];
    for (let k = 0; k < n; k++) quem.push(ids[(i + k) % ids.length]);
    out[sab] = quem; i += n;
  }
  return out;
}

// calendário de turnos de uma pessoa entre duas datas (publicado no app do funcionário e usado no ponto)
export function calendario(p, de, ate, ctx) {
  const out = {};
  for (let iso = de; iso <= ate; iso = addDias(iso, 1)) {
    const { t } = diaDe(p, iso, ctx);
    out[iso] = t ? { ini: t.e, fim: t.s, almoco: t.a, previsto: t.trab } : null;
  }
  return out;
}
