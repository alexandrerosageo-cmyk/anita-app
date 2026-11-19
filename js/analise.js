// Análises por período (mês, trimestre, ano ou datas livres). Funções puras.
import * as C from './calc.js';

export const DOW = ['Domingo', 'Segunda', 'Terça', 'Quarta', 'Quinta', 'Sexta', 'Sábado'];
const AVULSOS = ['din', 'pix', 'deb', 'cred']; // recebimentos do balcão (sem mensalistas, convênios e faturas)

export function mesesEntre(ini, fim) {
  const out = []; let [y, m] = ini.split('-').map(Number); const [yf, mf] = fim.split('-').map(Number);
  while (y < yf || (y === yf && m <= mf)) { out.push(`${y}-${C.pad(m)}`); m++; if (m > 12) { m = 1; y++; } }
  return out;
}

export function periodo(tipo, ref) {
  const [y, m] = ref.split('-').map(Number);
  const ult = (yy, mm) => `${yy}-${C.pad(mm)}-${C.pad(new Date(yy, mm, 0).getDate())}`;
  if (tipo === 'mes') return { ini: `${y}-${C.pad(m)}-01`, fim: ult(y, m), rotulo: null };
  if (tipo === 'tri') { const t = Math.floor((m - 1) / 3); const mi = t * 3 + 1; return { ini: `${y}-${C.pad(mi)}-01`, fim: ult(y, mi + 2), rotulo: `${t + 1}º trimestre ${y}` }; }
  if (tipo === 'ano') return { ini: `${y}-01-01`, fim: `${y}-12-31`, rotulo: String(y) };
  return null;
}

export function deslocar(tipo, ref, n) {
  let [y, m] = ref.split('-').map(Number);
  const passo = tipo === 'mes' ? 1 : tipo === 'tri' ? 3 : 12;
  m += passo * n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; }
  return `${y}-${C.pad(m)}-01`;
}

// período anterior com a mesma duração (para comparação)
export function anterior(ini, fim, tipo) {
  if (tipo && tipo !== 'per') { const p = periodo(tipo, deslocar(tipo, ini, -1)); return p; }
  const d0 = new Date(ini + 'T12:00:00'), d1 = new Date(fim + 'T12:00:00');
  const dias = Math.round((d1 - d0) / 864e5) + 1;
  const f = new Date(d0); f.setDate(f.getDate() - 1); const i = new Date(f); i.setDate(i.getDate() - dias + 1);
  const iso = (d) => `${d.getFullYear()}-${C.pad(d.getMonth() + 1)}-${C.pad(d.getDate())}`;
  return { ini: iso(i), fim: iso(f) };
}

export function analisar(ini, fim, meses, cfg, funcs) {
  const dias = [];
  const res = { receita: 0, despesas: 0, resultado: 0, mesesInteiros: 0, mesesParciais: 0 };
  const porMes = [];
  const campos = {};
  const servicos = {};
  for (const mk of mesesEntre(ini, fim)) {
    const M = meses[mk]; if (!M) continue;
    const ap = C.apuraMes(mk, M, cfg, funcs);
    const r = C.resultadoMes(ap, M, cfg, funcs);
    const inteiro = `${mk}-01` >= ini && `${mk}-${C.pad(C.diasNoMes(mk))}` <= fim;
    const pm = { mk, contados: 0, receita: 0, avulso: 0, valorPagas: 0, estacionamento: 0, despesas: inteiro ? r.total : null, resultado: inteiro ? r.resultado : null, inteiro };
    if (inteiro) { res.despesas += r.total; res.resultado += r.resultado; res.mesesInteiros++; } else res.mesesParciais++;
    for (const l of ap.lista) {
      if (l.iso < ini || l.iso > fim || !l.dia) continue;
      const pg = l.dia.pg || {};
      const avulso = C.r2(AVULSOS.reduce((a, k) => a + (Number(pg[k]) || 0), 0));
      const aberto = l.receita > 0 || l.contados > 0;
      if (!aberto) continue;
      const d = { iso: l.iso, dow: C.diaSemana(l.iso), contados: l.contados, pagas: l.pagas, cort: l.cort, sulgas: l.sulgas, retornos: l.retornos, valorPagas: l.valorPagas, receita: l.receita, avulso, estAvulso: C.r2(avulso - l.valorPagas), premio: l.porPessoa || 0 };
      dias.push(d);
      for (const [k, v] of Object.entries(pg)) campos[k] = C.r2((campos[k] || 0) + (Number(v) || 0));
      for (const x of l.dia.lav || []) {
        if (x.t === 'paga') { const k = x.desc || C.r2(x.v).toFixed(2); servicos[k] = servicos[k] || { nome: x.desc || null, valor: Number(x.v) || 0, n: 0, total: 0 }; servicos[k].n++; servicos[k].total = C.r2(servicos[k].total + (Number(x.v) || 0)); }
      }
      for (const k of ['contados', 'receita', 'avulso', 'valorPagas']) pm[k] = C.r2(pm[k] + d[k]);
      pm.estacionamento = C.r2(pm.receita - pm.valorPagas);
    }
    if (pm.receita || pm.contados) porMes.push(pm);
  }
  const soma = (k) => C.r2(dias.reduce((a, d) => a + (d[k] || 0), 0));
  const tot = { dias: dias.length, contados: soma('contados'), pagas: soma('pagas'), cort: soma('cort'), sulgas: soma('sulgas'), retornos: soma('retornos'), valorPagas: soma('valorPagas'), receita: soma('receita'), avulso: soma('avulso'), din: campos.din || 0 };
  tot.aoContador = C.r2(tot.receita - tot.din);
  tot.estacionamento = C.r2(tot.receita - tot.valorPagas);
  tot.ticket = tot.pagas ? C.r2(tot.valorPagas / tot.pagas) : 0;
  tot.mediaCarros = tot.dias ? C.r2(tot.contados / tot.dias) : 0;

  const porDow = DOW.map((nome, i) => {
    const ds = dias.filter((d) => d.dow === i); const n = ds.length;
    const m = (k) => (n ? C.r2(ds.reduce((a, d) => a + d[k], 0) / n) : 0);
    return { i, nome, n, carros: m('contados'), avulso: m('avulso'), estAvulso: m('estAvulso'), lavagens: m('valorPagas'), metaBatida: ds.filter((d) => d.contados >= (Number(cfg.metaDia) || 10)).length };
  }).filter((x) => x.n);

  const ordenar = (k, dir = -1) => [...dias].sort((a, b) => dir * (a[k] - b[k]) || a.iso.localeCompare(b.iso));
  const uteis = dias.filter((d) => d.dow >= 1 && d.dow <= 5);
  return {
    ini, fim, dias, tot, porDow, porMes, campos, res,
    servicos: Object.values(servicos).sort((a, b) => b.n - a.n),
    topCarros: ordenar('contados').slice(0, 5), topAvulso: ordenar('avulso').slice(0, 5),
    fracosUteis: [...uteis].sort((a, b) => a.contados - b.contados || a.avulso - b.avulso).slice(0, 5),
    metaBatida: dias.filter((d) => d.dow !== 6 && d.contados >= (Number(cfg.metaDia) || 10)).length,
  };
}
