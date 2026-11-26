// Sessão em cookie httpOnly, criptografada com AES-256-GCM.
// Guarda só tokens da API do ONS (nunca a senha). Chave vem de SESSION_SECRET.
const crypto = require('crypto');

const NOME = 'ons_sess';
const MAX_PEDACOS = 4;          // tokens JWT podem passar de 4 KB; dividimos em vários cookies
const TAM_PEDACO = 3800;
const DURACAO_SEG = 8 * 3600;   // sessão expira em 8 h mesmo com refresh válido

function chave() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 32) throw new Error('SESSION_SECRET ausente ou curto no servidor');
  return crypto.createHash('sha256').update(s).digest();
}

function cifrar(obj) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chave(), iv);
  const dados = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), dados]).toString('base64url');
}

function decifrar(txt) {
  const b = Buffer.from(txt, 'base64url');
  const d = crypto.createDecipheriv('aes-256-gcm', chave(), b.subarray(0, 12));
  d.setAuthTag(b.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8'));
}

function cookies(req) {
  const out = {};
  for (const p of (req.headers.cookie || '').split(';')) {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  }
  return out;
}

function atributos(maxAge) {
  return `Path=/; HttpOnly; Secure; SameSite=Strict; Max-Age=${maxAge}`;
}

function ler(req) {
  const c = cookies(req);
  let txt = '';
  for (let i = 0; i < MAX_PEDACOS; i++) {
    if (c[`${NOME}${i}`] === undefined) break;
    txt += c[`${NOME}${i}`];
  }
  if (!txt) return null;
  try {
    const s = decifrar(txt);
    if (!s.criada || Date.now() / 1000 - s.criada > DURACAO_SEG) return null;
    return s;
  } catch { return null; }
}

function gravar(res, s) {
  const txt = cifrar(s);
  const pedacos = txt.match(new RegExp(`.{1,${TAM_PEDACO}}`, 'g'));
  if (pedacos.length > MAX_PEDACOS) throw new Error('sessão grande demais para cookie');
  const restante = Math.max(1, Math.floor(DURACAO_SEG - (Date.now() / 1000 - s.criada)));
  const lista = [];
  for (let i = 0; i < MAX_PEDACOS; i++) {
    lista.push(i < pedacos.length
      ? `${NOME}${i}=${pedacos[i]}; ${atributos(restante)}`
      : `${NOME}${i}=; ${atributos(0)}`);
  }
  res.setHeader('Set-Cookie', lista);
}

function apagar(res) {
  const lista = [];
  for (let i = 0; i < MAX_PEDACOS; i++) lista.push(`${NOME}${i}=; ${atributos(0)}`);
  res.setHeader('Set-Cookie', lista);
}

module.exports = { ler, gravar, apagar };
