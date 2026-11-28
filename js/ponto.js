// Ponto virtual: marcações, horas trabalhadas, distância até o local de trabalho
export const TIPOS = [
  ['entrada', 'Entrada'],
  ['almoco', 'Saída p/ almoço'],
  ['volta', 'Volta do almoço'],
  ['saida', 'Saída'],
];
export const NOME_TIPO = Object.fromEntries(TIPOS);
export const DOMINIO = '@anitaparking.app';
export const LOCAL_PADRAO = { lat: null, lng: null, raio: 150 };

export const emailDeUsuario = (u) => { u = String(u || '').trim().toLowerCase(); return u.includes('@') ? u : u + DOMINIO; };
export const usuarioDeEmail = (e) => String(e || '').replace(DOMINIO, '');
export const slug = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '.').replace(/^\.|\.$/g, '');

const p2 = (n) => String(n).padStart(2, '0');
export const diaDe = (ts) => { const d = new Date(ts); return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`; };
export const horaDe = (ts) => { const d = new Date(ts); return `${p2(d.getHours())}:${p2(d.getMinutes())}`; };

// metros entre dois pontos (haversine)
export function distancia(a, b) {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat), dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.sqrt(h)));
}

// dentro do local, com tolerância pela precisão do GPS (até 50 m)
export function noLocal(pos, local) {
  if (!local || local.lat == null) return { ok: false, motivo: 'O local de trabalho ainda não foi configurado. Avise o Alexandre.' };
  const dist = distancia(pos, local), tol = Math.min(Number(pos.acc) || 0, 50);
  return { ok: dist <= (Number(local.raio) || 150) + tol, dist, acc: Math.round(pos.acc || 0) };
}

// agrupa marcações por dia e calcula horas
export function porDia(marcas) {
  const dias = {};
  for (const m of [...marcas].sort((a, b) => a.ts - b.ts)) {
    const d = diaDe(m.ts);
    (dias[d] = dias[d] || { dia: d, marcas: [], por: {} }).marcas.push(m);
    if (!dias[d].por[m.tipo]) dias[d].por[m.tipo] = m;
    else if (m.tipo === 'saida') dias[d].por.saida = m; // vale a última saída
  }
  for (const d of Object.values(dias)) d.minutos = minutosDia(d.por);
  return Object.values(dias).sort((a, b) => (a.dia < b.dia ? 1 : -1));
}

export function minutosDia(por) {
  const t = (k) => (por[k] ? por[k].ts : null);
  const e = t('entrada'), a = t('almoco'), v = t('volta'), s = t('saida');
  let min = 0;
  if (e && a) min += a - e;
  if (v && s) min += s - v;
  if (e && s && !a && !v) min += s - e;
  if (e && a && !v && s) min += 0; // voltou do almoço sem marcar: não soma a tarde
  return Math.max(0, Math.round(min / 60000));
}

export const fmtHoras = (min) => (min ? `${Math.floor(min / 60)}h${p2(min % 60)}` : '—');

// próxima marcação esperada no dia
export function proxima(por) {
  if (!por.entrada) return 'entrada';
  if (por.saida) return null;
  if (!por.almoco) return 'almoco';
  if (!por.volta) return 'volta';
  return 'saida';
}

// ----- horários de trabalho, janela dos botões e banco de horas -----
export const HORARIO_PADRAO = { entrada: '', saida: '', almoco: 60, sabEntrada: '', sabSaida: '' };
export const JANELA_PADRAO = { antes: 15, depois: 120 };
const hm = (s) => { const [h, m] = String(s || '').split(':').map(Number); return Number.isFinite(h) ? h * 60 + (m || 0) : null; };
const dow = (iso) => new Date(iso + 'T12:00:00').getDay();

// expediente previsto do dia: {ini, fim, almoco} em minutos do dia, ou null (folga)
export function expediente(h, iso) {
  h = { ...HORARIO_PADRAO, ...(h || {}) };
  const d = dow(iso);
  if (d === 0) return null;
  const ini = hm(d === 6 ? h.sabEntrada : h.entrada), fim = hm(d === 6 ? h.sabSaida : h.saida);
  if (ini == null || fim == null || fim <= ini) return null;
  const almoco = d === 6 && fim - ini <= 360 ? 0 : Number(h.almoco) || 0;
  return { ini, fim, almoco, previsto: Math.max(0, fim - ini - almoco) };
}
export const temHorario = (h) => !!(h && h.entrada && h.saida);

// os botões funcionam de (entrada − antes) até (saída + depois)
export function janela(h, iso, jan) {
  const e = expediente(h, iso); if (!e) return null;
  jan = { ...JANELA_PADRAO, ...(jan || {}) };
  const [y, m, d] = iso.split('-').map(Number), base = new Date(y, m - 1, d).getTime();
  return { de: base + (e.ini - Number(jan.antes || 0)) * 60000, ate: base + (e.fim + Number(jan.depois || 0)) * 60000, exp: e };
}
export const minParaHora = (min) => `${p2(Math.floor(min / 60))}:${p2(min % 60)}`;

// saldo do dia = trabalhado − previsto (positivo vai para o banco de horas)
export function saldoDia(d, h) {
  const e = expediente(h, d.dia), previsto = e ? e.previsto : 0;
  return { previsto, saldo: d.minutos - previsto };
}
export const fmtSaldo = (min) => (min ? `${min > 0 ? '+' : '−'}${fmtHoras(Math.abs(min))}` : '0h00');

// valor das horas extras do dia pela CCT (cl. 26ª): 50% nas 2 primeiras horas, 100% nas demais; hora = salário / 220
export function valorExtra(min, salario) {
  const hora = (Number(salario) || 0) / 220;
  const a = Math.min(min, 120), b = Math.max(0, min - 120);
  return Math.round(((a / 60) * hora * 1.5 + (b / 60) * hora * 2) * 100) / 100;
}
