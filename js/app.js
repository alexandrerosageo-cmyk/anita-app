import * as C from './calc.js';
import { criarStore, salvarConfigFirebase, interpretarConfig, lerConfigFirebase, usarFirebasePadrao } from './store.js';

const VERSAO = '1.7.0';
const $app = document.getElementById('app');
const S = { store: null, cfg: null, funcs: [], frota: [], meses: {}, tipoSel: 'paga', salvando: 0 };

// ---------- utilidades ----------
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
const slug = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function toast(msg, erro) {
  const t = document.createElement('div'); t.className = 'toast' + (erro ? ' erro' : ''); t.textContent = msg;
  document.body.appendChild(t); setTimeout(() => t.remove(), 2600);
}
function status(txt) { const el = document.getElementById('status'); if (el) el.textContent = txt; }

// ---------- dados ----------
async function mes(mk) {
  if (!S.meses[mk]) S.meses[mk] = (await S.store.get('meses', mk)) || { dias: {} };
  if (!S.meses[mk].dias) S.meses[mk].dias = {};
  return S.meses[mk];
}
const timers = {};
function salvarMes(mk) {
  status('Salvando…');
  clearTimeout(timers[mk]);
  timers[mk] = setTimeout(async () => {
    try { await S.store.set('meses', mk, S.meses[mk]); status('Salvo ✓'); }
    catch (e) { status('Erro ao salvar'); toast('Não consegui salvar: ' + e.message, true); }
  }, 600);
}
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
  S.cfg.fornecedores = S.cfg.fornecedores || [];
  S.cfg.materiais = S.cfg.materiais || [];
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
    if (S.store.modo === 'firebase' && !logado) return telaLogin();
  } catch (e) {
    $app.innerHTML = `<div class="card"><h2>Não consegui conectar ao Firebase</h2><p>${esc(e.message)}</p>
      <button class="btn" data-act="desconectar">Voltar ao modo local</button></div>`;
    return;
  }
  await carregarBase();
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
  const [, rota = 'hoje', a, b] = (location.hash || '#/hoje').split('/');
  S.rota = rota;
  try {
    if (rota === 'hoje') await telaDia(a || hojeISO());
    else if (rota === 'mes') await telaMes(a || mkDe(hojeISO()));
    else if (rota === 'equipe') await telaEquipe(a || mkDe(hojeISO()));
    else if (rota === 'demo') await telaDemo(a, b);
    else if (rota === 'sulgas') await telaSulgas(a || hojeISO());
    else if (rota === 'despesas') await telaDespesas(a || mkDe(hojeISO()));
    else if (rota === 'ajustes') await telaAjustes();
    else location.hash = '#/hoje';
  } catch (e) { console.error(e); $app.innerHTML = moldura(`<div class="card erro">Erro: ${esc(e.message)}</div>`); }
  window.scrollTo(0, 0);
}

function moldura(corpo, titulo) {
  const r = S.rota;
  const nav = [['hoje', '📝', 'Hoje'], ['mes', '📊', 'Mês'], ['equipe', '👥', 'Equipe'], ['despesas', '🧾', 'Despesas'], ['sulgas', '🚐', 'Sulgás'], ['ajustes', '⚙️', 'Ajustes']];
  return `<header class="topo"><div><b>Estacionamento Anita</b>${titulo ? `<small>${titulo}</small>` : ''}</div><span id="status" class="status">${S.store.modo === 'local' ? 'modo local' : ''}</span></header>
  <main>${corpo}</main>
  <nav class="nav">${nav.map(([k, i, t]) => `<a href="#/${k}" class="${r === k || (r === 'demo' && k === 'equipe') ? 'ativo' : ''}"><span>${i}</span>${t}</a>`).join('')}</nav>`;
}

// ---------- TELA: dia ----------
async function telaDia(iso) {
  if (S.ctxDia && S.ctxDia.iso !== iso) S.detAberto = null;
  const mk = mkDe(iso), dd = iso.slice(8);
  const M = await mes(mk);
  const dia = M.dias[dd] || {};
  const nova = C.regraNova(iso, S.cfg);
  const p = C.premioDia(dia, iso, S.cfg);
  const prox = nova ? C.proximaFaixa(p.contados, iso, S.cfg) : null;
  const legadoAgregado = !Array.isArray(dia.lav) && (dia.legado || dia.pagas || dia.valor);
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
  ${iso !== hojeISO() ? `<a class="hojelink" href="#/hoje/${hojeISO()}">voltar para hoje</a>` : ''}

  <section class="card destaque nivel${p.faixa.nivel}">
    <div class="placar">
      <div><span class="grande">${p.contados}</span><small>veículos contados</small></div>
      <div><span class="grande">${brl(p.porPessoa)}</span><small>prêmio por pessoa${nova ? '' : ' (regra antiga)'}</small></div>
    </div>
    ${nova ? `<div class="barra"><i style="width:${prog}%"></i><em style="left:${(3 / metaDia) * 100}%"></em><em style="left:${(8 / metaDia) * 100}%"></em></div>
    <p class="faixa"><b>${esc(p.faixa.nome)}</b>${p.faixa.pct ? ` · ${pct(p.faixa.pct)} de ${brl(p.base)}` : ''}${prox ? ` · faltam <b>${prox.faltam}</b> para ${pct(prox.pct)}` : (p.faixa.nivel >= 3 ? ' · meta da equipe batida! 🎉' : '')}</p>`
    : `<p class="faixa">Dia anterior à vigência do regulamento novo (${dataBR(S.cfg.vigencia)}). Pela regra nova seria ${brl(C.premioDiaNova(dia, iso, S.cfg))}.</p>`}
    <p class="mini">Pagas ${p.pagas} · Cortesias ${p.cort} · Sulgás ${p.sulgas}${p.retornos ? ` · Retornos ${p.retornos} (não contam)` : ''} · Lavagens pagas ${brl(p.valorPagas)}</p>
  </section>

  ${legadoAgregado ? `
  <section class="card">
    <h3>Lavagens (dia importado da planilha)</h3>
    <div class="grade2">
      <label>Pagas<input inputmode="numeric" data-campo="pagas" value="${dia.pagas || ''}"></label>
      <label>Valor das pagas<input inputmode="decimal" data-campo="valor" value="${fmtN(dia.valor)}"></label>
      <label>Cortesias<input inputmode="numeric" data-campo="cort" value="${dia.cort || ''}"></label>
      <label>Sulgás<input inputmode="numeric" data-campo="sulgas" value="${dia.sulgas || ''}"></label>
    </div>
    <button class="btn link" data-act="converterDia">Passar a lançar carro a carro</button>
  </section>` : `
  <section class="card">
    <h3>Lançar lavagem</h3>
    <div class="seg" role="tablist">${['paga', 'cortesia', 'sulgas', 'retorno'].map((t) => `<button data-act="tipo" data-t="${t}" class="${S.tipoSel === t ? 'on t-' + t : ''}">${C.TIPOS[t].nome}</button>`).join('')}</div>
    ${S.tipoSel === 'sulgas' ? `
      <div class="linha"><input id="placaSul" list="frotaList" placeholder="Placa do veículo Sulgás" autocapitalize="characters" autocomplete="off">
      <button class="btn" data-act="addSulgas">+ Sulgás ${brl(S.cfg.sulgasValor)}</button></div>
      <p id="infoPlaca" class="mini">Digite a placa: o motorista cadastrado aparece aqui.</p>
      <div id="novoMot" class="linha" hidden><input id="motSul" placeholder="Motorista desta placa" autocomplete="off"><input id="modSul" placeholder="Modelo (opcional)" style="max-width:8rem"></div>
      <datalist id="frotaList">${S.frota.map((v) => `<option value="${esc(v.placa)}">${esc(v.nome || '')} ${esc(v.modelo || '')}</option>`).join('')}</datalist>`
    : `<div class="precos">${S.cfg.precos.map((pr, i) => `<button class="preco t-${S.tipoSel}" data-act="addLav" data-i="${i}"><b>${esc(pr.nome)}</b>${!mesmoRotulo(pr) ? `<small>${brl(pr.valor)}</small>` : ''}</button>`).join('')}</div>
      ${S.tipoSel === 'paga' ? `<div class="linha"><input id="outroValor" inputmode="decimal" placeholder="Outro valor (com desconto)"><button class="btn" data-act="addOutro">+ Adicionar</button></div>` : `<p class="mini">${S.tipoSel === 'cortesia' ? 'Cortesia conta como carro, mas entra com valor zero.' : 'Retorno (refeito por reclamação) não conta para meta nem para a base.'}</p>`}`}
    ${lav.length ? `<ol class="lavs">${lav.map((l, i) => `<li class="t-${l.t}"><span>${C.TIPOS[l.t].nome}${l.placa ? ' · ' + esc(l.placa) : ''}${l.t === 'sulgas' && (l.mot || motoristaDe(l.placa)) ? ' · ' + esc(l.mot || motoristaDe(l.placa)) : ''}${l.desc ? ' · ' + esc(l.desc) : ''}</span><b>${l.t === 'paga' || l.t === 'sulgas' ? brl(l.v) : '—'}</b><button class="x" data-act="delLav" data-i="${i}" aria-label="remover">✕</button></li>`).join('')}</ol>` : '<p class="vazio">Nenhuma lavagem lançada neste dia.</p>'}
  </section>`}

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

  <section class="card">
    <h3>Observações</h3>
    <textarea data-campo="obs" rows="2" placeholder="Mensalista novo, ocorrência, etc.">${esc(dia.obs || '')}</textarea>
  </section>`;
  $app.innerHTML = moldura(corpo, 'Lançamento do dia');
  S.ctxDia = { iso, mk, dd };
}

// ---------- frota Sulgás ----------
const normPlaca = (p) => String(p || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
const veiculo = (pl) => S.frota.find((x) => normPlaca(x.placa) === normPlaca(pl));
const motoristaDe = (pl) => (veiculo(pl) || {}).nome || '';
function mostrarPlaca() {
  const inp = document.getElementById('placaSul'); if (!inp) return;
  const pl = normPlaca(inp.value), info = document.getElementById('infoPlaca'), box = document.getElementById('novoMot');
  if (pl.length < 7) { info.textContent = 'Digite a placa: o motorista cadastrado aparece aqui.'; info.className = 'mini'; box.hidden = true; return; }
  const v = veiculo(pl);
  if (v && v.nome) { info.innerHTML = `✅ <b>${esc(v.nome)}</b>${v.modelo ? ' · ' + esc(v.modelo) : ''}${v.cor ? ' · ' + esc(v.cor) : ''}`; info.className = 'mini ok'; box.hidden = true; }
  else { info.textContent = v ? 'Placa cadastrada, mas sem motorista. Informe abaixo:' : 'Placa nova na frota. Informe o motorista:'; info.className = 'mini alerta'; box.hidden = false; }
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
  const dia = diaAtual(); if (!Array.isArray(dia.lav)) dia.lav = [];
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
    <div class="kpi destaque-contador"><small>Ao contador</small><b>${brl(C.aoContador(ap))}</b><small>receita − dinheiro (${brl(C.dinheiroMes(ap))})</small></div>
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
       <p class="mini">Pela regra nova seriam ${brl(ap.tot.simNova)} em prêmios diários${C.faixaMes(ap.tot.contados, S.cfg) ? ` + bônus de ${brl(C.faixaMes(ap.tot.contados, S.cfg).valor)}` : ''} (pagas ${ap.tot.pagas} · cortesias ${ap.tot.cort} · Sulgás ${ap.tot.sulgas}).</p>`}
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
  const soLeitura = (M.folhaLegado || []).length && !M.folhaApp;
  let folha = '';
  if (soLeitura) {
    const t = (k) => M.folhaLegado.reduce((a, e) => a + (e[k] || 0), 0);
    folha = `<section class="card"><h3>Folha importada da planilha</h3>
      <table class="tab"><thead><tr><th>Nome</th><th>Salário</th><th>Prêmio</th><th>Desc.</th><th>Total</th></tr></thead><tbody>
      ${M.folhaLegado.map((e) => `<tr><td>${esc(e.nome)}<small>${e.diasTrab}/${e.diasMes} dias${e.vtDias ? ` · VT ${e.vtDias}×${brl(e.vtDia)}` : ''}${e.obs ? ' · ' + esc(e.obs) : ''}</small></td><td>${brl(e.salario)}</td><td>${brl(e.premio ?? e.extras)}</td><td>${e.descontos ? brl(e.descontos) : ''}</td><td><b>${brl(e.total)}</b></td></tr>`).join('')}
      <tr class="tot"><td>Total</td><td>${brl(t('salario'))}</td><td>${brl(t('premio') || t('extras'))}</td><td>${brl(t('descontos'))}</td><td>${brl(t('total'))}</td></tr></tbody></table>
      <button class="btn" data-act="folhaNoApp">Editar esta folha no app</button>
      <p class="mini">Copia os dias, VT e descontos acima para o app; daí em diante você ajusta salário, VT, extras e descontos aqui.</p></section>`;
  } else {
    const fm = ap.faixaMes;
    const lista = S.funcs.filter((f) => { const pf = ap.porFunc[f.id]; return C.ativoEm(f, `${mk}-15`) || (pf && (pf.T || pf.F || pf.J || pf.premioDiario)) || ((M.folha || {})[f.id]); }).sort((a, b) => a.nome.localeCompare(b.nome));
    let totGeral = 0, totVT = 0;
    folha = lista.map((f) => {
      const pf = ap.porFunc[f.id] || { T: 0, F: 0, J: 0, previstos: 0, presencaPct: 0, premioDiario: 0, bonus: 0, premioTotal: 0, elegivelBonus: false, dias: [] };
      const fo = (M.folha || {})[f.id] || {};
      const r = C.folhaFunc(f, pf, fo, S.cfg);
      totGeral += r.total; totVT += r.vt;
      const motivo = !ap.regraNova ? 'regra antiga: sem bônus' : !fm ? 'equipe abaixo da meta mensal' : (pf.elegivelBonus ? `meta mensal ${fm.nivel}` : `presença ${Math.round(pf.presencaPct * 100)}% < ${S.cfg.presencaMin}%`);
      return `<section class="card func">
        <h3>${esc(f.nome)} <small>${esc(f.funcao || 'função não definida')}</small></h3>
        <p class="mini">Trabalhou ${pf.T} · Faltas ${pf.F} · Justificadas ${pf.J}${pf.previstos ? ` · Presença ${Math.round(pf.presencaPct * 100)}%` : ''}</p>
        <table class="tab desp"><tbody>
          <tr><td>Salário <small>${brl(r.salMes)} ÷ 30 × <input class="mini-in" inputmode="numeric" data-folha="${f.id}" data-k="diasTrab" value="${r.diasTrab}"> dias</small></td><td class="r">${brl(r.salario)}</td></tr>
          <tr><td>Prêmio diário <small>${pf.dias.filter((d) => d.valor).length} dias com prêmio${ap.regraNova ? '' : ' (regra antiga)'}</small></td><td class="r">${brl(pf.premioDiario)}</td></tr>
          ${ap.regraNova ? `<tr><td>Bônus mensal <small>${motivo}</small></td><td class="r">${brl(pf.bonus)}</td></tr>` : ''}
          ${r.fixos.map((x) => `<tr class="${x.ativo ? '' : 'riscado'}"><td>${x.sinal === '+' ? '+' : '−'} ${esc(x.desc)} <span class="tag">fixo${x.pct != null ? ' ' + pct(x.pct) : ''}</span>
            <button class="btn link mini" data-act="fixoMes" data-id="${f.id}" data-i="${x.i}">${x.ativo ? 'não lançar este mês' : 'lançar este mês'}</button></td><td class="r">${x.sinal === '+' ? '' : '−'}${brl(x.valor)}</td></tr>`).join('')}
          ${(fo.extras || []).map((e, i) => `<tr><td>+ ${esc(e.desc)}</td><td class="r">${brl(e.valor)} <button class="x" data-act="delFolha" data-id="${f.id}" data-k="extras" data-i="${i}">✕</button></td></tr>`).join('')}
          ${(fo.descontos || []).map((e, i) => `<tr><td>− ${esc(e.desc)}</td><td class="r">−${brl(e.valor)} <button class="x" data-act="delFolha" data-id="${f.id}" data-k="descontos" data-i="${i}">✕</button></td></tr>`).join('')}
          <tr class="tot"><td>Total a pagar <a href="#/demo/${mk}/${f.id}" class="tag">demonstrativo do prêmio</a></td><td class="r">${brl(r.total)}</td></tr>
          <tr><td>VT <small><input class="mini-in" inputmode="numeric" data-folha="${f.id}" data-k="vtDias" value="${r.vtDias}"> dias × <input class="mini-in" inputmode="decimal" data-folha="${f.id}" data-k="vtDia" value="${fmtN(r.vtDia)}"></small></td><td class="r">${brl(r.vt)}</td></tr>
        </tbody></table>
        <form class="linha fExtra" data-id="${f.id}"><select name="k" style="max-width:7.5rem"><option value="extras">+ Extra</option><option value="descontos">− Desconto</option></select><input name="desc" placeholder="Hora extra, adiantamento…" required><input name="valor" inputmode="decimal" placeholder="R$" required style="max-width:5.5rem"><button class="btn">ok</button></form>
        <input class="obs" data-folha="${f.id}" data-k="obs" placeholder="Observação (ex.: pago em 05/12)" value="${esc(fo.obs || '')}">
      </section>`;
    }).join('') + `<section class="card"><h3>Total da folha <small>${brl(totGeral)} + VT ${brl(totVT)}</small></h3>
      ${M.folhaApp ? '<button class="btn link" data-act="folhaVoltar">Voltar a mostrar a folha da planilha</button>' : ''}</section>`;
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

  const corpo = `
  <div class="navdata"><a class="btn ic" href="#/despesas/${somaMes(mk, -1)}">‹</a><b class="titmes">${nomeMes(mk)}</b><a class="btn ic" href="#/despesas/${somaMes(mk, 1)}">›</a></div>
  <div class="kpis"><div class="kpi"><small>Despesas lançadas</small><b>${brl(total)}</b></div><div class="kpi"><small>Lançamentos</small><b>${lista.length}</b></div></div>
  ${editor || `<div class="linha"><button class="btn grande" data-act="novaDesp">+ Nova despesa</button></div>
    ${(S.cfg.despesasFixas || []).length && !fixasLancadas ? `<button class="btn link" data-act="lancarFixas">Lançar despesas fixas do mês (${S.cfg.despesasFixas.map((d) => esc(d.desc)).join(', ')})</button>` : ''}`}

  ${lista.length ? `<section class="card"><h3>Por tipo</h3>${barras(porTipo(lista))}</section>` : ''}

  <section class="card"><h3>Lançamentos</h3>
    ${lista.length ? `<table class="tab"><tbody>${[...lista].sort((a, b) => (b.data || '').localeCompare(a.data || '')).map((d) => `<tr data-act="editarDesp" data-i="${d._i}" class="clic">
      <td>${d.data ? dataBR(d.data).slice(0, 5) : ''}</td>
      <td><b>${esc(d.forn || d.desc || nomeCat(d.cat))}</b><small>${esc(nomeCat(d.cat))}${d.itens && d.itens.length ? ' · ' + d.itens.map((i) => esc(i.mat)).join(', ') : (d.desc && d.forn ? ' · ' + esc(d.desc) : '')}</small></td>
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
async function telaSulgas(iso) {
  const per = C.periodoSulgas(iso);
  const mks = [...new Set([mkDe(per.ini), mkDe(per.fim)])];
  for (const mk of mks) await mes(mk);
  const itens = [];
  for (const mk of mks) {
    const M = S.meses[mk];
    for (const s of M.sulgasLista || []) if (s.data >= per.ini && s.data <= per.fim) itens.push({ ...s, origem: 'planilha' });
    for (const [dd, dia] of Object.entries(M.dias)) {
      const di = `${mk}-${dd}`; if (di < per.ini || di > per.fim) continue;
      (dia.lav || []).forEach((l) => { if (l.t === 'sulgas') itens.push({ data: di, placa: l.placa || '', nome: l.mot || '', valor: l.v }); });
      if (!Array.isArray(dia.lav) && dia.sulgas && !(M.sulgasLista || []).some((s) => s.data === di)) for (let i = 0; i < dia.sulgas; i++) itens.push({ data: di, placa: '(sem placa)', valor: S.cfg.sulgasValor });
    }
  }
  itens.sort((a, b) => a.data.localeCompare(b.data));
  const nomeDe = (pl) => { const v = veiculo(pl); return v ? `${v.nome || ''} ${v.modelo ? '· ' + v.modelo : ''}` : ''; };
  const total = itens.reduce((a, b) => a + (Number(b.valor) || 0), 0);
  const corpo = `
  <div class="navdata"><a class="btn ic" href="#/sulgas/${somaDias(per.ini, -1)}">‹</a><b class="titmes semcap">${dataBR(per.ini).slice(0, 5)} a ${dataBR(per.fim)}</b><a class="btn ic" href="#/sulgas/${somaDias(per.fim, 1)}">›</a></div>
  <div class="kpis"><div class="kpi"><small>Lavagens no período</small><b>${itens.length}</b></div><div class="kpi"><small>Valor a faturar</small><b>${brl(total)}</b></div></div>
  <section class="card"><h3>Lavagens Sulgás</h3>
    ${itens.length ? `<table class="tab"><thead><tr><th>Data</th><th>Placa</th><th>Usuário</th><th>Valor</th></tr></thead><tbody>
    ${itens.map((s) => `<tr data-href="#/hoje/${s.data}"><td>${dataBR(s.data).slice(0, 5)}</td><td>${esc(s.placa)}</td><td><small>${esc(s.nome || nomeDe(s.placa))}</small></td><td>${brl(s.valor)}</td></tr>`).join('')}</tbody></table>` : '<p class="vazio">Nenhuma lavagem Sulgás neste período.</p>'}
    <button class="btn link" data-act="copiarSulgas">Copiar lista para enviar</button>
  </section>
  <section class="card"><h3>Frota Sulgás <small>${S.frota.length} veículos</small></h3>
    <details><summary>Ver / editar frota</summary>
    <table class="tab"><tbody>${S.frota.map((v, i) => `<tr><td>${esc(v.placa)}</td><td><small>${esc(v.modelo || '')}</small></td><td><small>${esc(v.nome || '')}</small></td><td><button class="x" data-act="delVeic" data-i="${i}">✕</button></td></tr>`).join('')}</tbody></table>
    <form class="linha" id="fVeic"><input name="placa" placeholder="Placa" required autocapitalize="characters" style="max-width:6.5rem"><input name="modelo" placeholder="Modelo" style="max-width:6rem"><input name="nome" placeholder="Usuário"><button class="btn">+</button></form>
    </details></section>`;
  $app.innerHTML = moldura(corpo, 'Contrato Sulgás');
  S.ctxSul = { iso, itens, per };
  document.getElementById('fVeic').onsubmit = async (ev) => {
    ev.preventDefault(); const fd = new FormData(ev.target);
    S.frota.push({ placa: fd.get('placa').toUpperCase().trim(), modelo: fd.get('modelo').trim(), nome: fd.get('nome').trim() });
    await salvarFrota(); telaSulgas(iso);
  };
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
    <h4>Outros</h4>
    <div class="grade2">
      <label>Valor por lavagem Sulgás<input name="sulgasValor" inputmode="decimal" value="${fmtN(c.sulgasValor)}"></label>
      <label>Imposto (% s/ faturamento declarado)<input name="impostoPct" inputmode="decimal" value="${fmtN(c.impostoPct)}"></label>
      <label>Meta diária da equipe (carros)<input name="metaDia" inputmode="numeric" value="${c.metaDia}"></label>
    </div>
    <button class="btn grande">Salvar regras</button>
  </form>

  <section class="card"><h3>Campos do caixa do dia</h3>
    <p class="mini">Renomeie, inclua ou tire campos. "Por nome" abre a lista de quem pagou (ex.: mensalistas, convênios). Campos tirados somem do caixa, mas os valores antigos continuam no histórico.</p>
    ${c.pagamentos.filter((x) => x.ativo !== false).map((x, i) => `<div class="linha campo-cx"><input data-campo-cx="${x.k}" data-k="nome" value="${esc(x.nome)}"><label class="chk mini"><input type="checkbox" data-campo-cx="${x.k}" data-k="detalhar" ${x.detalhar ? 'checked' : ''}> por nome</label>${i ? `<button class="x" data-act="subirCampo" data-k="${x.k}" title="subir">↑</button>` : ''}<button class="x" data-act="offCampo" data-k="${x.k}" title="tirar do caixa">✕</button></div>`).join('')}
    <button class="btn link" data-act="addCampo">+ Novo campo</button>
    ${c.pagamentos.some((x) => x.ativo === false) ? `<details><summary class="mini">Campos tirados do caixa</summary>${c.pagamentos.filter((x) => x.ativo === false).map((x) => `<div class="linha"><span style="flex:1">${esc(x.nome)}</span><button class="btn link" data-act="onCampo" data-k="${x.k}">voltar para o caixa</button></div>`).join('')}</details>` : ''}
  </section>

  <section class="card"><h3>Botões de preço das lavagens</h3>
    <p class="mini">Dê nomes (ex.: “Completa SUV”) para lançar mais rápido.</p>
    ${c.precos.map((p, i) => `<div class="linha"><input data-preco="${i}" data-k="nome" value="${esc(p.nome)}"><input data-preco="${i}" data-k="valor" inputmode="decimal" value="${fmtN(p.valor)}" style="max-width:6rem"><button class="x" data-act="delPreco" data-i="${i}">✕</button></div>`).join('')}
    <button class="btn link" data-act="addPreco">+ Novo preço</button>
  </section>

  <section class="card"><h3>Despesas fixas do mês</h3>
    <p class="mini">Viram um botão no painel do mês para lançar tudo de uma vez.</p>
    ${(c.despesasFixas || []).map((d, i) => `<div class="linha"><input data-fixa="${i}" data-k="desc" value="${esc(d.desc)}"><input data-fixa="${i}" data-k="valor" inputmode="decimal" value="${fmtN(d.valor)}" style="max-width:6rem"><button class="x" data-act="delFixa" data-i="${i}">✕</button></div>`).join('')}
    <button class="btn link" data-act="addFixa">+ Nova despesa fixa</button>
  </section>

  <section class="card"><h3>Dados</h3>
    <label class="btn arquivo">Importar histórico (.json)<input type="file" accept=".json,application/json" id="fImport" hidden></label>
    <button class="btn" data-act="exportar">Baixar backup completo</button>
    <p class="mini">Versão ${VERSAO}</p>
  </section>`;
  $app.innerHTML = moldura(corpo, 'Ajustes');

  document.getElementById('fRegras').onsubmit = async (ev) => {
    ev.preventDefault(); const fd = new FormData(ev.target);
    c.vigencia = fd.get('vigencia');
    c.faixasDia = c.faixasDia.map((f, i) => ({ nome: fd.get('fdNome' + i), min: num(fd.get('fdMin' + i)), pct: num(fd.get('fdPct' + i)) }));
    c.sabadoMin = num(fd.get('sabMin')); c.sabadoPct = num(fd.get('sabPct'));
    c.faixasMes = c.faixasMes.map((f, i) => ({ min: num(fd.get('fmMin' + i)), valor: num(fd.get('fmVal' + i)) }));
    for (const k of ['presencaMin', 'sulgasValor', 'impostoPct', 'metaDia']) c[k] = num(fd.get(k));
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
    if ((h.frota || []).length) await S.store.set('frota', 'lista', { veiculos: h.frota });
    let i = 0; const ks = Object.keys(h.meses || {});
    for (const mk of ks) {
      const atual = (await S.store.get('meses', mk)) || { dias: {} };
      const novo = h.meses[mk];
      const dias = { ...(novo.dias || {}) };
      for (const [dd, d] of Object.entries(atual.dias || {})) if (!d.legado || h.tipo === 'estacionamento-anita-backup') dias[dd] = d; // preserva o que foi lançado no app
      await S.store.set('meses', mk, { ...novo, ...atual, ...(h.tipo === 'estacionamento-anita-backup' ? novo : {}), dias, folhaLegado: novo.folhaLegado || atual.folhaLegado, despesasLegado: novo.despesasLegado || atual.despesasLegado, sulgasLista: novo.sulgasLista || atual.sulgasLista });
      status(`Importando ${++i}/${ks.length}`);
    }
    await carregarBase(); toast('Histórico importado!'); status('Salvo ✓'); location.hash = '#/mes/' + mkDe(hojeISO()); rotear();
  } catch (e) { toast('Falha ao importar: ' + e.message, true); }
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
  const tr = ev.target.closest('tr[data-href]'); if (tr && !ev.target.closest('button,input')) { location.hash = tr.dataset.href; return; }
  const el = ev.target.closest('[data-act]'); if (!el) return;
  const act = el.dataset.act;
  if (act === 'irData') return;
  const ctx = S.ctxDia;
  switch (act) {
    case 'tipo': S.tipoSel = el.dataset.t; telaDia(ctx.iso); break;
    case 'addLav': { const pr = S.cfg.precos[+el.dataset.i]; const t = S.tipoSel; addLav({ t, v: t === 'paga' ? pr.valor : 0, desc: !mesmoRotulo(pr) || t !== 'paga' ? pr.nome : undefined }); break; }
    case 'addOutro': { const v = num(document.getElementById('outroValor').value); if (v > 0) addLav({ t: 'paga', v }); break; }
    case 'addSulgas': {
      const pl = normPlaca(document.getElementById('placaSul').value);
      if (!pl) { toast('Informe a placa', true); document.getElementById('placaSul').focus(); break; }
      const v = veiculo(pl);
      const mot = (document.getElementById('motSul').value || '').trim();
      const mod = (document.getElementById('modSul').value || '').trim();
      if (!v || !v.nome) {
        if (!mot) { toast('Placa sem motorista: informe o motorista', true); mostrarPlaca(); document.getElementById('motSul').focus(); break; }
        if (v) { v.nome = mot; if (mod && !v.modelo) v.modelo = mod; } else S.frota.push({ placa: pl, nome: mot, ...(mod ? { modelo: mod } : {}) });
        salvarFrota().catch((e) => toast('Frota não salva: ' + e.message, true));
      }
      addLav({ t: 'sulgas', v: Number(S.cfg.sulgasValor), placa: pl, mot: (veiculo(pl) || {}).nome });
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
    case 'delLav': { const d = diaAtual(); d.lav.splice(+el.dataset.i, 1); salvarMes(ctx.mk); telaDia(ctx.iso); break; }
    case 'pres': { const d = diaAtual(); fixarPresenca(d); d.presenca[el.dataset.id] = el.dataset.s; salvarMes(ctx.mk); telaDia(ctx.iso); break; }
    case 'converterDia': { const d = diaAtual(); if (confirm('Os totais deste dia serão apagados para lançar carro a carro. Continuar?')) { delete d.pagas; delete d.valor; delete d.cort; delete d.sulgas; delete d.legado; d.lav = []; salvarMes(ctx.mk); telaDia(ctx.iso); } break; }
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
      const achaCat = (desc) => { const w = desc.toLowerCase().split(/[\s/]+/)[0]; return (S.cfg.categorias.find((c) => c.nome.toLowerCase().includes(w)) || {}).id || 'outros'; };
      M.despesas = M.despesas || [];
      for (const f of S.cfg.despesasFixas) M.despesas.push({ id: uid(), data: `${mk}-01`, cat: f.cat || achaCat(f.desc), forn: '', desc: f.desc, valor: Number(f.valor) || 0, fixa: true });
      salvarMes(mk); telaDespesas(mk); break;
    }
    case 'addCad': { const k = el.dataset.cad; const nome = prompt({ fornecedores: 'Nome do fornecedor:', categorias: 'Nome do tipo de despesa:', materiais: 'Nome do material:' }[k]); if (!nome || !nome.trim()) break; S.cfg[k].push({ id: k === 'categorias' ? (slug(nome) || uid()) + (S.cfg.categorias.some((c) => c.id === slug(nome)) ? uid().slice(-3) : '') : uid(), nome: nome.trim() }); S.cfg[k].sort((a, b) => a.nome.localeCompare(b.nome)); await salvarCfg(); telaDespesas(S.ctxDesp); break; }
    case 'delCad': { const k = el.dataset.cad, i = +el.dataset.i; if (!confirm(`Excluir "${S.cfg[k][i].nome}" do cadastro? Despesas já lançadas não mudam.`)) break; S.cfg[k].splice(i, 1); await salvarCfg(); telaDespesas(S.ctxDesp); break; }
    case 'delVeic': if (confirm('Remover veículo?')) { S.frota.splice(+el.dataset.i, 1); await salvarFrota(); telaSulgas(S.ctxSul.iso); } break;
    case 'copiarSulgas': {
      const { itens, per } = S.ctxSul;
      const txt = `Lavagens Sulgás ${dataBR(per.ini)} a ${dataBR(per.fim)}\n` + itens.map((s, i) => `${i + 1}. ${dataBR(s.data)} ${s.placa}`).join('\n') + `\nTotal: ${itens.length} × ${brl(S.cfg.sulgasValor)} = ${brl(itens.reduce((a, b) => a + (Number(b.valor) || 0), 0))}`;
      try { await navigator.clipboard.writeText(txt); toast('Lista copiada'); } catch { prompt('Copie:', txt); }
      break;
    }
    case 'addPreco': S.cfg.precos.push({ nome: 'Nova', valor: 0 }); await salvarCfg(); telaAjustes(); break;
    case 'delPreco': S.cfg.precos.splice(+el.dataset.i, 1); await salvarCfg(); telaAjustes(); break;
    case 'addFixa': (S.cfg.despesasFixas = S.cfg.despesasFixas || []).push({ desc: 'Nova', valor: 0 }); await salvarCfg(); telaAjustes(); break;
    case 'delFixa': S.cfg.despesasFixas.splice(+el.dataset.i, 1); await salvarCfg(); telaAjustes(); break;
    case 'exportar': exportar(); break;
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
    ? ['data-pg', 'data-campo', 'data-folha', 'id'].map((k) => a.getAttribute(k) ? `[${k}="${a.getAttribute(k)}"]${k === 'data-folha' ? `[data-k="${a.dataset.k}"]` : ''}` : '').find(Boolean) : null;
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
  if (ev.target.id !== 'detNome') return;
  const m = ((S.cfg.nomes || {})[S.detAberto] || []).find((x) => x.nome === ev.target.value);
  const v = document.getElementById('detValor');
  if (m && v && !v.value) v.value = fmtN(m.valor);
});

$app.addEventListener('change', async (ev) => {
  const el = ev.target;
  if (['detNome', 'detValor', 'detObs', 'placaSul', 'motSul', 'modSul'].includes(el.id)) return;
  if (el.dataset.act === 'irData' && el.value) { location.hash = '#/hoje/' + el.value; return; }
  if (el.dataset.pg && S.ctxDia) {
    const d = diaAtual(); d.pg = d.pg || {}; const v = num(el.value);
    if (v) d.pg[el.dataset.pg] = v; else delete d.pg[el.dataset.pg];
    salvarMes(S.ctxDia.mk); redesenhar(() => telaDia(S.ctxDia.iso)); return;
  }
  if (el.dataset.campo && S.ctxDia) {
    const d = diaAtual(); const k = el.dataset.campo;
    d[k] = k === 'obs' ? el.value : (k === 'valor' ? num(el.value) : Math.round(num(el.value)));
    salvarMes(S.ctxDia.mk); if (k !== 'obs') redesenhar(() => telaDia(S.ctxDia.iso)); return;
  }
  if (el.dataset.folha) {
    const mk = S.ctxEquipe, M = S.meses[mk], id = el.dataset.folha, k = el.dataset.k;
    M.folha = M.folha || {}; M.folha[id] = M.folha[id] || {};
    M.folha[id][k] = k === 'obs' ? el.value : num(el.value);
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
  if (['placaSul', 'motSul', 'modSul'].includes(ev.target.id)) { ev.preventDefault(); document.querySelector('[data-act=addSulgas]').click(); }
  if (ev.target.id === 'outroValor') { ev.preventDefault(); document.querySelector('[data-act=addOutro]').click(); }
  if (['detNome', 'detValor', 'detObs'].includes(ev.target.id)) { ev.preventDefault(); document.querySelector('[data-act=addDet]').click(); }
});

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js');
iniciar();
