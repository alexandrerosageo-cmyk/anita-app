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
