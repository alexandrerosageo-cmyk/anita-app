// Camada de dados com dois modos:
//  - "firebase": Firestore + login por e-mail/senha (dados na nuvem, sincronizados)
//  - "local": salvo só neste aparelho (para testar antes de configurar o Firebase)
// Coleções: config/app, funcionarios/{id}, frota/lista, meses/{AAAA-MM}

import { FIREBASE_PADRAO } from './firebase-config.js';

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const LS_CFG = 'anita.firebaseConfig';
const LS_PREFIX = 'anita.db.';
const LS_LOCAL = 'anita.modoLocal';



const limpa = (o) => JSON.parse(JSON.stringify(o)); // Firestore não aceita undefined

class LocalStore {
  constructor() { this.modo = 'local'; }
  async init() { return true; }
  async get(col, id) { const v = localStorage.getItem(`${LS_PREFIX}${col}/${id}`); return v ? JSON.parse(v) : null; }
  async set(col, id, data) { localStorage.setItem(`${LS_PREFIX}${col}/${id}`, JSON.stringify(limpa(data))); }
  async del(col, id) { localStorage.removeItem(`${LS_PREFIX}${col}/${id}`); }
  async list(col) {
    const out = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k.startsWith(`${LS_PREFIX}${col}/`)) out.push({ id: k.slice(LS_PREFIX.length + col.length + 1), ...JSON.parse(localStorage.getItem(k)) });
    }
    return out;
  }
  usuario() { return { email: 'neste aparelho' }; }
  async sair() {}
  // ponto: subcoleção ponto/{func}/marcas
  _pk(fid) { return `${LS_PREFIX}ponto/${fid}`; }
  _pl(fid) { try { return JSON.parse(localStorage.getItem(this._pk(fid)) || '[]'); } catch { return []; } }
  async addPonto(fid, data, ts) { const l = this._pl(fid); const m = { ...limpa(data), id: 'p' + Date.now() + Math.random().toString(36).slice(2, 6), ts: ts ? +ts : Date.now() }; l.push(m); localStorage.setItem(this._pk(fid), JSON.stringify(l)); return m; }
  async listPonto(fid, de, ate) { return this._pl(fid).filter((m) => m.dia >= de && m.dia <= ate).sort((a, b) => a.ts - b.ts); }
  async updPonto(fid, id, data, ts) { localStorage.setItem(this._pk(fid), JSON.stringify(this._pl(fid).map((m) => (m.id === id ? { ...m, ...limpa(data), ts: ts ? +ts : m.ts } : m)))); }
  async delPonto(fid, id) { localStorage.setItem(this._pk(fid), JSON.stringify(this._pl(fid).filter((m) => m.id !== id))); }
  async perfil() { const f = localStorage.getItem('anita.localFunc'); return f ? { funcId: f, nome: localStorage.getItem('anita.localFuncNome') || '' } : null; }
  async criarAcesso(email) { return 'local-' + email.split('@')[0]; }
  async trocarSenha() {}
}

class FirebaseStore {
  constructor(cfg) { this.cfg = cfg; this.modo = 'firebase'; }
  async init() {
    const [{ initializeApp }, fs, au] = await Promise.all([
      import(FB + 'firebase-app.js'), import(FB + 'firebase-firestore.js'), import(FB + 'firebase-auth.js'),
    ]);
    this.fs = fs; this.au = au;
    this.app = initializeApp(this.cfg);
    try {
      this.db = fs.initializeFirestore(this.app, { localCache: fs.persistentLocalCache({ tabManager: fs.persistentMultipleTabManager() }) });
    } catch (e) { this.db = fs.getFirestore(this.app); }
    this.auth = au.getAuth(this.app);
    await au.setPersistence(this.auth, au.browserLocalPersistence);
    this.user = await new Promise((res) => { const off = au.onAuthStateChanged(this.auth, (u) => { off(); res(u); }); });
    // sessão guardada pode ter sido revogada (ex.: senha trocada): confere com o servidor
    if (this.user && navigator.onLine !== false) {
      try { await this.user.getIdToken(true); }
      catch (e) {
        if (/user-token-expired|user-disabled|user-not-found|invalid-user-token|requires-recent-login|invalid-credential/.test(e.code || e.message || '')) { await au.signOut(this.auth); this.user = null; this.sessaoExpirou = true; }
      }
    }
    return !!this.user;
  }
  async entrar(email, senha) { const c = await this.au.signInWithEmailAndPassword(this.auth, email, senha); this.user = c.user; }
  usuario() { return this.user; }
  async sair() { await this.au.signOut(this.auth); this.user = null; }
  async _(op, caminho, fn) {
    try { return await fn(); }
    catch (e) { e.caminho = caminho; e.op = op; throw e; }
  }
  async get(col, id) { return this._('ler', `${col}/${id}`, async () => { const s = await this.fs.getDoc(this.fs.doc(this.db, col, id)); return s.exists() ? s.data() : null; }); }
  async set(col, id, data) { return this._('gravar', `${col}/${id}`, () => this.fs.setDoc(this.fs.doc(this.db, col, id), limpa(data))); }
  async del(col, id) { return this._('apagar', `${col}/${id}`, () => this.fs.deleteDoc(this.fs.doc(this.db, col, id))); }
  async list(col) { return this._('ler', col, async () => { const q = await this.fs.getDocs(this.fs.collection(this.db, col)); return q.docs.map((d) => ({ id: d.id, ...d.data() })); }); }
  // ---- ponto: ponto/{func}/marcas/{id}; o horário vem do servidor (as regras conferem) ----
  async addPonto(fid, data, ts) {
    const fs = this.fs;
    return this._('gravar', `ponto/${fid}`, async () => {
      const r = await fs.addDoc(fs.collection(this.db, 'ponto', fid, 'marcas'), { ...limpa(data), ts: ts ? fs.Timestamp.fromDate(new Date(+ts)) : fs.serverTimestamp() });
      return { id: r.id, ...data, ts: ts ? +ts : Date.now() };
    });
  }
  async listPonto(fid, de, ate) {
    const fs = this.fs;
    return this._('ler', `ponto/${fid}`, async () => {
      const q = await fs.getDocs(fs.query(fs.collection(this.db, 'ponto', fid, 'marcas'), fs.where('dia', '>=', de), fs.where('dia', '<=', ate)));
      return q.docs.map((d) => { const x = d.data(); return { id: d.id, ...x, ts: x.ts && x.ts.toMillis ? x.ts.toMillis() : Date.now() }; }).sort((a, b) => a.ts - b.ts);
    });
  }
  async updPonto(fid, id, data, ts) { const fs = this.fs; return this._('gravar', `ponto/${fid}`, () => fs.updateDoc(fs.doc(this.db, 'ponto', fid, 'marcas', id), { ...limpa(data), ...(ts ? { ts: fs.Timestamp.fromDate(new Date(+ts)) } : {}) })); }
  async delPonto(fid, id) { return this._('apagar', `ponto/${fid}`, () => this.fs.deleteDoc(this.fs.doc(this.db, 'ponto', fid, 'marcas', id))); }
  async perfil() { try { return this.user ? await this.get('equipeAcesso', this.user.uid) : null; } catch (e) { return null; } }
  // cria a conta do funcionário num app secundário, para não derrubar o login de quem está usando
  async criarAcesso(email, senha) {
    const { initializeApp, deleteApp } = await import(FB + 'firebase-app.js');
    const sec = initializeApp(this.cfg, 'acesso' + Date.now());
    try {
      const a2 = this.au.getAuth(sec);
      const c = await this.au.createUserWithEmailAndPassword(a2, email, senha);
      await this.au.signOut(a2);
      return c.user.uid;
    } finally { await deleteApp(sec); }
  }
  async trocarSenha(nova) { await this.au.updatePassword(this.user, nova); }
}

export function lerConfigFirebase() {
  if (localStorage.getItem(LS_LOCAL) === '1') return null;
  try { return JSON.parse(localStorage.getItem(LS_CFG) || 'null') || FIREBASE_PADRAO; } catch { return FIREBASE_PADRAO; }
}
export function salvarConfigFirebase(cfg) {
  if (cfg) { localStorage.setItem(LS_CFG, JSON.stringify(cfg)); localStorage.removeItem(LS_LOCAL); }
  else { localStorage.removeItem(LS_CFG); localStorage.setItem(LS_LOCAL, '1'); }
}
export function usarFirebasePadrao() { localStorage.removeItem(LS_CFG); localStorage.removeItem(LS_LOCAL); }

// Aceita o trecho copiado do console do Firebase (objeto JS) ou JSON puro
export function interpretarConfig(txt) {
  const m = txt.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Não encontrei a configuração { ... }');
  const obj = {};
  for (const k of ['apiKey', 'authDomain', 'projectId', 'storageBucket', 'messagingSenderId', 'appId']) {
    const r = m[0].match(new RegExp(`["']?${k}["']?\\s*:\\s*["']([^"']+)["']`));
    if (r) obj[k] = r[1];
  }
  if (!obj.apiKey || !obj.projectId) throw new Error('Faltam apiKey ou projectId');
  return obj;
}

export function criarStore() {
  const cfg = lerConfigFirebase();
  return cfg ? new FirebaseStore(cfg) : new LocalStore();
}
