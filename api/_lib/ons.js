// Cliente da API do ONS (SINtegre): mesmo fluxo do servidor.py local.
// POST /autenticar {usuario, senha} -> access_token, refresh_token, expires_in
// POST /renovar {refresh_token}; GET com Authorization: Bearer.
const BASE_URL = (process.env.ONS_BASE_URL || 'https://integra.ons.org.br/api').replace(/\/+$/, '');

class ErroOns extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

async function post(caminho, corpo) {
  let r;
  try {
    r = await fetch(BASE_URL + caminho, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(corpo),
      signal: AbortSignal.timeout(25000),
    });
  } catch (e) {
    throw new ErroOns(`Não consegui falar com a API do ONS (${e.name === 'TimeoutError' ? 'tempo esgotado' : 'falha de rede'}).`, 502);
  }
  const txt = await r.text();
  if (!r.ok) throw new ErroOns(`HTTP ${r.status} em ${caminho}`, r.status);
  try { return JSON.parse(txt); } catch { throw new ErroOns(`Resposta inesperada de ${caminho}`, 502); }
}

function tokens(d, anterior) {
  if (!d || !d.access_token) throw new ErroOns('A API não devolveu access_token.', 502);
  return {
    a: d.access_token,
    r: d.refresh_token || (anterior && anterior.r) || null,
    // renova 60 s antes; se expires_in vier vazio, assume 5 min
    e: Math.floor(Date.now() / 1000 + Number(d.expires_in || 300) - 60),
  };
}

async function autenticar(usuario, senha) {
  try {
    return tokens(await post('/autenticar', { usuario, senha }));
  } catch (e) {
    if (e.status === 400 || e.status === 401 || e.status === 403) {
      throw new ErroOns('Usuário ou senha do SINtegre inválidos.', 401);
    }
    throw e;
  }
}

async function renovar(sess) {
  if (!sess.r) throw new ErroOns('Sessão expirada. Entre de novo.', 401);
  try {
    return tokens(await post('/renovar', { refresh_token: sess.r }), sess);
  } catch (e) {
    throw new ErroOns('Sessão expirada. Entre de novo.', 401);
  }
}

// Faz GET garantindo token válido. Retorna [dados, sessaoAtualizada|null].
async function get(sess, caminho, params) {
  let nova = null;
  if (Date.now() / 1000 >= sess.e) { nova = { ...sess, ...(await renovar(sess)) }; sess = nova; }
  const url = `${BASE_URL}${caminho}?${new URLSearchParams(params)}`;
  for (let tentativa = 1; tentativa <= 2; tentativa++) {
    let r;
    try {
      r = await fetch(url, {
        headers: { Authorization: `Bearer ${sess.a}`, Accept: 'application/json' },
        signal: AbortSignal.timeout(25000),
      });
    } catch (e) {
      throw new ErroOns('Não consegui falar com a API do ONS (falha de rede ou tempo esgotado).', 502);
    }
    if (r.status === 401 && tentativa === 1) {
      nova = { ...sess, ...(await renovar(sess)) }; sess = nova;
      continue;
    }
    const txt = await r.text();
    if (!r.ok) {
      const dica = r.status === 401 || r.status === 403
        ? ' Verifique se o sistema APIAvaliacaoOperacao foi liberado em "Meus Sistemas" do SINtegre e aprovado pelo gestor.'
        : '';
      throw new ErroOns(`HTTP ${r.status} em ${caminho}: ${txt.slice(0, 300)}${dica}`, 502);
    }
    try { return [JSON.parse(txt || '[]'), nova]; }
    catch { throw new ErroOns(`Resposta inesperada de ${caminho}`, 502); }
  }
}

// A API pode devolver lista direta ou objeto com a lista dentro.
function lista(resp) {
  if (Array.isArray(resp)) return resp;
  if (resp && typeof resp === 'object') for (const v of Object.values(resp)) if (Array.isArray(v)) return v;
  return [];
}

module.exports = { autenticar, get, lista, ErroOns, BASE_URL };
