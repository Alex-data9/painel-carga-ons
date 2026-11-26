const $ = id => document.getElementById(id);
const fmt = n => n == null ? '–' : Math.round(n).toLocaleString('pt-BR') + ' MW';
const hora = iso => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
const hoje = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);   // dia em Brasília
const css = v => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const NOTAS = {
  AM_AP_RR: 'Soma das áreas de carga AM, AP e RR do ONS. Um horário só entra na soma quando as três áreas têm o dado.',
  AM: 'Área de carga AM (Amazonas) do ONS.',
  AP: 'Área de carga AP (Amapá) do ONS.',
  RR: 'Área de carga RR (Roraima) do ONS. Roraima foi interligado ao SIN recentemente; dias antigos podem vir sem dado.',
  N: 'Subsistema Norte inteiro (inclui AM, AP, RR, PA, MA, TO), só para referência.',
};

let chart, timer, tick, proxima = 0, emCurso = false, iniciado = false;
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
  $('btnEntrar').textContent = corpo.demo ? 'Entrar' : 'Autenticando no ONS…';
  try { await postJson('/api/login', corpo); $('senha').value = ''; await verificar(); }
  catch (e) { $('erroLogin').textContent = e.message; $('erroLogin').hidden = false; }
  finally { $('btnEntrar').disabled = $('btnDemo').disabled = false; $('btnEntrar').textContent = 'Entrar'; }
}

$('formLogin').onsubmit = ev => { ev.preventDefault(); entrar({ usuario: $('usuario').value, senha: $('senha').value }); };
$('btnDemo').onclick = () => entrar({ demo: true });
$('sair').onclick = async () => { try { await postJson('/api/logout'); } catch {} mostrarLogin(); };

function mostrarPainel(s) {
  $('telaLogin').hidden = true; $('telaPainel').hidden = false;
  const real = s.modo === 'real';
  $('badge').textContent = real ? 'API ONS' : 'SIMULADO';
  $('badge').className = 'badge ' + (real ? 'real' : 'sim');
  $('aviso').hidden = real;
  $('usr').textContent = s.usuario;
  if (!iniciado) {
    iniciado = true;
    s.regioes.forEach(r => $('regiao').add(new Option(r.nome, r.id)));
    const salvo = lido('regiao');
    $('regiao').value = salvo && s.regioes.some(r => r.id === salvo) ? salvo : s.padrao;
    $('dia').value = hoje(); $('dia').max = hoje();
    $('intervalo').value = lido('intervalo') ?? '60';
    criarGrafico();
    $('btn').onclick = () => atualizar();
    $('regiao').onchange = () => { lembrar('regiao', $('regiao').value); atualizar(); };
    $('dia').onchange = () => atualizar();
    $('intervalo').onchange = () => { lembrar('intervalo', $('intervalo').value); agendar(); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden && proxima && Date.now() > proxima) atualizar(); });
  }
  atualizar();
}

function criarGrafico() {
  if (!window.Chart) { $('erro').textContent = 'Biblioteca de gráficos não carregou (cdn.jsdelivr.net). Os números continuam funcionando.'; $('erro').hidden = false; chart = { data: { datasets: [{}, {}] }, options: { scales: { x: { ticks: {} } } }, update() {} }; return; }
  chart = new Chart($('graf'), {
    type: 'line',
    data: { datasets: [
      { label: 'Verificada', data: [], borderColor: css('--verif'), backgroundColor: css('--verif'), borderWidth: 2, pointRadius: 0, tension: .25 },
      { label: 'Prevista (programada)', data: [], borderColor: css('--prev'), backgroundColor: css('--prev'), borderWidth: 2, borderDash: [6, 4], pointRadius: 0, tension: .25 },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'index', intersect: false },
      scales: {
        x: { type: 'linear', ticks: { color: css('--mut'), callback: v => hora(v), maxTicksLimit: 12 }, grid: { color: css('--brd') } },
        y: { ticks: { color: css('--mut'), callback: v => v.toLocaleString('pt-BR') }, grid: { color: css('--brd') }, title: { display: true, text: 'MW', color: css('--mut') } },
      },
      plugins: {
        legend: { labels: { color: css('--txt') } },
        tooltip: { callbacks: { title: i => hora(i[0].parsed.x), label: i => `${i.dataset.label}: ${fmt(i.parsed.y)}` } },
      },
    },
  });
}

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
  emCurso = true; $('btn').disabled = true;
  $('notaReg').textContent = NOTAS[$('regiao').value] || '';
  $('dot').className = 'dot load'; $('st').textContent = 'consultando…';
  try {
    const r = await fetch(`/api/carga?regiao=${encodeURIComponent($('regiao').value)}&dia=${$('dia').value}`, { credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { emCurso = false; $('btn').disabled = false; return mostrarLogin(d.erro || 'Sessão expirada. Entre de novo.'); }
    if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`);
    desenhar(d);
    $('erro').hidden = true;
    $('dot').className = 'dot'; $('st').textContent = `ok (${d.latencia_ms} ms)`;
  } catch (e) {
    $('dot').className = 'dot err'; $('st').textContent = 'falhou';
    $('erro').textContent = e.message; $('erro').hidden = false;
  } finally {
    emCurso = false; $('btn').disabled = false; agendar();
  }
}

function desenhar(d) {
  const pts = d.serie.map(p => ({ ...p, x: new Date(p.instante).getTime() }));
  chart.data.datasets[0].data = pts.filter(p => p.verificada != null).map(p => ({ x: p.x, y: p.verificada }));
  chart.data.datasets[1].data = pts.filter(p => p.prevista != null).map(p => ({ x: p.x, y: p.prevista }));
  const x = chart.options.scales.x;
  if (pts.length) { x.min = pts[0].x; x.max = pts.at(-1).x; x.ticks.stepSize = 3 * 3600e3; } else { x.min = x.max = undefined; }
  chart.update();

  const u = d.ultimo;
  const prevU = u ? pts.find(p => p.instante === u.instante)?.prevista : null;
  $('kV').textContent = fmt(u?.verificada);
  $('kVt').textContent = u ? `às ${hora(u.instante)}` : 'sem dado verificado';
  $('kP').textContent = fmt(prevU);
  if (u && prevU != null) {
    const dif = u.verificada - prevU, pct = dif / prevU * 100;
    $('kD').textContent = `${dif >= 0 ? '+' : ''}${Math.round(dif).toLocaleString('pt-BR')} MW (${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%)`;
  } else $('kD').textContent = '–';
  const vs = pts.filter(p => p.verificada != null);
  const pico = vs.reduce((a, b) => (!a || b.verificada > a.verificada) ? b : a, null);
  $('kM').textContent = fmt(pico?.verificada);
  $('kMt').textContent = pico ? `às ${hora(pico.instante)}` : '–';
  $('consulta').textContent = `consultado às ${new Date(d.consultado_em).toLocaleTimeString('pt-BR')}`;
  $('regs').textContent = 'registros: ' + Object.entries(d.registros).map(([a, n]) => `${a} ${n.verificada}/${n.prevista}`).join(' · ') + ' (verif./prev.)';
}

verificar().catch(e => mostrarLogin('Não consegui falar com o servidor: ' + e.message));
