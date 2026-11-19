// Envio automático do backup em Excel (roda no GitHub Actions todo dia 15).
// Lê os dados do Firestore com o login do app, gera o Excel e envia pelo Gmail.
// Segredos necessários (GitHub → Settings → Secrets and variables → Actions):
//   APP_EMAIL, APP_SENHA        login do app (o mesmo do celular)
//   GMAIL_SENHA_APP             senha de app do Gmail de anitaparkingpoa@gmail.com
import nodemailer from 'nodemailer';
import { montarPlanilha, nomeArquivoBackup } from '../js/planilha.js';
import { FIREBASE_PADRAO, EMAIL_BACKUP } from '../js/firebase-config.js';

const { APP_EMAIL, APP_SENHA, GMAIL_SENHA_APP } = process.env;
const GMAIL_USUARIO = process.env.GMAIL_USUARIO || EMAIL_BACKUP;
const DESTINO = process.env.DESTINO || EMAIL_BACKUP;
const falta = ['APP_EMAIL', 'APP_SENHA', 'GMAIL_SENHA_APP'].filter((k) => !process.env[k]);
if (falta.length) { console.error('Faltam os segredos: ' + falta.join(', ')); process.exit(1); }

const { apiKey, projectId } = FIREBASE_PADRAO;
const BASE = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents`;

async function login() {
  const r = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${apiKey}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: APP_EMAIL, password: APP_SENHA, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!r.ok) throw new Error('Login no Firebase falhou: ' + ((j.error || {}).message || r.status));
  return j.idToken;
}

// converte o formato do Firestore REST em objetos comuns
function valor(v) {
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('booleanValue' in v) return v.booleanValue;
  if ('nullValue' in v) return null;
  if ('timestampValue' in v) return v.timestampValue;
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(valor);
  if ('mapValue' in v) return campos(v.mapValue.fields || {});
  return null;
}
const campos = (f) => Object.fromEntries(Object.entries(f).map(([k, v]) => [k, valor(v)]));

async function colecao(token, col) {
  const docs = []; let pageToken = '';
  do {
    const r = await fetch(`${BASE}/${col}?pageSize=300${pageToken ? '&pageToken=' + encodeURIComponent(pageToken) : ''}`, { headers: { Authorization: 'Bearer ' + token } });
    const j = await r.json();
    if (!r.ok) throw new Error(`Leitura de "${col}" falhou: ${(j.error || {}).message || r.status}`);
    for (const d of j.documents || []) docs.push({ id: d.name.split('/').pop(), ...campos(d.fields || {}) });
    pageToken = j.nextPageToken || '';
  } while (pageToken);
  return docs;
}

const hoje = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10); // horário de Brasília
const token = await login();
const [config, funcionarios, frota, meses] = await Promise.all(['config', 'funcionarios', 'frota', 'meses'].map((c) => colecao(token, c)));
const cfg = config.find((d) => d.id === 'app') || {};
const dadosMeses = Object.fromEntries(meses.map(({ id, ...m }) => [id, m]));
if (!meses.length) throw new Error('Nenhum mês encontrado no Firestore — backup não enviado.');

const bytes = montarPlanilha({ cfg, funcs: funcionarios, frota: (frota.find((d) => d.id === 'lista') || {}).veiculos || [], meses: dadosMeses });
const nome = nomeArquivoBackup(hoje);

const transporte = nodemailer.createTransport({ host: 'smtp.gmail.com', port: 465, secure: true, auth: { user: GMAIL_USUARIO, pass: GMAIL_SENHA_APP.replace(/\s/g, '') } });
const [y, m, d] = hoje.split('-');
await transporte.sendMail({
  from: `Estacionamento Anita <${GMAIL_USUARIO}>`, to: DESTINO,
  subject: `Backup Estacionamento Anita ${d}/${m}/${y}`,
  text: `Backup automático do app de gestão do Estacionamento Anita.\n\nMeses no arquivo: ${meses.length} · funcionários: ${funcionarios.length}.\nArquivo: ${nome}\n\nEnviado pelo GitHub Actions (todo dia 15).`,
  attachments: [{ filename: nome, content: Buffer.from(bytes), contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }],
});
console.log(`Backup enviado: ${meses.length} meses, ${Math.round(bytes.length / 1024)} KB.`); // sem dados do negócio no log (repositório público)
