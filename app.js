const $ = id => document.getElementById(id);
const num = n => Math.round(n).toLocaleString('pt-BR');
const num1 = n => n.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const fmt = n => n == null ? '–' : num1(n) + ' MW';
const fmtS = n => n == null ? '–' : (n > 0 ? '+' : '') + num1(n) + ' MW';
const hora = t => new Date(t).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);   // dia em Brasília
const somaDias = (dia, k) => new Date(new Date(dia + 'T12:00:00Z').getTime() + k * 864e5).toISOString().slice(0, 10);
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();

const AREAS = {
  AM: { nome: 'Amazonas', cor: '#12848a' },
  AP: { nome: 'Amapá', cor: '#6f9a00' },
  RR: { nome: 'Roraima', cor: '#e25839' },
  SOMA: { nome: 'Amazonas + Amapá + Roraima', cod: 'Soma AM + AP + RR', cor: '#0a585c' },
  GER: { nome: 'Geração Norte', cod: 'Geração Norte', cor: '#ffb500' },
  CZG: { nome: 'Cruzamento', cod: 'Cruzamento (MW)', cor: '#8a7fbf' },
  CZP: { nome: 'Indicadores', cod: 'Indicadores (%)', cor: '#8a7fbf' },
};
const SOLOS = ['GER', 'CZG', 'CZP'];   // gráficos fora da aba Carga (não são recriados por montarPaineis)
const grupo = c => c === 'GER' ? 'ger' : c.startsWith('CZ') ? 'cruz' : 'carga';   // o zoom só sincroniza dentro do grupo
const pct1 = n => n == null || !isFinite(n) ? '–' : n.toFixed(1).replace('.', ',') + '%';
const CURVAS = [
  { chave: 'medida', rotulo: 'Carga medida' },
  { chave: 'com_mmgd', rotulo: 'Carga com MMGD' },
  { chave: 'prevista', rotulo: 'Carga programada' },
];

let timer, tick, proxima = 0, emCurso = false, iniciado = false, visao = 'areas', aba = 'carga', empilhado = true;
const FONTES = [
  { chave: 'Hidraulica', rotulo: 'Hidráulica', cor: '#2b7bbd' },
  { chave: 'Termica', rotulo: 'Térmica', cor: '#e25839' },
  { chave: 'Eolica', rotulo: 'Eólica', cor: '#12a39a' },
  { chave: 'Solar', rotulo: 'Solar', cor: '#f2a900' },
  { chave: 'Nuclear', rotulo: 'Nuclear', cor: '#8a7fbf' },
];
const graficos = {};          // código da área -> Chart
let medicao = [];             // até 2 pontos {area, curva, x, y}
let sincronizando = false;
function lembrar(k, v) { try { localStorage.setItem('painel-' + k, v) } catch {} }
function lido(k) { try { return localStorage.getItem('painel-' + k) } catch { return null } }

async function postJson(url, corpo) {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(corpo || {}), credentials: 'same-origin' });
  let d = {}; try { d = await r.json(); } catch {}
  if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`);
  return d;
}

async function verificar() {
  const d = await (await fetch('/api/sessao', { credentials: 'same-origin' })).json();
  if (d.erro) throw new Error(d.erro);
  if (!d.logado) return mostrarLogin();
  mostrarPainel(d);
}

function mostrarLogin(msg) {
  clearTimeout(timer); clearInterval(tick); proxima = 0;
  $('telaPainel').hidden = true; $('telaLogin').hidden = false;
  $('erroLogin').hidden = !msg; $('erroLogin').textContent = msg || '';
  $('senha').value = '';
  ($('usuario').value ? $('senha') : $('usuario')).focus();
}

async function entrar(corpo) {
  $('btnEntrar').disabled = $('btnDemo').disabled = true;
  $('erroLogin').hidden = true;
  if (corpo.demo) $('btnDemo').textContent = 'Abrindo demonstração…';
  else $('btnEntrar').textContent = 'Autenticando no ONS…';
  try { await postJson('/api/login', corpo); $('senha').value = ''; await verificar(); }
  catch (e) { $('erroLogin').textContent = e.message; $('erroLogin').hidden = false; }
  finally {
    $('btnEntrar').disabled = $('btnDemo').disabled = false;
    $('btnEntrar').textContent = 'Entrar'; $('btnDemo').textContent = 'Ver demonstração';
  }
}

$('formLogin').onsubmit = ev => {
  ev.preventDefault();
  if (!$('usuario').value.trim() || !$('senha').value) {
    $('erroLogin').textContent = 'Informe usuário e senha.'; $('erroLogin').hidden = false;
    ($('usuario').value.trim() ? $('senha') : $('usuario')).focus();
    return;
  }
  entrar({ usuario: $('usuario').value, senha: $('senha').value });
};
$('btnDemo').onclick = () => entrar({ demo: true });
$('verSenha').onclick = () => {
  const ver = $('senha').type === 'password';
  $('senha').type = ver ? 'text' : 'password';
  $('verSenha').setAttribute('aria-pressed', String(ver));
  $('verSenha').setAttribute('aria-label', ver ? 'Ocultar senha' : 'Mostrar senha');
};
function rotuloTema() {
  const esc = document.documentElement.dataset.tema === 'escuro';
  const t = esc ? 'Mudar para modo claro' : 'Mudar para modo escuro';
  $('tema').setAttribute('aria-label', t); $('tema').title = t;
}
$('tema').onclick = () => {
  const novo = document.documentElement.dataset.tema === 'escuro' ? 'claro' : 'escuro';
  document.documentElement.dataset.tema = novo;
  lembrar('tema', novo); rotuloTema();
  if (iniciado) { montarPaineis(); for (const k of SOLOS) if (graficos[k]) { graficos[k].destroy(); delete graficos[k]; } atualizar(); }   // os gráficos pegam as cores do tema ao serem criados
};
rotuloTema();
$('sair').onclick = async () => { try { await postJson('/api/logout'); } catch {} mostrarLogin(); };

function mostrarPainel(s) {
  $('telaLogin').hidden = true; $('telaPainel').hidden = false;
  const real = s.modo === 'real';
  $('badge').textContent = real ? 'API ONS' : 'Demonstração';
  $('badge').className = 'badge ' + (real ? 'real' : 'sim');
  $('aviso').hidden = real;
  $('usr').textContent = s.usuario;
  if (!iniciado) {
    iniciado = true;
    if (window.Chart && window.ChartZoom) Chart.register(window.ChartZoom);
    visao = ['areas', 'soma', 'AM', 'AP', 'RR'].includes(lido('visao')) ? lido('visao') : 'areas';
    $('vis-' + visao).checked = true;
    document.querySelectorAll('input[name=visao]').forEach(i => i.onchange = () => mudarVisao(i.value));
    $('recTodos').onclick = () => {
      const recolher = !todosRecolhidos();
      document.querySelectorAll('#paineis .area').forEach(el => recolherPainel(el, recolher));
      atualizarRecTodos();
    };
    $('dia').value = hoje(); $('dia').max = hoje();
    $('intervalo').value = lido('intervalo') ?? '60';
    $('btn').onclick = () => atualizar();
    $('dia').onchange = () => { if ($('dia').value > hoje()) $('dia').value = hoje(); atualizar(); };
    $('diaAnt').onclick = () => mudarDia(-1);
    $('diaSeg').onclick = () => mudarDia(1);
    $('diaHoje').onclick = () => { $('dia').value = hoje(); atualizar(); };
    $('intervalo').onchange = () => { lembrar('intervalo', $('intervalo').value); agendar(); };
    $('medLimpar').onclick = () => limparMedicao();
    $('sincZoom').checked = lido('sinc') !== '0';
    $('sincZoom').onchange = () => lembrar('sinc', $('sincZoom').checked ? '1' : '0');
    document.addEventListener('visibilitychange', () => { if (!document.hidden && proxima && Date.now() > proxima) atualizar(); });
    montarPaineis();
    document.querySelectorAll('.aba').forEach(b => b.onclick = () => mudarAba(b.dataset.aba));
    $('gerEmpilhar').onclick = () => { empilhado = !empilhado; aplicarEmpilhado(); };
    document.querySelectorAll('#secGer .zb, #secCruz .zb').forEach(b => b.onclick = () => {
      const g = graficos[b.closest('.area').dataset.area]; if (!g?.zoom) return;
      if (b.dataset.z === 'reset') g.resetZoom(); else g.zoom(b.dataset.z === 'in' ? 1.5 : 1 / 1.5);
      sincronizar(g);
    });
    mudarAba(['ger', 'cruz'].includes(lido('aba')) ? lido('aba') : 'carga', false);
  }
  atualizar();
}

function mudarAba(nova, recarregar = true) {
  aba = nova; lembrar('aba', nova);
  $('conteudo').dataset.aba = nova;
  document.querySelectorAll('.aba').forEach(b => b.setAttribute('aria-selected', String(b.dataset.aba === nova)));
  limparMedicao();
  if (recarregar) atualizar();
}

// ---------- Geração do subsistema Norte (áreas empilhadas por fonte + carga) ----------
function graficoGer() {
  if (graficos.GER) return graficos.GER;
  const g = criarGrafico($('gerGraf'), 'GER');
  if (!window.Chart) return (graficos.GER = g);
  const carga = css('--curva-medida');
  g.data.datasets = [
    ...FONTES.map((f, i) => ({ label: f.rotulo, $chave: f.chave, data: [], borderColor: f.cor, backgroundColor: f.cor + 'b3',
      borderWidth: 1, pointRadius: 0, pointHoverRadius: 3, tension: .2, stack: 'ger', fill: i === 0 ? 'origin' : '-1' })),
    { label: 'Carga Norte', $chave: 'carga', data: [], borderColor: carga, backgroundColor: carga, borderWidth: 2.2, borderDash: [5, 4],
      pointRadius: 0, pointHoverRadius: 3, tension: .2, stack: 'carga', fill: false, order: -1 },
  ];
  g.options.plugins.tooltip.callbacks.footer = i => {
    const tot = i.filter(x => x.dataset.stack === 'ger').reduce((a, x) => a + x.parsed.y, 0);
    const c = i.find(x => x.dataset.$chave === 'carga');
    return [`Geração total: ${fmt(tot)}`, ...(c ? [`Geração − carga: ${fmtS(tot - c.parsed.y)}`] : [])];
  };
  g.options.plugins.legend.labels.filter = (it, data) => data.datasets[it.datasetIndex].data.length > 0;   // esconde fonte sem dado (nuclear)
  graficos.GER = g;
  aplicarEmpilhado();
  return g;
}

function aplicarEmpilhado() {
  const b = $('gerEmpilhar');
  b.setAttribute('aria-pressed', String(empilhado));
  b.textContent = empilhado ? 'Empilhado' : 'Linhas separadas';
  b.title = empilhado ? 'Mostrar cada fonte como linha separada' : 'Empilhar as fontes';
  const g = graficos.GER; if (!g?.options?.scales?.y) return;
  g.options.scales.y.stacked = empilhado;
  g.options.scales.y.min = empilhado ? 0 : undefined;   // áreas empilhadas partem do zero
  g.data.datasets.forEach((d, i) => { if (d.stack === 'ger') { d.fill = empilhado ? (i === 0 ? 'origin' : '-1') : false; d.borderWidth = empilhado ? 1 : 2; } });
  limparMedicao();
  g.update('none');
}

function desenharGer(d) {
  const g = graficoGer();
  const ini = new Date(hoje() + 'T00:00:00-03:00').getTime();
  const serie = k => (k === 'carga' ? d.carga : d.fontes?.[k]) || [];
  g.data.datasets.forEach(ds => { ds.data = serie(ds.$chave).map(([x, y]) => ({ x, y })); ds.hidden = ds.$chave !== 'carga' && !ds.data.length; });
  const x = g.options.scales.x;
  if (g.options.plugins?.zoom) g.options.plugins.zoom.limits.x = { min: ini, max: ini + 864e5, minRange: 1800e3 };
  if (!(g.isZoomedOrPanned && g.isZoomedOrPanned())) { x.min = ini; x.max = ini + 864e5; }
  g.update('none');

  // cartões: último minuto com todas as fontes presentes
  const ult = k => serie(k).at(-1);
  const presentes = FONTES.filter(f => serie(f.chave).length);
  const total = presentes.reduce((a, f) => a + ult(f.chave)[1], 0);
  const carga = ult('carga')?.[1];
  const box = $('gerCards'); box.textContent = '';
  const card = (rotulo, valor, sub, cor, dest) => {
    const m = document.createElement('div'); m.className = 'm' + (dest ? ' m-dest' : '');
    const k = document.createElement('span'); k.className = 'k';
    if (cor) { const sw = document.createElement('i'); sw.className = 'sw'; sw.style.background = cor; k.append(sw); }
    k.append(rotulo);
    const b = document.createElement('b'); b.textContent = valor;
    m.append(k, b);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; m.append(s); }
    box.append(m);
  };
  for (const f of presentes) { const v = ult(f.chave)[1]; card(f.rotulo, fmt(v), total ? `${(v / total * 100).toFixed(1).replace('.', ',')}% da geração` : '', f.cor); }
  card('Geração total', fmt(total), `${presentes.length} fontes`);
  card('Carga Norte', fmt(carga), '');
  card('Geração − carga', carga != null ? fmtS(total - carga) : '–', carga != null ? (total >= carga ? 'Norte exporta' : 'Norte importa') : '', null, true);
  const t = presentes.length ? ult(presentes[0].chave)[0] : null;
  $('gerRef').textContent = t ? `Referência: ${hora(t)} de hoje.` + (serie('Nuclear').length ? '' : ' O Norte não tem geração nuclear.') : 'Sem dados de geração ainda hoje.';
}

// ---------- Cruzamento: geração do Norte × carga de AM + AP + RR ----------
// A geração vem minuto a minuto; a carga, por semi-hora. Cada semi-hora [t, t+30 min) recebe a média
// dos minutos de geração dentro dela (só se tiver ao menos 20 minutos) e é casada com o instante t da carga.
const SEMI = 1800e3;
function mediaSemi(lista) {
  const b = new Map();
  for (const [x, y] of lista || []) { const k = Math.floor(x / SEMI) * SEMI, v = b.get(k) || [0, 0]; v[0] += y; v[1]++; b.set(k, v); }
  return new Map([...b].filter(([, v]) => v[1] >= 20).map(([k, v]) => [k, v[0] / v[1]]));
}

function graficoCruz() {
  if (graficos.CZG) return [graficos.CZG, graficos.CZP];
  const g = criarGrafico($('czGraf'), 'CZG'), p = criarGrafico($('czPct'), 'CZP');
  if (!window.Chart) return [(graficos.CZG = g), (graficos.CZP = p)];
  const tinta = css('--curva-medida'), roxo = '#8a7fbf';
  const linha = (label, $chave, cor, extra = {}) => ({ label, $chave, data: [], borderColor: cor, backgroundColor: cor, borderWidth: 2.4,
    pointRadius: 0, pointHoverRadius: 4, tension: .25, fill: false, ...extra });
  g.data.datasets = [
    ...FONTES.map((f, i) => ({ label: f.rotulo + ' (Norte)', $chave: f.chave, data: [], borderColor: f.cor, backgroundColor: f.cor + '8c',
      borderWidth: 1, pointRadius: 0, pointHoverRadius: 3, tension: .25, stack: 'ger', fill: i === 0 ? 'origin' : '-1' })),
    linha('Carga Norte', 'cargaN', tinta, { borderDash: [5, 4], stack: 'c1', order: -1 }),
    linha('Carga AM + AP + RR', 'carga3', roxo, { borderWidth: 3, stack: 'c2', order: -2 }),
  ];
  g.options.scales.y.stacked = true; g.options.scales.y.min = 0;
  g.options.plugins.legend.labels.filter = (it, data) => data.datasets[it.datasetIndex].data.length > 0;
  g.options.plugins.tooltip.callbacks.footer = i => {
    const tot = i.filter(x => x.dataset.stack === 'ger').reduce((a, x) => a + x.parsed.y, 0);
    const n = i.find(x => x.dataset.$chave === 'cargaN'), t = i.find(x => x.dataset.$chave === 'carga3');
    const ter = i.find(x => x.dataset.$chave === 'Termica');
    return [`Geração Norte: ${fmt(tot)}`,
      ...(n ? [`Saldo Norte (geração − carga): ${fmtS(tot - n.parsed.y)}`] : []),
      ...(n && t ? [`AM + AP + RR na carga Norte: ${pct1(t.parsed.y / n.parsed.y * 100)}`] : []),
      ...(ter && t ? [`Cobertura térmica: ${pct1(ter.parsed.y / t.parsed.y * 100)}`] : [])];
  };
  p.data.datasets = [
    linha('AM + AP + RR na carga Norte', 'part', roxo),
    linha('Cobertura térmica', 'cob', '#e25839'),
  ];
  p.options.scales.y.title.text = '%';
  p.options.scales.y.grace = '10%';
  p.options.scales.y.ticks.callback = v => v.toLocaleString('pt-BR') + '%';
  p.options.plugins.tooltip.callbacks.label = i => ` ${i.dataset.label}: ${pct1(i.parsed.y)}`;
  for (const c of [g, p]) c.options.plugins.zoom.limits.x.minRange = 2 * 3600e3;
  graficos.CZG = g; graficos.CZP = p;
  return [g, p];
}

function desenharCruz(ger, car) {
  const [g, p] = graficoCruz();
  const ini = new Date(hoje() + 'T00:00:00-03:00').getTime();
  const fontes = Object.fromEntries(FONTES.map(f => [f.chave, mediaSemi(ger.fontes?.[f.chave])]));
  const cargaN = mediaSemi(ger.carga);
  const carga3 = new Map((car.serie || []).filter(x => x.medida != null).map(x => [new Date(x.instante).getTime(), x.medida]));
  // semi-horas em que há geração, carga Norte e carga dos três estados
  const presentes = FONTES.filter(f => fontes[f.chave].size);
  const ts = [...cargaN.keys()].filter(t => carga3.has(t) && presentes.every(f => fontes[f.chave].has(t))).sort((a, b) => a - b);
  const pt = (m, t) => ({ x: t, y: Math.round(m.get(t) * 10) / 10 });
  const total = t => presentes.reduce((a, f) => a + fontes[f.chave].get(t), 0);
  for (const ds of g.data.datasets) {
    const m = ds.$chave === 'cargaN' ? cargaN : ds.$chave === 'carga3' ? carga3 : fontes[ds.$chave];
    ds.data = m.size ? ts.map(t => pt(m, t)) : [];
    ds.hidden = !ds.data.length && ds.stack === 'ger';
  }
  const ter = fontes.Termica;
  p.data.datasets[0].data = ts.map(t => ({ x: t, y: carga3.get(t) / cargaN.get(t) * 100 }));
  p.data.datasets[1].data = ter.size ? ts.map(t => ({ x: t, y: ter.get(t) / carga3.get(t) * 100 })) : [];
  for (const c of [g, p]) {
    if (c.options.plugins?.zoom) c.options.plugins.zoom.limits.x = { min: ini, max: ini + 864e5, minRange: 2 * 3600e3 };
    if (!(c.isZoomedOrPanned && c.isZoomedOrPanned())) { c.options.scales.x.min = ini; c.options.scales.x.max = ini + 864e5; }
    c.update('none');
  }

  // cartões: última semi-hora com os dois lados, e a semi-hora de maior carga dos três estados
  const box = $('czCards'); box.textContent = '';
  const card = (rotulo, valor, sub, cor, dest) => {
    const m = document.createElement('div'); m.className = 'm' + (dest ? ' m-dest' : '');
    const k = document.createElement('span'); k.className = 'k';
    if (cor) { const sw = document.createElement('i'); sw.className = 'sw'; sw.style.background = cor; k.append(sw); }
    k.append(rotulo);
    const b = document.createElement('b'); b.textContent = valor;
    m.append(k, b);
    if (sub) { const s = document.createElement('small'); s.textContent = sub; m.append(s); }
    box.append(m);
  };
  const t = ts.at(-1);
  if (t == null) {
    for (const r of ['Carga AM + AP + RR', 'Participação no Norte', 'Cobertura térmica', 'Saldo Norte', 'Saldo no pico']) card(r, '–', '');
    $('czRef').textContent = 'Ainda não há semi-hora de hoje com geração e carga dos três estados.';
    return 0;
  }
  const c3 = carga3.get(t), cn = cargaN.get(t), gt = total(t), tt = ter.get(t);
  const pico = ts.reduce((a, b) => carga3.get(b) > carga3.get(a) ? b : a, ts[0]);
  const saldoPico = total(pico) - cargaN.get(pico);
  card('Carga AM + AP + RR', fmt(c3), 'carga medida', '#8a7fbf');
  card('Participação no Norte', pct1(c3 / cn * 100), `resto do Norte: ${fmt(cn - c3)}`);
  card('Cobertura térmica', tt != null ? pct1(tt / c3 * 100) : '–', tt != null ? `térmica Norte: ${fmt(tt)}` : 'sem térmica', '#e25839');
  card('Saldo Norte', fmtS(gt - cn), gt >= cn ? 'Norte exporta' : 'Norte importa');
  card(`Saldo no pico (${hora(pico)})`, fmtS(saldoPico), `pico de AM + AP + RR: ${fmt(carga3.get(pico))}`, null, true);
  $('czRef').textContent = `Referência: semi-hora das ${hora(t)} às ${hora(t + SEMI)} de hoje. A geração e a carga do Norte são médias dos minutos de cada semi-hora.`;
  return ts.length;
}

function mudarDia(k) {
  const d = somaDias($('dia').value || hoje(), k);
  if (d > hoje()) return;
  $('dia').value = d; atualizar();
}

// ---------- Painéis (um por área, ou um só com a soma) ----------
function montarPaineis() {
  for (const k of Object.keys(graficos)) { if (SOLOS.includes(k)) continue; graficos[k].destroy(); delete graficos[k]; }
  limparMedicao();
  const box = $('paineis');
  box.textContent = '';
  const codigos = visao === 'soma' ? ['SOMA'] : visao === 'areas' ? ['AM', 'AP', 'RR'] : [visao];
  box.classList.toggle('um', codigos.length === 1);
  for (const cod of codigos) {
    const a = AREAS[cod];
    const el = $('tplPainel').content.firstElementChild.cloneNode(true);
    el.dataset.area = cod;
    el.style.setProperty('--cor-area', a.cor);
    el.querySelector('.area-nome').textContent = a.nome;
    el.querySelector('.area-cod').textContent = a.cod || cod;
    el.querySelector('canvas').setAttribute('aria-label', `Gráfico da carga de ${a.nome} ao longo do dia, em MW`);
    const foco = el.querySelector('.ab-foco');
    if (cod === 'SOMA') foco.hidden = true;
    else if (visao === cod) { foco.querySelector('span').textContent = 'Ver os três'; foco.onclick = () => mudarVisao('areas'); }
    else { foco.onclick = () => mudarVisao(cod); }
    el.querySelector('.ab-rec').onclick = () => { recolherPainel(el, !el.classList.contains('recolhido')); atualizarRecTodos(); };
    recolherPainel(el, lido('rec-' + cod) === '1');
    el.querySelectorAll('.zb').forEach(b => b.onclick = () => {
      const g = graficos[cod]; if (!g?.zoom) return;
      if (b.dataset.z === 'reset') { g.resetZoom(); sincronizar(g); }
      else { g.zoom(b.dataset.z === 'in' ? 1.5 : 1 / 1.5); sincronizar(g); }
    });
    box.append(el);
    graficos[cod] = criarGrafico(el.querySelector('canvas'), cod);
  }
  atualizarRecTodos();
}

function mudarVisao(v) {
  visao = v; lembrar('visao', v);
  const r = $('vis-' + v); if (r) r.checked = true;
  montarPaineis(); atualizar();
  window.scrollTo({ top: $('paineis').getBoundingClientRect().top + scrollY - 16, behavior: 'smooth' });
}

// Recolher/expandir os cartões de informação de um estado (o gráfico continua visível).
function recolherPainel(el, recolher) {
  el.classList.toggle('recolhido', recolher);
  const b = el.querySelector('.ab-rec');
  b.setAttribute('aria-expanded', String(!recolher));
  b.querySelector('span').textContent = recolher ? 'Mostrar' : 'Recolher';
  b.title = recolher ? 'Mostrar as informações deste estado' : 'Recolher as informações deste estado';
  lembrar('rec-' + el.dataset.area, recolher ? '1' : '0');
}
const todosRecolhidos = () => [...document.querySelectorAll('#paineis .area')].every(el => el.classList.contains('recolhido'));
function atualizarRecTodos() {
  $('recTodos').textContent = todosRecolhidos() ? 'Mostrar todas as informações' : 'Recolher todas as informações';
}

function criarGrafico(canvas, cod) {
  if (!window.Chart) {
    $('erro').textContent = 'Biblioteca de gráficos não carregou (cdn.jsdelivr.net). Os números continuam funcionando.'; $('erro').hidden = false;
    return { data: { datasets: CURVAS.map(() => ({ data: [] })) }, options: { scales: { x: {} } }, update() {}, destroy() {} };
  }
  Chart.defaults.font.family = css('--fonte');
  Chart.defaults.font.size = 12;
  const tinta = css('--curva-medida'), mmgd = css('--verif'), prev = css('--prev'), mut = css('--mut'), borda = css('--borda');
  let inicio = null;   // para distinguir clique de arraste (zoom)
  canvas.addEventListener('pointerdown', e => { inicio = [e.clientX, e.clientY]; });
  const g = new Chart(canvas, {
    type: 'line',
    data: { datasets: [
      { label: 'Carga medida', data: [], borderColor: tinta, backgroundColor: tinta, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: .25 },
      { label: 'Carga com MMGD', data: [], borderColor: mmgd, backgroundColor: mmgd + '2e', fill: { target: 0, above: mmgd + '2e', below: 'transparent' }, borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: .25 },
      { label: 'Carga programada', data: [], borderColor: prev, backgroundColor: prev, borderWidth: 2, borderDash: [6, 5], pointRadius: 0, pointHoverRadius: 4, tension: .25 },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false, normalized: true,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 4, right: 6 } },
      scales: {
        x: { type: 'linear', ticks: { color: mut, callback: v => hora(v), maxRotation: 0, autoSkip: true }, grid: { display: false }, border: { color: borda },
             afterBuildTicks: ax => {   // marcas em horas cheias, espaçadas conforme o zoom
               const vis = ax.max - ax.min, larg = ax.width || 300;
               const passos = [0.5, 1, 2, 3, 6].map(h => h * 3600e3);
               const passo = passos.find(p => vis / p <= Math.max(3, Math.floor(larg / 70))) || 6 * 3600e3;
               const base = new Date(`${$('dia').value}T00:00:00-03:00`).getTime() || 0, t = [];
               for (let v = base + Math.ceil((ax.min - base) / passo) * passo; v <= ax.max; v += passo) t.push({ value: v });
               ax.ticks = t;
             } },
        y: { grace: '6%', ticks: { color: mut, callback: v => v.toLocaleString('pt-BR'), maxTicksLimit: 6 }, grid: { color: borda }, border: { display: false },
             title: { display: true, text: 'MW', color: mut, font: { weight: '600' } } },
      },
      plugins: {
        legend: { position: 'top', align: 'start', labels: { color: css('--tinta'), boxWidth: 18, boxHeight: 2, padding: 12, font: { weight: '600' } } },
        tooltip: {
          backgroundColor: '#062f31', titleColor: '#fff', bodyColor: '#dceeef', padding: 10, cornerRadius: 8, boxPadding: 4,
          titleFont: { weight: '700' },
          callbacks: {
            title: i => hora(i[0].parsed.x),
            label: i => ` ${i.dataset.label}: ${fmt(i.parsed.y)}`,
            footer: i => {
              if (SOLOS.includes(i[0]?.chart?.$area)) return '';
              const m = i.find(x => x.datasetIndex === 0), c = i.find(x => x.datasetIndex === 1);
              return m && c ? `Δ com MMGD − medida: ${fmtS(c.parsed.y - m.parsed.y)}` : '';
            },
          },
        },
        zoom: {
          limits: { x: { minRange: 3600e3 } },
          zoom: { drag: { enabled: true, threshold: 10, backgroundColor: 'rgba(18,132,138,.12)', borderColor: 'rgba(18,132,138,.6)', borderWidth: 1 },
                  wheel: { enabled: true, modifierKey: 'ctrl' }, pinch: { enabled: true }, mode: 'x',
                  onZoomComplete: ({ chart }) => sincronizar(chart) },
          pan: { enabled: true, mode: 'x', modifierKey: 'shift', onPanComplete: ({ chart }) => sincronizar(chart) },
        },
      },
      onClick: (ev, _el, chart) => {
        const n = ev.native;
        if (inicio && n && Math.hypot(n.clientX - inicio[0], n.clientY - inicio[1]) > 6) return;   // foi arraste
        marcarPonto(cod, chart, ev);
      },
    },
    plugins: [marcasPlugin],
  });
  g.$area = cod;
  return g;
}

function sincronizar(origem) {
  if (sincronizando || !$('sincZoom').checked) return;
  sincronizando = true;
  const { min, max } = origem.scales.x;
  const cheio = origem.isZoomedOrPanned ? !origem.isZoomedOrPanned() : false;
  for (const g of Object.values(graficos)) {
    if (g === origem || !g.zoomScale || grupo(g.$area) !== grupo(origem.$area) || origem.$area === 'GER') continue;
    if (cheio) g.resetZoom('none'); else g.zoomScale('x', { min, max }, 'none');
  }
  sincronizando = false;
}

// ---------- Medição de Δ (dois cliques no mesmo gráfico) ----------
const marcasPlugin = {
  id: 'marcas',
  afterDatasetsDraw(chart) {
    const pts = medicao.filter(p => p.area === chart.$area);
    if (!pts.length) return;
    const { ctx, scales: { x, y }, chartArea: a } = chart;
    ctx.save();
    ctx.beginPath(); ctx.rect(a.left, a.top, a.width, a.height); ctx.clip();
    const xy = pts.map(p => {   // posição do próprio ponto desenhado (vale também para áreas empilhadas)
      const el = chart.getDatasetMeta(p.di)?.data?.[p.idx];
      return el && !chart.getDatasetMeta(p.di).hidden ? [el.x, el.y] : [x.getPixelForValue(p.x), y.getPixelForValue(p.y)];
    });
    if (xy.length === 2) {
      ctx.strokeStyle = '#062f31'; ctx.setLineDash([4, 3]); ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(...xy[0]); ctx.lineTo(...xy[1]); ctx.stroke(); ctx.setLineDash([]);
    }
    xy.forEach(([px, py], i) => {
      ctx.fillStyle = '#ffb500'; ctx.strokeStyle = '#062f31'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(px, py, 6, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#062f31'; ctx.font = '700 10px ' + css('--fonte'); ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(i + 1), px, py + 0.5);
    });
    ctx.restore();
  },
};

function marcarPonto(cod, chart, ev) {
  // ponto mais próximo do clique entre as curvas visíveis
  const els = chart.getElementsAtEventForMode(ev, 'nearest', { intersect: false, axis: 'xy' }, false);
  if (!els.length) return;
  const { datasetIndex: di, index } = els[0];
  const p = chart.data.datasets[di].data[index];
  if (!p) return;
  const ponto = { area: cod, curva: chart.data.datasets[di].label, x: p.x, y: p.y, di, idx: index };
  if (medicao.length === 2 || (medicao.length === 1 && medicao[0].area !== cod)) medicao = [];
  medicao.push(ponto);
  mostrarMedicao();
  Object.values(graficos).forEach(g => g.update('none'));
}

function mostrarMedicao() {
  const out = $('medRes');
  out.classList.toggle('ok', medicao.length === 2);
  if (!medicao.length) { out.textContent = 'Selecione o primeiro ponto.'; return; }
  const [a, b] = medicao, nomeA = AREAS[a.area].cod || a.area;
  const f = a.area === 'CZP' ? pct1 : fmt, fS = a.area === 'CZP' ? (n => (n > 0 ? '+' : '') + pct1(n).replace('%', ' p.p.')) : fmtS;
  const desc = p => `${p.curva} às ${hora(p.x)}: ${f(p.y)}`;
  if (!b) { out.textContent = `${nomeA} · ① ${desc(a)}. Agora selecione o segundo ponto.`; return; }
  const dt = Math.round((b.x - a.x) / 60e3), dmw = b.y - a.y, pct = a.y ? dmw / a.y * 100 : 0;
  const dtTxt = `${dt < 0 ? '−' : ''}${Math.floor(Math.abs(dt) / 60)}h${String(Math.abs(dt) % 60).padStart(2, '0')}`;
  out.textContent = `${nomeA} · ① ${desc(a)} → ② ${desc(b)} · Δt ${dtTxt} · ` + (a.area === 'CZP' ? `Δ ${fS(dmw)}` : `ΔMW ${fS(dmw)} (${pct >= 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')}%)`);
}

function limparMedicao() {
  medicao = [];
  mostrarMedicao();
  Object.values(graficos).forEach(g => g.update && g.update('none'));
}

// ---------- Dados ----------
function agendar() {
  clearTimeout(timer); clearInterval(tick);
  const seg = +$('intervalo').value;
  if (!seg || $('telaPainel').hidden) { proxima = 0; $('prox').textContent = seg ? '' : 'atualização automática desligada'; return; }
  proxima = Date.now() + seg * 1000;
  timer = setTimeout(atualizar, seg * 1000);
  const mostra = () => $('prox').textContent = `próxima em ${Math.max(0, Math.ceil((proxima - Date.now()) / 1000))} s`;
  mostra(); tick = setInterval(mostra, 1000);
}

async function atualizar() {
  if (emCurso) return;
  emCurso = true; $('btn').disabled = true; $('btn').classList.add('girando');
  $('diaSeg').disabled = $('dia').value >= hoje();
  $('dot').className = 'dot load'; $('st').textContent = 'consultando…';
  try {
    if (aba === 'ger') {
      const r = await fetch('/api/geracao?sub=Norte', { credentials: 'same-origin' });
      const d = await r.json().catch(() => ({}));
      if (r.status === 401) { emCurso = false; $('btn').disabled = false; $('btn').classList.remove('girando'); return mostrarLogin(d.erro || 'Sessão expirada. Entre de novo.'); }
      if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`);
      desenharGer(d);
      $('erro').hidden = true;
      $('dot').className = 'dot'; $('st').textContent = `Em dia (${d.latencia_ms} ms)`;
      $('consulta').textContent = `consultado às ${new Date(d.consultado_em).toLocaleTimeString('pt-BR')}`;
      $('regs').textContent = 'fonte: ONS, conjuntos Geracao_Norte_*_json e Carga_Norte_json';
      return;
    }
    if (aba === 'cruz') {
      const pega = async url => {
        const r = await fetch(url, { credentials: 'same-origin' });
        const d = await r.json().catch(() => ({}));
        if (r.status === 401) throw Object.assign(new Error(d.erro || 'Sessão expirada. Entre de novo.'), { sessao: true });
        if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`);
        return d;
      };
      let ger, car;
      try { [ger, car] = await Promise.all([pega('/api/geracao?sub=Norte'), pega(`/api/carga?regiao=AM_AP_RR&dia=${hoje()}`)]); }
      catch (e) { if (!e.sessao) throw e; emCurso = false; $('btn').disabled = false; $('btn').classList.remove('girando'); return mostrarLogin(e.message); }
      const regs = desenharCruz(ger, car);
      $('erro').hidden = true;
      $('dot').className = 'dot'; $('st').textContent = `Em dia (${Math.max(ger.latencia_ms, car.latencia_ms)} ms)`;
      $('consulta').textContent = `consultado às ${new Date(ger.consultado_em).toLocaleTimeString('pt-BR')}`;
      $('regs').textContent = `semi-horas com os dois dados: ${regs}`;
      return;
    }
    const reg = ['AM', 'AP', 'RR'].includes(visao) ? visao : 'AM_AP_RR';
    const q = `regiao=${reg}&dia=${$('dia').value}` + (visao === 'areas' ? '&separado=1' : '');
    const r = await fetch('/api/carga?' + q, { credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { emCurso = false; $('btn').disabled = false; $('btn').classList.remove('girando'); return mostrarLogin(d.erro || 'Sessão expirada. Entre de novo.'); }
    if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`);
    if (d.por_area) for (const [cod, x] of Object.entries(d.por_area)) desenhar(cod, x);
    else desenhar(visao === 'soma' ? 'SOMA' : visao, d);
    $('erro').hidden = true;
    $('dot').className = 'dot'; $('st').textContent = `Em dia (${d.latencia_ms} ms)`;
    $('consulta').textContent = `consultado às ${new Date(d.consultado_em).toLocaleTimeString('pt-BR')}`;
    const regs = d.por_area ? Object.fromEntries(Object.entries(d.por_area).map(([a, x]) => [a, x.registros])) : d.registros;
    $('regs').textContent = 'registros (medida/programada): ' + Object.entries(regs || {}).map(([a, n]) => `${a} ${n.verificada}/${n.prevista}`).join(' · ');
  } catch (e) {
    $('dot').className = 'dot err'; $('st').textContent = 'Falhou';
    $('erro').textContent = e.message; $('erro').hidden = false;
  } finally {
    emCurso = false; $('btn').disabled = false; $('btn').classList.remove('girando'); agendar();
  }
}

function desenhar(cod, d) {
  const g = graficos[cod]; if (!g) return;
  const el = document.querySelector(`.area[data-area="${cod}"]`);
  const pts = (d.serie || []).map(p => ({ ...p, x: new Date(p.instante).getTime() }));
  CURVAS.forEach((c, i) => { g.data.datasets[i].data = pts.filter(p => p[c.chave] != null).map(p => ({ x: p.x, y: p[c.chave] })); });

  // limites do dia inteiro; o zoom do usuário é mantido entre atualizações
  const ini = new Date(`${$('dia').value}T00:00:00-03:00`).getTime();
  const x = g.options.scales.x;
  if (!isNaN(ini)) {
    const novoDia = x.min !== undefined && (g.$ini !== ini);
    g.$ini = ini;
    if (g.options.plugins?.zoom) g.options.plugins.zoom.limits.x = { min: ini, max: ini + 864e5, minRange: 3600e3 };
    const z = g.isZoomedOrPanned && g.isZoomedOrPanned() && !novoDia;
    if (novoDia && g.resetZoom) g.resetZoom('none');
    if (!z) { x.min = ini; x.max = ini + 864e5; }
  }
  g.update('none');

  const u = d.ultimo;
  const prevU = u ? (u.prevista ?? pts.find(p => p.instante === u.instante)?.prevista) : null;
  const v = {
    medida: fmt(u?.medida), mmgd: fmt(u?.mmgd), com_mmgd: fmt(u?.com_mmgd), prevista: fmt(prevU),
    d_prog: u && prevU != null ? fmtS(u.medida - prevU) : '–',
    d_mmgd: u && u.com_mmgd != null ? fmtS(u.com_mmgd - u.medida) : '–',
  };
  for (const [k, t] of Object.entries(v)) el.querySelector(`[data-m="${k}"]`).textContent = t;
  el.querySelector('.ref').textContent = u ? `Referência: ${hora(u.instante)} de ${new Date(u.instante).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : 'Sem dado medido neste dia.';
}

verificar().catch(e => mostrarLogin('Não consegui falar com o servidor: ' + e.message));
