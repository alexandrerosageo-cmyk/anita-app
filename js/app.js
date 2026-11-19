import * as C from './calc.js';
import { criarStore, salvarConfigFirebase, interpretarConfig, lerConfigFirebase, usarFirebasePadrao } from './store.js';

const VERSAO = '1.1.0';
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

async function carregarBase() {
  S.cfg = { ...CFG_PADRAO, ...((await S.store.get('config', 'app')) || {}) };
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
    else if (rota === 'ajustes') await telaAjustes();
    else location.hash = '#/hoje';
  } catch (e) { console.error(e); $app.innerHTML = moldura(`<div class="card erro">Erro: ${esc(e.message)}</div>`); }
  window.scrollTo(0, 0);
}

function moldura(corpo, titulo) {
  const r = S.rota;
  const nav = [['hoje', '📝', 'Hoje'], ['mes', '📊', 'Mês'], ['equipe', '👥', 'Equipe'], ['sulgas', '🚐', 'Sulgás'], ['ajustes', '⚙️', 'Ajustes']];
  return `<header class="topo"><div><b>Estacionamento Anita</b>${titulo ? `<small>${titulo}</small>` : ''}</div><span id="status" class="status">${S.store.modo === 'local' ? 'modo local' : ''}</span></header>
  <main>${corpo}</main>
  <nav class="nav">${nav.map(([k, i, t]) => `<a href="#/${k}" class="${r === k || (r === 'demo' && k === 'equipe') ? 'ativo' : ''}"><span>${i}</span>${t}</a>`).join('')}</nav>`;
}

// ---------- TELA: dia ----------
async function telaDia(iso) {
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
      <div class="linha"><input id="placaSul" list="frotaList" placeholder="Placa do veículo Sulgás" autocapitalize="characters">
      <button class="btn" data-act="addSulgas">+ Sulgás ${brl(S.cfg.sulgasValor)}</button></div>
      <datalist id="frotaList">${S.frota.map((v) => `<option value="${esc(v.placa)}">${esc(v.nome || '')} ${esc(v.modelo || '')}</option>`).join('')}</datalist>`
    : `<div class="precos">${S.cfg.precos.map((pr, i) => `<button class="preco t-${S.tipoSel}" data-act="addLav" data-i="${i}"><b>${esc(pr.nome)}</b>${!mesmoRotulo(pr) ? `<small>${brl(pr.valor)}</small>` : ''}</button>`).join('')}</div>
      ${S.tipoSel === 'paga' ? `<div class="linha"><input id="outroValor" inputmode="decimal" placeholder="Outro valor (com desconto)"><button class="btn" data-act="addOutro">+ Adicionar</button></div>` : `<p class="mini">${S.tipoSel === 'cortesia' ? 'Cortesia conta como carro, mas entra com valor zero.' : 'Retorno (refeito por reclamação) não conta para meta nem para a base.'}</p>`}`}
    ${lav.length ? `<ol class="lavs">${lav.map((l, i) => `<li class="t-${l.t}"><span>${C.TIPOS[l.t].nome}${l.placa ? ' · ' + esc(l.placa) : ''}${l.desc ? ' · ' + esc(l.desc) : ''}</span><b>${l.t === 'paga' || l.t === 'sulgas' ? brl(l.v) : '—'}</b><button class="x" data-act="delLav" data-i="${i}" aria-label="remover">✕</button></li>`).join('')}</ol>` : '<p class="vazio">Nenhuma lavagem lançada neste dia.</p>'}
  </section>`}

  <section class="card">
    <h3>Caixa do dia <small>${brl(p.receita)} · estacionamento ${brl(p.estacionamento)}</small></h3>
    <div class="grade2">${C.PAGAMENTOS.map(([k, t]) => `<label>${t}<input inputmode="decimal" data-pg="${k}" value="${fmtN((dia.pg || {})[k])}"></label>`).join('')}</div>
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
  <div class="kpis">
    <div class="kpi"><small>Receita</small><b>${brl(ap.tot.receita)}</b></div>
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

  <section class="card">
    <h3>Dias</h3>
    <table class="tab"><thead><tr><th>Dia</th><th>Carros</th><th>Base</th><th>Faixa</th><th>Prêmio/p.</th></tr></thead><tbody>
    ${ap.lista.filter((l) => l.temDados || !C.ehDomingo(l.iso)).map((l) => `<tr data-href="#/hoje/${l.iso}" class="${l.temDados ? '' : 'semdados'}">
      <td>${C.pad(l.d)} <small>${SEM[C.diaSemana(l.iso)].slice(0, 3)}</small></td><td>${l.contados || ''}</td><td>${l.base ? brl(l.base) : ''}</td>
      <td>${l.regra === 'nova' ? `<span class="tag n${l.faixa.nivel}">${l.faixa.pct ? pct(l.faixa.pct) : '—'}</span>` : ''}</td><td>${l.porPessoa ? brl(l.porPessoa) : ''}</td></tr>`).join('')}
    </tbody></table>
  </section>

  <section class="card">
    <h3>Despesas e resultado</h3>
    <table class="tab desp"><tbody>
      <tr><td>Receitas</td><td class="r"><b>${brl(ap.tot.receita)}</b></td><td></td></tr>
      ${res.despesas.map((d, i) => `<tr><td>${esc(d.desc)}${d.obs ? `<small>${esc(d.obs)}</small>` : ''}${d.auto ? ' <span class="tag">auto</span>' : ''}</td><td class="r">−${brl(d.valor)}</td>
        <td>${!d.auto && !res.legado ? `<button class="x" data-act="delDesp" data-i="${i - res.despesas.filter((x) => x.auto).length}">✕</button>` : ''}</td></tr>`).join('')}
      <tr class="tot"><td>Resultado</td><td class="r"><b>${brl(res.resultado)}</b></td><td>${ap.tot.receita ? Math.round(res.resultado / ap.tot.receita * 100) + '%' : ''}</td></tr>
    </tbody></table>
    ${res.legado ? '<p class="mini">Despesas importadas da planilha.</p>' : `
    <form class="linha" id="fDesp"><input name="desc" placeholder="Despesa (ex.: Produtos)" required><input name="valor" inputmode="decimal" placeholder="Valor" required style="max-width:7rem"><button class="btn">+</button></form>
    ${!(M.despesas || []).length && (S.cfg.despesasFixas || []).length ? `<button class="btn link" data-act="copiarFixas">Lançar despesas fixas (${S.cfg.despesasFixas.map((d) => esc(d.desc)).join(', ')})</button>` : ''}`}
  </section>`;
  $app.innerHTML = moldura(corpo, 'Painel do mês');
  S.ctxMes = mk;
  const f = document.getElementById('fDesp');
  if (f) f.onsubmit = (ev) => { ev.preventDefault(); const fd = new FormData(f); M.despesas = M.despesas || []; M.despesas.push({ desc: fd.get('desc'), valor: num(fd.get('valor')) }); salvarMes(mk); telaMes(mk); };
}

// ---------- TELA: equipe / folha ----------
async function telaEquipe(mk) {
  const M = await mes(mk);
  const ap = C.apuraMes(mk, M, S.cfg, S.funcs);
  const legado = !ap.regraNova && (M.folhaLegado || []).length;
  let folha = '';
  if (legado) {
    const t = (k) => M.folhaLegado.reduce((a, e) => a + (e[k] || 0), 0);
    folha = `<section class="card"><h3>Folha importada da planilha</h3>
      <table class="tab"><thead><tr><th>Nome</th><th>Salário</th><th>Prêmio</th><th>Desc.</th><th>Total</th></tr></thead><tbody>
      ${M.folhaLegado.map((e) => `<tr><td>${esc(e.nome)}<small>${e.diasTrab}/${e.diasMes} dias${e.vtDias ? ` · VT ${e.vtDias}×${brl(e.vtDia)}` : ''}${e.obs ? ' · ' + esc(e.obs) : ''}</small></td><td>${brl(e.salario)}</td><td>${brl(e.premio ?? e.extras)}</td><td>${e.descontos ? brl(e.descontos) : ''}</td><td><b>${brl(e.total)}</b></td></tr>`).join('')}
      <tr class="tot"><td>Total</td><td>${brl(t('salario'))}</td><td>${brl(t('premio') || t('extras'))}</td><td>${brl(t('descontos'))}</td><td>${brl(t('total'))}</td></tr></tbody></table></section>`;
  } else if (!ap.regraNova) {
    folha = `<section class="card"><p>Mês anterior ao regulamento novo e sem folha importada.</p></section>`;
  } else {
    const fm = ap.faixaMes;
    const lista = S.funcs.filter((f) => { const pf = ap.porFunc[f.id]; return f.ativo !== false || (pf && (pf.T || pf.F || pf.J)); }).sort((a, b) => a.nome.localeCompare(b.nome));
    let totGeral = 0;
    folha = lista.map((f) => {
      const pf = ap.porFunc[f.id] || { T: 0, F: 0, J: 0, previstos: 0, presencaPct: 0, premioDiario: 0, bonus: 0, premioTotal: 0, elegivelBonus: false };
      const fo = (M.folha || {})[f.id] || {};
      const r = C.folhaFunc(f, pf, fo, S.cfg);
      totGeral += r.total;
      const motivo = !fm ? 'equipe abaixo da meta mensal' : (pf.elegivelBonus ? `meta mensal ${fm.nivel}` : `presença ${Math.round(pf.presencaPct * 100)}% < ${S.cfg.presencaMin}%`);
      return `<section class="card func">
        <h3>${esc(f.nome)} <small>${esc(f.funcao || 'função não definida')}</small></h3>
        <p class="mini">Trabalhou ${pf.T} · Faltas ${pf.F} · Justificadas ${pf.J} · Presença ${pf.previstos ? Math.round(pf.presencaPct * 100) : 0}%</p>
        <table class="tab desp"><tbody>
          <tr><td>Prêmio diário (${pf.dias ? pf.dias.filter((d) => d.valor).length : 0} dias com meta)</td><td class="r">${brl(pf.premioDiario)}</td></tr>
          <tr><td>Bônus mensal <small>${motivo}</small></td><td class="r">${brl(pf.bonus)}</td></tr>
          <tr class="sub"><td><b>Prêmio do mês</b> <a href="#/demo/${mk}/${f.id}" class="tag">demonstrativo</a></td><td class="r"><b>${brl(pf.premioTotal)}</b></td></tr>
          <tr><td>Salário <small>${brl(r.salMes)} ÷ 30 × <input class="mini-in" inputmode="numeric" data-folha="${f.id}" data-k="diasTrab" value="${r.diasTrab}"> dias</small></td><td class="r">${brl(r.salario)}</td></tr>
          ${(fo.extras || []).map((e, i) => `<tr><td>+ ${esc(e.desc)}</td><td class="r">${brl(e.valor)} <button class="x" data-act="delFolha" data-id="${f.id}" data-k="extras" data-i="${i}">✕</button></td></tr>`).join('')}
          ${(fo.descontos || []).map((e, i) => `<tr><td>− ${esc(e.desc)}</td><td class="r">−${brl(e.valor)} <button class="x" data-act="delFolha" data-id="${f.id}" data-k="descontos" data-i="${i}">✕</button></td></tr>`).join('')}
          <tr class="tot"><td>Total a pagar</td><td class="r">${brl(r.total)}</td></tr>
          <tr><td>VT <small><input class="mini-in" inputmode="numeric" data-folha="${f.id}" data-k="vtDias" value="${r.vtDias}"> dias × <input class="mini-in" inputmode="decimal" data-folha="${f.id}" data-k="vtDia" value="${fmtN(r.vtDia)}"></small></td><td class="r">${brl(r.vt)}</td></tr>
        </tbody></table>
        <form class="linha fExtra" data-id="${f.id}"><select name="k"><option value="extras">+ Extra</option><option value="descontos">− Desconto</option></select><input name="desc" placeholder="Descrição" required><input name="valor" inputmode="decimal" placeholder="R$" required style="max-width:5.5rem"><button class="btn">ok</button></form>
        <input class="obs" data-folha="${f.id}" data-k="obs" placeholder="Observação (ex.: pagar em 1/12)" value="${esc(fo.obs || '')}">
      </section>`;
    }).join('') + `<section class="card"><h3>Total da folha <small>${brl(totGeral)}</small></h3></section>`;
  }

  const corpo = `
  <div class="navdata"><a class="btn ic" href="#/equipe/${somaMes(mk, -1)}">‹</a><b class="titmes">${nomeMes(mk)}</b><a class="btn ic" href="#/equipe/${somaMes(mk, 1)}">›</a></div>
  ${folha}
  <section class="card">
    <h3>Cadastro de funcionários</h3>
    ${[...S.funcs].sort((a, b) => (b.ativo !== false) - (a.ativo !== false) || a.nome.localeCompare(b.nome)).map((f) => `
    <details class="cad"><summary>${esc(f.nome)} <small>${f.ativo === false ? 'inativo' : esc(f.funcao || '')}</small></summary>
      <form class="fFunc grade2" data-id="${f.id}">
        <label>Nome<input name="nome" value="${esc(f.nome)}"></label>
        <label>Função<select name="funcao">${['', 'lavador', 'atendente'].map((o) => `<option ${f.funcao === o ? 'selected' : ''} value="${o}">${o || '—'}</option>`).join('')}</select></label>
        <label>Salário (R$/mês)<input name="salario" inputmode="decimal" value="${fmtN(f.salario)}"></label>
        <label>VT por dia<input name="vtDia" inputmode="decimal" value="${fmtN(f.vtDia)}"></label>
        <label>Admissão<input type="date" name="admissao" value="${f.admissao || ''}"></label>
        <label>Desligamento<input type="date" name="desligamento" value="${f.desligamento || ''}"></label>
        <label class="chk"><input type="checkbox" name="ativo" ${f.ativo !== false ? 'checked' : ''}> Ativo</label>
        <button class="btn">Salvar</button>
      </form></details>`).join('')}
    <form class="linha" id="fNovoFunc"><input name="nome" placeholder="Novo funcionário" required><button class="btn">+ Adicionar</button></form>
  </section>`;
  $app.innerHTML = moldura(corpo, 'Equipe e folha');
  S.ctxEquipe = mk;

  document.querySelectorAll('.fExtra').forEach((fm) => fm.onsubmit = (ev) => {
    ev.preventDefault(); const fd = new FormData(fm); const id = fm.dataset.id;
    M.folha = M.folha || {}; M.folha[id] = M.folha[id] || {}; const k = fd.get('k');
    (M.folha[id][k] = M.folha[id][k] || []).push({ desc: fd.get('desc'), valor: num(fd.get('valor')) });
    salvarMes(mk); telaEquipe(mk);
  });
  document.querySelectorAll('.fFunc').forEach((fm) => fm.onsubmit = async (ev) => {
    ev.preventDefault(); const fd = new FormData(fm); const f = S.funcs.find((x) => x.id === fm.dataset.id);
    Object.assign(f, { nome: fd.get('nome').trim(), funcao: fd.get('funcao'), salario: num(fd.get('salario')), vtDia: num(fd.get('vtDia')), admissao: fd.get('admissao') || null, desligamento: fd.get('desligamento') || null, ativo: !!fd.get('ativo') });
    await salvarFunc(f); toast('Funcionário salvo'); telaEquipe(mk);
  });
  document.getElementById('fNovoFunc').onsubmit = async (ev) => {
    ev.preventDefault(); const nome = new FormData(ev.target).get('nome').trim();
    let id = slug(nome) || 'func'; while (S.funcs.find((f) => f.id === id)) id += '2';
    const f = { id, nome, funcao: '', salario: S.funcs[0] ? S.funcs[0].salario : 0, vtDia: 22, ativo: true, admissao: hojeISO() };
    S.funcs.push(f); await salvarFunc(f); toast('Adicionado. Confira salário e admissão.'); telaEquipe(mk);
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
      (dia.lav || []).forEach((l) => { if (l.t === 'sulgas') itens.push({ data: di, placa: l.placa || '', valor: l.v }); });
      if (!Array.isArray(dia.lav) && dia.sulgas && !(M.sulgasLista || []).some((s) => s.data === di)) for (let i = 0; i < dia.sulgas; i++) itens.push({ data: di, placa: '(sem placa)', valor: S.cfg.sulgasValor });
    }
  }
  itens.sort((a, b) => a.data.localeCompare(b.data));
  const nomeDe = (pl) => { const v = S.frota.find((x) => x.placa === pl); return v ? `${v.nome || ''} ${v.modelo ? '· ' + v.modelo : ''}` : ''; };
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
      : `<p><b>Modo local:</b> os dados ficam só neste aparelho. Para guardar na nuvem e usar em mais de um aparelho, cole aqui a configuração do Firebase (veja o README).</p>
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
    case 'addSulgas': { const pl = (document.getElementById('placaSul').value || '').toUpperCase().trim(); addLav({ t: 'sulgas', v: Number(S.cfg.sulgasValor), placa: pl || undefined }); break; }
    case 'delLav': { const d = diaAtual(); d.lav.splice(+el.dataset.i, 1); salvarMes(ctx.mk); telaDia(ctx.iso); break; }
    case 'pres': { const d = diaAtual(); fixarPresenca(d); d.presenca[el.dataset.id] = el.dataset.s; salvarMes(ctx.mk); telaDia(ctx.iso); break; }
    case 'converterDia': { const d = diaAtual(); if (confirm('Os totais deste dia serão apagados para lançar carro a carro. Continuar?')) { delete d.pagas; delete d.valor; delete d.cort; delete d.sulgas; delete d.legado; d.lav = []; salvarMes(ctx.mk); telaDia(ctx.iso); } break; }
    case 'delDesp': { const M = S.meses[S.ctxMes]; M.despesas.splice(+el.dataset.i, 1); salvarMes(S.ctxMes); telaMes(S.ctxMes); break; }
    case 'copiarFixas': { const M = S.meses[S.ctxMes]; M.despesas = (S.cfg.despesasFixas || []).map((d) => ({ ...d })); salvarMes(S.ctxMes); telaMes(S.ctxMes); break; }
    case 'delFolha': { const M = S.meses[S.ctxEquipe]; M.folha[el.dataset.id][el.dataset.k].splice(+el.dataset.i, 1); salvarMes(S.ctxEquipe); telaEquipe(S.ctxEquipe); break; }
    case 'imprimir': window.print(); break;
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

$app.addEventListener('change', async (ev) => {
  const el = ev.target;
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
  if (el.dataset.preco != null) { const p = S.cfg.precos[+el.dataset.preco]; p[el.dataset.k] = el.dataset.k === 'valor' ? num(el.value) : el.value; await salvarCfg(); status('Salvo ✓'); return; }
  if (el.dataset.fixa != null) { const p = S.cfg.despesasFixas[+el.dataset.fixa]; p[el.dataset.k] = el.dataset.k === 'valor' ? num(el.value) : el.value; await salvarCfg(); status('Salvo ✓'); return; }
});

// Enter no campo de placa/valor adiciona direto
$app.addEventListener('keydown', (ev) => {
  if (ev.key !== 'Enter') return;
  if (ev.target.id === 'placaSul') { ev.preventDefault(); document.querySelector('[data-act=addSulgas]').click(); }
  if (ev.target.id === 'outroValor') { ev.preventDefault(); document.querySelector('[data-act=addOutro]').click(); }
});

if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('./sw.js');
iniciar();
