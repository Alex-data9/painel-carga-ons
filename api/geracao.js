// Geração por fonte e carga do subsistema Norte, minuto a minuto, no dia de hoje.
// Fonte: conjuntos públicos "Geracao_<Subsistema>_<Fonte>_json" e "Carga_<Subsistema>_json"
// do ONS (os mesmos do painel "Energia Agora"; não precisam de token e só trazem o dia atual).
const sessao = require('./_lib/sessao');
const { json } = require('./_lib/http');

const BASE = (process.env.GERACAO_BASE_URL || 'https://tr.ons.org.br/Content/Get').replace(/\/+$/, '');
// Só o subsistema Norte interessa ao painel (os conjuntos existem também para SIN, Nordeste,
// SudesteECentroOeste e Sul: basta acrescentar aqui).
const SUBSISTEMAS = { Norte: 'Norte' };
const FONTES = ['Hidraulica', 'Termica', 'Eolica', 'Solar', 'Nuclear'];

const cache = new Map();   // sub -> { t, dados } (vale 60 s por instância)

async function baixar(nome) {
  let r;
  try { r = await fetch(`${BASE}/${nome}`, { headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(15000) }); }
  catch { throw Object.assign(new Error('Não consegui falar com o ONS (geração).'), { status: 502 }); }
  if (r.status === 204) return [];   // fonte sem usinas nesse subsistema (ex.: nuclear no Norte)
  if (!r.ok) throw Object.assign(new Error(`ONS respondeu HTTP ${r.status} em ${nome}`), { status: 502 });
  const lista = await r.json().catch(() => []);
  return Array.isArray(lista) ? lista : [];
}

// [[epoch ms, MW], ...] com 1 casa decimal
const pontos = (lista, campo) => lista
  .filter(p => p && p.instante && p[campo] != null && !isNaN(+p[campo]))
  .map(p => [new Date(p.instante).getTime(), Math.round(+p[campo] * 10) / 10]);

module.exports = async (req, res) => {
  let s;
  try { s = sessao.ler(req); } catch (e) { return json(res, 500, { erro: e.message }); }
  if (!s) return json(res, 401, { erro: 'Sessão expirada. Entre de novo.' });

  const url = new URL(req.url, 'http://x');
  const sub = SUBSISTEMAS[url.searchParams.get('sub')] ? url.searchParams.get('sub') : 'Norte';
  const t0 = Date.now();
  const c = cache.get(sub);
  if (c && t0 - c.t < 60e3) return json(res, 200, { ...c.dados, cache: true, latencia_ms: Date.now() - t0 });
  try {
    const listas = await Promise.all([...FONTES.map(f => baixar(`Geracao_${sub}_${f}_json`)), baixar(`Carga_${sub}_json`)]);
    const fontes = {};
    FONTES.forEach((f, i) => { const p = pontos(listas[i], 'geracao'); if (p.length) fontes[f] = p; });
    const dados = {
      sub, nome: SUBSISTEMAS[sub], fontes, carga: pontos(listas[FONTES.length], 'carga'),
      consultado_em: new Date().toISOString(),
    };
    cache.set(sub, { t: t0, dados });
    json(res, 200, { ...dados, latencia_ms: Date.now() - t0 });
  } catch (e) {
    console.error('geracao falhou:', e.message);
    json(res, e.status || 502, { erro: e.message });
  }
};
