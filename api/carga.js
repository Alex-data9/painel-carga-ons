const sessao = require('./_lib/sessao');
const ons = require('./_lib/ons');
const { json } = require('./_lib/http');
const { REGIOES, PADRAO } = require('./_lib/regioes');

const PERFIL = { AM: 1900, AP: 330, RR: 260, N: 7800 };

function aleatorio(semente) {   // PRNG determinístico simples
  let h = 2166136261;
  for (const ch of semente) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

function simulado(area, dia) {
  const base = PERFIL[area] || 500, rnd = aleatorio(area + dia);
  const inicio = new Date(`${dia}T00:00:00-03:00`).getTime(), agora = Date.now();
  const serie = [];
  for (let i = 1; i <= 48; i++) {
    const t = inicio + i * 30 * 60e3, h = i / 2;
    const forma = 0.8 + 0.12 * Math.sin((h - 9) / 24 * 2 * Math.PI) + 0.07 * Math.exp(-((h - 15) ** 2) / 8);
    const prev = base * forma;
    const p = { instante: new Date(t).toISOString(), prevista: Math.round(prev * 10) / 10 };
    if (t <= agora) p.verificada = Math.round(prev * (1 + (rnd() - 0.5) * 0.05) * 10) / 10;
    serie.push(p);
  }
  return serie;
}

async function real(s, area, dia) {
  const params = { cod_areacarga: area, dat_referencia_ini: dia, dat_referencia_fim: dia };
  let atual = s, mudou = false;
  const [v, n1] = await ons.get(atual, '/cargaglobal/cargav', params); if (n1) { atual = n1; mudou = true; }
  const [p, n2] = await ons.get(atual, '/cargaglobal/cargap', params); if (n2) { atual = n2; mudou = true; }
  const pontos = new Map();
  for (const r of ons.lista(v)) {
    const t = r.din_referenciautc || r.dat_referencia; if (!t) continue;
    (pontos.get(t) || pontos.set(t, {}).get(t)).verificada = r.val_cargaglobal;
  }
  for (const r of ons.lista(p)) {
    const t = r.din_referenciautc || r.dat_referencia; if (!t) continue;
    (pontos.get(t) || pontos.set(t, {}).get(t)).prevista = r.val_cargaglobalprogramada ?? r.val_cargaprogramada;
  }
  const serie = [...pontos.entries()].map(([t, x]) => ({ instante: new Date(t).toISOString(), ...x }))
    .sort((a, b) => a.instante.localeCompare(b.instante));
  return [serie, mudou ? atual : null];
}

// Soma séries de várias áreas por instante. Um instante só entra na soma
// de "verificada"/"prevista" se todas as áreas tiverem o valor.
function somar(series) {
  const m = new Map();
  for (const serie of series) for (const p of serie) {
    const x = m.get(p.instante) || { instante: p.instante, v: [], p: [] };
    if (p.verificada != null) x.v.push(p.verificada);
    if (p.prevista != null) x.p.push(p.prevista);
    m.set(p.instante, x);
  }
  const n = series.length;
  return [...m.values()].sort((a, b) => a.instante.localeCompare(b.instante)).map(x => ({
    instante: x.instante,
    ...(x.v.length === n ? { verificada: x.v.reduce((a, b) => a + b, 0) } : {}),
    ...(x.p.length === n ? { prevista: x.p.reduce((a, b) => a + b, 0) } : {}),
  }));
}

module.exports = async (req, res) => {
  let s;
  try { s = sessao.ler(req); } catch (e) { return json(res, 500, { erro: e.message }); }
  if (!s) return json(res, 401, { erro: 'Sessão expirada. Entre de novo.' });

  const url = new URL(req.url, 'http://x');
  const regiao = REGIOES[url.searchParams.get('regiao')] ? url.searchParams.get('regiao') : PADRAO;
  const dia = url.searchParams.get('dia') || new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dia) || isNaN(new Date(dia))) return json(res, 400, { erro: 'dia deve ser AAAA-MM-DD' });

  const t0 = Date.now();
  try {
    const porArea = {};
    let atual = s, renovada = false;
    for (const area of REGIOES[regiao].areas) {   // sequencial para reaproveitar token renovado
      if (s.modo === 'real') {
        const [serie, nova] = await real(atual, area, dia);
        if (nova) { atual = nova; renovada = true; }
        porArea[area] = serie;
      } else porArea[area] = simulado(area, dia);
    }
    if (renovada) sessao.gravar(res, atual);
    const areas = Object.keys(porArea);
    const serie = areas.length === 1 ? porArea[areas[0]] : somar(Object.values(porArea));
    const verif = serie.filter(p => p.verificada != null);
    const regs = {};
    for (const a of areas) regs[a] = {
      verificada: porArea[a].filter(p => p.verificada != null).length,
      prevista: porArea[a].filter(p => p.prevista != null).length,
    };
    json(res, 200, {
      modo: s.modo, regiao, nome: REGIOES[regiao].nome, areas, dia, serie,
      ultimo: verif.at(-1) || null, registros: regs,
      consultado_em: new Date().toISOString(), latencia_ms: Date.now() - t0,
    });
  } catch (e) {
    console.error('carga falhou:', e.status || '', e.message);
    if (e.status === 401) { sessao.apagar(res); return json(res, 401, { erro: e.message }); }
    json(res, 502, { erro: e.message, modo: s.modo });
  }
};
