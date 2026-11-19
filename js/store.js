// Camada de dados com dois modos:
//  - "firebase": Firestore + login por e-mail/senha (dados na nuvem, sincronizados)
//  - "local": salvo só neste aparelho (para testar antes de configurar o Firebase)
// Coleções: config/app, funcionarios/{id}, frota/lista, meses/{AAAA-MM}

const FB = 'https://www.gstatic.com/firebasejs/10.12.2/';
const LS_CFG = 'anita.firebaseConfig';
const LS_PREFIX = 'anita.db.';

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
    return !!this.user;
  }
  async entrar(email, senha) { const c = await this.au.signInWithEmailAndPassword(this.auth, email, senha); this.user = c.user; }
  usuario() { return this.user; }
  async sair() { await this.au.signOut(this.auth); this.user = null; }
  async get(col, id) { const s = await this.fs.getDoc(this.fs.doc(this.db, col, id)); return s.exists() ? s.data() : null; }
  async set(col, id, data) { await this.fs.setDoc(this.fs.doc(this.db, col, id), limpa(data)); }
  async del(col, id) { await this.fs.deleteDoc(this.fs.doc(this.db, col, id)); }
  async list(col) { const q = await this.fs.getDocs(this.fs.collection(this.db, col)); return q.docs.map((d) => ({ id: d.id, ...d.data() })); }
}

export function lerConfigFirebase() { try { return JSON.parse(localStorage.getItem(LS_CFG) || 'null'); } catch { return null; } }
export function salvarConfigFirebase(cfg) { if (cfg) localStorage.setItem(LS_CFG, JSON.stringify(cfg)); else localStorage.removeItem(LS_CFG); }

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
