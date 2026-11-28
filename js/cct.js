// Comparativo "como pagamos hoje" x "regra nova" (CCT 2026/2027 SINDEPARK/SITRAMICO-RS + regulamento novo de premiação)
import { r2 } from './calc.js';

export const CCT_PADRAO = {
  minimo: 1621,            // salário mínimo nacional 2026 (Decreto 12.797/2025) — base da insalubridade
  pisoLavador: 1850,       // cl. 3ª
  pisoGeral: 1770,         // cl. 3ª
  pisoSeco: 1792,          // cl. 3ª (manobrista / lavagem a seco)
  caixaPct: 10,            // cl. 6ª
  insalPct: 20,            // cl. 9ª
  quinqPct: 3,             // cl. 7ª
  va: 300,                 // cl. 10ª
  vtDias: 22,
  mesesBase: 6,            // meses fechados usados nas médias de prêmio e receita
  premioCenario: 'novo',   // 'novo' = regulamento novo; 'antigo' = mantém a regra antiga de prêmio
  adocao: '2026-12',
  premioHojeManual: null,
  premioNovoManual: null,
  receitaManual: null,
  pessoas: {},
};

export const FUNCOES = [['lavador', 'Lavador'], ['geral', 'Empregado geral'], ['seco', 'Manobrista / lavagem a seco']];

export const CLAUSULAS = [
  ['3ª Piso salarial', 'Desde 01/02/2026: lavador de carros R$ 1.850; empregados em geral R$ 1.770; manobrista e lavagem a seco R$ 1.792. Jornada menor que 220h: proporcional.', 'Salário novo = o maior entre o salário de hoje e o piso da função.'],
  ['4ª e Aditivo 3ª Reajuste', '4,3% em 01/02/2026 para salários até R$ 3.846 (proporcional para quem entrou depois de fev/2025).', 'Se alguém ganha abaixo do piso reajustado, o quadro já sobe para o piso.'],
  ['6ª Gratificação de caixa', '10% sobre o salário para quem faz o caixa de forma permanente (e para quem substitui por mais de 15 dias). Não integra o salário. Quem não desconta diferenças de caixa pode não pagar.', 'Marque "Faz caixa" na pessoa. Fica fora de 13º e férias.'],
  ['7ª Quinquênio', '3% a cada 5 anos completos e ininterruptos na empresa, sobre o salário base.', 'Calculado pela data de admissão (ou anos digitados).'],
  ['9ª Insalubridade (lavagens)', 'Quando constatada e devida, 20% sobre o salário mínimo nacional. Lavagem a seco segue o laudo do PGR.', 'Marque "Insalubre". 20% × salário mínimo por pessoa.'],
  ['10ª Vale alimentação/refeição', 'Mínimo de R$ 300 por mês, proporcional aos dias trabalhados (ou cesta básica formalizada). Não pode ser pago em dinheiro.', 'VA novo = o maior entre o que se paga hoje e o mínimo.'],
  ['11ª Domingos e feriados', 'Quem trabalha nesses dias tem os mesmos benefícios dos dias úteis.', 'Vale para VT e VA dos dias trabalhados.'],
  ['26ª Horas extras', '50% nas duas primeiras horas, 100% nas demais.', 'Fora do quadro: entra como extra na folha.'],
  ['27ª Banco de horas', 'Compensação em até 360 dias, apuração do saldo no fim de novembro.', 'Fora do quadro.'],
  ['63ª Fechamento de caixa', 'Conferência de caixa depois da jornada é paga como hora extra.', 'Fora do quadro.'],
  ['64ª Danos em veículos', 'Desconto permitido com culpa comprovada, em até 8 parcelas de no máximo 30% do salário.', 'Fora do quadro.'],
];

export const prm = (cfg) => ({ ...CCT_PADRAO, ...((cfg && cfg.cct) || {}) });

export function anosDeCasa(admissao, hoje) {
  if (!admissao) return 0;
  const [y1, m1, d1] = admissao.split('-').map(Number), [y2, m2, d2] = hoje.split('-').map(Number);
  let a = y2 - y1; if (m2 < m1 || (m2 === m1 && d2 < d1)) a--;
  return Math.max(0, a);
}

const funcaoDe = (f) => (f.funcao === 'atendente' ? 'geral' : 'lavador');

// valores efetivos da pessoa = cadastro do funcionário + o que foi editado no comparativo
export function pessoa(f, p, hoje) {
  const e = (p.pessoas || {})[f.id] || {};
  const funcao = e.funcao || funcaoDe(f);
  return {
    id: f.id, nome: f.nome, editado: e,
    incluir: e.incluir !== false,
    funcao,
    caixa: e.caixa != null ? e.caixa : (f.fixos || []).some((x) => /caixa/i.test(x.desc || '')),
    insal: e.insal != null ? e.insal : funcao === 'lavador',
    anos: e.anos != null ? e.anos : anosDeCasa(f.admissao, hoje),
    salario: e.salario != null ? e.salario : Number(f.salario) || 0,
    vtDia: e.vtDia != null ? e.vtDia : Number(f.vtDia) || 0,
    vtDias: e.vtDias != null ? e.vtDias : Number(f.vtDiasPadrao) || p.vtDias,
    vaHoje: e.vaHoje != null ? e.vaHoje : 0,
    premioHoje: e.premioHoje,   // null → média
    premioNovo: e.premioNovo,
  };
}

// medias = { premioHoje, premioNovo, receita } já resolvidas (automático ou manual)
export function calcula(pe, p, medias) {
  const piso = pe.funcao === 'geral' ? p.pisoGeral : pe.funcao === 'seco' ? p.pisoSeco : p.pisoLavador;
  const vt = r2(pe.vtDia * pe.vtDias);
  const premioHoje = r2(pe.premioHoje != null ? pe.premioHoje : medias.premioHoje);
  const premioNovoRegra = r2(pe.premioNovo != null ? pe.premioNovo : medias.premioNovo);
  const hoje = { salario: r2(pe.salario), caixa: 0, insal: 0, quinq: 0, premio: premioHoje, vt, va: r2(pe.vaHoje) };
  const salN = r2(Math.max(pe.salario, piso));
  const nova = {
    salario: salN,
    caixa: pe.caixa ? r2(salN * p.caixaPct / 100) : 0,
    insal: pe.insal ? r2(p.minimo * p.insalPct / 100) : 0,
    quinq: r2(salN * p.quinqPct / 100 * Math.floor((Number(pe.anos) || 0) / 5)),
    premio: p.premioCenario === 'antigo' ? premioHoje : premioNovoRegra,
    vt,
    va: r2(Math.max(pe.vaHoje, p.va)),
  };
  const soma = (o) => r2(Object.values(o).reduce((a, v) => a + v, 0));
  hoje.total = soma(hoje); nova.total = soma({ ...nova, total: 0 });
  const dif = r2(nova.total - hoje.total);
  // 13º e férias (+1/3) incidem sobre salário, insalubridade e quinquênio; gratificação de caixa não integra (cl. 6ª §3º)
  const anual = r2(dif * 12 + (salN - hoje.salario + nova.insal + nova.quinq) * 4 / 3);
  return { piso, hoje, nova, dif, anual };
}

export const ITENS = [['salario', 'Salário'], ['caixa', 'Grat. de caixa'], ['insal', 'Insalubridade'], ['quinq', 'Quinquênio'], ['premio', 'Prêmio'], ['vt', 'VT'], ['va', 'Vale alimentação']];
