// Regras do Programa de Premiação da Lavagem (Regulamento, Cláusulas 1, 3 e 4)
// e cálculos do mês. Funções puras: não acessam banco nem tela.

export const TIPOS = {
  paga: { nome: 'Paga', conta: true },
  cortesia: { nome: 'Cortesia', conta: true },
  sulgas: { nome: 'Sulgás', conta: true },
  retorno: { nome: 'Retorno', conta: false },
  cancelada: { nome: 'Cancelada', conta: false },
};

export const PAGAMENTOS = [
  ['din', 'Dinheiro'], ['pix', 'PIX'], ['deb', 'Débito'], ['cred', 'Crédito'],
  ['mens', 'Mensalistas'], ['conv', 'Convênios'], ['sulg', 'Sulgás (recebimento)'], ['papel', 'Casa do Papel'],
];

export const PRESENCA = {
  T: { nome: 'Trabalhou', curto: 'T' },
  F: { nome: 'Falta', curto: 'F' },
  J: { nome: 'Ausência justificada (férias, atestado, afastamento)', curto: 'J' },
  X: { nome: 'Folga / fora da escala', curto: '–' },
};

export const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
export const pad = (n) => String(n).padStart(2, '0');
export const diaSemana = (iso) => new Date(iso + 'T12:00:00').getDay(); // 0 dom … 6 sáb
export const ehSabado = (iso) => diaSemana(iso) === 6;
export const ehDomingo = (iso) => diaSemana(iso) === 0;
export const diasNoMes = (mk) => { const [y, m] = mk.split('-').map(Number); return new Date(y, m, 0).getDate(); };

// Contagem e Base de Cálculo do dia (Cláusula 1.4 a, c; 4.2)
export function apuraDia(dia, cfg) {
  dia = dia || {};
  const sv = Number(cfg.sulgasValor) || 48;
  let pagas = 0, cort = 0, sulgas = 0, retornos = 0, valorPagas = 0;
  if (Array.isArray(dia.lav) && dia.lav.length) {
    for (const l of dia.lav) {
      if (l.t === 'paga') { pagas++; valorPagas += Number(l.v) || 0; }
      else if (l.t === 'cortesia') cort++;
      else if (l.t === 'sulgas') sulgas++;
      else if (l.t === 'retorno') retornos++;
    }
  } else {
    pagas = Number(dia.pagas) || 0; cort = Number(dia.cort) || 0; sulgas = Number(dia.sulgas) || 0;
    valorPagas = Number(dia.valor) || 0;
  }
  const contados = pagas + cort + sulgas;
  const base = r2(valorPagas + sulgas * sv);
  const receita = r2(Object.values(dia.pg || {}).reduce((a, b) => a + (Number(b) || 0), 0));
  return { pagas, cort, sulgas, retornos, contados, valorPagas: r2(valorPagas), base, receita, estacionamento: r2(receita - valorPagas) };
}

// Faixa do Prêmio Diário (Cláusula 3.1)
export function faixaDia(contados, iso, cfg) {
  if (ehSabado(iso)) {
    return contados >= cfg.sabadoMin ? { nome: 'Meta 1 (sáb.)', pct: Number(cfg.sabadoPct), nivel: 1 } : { nome: 'Sem prêmio', pct: 0, nivel: 0 };
  }
  const fx = [...cfg.faixasDia].sort((a, b) => a.min - b.min);
  let atual = { nome: 'Sem prêmio', pct: 0, nivel: 0 };
  fx.forEach((f, i) => { if (contados >= f.min) atual = { nome: f.nome || `Meta ${i + 1}`, pct: Number(f.pct), nivel: i + 1 }; });
  return atual;
}

export function proximaFaixa(contados, iso, cfg) {
  if (ehSabado(iso)) return contados < cfg.sabadoMin ? { faltam: cfg.sabadoMin - contados, pct: cfg.sabadoPct } : null;
  const f = [...cfg.faixasDia].sort((a, b) => a.min - b.min).find((x) => x.min > contados);
  return f ? { faltam: f.min - contados, pct: f.pct, nome: f.nome } : null;
}

export const regraNova = (iso, cfg) => iso >= (cfg.vigencia || '9999-12-31');

// Quem estava presente no dia (registro explícito ou padrão)
export function presencaDia(dia, iso, funcs, equipeMes) {
  if (dia && dia.presenca && Object.keys(dia.presenca).length) return dia.presenca;
  const p = {};
  if (!dia || ehDomingo(iso)) return p; // sem lançamento no dia = sem presença presumida
  if (ehSabado(iso)) {
    if (dia && dia.escalaSab) p[dia.escalaSab] = 'T';
    return p;
  }
  if (equipeMes && equipeMes.length) { for (const id of equipeMes) p[id] = 'T'; return p; }
  for (const f of funcs) if (ativoEm(f, iso)) p[f.id] = 'T';
  return p;
}

export function ativoEm(f, iso) {
  if (f.admissao && iso < f.admissao) return false;
  if (f.desligamento && iso > f.desligamento) return false;
  if (!f.admissao && !f.desligamento) return f.ativo !== false;
  return true;
}

// Prêmio do dia por participante presente
export function premioDia(dia, iso, cfg) {
  const a = apuraDia(dia, cfg);
  if (!regraNova(iso, cfg)) {
    return { ...a, regra: 'antiga', faixa: { nome: 'Regra antiga', pct: null, nivel: -1 }, porPessoa: r2(dia && dia.premioLeg) };
  }
  const faixa = faixaDia(a.contados, iso, cfg);
  return { ...a, regra: 'nova', faixa, porPessoa: r2(a.base * faixa.pct / 100) };
}

// Simulação: como seria pela regra nova (para comparar meses antigos)
export function premioDiaNova(dia, iso, cfg) {
  const a = apuraDia(dia, cfg);
  const faixa = faixaDia(a.contados, iso, cfg);
  return r2(a.base * faixa.pct / 100);
}

export function faixaMes(total, cfg) {
  let atual = null;
  [...cfg.faixasMes].sort((a, b) => a.min - b.min).forEach((f, i) => { if (total >= f.min) atual = { ...f, nivel: i + 1 }; });
  return atual;
}
export function proximaFaixaMes(total, cfg) {
  return [...cfg.faixasMes].sort((a, b) => a.min - b.min).find((f) => f.min > total) || null;
}

// Apuração completa do mês
export function apuraMes(mk, mes, cfg, funcs) {
  mes = mes || {};
  const dias = mes.dias || {};
  const n = diasNoMes(mk);
  const lista = [];
  const tot = { contados: 0, pagas: 0, cort: 0, sulgas: 0, retornos: 0, valorPagas: 0, base: 0, receita: 0, estacionamento: 0, premioPessoaDia: 0, simNova: 0 };
  const porFunc = {};
  for (const f of funcs) porFunc[f.id] = { id: f.id, nome: f.nome, T: 0, F: 0, J: 0, premioDiario: 0, dias: [] };
  const algumNovo = regraNova(`${mk}-${pad(n)}`, cfg);
  const equipeMes = (mes.folhaLegado || []).map((e) => e.id);
  for (let d = 1; d <= n; d++) {
    const iso = `${mk}-${pad(d)}`;
    const dia = dias[pad(d)];
    const p = premioDia(dia, iso, cfg);
    const pres = presencaDia(dia, iso, funcs, equipeMes);
    const presentes = Object.entries(pres).filter(([, s]) => s === 'T').map(([id]) => id);
    for (const [id, s] of Object.entries(pres)) {
      if (!porFunc[id]) porFunc[id] = { id, nome: id, T: 0, F: 0, J: 0, premioDiario: 0, dias: [] };
      if (s === 'T' || s === 'F' || s === 'J') porFunc[id][s]++;
      if (s === 'T' && p.regra === 'nova') {
        porFunc[id].premioDiario = r2(porFunc[id].premioDiario + p.porPessoa);
        porFunc[id].dias.push({ iso, contados: p.contados, base: p.base, pct: p.faixa.pct, valor: p.porPessoa });
      }
    }
    for (const k of ['contados', 'pagas', 'cort', 'sulgas', 'retornos', 'valorPagas', 'base', 'receita', 'estacionamento']) tot[k] = r2(tot[k] + p[k]);
    tot.premioPessoaDia = r2(tot.premioPessoaDia + (p.porPessoa || 0));
    tot.simNova = r2(tot.simNova + premioDiaNova(dia, iso, cfg));
    lista.push({ iso, d, dia, ...p, presentes, temDados: !!dia });
  }
  const fm = algumNovo ? faixaMes(tot.contados, cfg) : null;
  const minPres = (Number(cfg.presencaMin) || 80) / 100;
  for (const pf of Object.values(porFunc)) {
    const previstos = pf.T + pf.F; // ausências justificadas não contam como previstos (3.3)
    pf.previstos = previstos;
    pf.presencaPct = previstos ? pf.T / previstos : 0;
    pf.elegivelBonus = !!fm && previstos > 0 && pf.presencaPct >= minPres;
    pf.bonus = pf.elegivelBonus ? fm.valor : 0;
    pf.premioTotal = r2(pf.premioDiario + pf.bonus);
  }
  return { mk, lista, tot, faixaMes: fm, proxMes: algumNovo ? proximaFaixaMes(tot.contados, cfg) : null, porFunc, regraNova: algumNovo };
}

// Folha do mês para um funcionário (regra nova). Legado é exibido como importado.
export function folhaFunc(f, pf, folha, cfg) {
  folha = folha || {};
  const diasTrab = folha.diasTrab != null ? Number(folha.diasTrab) : 30 - (pf ? pf.F : 0);
  const salMes = folha.salMes != null ? Number(folha.salMes) : Number(f.salario) || 0;
  const salario = r2(salMes / 30 * diasTrab);
  const vtDias = folha.vtDias != null ? Number(folha.vtDias) : (pf ? pf.T : 0);
  const vtDia = folha.vtDia != null ? Number(folha.vtDia) : Number(f.vtDia) || 0;
  const vt = r2(vtDias * vtDia);
  const extras = r2((folha.extras || []).reduce((a, e) => a + (Number(e.valor) || 0), 0));
  const descontos = r2((folha.descontos || []).reduce((a, e) => a + (Number(e.valor) || 0), 0));
  const premio = pf ? pf.premioTotal : 0;
  return { salMes, diasTrab, salario, vtDias, vtDia, vt, extras, descontos, premio, total: r2(salario + premio + extras - descontos) };
}

// Despesas e resultado do mês
export function resultadoMes(ap, mes, cfg, funcs) {
  mes = mes || {};
  if (mes.despesasLegado && !mes.despesas) {
    const desp = mes.despesasLegado.map((x) => ({ ...x, auto: false }));
    const total = r2(desp.reduce((a, b) => a + (Number(b.valor) || 0), 0));
    return { despesas: desp, total, resultado: r2(ap.tot.receita - total), legado: true };
  }
  const auto = [];
  if (ap.regraNova) {
    let sal = 0, vt = 0, pr = 0, ex = 0;
    for (const f of funcs) {
      const pf = ap.porFunc[f.id];
      if (!pf || (!pf.T && !pf.F && !pf.J && !f.ativo)) continue;
      const fo = folhaFunc(f, pf, (mes.folha || {})[f.id], cfg);
      sal += fo.salario; vt += fo.vt; pr += fo.premio; ex += fo.extras - fo.descontos;
    }
    auto.push({ desc: 'Salários', valor: r2(sal), auto: true });
    auto.push({ desc: 'VT', valor: r2(vt), auto: true });
    auto.push({ desc: 'Prêmios', valor: r2(pr), auto: true });
    if (ex) auto.push({ desc: 'Extras − descontos da folha', valor: r2(ex), auto: true });
  }
  const din = ap.lista.reduce((a, l) => a + (Number(((l.dia || {}).pg || {}).din) || 0), 0);
  const imp = r2((ap.tot.receita - din) * (Number(cfg.impostoPct) || 0) / 100);
  auto.push({ desc: `Impostos (${cfg.impostoPct}% s/ faturamento declarado)`, valor: imp, auto: true });
  const desp = [...auto, ...(mes.despesas || []).map((x) => ({ ...x, auto: false }))];
  const total = r2(desp.reduce((a, b) => a + (Number(b.valor) || 0), 0));
  return { despesas: desp, total, resultado: r2(ap.tot.receita - total), legado: false };
}

// Período Sulgás: do dia 19 ao dia 18 do mês seguinte
export function periodoSulgas(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  let ini = d >= 19 ? new Date(y, m - 1, 19) : new Date(y, m - 2, 19);
  const fim = new Date(ini.getFullYear(), ini.getMonth() + 1, 18);
  const f = (dt) => `${dt.getFullYear()}-${pad(dt.getMonth() + 1)}-${pad(dt.getDate())}`;
  return { ini: f(ini), fim: f(fim) };
}
