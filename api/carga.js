const sessao = require('./_lib/sessao');
const ons = require('./_lib/ons');
const { json } = require('./_lib/http');
const { REGIOES, PADRAO } = require('./_lib/regioes');

const PERFIL = { AM: 1900, AP: 330, RR: 260, N: 7800 };
const MMGD_PICO = { AM: 90, AP: 45, RR: 40, N: 900 };   // só para a demonstração (MW no meio-dia)

function aleatorio(semente) {   // PRNG determinístico simples
  let h = 2166136261;
  for (const ch of semente) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return () => { h = Math.imul(h ^ (h >>> 15), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}

const r1 = v => Math.round(v * 10) / 10;

function simulado(area, dia) {
  const base = PERFIL[area] || 500, rnd = aleatorio(area + dia);
  const inicio = new Date(`${dia}T00:00:00-03:00`).getTime(), agora = Date.now();
  const serie = [];
  for (let i = 1; i <= 48; i++) {
    const t = inicio + i * 30 * 60e3, h = i / 2;
    const forma = 0.8 + 0.12 * Math.sin((h - 9) / 24 * 2 * Math.PI) + 0.07 * Math.exp(-((h - 15) ** 2) / 8);
    const prev = base * forma;
    const p = { instante: new Date(t).toISOString(), prevista: r1(prev) };
    if (t <= agora) {
      const sol = h > 6 && h < 18 ? Math.sin((h - 6) / 12 * Math.PI) ** 1.5 : 0;
      const mmgd = (MMGD_PICO[area] || 20) * sol * (0.85 + rnd() * 0.3);
      const medida = prev * (1 + (rnd() - 0.5) * 0.05);
      Object.assign(p, { medida: r1(medida), mmgd: r1(mmgd), com_mmgd: r1(medida + mmgd) });
    }
    serie.push(p);
  }
  return serie;
}

const n = v => (v == null || v === '' || isNaN(+v)) ? null : +v;

// Campos do dicionário "Carga Verificada" do ONS:
//   val_cargaglobal      carga global (inclui o que foi atendido por MMGD)
//   val_cargaglobalsmmg  carga global líquida de MMGD (o que a rede mediu)
//   val_cargammgd        carga atendida por MMGD
function lerVerificada(r) {
  const glob = n(r.val_cargaglobal);
  let medida = n(r.val_cargaglobalsmmg ?? r.val_cargaglobalsmmgd);
  let mmgd = n(r.val_cargammgd);
  if (medida == null && glob != null) medida = mmgd != null ? glob - mmgd : glob;
  if (mmgd == null && glob != null && medida != null) mmgd = glob - medida;
  const com = glob ?? (medida != null && mmgd != null ? medida + mmgd : null);
  return { medida, mmgd, com_mmgd: com };
}

async function real(s, area, dia) {
  const params = { cod_areacarga: area, dat_referencia_ini: dia, dat_referencia_fim: dia };
  let atual = s, mudou = false;
  const [v, n1] = await ons.get(atual, '/cargaglobal/cargav', params); if (n1) { atual = n1; mudou = true; }
  const [p, n2] = await ons.get(atual, '/cargaglobal/cargap', params); if (n2) { atual = n2; mudou = true; }
  const pontos = new Map();
  for (const r of ons.lista(v)) {
    const t = r.din_referenciautc || r.dat_referencia; if (!t) continue;
    const v = lerVerificada(r);
    if (v.medida == null) continue;
    Object.assign(pontos.get(t) || pontos.set(t, {}).get(t), v);
  }
  for (const r of ons.lista(p)) {
    const t = r.din_referenciautc || r.dat_referencia; if (!t) continue;
    const pv = n(r.val_cargaglobalprogramada ?? r.val_cargaprogramada);
    if (pv != null) (pontos.get(t) || pontos.set(t, {}).get(t)).prevista = pv;
  }
  const serie = [...pontos.entries()].map(([t, x]) => ({ instante: new Date(t).toISOString(), ...x }))
    .sort((a, b) => a.instante.localeCompare(b.instante));
  return [serie, mudou ? atual : null];
}

// Soma séries de várias áreas por instante. Um campo só entra na soma
// de um instante se todas as áreas tiverem o valor.
const CAMPOS = ['medida', 'mmgd', 'com_mmgd', 'prevista'];
function somar(series) {
  const m = new Map();
  for (const serie of series) for (const p of serie) {
    const x = m.get(p.instante) || { instante: p.instante, v: {} };
    for (const c of CAMPOS) if (p[c] != null) (x.v[c] ||= []).push(p[c]);
    m.set(p.instante, x);
  }
  const qtd = series.length;
  return [...m.values()].sort((a, b) => a.instante.localeCompare(b.instante)).map(x => {
    const o = { instante: x.instante };
    for (const c of CAMPOS) if (x.v[c]?.length === qtd) o[c] = r1(x.v[c].reduce((a, b) => a + b, 0));
    return o;
  });
}

// "verificada" = carga medida, mantido para compatibilidade.
const compat = serie => serie.map(p => (p.medida != null ? { ...p, verificada: p.medida } : p));

function resumo(serie) {
  const ult = serie.filter(p => p.medida != null).at(-1) || null;
  return {
    serie: compat(serie), ultimo: ult ? { ...ult, verificada: ult.medida } : null,
    registros: { verificada: serie.filter(p => p.medida != null).length, prevista: serie.filter(p => p.prevista != null).length },
  };
}

module.exports = async (req, res) => {
  let s;
  try { s = sessao.ler(req); } catch (e) { return json(res, 500, { erro: e.message }); }
  if (!s) return json(res, 401, { erro: 'Sessão expirada. Entre de novo.' });

  const url = new URL(req.url, 'http://x');
  const regiao = REGIOES[url.searchParams.get('regiao')] ? url.searchParams.get('regiao') : PADRAO;
  const separado = url.searchParams.get('separado') === '1';
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
    const base = { modo: s.modo, regiao, nome: REGIOES[regiao].nome, areas, dia, consultado_em: new Date().toISOString(), latencia_ms: Date.now() - t0 };
    if (separado) {   // uma série por área (painel com os três gráficos)
      const por = {};
      for (const a of areas) por[a] = { nome: REGIOES[a]?.nome || a, ...resumo(porArea[a]) };
      return json(res, 200, { ...base, por_area: por });
    }
    const serie = areas.length === 1 ? porArea[areas[0]] : somar(Object.values(porArea));
    const r = resumo(serie), regs = {};
    for (const a of areas) regs[a] = resumo(porArea[a]).registros;
    json(res, 200, { ...base, serie: r.serie, ultimo: r.ultimo, registros: regs });
  } catch (e) {
    console.error('carga falhou:', e.status || '', e.message);
    if (e.status === 401) { sessao.apagar(res); return json(res, 401, { erro: e.message }); }
    json(res, 502, { erro: e.message, modo: s.modo });
  }
};
