// Convênio de sábados/feriados (ex.: Altis): leitura do relatório do sistema do estacionamento
// e cálculo de vagas simultâneas por hora, carros extras e valor a cobrar. Funções puras.
import { r2, pad } from './calc.js';

export const CONV_PADRAO = { nome: 'Altis', filtro: 'Altis', valorDia: 375, vagas: 10, valorExtra: 14, regra: 'periodo', inicio: '09:30', fechamento: '15:30' };
export const REGRAS = {
  periodo: 'Por período: cada vez que passa das vagas no dia, 1 extra (cada carro conta uma vez)',
  pico: 'Pico do dia: só o maior momento conta',
  hora: 'Por hora: soma o excedente de cada hora',
};

// ---------- leitura de arquivos ----------
const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

// .xlsx = zip; descompacta com DecompressionStream (navegador moderno e Node 18+)
async function unzip(buf) {
  const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  let eocd = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 66000); i--) if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('Arquivo .xlsx inválido');
  const n = dv.getUint16(eocd + 10, true); let p = dv.getUint32(eocd + 16, true);
  const out = {}, dec = new TextDecoder();
  for (let k = 0; k < n; k++) {
    const metodo = dv.getUint16(p + 10, true), tam = dv.getUint32(p + 20, true);
    const ln = dv.getUint16(p + 28, true), le = dv.getUint16(p + 30, true), lc = dv.getUint16(p + 32, true), off = dv.getUint32(p + 42, true);
    const nome = dec.decode(b.subarray(p + 46, p + 46 + ln));
    p += 46 + ln + le + lc;
    if (!/^xl\/(sharedStrings\.xml|workbook\.xml|worksheets\/sheet\d+\.xml)$/.test(nome)) continue;
    const ini = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    const dados = b.subarray(ini, ini + tam);
    if (metodo === 0) out[nome] = dec.decode(dados);
    else if (metodo === 8) {
      const ds = new Blob([dados]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
      out[nome] = await new Response(ds).text();
    }
  }
  return out;
}
const desesc = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCharCode(+d)).replace(/&amp;/g, '&');
const textoDe = (xml) => desesc([...xml.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((m) => m[1]).join(''));
const colNum = (ref) => { let n = 0; for (const ch of ref.replace(/\d+/g, '')) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

async function lerXlsx(buf) {
  const f = await unzip(buf);
  const ss = f['xl/sharedStrings.xml'] ? [...f['xl/sharedStrings.xml'].matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textoDe(m[1])) : [];
  const folha = f['xl/worksheets/sheet1.xml'] || Object.entries(f).find(([k]) => k.includes('worksheets/'))?.[1];
  if (!folha) throw new Error('Planilha vazia');
  const linhas = [];
  for (const m of folha.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const ln = [];
    for (const c of m[1].matchAll(/<c\s+([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const at = c[1], corpo = c[2] || '';
      const ref = (at.match(/r="([A-Z]+\d+)"/) || [])[1]; const t = (at.match(/t="(\w+)"/) || [])[1];
      const v = (corpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
      let val = '';
      if (t === 's') val = ss[+v] ?? ''; else if (t === 'inlineStr') val = textoDe(corpo); else if (t === 'str' || t === 'e') val = desesc(v ?? ''); else if (v != null) val = Number(v);
      ln[ref ? colNum(ref) : ln.length] = val;
    }
    linhas.push(Array.from(ln, (x) => x ?? ''));
  }
  return linhas;
}

function lerTexto(txt) {
  if (/^\s*</.test(txt) && /<t[dh][\s>]/i.test(txt)) { // "xls" que na verdade é uma tabela HTML
    return [...txt.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)].map((r) => [...r[1].matchAll(/<t[dh][^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((c) => desesc(c[1].replace(/<[^>]+>/g, '')).trim()));
  }
  const lns = txt.replace(/\r/g, '').split('\n');
  const sep = lns.some((l) => l.includes('\t')) ? '\t' : (lns.filter((l) => l.includes(';')).length >= lns.filter((l) => l.includes(',')).length ? ';' : ',');
  return lns.map((l) => l.split(sep).map((c) => c.replace(/^"|"$/g, '').trim()));
}

export async function lerArquivo(nome, buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0x50 && b[1] === 0x4b) return lerXlsx(buf); // PK = zip/xlsx
  if (b[0] === 0xD0 && b[1] === 0xCF) throw new Error('Este .xls é do formato antigo do Excel. Abra no Excel e salve como .xlsx, ou copie a tabela e cole no campo de texto.');
  let txt = new TextDecoder('utf-8').decode(b);
  if (txt.includes('�')) txt = new TextDecoder('windows-1252').decode(b);
  return lerTexto(txt);
}
export const lerColado = (txt) => lerTexto(txt);

// ---------- interpretação ----------
// datas: "20-11-2026 12:53:18", "20/11/2026 12:53", ISO, ou número serial do Excel
export function dataHora(v) {
  if (typeof v === 'number' && isFinite(v) && v > 20000) { const ms = Math.round((v - 25569) * 864e5); const d = new Date(ms); return { iso: d.toISOString().slice(0, 10), min: d.getUTCHours() * 60 + d.getUTCMinutes() + d.getUTCSeconds() / 60 }; }
  const s = String(v || '').trim();
  let m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) { const y = m[3].length === 2 ? '20' + m[3] : m[3]; return { iso: `${y}-${pad(m[2])}-${pad(m[1])}`, min: +m[4] * 60 + +m[5] + (+m[6] || 0) / 60 }; }
  m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T]+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if (m) return { iso: `${m[1]}-${m[2]}-${m[3]}`, min: +m[4] * 60 + +m[5] + (+m[6] || 0) / 60 };
  return null;
}

export function extrairCarros(linhas, filtro) {
  const hi = linhas.findIndex((l) => l.some((c) => norm(c) === 'placa') && l.some((c) => norm(c).includes('entrada')));
  if (hi < 0) throw new Error('Não achei as colunas "Placa" e "Data de Entrada" no arquivo.');
  const h = linhas[hi].map(norm);
  const iP = h.indexOf('placa'), iE = h.findIndex((c) => c.includes('entrada')), iS = h.findIndex((c) => c.includes('saida'));
  const iT = h.findIndex((c) => c.includes('tabela')), iTk = h.findIndex((c) => c.includes('ticket'));
  const f = norm(filtro || '');
  const carros = [], ignorados = { outros: 0, invalidos: 0 };
  for (const l of linhas.slice(hi + 1)) {
    const placa = String(l[iP] ?? '').trim().toUpperCase();
    const e = dataHora(l[iE]);
    if (!placa || !e) { if (placa && !/^procurar/i.test(placa)) ignorados.invalidos++; continue; }
    if (f && iT >= 0 && !norm(l[iT]).includes(f)) { ignorados.outros++; continue; }
    const s = iS >= 0 ? dataHora(l[iS]) : null;
    carros.push({ placa, data: e.iso, e: r2(e.min), s: s && s.iso === e.iso ? r2(s.min) : (s ? 24 * 60 : null), ticket: iTk >= 0 ? String(l[iTk] ?? '').trim() : '' });
  }
  return { carros, ignorados, temTabela: iT >= 0 };
}

const hm = (min) => `${pad(Math.floor(min / 60))}:${pad(Math.floor(min % 60))}`;
export const fmtHora = hm;

// ---------- cálculo ----------
export function calcular(carros, cfgConv) {
  const c = { ...CONV_PADRAO, ...(cfgConv || {}) };
  if (c.regra === 'carro') c.regra = 'periodo';
  const hhmm = (t, pad0) => { const [h, m] = String(t || pad0).split(':').map(Number); return h * 60 + (m || 0); };
  const ini = hhmm(c.inicio, '09:30'), fecha = hhmm(c.fechamento, '15:30');
  // cada carro conta só dentro do período do convênio (ex.: 9h30–15h30)
  const lista = carros.map((x) => ({ ...x, sAj: x.s == null ? fecha : x.s, semSaida: x.s == null }))
    .map((x) => ({ ...x, eP: Math.max(x.e, ini), sP: Math.min(x.sAj, fecha) }))
    .filter((x) => x.sP > x.eP).sort((a, b) => a.eP - b.eP || a.sP - b.sP);
  const fora = carros.length - lista.length;
  if (!lista.length) return { carros: 0, fora, horas: [], pico: 0, momentoPico: '', momentosExtra: [], placasExtra: [], extras: 0, valorDia: r2(c.valorDia), valorExtras: 0, total: r2(c.valorDia), regra: c.regra, semSaida: 0, cfg: { valorDia: c.valorDia, vagas: c.vagas, valorExtra: c.valorExtra, regra: c.regra, inicio: c.inicio, fechamento: c.fechamento } };
  const ocup = (t) => lista.filter((x) => x.eP <= t && x.sP > t).length;
  // por período: percorre as entradas; cada carro que entra com as vagas já cheias é 1 extra (contado uma vez)
  let extrasPeriodo = Math.max(0, ocup(ini) - c.vagas); // quem já estava além das vagas na abertura do período
  const momentos = [];
  const placasExtra = [];
  { const naAbertura = lista.filter((x) => x.eP <= ini && x.sP > ini).sort((a, b) => a.e - b.e); naAbertura.slice(c.vagas).forEach((x) => placasExtra.push(x.placa)); }
  for (const x of lista) if (x.eP > ini && ocup(x.eP) > c.vagas) { extrasPeriodo++; momentos.push(hm(x.eP)); placasExtra.push(x.placa); }
  const hIni = Math.floor(ini / 60), hFim = Math.floor((fecha - 0.001) / 60);
  const horas = [];
  for (let h = hIni; h <= hFim; h++) {
    const a = Math.max(h * 60, ini), b = Math.min(h * 60 + 60, fecha);
    const instantes = [a, ...lista.filter((x) => x.eP > a && x.eP < b).map((x) => x.eP)];
    const max = Math.max(0, ...instantes.map(ocup));
    horas.push({ h, rotulo: `${pad(h)}h`, max, passaram: lista.filter((x) => x.eP < b && x.sP > a).length, extras: Math.max(0, max - c.vagas) });
  }
  const pico = Math.max(0, ...horas.map((x) => x.max));
  const extras = c.regra === 'pico' ? Math.max(0, pico - c.vagas) : c.regra === 'hora' ? horas.reduce((a, x) => a + x.extras, 0) : extrasPeriodo;
  let best = { t: lista[0].eP, n: 0 }; for (const x of lista) { const n = ocup(x.eP); if (n > best.n) best = { t: x.eP, n }; }
  return {
    carros: lista.length, fora, horas, pico, momentoPico: hm(best.t), extras, momentosExtra: c.regra === 'periodo' ? momentos : [], placasExtra: c.regra === 'periodo' ? placasExtra : [], regra: c.regra,
    valorDia: r2(c.valorDia), valorExtras: r2(extras * c.valorExtra), total: r2(c.valorDia + extras * c.valorExtra),
    semSaida: lista.filter((x) => x.semSaida).length, cfg: { valorDia: c.valorDia, vagas: c.vagas, valorExtra: c.valorExtra, regra: c.regra, inicio: c.inicio, fechamento: c.fechamento },
  };
}
