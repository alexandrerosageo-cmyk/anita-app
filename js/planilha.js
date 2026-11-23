// Monta o backup completo em Excel a partir dos dados do app.
// Usado pelo botão em Ajustes (navegador) e pelo envio automático do dia 15 (GitHub Actions).
import * as C from './calc.js';
import { gerarXlsx } from './xlsx-mini.js';

const SEM = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
const nomeMesCurto = (mk) => { const [y, m] = mk.split('-'); return `${m}/${y}`; };

export function montarPlanilha({ cfg, funcs, frota, meses }) {
  cfg = { ...cfg };
  if (!Array.isArray(cfg.pagamentos) || !cfg.pagamentos.length) cfg.pagamentos = C.PAGAMENTOS.map(([k, nome]) => ({ k, nome, ativo: true }));
  const cats = cfg.categorias || [];
  const nomeCat = (id) => (cats.find((c) => c.id === id) || {}).nome || id || '';
  const nomeFunc = (id) => (funcs.find((f) => f.id === id) || {}).nome || id;
  const motorista = (pl) => (frota.find((v) => String(v.placa || '').replace(/[^A-Z0-9]/gi, '').toUpperCase() === String(pl || '').replace(/[^A-Z0-9]/gi, '').toUpperCase()) || {}).nome || '';
  const mks = Object.keys(meses).sort();

  // campos do caixa: todos os que existem na configuração + os que aparecem nos dados
  const campos = [...cfg.pagamentos];
  for (const mk of mks) for (const d of Object.values(meses[mk].dias || {})) for (const k of Object.keys(d.pg || {})) if (!campos.some((c) => c.k === k)) campos.push({ k, nome: k });

  const porPreco = [], conv = [], resumo = [], caixa = [], lavagens = [], porNome = [], despesas = [], itens = [], folha = [], sulgas = [];
  for (const mk of mks) {
    const M = meses[mk];
    const ap = C.apuraMes(mk, M, cfg, funcs);
    const res = C.resultadoMes(ap, M, cfg, funcs);
    const pfMax = Object.values(ap.porFunc).reduce((a, p) => Math.max(a, p.premioTotal), 0);
    if (ap.tot.receita || res.total || ap.tot.contados) {
      resumo.push([nomeMesCurto(mk), ap.tot.receita, C.dinheiroMes(ap), C.aoContador(ap), ap.tot.estacionamento, ap.tot.valorPagas, ap.tot.contados, ap.tot.pagas, ap.tot.cort, ap.tot.sulgas, res.total, res.resultado, ap.regraNova ? pfMax : ap.tot.premioPessoaDia, ap.regraNova ? 'nova' : 'antiga']);
    }
    const equipeMes = (M.folhaLegado || []).map((e) => e.id);
    for (const l of ap.lista) {
      if (!l.dia) continue;
      const d = l.dia;
      const pres = C.presencaDia(d, l.iso, funcs, equipeMes);
      const presentes = Object.entries(pres).filter(([, s]) => s === 'T').map(([id]) => nomeFunc(id)).join(', ');
      const faltas = Object.entries(pres).filter(([, s]) => s === 'F' || s === 'J').map(([id, s]) => `${nomeFunc(id)} (${s})`).join(', ');
      caixa.push([l.iso, SEM[C.diaSemana(l.iso)], ...campos.map((c) => (d.pg || {})[c.k] || null), l.receita, l.pagas, l.cort, l.sulgas, l.retornos, l.valorPagas, l.base, l.regra === 'nova' ? l.faixa.pct : null, l.porPessoa || null, presentes, faltas, d.obs || '']);
      if (d.convSab) { const r = d.convSab.res; conv.push([l.iso, C.ehSabado(l.iso) ? 'sábado' : 'feriado', r.carros, r.pico, r.momentoPico || '', r.extras, r.cfg.vagas, r.valorDia, r.valorExtras, r.total]); }
      for (const [v, n] of Object.entries(d.precos || {})) porPreco.push([l.iso, Number(v), n, C.r2(Number(v) * n), 'planilha']);
      { const g = {}; for (const x of d.lav || []) if (x.t === 'paga') { const k = C.r2(x.v).toFixed(2); g[k] = (g[k] || 0) + 1; } for (const [v, n] of Object.entries(g)) porPreco.push([l.iso, Number(v), n, C.r2(Number(v) * n), 'app']); }
      (d.lav || []).forEach((x, i) => lavagens.push([l.iso, i + 1, C.TIPOS[x.t] ? C.TIPOS[x.t].nome : x.t, x.v || 0, x.ticket || '', x.placa || '', x.cliente || x.mot || (x.placa ? motorista(x.placa) : ''), x.desc || '']));
      for (const [k, lst] of Object.entries(d.det || {})) for (const p of lst) porNome.push([l.iso, (campos.find((c) => c.k === k) || {}).nome || k, p.nome, p.valor, p.obs || '']);
      if (d.sulgas && !(M.sulgasLista || []).some((s) => s.data === l.iso)) for (let i = 0; i < d.sulgas; i++) sulgas.push([l.iso, '', '', '', cfg.sulgasValor || 0, 'planilha (sem placa)']);
      for (const x of d.lav || []) if (x.t === 'sulgas') sulgas.push([l.iso, x.ticket || '', x.placa || '', x.mot || motorista(x.placa), x.v || 0, 'app']);
    }
    for (const s of M.sulgasLista || []) sulgas.push([s.data, String(s.ticket || '').replace(/\.0+$/, ''), s.placa, s.nome || motorista(s.placa), s.valor, 'planilha']);
    for (const d of M.despesasLegado || []) despesas.push([nomeMesCurto(mk), null, '(planilha)', '', d.desc, '', Number(d.valor) || 0, d.obs || '']);
    for (const d of M.despesas || []) {
      despesas.push([nomeMesCurto(mk), d.data || null, nomeCat(d.cat) || d.desc, d.forn || '', d.desc || '', (d.itens || []).map((i) => i.mat).join(', '), C.valorDesp(d), d.obs || '']);
      for (const i of d.itens || []) itens.push([d.data || null, d.forn || '', nomeCat(d.cat), i.mat, i.qtd || null, i.un || '', Number(i.valor) || 0]);
    }
    if ((M.folhaLegado || []).length && !M.folhaApp) {
      for (const e of M.folhaLegado) folha.push([nomeMesCurto(mk), e.nome, e.diasTrab, e.salario, e.premio ?? e.extras ?? 0, null, null, e.descontos || 0, e.total, e.vtDias || null, e.vtDias && e.vtDia ? C.r2(e.vtDias * e.vtDia) : null, 'planilha', e.obs || '']);
    } else {
      for (const f of funcs) {
        const pf = ap.porFunc[f.id];
        const fo = (M.folha || {})[f.id];
        if (!fo && !(pf && (pf.T || pf.F || pf.J))) continue;
        const r = C.folhaFunc(f, pf, fo, cfg, mk);
        folha.push([nomeMesCurto(mk), f.nome, r.diasTrab, r.salario, r.premio, pf ? pf.bonus : 0, r.extras, r.descontos, r.total, r.vtDias, r.vt, 'app', (fo || {}).obs || '', C.diaPagamento(mk), r.variavel]);
      }
    }
  }
  sulgas.sort((a, b) => a[0].localeCompare(b[0]));

  const T = (titulo, tipo = 'texto', largura) => ({ titulo, tipo, largura });
  return gerarXlsx([
    { nome: 'Resumo mensal', colunas: [T('Mês', 'texto', 9), T('Receita', 'moeda'), T('Dinheiro', 'moeda'), T('Ao contador', 'moeda'), T('Estacionamento', 'moeda'), T('Lavagens pagas', 'moeda'), T('Veículos contados', 'num', 10), T('Pagas', 'num', 8), T('Cortesias', 'num', 9), T('Sulgás', 'num', 8), T('Despesas', 'moeda'), T('Resultado', 'moeda'), T('Prêmio por pessoa', 'moeda'), T('Regra', 'texto', 8)], linhas: resumo },
    { nome: 'Caixa diário', colunas: [T('Data', 'data', 11), T('Dia', 'texto', 5), ...campos.map((c) => T(c.nome, 'moeda', 12)), T('Total', 'moeda'), T('Pagas', 'num', 7), T('Cortesias', 'num', 8), T('Sulgás', 'num', 7), T('Retornos', 'num', 8), T('Valor lavagens pagas', 'moeda'), T('Base do prêmio', 'moeda'), T('Faixa %', 'num', 7), T('Prêmio/pessoa', 'moeda'), T('Trabalharam', 'texto', 28), T('Faltas/justificadas', 'texto', 20), T('Observações', 'texto', 40)], linhas: caixa },
    { nome: 'Lavagens', colunas: [T('Data', 'data', 11), T('Nº', 'num', 5), T('Tipo', 'texto', 10), T('Valor', 'moeda'), T('Ticket', 'texto', 10), T('Placa', 'texto', 10), T('Motorista / quem recebeu', 'texto', 24), T('Serviço', 'texto', 20)], linhas: lavagens },
    { nome: 'Lavagens por preço', colunas: [T('Data', 'data', 11), T('Preço', 'moeda'), T('Quantidade', 'num', 10), T('Total', 'moeda'), T('Origem', 'texto', 9)], linhas: porPreco },
    { nome: 'Pagamentos por nome', colunas: [T('Data', 'data', 11), T('Campo', 'texto', 16), T('Nome', 'texto', 28), T('Valor', 'moeda'), T('Obs.', 'texto', 30)], linhas: porNome },
    { nome: 'Despesas', colunas: [T('Mês', 'texto', 9), T('Data', 'data', 11), T('Tipo', 'texto', 22), T('Fornecedor', 'texto', 22), T('Descrição', 'texto', 26), T('Itens', 'texto', 36), T('Valor', 'moeda'), T('Obs.', 'texto', 40)], linhas: despesas },
    { nome: 'Itens de despesas', colunas: [T('Data', 'data', 11), T('Fornecedor', 'texto', 22), T('Tipo', 'texto', 20), T('Material', 'texto', 26), T('Qtd', 'num', 7), T('Un', 'texto', 6), T('Valor', 'moeda')], linhas: itens },
    { nome: 'Folha', colunas: [T('Mês', 'texto', 9), T('Funcionário', 'texto', 14), T('Dias trab.', 'num', 8), T('Salário', 'moeda'), T('Prêmio do mês', 'moeda'), T('Bônus (incluso)', 'moeda'), T('Extras', 'moeda'), T('Descontos', 'moeda'), T('Total a pagar', 'moeda'), T('Dias VT', 'num', 7), T('VT', 'moeda'), T('Origem', 'texto', 9), T('Obs.', 'texto', 40), T('Pago em (prêmio/extras)', 'data', 12), T('Prêmio + extras − desc.', 'moeda')], linhas: folha },
    { nome: 'Funcionários', colunas: [T('Nome', 'texto', 14), T('Função', 'texto', 10), T('Ativo', 'texto', 6), T('Salário', 'moeda'), T('VT/dia', 'moeda', 9), T('Dias VT', 'num', 8), T('Admissão', 'data', 11), T('Desligamento', 'data', 12), T('Telefone', 'texto', 15), T('PIX', 'texto', 20), T('Lançamentos fixos', 'texto', 50)],
      linhas: funcs.map((f) => [f.nome, f.funcao || '', f.ativo === false ? 'não' : 'sim', f.salario || 0, f.vtDia || 0, f.vtDiasPadrao || null, f.admissao || null, f.desligamento || null, f.telefone || '', f.pix || '', (f.fixos || []).map((x) => `${x.sinal === '-' ? '−' : '+'} ${x.desc} ${x.tipo === 'pct' ? x.valor + '%' : 'R$ ' + x.valor}`).join('; ')]) },
    { nome: 'Convênio sábados', colunas: [T('Data', 'data', 11), T('Dia', 'texto', 9), T('Carros', 'num', 8), T('Pico simultâneo', 'num', 10), T('Hora do pico', 'texto', 9), T('Extras', 'num', 7), T('Vagas incluídas', 'num', 9), T('Valor do dia', 'moeda'), T('Valor extras', 'moeda'), T('Total', 'moeda')], linhas: conv },
    { nome: 'Sulgás', colunas: [T('Data', 'data', 11), T('Ticket', 'texto', 10), T('Placa', 'texto', 10), T('Motorista', 'texto', 22), T('Valor', 'moeda'), T('Origem', 'texto', 18)], linhas: sulgas },
    { nome: 'Frota Sulgás', colunas: [T('Placa', 'texto', 10), T('Modelo', 'texto', 14), T('Cor', 'texto', 10), T('Motorista', 'texto', 24)], linhas: frota.map((v) => [v.placa, v.modelo || '', v.cor || '', v.nome || '']) },
    { nome: 'Fornecedores', colunas: [T('Nome', 'texto', 30), T('Contato / obs.', 'texto', 40)], linhas: (cfg.fornecedores || []).map((f) => [f.nome, f.obs || '']) },
    { nome: 'Materiais', colunas: [T('Material', 'texto', 30), T('Unidade', 'texto', 8), T('Último preço unitário', 'moeda')], linhas: (cfg.materiais || []).map((m) => [m.nome, m.un || '', m.ultimo || null]) },
  ]);
}

export const nomeArquivoBackup = (hoje) => `Anita backup ${hoje}.xlsx`;
