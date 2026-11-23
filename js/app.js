import * as C from './calc.js';
import { montarPlanilha, nomeArquivoBackup } from './planilha.js';
import * as A from './analise.js';
import * as V from './convenio.js';
import { EMAIL_BACKUP } from './firebase-config.js';
import { criarStore, salvarConfigFirebase, interpretarConfig, lerConfigFirebase, usarFirebasePadrao } from './store.js';

const VERSAO = '2.15.0';
const $app = document.getElementById('app');
const S = { store: null, cfg: null, funcs: [], frota: [], meses: {}, tipoSel: 'paga', salvando: 0 };

// ---------- utilidades ----------
const ehPermissao = (e) => e && (e.code === 'permission-denied' || /insufficient permissions/i.test(e.message || ''));
function telaErroPermissao(e) {
  const u = S.store && S.store.usuario && S.store.usuario();
  return `<div class="card erro-perm"><h3>O Firebase recusou o acesso</h3>
    <p>Conta conectada: <b>${esc((u && u.email) || 'nenhuma')}</b>${e && e.caminho ? `<br><small>Ao ${esc(e.op || 'ler')}: ${esc(e.caminho)}</small>` : ''}</p>
    <p class="mini">Isso acontece quando esse e-mail não está na lista das <b>Regras do Firestore</b> (Firebase → Firestore Database → Regras), ou quando as regras foram alteradas.</p>
    <div class="linha"><button class="btn" data-act="sair">Sair e entrar com outra conta</button><button class="btn link" onclick="location.reload()">Tentar de novo</button></div></div>`;
}
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (n) => (Number(n) || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const num = (s) => { if (typeof s === 'number') return s; const t = String(s || '').trim().replace(/\s/g, ''); if (!t) return 0; const v = t.includes(',') ? t.replace(/\./g, '').replace(',', '.') : t; return Number(v) || 0; };
const fmtN = (n) => (n ? String(n).replace('.', ',') : '');
const pct = (n) => `${String(n).replace('.', ',')}%`;
const hojeISO = () => { const d = new Date(); return `${d.getFullYear()}-${C.pad(d.getMonth() + 1)}-${C.pad(d.getDate())}`; };
const mkDe = (iso) => iso.slice(0, 7);
const SEM = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado'];
const MES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
const nomeMes = (mk) => { const [y, m] = mk.split('-').map(Number); return `${MES[m - 1]} ${y}`; };
const dataBR = (iso) => iso.split('-').reverse().join('/');
const somaDias = (iso, n) => { const d = new Date(iso + 'T12:00:00'); d.setDate(d.getDate() + n); return `${d.getFullYear()}-${C.pad(d.getMonth() + 1)}-${C.pad(d.getDate())}`; };
const somaMes = (mk, n) => { let [y, m] = mk.split('-').map(Number); m += n; while (m > 12) { m -= 12; y++; } while (m < 1) { m += 12; y--; } return `${y}-${C.pad(m)}`; };
const funcsAtivos = (iso) => S.funcs.filter((f) => C.ativoEm(f, iso)).sort((a, b) => (a.ordem || 0) - (b.ordem || 0) || a.nome.localeCompare(b.nome));
const nomeFunc = (id) => (S.funcs.find((f) => f.id === id) || {}).nome || id;
const mesmoRotulo = (pr) => pr.nome.replace(/\s/g, '') === brl(pr.valor).replace(/\s/g, '');
// agrupa os botões pelo tipo de lavagem (1ª palavra: Expressa, Completa, Premium…), em ordem de valor
const normTxt = (t) => String(t || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
function gruposPreco() {
  const lista = S.cfg.precos.map((pr, i) => [pr, i]).sort((a, b) => (Number(a[0].valor) || 0) - (Number(b[0].valor) || 0));
  const SERV = ['expressa', 'simples', 'completa', 'premium', 'especial'];
  const g = {};
  for (const it of lista) { const w = normTxt(it[0].nome).split(/\s+/)[0]; const k = SERV.includes(w) ? w : ''; (g[k] = g[k] || []).push(it); }
  const nomes = Object.keys(g).filter((k) => k && g[k].length >= 2);
  const outros = Object.keys(g).filter((k) => !nomes.includes(k)).flatMap((k) => g[k]);
  const out = nomes.map((k) => ({ nome: g[k][0][0].nome.split(/\s+/)[0], itens: g[k] })).sort((a, b) => a.itens[0][0].valor - b.itens[0][0].valor);
  if (outros.length) out.push({ nome: out.length ? 'Outros' : '', itens: outros });
  return out;
}
// quantas lavagens deste botão já foram lançadas no dia aberto (no tipo selecionado)
function contaLancadas(pr) {
  if (!S.ctxDia) return 0;
  const dia = (S.meses[S.ctxDia.mk] || { dias: {} }).dias[S.ctxDia.dd] || {};
  return (dia.lav || []).filter((l) => l.t === S.tipoSel && (l.desc ? l.desc === pr.nome : (S.tipoSel === 'paga' && Math.abs((Number(l.v) || 0) - Number(pr.valor)) < 0.005))).length;
}

// tabela como a ficha do balcão: colunas = tipo de lavagem, linhas = tamanho do veículo
function tabelaPrecos() {
  const TAM = [['normal', 'Normais'], ['suv', "SUV's"], ['pick', 'Pick-Ups']];
  const tamDe = (pr) => { const n = normTxt(pr.nome); return /pick/.test(n) ? 'pick' : /suv/.test(n) ? 'suv' : /normal/.test(n) ? 'normal' : null; };
  const grupos = gruposPreco().filter((g) => g.nome && g.nome !== 'Outros');
  const usados = new Set();
  const cel = {};
  for (const g of grupos) for (const [pr, i] of g.itens) { const t = tamDe(pr); if (t && !cel[g.nome + t]) { cel[g.nome + t] = [pr, i]; usados.add(i); } }
  const qtd = (pr) => contaLancadas(pr);
  const botao = ([pr, i], rot) => { const n = qtd(pr); return `<button class="preco t-${S.tipoSel} ${grupoPreco(pr)}" data-act="addLav" data-i="${i}">${n ? `<em class="qtd">${n}</em>` : ''}<b>${esc(rot)}</b><small>${brl(pr.valor)}</small></button>`; };
  const resto = S.cfg.precos.map((pr, i) => [pr, i]).filter(([, i]) => !usados.has(i)).sort((a, b) => a[0].valor - b[0].valor);
  if (!grupos.length) return `<div class="precos">${resto.map((it) => botao(it, it[0].nome)).join('')}</div>`;
  return `<div class="matriz" style="grid-template-columns: auto repeat(${grupos.length}, 1fr)">
    <span></span>${grupos.map((g) => `<span class="mcol">${esc(g.nome)}</span>`).join('')}
    ${TAM.map(([t, rot]) => `<span class="mlin">${rot}</span>${grupos.map((g) => cel[g.nome + t] ? botao(cel[g.nome + t], cel[g.nome + t][0].valor.toFixed(2).replace('.', ',')) : '<span></span>').join('')}`).join('')}
  </div>${resto.length ? `<div class="precos outros">${resto.map((it) => botao(it, it[0].nome)).join('')}</div>` : ''}`;
}
const nomeSemServico = (nome, serv) => { const r = String(nome).replace(new RegExp('^' + serv + '\\s*', 'i'), '').trim(); return r || nome; };
// grupo do veículo pelo nome do botão: Normal (azul claro), SUV (médio), Pick-Up (escuro)
const grupoPreco = (pr) => { const n = (pr.nome || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); return /pick/.test(n) ? 'g-pick' : /suv/.test(n) ? 'g-suv' : /normal/.test(n) ? 'g-normal' : ''; };
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function toast(msg, erro) {
  const t = document.createElement('div'); t.className = 'toast' + (erro ? ' erro' : ''); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
function status(txt) { const el = document.getElementById('status'); if (el) el.textContent = txt; }

// ---------- dados ----------
// Despesas da planilha: até out/2026 viram lançamentos em bloco (com tipo); de nov/2026 em diante são lançadas à mão
const ULTIMO_MES_PLANILHA = '2026-10';
const CATS_FOLHA = [
  { id: 'folha', nome: 'Salários, férias e 13º' }, { id: 'vt', nome: 'Vale-transporte' },
  { id: 'premios', nome: 'Prêmios e comissões' }, { id: 'impostos', nome: 'Impostos' }, { id: 'divulgacao', nome: 'Divulgação' },
];
function tipoDaPlanilha(desc) {
  const d = normTxt(desc);
  if (/^salario|ferias|13|encargo/.test(d)) return 'folha';
  if (/^vt\b|vale.?transp/.test(d)) return 'vt';
  if (/premio|comiss/.test(d)) return 'premios';
  if (/imposto/.test(d)) return 'impostos';
  if (/aluguel|iptu|agua/.test(d)) return 'aluguel';
  if (/produto/.test(d)) return 'produtos';
  if (/software/.test(d)) return 'software';
  if (/contador/.test(d)) return 'contador';
  if (/\balex\b|pro.?labore|retirada/.test(d)) return 'prolabore';
  if (/extratora|maquina|compressor|conserto|manutenc|ppci/.test(d)) return 'manutencao';
  if (/banner|divulg|propaganda/.test(d)) return 'divulgacao';
  if (/luz|energia|internet|telefone/.test(d)) return 'luz';
  return 'outros';
}
const MES_PARCIAL_PLANILHA = '2026-11'; // traz da planilha só o que não sai da folha/caixa do app
const TIPOS_AUTO = ['folha', 'vt', 'premios', 'impostos'];
function migrarDespesasPlanilha(mk, M) {
  if (!M) return false;
  if (!(M.despesasLegado || []).length) {
    if (M.despesasLegado) { delete M.despesasLegado; return true; }
    if (mk <= ULTIMO_MES_PLANILHA && !M.semAuto && Object.keys(M.dias || {}).length) { M.semAuto = true; return true; } // meses da planilha nunca somam folha automática
    return false;
  }
  if (mk <= MES_PARCIAL_PLANILHA) {
    const parcial = mk > ULTIMO_MES_PLANILHA;
    M.despesas = M.despesas || [];
    M.despesasLegado.forEach((x, i) => {
      const id = `pl${mk.replace('-', '')}${i}`, cat = tipoDaPlanilha(x.desc), valor = Number(x.valor) || 0;
      if (parcial && TIPOS_AUTO.includes(cat)) return;                       // vem da folha/caixa do app
      if (M.despesas.some((d) => d.id === id || (normTxt(d.desc) === normTxt(x.desc) && Math.abs((Number(d.valor) || 0) - valor) < 0.01))) return; // já lançada
      M.despesas.push({ id, data: `${mk}-01`, cat, forn: '', desc: x.desc, valor, ...(x.obs ? { obs: x.obs } : {}), origem: 'planilha' });
    });
    if (!parcial) M.semAuto = true; // folha, VT e impostos já estão nas linhas da planilha
  }
  delete M.despesasLegado;
  return true;
}

async function mes(mk) {
  if (!S.meses[mk]) {
    S.meses[mk] = (await S.store.get('meses', mk)) || { dias: {} };
    if (migrarDespesasPlanilha(mk, S.meses[mk])) salvarMes(mk);
    // Alex é pró-labore: corrige lançamentos fixos antigos que entraram como "Outros"
    let fix = false;
    for (const d of S.meses[mk].despesas || []) if (d.fixa && d.cat === 'outros' && /\balex\b/i.test(d.desc || '')) { d.cat = 'prolabore'; fix = true; }
    if (fix) salvarMes(mk);
  }
  if (!S.meses[mk].dias) S.meses[mk].dias = {};
  return S.meses[mk];
}
const timers = {};
S.pendente = {}; S.salvoEm = {}; S.erroSalvar = {};
const horaAgora = () => { const d = new Date(); return `${C.pad(d.getHours())}:${C.pad(d.getMinutes())}`; };
function msgErroSalvar(e) { return ehPermissao(e) ? `Sem permissão para gravar (${(S.store.usuario() || {}).email || 'sem login'}). Saia e entre de novo.` : 'Não consegui salvar: ' + e.message; }
function salvarMes(mk) {
  S.pendente[mk] = true; delete S.erroSalvar[mk];
  status('Alterações não salvas'); atualizarBarraSalvar();
  clearTimeout(timers[mk]);
  timers[mk] = setTimeout(() => gravarMes(mk).catch(() => {}), 1500); // proteção: grava sozinho se você esquecer
}
async function gravarMes(mk) {
  clearTimeout(timers[mk]);
  try {
    await S.store.set('meses', mk, S.meses[mk]);
    S.pendente[mk] = false; S.salvoEm[mk] = horaAgora(); delete S.erroSalvar[mk];
    status('Salvo ✓'); atualizarBarraSalvar();
  } catch (e) {
    S.erroSalvar[mk] = msgErroSalvar(e); status('Erro ao salvar'); atualizarBarraSalvar(); toast(S.erroSalvar[mk], true);
    throw e;
  }
}
function barraSalvar(mk) {
  const erro = S.erroSalvar[mk], pend = S.pendente[mk];
  return `<div class="salvarbar ${erro ? 'erro' : pend ? 'pend' : 'ok'}" id="salvarbar">
    <span>${erro ? '⚠️ ' + esc(erro) : pend ? 'Alterações não salvas' : S.salvoEm[mk] ? `Salvo às ${S.salvoEm[mk]} ✓` : 'Tudo salvo ✓'}</span>
    <button class="btn" data-act="salvarDia">💾 Salvar dia</button></div>`;
}
function atualizarBarraSalvar() {
  const el = document.getElementById('salvarbar'); if (!el || !S.ctxDia) return;
  const tmp = document.createElement('div'); tmp.innerHTML = barraSalvar(S.ctxDia.mk);
  const novo = tmp.firstElementChild;
  el.className = novo.className;                         // só texto e cor: o botão continua o mesmo elemento
  el.querySelector('span').innerHTML = novo.querySelector('span').innerHTML;
}
window.addEventListener('beforeunload', (ev) => { if (Object.values(S.pendente).some(Boolean)) { ev.preventDefault(); ev.returnValue = ''; } });
async function salvarCfg() { await S.store.set('config', 'app', S.cfg); }
async function salvarFunc(f) { await S.store.set('funcionarios', f.id, f); }
async function salvarFrota() { await S.store.set('frota', 'lista', { veiculos: S.frota }); }

const CFG_PADRAO = {
  vigencia: '2026-12-01',
  faixasDia: [{ min: 3, pct: 4.5, nome: 'Meta 1' }, { min: 8, pct: 5, nome: 'Meta 2' }, { min: 10, pct: 5.25, nome: 'Meta 3' }],
  sabadoMin: 2, sabadoPct: 4.5,
  faixasMes: [{ min: 140, valor: 50 }, { min: 160, valor: 60 }, { min: 200, valor: 80 }, { min: 240, valor: 100 }],
  presencaMin: 80, sulgasValor: 50.98, impostoPct: 6, metaDia: 10,
  precos: [39.9, 44.9, 54.9, 64.9, 69.9, 74.9, 79.9, 89.9].map((v) => ({ nome: brl(v), valor: v })),
  despesasFixas: [],
};
const CATEGORIAS_PADRAO = () => [
  { id: 'produtos', nome: 'Produtos de lavagem' }, { id: 'manutencao', nome: 'Manutenção e consertos' },
  { id: 'aluguel', nome: 'Aluguel / IPTU / Água' }, { id: 'luz', nome: 'Energia / Internet / Telefone' },
  { id: 'contador', nome: 'Contador' }, { id: 'software', nome: 'Software' },
  { id: 'prolabore', nome: 'Pró-labore / retiradas' }, { id: 'outros', nome: 'Outros' },
];
const PAGAMENTOS_PADRAO = () => C.PAGAMENTOS.map(([k, nome]) => ({ k, nome, ativo: k !== 'papel', detalhar: k === 'mens' }));

async function carregarBase() {
  S.cfg = { ...CFG_PADRAO, ...((await S.store.get('config', 'app')) || {}) };
  if (!Array.isArray(S.cfg.pagamentos) || !S.cfg.pagamentos.length) S.cfg.pagamentos = PAGAMENTOS_PADRAO();
  if (!Array.isArray(S.cfg.categorias) || !S.cfg.categorias.length) S.cfg.categorias = CATEGORIAS_PADRAO();
  for (const c of CATS_FOLHA) if (!S.cfg.categorias.some((x) => x.id === c.id)) S.cfg.categorias.push(c);
  S.cfg.fornecedores = S.cfg.fornecedores || [];
  S.cfg.materiais = S.cfg.materiais || [];
  if (S.cfg.categorias.some((c) => c.id === 'prolabore')) for (const f of S.cfg.despesasFixas || []) if (!f.cat && /\balex\b/i.test(f.desc || '')) f.cat = 'prolabore';
  S.funcs = await S.store.list('funcionarios');
  S.frota = ((await S.store.get('frota', 'lista')) || {}).veiculos || [];
  S.meses = {};
}

// ---------- inicialização ----------
async function iniciar() {
  S.store = criarStore();
  $app.innerHTML = '<div class="carregando">Carregando…</div>';
  try {
    const logado = await S.store.init();
    if (S.store.modo === 'firebase' && !logado) return telaLogin(S.store.sessaoExpirou ? 'Sua sessão expirou (a senha pode ter sido trocada). Entre de novo.' : '');
  } catch (e) {
    $app.innerHTML = `<div class="card"><h2>Não consegui conectar ao Firebase</h2><p>${esc(e.message)}</p>
      <button class="btn" data-act="desconectar">Voltar ao modo local</button></div>`;
    return;
  }
  try { await carregarBase(); }
  catch (e) { S.rota = 'ajustes'; $app.innerHTML = moldura(ehPermissao(e) ? telaErroPermissao(e) : `<div class="card erro">Erro ao carregar: ${esc(e.message)}</div>`); return; }
  window.addEventListener('hashchange', rotear);
  rotear();
}

function telaLogin(erro) {
  $app.innerHTML = `<div class="login">
    <div class="logo">🚗💧</div><h1>Estacionamento Anita</h1>
    <form id="fLogin" class="card">
      <label>E-mail<input type="email" name="email" autocomplete="username" required></label>
      <label>Senha<input type="password" name="senha" autocomplete="current-password" required></label>
      ${erro ? `<p class="erro">${esc(erro)}</p>` : ''}
      <button class="btn grande">Entrar</button>
    </form>
    <button class="btn link" data-act="desconectar">Usar sem Firebase (modo local)</button></div>`;
  document.getElementById('fLogin').onsubmit = async (ev) => {
    ev.preventDefault();
    const fd = new FormData(ev.target);
    try { await S.store.entrar(fd.get('email'), fd.get('senha')); await carregarBase(); window.addEventListener('hashchange', rotear); rotear(); }
    catch (e) { telaLogin('E-mail ou senha incorretos.'); }
  };
}

// ---------- roteamento ----------
async function rotear() {
  document.title = 'Estacionamento Anita';
  const [, rota = 'hoje', a, b] = (location.hash || '#/hoje').split('/');
  S.rota = rota;
  try {
    if (rota === 'hoje') await telaDia(a || hojeISO());
    else if (rota === 'mes') await telaMes(a || mkDe(hojeISO()));
    else if (rota === 'equipe') await telaEquipe(a || mkDe(hojeISO()));
    else if (rota === 'demo') await telaDemo(a, b);
    else if (rota === 'sulgas') { if (a) await telaSulgas(a); else await telaSulgasAberto(); }
    else if (rota === 'despesas') await telaDespesas(a || mkDe(hojeISO()));
    else if (rota === 'convpdf') await telaConvPdf(a);
    else if (rota === 'sulgaspdf') await telaSulgasPdf(a || 'aberto');
    else if (rota === 'analise') await telaAnalise(a || 'mes', b || `${mkDe(hojeISO())}-01`);
    else if (rota === 'ajustes') await telaAjustes();
    else location.hash = '#/hoje';
  } catch (e) { console.error(e); $app.innerHTML = moldura(ehPermissao(e) ? telaErroPermissao(e) : `<div class="card erro">Erro: ${esc(e.message)}${e.caminho ? ` <small>(${esc(e.caminho)})</small>` : ''}</div>`); }
  window.scrollTo(0, 0);
}

function moldura(corpo, titulo) {
  const r = S.rota;
  const nav = [['hoje', '📝', 'Hoje'], ['mes', '📊', 'Mês'], ['analise', '📈', 'Análise'], ['equipe', '👥', 'Equipe'], ['despesas', '🧾', 'Despesas'], ['sulgas', '🚐', 'Sulgás']];
  return `<header class="topo"><div><b>Estacionamento Anita</b>${titulo ? `<small>${titulo}</small>` : ''}</div><span class="topo-dir"><span id="status" class="status">${S.store.modo === 'local' ? 'modo local' : ''}</span><a href="#/ajustes" class="engrenagem ${r === 'ajustes' ? 'ativo' : ''}" aria-label="Ajustes">⚙️</a></span></header>
  <main>${corpo}</main>
  <nav class="nav">${nav.map(([k, i, t]) => `<a href="#/${k}" class="${r === k || (r === 'demo' && k === 'equipe') ? 'ativo' : ''}"><span>${i}</span>${t}</a>`).join('')}</nav>`;
}

// ---------- TELA: dia ----------
async function telaDia(iso) {
  if (S.ctxDia && S.ctxDia.iso !== iso) { S.abrirPlanilha = false; }
  if (S.ctxDia && S.ctxDia.iso !== iso) { S.detAberto = null; if (S.pendente[S.ctxDia.mk]) gravarMes(S.ctxDia.mk).catch(() => {}); }
  const mk = mkDe(iso), dd = iso.slice(8);
  const M = await mes(mk);
  S.ctxDia = { iso, mk, dd };
  { const d0 = M.dias[dd]; if (d0 && d0.convSab && d0.convSab.res && d0.convSab.res.regra !== cfgConv().regra && !(S.cfg.convSab || {}).regraRevista) await gravarConvenio(iso, d0.convSab.carros, { arquivo: d0.convSab.arquivo, ignorados: d0.convSab.ignorados }); }
  const dia = M.dias[dd] || {};
  const nova = C.regraNova(iso, S.cfg);
  const p = C.premioDia(dia, iso, S.cfg);
  const prox = nova ? C.proximaFaixa(p.contados, iso, S.cfg) : null;
  // formulário de totais só para dias da planilha que já têm lavagens contadas; o resto lança carro a carro
  const legadoAgregado = !!(dia.pagas || dia.valor || dia.cort || dia.sulgas);
  const pres = C.presencaDia(M.dias[dd] || (C.ehSabado(iso) ? null : {}), iso, S.funcs, (M.folhaLegado || []).map((e) => e.id));
  const funcs = funcsAtivos(iso);
  for (const id of Object.keys(pres)) if (!funcs.find((f) => f.id === id)) { const f = S.funcs.find((x) => x.id === id); if (f) funcs.push(f); }
  const lav = Array.isArray(dia.lav) ? dia.lav : [];
  const metaDia = Number(S.cfg.metaDia) || 10;
  const prog = Math.min(100, (p.contados / metaDia) * 100);

  const corpo = `
  <div class="navdata">
    <a class="btn ic" href="#/hoje/${somaDias(iso, -1)}">‹</a>
    <label class="datapick"><b>${SEM[C.diaSemana(iso)]}</b> ${dataBR(iso)}<input type="date" value="${iso}" data-act="irData"></label>
    <a class="btn ic" href="#/hoje/${somaDias(iso, 1)}">›</a>
  </div>
  <div class="sublinha">${iso !== hojeISO() ? `<a class="hojelink" href="#/hoje/${hojeISO()}">voltar para hoje</a>` : '<span></span>'}
    ${C.ehDomingo(iso) || C.ehSabado(iso) ? '' : `<label class="chk feriado"><input type="checkbox" data-act="feriado" ${dia.feriado ? 'checked' : ''}> Feriado</label>`}</div>

  <section class="card destaque nivel${p.faixa.nivel}">
    <div class="placar">
      <div><span class="grande">${p.contados}</span><small>veículos contados</small></div>
      <div><span class="grande">${brl(p.porPessoa)}</span><small>prêmio por pessoa${nova ? '' : ' · regra antiga'}</small></div>
    </div>
    ${nova ? `<div class="barra"><i style="width:${prog}%"></i><em style="left:${(3 / metaDia) * 100}%"></em><em style="left:${(8 / metaDia) * 100}%"></em></div>
    <p class="faixa"><b>${esc(p.faixa.nome)}</b>${p.faixa.pct ? ` · ${pct(p.faixa.pct)} de ${brl(p.base)}` : ''}${prox ? ` · faltam <b>${prox.faltam}</b> para ${pct(prox.pct)}` : (p.faixa.nivel >= 3 ? ' · meta da equipe batida! 🎉' : '')}</p>`
    : `<p class="faixa">${p.antiga ? `<b>Regra antiga</b> · ${pct(p.antiga.pct)} de ${brl(p.valorPagas)} = ${brl(p.antiga.lav)}${p.antiga.sul ? ` + Sulgás ${brl(p.antiga.sul)}` : ''}${p.pagas <= ((S.cfg.regraAntiga || {}).limite || 7) ? ` · com ${((S.cfg.regraAntiga || {}).limite || 7) + 1} pagas sobe para ${((S.cfg.regraAntiga || {}).limite || 7) + 1}%` : ''}` : 'Regra antiga (valor importado da planilha)'}</p>
       <p class="mini">Regulamento novo a partir de ${dataBR(S.cfg.vigencia)}. Pela regra nova seria ${brl(C.premioDiaNova(dia, iso, S.cfg))}.</p>`}
    <p class="mini">Pagas ${p.pagas} · Cortesias ${p.cort} · Sulgás ${p.sulgas}${p.retornos ? ` · Retornos ${p.retornos} (não contam)` : ''} · Lavagens pagas ${brl(p.valorPagas)}</p>
  </section>

  ${legadoAgregado ? `
  <section class="card planilha">
    <details ${S.abrirPlanilha ? 'open' : ''} data-planilha><summary><b>Da planilha:</b> ${dia.pagas || 0} pagas (${brl(dia.valor)}) · ${dia.cort || 0} cortesias · ${dia.sulgas || 0} Sulgás <small>tocar para corrigir</small>
      ${dia.precos ? `<div class="composicao">${Object.entries(dia.precos).sort((a, b) => b[0] - a[0]).map(([v, n]) => `<span>${n}× ${esc(((S.cfg.precos || []).find((p) => Math.abs(p.valor - v) < 0.005) || {}).nome || brl(Number(v)))}</span>`).join('')}</div>` : ''}</summary>
    <div class="grade2">
      <label>Pagas<input inputmode="numeric" data-campo="pagas" value="${dia.pagas || ''}"></label>
      <label>Valor das pagas<input inputmode="decimal" data-campo="valor" value="${fmtN(dia.valor)}"></label>
      <label>Cortesias<input inputmode="numeric" data-campo="cort" value="${dia.cort || ''}"></label>
      <label>Sulgás<input inputmode="numeric" data-campo="sulgas" value="${dia.sulgas || ''}"></label>
    </div>
    <p class="mini">Lavagens lançadas abaixo somam a estes totais. Para lançar tudo carro a carro, zere os campos.</p></details>
  </section>` : ''}
  <section class="card">
    <h3>Lançar lavagem${legadoAgregado ? ' <small>além das da planilha</small>' : ''}</h3>
    <div class="seg" role="tablist">${['paga', 'cortesia', 'sulgas', 'retorno'].map((t) => `<button data-act="tipo" data-t="${t}" class="${S.tipoSel === t ? 'on t-' + t : ''}">${C.TIPOS[t].nome}</button>`).join('')}</div>
    ${S.tipoSel === 'sulgas' ? `
      <div class="linha"><input id="ticketSul" inputmode="numeric" placeholder="Nº do ticket" autocomplete="off" style="max-width:8.5rem"><input id="placaSul" list="frotaList" placeholder="Placa do veículo Sulgás" autocapitalize="characters" autocomplete="off">
      <button class="btn" data-act="addSulgas">+ Sulgás ${brl(S.cfg.sulgasValor)}</button></div>
      <p id="infoPlaca" class="mini">Digite a placa: o motorista cadastrado aparece aqui.</p>
      <div id="novoMot" hidden>
        <div class="linha"><input id="motSul" list="motList" placeholder="Motorista desta lavagem" autocomplete="off"><input id="modSul" placeholder="Modelo (opcional)" style="max-width:8rem"></div>
        <label class="chk mini" id="motPadraoBox" hidden><input type="checkbox" id="motPadrao"> salvar como motorista padrão desta placa</label>
      </div>
      <datalist id="motList">${[...new Set(S.frota.map((v) => v.nome).filter(Boolean))].sort().map((n) => `<option value="${esc(n)}">`).join('')}</datalist>
      <datalist id="frotaList">${S.frota.map((v) => `<option value="${esc(v.placa)}">${esc(v.nome || '')} ${esc(v.modelo || '')}</option>`).join('')}</datalist>`
    : `${S.tipoSel === 'cortesia' ? `<div class="linha cort"><input id="cortNome" list="cortList" placeholder="Quem recebeu a cortesia?" autocomplete="off" value="${esc(S.cortNome || '')}"></div>
      <datalist id="cortList">${((S.cfg.nomes || {}).cortesia || []).map((m) => `<option value="${esc(m.nome)}">`).join('')}</datalist>
      <p class="mini">Escreva o nome e toque no serviço feito.</p>` : ''}
      ${tabelaPrecos()}
      ${S.tipoSel === 'paga' ? `<div class="linha"><input id="outroValor" inputmode="decimal" placeholder="Outro valor (com desconto)"><button class="btn" data-act="addOutro">+ Adicionar</button></div>` : `<p class="mini">${S.tipoSel === 'cortesia' ? 'Cortesia conta como carro, mas entra com valor zero.' : 'Retorno (refeito por reclamação) não conta para meta nem para a base.'}</p>`}`}
    ${lav.length ? `<ol class="lavs">${lav.map((l, i) => `<li class="t-${l.t}"><span>${C.TIPOS[l.t].nome}${l.fat ? ' <span class="tag">cobrada</span>' : ''}${l.ticket ? ' · tk ' + esc(l.ticket) : ''}${l.placa ? ' · ' + esc(l.placa) : ''}${l.t === 'sulgas' && (l.mot || motoristaDe(l.placa)) ? ' · <b class="mot">' + esc(l.mot || motoristaDe(l.placa)) + '</b>' : ''}${l.cliente ? ' · <b class="mot">' + esc(l.cliente) + '</b>' : ''}${l.desc ? ' · ' + esc(l.desc) : ''}</span><b>${l.t === 'paga' || l.t === 'sulgas' ? brl(l.v) : '—'}</b>${l.t === 'sulgas' ? `<button class="x" data-act="editSul" data-i="${i}" aria-label="editar">✎</button>` : l.t === 'cortesia' ? `<button class="x" data-act="editCort" data-i="${i}" aria-label="editar">✎</button>` : ''}<button class="x" data-act="delLav" data-i="${i}" aria-label="remover">✕</button></li>`).join('')}</ol>` : (legadoAgregado ? '' : '<p class="vazio">Nenhuma lavagem lançada neste dia.</p>')}
  </section>

  <section class="card">
    <h3>Caixa do dia <small>${brl(p.receita)} · estacionamento ${brl(p.estacionamento)}</small></h3>
    <div class="grade2">${camposDoDia(dia).map((c) => campoCaixa(c, dia)).join('')}</div>
    ${S.detAberto && campos().some((c) => c.k === S.detAberto && c.detalhar) ? blocoDet(dia, S.detAberto) : ''}
  </section>

  ${C.ehDomingo(iso) && !funcs.length ? '' : `
  <section class="card">
    <h3>Equipe do dia</h3>
    <p class="mini">Prêmio diário só para quem trabalhou (T). F = falta, J = férias/atestado/afastamento, – = folga.</p>
    ${funcs.map((f) => `<div class="pres"><span>${esc(f.nome)}<small>${esc(f.funcao || '')}</small></span><div class="seg mini">${['T', 'F', 'J', 'X'].map((s) => `<button data-act="pres" data-id="${f.id}" data-s="${s}" class="${(pres[f.id] || 'X') === s ? 'on s-' + s : ''}">${C.PRESENCA[s].curto}</button>`).join('')}</div></div>`).join('')}
  </section>`}

  ${C.ehSabado(iso) || dia.feriado || dia.convSab ? blocoConvenio(dia, iso) : ''}

  <section class="card">
    <h3>Observações</h3>
    <textarea data-campo="obs" rows="2" placeholder="Mensalista novo, ocorrência, etc.">${esc(dia.obs || '')}</textarea>
  </section>`;
  $app.innerHTML = moldura(corpo + barraSalvar(mk), 'Lançamento do dia');
  S.ctxDia = { iso, mk, dd };
}

// ---------- convênio de sábados/feriados ----------
const cfgConv = () => { const c = { ...V.CONV_PADRAO, ...(S.cfg.convSab || {}) }; if (!S.cfg.convSab || !S.cfg.convSab.regraRevista) { c.regra = 'periodo'; } return c; };
function blocoConvenio(dia, iso) {
  const c = cfgConv(), cv = dia.convSab;
  if (!cv) return `<section class="card conv"><h3>Convênio ${esc(c.nome)}</h3>
    <p class="mini">Suba o relatório do sistema do estacionamento (Excel, CSV) ou cole o texto copiado da tela. O app separa os carros com "${esc(c.filtro)}" na tabela de preço e calcula as vagas por hora.</p>
    <label class="btn arquivo">📄 Subir relatório<input type="file" id="convArq" accept=".xlsx,.xls,.csv,.txt,.htm,.html" hidden></label>
    <details><summary class="mini">ou colar o texto</summary><textarea id="convTxt" rows="5" placeholder="Cole aqui as linhas copiadas do relatório (com o cabeçalho)"></textarea><button class="btn" data-act="convColar">Calcular</button></details>
  </section>`;
  const r = cv.res, mudou = ['valorDia', 'vagas', 'valorExtra', 'regra'].some((k) => String(r.cfg[k]) !== String(c[k]));
  const maxH = Math.max(c.vagas, ...r.horas.map((h) => h.max));
  return `<section class="card conv"><h3>Convênio ${esc(c.nome)} <small>${brl(r.total)}</small></h3>
    <div class="placar conv-placar"><div><span class="grande">${r.carros}</span><small>carros do convênio</small></div><div><span class="grande">${r.pico}</span><small>pico simultâneo${r.momentoPico ? ' às ' + r.momentoPico : ''}</small></div><div><span class="grande ${r.extras ? 'neg' : ''}">${r.extras}</span><small>carros extras</small></div></div>
    <div class="horas">${r.horas.map((h) => `<div class="hbar ${h.max > r.cfg.vagas ? 'acima' : ''}" title="${h.rotulo}: ${h.max} simultâneos"><i style="height:${(h.max / maxH) * 100}%"></i><b>${h.max}</b><small>${h.rotulo}</small></div>`).join('')}<em style="bottom:${(r.cfg.vagas / maxH) * 100}%"><span>${r.cfg.vagas} vagas</span></em></div>
    <table class="tab desp"><tbody>
      <tr><td>Valor do dia (até ${r.cfg.vagas} vagas simultâneas)</td><td class="r">${brl(r.valorDia)}</td></tr>
      <tr><td>Extras: ${r.extras} × ${brl(r.cfg.valorExtra)} <small>${esc(V.REGRAS[r.regra] || r.regra)}</small></td><td class="r">${brl(r.valorExtras)}</td></tr>
      <tr class="tot"><td>Total a cobrar</td><td class="r">${brl(r.total)}</td></tr>
    </tbody></table>
    <p class="mini">Período considerado: ${esc(r.cfg.inicio || c.inicio)} às ${esc(r.cfg.fechamento || c.fechamento)}${r.fora ? ` · ${r.fora} carro(s) fora do período não contam` : ''}${(r.momentosExtra || []).length ? ` · passou das ${r.cfg.vagas} vagas às ${r.momentosExtra.join(', ')}` : ''}.</p>
    ${r.semSaida ? `<p class="mini alerta">${r.semSaida} carro(s) sem horário de saída: considerados até ${esc(c.fechamento)}.</p>` : ''}
    ${mudou ? `<p class="mini alerta">Os valores do convênio mudaram em Ajustes depois deste cálculo. <button class="btn link mini" data-act="convRecalc">Recalcular</button></p>` : ''}
    <p class="mini">Lançado em Convênios no caixa do dia. Arquivo: ${esc(cv.arquivo || 'texto colado')}${cv.ignorados ? ` · ${cv.ignorados} linha(s) de outras tabelas ignoradas` : ''}.</p>
    <details><summary class="mini">Ver os ${r.carros} carros</summary><table class="tab"><tbody>${[...cv.carros].sort((a, b) => a.e - b.e).map((x) => `<tr><td>${esc(x.placa)}</td><td>${V.fmtHora(x.e)} → ${x.s == null ? '?' : V.fmtHora(Math.min(x.s, 1439))}</td><td><small>${esc(x.ticket || '')}</small></td></tr>`).join('')}</tbody></table></details>
    <div class="linha"><a class="btn pdfbtn" href="#/convpdf/${iso}">📄 PDF para o parceiro</a><label class="btn arquivo">Trocar relatório<input type="file" id="convArq" accept=".xlsx,.xls,.csv,.txt,.htm,.html" hidden></label><button class="btn link perigo" data-act="convRemover">Remover</button></div>
  </section>`;
}

// ---------- PDF do convênio (página para imprimir / salvar em PDF) ----------
function folhaConvDia(iso, dia) {
  const cv = dia.convSab, r = cv.res, c = cfgConv();
  const extra = new Set(r.placasExtra || []);
  const maxH = Math.max(r.cfg.vagas, ...r.horas.map((h) => h.max), 1);
  const perm = (x) => x.s == null ? '—' : (() => { const m = Math.round(Math.min(x.s, 1439) - x.e); return `${Math.floor(m / 60)}h${C.pad(m % 60)}`; })();
  return `<section class="pdf-pag">
    <header class="pdf-cab"><div><b>ANITA PARKING ESTACIONAMENTO LTDA.</b><small>CNPJ 29.215.496/0001-00 · Porto Alegre/RS</small></div><div class="pdf-tit">Convênio ${esc(c.nome)}<small>${C.ehSabado(iso) ? 'Sábado' : 'Feriado'}, ${dataBR(iso)}</small></div></header>
    <div class="pdf-resumo">
      <div><span>${r.carros}</span><small>carros do convênio</small></div>
      <div><span>${r.pico}</span><small>pico simultâneo${r.momentoPico ? ' (' + r.momentoPico + ')' : ''}</small></div>
      <div><span>${r.extras}</span><small>carros extras</small></div>
      <div class="tot"><span>${brl(r.total)}</span><small>total do dia</small></div>
    </div>
    <table class="pdf-tab conta"><tbody>
      <tr><td>Valor do dia (até ${r.cfg.vagas} vagas simultâneas, das ${esc(r.cfg.inicio || c.inicio)} às ${esc(r.cfg.fechamento || c.fechamento)})</td><td>${brl(r.valorDia)}</td></tr>
      <tr><td>Carros extras: ${r.extras} × ${brl(r.cfg.valorExtra)}${(r.momentosExtra || []).length ? ` (passou das ${r.cfg.vagas} vagas às ${r.momentosExtra.join(', ')})` : ''}</td><td>${brl(r.valorExtras)}</td></tr>
      <tr class="t"><td>Total a pagar</td><td>${brl(r.total)}</td></tr>
    </tbody></table>
    <h4>Carros simultâneos por hora</h4>
    <div class="pdf-horas">${r.horas.map((h) => `<div class="${h.max > r.cfg.vagas ? 'acima' : ''}"><b>${h.max}</b><i style="height:${(h.max / maxH) * 100}%"></i><small>${h.rotulo}</small></div>`).join('')}<em style="bottom:calc(${(r.cfg.vagas / maxH) * 100}% * .78 + 1.1rem)"><span>${r.cfg.vagas} vagas</span></em></div>
    <h4>Carros do convênio (${cv.carros.length})</h4>
    <table class="pdf-tab"><thead><tr><th>#</th><th>Placa</th><th>Entrada</th><th>Saída</th><th>Permanência</th><th>Ticket</th><th></th></tr></thead><tbody>
    ${[...cv.carros].sort((a, b) => a.e - b.e).map((x, i) => `<tr class="${extra.has(x.placa) ? 'ext' : ''}"><td>${i + 1}</td><td><b>${esc(x.placa)}</b></td><td>${V.fmtHora(x.e)}</td><td>${x.s == null ? '—' : V.fmtHora(Math.min(x.s, 1439))}</td><td>${perm(x)}</td><td>${esc(x.ticket || '')}</td><td>${extra.has(x.placa) ? 'extra' : ''}</td></tr>`).join('')}
    </tbody></table>
    <p class="pdf-nota">Gerado em ${dataBR(hojeISO())} a partir do relatório do sistema de estacionamento${cv.arquivo ? ` (${esc(cv.arquivo)})` : ''}. Extras: cada vez que um carro entra com as ${r.cfg.vagas} vagas já ocupadas, dentro do período, conta 1 extra.</p>
  </section>`;
}

async function telaConvPdf(ref) {
  const ehMes = /^\d{4}-\d{2}$/.test(ref);
  const mk = ehMes ? ref : mkDe(ref), M = await mes(mk);
  const dias = Object.entries(M.dias).filter(([dd, d]) => d.convSab && (ehMes || `${mk}-${dd}` === ref)).sort();
  const c = cfgConv();
  if (!dias.length) { $app.innerHTML = moldura('<div class="card">Sem cálculo do convênio para este período.</div>'); return; }
  const tot = dias.reduce((a, [, d]) => a + d.convSab.res.total, 0);
  const capa = ehMes ? `<section class="pdf-pag">
    <header class="pdf-cab"><div><b>ANITA PARKING ESTACIONAMENTO LTDA.</b><small>CNPJ 29.215.496/0001-00 · Porto Alegre/RS</small></div><div class="pdf-tit">Convênio ${esc(c.nome)}<small>Fechamento de ${nomeMes(mk)}</small></div></header>
    <table class="pdf-tab"><thead><tr><th>Data</th><th>Dia</th><th>Carros</th><th>Pico</th><th>Extras</th><th>Valor do dia</th><th>Extras R$</th><th>Total</th></tr></thead><tbody>
    ${dias.map(([dd, d]) => { const r = d.convSab.res, iso = `${mk}-${dd}`; return `<tr><td>${dataBR(iso)}</td><td>${C.ehSabado(iso) ? 'sábado' : 'feriado'}</td><td>${r.carros}</td><td>${r.pico}</td><td>${r.extras}</td><td>${brl(r.valorDia)}</td><td>${brl(r.valorExtras)}</td><td><b>${brl(r.total)}</b></td></tr>`; }).join('')}
    <tr class="t"><td colspan="7">Total a pagar em ${nomeMes(mk)}</td><td>${brl(tot)}</td></tr></tbody></table>
    <p class="pdf-nota">Detalhamento de cada dia nas páginas seguintes.</p></section>` : '';
  const voltar = ehMes ? `#/mes/${mk}` : `#/hoje/${ref}`;
  $app.innerHTML = `<div class="pdf-barra naoimprime"><a class="btn" href="${voltar}">‹ Voltar</a><button class="btn grande-inline" data-act="imprimir">🖨️ Imprimir / salvar PDF</button></div>
    <p class="mini centro naoimprime">No celular: toque em "Imprimir / salvar PDF" e escolha <b>Salvar como PDF</b> (ou compartilhe direto pelo WhatsApp/e-mail).</p>
    <div class="pdf">${capa}${dias.map(([dd, d]) => folhaConvDia(`${mk}-${dd}`, d)).join('')}</div>`;
  document.title = `Convênio ${c.nome} ${ehMes ? nomeMes(mk) : dataBR(ref).replace(/\//g, '-')}`;
  window.scrollTo(0, 0);
}

// grava o resultado do convênio num dia e lança o total em "Convênios" do caixa
async function gravarConvenio(iso, carros, extra) {
  const mk = mkDe(iso), dd = iso.slice(8), M = await mes(mk);
  const dia = M.dias[dd] = M.dias[dd] || {};
  const c = cfgConv();
  const res = V.calcular(carros, c);
  dia.convSab = { arquivo: extra.arquivo || '', enviado: new Date().toISOString(), ignorados: extra.ignorados || 0, carros, res };
  if (!C.ehSabado(iso)) dia.feriado = true;
  dia.det = dia.det || {};
  const lst = dia.det.conv = (dia.det.conv || []).filter((x) => !x.auto);
  if (!lst.length && (dia.pg || {}).conv && !dia.convAutoAntes) lst.push({ nome: 'Convênio (lançado à mão)', valor: dia.pg.conv });
  lst.push({ nome: `${c.nome} (${C.ehSabado(iso) ? 'sábado' : 'feriado'})`, valor: res.total, obs: `${res.carros} carros · pico ${res.pico} · ${res.extras} extras`, auto: true });
  dia.convAutoAntes = true;
  recalcDet(dia, 'conv');
  salvarMes(mk);
  return res;
}

async function processarConvenio(linhas, arquivo) {
  const { carros, ignorados } = V.extrairCarros(linhas, cfgConv().filtro);
  if (!carros.length) { toast(`Nenhum carro com "${cfgConv().filtro}" na tabela de preço.`, true); return; }
  const porData = {};
  for (const x of carros) (porData[x.data] = porData[x.data] || []).push(x);
  const datas = Object.keys(porData).sort();
  const atual = S.ctxDia.iso;
  if (datas.length === 1 && datas[0] !== atual && !confirm(`O relatório é do dia ${dataBR(datas[0])}. Lançar nesse dia?`)) return;
  if (datas.length > 1 && !confirm(`O relatório tem ${datas.length} dias (${datas.map((d) => dataBR(d).slice(0, 5)).join(', ')}). Lançar cada um no seu dia?`)) return;
  let tot = 0;
  for (const d of datas) tot += (await gravarConvenio(d, porData[d].map(({ data, ...r }) => r), { arquivo, ignorados: datas.length === 1 ? ignorados.outros : 0 })).total;
  toast(datas.length > 1 ? `${datas.length} dias lançados · ${brl(tot)}` : `Convênio calculado: ${brl(tot)}`);
  if (datas.length === 1 && datas[0] !== atual) location.hash = '#/hoje/' + datas[0]; else telaDia(atual);
}

// ---------- frota Sulgás ----------
const normPlaca = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const veiculo = (pl) => S.frota.find((x) => normPlaca(x.placa) === normPlaca(pl));
const motoristaDe = (pl) => (veiculo(pl) || {}).nome || '';
function mostrarPlaca(deTroca) {
  const inp = document.getElementById('placaSul'); if (!inp) return;
  const pl = normPlaca(inp.value), info = document.getElementById('infoPlaca'), box = document.getElementById('novoMot');
  const mot = document.getElementById('motSul'), mod = document.getElementById('modSul'), padrao = document.getElementById('motPadraoBox');
  if (pl.length < 7) { info.textContent = 'Digite a placa: o motorista cadastrado aparece aqui.'; info.className = 'mini'; box.hidden = true; mot.value = ''; mot.dataset.auto = ''; return; }
  const v = veiculo(pl);
  box.hidden = false;
  if (v && v.nome) {
    if (!deTroca && (!mot.value || mot.dataset.auto === '1')) { mot.value = v.nome; mot.dataset.auto = '1'; }
    mod.hidden = true;
    const trocou = mot.value.trim() && mot.value.trim() !== v.nome;
    info.innerHTML = `✅ Cadastrado: <b>${esc(v.nome)}</b>${v.modelo ? ' · ' + esc(v.modelo) : ''}${v.cor ? ' · ' + esc(v.cor) : ''}${trocou ? ' · <span class="alerta">nesta lavagem: ' + esc(mot.value.trim()) + '</span>' : ' · pode trocar o nome abaixo'}`;
    info.className = 'mini ok'; padrao.hidden = !trocou;
  } else {
    if (mot.dataset.auto === '1') { mot.value = ''; mot.dataset.auto = ''; }
    mod.hidden = false; padrao.hidden = true;
    info.textContent = v ? 'Placa cadastrada, mas sem motorista. Informe abaixo:' : 'Placa nova na frota. Informe o motorista:'; info.className = 'mini alerta';
  }
}

// ---------- campos do caixa e detalhamento por nome ----------
const campos = () => S.cfg.pagamentos;
const campoNome = (k) => (campos().find((c) => c.k === k) || {}).nome || k;
const detLista = (dia, k) => (dia.det && Array.isArray(dia.det[k]) ? dia.det[k] : []);
const camposDoDia = (dia) => campos().filter((c) => c.ativo !== false || (dia.pg || {})[c.k] || detLista(dia, c.k).length);
function campoCaixa(c, dia) {
  const v = (dia.pg || {})[c.k];
  if (!c.detalhar) return `<label>${esc(c.nome)}${c.ativo === false ? ' <small>(desativado)</small>' : ''}<input inputmode="decimal" data-pg="${c.k}" value="${fmtN(v)}"></label>`;
  const l = detLista(dia, c.k);
  return `<label>${esc(c.nome)}<button type="button" class="btn campo-btn ${S.detAberto === c.k ? 'on' : ''}" data-act="detToggle" data-k="${c.k}">${v ? brl(v) : 'Lançar'}<small>${l.length ? `${l.length} pagamento${l.length > 1 ? 's' : ''}` : 'toque para detalhar'}</small></button></label>`;
}
function blocoDet(dia, k) {
  const l = detLista(dia, k);
  const semDetalhe = !l.length && (dia.pg || {})[k];
  const sug = (S.cfg.nomes || {})[k] || [];
  return `<div class="mens">
    <h4>${esc(campoNome(k))}: pagamentos por nome</h4>
    ${semDetalhe ? `<p class="mini">Este dia tem ${brl(dia.pg[k])} sem detalhamento. Ao incluir o primeiro nome, o total passa a ser a soma da lista.</p>` : ''}
    ${l.length ? `<ol class="lavs">${l.map((m, i) => `<li><span>${esc(m.nome)}${m.obs ? `<small>${esc(m.obs)}</small>` : ''}</span><b>${brl(m.valor)}</b><button class="x" data-act="delDet" data-i="${i}" aria-label="remover">✕</button></li>`).join('')}</ol>
      <p class="mini" style="text-align:right">Total: <b>${brl(l.reduce((a, m) => a + (Number(m.valor) || 0), 0))}</b></p>` : ''}
    <div class="linha"><input id="detNome" list="detNomes" placeholder="Nome" autocomplete="off"><input id="detValor" inputmode="decimal" placeholder="R$" style="max-width:6rem"><button class="btn" data-act="addDet">+</button></div>
    <input id="detObs" placeholder="Obs. (opcional: placa, mês de referência, forma de pgto)" class="obs">
    <datalist id="detNomes">${sug.map((m) => `<option value="${esc(m.nome)}">${m.valor ? brl(m.valor) : ''}</option>`).join('')}</datalist>
  </div>`;
}
function recalcDet(dia, k) {
  dia.pg = dia.pg || {};
  const t = C.r2(detLista(dia, k).reduce((a, m) => a + (Number(m.valor) || 0), 0));
  if (t) dia.pg[k] = t; else delete dia.pg[k];
  if (!detLista(dia, k).length && dia.det) { delete dia.det[k]; if (!Object.keys(dia.det).length) delete dia.det; }
}
async function lembrarNome(k, nome, valor) {
  S.cfg.nomes = S.cfg.nomes || {};
  const lista = S.cfg.nomes[k] = S.cfg.nomes[k] || [];
  const ex = lista.find((m) => m.nome.toLowerCase() === nome.toLowerCase());
  if (ex) { if (ex.valor === valor) return; ex.valor = valor; } else lista.push({ nome, valor });
  lista.sort((a, b) => a.nome.localeCompare(b.nome));
  try { await salvarCfg(); } catch (e) { /* sugestões são só conveniência */ }
}

function diaAtual(criar = true) {
  const { mk, dd } = S.ctxDia; const M = S.meses[mk];
  if (!M.dias[dd] && criar) M.dias[dd] = {};
  return M.dias[dd];
}
function fixarPresenca(dia) {
  if (!dia.presenca || !Object.keys(dia.presenca).length) dia.presenca = { ...C.presencaDia(C.ehSabado(S.ctxDia.iso) ? dia : (dia || {}), S.ctxDia.iso, S.funcs, (S.meses[S.ctxDia.mk].folhaLegado || []).map((e) => e.id)) };
}
function addLav(item) {
  const dia = diaAtual();
  if (!Array.isArray(dia.lav)) dia.lav = [];
  delete dia.legado; delete dia.premioLeg; // dia passa a ser do app: prêmio recalculado pela fórmula
  fixarPresenca(dia);
  dia.lav.push(item); salvarMes(S.ctxDia.mk); telaDia(S.ctxDia.iso);
  if (navigator.vibrate) navigator.vibrate(15);
}

// ---------- TELA: mês ----------
function graficoMes(ap) {
  const n = ap.lista.length, w = 14, h = 110, max = Math.max(12, ...ap.lista.map((l) => l.contados));
  const y = (v) => h - (v / max) * (h - 12);
  const meta = Number(S.cfg.metaDia) || 10;
  const bars = ap.lista.map((l, i) => {
    const cls = C.ehDomingo(l.iso) ? 'dom' : `n${Math.max(0, l.faixa.nivel)}`;
    return `<a href="#/hoje/${l.iso}"><rect class="${cls}" x="${i * w + 2}" y="${y(l.contados)}" width="${w - 4}" height="${h - y(l.contados)}" rx="2"><title>${dataBR(l.iso)}: ${l.contados} veículos</title></rect></a>
    ${l.d % 5 === 0 || l.d === 1 ? `<text x="${i * w + w / 2}" y="${h + 11}">${l.d}</text>` : ''}`;
  }).join('');
  return `<svg class="grafico" viewBox="0 0 ${n * w} ${h + 14}" preserveAspectRatio="none">
    <line x1="0" x2="${n * w}" y1="${y(meta)}" y2="${y(meta)}" class="meta"/><text class="metatxt" x="2" y="${y(meta) - 2}">meta ${meta}</text>${bars}</svg>`;
}

async function telaMes(mk) {
  const M = await mes(mk);
  const ap = C.apuraMes(mk, M, S.cfg, S.funcs);
  const res = C.resultadoMes(ap, M, S.cfg, S.funcs);
  const fm = ap.faixaMes, prox = ap.proxMes;
  const minMes = S.cfg.faixasMes[0].min;
  const alvo = prox ? prox.min : (fm ? fm.min : minMes);
  const progMes = Math.min(100, (ap.tot.contados / (prox ? prox.min : Math.max(ap.tot.contados, 1))) * 100);
  const ativosMes = Object.values(ap.porFunc).filter((p) => p.T);
  const maxPf = ativosMes.reduce((a, p) => Math.max(a, p.premioTotal), 0);

  const corpo = `
  <div class="navdata">
    <a class="btn ic" href="#/mes/${somaMes(mk, -1)}">‹</a><b class="titmes">${nomeMes(mk)}</b><a class="btn ic" href="#/mes/${somaMes(mk, 1)}">›</a>
  </div>
  <div class="kpis seis">
    <div class="kpi"><small>Receita</small><b>${brl(ap.tot.receita)}</b></div>
    <div class="kpi destaque-contador clic" data-act="toggleContador"><small>Ao contador</small><b>${brl(C.aoContador(ap))}</b>${S.contadorAberto ? `<small>Receita ${brl(ap.tot.receita)} − dinheiro ${brl(C.dinheiroMes(ap))}</small>` : ''}</div>
    <div class="kpi"><small>Despesas</small><b>${brl(res.total)}</b></div>
    <div class="kpi"><small>Resultado</small><b class="${res.resultado < 0 ? 'neg' : 'pos'}">${brl(res.resultado)}</b></div>
    <div class="kpi"><small>Estacionamento</small><b>${brl(ap.tot.estacionamento)}</b></div>
    <div class="kpi"><small>Lavagens pagas</small><b>${brl(ap.tot.valorPagas)}</b></div>
  </div>

  <section class="card">
    <h3>Meta do mês <small>${ap.tot.contados} veículos contados</small></h3>
    ${ap.regraNova ? `
      <div class="barra mes"><i style="width:${progMes}%"></i></div>
      <p class="faixa">${fm ? `<b>Meta mensal ${fm.nivel}</b> · bônus ${brl(fm.valor)} por pessoa` : `<b>Abaixo da meta mensal</b> (mínimo ${minMes})`}${prox ? ` · faltam <b>${prox.min - ap.tot.contados}</b> para ${brl(prox.valor)}` : ''}</p>
      <p class="mini">Pagas ${ap.tot.pagas} · Cortesias ${ap.tot.cort} · Sulgás ${ap.tot.sulgas}${ap.tot.retornos ? ` · Retornos ${ap.tot.retornos}` : ''} · Base de cálculo ${brl(ap.tot.base)}</p>
      <p>Prêmio até agora (quem trabalhou todos os dias): <b>${brl(maxPf)}</b></p>`
    : `<p>Prêmio pago pela regra antiga: <b>${brl(ap.tot.premioPessoaDia)}</b> por pessoa.</p>
       ${(() => { const bn = (C.faixaMes(ap.tot.contados, S.cfg) || {}).valor || 0; const tn = C.r2(ap.tot.simNova + bn); const dif = C.r2(tn - ap.tot.premioPessoaDia);
         return `<p>Pela regra nova seria: <b>${brl(tn)}</b> por pessoa <small>(${dif >= 0 ? '+' : '−'}${brl(Math.abs(dif))})</small></p>
         <p class="mini">${brl(ap.tot.simNova)} em prêmios diários${bn ? ` + bônus de ${brl(bn)}` : ' · sem bônus mensal'} · pagas ${ap.tot.pagas} · cortesias ${ap.tot.cort} · Sulgás ${ap.tot.sulgas}. Considera quem trabalhou todos os dias.</p>`; })()}`}
    ${graficoMes(ap)}
  </section>

  ${campos().filter((c) => c.detalhar).map((c) => {
    const pags = ap.lista.flatMap((l) => detLista(l.dia || {}, c.k).map((m) => ({ ...m, iso: l.iso })));
    const total = ap.lista.reduce((a, l) => a + (Number(((l.dia || {}).pg || {})[c.k]) || 0), 0);
    if (!total && !pags.length) return '';
    const semDet = C.r2(total - pags.reduce((a, m) => a + (Number(m.valor) || 0), 0));
    return `<section class="card"><h3>${esc(c.nome)} <small>${brl(total)} no mês</small></h3>
      ${pags.length ? `<table class="tab"><tbody>${pags.sort((a, b) => a.nome.localeCompare(b.nome) || a.iso.localeCompare(b.iso)).map((m) => `<tr data-href="#/hoje/${m.iso}"><td>${esc(m.nome)}${m.obs ? `<small>${esc(m.obs)}</small>` : ''}</td><td>${dataBR(m.iso).slice(0, 5)}</td><td class="r">${brl(m.valor)}</td></tr>`).join('')}</tbody></table>` : ''}
      ${semDet > 0.009 ? `<p class="mini">${brl(semDet)} lançados sem nome (dias importados ou sem detalhe).</p>` : ''}</section>`;
  }).join('')}

  ${(() => {
    const dias = ap.lista.filter((l) => l.dia && l.dia.convSab);
    if (!dias.length) return '';
    const tot = dias.reduce((a, l) => a + l.dia.convSab.res.total, 0);
    return `<section class="card"><h3>Convênio ${esc(cfgConv().nome)} <small>${brl(tot)} a faturar</small></h3>
      <table class="tab"><thead><tr><th>Dia</th><th>Carros</th><th>Pico</th><th>Extras</th><th>Total</th></tr></thead><tbody>
      ${dias.map((l) => { const r = l.dia.convSab.res; return `<tr data-href="#/hoje/${l.iso}"><td>${C.pad(l.d)} <small>${C.ehSabado(l.iso) ? 'sáb' : 'feriado'}</small></td><td>${r.carros}</td><td>${r.pico}</td><td class="${r.extras ? 'neg' : ''}">${r.extras}</td><td>${brl(r.total)}</td></tr>`; }).join('')}
      </tbody></table>
      <div class="linha"><a class="btn pdfbtn" href="#/convpdf/${mk}">📄 PDF do mês para o parceiro</a><button class="btn link" data-act="convCopiar">Copiar resumo</button></div></section>`;
  })()}

  ${(() => {
    const cs = ap.lista.flatMap((l) => ((l.dia || {}).lav || []).filter((x) => x.t === 'cortesia').map((x) => ({ ...x, iso: l.iso })));
    if (!cs.length) return '';
    const porNome = {}; for (const c of cs) { const k = c.cliente || '(sem nome)'; porNome[k] = (porNome[k] || 0) + 1; }
    return `<section class="card"><h3>Cortesias <small>${cs.length} no mês</small></h3>
      <table class="tab"><tbody>${cs.map((c) => `<tr data-href="#/hoje/${c.iso}"><td>${dataBR(c.iso).slice(0, 5)}</td><td><b>${esc(c.cliente || '(sem nome)')}</b>${c.desc ? `<small>${esc(c.desc)}</small>` : ''}</td><td class="r"><small>${porNome[c.cliente || '(sem nome)'] > 1 ? porNome[c.cliente || '(sem nome)'] + 'ª no mês' : ''}</small></td></tr>`).join('')}</tbody></table></section>`;
  })()}

  <section class="card">
    <h3>Dias</h3>
    <table class="tab"><thead><tr><th>Dia</th><th>Carros</th><th>Base</th><th>Faixa</th><th>Prêmio/p.</th></tr></thead><tbody>
    ${ap.lista.filter((l) => l.temDados || !C.ehDomingo(l.iso)).map((l) => `<tr data-href="#/hoje/${l.iso}" class="${l.temDados ? '' : 'semdados'}">
      <td>${C.pad(l.d)} <small>${SEM[C.diaSemana(l.iso)].slice(0, 3)}</small></td><td>${l.contados || ''}</td><td>${l.base ? brl(l.base) : ''}</td>
      <td>${l.regra === 'nova' ? `<span class="tag n${l.faixa.nivel}">${l.faixa.pct ? pct(l.faixa.pct) : '—'}</span>` : ''}</td><td>${l.porPessoa ? brl(l.porPessoa) : ''}</td></tr>`).join('')}
    </tbody></table>
  </section>

  <section class="card">
    <h3>Despesas e resultado <a class="tag" href="#/despesas/${mk}">lançar / detalhar →</a></h3>
    <table class="tab desp"><tbody>
      <tr><td>Receitas</td><td class="r"><b>${brl(ap.tot.receita)}</b></td><td></td></tr>
      ${res.auto.map((d) => `<tr><td>${esc(d.desc)} <span class="tag">auto</span></td><td class="r">${d.valor < 0 ? '+' + brl(-d.valor) : '−' + brl(d.valor)}</td><td></td></tr>`).join('')}
      ${res.legadas.map((d) => `<tr><td>${esc(d.desc)}${d.obs ? `<small>${esc(d.obs)}</small>` : ''}</td><td class="r">−${brl(d.valor)}</td><td></td></tr>`).join('')}
      ${porTipo(res.manuais).map((g) => `<tr data-href="#/despesas/${mk}"><td>${esc(g.nome)}<small>${g.n} lançamento${g.n > 1 ? 's' : ''}</small></td><td class="r">−${brl(g.valor)}</td><td></td></tr>`).join('')}
      <tr class="tot"><td>Resultado</td><td class="r"><b>${brl(res.resultado)}</b></td><td>${ap.tot.receita ? Math.round(res.resultado / ap.tot.receita * 100) + '%' : ''}</td></tr>
    </tbody></table>
    ${res.legadas.length ? '<p class="mini">Despesas sem tipo vieram da planilha.</p>' : ''}
  </section>`;
  $app.innerHTML = moldura(corpo, 'Painel do mês');
  S.ctxMes = mk;
}

// ---------- TELA: equipe / folha ----------
async function telaEquipe(mk) {
  const M = await mes(mk);
  const ap = C.apuraMes(mk, M, S.cfg, S.funcs);
  // meses da planilha abrem já editáveis: os valores importados viram o ponto de partida
  const daPlanilha = (M.folhaLegado || []).length && !M.folhaApp;
  if (daPlanilha) prepararFolhaDaPlanilha(M);
  let folha = '';
  {
    const fm = ap.faixaMes;
    const lista = S.funcs.filter((f) => { const pf = ap.porFunc[f.id]; return C.ativoEm(f, `${mk}-15`) || (pf && (pf.T || pf.F || pf.J || pf.premioDiario)) || ((M.folha || {})[f.id]); }).sort((a, b) => a.nome.localeCompare(b.nome));
    const linhas = lista.map((f) => {
      const pf = ap.porFunc[f.id] || { T: 0, F: 0, J: 0, previstos: 0, presencaPct: 0, premioDiario: 0, bonus: 0, premioTotal: 0, elegivelBonus: false, dias: [] };
      const fo = (M.folha || {})[f.id] || {};
      return { f, pf, fo, r: C.folhaFunc(f, pf, fo, S.cfg, mk) };
    });
    // VT do mês seguinte (pago junto no dia 1º)
    const mkProx = somaMes(mk, 1), Mp = await mes(mkProx), diaPg = C.diaPagamento(mk);
    for (const l of linhas) l.vtProx = C.folhaFunc(l.f, null, (Mp.folha || {})[l.f.id], S.cfg, mkProx);
    const soma = (k) => C.r2(linhas.reduce((a, l) => a + l.r[k], 0));
    const resumo = `<section class="card"><h3>Resumo da folha${daPlanilha ? ' <small>valores vindos da planilha, todos editáveis abaixo</small>' : ''}</h3>
      <div class="rola"><table class="tab resumo-folha"><thead><tr><th>Nome</th><th>Salário</th><th>Prêmio</th><th>Extras</th><th>Desc.</th><th>Total</th><th>VT</th></tr></thead><tbody>
      ${linhas.map(({ f, r }) => `<tr data-ancora="func-${f.id}" class="clic"><td><b>${esc(f.nome)}</b><small>${r.diasTrab} dias</small></td><td>${brl(r.salario)}</td><td>${brl(r.premio)}</td><td>${r.extras ? brl(r.extras) : '—'}</td><td>${r.descontos ? '−' + brl(r.descontos) : '—'}</td><td><b>${brl(r.total)}</b></td><td>${brl(r.vt)}</td></tr>`).join('')}
      <tr class="tot"><td>Total</td><td>${brl(soma('salario'))}</td><td>${brl(soma('premio'))}</td><td>${brl(soma('extras'))}</td><td>${soma('descontos') ? '−' + brl(soma('descontos')) : '—'}</td><td>${brl(soma('total'))}</td><td>${brl(soma('vt'))}</td></tr>
      </tbody></table></div>
      <p class="mini">Total a desembolsar: <b>${brl(C.r2(soma('total') + soma('vt')))}</b> (folha + VT).</p></section>`;
    const somaP = (fn) => C.r2(linhas.reduce((a, l) => a + fn(l), 0));
    const pagamento = `<section class="card pagamento"><h3>💵 Pagamento de ${dataBR(diaPg)} <small>${nomeMes(mk).split(' ')[0]} + VT de ${nomeMes(mkProx).split(' ')[0]}</small></h3>
      <div class="rola"><table class="tab resumo-folha"><thead><tr><th>Nome</th><th>Prêmio</th><th>Extras</th><th>Desc.</th><th>VT ${nomeMes(mkProx).slice(0, 3)}</th><th>Pagar dia 1º</th></tr></thead><tbody>
      ${linhas.map((l) => `<tr><td><b>${esc(l.f.nome)}</b></td><td>${brl(l.r.premio)}</td><td>${l.r.extras ? brl(l.r.extras) : '—'}</td><td>${l.r.descontos ? '−' + brl(l.r.descontos) : '—'}</td>
        <td><input class="mini-in" inputmode="numeric" data-folha-prox="${l.f.id}" value="${l.vtProx.vtDias}" title="dias de VT de ${nomeMes(mkProx)}"> × ${brl(l.vtProx.vtDia)}<br><b>${brl(l.vtProx.vt)}</b></td>
        <td><b>${brl(C.r2(l.r.variavel + l.vtProx.vt))}</b></td></tr>`).join('')}
      <tr class="tot"><td>Total</td><td>${brl(somaP((l) => l.r.premio))}</td><td>${brl(somaP((l) => l.r.extras))}</td><td>${somaP((l) => l.r.descontos) ? '−' + brl(somaP((l) => l.r.descontos)) : '—'}</td><td>${brl(somaP((l) => l.vtProx.vt))}</td><td>${brl(somaP((l) => l.r.variavel + l.vtProx.vt))}</td></tr>
      </tbody></table></div>
      <p class="mini">No dia 1º vão prêmios, extras e descontos de ${nomeMes(mk).split(' ')[0]} e o VT de ${nomeMes(mkProx).split(' ')[0]} (previsto em ${C.diasUteis(mkProx)} dias úteis; ajuste os dias acima). Salários: ${brl(somaP((l) => l.r.salario))}, pagos à parte.</p></section>`;
    folha = pagamento + resumo + linhas.map(({ f, pf, fo, r }) => {
      const motivo = !ap.regraNova ? 'regra antiga: sem bônus' : !fm ? 'equipe abaixo da meta mensal' : (pf.elegivelBonus ? `meta mensal ${fm.nivel}` : `presença ${Math.round(pf.presencaPct * 100)}% < ${S.cfg.presencaMin}%`);
      const item = (k, e, i, sinal) => `<div class="item-folha"><span>${sinal}</span><input data-fitem="${f.id}" data-k="${k}" data-i="${i}" data-c="desc" value="${esc(e.desc)}" placeholder="Descrição"><input data-fitem="${f.id}" data-k="${k}" data-i="${i}" data-c="valor" inputmode="decimal" value="${fmtN(e.valor)}" class="v"><button class="x" data-act="delFolha" data-id="${f.id}" data-k="${k}" data-i="${i}">✕</button></div>`;
      return `<section class="card func" id="func-${f.id}">
        <h3>${esc(f.nome)} <small>${esc(f.funcao || 'função não definida')}</small></h3>
        <p class="mini">Trabalhou ${pf.T} · Faltas ${pf.F} · Justificadas ${pf.J}${pf.previstos ? ` · Presença ${Math.round(pf.presencaPct * 100)}%` : ''}</p>
        <div class="grade-folha">
          <label>Salário do mês (R$)<input data-folha="${f.id}" data-k="salMes" inputmode="decimal" value="${fmtN(r.salMes)}"></label>
          <label>Dias trabalhados (de 30)<input data-folha="${f.id}" data-k="diasTrab" inputmode="numeric" value="${r.diasTrab}"></label>
          <div class="calc">= salário <b>${brl(r.salario)}</b></div>
          <label>Prêmio do mês (R$)<input data-folha="${f.id}" data-k="premioManual" inputmode="decimal" value="${fo.premioManual != null ? fmtN(fo.premioManual) : ''}" placeholder="${fmtN(pf.premioTotal) || '0'}"></label>
          <div class="calc span2">${fo.premioManual != null ? `<span class="alerta">${fo.premioOrigem === 'planilha' ? 'valor da planilha' : 'valor digitado'}</span> · calculado pelo app:  ${brl(pf.premioTotal)} <button class="btn link mini" data-act="premioAuto" data-id="${f.id}">usar o calculado</button>` : `calculado: diário ${brl(pf.premioDiario)}${ap.regraNova ? ` + bônus ${brl(pf.bonus)} (${motivo})` : ' (regra antiga)'} <a href="#/demo/${mk}/${f.id}" class="tag">demonstrativo</a>`}</div>
          <label>VT deste mês: dias<input data-folha="${f.id}" data-k="vtDias" inputmode="numeric" value="${r.vtDias}"></label>
          <label>VT: valor por dia (R$)<input data-folha="${f.id}" data-k="vtDia" inputmode="decimal" value="${fmtN(r.vtDia)}"></label>
          <div class="calc">= VT <b>${brl(r.vt)}</b></div>
        </div>
        ${r.fixos.length ? `<h4>Lançamentos fixos</h4>${r.fixos.map((x) => `<div class="item-folha ${x.ativo ? '' : 'riscado'}"><span>${x.sinal === '+' ? '+' : '−'}</span><span class="fixo-desc">${esc(x.desc)} <span class="tag">fixo${x.pct != null ? ' ' + pct(x.pct) : ''}</span></span><b>${brl(x.valor)}</b><button class="btn link mini" data-act="fixoMes" data-id="${f.id}" data-i="${x.i}">${x.ativo ? 'não lançar' : 'lançar'}</button></div>`).join('')}` : ''}
        <h4>Extras</h4>
        ${(fo.extras || []).map((e, i) => item('extras', e, i, '+')).join('') || '<p class="mini">Nenhum extra neste mês.</p>'}
        <button class="btn link" data-act="addFolhaItem" data-id="${f.id}" data-k="extras">+ Extra</button>
        <h4>Descontos</h4>
        ${(fo.descontos || []).map((e, i) => item('descontos', e, i, '−')).join('') || '<p class="mini">Nenhum desconto neste mês.</p>'}
        <button class="btn link" data-act="addFolhaItem" data-id="${f.id}" data-k="descontos">+ Desconto</button>
        <div class="total-folha"><span>Total a pagar</span><b>${brl(r.total)}</b></div>
        <p class="mini">Salário ${brl(r.salario)} · no dia ${dataBR(diaPg).slice(0, 5)}: prêmio ${brl(r.premio)}${r.extras ? ` + extras ${brl(r.extras)}` : ''}${r.descontos ? ` − descontos ${brl(r.descontos)}` : ''} = <b>${brl(r.variavel)}</b> (+ VT do mês seguinte). VT deste mês (pago em ${dataBR(mk + '-01').slice(0, 5)}): ${brl(r.vt)}.</p>
        <input class="obs" data-folha="${f.id}" data-k="obs" placeholder="Observação (ex.: pago em 05/12)" value="${esc(fo.obs || '')}">
      </section>`;
    }).join('') + ((M.folhaLegado || []).length ? `<section class="card"><details><summary class="mini">Ver a folha original da planilha</summary>
      <table class="tab"><thead><tr><th>Nome</th><th>Salário</th><th>Prêmio</th><th>Desc.</th><th>Total</th></tr></thead><tbody>
      ${M.folhaLegado.map((e) => `<tr><td>${esc(e.nome)}<small>${e.diasTrab}/${e.diasMes} dias${e.vtDias ? ` · VT ${e.vtDias}×${brl(e.vtDia)}` : ''}${e.obs ? ' · ' + esc(e.obs) : ''}</small></td><td>${brl(e.salario)}</td><td>${brl(e.premio ?? e.extras)}</td><td>${e.descontos ? brl(e.descontos) : ''}</td><td><b>${brl(e.total)}</b></td></tr>`).join('')}
      </tbody></table><button class="btn link perigo" data-act="folhaRestaurar">Desfazer minhas alterações e voltar aos valores da planilha</button></details></section>` : '');
  }

  const ficha = (f) => `
    <details class="cad" ${S.fichaAberta === f.id ? 'open' : ''} data-ficha="${f.id}"><summary>${esc(f.nome)} <small>${f.ativo === false ? 'inativo' : `${esc(f.funcao || '')} · ${brl(f.salario)}`}</small></summary>
      <form class="fFunc" data-id="${f.id}">
        <div class="grade2">
          <label>Nome<input name="nome" value="${esc(f.nome)}" required></label>
          <label>Função<select name="funcao">${['', 'lavador', 'atendente'].map((o) => `<option ${f.funcao === o ? 'selected' : ''} value="${o}">${o || '—'}</option>`).join('')}</select></label>
          <label>Salário (R$/mês)<input name="salario" inputmode="decimal" value="${fmtN(f.salario)}"></label>
          <label>VT por dia (R$)<input name="vtDia" inputmode="decimal" value="${fmtN(f.vtDia)}"></label>
          <label>Dias de VT por mês<input name="vtDiasPadrao" inputmode="numeric" value="${f.vtDiasPadrao || ''}" placeholder="= dias trabalhados"></label>
          <label>Telefone<input name="telefone" inputmode="tel" value="${esc(f.telefone || '')}"></label>
          <label>Admissão<input type="date" name="admissao" value="${f.admissao || ''}"></label>
          <label>Desligamento<input type="date" name="desligamento" value="${f.desligamento || ''}"></label>
          <label>Chave PIX<input name="pix" value="${esc(f.pix || '')}"></label>
          <label class="chk"><input type="checkbox" name="ativo" ${f.ativo !== false ? 'checked' : ''}> Ativo</label>
        </div>
        <button class="btn grande">Salvar cadastro</button>
      </form>
      <h4>Lançamentos fixos todo mês</h4>
      ${(f.fixos || []).length ? `<table class="tab desp"><tbody>${f.fixos.map((x, i) => `<tr><td>${x.sinal === '-' ? '−' : '+'} ${esc(x.desc)}</td><td class="r">${x.tipo === 'pct' ? pct(x.valor) + ' do salário' : brl(x.valor)} <button class="x" data-act="delFixo" data-id="${f.id}" data-i="${i}">✕</button></td></tr>`).join('')}</tbody></table>` : '<p class="mini">Ex.: + Gratificação de caixa 10% · − Adiantamento R$ 500 · − VT 6%.</p>'}
      <form class="linha fFixo" data-id="${f.id}">
        <select name="sinal" style="max-width:4.2rem"><option value="+">+</option><option value="-">−</option></select>
        <input name="desc" placeholder="Descrição" required>
        <input name="valor" inputmode="decimal" placeholder="valor" required style="max-width:4.8rem">
        <select name="tipo" style="max-width:5.2rem"><option value="valor">R$</option><option value="pct">% sal.</option></select>
        <button class="btn">+</button>
      </form>
      ${f.ativo === false ? `<button class="btn link perigo" data-act="excluirFunc" data-id="${f.id}">Excluir funcionário</button>` : ''}
    </details>`;

  const corpo = `
  <div class="navdata"><a class="btn ic" href="#/equipe/${somaMes(mk, -1)}">‹</a><b class="titmes">${nomeMes(mk)}</b><a class="btn ic" href="#/equipe/${somaMes(mk, 1)}">›</a></div>
  ${folha}
  <section class="card">
    <h3>Cadastro de funcionários</h3>
    <p class="mini">Salário, VT, telefone, PIX e lançamentos fixos (que entram todo mês na folha). Extras e descontos de um mês só são lançados na folha, acima.</p>
    ${[...S.funcs].sort((a, b) => (b.ativo !== false) - (a.ativo !== false) || a.nome.localeCompare(b.nome)).map(ficha).join('')}
    <form class="linha" id="fNovoFunc"><input name="nome" placeholder="Novo funcionário" required><button class="btn">+ Adicionar</button></form>
  </section>`;
  $app.innerHTML = moldura(corpo, 'Equipe e folha');
  S.ctxEquipe = mk;

  document.querySelectorAll('details[data-ficha]').forEach((d) => d.addEventListener('toggle', () => { if (d.open) S.fichaAberta = d.dataset.ficha; else if (S.fichaAberta === d.dataset.ficha) S.fichaAberta = null; }));
  document.querySelectorAll('.fExtra').forEach((fm) => fm.onsubmit = (ev) => {
    ev.preventDefault(); const fd = new FormData(fm); const id = fm.dataset.id;
    M.folha = M.folha || {}; M.folha[id] = M.folha[id] || {}; const k = fd.get('k');
    (M.folha[id][k] = M.folha[id][k] || []).push({ desc: fd.get('desc').trim(), valor: num(fd.get('valor')) });
    salvarMes(mk); telaEquipe(mk);
  });
  document.querySelectorAll('.fFunc').forEach((fm) => fm.onsubmit = async (ev) => {
    ev.preventDefault(); const fd = new FormData(fm); const f = S.funcs.find((x) => x.id === fm.dataset.id);
    Object.assign(f, { nome: fd.get('nome').trim(), funcao: fd.get('funcao'), salario: num(fd.get('salario')), vtDia: num(fd.get('vtDia')), vtDiasPadrao: num(fd.get('vtDiasPadrao')) || null,
      telefone: fd.get('telefone').trim(), pix: fd.get('pix').trim(), admissao: fd.get('admissao') || null, desligamento: fd.get('desligamento') || null, ativo: !!fd.get('ativo') });
    await salvarFunc(f); toast('Cadastro salvo'); telaEquipe(mk);
  });
  document.querySelectorAll('.fFixo').forEach((fm) => fm.onsubmit = async (ev) => {
    ev.preventDefault(); const fd = new FormData(fm); const f = S.funcs.find((x) => x.id === fm.dataset.id);
    (f.fixos = f.fixos || []).push({ desc: fd.get('desc').trim(), sinal: fd.get('sinal'), tipo: fd.get('tipo'), valor: num(fd.get('valor')) });
    S.fichaAberta = f.id; await salvarFunc(f); toast('Lançamento fixo salvo'); telaEquipe(mk);
  });
  document.getElementById('fNovoFunc').onsubmit = async (ev) => {
    ev.preventDefault(); const nome = new FormData(ev.target).get('nome').trim();
    let id = slug(nome) || 'func'; while (S.funcs.find((f) => f.id === id)) id += '2';
    const base = S.funcs.find((x) => x.ativo !== false) || {};
    const f = { id, nome, funcao: '', salario: base.salario || 0, vtDia: base.vtDia || 22, ativo: true, admissao: hojeISO() };
    S.funcs.push(f); S.fichaAberta = id; await salvarFunc(f); toast('Adicionado. Confira salário, VT e admissão.'); telaEquipe(mk);
  };
}

function prepararFolhaDaPlanilha(M) {
  const base = C.folhaDaPlanilha(M);
  M.folha = M.folha || {};
  for (const [id, fo] of Object.entries(base)) M.folha[id] = { ...fo, ...(M.folha[id] || {}) };
  M.folhaApp = true; // passa a valer a folha do app (salva na primeira alteração)
}

// ---------- TELA: demonstrativo (Regulamento 4.3) ----------
async function telaDemo(mk, id) {
  const M = await mes(mk);
  const ap = C.apuraMes(mk, M, S.cfg, S.funcs);
  const pf = ap.porFunc[id];
  const f = S.funcs.find((x) => x.id === id) || { nome: id };
  if (!pf) { $app.innerHTML = moldura('<div class="card">Sem dados.</div>'); return; }
  const presMap = {};
  ap.lista.forEach((l) => { presMap[l.iso] = C.presencaDia(l.dia, l.iso, S.funcs, (M.folhaLegado || []).map((e) => e.id))[id]; });
  const fm = ap.faixaMes;
  const corpo = `
  <div class="naoimprime linha"><a class="btn" href="#/equipe/${mk}">‹ Equipe</a><button class="btn" data-act="imprimir">Imprimir / PDF</button></div>
  <section class="card demo">
    <h2>Demonstrativo do Prêmio da Lavagem</h2>
    <p>ANITA PARKING ESTACIONAMENTO LTDA. · CNPJ 29.215.496/0001-00</p>
    <p><b>${esc(f.nome)}</b>${f.funcao ? ` · ${esc(f.funcao)}` : ''} · Mês de apuração: <b>${nomeMes(mk)}</b></p>
    <div class="rola"><table class="tab"><thead><tr><th>Data</th><th>Pres.</th><th>Veículos</th><th>Base de cálculo</th><th>Faixa</th><th>Prêmio</th></tr></thead><tbody>
    ${ap.lista.filter((l) => l.temDados || presMap[l.iso]).map((l) => { const s = presMap[l.iso] || 'X'; const v = s === 'T' && l.regra === 'nova' ? l.porPessoa : 0;
      return `<tr><td>${dataBR(l.iso).slice(0, 5)} <small>${SEM[C.diaSemana(l.iso)].slice(0, 3)}</small></td><td>${C.PRESENCA[s].curto}</td><td>${l.contados}</td><td>${brl(l.base)}</td><td>${l.regra === 'nova' ? (l.faixa.pct ? pct(l.faixa.pct) : '—') : 'antiga'}</td><td>${v ? brl(v) : '—'}</td></tr>`; }).join('')}
    </tbody></table></div>
    <table class="tab desp"><tbody>
      <tr><td>Soma dos prêmios diários</td><td class="r">${brl(pf.premioDiario)}</td></tr>
      <tr><td>Veículos contados no mês (equipe): ${ap.tot.contados}${fm ? ` · Meta mensal ${fm.nivel}` : ' · meta mensal não atingida'}</td><td></td></tr>
      <tr><td>Dias trabalhados ${pf.T} de ${pf.previstos} previstos (${pf.previstos ? Math.round(pf.presencaPct * 100) : 0}%; mínimo ${S.cfg.presencaMin}%)</td><td></td></tr>
      <tr><td>Bônus mensal</td><td class="r">${brl(pf.bonus)}</td></tr>
      <tr class="tot"><td>Prêmio do mês</td><td class="r">${brl(pf.premioTotal)}</td></tr>
    </tbody></table>
    <p class="mini">Apurado conforme o Regulamento do Programa de Premiação da Lavagem. Contestação em até 5 dias úteis do recebimento (cláusula 4.5).</p>
    <div class="assin"><span>Empresa</span><span>Empregado(a)</span></div>
  </section>`;
  $app.innerHTML = moldura(corpo, 'Demonstrativo');
}

// ---------- TELA: análise ----------
async function carregarTodosMeses() {
  if (S.todosCarregados) return;
  for (const m of await S.store.list('meses')) { const { id, ...r } = m; if (!S.meses[id]) { S.meses[id] = { dias: {}, ...r }; if (migrarDespesasPlanilha(id, S.meses[id])) salvarMes(id); } }
  S.todosCarregados = true;
}
const pctVar = (a, b) => (b ? Math.round(((a - b) / Math.abs(b)) * 100) : null);
const seta = (v, inverso) => v == null ? '' : `<span class="var ${(inverso ? -v : v) >= 0 ? 'pos' : 'neg'}">${v > 0 ? '▲' : v < 0 ? '▼' : '='} ${Math.abs(v)}%</span>`;

function graficoBarras(itens, { valor, rotulo, fmt = (v) => v, destaque = () => false, alt = 150 }) {
  const n = itens.length; if (!n) return '';
  const w = Math.max(18, Math.min(60, 320 / n)), max = Math.max(...itens.map(valor), 1), h = alt;
  return `<svg class="grafico barras" viewBox="0 0 ${n * w} ${h + 26}" preserveAspectRatio="none">${itens.map((it, i) => {
    const v = valor(it), bh = (v / max) * (h - 16);
    return `<rect class="${destaque(it) ? 'n3' : 'n1'}" x="${i * w + 3}" y="${h - bh}" width="${w - 6}" height="${bh}" rx="2"><title>${esc(rotulo(it))}: ${esc(fmt(v))}</title></rect>
      ${n <= 16 ? `<text x="${i * w + w / 2}" y="${h - bh - 3}" class="val">${esc(fmt(v))}</text>` : ''}
      <text x="${i * w + w / 2}" y="${h + 12}">${esc(rotulo(it))}</text>`;
  }).join('')}</svg>`;
}

async function telaAnalise(tipo, ref) {
  status('Carregando…'); await carregarTodosMeses(); status('');
  let ini, fim, rotulo;
  if (tipo === 'per') { [ini, fim] = ref.split('~'); if (!fim || fim < ini) fim = ini; rotulo = `${dataBR(ini)} a ${dataBR(fim)}`; }
  else { const p = A.periodo(tipo, ref); ini = p.ini; fim = p.fim; rotulo = p.rotulo || nomeMes(mkDe(ini)); }
  const an = A.analisar(ini, fim, S.meses, S.cfg, S.funcs);
  const pa = A.anterior(ini, fim, tipo);
  const ant = A.analisar(pa.ini, pa.fim, S.meses, S.cfg, S.funcs);
  const t = an.tot, ta = ant.tot;
  const kpi = (nome, v, va, fmt = brl, inverso) => `<div class="kpi"><small>${nome}</small><b>${fmt(v)}</b>${ta.dias ? seta(pctVar(v, va), inverso) : ''}</div>`;
  const nf = (v) => String(v).replace('.', ',');
  const porDowUteis = an.porDow.filter((d) => d.i >= 1 && d.i <= 5);
  const fracos = [...porDowUteis].sort((a, b) => a.carros - b.carros || a.avulso - b.avulso);
  const nomeCampo = (k) => ((S.cfg.pagamentos || []).find((c) => c.k === k) || {}).nome || k;
  const totCampos = Object.values(an.campos).reduce((a, b) => a + b, 0) || 1;
  const navAlvo = (n) => tipo === 'per' ? null : `#/analise/${tipo}/${A.deslocar(tipo, ini, n)}`;

  const corpo = `
  <div class="seg periodo">${[['mes', 'Mês'], ['tri', 'Trimestre'], ['ano', 'Ano'], ['per', 'Período']].map(([k, n]) => `<button data-act="anTipo" data-t="${k}" class="${tipo === k ? 'on' : ''}">${n}</button>`).join('')}</div>
  ${tipo === 'per' ? `<div class="linha"><input type="date" id="anIni" value="${ini}"><span>a</span><input type="date" id="anFim" value="${fim}"><button class="btn" data-act="anAplicar">ok</button></div>`
    : `<div class="navdata"><a class="btn ic" href="${navAlvo(-1)}">‹</a><b class="titmes">${esc(rotulo)}</b><a class="btn ic" href="${navAlvo(1)}">›</a></div>`}
  ${!t.dias ? '<section class="card"><p class="vazio">Sem movimento registrado neste período.</p></section>' : `
  <p class="mini centro">${t.dias} dias com movimento${ta.dias ? ` · comparação com ${pa.rotulo || `${dataBR(pa.ini)} a ${dataBR(pa.fim)}`}` : ''}</p>
  <div class="kpis seis">
    ${kpi('Receita', t.receita, ta.receita)}
    ${kpi('Ao contador', t.aoContador, ta.aoContador)}
    ${kpi('Estacionamento', t.estacionamento, ta.estacionamento)}
    ${kpi('Lavagens pagas', t.valorPagas, ta.valorPagas)}
    ${kpi('Carros lavados', t.contados, ta.contados, (v) => String(v))}
    ${kpi('Média por dia', t.mediaCarros, ta.mediaCarros, (v) => nf(v) + ' carros')}
    ${kpi('Ticket médio lavagem', t.ticket, ta.ticket)}
    ${an.res.mesesInteiros ? kpi('Resultado', C.r2(an.res.resultado), ant.res.mesesInteiros ? C.r2(ant.res.resultado) : 0) : `<div class="kpi"><small>Resultado</small><b>—</b><small>só com meses inteiros</small></div>`}
  </div>

  <section class="card"><h3>Movimento por dia da semana <small>média por dia aberto</small></h3>
    ${graficoBarras(an.porDow, { valor: (d) => d.carros, rotulo: (d) => d.nome.slice(0, 3), fmt: nf, destaque: (d) => d.carros === Math.max(...an.porDow.map((x) => x.carros)) })}
    <table class="tab"><thead><tr><th>Dia</th><th>Carros</th><th>Caixa avulso</th><th>Estac. avulso</th><th>Meta ${S.cfg.metaDia}+</th></tr></thead><tbody>
    ${an.porDow.map((d) => `<tr><td>${d.nome}<small>${d.n} dias</small></td><td><b>${nf(d.carros)}</b></td><td>${brl(d.avulso)}</td><td>${brl(d.estAvulso)}</td><td>${d.i === 6 ? '—' : `${Math.round((d.metaBatida / d.n) * 100)}%`}</td></tr>`).join('')}
    </tbody></table>
    <p class="mini">Caixa avulso = dinheiro + PIX + cartões do dia (sem mensalistas, convênios e faturas, que caem em datas de cobrança). Estac. avulso = caixa avulso − lavagens pagas.</p>
    ${fracos.length >= 2 ? `<div class="dica"><b>Para a escala 5x2:</b> os dias úteis mais fortes são <b>${[...fracos].reverse().slice(0, 2).map((d) => d.nome.toLowerCase()).join(' e ')}</b> (equipe completa). Os mais fracos, ${fracos.slice(0, 2).map((d) => `<b>${d.nome.toLowerCase()}</b> (${nf(d.carros)} carros/dia)`).join(' e ')}, são os melhores candidatos a folgas. Sábado (9h30–15h30) tem média de ${nf((an.porDow.find((d) => d.i === 6) || { carros: 0 }).carros)} carros.</div>` : ''}
  </section>

  <section class="card"><h3>Evolução</h3>
    ${an.porMes.length > 1
      ? graficoBarras(an.porMes, { valor: (m) => m.contados, rotulo: (m) => `${m.mk.slice(5)}/${m.mk.slice(2, 4)}`, fmt: (v) => String(v), destaque: (m) => m.contados === Math.max(...an.porMes.map((x) => x.contados)) })
        + `<table class="tab"><thead><tr><th>Mês</th><th>Carros</th><th>Receita</th><th>Lavagens</th><th>Resultado</th></tr></thead><tbody>${an.porMes.map((m) => `<tr data-href="#/mes/${m.mk}"><td>${nomeMes(m.mk).replace(/ (\d{4})$/, '/$1').slice(0, 3)}/${m.mk.slice(2, 4)}</td><td>${m.contados}</td><td>${brl(m.receita)}</td><td>${brl(m.valorPagas)}</td><td class="${m.resultado < 0 ? 'neg' : ''}">${m.resultado == null ? '<small>parcial</small>' : brl(m.resultado)}</td></tr>`).join('')}</tbody></table>`
      : graficoBarras(an.dias, { valor: (d) => d.contados, rotulo: (d) => String(Number(d.iso.slice(8))), fmt: (v) => String(v), destaque: (d) => d.contados >= (Number(S.cfg.metaDia) || 10) })}
  </section>

  <section class="card"><h3>Destaques</h3>
    <h4>Dias com mais carros lavados</h4>
    <table class="tab"><tbody>${an.topCarros.map((d) => `<tr data-href="#/hoje/${d.iso}"><td>${dataBR(d.iso)} <small>${A.DOW[d.dow]}</small></td><td class="r"><b>${d.contados}</b> carros</td><td class="r">${brl(d.valorPagas)}</td></tr>`).join('')}</tbody></table>
    <h4>Dias de maior movimento no caixa (avulso)</h4>
    <table class="tab"><tbody>${an.topAvulso.map((d) => `<tr data-href="#/hoje/${d.iso}"><td>${dataBR(d.iso)} <small>${A.DOW[d.dow]}</small></td><td class="r"><b>${brl(d.avulso)}</b></td><td class="r">${d.contados} carros</td></tr>`).join('')}</tbody></table>
    <h4>Dias úteis mais fracos</h4>
    <table class="tab"><tbody>${an.fracosUteis.map((d) => `<tr data-href="#/hoje/${d.iso}"><td>${dataBR(d.iso)} <small>${A.DOW[d.dow]}</small></td><td class="r">${d.contados} carro${d.contados === 1 ? "" : "s"}</td><td class="r">${brl(d.avulso)}</td></tr>`).join('')}</tbody></table>
    <p class="mini">Meta da equipe (${S.cfg.metaDia}+ carros) batida em ${an.metaBatida} de ${an.dias.filter((d) => d.dow !== 6).length} dias úteis.</p>
  </section>

  <section class="card"><h3>Lavagens <small>${t.contados} contadas</small></h3>
    <p>Pagas <b>${t.pagas}</b> · Sulgás <b>${t.sulgas}</b> · Cortesias <b>${t.cort}</b>${t.retornos ? ` · Retornos <b>${t.retornos}</b>` : ''}</p>
    <p class="mini">Valor médio por lavagem paga: <b>${brl(t.ticket)}</b>.</p>
    ${an.servicos.length ? (() => { const nTot = an.servicos.reduce((a, x) => a + x.n, 0); const semPreco = t.pagas - nTot; return `<h4>Quais serviços saem mais</h4>
      <table class="tab"><thead><tr><th>Serviço / preço</th><th>Qtd</th><th>%</th><th>Total</th></tr></thead><tbody>${an.servicos.slice(0, 12).map((x) => `<tr><td>${x.nome && x.nome.replace(/\s/g, '') !== brl(x.valor).replace(/\s/g, '') ? `${esc(x.nome)}<small>${brl(x.valor)}</small>` : brl(x.valor)}</td><td>${x.n}</td><td>${Math.round((x.n / nTot) * 100)}%</td><td>${brl(x.total)}</td></tr>`).join('')}</tbody></table>
      <p class="mini">Preço de cada lavagem: tirado das fórmulas da planilha (ex.: 2×69,90 + 54,90) e dos lançamentos no app.${semPreco > 0 ? ` ${semPreco} lavagens do período ficaram de fora porque o dia foi digitado só com o total, sem fórmula.` : ''}</p>
      ${an.servicos.every((x) => !x.nome || x.nome.replace(/\s/g, '') === brl(x.valor).replace(/\s/g, '')) ? '<p class="mini">Dica: dê nomes aos botões de preço em ⚙️ Ajustes (ex.: "Completa SUV") e esta tabela passa a mostrar o serviço.</p>' : ''}`; })() : '<p class="mini">Ainda não há preços de lavagens neste período.</p>'}
  </section>

  <section class="card"><h3>Formas de recebimento</h3>
    ${barras(Object.entries(an.campos).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ nome: nomeCampo(k), valor: v })), (g) => `<small>${Math.round((g.valor / totCampos) * 100)}% da receita</small>`)}
  </section>`}`;
  $app.innerHTML = moldura(corpo, 'Análise');
  S.ctxAn = { tipo, ini, fim };
}

// ---------- TELA: despesas ----------
const nomeCat = (id) => (S.cfg.categorias.find((c) => c.id === id) || {}).nome || (id ? '(tipo removido)' : 'Sem tipo');
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
function porTipo(lista) {
  const g = {};
  for (const d of lista) { const k = d.cat || ''; g[k] = g[k] || { nome: d.cat ? nomeCat(d.cat) : (d.desc || 'Sem tipo'), valor: 0, n: 0 }; g[k].valor = C.r2(g[k].valor + C.valorDesp(d)); g[k].n++; }
  return Object.values(g).sort((a, b) => b.valor - a.valor);
}
function agrupar(lista, chave) {
  const g = {};
  for (const x of lista) { const k = chave(x); if (!k) continue; g[k] = g[k] || { nome: k, valor: 0, qtd: 0, n: 0, un: x.un || '' }; g[k].valor = C.r2(g[k].valor + (Number(x.valor) || 0)); g[k].qtd += Number(x.qtd) || 0; g[k].n++; }
  return Object.values(g).sort((a, b) => b.valor - a.valor);
}
const barras = (grupos, extra = () => '') => { const max = Math.max(1, ...grupos.map((g) => g.valor)); return `<table class="tab"><tbody>${grupos.map((g) => `<tr><td>${esc(g.nome)}${extra(g)}<div class="mbar"><i style="width:${(g.valor / max) * 100}%"></i></div></td><td class="r">${brl(g.valor)}</td></tr>`).join('')}</tbody></table>`; };

function catFixa(f) {
  if (f.cat && S.cfg.categorias.some((c) => c.id === f.cat)) return f.cat;
  const d = (f.desc || '').toLowerCase();
  if (/\balex\b|pr[oó][- ]?labore|retirada/.test(d)) return 'prolabore';
  const w = d.split(/[\s/]+/)[0];
  return (S.cfg.categorias.find((c) => w && c.nome.toLowerCase().includes(w)) || {}).id || 'outros';
}

function rascunhoDespesa(mk) {
  const hoje = hojeISO();
  return { id: uid(), data: mkDe(hoje) === mk ? hoje : `${mk}-01`, cat: 'produtos', forn: '', desc: '', itens: [], valor: 0, obs: '' };
}

async function telaDespesas(mk) {
  const M = await mes(mk);
  if (S.ctxDesp !== mk) S.despEd = null;
  S.ctxDesp = mk;
  const lista = (M.despesas || []).map((d, i) => ({ ...d, _i: i, total: C.valorDesp(d) }));
  const total = C.r2(lista.reduce((a, d) => a + d.total, 0));
  const itens = lista.flatMap((d) => (d.itens || []).map((i) => ({ ...i, forn: d.forn })));
  const ed = S.despEd;
  const fixasLancadas = lista.some((d) => d.fixa);

  const editor = !ed ? '' : (() => {
    const d = ed.d;
    const soma = C.valorDesp(d);
    return `<section class="card editor" id="editorDesp">
      <h3>${ed.novo ? 'Nova despesa' : 'Editar despesa'}</h3>
      <div class="grade2">
        <label>Data<input type="date" data-ed="data" value="${d.data}"></label>
        <label>Tipo<select data-ed="cat">${S.cfg.categorias.map((c) => `<option value="${c.id}" ${d.cat === c.id ? 'selected' : ''}>${esc(c.nome)}</option>`).join('')}</select></label>
      </div>
      <label>Fornecedor<input data-ed="forn" list="fornList" value="${esc(d.forn)}" placeholder="Escolha ou digite um novo" autocomplete="off"></label>
      <datalist id="fornList">${S.cfg.fornecedores.map((f) => `<option value="${esc(f.nome)}">${esc(f.obs || '')}</option>`).join('')}</datalist>
      <label>Descrição (opcional)<input data-ed="desc" value="${esc(d.desc)}" placeholder="Ex.: nota 1234, compra do mês"></label>
      <h4>Itens / materiais</h4>
      ${d.itens.map((it, i) => `<div class="item">
        <input data-edi="${i}" data-k="mat" list="matList" value="${esc(it.mat)}" placeholder="Material" autocomplete="off">
        <input data-edi="${i}" data-k="qtd" inputmode="decimal" value="${fmtN(it.qtd)}" placeholder="Qtd" class="q">
        <input data-edi="${i}" data-k="un" value="${esc(it.un || '')}" placeholder="un" class="u">
        <input data-edi="${i}" data-k="valor" inputmode="decimal" value="${fmtN(it.valor)}" placeholder="R$" class="v">
        <button class="x" data-act="delItem" data-i="${i}">✕</button></div>`).join('')}
      <datalist id="matList">${S.cfg.materiais.map((m) => `<option value="${esc(m.nome)}">${m.un ? esc(m.un) : ''}${m.ultimo ? ' · último ' + brl(m.ultimo) : ''}</option>`).join('')}</datalist>
      <button class="btn link" data-act="addItem">+ Item</button>
      ${d.itens.length ? `<p class="somaitens">Total da nota: <b id="somaDesp">${brl(soma)}</b></p>`
        : `<label>Valor total (sem itens)<input data-ed="valor" inputmode="decimal" value="${fmtN(d.valor)}" placeholder="R$"></label><p class="mini">Para compras de material, use "+ Item": o total vira a soma dos itens.</p>`}
      <label>Observação<input data-ed="obs" value="${esc(d.obs || '')}" placeholder="Forma de pagamento, vencimento…"></label>
      <div class="linha"><button class="btn grande" data-act="salvarDesp">Salvar</button></div>
      <div class="linha"><button class="btn link" data-act="cancelarDesp">Cancelar</button>${ed.novo ? '' : '<span style="flex:1"></span><button class="btn link perigo" data-act="excluirDesp">Excluir despesa</button>'}</div>
    </section>`;
  })();

  const autoMes = !M.semAuto && mk > ULTIMO_MES_PLANILHA;
  const corpo = `
  <div class="navdata"><a class="btn ic" href="#/despesas/${somaMes(mk, -1)}">‹</a><b class="titmes">${nomeMes(mk)}</b><a class="btn ic" href="#/despesas/${somaMes(mk, 1)}">›</a></div>
  <div class="kpis"><div class="kpi"><small>Despesas lançadas</small><b>${brl(total)}</b></div><div class="kpi"><small>Lançamentos</small><b>${lista.length}</b></div></div>
  ${editor || `<div class="linha"><button class="btn grande" data-act="novaDesp">+ Nova despesa</button></div>
    ${(S.cfg.despesasFixas || []).length && !fixasLancadas && mk > MES_PARCIAL_PLANILHA ? `<button class="btn link" data-act="lancarFixas">Lançar despesas fixas do mês (${S.cfg.despesasFixas.map((d) => esc(d.desc)).join(', ')})</button>` : ''}`}

  ${autoMes ? `<p class="mini centro">Salários, VT, prêmios e impostos entram sozinhos (da folha e do caixa) no resultado do mês. Aqui lance as demais despesas.</p>` : ''}
  ${lista.length ? `<section class="card"><h3>Por tipo</h3>${barras(porTipo(lista))}</section>` : ''}

  <section class="card"><h3>Lançamentos</h3>
    ${lista.length ? `<table class="tab"><tbody>${[...lista].sort((a, b) => (b.data || '').localeCompare(a.data || '')).map((d) => `<tr data-act="editarDesp" data-i="${d._i}" class="clic">
      <td>${d.data ? dataBR(d.data).slice(0, 5) : ''}</td>
      <td><b>${esc(d.forn || d.desc || nomeCat(d.cat))}</b>${d.origem === 'planilha' ? ' <span class="tag">planilha</span>' : ''}<small>${esc(nomeCat(d.cat))}${d.itens && d.itens.length ? ' · ' + d.itens.map((i) => esc(i.mat)).join(', ') : (d.desc && d.forn ? ' · ' + esc(d.desc) : '')}</small></td>
      <td class="r">${brl(d.total)}</td></tr>`).join('')}</tbody></table>` : '<p class="vazio">Nenhuma despesa lançada neste mês.</p>'}
    ${(M.despesasLegado || []).length ? `<details><summary class="mini">Despesas importadas da planilha (${brl(M.despesasLegado.reduce((a, d) => a + (Number(d.valor) || 0), 0))})</summary><table class="tab"><tbody>${M.despesasLegado.map((d) => `<tr><td>${esc(d.desc)}${d.obs ? `<small>${esc(d.obs)}</small>` : ''}</td><td class="r">${brl(d.valor)}</td></tr>`).join('')}</tbody></table></details>` : ''}
  </section>

  ${itens.length ? `<section class="card"><h3>Por material</h3>${barras(agrupar(itens, (i) => i.mat), (g) => `<small>${g.qtd ? `${fmtN(C.r2(g.qtd))} ${esc(g.un)} · ` : ''}${g.n} compra${g.n > 1 ? 's' : ''}</small>`)}</section>` : ''}
  ${lista.some((d) => d.forn) ? `<section class="card"><h3>Por fornecedor</h3>${barras(agrupar(lista.map((d) => ({ forn: d.forn, valor: d.total })), (x) => x.forn))}</section>` : ''}

  <section class="card"><h3>Cadastros</h3>
    <details><summary>Fornecedores <small>${S.cfg.fornecedores.length}</small></summary>
      ${S.cfg.fornecedores.map((f, i) => `<div class="linha"><input data-cad="fornecedores" data-i="${i}" data-k="nome" value="${esc(f.nome)}"><input data-cad="fornecedores" data-i="${i}" data-k="obs" value="${esc(f.obs || '')}" placeholder="Telefone, CNPJ…"><button class="x" data-act="delCad" data-cad="fornecedores" data-i="${i}">✕</button></div>`).join('')}
      <button class="btn link" data-act="addCad" data-cad="fornecedores">+ Fornecedor</button></details>
    <details><summary>Tipos de despesa <small>${S.cfg.categorias.length}</small></summary>
      ${S.cfg.categorias.map((c, i) => `<div class="linha"><input data-cad="categorias" data-i="${i}" data-k="nome" value="${esc(c.nome)}"><button class="x" data-act="delCad" data-cad="categorias" data-i="${i}">✕</button></div>`).join('')}
      <button class="btn link" data-act="addCad" data-cad="categorias">+ Tipo</button></details>
    <details><summary>Materiais <small>${S.cfg.materiais.length}</small></summary>
      ${S.cfg.materiais.map((m, i) => `<div class="linha"><input data-cad="materiais" data-i="${i}" data-k="nome" value="${esc(m.nome)}"><input data-cad="materiais" data-i="${i}" data-k="un" value="${esc(m.un || '')}" placeholder="un" style="max-width:4.5rem"><button class="x" data-act="delCad" data-cad="materiais" data-i="${i}">✕</button></div>`).join('')}
      <button class="btn link" data-act="addCad" data-cad="materiais">+ Material</button></details>
    <p class="mini">Fornecedores e materiais novos digitados numa despesa entram aqui sozinhos. Excluir do cadastro não apaga despesas já lançadas.</p>
  </section>`;
  $app.innerHTML = moldura(corpo, 'Despesas');
}

function aprenderCadastros(d) {
  let mudou = false;
  if (d.forn && !S.cfg.fornecedores.some((f) => f.nome.toLowerCase() === d.forn.toLowerCase())) { S.cfg.fornecedores.push({ id: uid(), nome: d.forn }); mudou = true; }
  for (const it of d.itens || []) {
    if (!it.mat) continue;
    let m = S.cfg.materiais.find((x) => x.nome.toLowerCase() === it.mat.toLowerCase());
    if (!m) { m = { id: uid(), nome: it.mat }; S.cfg.materiais.push(m); mudou = true; }
    if (it.un && !m.un) { m.un = it.un; mudou = true; }
    if (it.valor && it.qtd) { const u = C.r2(it.valor / it.qtd); if (m.ultimo !== u) { m.ultimo = u; mudou = true; } }
  }
  S.cfg.fornecedores.sort((a, b) => a.nome.localeCompare(b.nome)); S.cfg.materiais.sort((a, b) => a.nome.localeCompare(b.nome));
  return mudou;
}

// ---------- TELA: Sulgás ----------
async function lavagensSulgas(iso) {
  const per = C.periodoSulgas(iso);
  const mks = [...new Set([mkDe(per.ini), mkDe(per.fim)])];
  for (const mk of mks) await mes(mk);
  const itens = [];
  for (const mk of mks) {
    const M = S.meses[mk];
    for (const s of M.sulgasLista || []) if (s.data >= per.ini && s.data <= per.fim) itens.push({ ...s, ticket: String(s.ticket || '').replace(/\.0+$/, ''), origem: 'planilha' });
    for (const [dd, dia] of Object.entries(M.dias)) {
      const di = `${mk}-${dd}`; if (di < per.ini || di > per.fim) continue;
      (dia.lav || []).forEach((l) => { if (l.t === 'sulgas') itens.push({ data: di, placa: l.placa || '', nome: l.mot || '', valor: l.v, ticket: l.ticket || '' }); });
      if (dia.sulgas && !(M.sulgasLista || []).some((s) => s.data === di)) for (let i = 0; i < dia.sulgas; i++) itens.push({ data: di, placa: '(sem placa)', valor: S.cfg.sulgasValor });
    }
  }
  itens.sort((a, b) => a.data.localeCompare(b.data) || String(a.ticket || '').localeCompare(String(b.ticket || '')));
  return { per, itens };
}

// ---------- Sulgás: fechamentos (da impressão anterior até a atual) ----------
const PRIMEIRO_INICIO_SULGAS = '2026-11-19'; // dia seguinte ao último período da planilha (19/10 a 18/11)
async function fechamentosSulgas() {
  if (!S.fechSul) S.fechSul = ((await S.store.get('sulgas', 'fechamentos')) || {}).lista || [];
  return S.fechSul;
}
async function salvarFechamentosSulgas() { await S.store.set('sulgas', 'fechamentos', { lista: S.fechSul }); }
// lavagens Sulgás lançadas no app ainda não incluídas em nenhum fechamento
async function sulgasEmAberto() {
  const fechs = await fechamentosSulgas();
  const ini = fechs.length ? fechs[fechs.length - 1].fim : PRIMEIRO_INICIO_SULGAS;
  const fim = hojeISO();
  const itens = [];
  for (const mk of A.mesesEntre(ini, fim)) {
    const M = await mes(mk);
    for (const [dd, dia] of Object.entries(M.dias)) {
      const di = `${mk}-${dd}`; if (di < ini || di > fim) continue;
      (dia.lav || []).forEach((l, i) => { if (l.t === 'sulgas' && !l.fat) itens.push({ data: di, placa: l.placa || '', nome: l.mot || motoristaDe(l.placa) || '', valor: l.v, ticket: l.ticket || '', ref: [mk, dd, i] }); });
    }
  }
  itens.sort((a, b) => a.data.localeCompare(b.data) || String(a.ticket).localeCompare(String(b.ticket)));
  return { ini, fim, itens };
}

async function telaSulgasPdf(ref) {
  let per, itens, titulo, fech = null;
  if (ref === 'aberto') { const ab = await sulgasEmAberto(); per = { ini: ab.ini, fim: ab.fim }; itens = ab.itens; titulo = 'PRÉVIA (período ainda não fechado)'; }
  else if (/^f/.test(ref)) { fech = (await fechamentosSulgas()).find((f) => f.id === ref); if (!fech) { $app.innerHTML = moldura('<div class="card">Fechamento não encontrado.</div>'); return; } per = { ini: fech.ini, fim: fech.fim }; itens = fech.itens; }
  else { ({ per, itens } = await lavagensSulgas(ref)); }
  const mot = (s) => s.nome || motoristaDe(s.placa) || '';
  const total = C.r2(itens.reduce((a, b) => a + (Number(b.valor) || 0), 0));
  const porValor = {}; for (const s of itens) { const k = C.r2(s.valor).toFixed(2); porValor[k] = (porValor[k] || 0) + 1; }
  const porPlaca = {}; for (const s of itens) { const k = s.placa || '—'; porPlaca[k] = porPlaca[k] || { n: 0, mot: mot(s) }; porPlaca[k].n++; }
  const voltar = fech || ref === 'aberto' ? '#/sulgas' : `#/sulgas/${per.ini}`;
  $app.innerHTML = `<div class="pdf-barra naoimprime"><a class="btn" href="${voltar}">‹ Voltar</a><button class="btn grande-inline" data-act="imprimir">🖨️ Imprimir / salvar PDF</button></div>
    <p class="mini centro naoimprime">No celular: toque em "Imprimir / salvar PDF" e escolha <b>Salvar como PDF</b>.</p>
    <div class="pdf"><section class="pdf-pag">
      <header class="pdf-cab"><div><b>ANITA PARKING ESTACIONAMENTO LTDA.</b><small>CNPJ 29.215.496/0001-00 · Porto Alegre/RS</small></div><div class="pdf-tit">Lavagens Sulgás<small>Período de ${dataBR(per.ini)} a ${dataBR(per.fim)}</small>${fech ? `<small>Fechamento nº ${fech.numero}</small>` : ''}${titulo ? `<small class="previa">${titulo}</small>` : ''}</div></header>
      <div class="pdf-resumo tres">
        <div><span>${itens.length}</span><small>lavagens no período</small></div>
        <div><span>${Object.keys(porPlaca).length}</span><small>veículos atendidos</small></div>
        <div class="tot"><span>${brl(total)}</span><small>valor a faturar</small></div>
      </div>
      <table class="pdf-tab"><thead><tr><th>#</th><th>Data</th><th>Ticket</th><th>Placa</th><th>Motorista / usuário</th><th style="text-align:right">Valor</th></tr></thead><tbody>
      ${itens.map((s, i) => `<tr><td>${i + 1}</td><td>${dataBR(s.data)}</td><td>${esc(s.ticket || '—')}</td><td><b>${esc(s.placa)}</b></td><td>${esc(mot(s))}</td><td style="text-align:right">${brl(s.valor)}</td></tr>`).join('')}
      <tr class="t"><td colspan="5">Total: ${Object.entries(porValor).map(([v, n]) => `${n} × ${brl(Number(v))}`).join(' + ')}</td><td style="text-align:right">${brl(total)}</td></tr>
      </tbody></table>
      <h4>Resumo por veículo</h4>
      <table class="pdf-tab"><thead><tr><th>Placa</th><th>Motorista / usuário</th><th style="text-align:right">Lavagens</th></tr></thead><tbody>
      ${Object.entries(porPlaca).sort((a, b) => b[1].n - a[1].n || a[0].localeCompare(b[0])).map(([pl, x]) => `<tr><td><b>${esc(pl)}</b></td><td>${esc(x.mot)}</td><td style="text-align:right">${x.n}</td></tr>`).join('')}
      </tbody></table>
      <div class="assin pdf-assin"><span>Anita Parking Estacionamento</span><span>Sulgás · conferido por</span></div>
      <p class="pdf-nota">${fech ? `Fechamento emitido em ${dataBR(fech.gerado.slice(0, 10))}. ` : `Gerado em ${dataBR(hojeISO())}. `}${fech || ref === 'aberto' ? 'Período: da impressão anterior até esta impressão.' : 'Período de faturamento do dia 19 ao dia 18 (planilha).'}</p>
    </section></div>`;
  document.title = `Lavagens Sulgás ${dataBR(per.ini).replace(/\//g, '-')} a ${dataBR(per.fim).replace(/\//g, '-')}`;
  window.scrollTo(0, 0);
}

function blocoFrota() {
  return `<section class="card"><h3>Frota Sulgás <small>${S.frota.length} veículos</small></h3>
    <details><summary>Ver / editar frota</summary>
    <table class="tab"><tbody>${S.frota.map((v, i) => `<tr><td>${esc(v.placa)}</td><td><small>${esc(v.modelo || '')}</small></td><td><small>${esc(v.nome || '')}</small></td><td><button class="x" data-act="delVeic" data-i="${i}">✕</button></td></tr>`).join('')}</tbody></table>
    <form class="linha" id="fVeic"><input name="placa" placeholder="Placa" required autocapitalize="characters" style="max-width:6.5rem"><input name="modelo" placeholder="Modelo" style="max-width:6rem"><input name="nome" placeholder="Usuário"><button class="btn">+</button></form>
    </details></section>`;
}
function ligarFormFrota(depois) {
  const f = document.getElementById('fVeic'); if (!f) return;
  f.onsubmit = async (ev) => {
    ev.preventDefault(); const fd = new FormData(f);
    S.frota.push({ placa: fd.get('placa').toUpperCase().trim(), modelo: fd.get('modelo').trim(), nome: fd.get('nome').trim() });
    await salvarFrota(); depois();
  };
}

async function telaSulgasAberto() {
  const { ini, fim, itens } = await sulgasEmAberto();
  const fechs = await fechamentosSulgas();
  const total = C.r2(itens.reduce((a, b) => a + (Number(b.valor) || 0), 0));
  const corpo = `
  <div class="kpis"><div class="kpi"><small>Em aberto desde ${dataBR(ini).slice(0, 5)}</small><b>${itens.length} lavagens</b></div><div class="kpi"><small>Valor a faturar</small><b>${brl(total)}</b></div></div>
  <section class="card"><h3>Período em aberto <small>${dataBR(ini)} a hoje</small></h3>
    ${itens.length ? `<table class="tab"><thead><tr><th>Data</th><th>Ticket</th><th>Placa</th><th>Usuário</th><th>Valor</th></tr></thead><tbody>
    ${itens.map((x) => `<tr data-href="#/hoje/${x.data}"><td>${dataBR(x.data).slice(0, 5)}</td><td><small>${esc(x.ticket || '—')}</small></td><td>${esc(x.placa)}</td><td><small>${esc(x.nome)}</small></td><td>${brl(x.valor)}</td></tr>`).join('')}</tbody></table>
    <div class="linha"><button class="btn pdfbtn" data-act="fecharSulgas">📄 Fechar período e gerar PDF</button><a class="btn link" href="#/sulgaspdf/aberto">ver prévia</a><button class="btn link" data-act="copiarSulgasAberto">copiar lista</button></div>
    <p class="mini">Ao fechar, estas ${itens.length} lavagens ficam marcadas como cobradas e o próximo período começa a partir de hoje.</p>`
    : '<p class="vazio">Nenhuma lavagem Sulgás em aberto.</p>'}
  </section>
  <section class="card"><h3>Fechamentos anteriores</h3>
    ${fechs.length ? `<table class="tab"><thead><tr><th>Nº</th><th>Período</th><th>Lavagens</th><th>Total</th><th></th></tr></thead><tbody>
    ${[...fechs].reverse().map((f, i) => `<tr><td>${f.numero}</td><td>${dataBR(f.ini).slice(0, 5)} a ${dataBR(f.fim).slice(0, 5)}<small>${f.fim.slice(0, 4)}</small></td><td>${f.itens.length}</td><td>${brl(f.total)}</td><td><a class="tag" href="#/sulgaspdf/${f.id}">PDF</a>${i === 0 ? ` <button class="btn link mini perigo" data-act="desfazerSulgas" data-id="${f.id}">desfazer</button>` : ''}</td></tr>`).join('')}</tbody></table>` : '<p class="mini">Nenhum fechamento ainda. O primeiro vai de 19/11/2026 (depois do último período da planilha) até a data em que você imprimir.</p>'}
    <a class="btn link" href="#/sulgas/2026-11-18">Consultar períodos antigos da planilha (19 a 18)</a>
  </section>
  ${blocoFrota()}`;
  $app.innerHTML = moldura(corpo, 'Contrato Sulgás');
  S.ctxSul = { iso: hojeISO(), itens, per: { ini, fim } };
  ligarFormFrota(() => telaSulgasAberto());
}

async function telaSulgas(iso) {
  const { per, itens } = await lavagensSulgas(iso);
  const nomeDe = (pl) => { const v = veiculo(pl); return v ? `${v.nome || ''} ${v.modelo ? '· ' + v.modelo : ''}` : ''; };
  const total = itens.reduce((a, b) => a + (Number(b.valor) || 0), 0);
  const corpo = `
  <div class="navdata"><a class="btn ic" href="#/sulgas/${somaDias(per.ini, -1)}">‹</a><b class="titmes semcap">${dataBR(per.ini).slice(0, 5)} a ${dataBR(per.fim)}</b><a class="btn ic" href="#/sulgas/${somaDias(per.fim, 1)}">›</a></div>
  <a class="hojelink" href="#/sulgas">← voltar ao período em aberto</a>
  <p class="mini centro">Consulta pelos períodos antigos da planilha (19 a 18).</p>
  <div class="kpis"><div class="kpi"><small>Lavagens no período</small><b>${itens.length}</b></div><div class="kpi"><small>Valor a faturar</small><b>${brl(total)}</b></div></div>
  <section class="card"><h3>Lavagens Sulgás</h3>
    ${itens.length ? `<table class="tab"><thead><tr><th>Data</th><th>Ticket</th><th>Placa</th><th>Usuário</th><th>Valor</th></tr></thead><tbody>
    ${itens.map((s) => `<tr data-href="#/hoje/${s.data}"><td>${dataBR(s.data).slice(0, 5)}</td><td><small>${esc(s.ticket || '—')}</small></td><td>${esc(s.placa)}</td><td><small>${esc(s.nome || nomeDe(s.placa))}</small></td><td>${brl(s.valor)}</td></tr>`).join('')}</tbody></table>` : '<p class="vazio">Nenhuma lavagem Sulgás neste período.</p>'}
    <div class="linha">${itens.length ? `<a class="btn pdfbtn" href="#/sulgaspdf/${per.ini}">📄 PDF para imprimir</a>` : ''}<button class="btn link" data-act="copiarSulgas">Copiar lista para enviar</button></div>
  </section>
  ${blocoFrota()}`;
  $app.innerHTML = moldura(corpo, 'Contrato Sulgás');
  S.ctxSul = { iso, itens, per };
  ligarFormFrota(() => telaSulgas(iso));
}

// ---------- TELA: ajustes ----------
async function telaAjustes() {
  const c = S.cfg;
  const u = S.store.usuario();
  const corpo = `
  <section class="card"><h3>Banco de dados</h3>
    ${S.store.modo === 'firebase'
      ? `<p>Conectado ao Firebase <b>${esc((lerConfigFirebase() || {}).projectId)}</b> como <b>${esc(u && u.email)}</b>.</p>
         <div class="linha"><button class="btn" data-act="sair">Sair</button><button class="btn link" data-act="desconectar">Desconectar este aparelho</button></div>`
      : `<p><b>Modo local:</b> os dados ficam só neste aparelho. Toque abaixo para voltar a usar o banco na nuvem.</p>
         <button class="btn" data-act="voltarFirebase">Conectar ao Firebase do estacionamento</button>
         <details><summary class="mini">Usar outro projeto Firebase</summary>
         <textarea id="fbcfg" rows="5" placeholder="const firebaseConfig = { apiKey: ..., projectId: ... }"></textarea>
         <button class="btn" data-act="conectar">Conectar</button></details>`}
  </section>

  <form class="card" id="fRegras">
    <h3>Regras de premiação</h3>
    <label>Início da vigência do regulamento novo<input type="date" name="vigencia" value="${c.vigencia}"></label>
    <p class="mini">Dias antes desta data usam a regra antiga (prêmio importado da planilha).</p>
    <h4>Prêmio diário (segunda a sexta)</h4>
    ${c.faixasDia.map((f, i) => `<div class="linha"><input name="fdNome${i}" value="${esc(f.nome)}" style="max-width:6rem"><label class="inl">a partir de<input name="fdMin${i}" inputmode="numeric" value="${f.min}"></label><label class="inl">carros<input name="fdPct${i}" inputmode="decimal" value="${fmtN(f.pct)}">%</label></div>`).join('')}
    <h4>Sábado</h4>
    <div class="linha"><label class="inl">a partir de<input name="sabMin" inputmode="numeric" value="${c.sabadoMin}"></label><label class="inl">carros<input name="sabPct" inputmode="decimal" value="${fmtN(c.sabadoPct)}">%</label></div>
    <h4>Bônus mensal (valor fixo por pessoa)</h4>
    ${c.faixasMes.map((f, i) => `<div class="linha"><label class="inl">a partir de<input name="fmMin${i}" inputmode="numeric" value="${f.min}"></label><label class="inl">carros R$<input name="fmVal${i}" inputmode="decimal" value="${fmtN(f.valor)}"></label></div>`).join('')}
    <label>Presença mínima para o bônus (%)<input name="presencaMin" inputmode="numeric" value="${c.presencaMin}"></label>
    <h4>Regra antiga (até a vigência)</h4>
    ${(() => { const ra = { ...C.ANTIGA_PADRAO, ...(c.regraAntiga || {}) }; return `<div class="linha"><label class="inl"><input name="raPct" inputmode="decimal" value="${fmtN(ra.pctMin)}">% até</label><label class="inl"><input name="raLim" inputmode="numeric" value="${ra.limite}"> pagas; acima, % = nº de pagas</label></div>
    <div class="linha"><label class="inl">Sulgás: R$<input name="raSulBase" inputmode="decimal" value="${fmtN(ra.sulgasBase)}"></label><label class="inl">×<input name="raSulPct" inputmode="decimal" value="${fmtN(ra.sulgasPct)}">%</label></div>`; })()}
    <h4>Outros</h4>
    <div class="grade2">
      <label>Valor por lavagem Sulgás<input name="sulgasValor" inputmode="decimal" value="${fmtN(c.sulgasValor)}"></label>
      <label>Imposto (% s/ faturamento declarado)<input name="impostoPct" inputmode="decimal" value="${fmtN(c.impostoPct)}"></label>
      <label>Meta diária da equipe (carros)<input name="metaDia" inputmode="numeric" value="${c.metaDia}"></label>
    </div>
    <button class="btn grande">Salvar regras</button>
  </form>

  <section class="card"><h3>Convênio de sábados e feriados</h3>
    ${(() => { const c = cfgConv(); return `<div class="grade2">
      <label>Nome do convênio<input data-conv="nome" value="${esc(c.nome)}"></label>
      <label>Texto na "Tabela de Preço"<input data-conv="filtro" value="${esc(c.filtro)}"></label>
      <label>Valor por dia (R$)<input data-conv="valorDia" inputmode="decimal" value="${fmtN(c.valorDia)}"></label>
      <label>Vagas simultâneas incluídas<input data-conv="vagas" inputmode="numeric" value="${c.vagas}"></label>
      <label>Valor por carro extra (R$)<input data-conv="valorExtra" inputmode="decimal" value="${fmtN(c.valorExtra)}"></label>
      <label>Período do convênio: início<input type="time" data-conv="inicio" value="${esc(c.inicio)}"></label>
      <label>Período do convênio: fim<input type="time" data-conv="fechamento" value="${esc(c.fechamento)}"></label>
    </div>
    <label>Como contar os carros extras<select data-conv="regra">${Object.entries(V.REGRAS).map(([k, n]) => `<option value="${k}" ${c.regra === k ? 'selected' : ''}>${n}</option>`).join('')}</select></label>
    <p class="mini">Dias já calculados mantêm os valores da época. Num dia, use "Recalcular" para aplicar os novos.</p>`; })()}
  </section>

  <section class="card"><h3>Campos do caixa do dia</h3>
    <p class="mini">Renomeie, inclua ou tire campos. "Por nome" abre a lista de quem pagou (ex.: mensalistas, convênios). Campos tirados somem do caixa, mas os valores antigos continuam no histórico.</p>
    ${c.pagamentos.filter((x) => x.ativo !== false).map((x, i) => `<div class="linha campo-cx"><input data-campo-cx="${x.k}" data-k="nome" value="${esc(x.nome)}"><label class="chk mini"><input type="checkbox" data-campo-cx="${x.k}" data-k="detalhar" ${x.detalhar ? 'checked' : ''}> por nome</label>${i ? `<button class="x" data-act="subirCampo" data-k="${x.k}" title="subir">↑</button>` : ''}<button class="x" data-act="offCampo" data-k="${x.k}" title="tirar do caixa">✕</button></div>`).join('')}
    <button class="btn link" data-act="addCampo">+ Novo campo</button>
    ${c.pagamentos.some((x) => x.ativo === false) ? `<details><summary class="mini">Campos tirados do caixa</summary>${c.pagamentos.filter((x) => x.ativo === false).map((x) => `<div class="linha"><span style="flex:1">${esc(x.nome)}</span><button class="btn link" data-act="onCampo" data-k="${x.k}">voltar para o caixa</button></div>`).join('')}</details>` : ''}
  </section>

  <section class="card"><h3>Botões de preço das lavagens</h3>
    <p class="mini">Dê nomes (ex.: “Completa SUV”) para lançar mais rápido.</p>
    ${c.precos.map((p, i) => [p, i]).sort((a, b) => (Number(a[0].valor) || 0) - (Number(b[0].valor) || 0)).map(([p, i]) => `<div class="linha"><input data-preco="${i}" data-k="nome" value="${esc(p.nome)}"><input data-preco="${i}" data-k="valor" inputmode="decimal" value="${fmtN(p.valor)}" style="max-width:6rem"><button class="x" data-act="delPreco" data-i="${i}">✕</button></div>`).join('')}
    <button class="btn link" data-act="addPreco">+ Novo preço</button>
  </section>

  <section class="card"><h3>Despesas fixas do mês</h3>
    <p class="mini">Viram um botão no painel do mês para lançar tudo de uma vez.</p>
    ${(c.despesasFixas || []).map((d, i) => `<div class="fixa"><div class="linha"><input data-fixa="${i}" data-k="desc" value="${esc(d.desc)}"><input data-fixa="${i}" data-k="valor" inputmode="decimal" value="${fmtN(d.valor)}" style="max-width:6rem"><button class="x" data-act="delFixa" data-i="${i}">✕</button></div>
      <select data-fixa="${i}" data-k="cat">${c.categorias.map((ct) => `<option value="${ct.id}" ${catFixa(d) === ct.id ? 'selected' : ''}>${esc(ct.nome)}</option>`).join('')}</select></div>`).join('')}
    <button class="btn link" data-act="addFixa">+ Nova despesa fixa</button>
  </section>

  <section class="card"><h3>Backup em Excel</h3>
    <p class="mini">Planilha completa: resumo mensal, caixa diário, lavagens, mensalistas, despesas, folha, funcionários e Sulgás.</p>
    <div class="linha"><button class="btn" data-act="excelBaixar">⬇️ Baixar Excel</button><button class="btn" data-act="excelEnviar">✉️ Enviar por e-mail</button></div>
    <p class="mini">Envio automático: todo <b>dia 15</b> para <b>${EMAIL_BACKUP}</b> (pelo GitHub).</p>
  </section>

  <section class="card"><h3>Dados</h3>
    <label class="btn arquivo">Importar histórico (.json)<input type="file" accept=".json,application/json" id="fImport" hidden></label>
    <button class="btn" data-act="exportar">Baixar backup (.json)</button>
    <p class="mini">Versão ${VERSAO} · <a href="./atualizar.html">forçar atualização</a></p>
  </section>`;
  $app.innerHTML = moldura(corpo, 'Ajustes');

  document.getElementById('fRegras').onsubmit = async (ev) => {
    ev.preventDefault(); const fd = new FormData(ev.target);
    c.vigencia = fd.get('vigencia');
    c.faixasDia = c.faixasDia.map((f, i) => ({ nome: fd.get('fdNome' + i), min: num(fd.get('fdMin' + i)), pct: num(fd.get('fdPct' + i)) }));
    c.sabadoMin = num(fd.get('sabMin')); c.sabadoPct = num(fd.get('sabPct'));
    c.faixasMes = c.faixasMes.map((f, i) => ({ min: num(fd.get('fmMin' + i)), valor: num(fd.get('fmVal' + i)) }));
    for (const k of ['presencaMin', 'sulgasValor', 'impostoPct', 'metaDia']) c[k] = num(fd.get(k));
    c.regraAntiga = { pctMin: num(fd.get('raPct')), limite: num(fd.get('raLim')), sulgasBase: num(fd.get('raSulBase')), sulgasPct: num(fd.get('raSulPct')) };
    await salvarCfg(); toast('Regras salvas');
  };
  document.getElementById('fImport').onchange = (ev) => importar(ev.target.files[0]);
}

async function importar(file) {
  if (!file) return;
  let h; try { h = JSON.parse(await file.text()); } catch { return toast('Arquivo inválido', true); }
  if (h.tipo !== 'estacionamento-anita-historico' && h.tipo !== 'estacionamento-anita-backup') return toast('Este arquivo não é do app', true);
  if (!confirm(`Importar ${Object.keys(h.meses || {}).length} meses, ${(h.funcionarios || []).length} funcionários e ${(h.frota || []).length} veículos? Dias já lançados no app são mantidos.`)) return;
  status('Importando…');
  try {
    const temCfg = await S.store.get('config', 'app');
    if (h.config && (!temCfg || h.tipo === 'estacionamento-anita-backup')) await S.store.set('config', 'app', h.config);
    for (const f of h.funcionarios || []) if (h.tipo === 'estacionamento-anita-backup' || !S.funcs.find((x) => x.id === f.id)) await S.store.set('funcionarios', f.id, f);
    if ((h.frota || []).length) {
      const atualFrota = ((await S.store.get('frota', 'lista')) || {}).veiculos || [];
      const np = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      const mescla = h.tipo === 'estacionamento-anita-backup' ? h.frota : [...atualFrota, ...h.frota.filter((v) => !atualFrota.some((a) => np(a.placa) === np(v.placa)))];
      await S.store.set('frota', 'lista', { veiculos: mescla });
    }
    let i = 0; const ks = Object.keys(h.meses || {});
    for (const mk of ks) {
      const atual = (await S.store.get('meses', mk)) || { dias: {} };
      const novo = h.meses[mk];
      const dias = { ...(novo.dias || {}) };
      for (const [dd, d] of Object.entries(atual.dias || {})) {
        if (!d.legado || h.tipo === 'estacionamento-anita-backup') { // preserva o que foi lançado no app
          const nv = (novo.dias || {})[dd];
          if (nv && nv.precos && !d.precos && Number(d.valor || 0) === Number(nv.valor || 0)) d.precos = nv.precos;
          dias[dd] = d;
        }
      }
      await S.store.set('meses', mk, { ...novo, ...atual, ...(h.tipo === 'estacionamento-anita-backup' ? novo : {}), dias, folhaLegado: novo.folhaLegado || atual.folhaLegado, despesasLegado: novo.despesasLegado || atual.despesasLegado, sulgasLista: novo.sulgasLista || atual.sulgasLista });
      status(`Importando ${++i}/${ks.length}`);
    }
    await carregarBase(); toast('Histórico importado!'); status('Salvo ✓'); location.hash = '#/mes/' + mkDe(hojeISO()); rotear();
  } catch (e) { toast('Falha ao importar: ' + e.message, true); }
}

async function gerarExcel() {
  status('Gerando Excel…');
  const meses = {};
  for (const m of await S.store.list('meses')) { const { id, ...r } = m; meses[id] = S.meses[id] || r; migrarDespesasPlanilha(id, meses[id]); }
  const bytes = montarPlanilha({ cfg: S.cfg, funcs: S.funcs, frota: S.frota, meses });
  status('');
  return new File([bytes], nomeArquivoBackup(hojeISO()), { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function baixarArquivo(file) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(file); a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
async function excelEnviar() {
  const file = await gerarExcel();
  const assunto = `Backup Estacionamento Anita ${dataBR(hojeISO())}`;
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: assunto, text: `${assunto} (enviar para ${EMAIL_BACKUP})` }); return; }
    catch (e) { if (e.name === 'AbortError') return; }
  }
  baixarArquivo(file);
  toast('Excel baixado. Anexe no e-mail que vai abrir.');
  setTimeout(() => { location.href = `mailto:${EMAIL_BACKUP}?subject=${encodeURIComponent(assunto)}&body=${encodeURIComponent('Backup em anexo (' + file.name + ').')}`; }, 800);
}

async function exportar() {
  const meses = {};
  for (const m of await S.store.list('meses')) { const { id, ...r } = m; meses[id] = r; }
  const out = { tipo: 'estacionamento-anita-backup', versao: 1, gerado: new Date().toISOString(), config: S.cfg, funcionarios: S.funcs, frota: S.frota, meses };
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([JSON.stringify(out)], { type: 'application/json' }));
  a.download = `backup-anita-${hojeISO()}.json`; a.click();
}

// ---------- eventos (delegação) ----------
$app.addEventListener('click', async (ev) => {
  const anc = ev.target.closest('tr[data-ancora]'); if (anc) { const alvo = document.getElementById(anc.dataset.ancora); if (alvo) alvo.scrollIntoView({ behavior: 'smooth', block: 'start' }); return; }
  const tr = ev.target.closest('tr[data-href]'); if (tr && !ev.target.closest('button,input')) { location.hash = tr.dataset.href; return; }
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  if (act === 'irData' || act === 'feriado') return;
  const ctx = S.ctxDia;
  switch (act) {
    case 'tipo': S.tipoSel = el.dataset.t; telaDia(ctx.iso); break;
    case 'addLav': {
      const pr = S.cfg.precos[+el.dataset.i]; const t = S.tipoSel;
      let cliente;
      if (t === 'cortesia') {
        cliente = (document.getElementById('cortNome').value || '').trim();
        if (!cliente) { toast('Informe quem recebeu a cortesia', true); document.getElementById('cortNome').focus(); break; }
        lembrarNome('cortesia', cliente, 0); S.cortNome = '';
      }
      addLav({ t, v: t === 'paga' ? pr.valor : 0, desc: !mesmoRotulo(pr) || t !== 'paga' ? pr.nome : undefined, ...(cliente ? { cliente } : {}) });
      break;
    }
    case 'addOutro': { const v = num(document.getElementById('outroValor').value); if (v > 0) addLav({ t: 'paga', v }); break; }
    case 'addSulgas': {
      const pl = normPlaca(document.getElementById('placaSul').value);
      if (!pl) { toast('Informe a placa', true); document.getElementById('placaSul').focus(); break; }
      const v = veiculo(pl);
      const mot = (document.getElementById('motSul').value || '').trim();
      const mod = (document.getElementById('modSul').value || '').trim();
      if (!mot) { toast('Informe o motorista', true); mostrarPlaca(); document.getElementById('motSul').focus(); break; }
      if (!v || !v.nome) {
        if (v) { v.nome = mot; if (mod && !v.modelo) v.modelo = mod; } else S.frota.push({ placa: pl, nome: mot, ...(mod ? { modelo: mod } : {}) });
        salvarFrota().catch((e) => toast('Frota não salva: ' + e.message, true));
      } else if (mot !== v.nome && document.getElementById('motPadrao').checked) {
        v.nome = mot; salvarFrota().catch((e) => toast('Frota não salva: ' + e.message, true));
      }
      const tk = (document.getElementById('ticketSul').value || '').trim();
      if (tk) {
        const dup = Object.entries(S.meses).flatMap(([mk, M]) => Object.entries(M.dias || {}).flatMap(([dd, d]) => (d.lav || []).filter((x) => x.t === 'sulgas' && x.ticket === tk).map(() => `${dd}/${mk.slice(5)}`)));
        if (dup.length && !confirm(`O ticket ${tk} já foi lançado em ${dup.join(', ')}. Lançar mesmo assim?`)) break;
      }
      addLav({ t: 'sulgas', v: Number(S.cfg.sulgasValor), placa: pl, mot, ...(tk ? { ticket: tk } : {}) });
      setTimeout(() => { const n = document.getElementById('ticketSul'); if (n) n.focus(); }, 50);
      break;
    }
    case 'detToggle': S.detAberto = S.detAberto === el.dataset.k ? null : el.dataset.k; telaDia(ctx.iso); if (S.detAberto) setTimeout(() => { const n = document.getElementById('detNome'); if (n) { n.scrollIntoView({ block: 'center' }); n.focus(); } }, 50); break;
    case 'addDet': {
      const k = S.detAberto;
      const nome = (document.getElementById('detNome').value || '').trim();
      const valor = num(document.getElementById('detValor').value);
      const obs = (document.getElementById('detObs').value || '').trim();
      if (!nome) { toast('Informe o nome', true); break; }
      if (!(valor > 0)) { toast('Informe o valor pago', true); break; }
      const d = diaAtual(); d.det = d.det || {}; if (!Array.isArray(d.det[k])) d.det[k] = [];
      d.det[k].push(obs ? { nome, valor, obs } : { nome, valor });
      recalcDet(d, k); salvarMes(ctx.mk); lembrarNome(k, nome, valor);
      telaDia(ctx.iso); setTimeout(() => { const n = document.getElementById('detNome'); if (n) n.focus(); }, 50);
      break;
    }
    case 'delDet': { const d = diaAtual(); d.det[S.detAberto].splice(+el.dataset.i, 1); recalcDet(d, S.detAberto); salvarMes(ctx.mk); telaDia(ctx.iso); break; }
    case 'addCampo': {
      const nome = prompt('Nome do novo campo do caixa (ex.: Convênio Hospital):'); if (!nome || !nome.trim()) break;
      let k = slug(nome) || 'campo'; while (campos().some((c) => c.k === k)) k += '2';
      campos().push({ k, nome: nome.trim(), ativo: true, detalhar: false }); await salvarCfg(); telaAjustes(); break;
    }
    case 'offCampo': { const c = campos().find((x) => x.k === el.dataset.k); if (confirm(`Tirar "${c.nome}" do caixa do dia? Os valores já lançados continuam no histórico e nos totais.`)) { c.ativo = false; await salvarCfg(); telaAjustes(); } break; }
    case 'onCampo': { const c = campos().find((x) => x.k === el.dataset.k); c.ativo = true; await salvarCfg(); telaAjustes(); break; }
    case 'subirCampo': { const i = campos().findIndex((x) => x.k === el.dataset.k); if (i > 0) { const l = campos(); [l[i - 1], l[i]] = [l[i], l[i - 1]]; await salvarCfg(); telaAjustes(); } break; }
    case 'editSul': {
      const d = diaAtual(), l = d.lav[+el.dataset.i];
      const mot = prompt(`Motorista desta lavagem (placa ${l.placa || '—'}):`, l.mot || motoristaDe(l.placa));
      if (mot === null) break;
      const tk = prompt('Nº do ticket:', l.ticket || '');
      if (mot.trim()) l.mot = mot.trim();
      if (tk !== null) { if (tk.trim()) l.ticket = tk.trim(); else delete l.ticket; }
      salvarMes(ctx.mk); telaDia(ctx.iso); break;
    }
    case 'editCort': {
      const d = diaAtual(), l = d.lav[+el.dataset.i];
      const nome = prompt('Quem recebeu a cortesia?', l.cliente || '');
      if (nome === null) break;
      if (nome.trim()) { l.cliente = nome.trim(); lembrarNome('cortesia', l.cliente, 0); } else delete l.cliente;
      salvarMes(ctx.mk); telaDia(ctx.iso); break;
    }
    case 'delLav': { const d = diaAtual(); d.lav.splice(+el.dataset.i, 1); salvarMes(ctx.mk); telaDia(ctx.iso); break; }
    case 'pres': { const d = diaAtual(); fixarPresenca(d); d.presenca[el.dataset.id] = el.dataset.s; salvarMes(ctx.mk); telaDia(ctx.iso); break; }
    case 'converterDia': { const d = diaAtual(); if (confirm('Os totais deste dia serão apagados para lançar carro a carro. Continuar?')) { delete d.pagas; delete d.valor; delete d.cort; delete d.sulgas; delete d.legado; delete d.premioLeg; d.lav = []; salvarMes(ctx.mk); telaDia(ctx.iso); } break; }
    case 'folhaNoApp': {
      const mk = S.ctxEquipe, M = S.meses[mk];
      M.folha = M.folha || {};
      for (const e of M.folhaLegado || []) {
        const fo = M.folha[e.id] = M.folha[e.id] || {};
        if (e.salMes) fo.salMes = e.salMes;
        if (e.diasTrab != null) fo.diasTrab = e.diasTrab;
        if (e.vtDias != null) fo.vtDias = e.vtDias;
        if (e.vtDia != null) fo.vtDia = e.vtDia;
        if (e.descontos && !(fo.descontos || []).length) fo.descontos = [{ desc: e.obs || 'Desconto (planilha)', valor: e.descontos }];
        if (e.extras && !(fo.extras || []).length) fo.extras = [{ desc: 'Extras (planilha)', valor: e.extras }];
      }
      M.folhaApp = true; salvarMes(mk); telaEquipe(mk); break;
    }
    case 'addFolhaItem': { const M = S.meses[S.ctxEquipe]; M.folha = M.folha || {}; const fo = M.folha[el.dataset.id] = M.folha[el.dataset.id] || {}; (fo[el.dataset.k] = fo[el.dataset.k] || []).push({ desc: '', valor: 0 }); salvarMes(S.ctxEquipe); await telaEquipe(S.ctxEquipe); const ins = document.querySelectorAll(`[data-fitem="${el.dataset.id}"][data-k="${el.dataset.k}"][data-c=desc]`); if (ins.length) ins[ins.length - 1].focus(); break; }
    case 'premioAuto': { const M = S.meses[S.ctxEquipe]; delete M.folha[el.dataset.id].premioManual; delete M.folha[el.dataset.id].premioOrigem; salvarMes(S.ctxEquipe); telaEquipe(S.ctxEquipe); break; }
    case 'folhaRestaurar': { if (!confirm('Apagar as alterações feitas no app nesta folha e voltar aos valores da planilha?')) break; const M = S.meses[S.ctxEquipe]; M.folha = {}; M.folhaApp = false; salvarMes(S.ctxEquipe); telaEquipe(S.ctxEquipe); break; }
    case 'folhaVoltar': { const M = S.meses[S.ctxEquipe]; if (confirm('Voltar a mostrar a folha da planilha? Os ajustes feitos no app ficam guardados.')) { M.folhaApp = false; salvarMes(S.ctxEquipe); telaEquipe(S.ctxEquipe); } break; }
    case 'fixoMes': {
      const M = S.meses[S.ctxEquipe]; M.folha = M.folha || {}; const fo = M.folha[el.dataset.id] = M.folha[el.dataset.id] || {};
      const i = +el.dataset.i; fo.fixosOff = fo.fixosOff || [];
      fo.fixosOff = fo.fixosOff.includes(i) ? fo.fixosOff.filter((x) => x !== i) : [...fo.fixosOff, i];
      salvarMes(S.ctxEquipe); telaEquipe(S.ctxEquipe); break;
    }
    case 'delFixo': { const f = S.funcs.find((x) => x.id === el.dataset.id); if (!confirm(`Remover "${f.fixos[+el.dataset.i].desc}" dos lançamentos fixos?`)) break; f.fixos.splice(+el.dataset.i, 1); S.fichaAberta = f.id; await salvarFunc(f); telaEquipe(S.ctxEquipe); break; }
    case 'excluirFunc': { const f = S.funcs.find((x) => x.id === el.dataset.id); if (!confirm(`Excluir ${f.nome} do cadastro? O histórico de folhas e presenças continua guardado.`)) break; await S.store.del('funcionarios', f.id); S.funcs = S.funcs.filter((x) => x !== f); telaEquipe(S.ctxEquipe); break; }
    case 'delFolha': { const M = S.meses[S.ctxEquipe]; M.folha[el.dataset.id][el.dataset.k].splice(+el.dataset.i, 1); salvarMes(S.ctxEquipe); telaEquipe(S.ctxEquipe); break; }
    case 'imprimir': window.print(); break;
    case 'salvarDia': {
      const mk = ctx.mk, b = el; b.disabled = true; b.textContent = 'Salvando…';
      // campos com texto ainda não confirmado (ex.: observação sendo digitada)
      const obs = document.querySelector('textarea[data-campo=obs]'); if (obs) { const d = diaAtual(); if ((d.obs || '') !== obs.value) { d.obs = obs.value; S.pendente[mk] = true; } }
      try {
        await gravarMes(mk);
        const doServidor = await S.store.get('meses', mk); // confere o que ficou gravado
        if (doServidor) { S.meses[mk] = doServidor; if (!S.meses[mk].dias) S.meses[mk].dias = {}; }
        toast(`Dia ${dataBR(ctx.iso).slice(0, 5)} salvo ✓`);
        if (navigator.vibrate) navigator.vibrate(30);
        telaDia(ctx.iso);
      } catch (e) { b.disabled = false; b.textContent = '💾 Salvar dia'; }
      break;
    }
    case 'convColar': { const t = document.getElementById('convTxt').value; if (!t.trim()) { toast('Cole o texto do relatório', true); break; } try { await processarConvenio(V.lerColado(t), ''); } catch (e) { toast(e.message, true); } break; }
    case 'convRecalc': { const d = diaAtual(); await gravarConvenio(ctx.iso, d.convSab.carros, { arquivo: d.convSab.arquivo, ignorados: d.convSab.ignorados }); telaDia(ctx.iso); break; }
    case 'convRemover': { if (!confirm('Remover o cálculo do convênio deste dia? O valor sai de Convênios no caixa.')) break; const d = diaAtual(); delete d.convSab; if (d.det && d.det.conv) { d.det.conv = d.det.conv.filter((x) => !x.auto); recalcDet(d, 'conv'); } salvarMes(ctx.mk); telaDia(ctx.iso); break; }
    case 'convCopiar': {
      const mk = S.ctxMes, c = cfgConv(), dias = Object.entries(S.meses[mk].dias).filter(([, d]) => d.convSab).sort();
      const txt = `Convênio ${c.nome} · ${nomeMes(mk)}\n` + dias.map(([dd, d]) => `${dd}/${mk.slice(5)}: ${d.convSab.res.carros} carros, pico ${d.convSab.res.pico}, ${d.convSab.res.extras} extras = ${brl(d.convSab.res.total)}`).join('\n') + `\nTotal: ${brl(dias.reduce((a, [, d]) => a + d.convSab.res.total, 0))}`;
      try { await navigator.clipboard.writeText(txt); toast('Resumo copiado'); } catch { prompt('Copie:', txt); }
      break;
    }
    case 'anTipo': { const t = el.dataset.t, c = S.ctxAn; location.hash = t === 'per' ? `#/analise/per/${c.ini}~${c.fim}` : `#/analise/${t}/${c.ini}`; break; }
    case 'anAplicar': { const i = document.getElementById('anIni').value, f = document.getElementById('anFim').value; if (i && f) location.hash = `#/analise/per/${i <= f ? i + '~' + f : f + '~' + i}`; break; }
    case 'toggleContador': S.contadorAberto = !S.contadorAberto; telaMes(S.ctxMes); break;
    case 'novaDesp': S.despEd = { novo: true, d: rascunhoDespesa(S.ctxDesp) }; telaDespesas(S.ctxDesp); break;
    case 'editarDesp': { const d = S.meses[S.ctxDesp].despesas[+el.dataset.i]; S.despEd = { novo: false, i: +el.dataset.i, d: JSON.parse(JSON.stringify({ itens: [], ...d })) }; telaDespesas(S.ctxDesp); window.scrollTo(0, 0); break; }
    case 'cancelarDesp': S.despEd = null; telaDespesas(S.ctxDesp); break;
    case 'addItem': { const d = S.despEd.d; if (!d.itens.length && d.valor) { d.itens.push({ mat: '', qtd: '', un: '', valor: d.valor }); d.valor = 0; } else d.itens.push({ mat: '', qtd: '', un: '', valor: '' }); telaDespesas(S.ctxDesp); const n = document.querySelectorAll('[data-k=mat]'); if (n.length) n[n.length - 1].focus(); break; }
    case 'delItem': S.despEd.d.itens.splice(+el.dataset.i, 1); telaDespesas(S.ctxDesp); break;
    case 'salvarDesp': {
      const mk = S.ctxDesp, M = S.meses[mk], ed = S.despEd, d = ed.d;
      d.itens = d.itens.filter((i) => i.mat || num(i.valor)).map((i) => ({ mat: (i.mat || '').trim(), ...(num(i.qtd) ? { qtd: num(i.qtd) } : {}), ...(i.un ? { un: i.un.trim() } : {}), valor: num(i.valor) }));
      if (d.itens.some((i) => !i.mat)) { toast('Há item sem nome do material', true); break; }
      d.forn = (d.forn || '').trim(); d.desc = (d.desc || '').trim();
      d.valor = C.valorDesp(d);
      if (!(d.valor > 0)) { toast('Informe o valor ou os itens', true); break; }
      if (!d.itens.length) delete d.itens;
      const destino = mkDe(d.data || `${mk}-01`);
      if (!ed.novo) M.despesas.splice(ed.i, 1);
      const Md = await mes(destino); Md.despesas = Md.despesas || []; Md.despesas.push(d);
      salvarMes(mk); if (destino !== mk) salvarMes(destino);
      if (aprenderCadastros(d)) await salvarCfg();
      S.despEd = null; toast(destino !== mk ? `Despesa salva em ${nomeMes(destino)}` : 'Despesa salva'); telaDespesas(mk); break;
    }
    case 'excluirDesp': { if (!confirm('Excluir esta despesa?')) break; S.meses[S.ctxDesp].despesas.splice(S.despEd.i, 1); salvarMes(S.ctxDesp); S.despEd = null; telaDespesas(S.ctxDesp); break; }
    case 'lancarFixas': {
      const mk = S.ctxDesp, M = S.meses[mk];
      M.despesas = M.despesas || [];
      for (const f of S.cfg.despesasFixas) M.despesas.push({ id: uid(), data: `${mk}-01`, cat: catFixa(f), forn: '', desc: f.desc, valor: Number(f.valor) || 0, fixa: true });
      salvarMes(mk); telaDespesas(mk); break;
    }
    case 'addCad': { const k = el.dataset.cad; const nome = prompt({ fornecedores: 'Nome do fornecedor:', categorias: 'Nome do tipo de despesa:', materiais: 'Nome do material:' }[k]); if (!nome || !nome.trim()) break; S.cfg[k].push({ id: k === 'categorias' ? (slug(nome) || uid()) + (S.cfg.categorias.some((c) => c.id === slug(nome)) ? uid().slice(-3) : '') : uid(), nome: nome.trim() }); S.cfg[k].sort((a, b) => a.nome.localeCompare(b.nome)); await salvarCfg(); telaDespesas(S.ctxDesp); break; }
    case 'delCad': { const k = el.dataset.cad, i = +el.dataset.i; if (!confirm(`Excluir "${S.cfg[k][i].nome}" do cadastro? Despesas já lançadas não mudam.`)) break; S.cfg[k].splice(i, 1); await salvarCfg(); telaDespesas(S.ctxDesp); break; }
    case 'delVeic': if (confirm('Remover veículo?')) { S.frota.splice(+el.dataset.i, 1); await salvarFrota(); rotear(); } break;
    case 'fecharSulgas': {
      const { ini, fim, itens } = await sulgasEmAberto();
      if (!itens.length) break;
      const total = C.r2(itens.reduce((a, b) => a + (Number(b.valor) || 0), 0));
      if (!confirm(`Fechar o período de ${dataBR(ini)} a ${dataBR(fim)}: ${itens.length} lavagens, ${brl(total)}?\n\nElas ficam marcadas como cobradas e o PDF abre em seguida.`)) break;
      const fechs = await fechamentosSulgas();
      const f = { id: 'f' + Date.now().toString(36), numero: (fechs.length ? fechs[fechs.length - 1].numero : 0) + 1, ini, fim, gerado: new Date().toISOString(), total, itens: itens.map(({ ref, ...x }) => x) };
      const mks = new Set();
      for (const x of itens) { const [mk, dd, i] = x.ref; S.meses[mk].dias[dd].lav[i].fat = f.id; mks.add(mk); }
      try {
        for (const mk of mks) await gravarMes(mk);
        fechs.push(f); await salvarFechamentosSulgas();
      } catch (e) { toast('Não consegui fechar: ' + e.message, true); break; }
      location.hash = '#/sulgaspdf/' + f.id; break;
    }
    case 'desfazerSulgas': {
      const fechs = await fechamentosSulgas(); const f = fechs[fechs.length - 1];
      if (!f || f.id !== el.dataset.id || !confirm(`Desfazer o fechamento nº ${f.numero}? As ${f.itens.length} lavagens voltam a ficar em aberto.`)) break;
      for (const mk of A.mesesEntre(f.ini, f.fim)) { const M = await mes(mk); let mudou = false; for (const d of Object.values(M.dias)) for (const l of d.lav || []) if (l.fat === f.id) { delete l.fat; mudou = true; } if (mudou) await gravarMes(mk); }
      fechs.pop(); await salvarFechamentosSulgas(); telaSulgasAberto(); break;
    }
    case 'copiarSulgasAberto': {
      const { ini, fim, itens } = await sulgasEmAberto();
      const txt = `Lavagens Sulgás ${dataBR(ini)} a ${dataBR(fim)}\n` + itens.map((x, i) => `${i + 1}. ${dataBR(x.data)}${x.ticket ? ' · ticket ' + x.ticket : ''} · ${x.placa}${x.nome ? ' · ' + x.nome : ''}`).join('\n') + `\nTotal: ${itens.length} lavagens = ${brl(itens.reduce((a, b) => a + (Number(b.valor) || 0), 0))}`;
      try { await navigator.clipboard.writeText(txt); toast('Lista copiada'); } catch { prompt('Copie:', txt); }
      break;
    }
    case 'copiarSulgas': {
      const nomeDeSul = (pl) => motoristaDe(pl);
      const { itens, per } = S.ctxSul;
      const txt = `Lavagens Sulgás ${dataBR(per.ini)} a ${dataBR(per.fim)}\n` + itens.map((s, i) => `${i + 1}. ${dataBR(s.data)}${s.ticket ? ' · ticket ' + s.ticket : ''} · ${s.placa}${s.nome || nomeDeSul(s.placa) ? ' · ' + (s.nome || nomeDeSul(s.placa)) : ''}`).join('\n') + `\nTotal: ${itens.length} × ${brl(S.cfg.sulgasValor)} = ${brl(itens.reduce((a, b) => a + (Number(b.valor) || 0), 0))}`;
      try { await navigator.clipboard.writeText(txt); toast('Lista copiada'); } catch { prompt('Copie:', txt); }
      break;
    }
    case 'addPreco': S.cfg.precos.push({ nome: 'Nova', valor: 0 }); await salvarCfg(); telaAjustes(); break;
    case 'delPreco': S.cfg.precos.splice(+el.dataset.i, 1); await salvarCfg(); telaAjustes(); break;
    case 'addFixa': (S.cfg.despesasFixas = S.cfg.despesasFixas || []).push({ desc: 'Nova', valor: 0 }); await salvarCfg(); telaAjustes(); break;
    case 'delFixa': S.cfg.despesasFixas.splice(+el.dataset.i, 1); await salvarCfg(); telaAjustes(); break;
    case 'exportar': exportar(); break;
    case 'excelBaixar': try { baixarArquivo(await gerarExcel()); } catch (e) { toast('Erro ao gerar Excel: ' + e.message, true); } break;
    case 'excelEnviar': try { await excelEnviar(); } catch (e) { toast('Erro ao enviar: ' + e.message, true); } break;
    case 'conectar': {
      try { const cfg = interpretarConfig(document.getElementById('fbcfg').value); salvarConfigFirebase(cfg); toast('Configuração salva. Entrando…'); setTimeout(() => location.reload(), 600); }
      catch (e) { toast(e.message, true); }
      break;
    }
    case 'voltarFirebase': usarFirebasePadrao(); location.reload(); break;
    case 'sair': await S.store.sair(); location.reload(); break;
    case 'desconectar': if (confirm('Voltar ao modo local neste aparelho? (os dados no Firebase continuam lá)')) { salvarConfigFirebase(null); location.reload(); } break;
  }
});

// redesenha a tela mantendo o foco no campo para onde o usuário foi
async function redesenhar(fn) {
  await new Promise((r) => setTimeout(r, 0)); // espera o foco ir para o próximo campo
  const a = document.activeElement;
  const sel = a && a !== document.body && a.matches('input,textarea,select')
    ? (a.dataset.folhaProx ? `[data-folha-prox="${a.dataset.folhaProx}"]` : a.dataset.fitem ? `[data-fitem="${a.dataset.fitem}"][data-k="${a.dataset.k}"][data-i="${a.dataset.i}"][data-c="${a.dataset.c}"]`
      : ['data-pg', 'data-campo', 'data-folha', 'id'].map((k) => a.getAttribute(k) ? `[${k}="${a.getAttribute(k)}"]${k === 'data-folha' ? `[data-k="${a.dataset.k}"]` : ''}` : '').find(Boolean)) : null;
  await fn();
  if (sel) { const n = document.querySelector(sel); if (n) { n.focus(); if (n.select) n.select(); } }
}

$app.addEventListener('input', (ev) => {
  const el = ev.target;
  if (S.despEd && (el.dataset.ed || el.dataset.edi != null)) {
    const d = S.despEd.d;
    if (el.dataset.ed) d[el.dataset.ed] = el.dataset.ed === 'valor' ? num(el.value) : el.value;
    else {
      const it = d.itens[+el.dataset.edi]; it[el.dataset.k] = el.value;
      if (el.dataset.k === 'mat') { const m = S.cfg.materiais.find((x) => x.nome === el.value); const u = el.parentNode.querySelector('[data-k=un]'); if (m && m.un && u && !u.value) { u.value = m.un; it.un = m.un; } }
      const sm = document.getElementById('somaDesp'); if (sm) sm.textContent = brl(C.valorDesp({ itens: d.itens.map((i) => ({ valor: num(i.valor) })) }));
    }
    return;
  }
  if (ev.target.id === 'placaSul') { mostrarPlaca(); return; }
  if (ev.target.id === 'motSul') { ev.target.dataset.auto = ''; mostrarPlaca(true); return; }
  if (ev.target.id === 'cortNome') { S.cortNome = ev.target.value; return; }
  if (ev.target.id !== 'detNome') return;
  const m = ((S.cfg.nomes || {})[S.detAberto] || []).find((x) => x.nome === ev.target.value);
  const v = document.getElementById('detValor');
  if (m && v && !v.value) v.value = fmtN(m.valor);
});

$app.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (['detNome', 'detValor', 'detObs', 'placaSul', 'motSul', 'modSul', 'ticketSul', 'motPadrao', 'cortNome'].includes(el.id)) return;
  if (el.dataset.act === 'irData' && el.value) { location.hash = '#/hoje/' + el.value; return; }
  if (el.dataset.act === 'feriado') { const d = diaAtual(); if (el.checked) d.feriado = true; else delete d.feriado; salvarMes(S.ctxDia.mk); telaDia(S.ctxDia.iso); return; }
  if (el.id === 'convArq' && el.files[0]) { const f = el.files[0]; try { await processarConvenio(await V.lerArquivo(f.name, await f.arrayBuffer()), f.name); } catch (e) { toast(e.message, true); } return; }
  if (el.dataset.conv) { const c = S.cfg.convSab = { ...(S.cfg.convSab || {}), ...cfgConv(), regraRevista: true }; const k = el.dataset.conv; c[k] = ['valorDia', 'vagas', 'valorExtra'].includes(k) ? num(el.value) : el.value; await salvarCfg(); status('Salvo ✓'); return; }
  if (el.dataset.pg && S.ctxDia) {
    const d = diaAtual(); d.pg = d.pg || {}; const v = num(el.value);
    if (v) d.pg[el.dataset.pg] = v; else delete d.pg[el.dataset.pg];
    salvarMes(S.ctxDia.mk); redesenhar(() => telaDia(S.ctxDia.iso)); return;
  }
  if (el.dataset.campo && S.ctxDia) {
    const d = diaAtual(); const k = el.dataset.campo;
    d[k] = k === 'obs' ? el.value : (k === 'valor' ? num(el.value) : Math.round(num(el.value)));
    if (k !== 'obs') { delete d.legado; delete d.premioLeg; S.abrirPlanilha = true; if (!d[k]) delete d[k]; }
    salvarMes(S.ctxDia.mk); if (k !== 'obs') redesenhar(() => telaDia(S.ctxDia.iso)); return;
  }
  if (el.dataset.folhaProx) {
    const mkP = somaMes(S.ctxEquipe, 1), Mp = await mes(mkP); Mp.folha = Mp.folha || {};
    (Mp.folha[el.dataset.folhaProx] = Mp.folha[el.dataset.folhaProx] || {}).vtDias = num(el.value);
    salvarMes(mkP); redesenhar(() => telaEquipe(S.ctxEquipe)); return;
  }
  if (el.dataset.fitem) {
    const mk = S.ctxEquipe, M = S.meses[mk]; M.folha = M.folha || {};
    const lst = (M.folha[el.dataset.fitem] = M.folha[el.dataset.fitem] || {})[el.dataset.k] || [];
    const it = lst[+el.dataset.i]; if (!it) return;
    it[el.dataset.c] = el.dataset.c === 'valor' ? num(el.value) : el.value;
    salvarMes(mk); if (el.dataset.c === 'valor') redesenhar(() => telaEquipe(mk)); return;
  }
  if (el.dataset.folha) {
    const mk = S.ctxEquipe, M = S.meses[mk], id = el.dataset.folha, k = el.dataset.k;
    M.folha = M.folha || {}; M.folha[id] = M.folha[id] || {};
    if (k === 'premioManual') delete M.folha[id].premioOrigem;
    if (k === 'premioManual' && el.value.trim() === '') delete M.folha[id][k];
    else M.folha[id][k] = k === 'obs' ? el.value : num(el.value);
    salvarMes(mk); if (k !== 'obs') redesenhar(() => telaEquipe(mk)); return;
  }
  if (el.dataset.ed || el.dataset.edi != null) return;
  if (el.dataset.cad) {
    const item = S.cfg[el.dataset.cad][+el.dataset.i];
    const v = el.value.trim(); if (el.dataset.k === 'nome' && !v) { el.value = item.nome; return; }
    item[el.dataset.k] = v; await salvarCfg(); status('Salvo ✓'); return;
  }
  if (el.dataset.campoCx) {
    const c = campos().find((x) => x.k === el.dataset.campoCx);
    if (el.dataset.k === 'nome') { if (el.value.trim()) c.nome = el.value.trim(); } else c.detalhar = el.checked;
    await salvarCfg(); status('Salvo ✓'); return;
  }
  if (el.dataset.preco != null) { const p = S.cfg.precos[+el.dataset.preco]; p[el.dataset.k] = el.dataset.k === 'valor' ? num(el.value) : el.value; await salvarCfg(); status('Salvo ✓'); return; }
  if (el.dataset.fixa != null) { const p = S.cfg.despesasFixas[+el.dataset.fixa]; p[el.dataset.k] = el.dataset.k === 'valor' ? num(el.value) : el.value; await salvarCfg(); status('Salvo ✓'); return; }
});

// Enter no campo de placa/valor adiciona direto
$app.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  if (ev.target.id === 'ticketSul') { ev.preventDefault(); document.getElementById('placaSul').focus(); }
  if (ev.target.id === 'cortNome') { ev.preventDefault(); ev.target.blur(); }
  if (['placaSul', 'motSul', 'modSul'].includes(ev.target.id)) { ev.preventDefault(); document.querySelector('[data-act=addSulgas]').click(); }
  if (ev.target.id === 'outroValor') { ev.preventDefault(); document.querySelector('[data-act=addOutro]').click(); }
  if (['detNome', 'detValor', 'detObs'].includes(ev.target.id)) { ev.preventDefault(); document.querySelector('[data-act=addDet]').click(); }
});

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js');
iniciar();
