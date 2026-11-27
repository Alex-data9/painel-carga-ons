const $ = id => document.getElementById(id);
const num = n => Math.round(n).toLocaleString('pt-BR');
const fmt = n => n == null ? '–' : num(n) + ' MW';
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
const CURTO = { AM_AP_RR: 'AM + AP + RR', AM: 'Amazonas', AP: 'Amapá', RR: 'Roraima', N: 'Norte (ref.)' };

let chart, timer, tick, proxima = 0, emCurso = false, iniciado = false, regiao = '';
function lembrar(k, v) { try { localStorage.setItem('painel-' + k, v) } catch {} }
function lido(k) { try { return localStorage.getItem('painel-' + k) } catch { return null } }

// Mostra "1.234 MW" com a unidade menor, sem innerHTML.
function valor(el, n, sufixo = 'MW', sinal = false) {
  el.classList.remove('carregando');
  el.textContent = '';
  if (n == null) { el.textContent = '–'; return; }
  el.append((sinal && n >= 0 ? '+' : '') + num(n));
  const u = document.createElement('span'); u.className = 'un'; u.textContent = sufixo; el.append(u);
}

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
$('sair').onclick = async () => { try { await postJson('/api/logout'); } catch {} mostrarLogin(); };

function montarRegioes(lista, atual) {
  const fs = $('regiao');
  lista.forEach((r, i) => {
    if (r.id === 'N' && i > 0) { const s = document.createElement('span'); s.className = 'sep'; s.setAttribute('aria-hidden', 'true'); fs.append(s); }
    const inp = document.createElement('input');
    inp.type = 'radio'; inp.name = 'regiao'; inp.id = 'reg-' + r.id; inp.value = r.id; inp.checked = r.id === atual;
    const lab = document.createElement('label');
    lab.htmlFor = inp.id; lab.textContent = CURTO[r.id] || r.nome; lab.title = r.nome;
    inp.onchange = () => { regiao = inp.value; lembrar('regiao', regiao); atualizar(); };
    fs.append(inp, lab);
  });
  regiao = atual;
}

function mostrarPainel(s) {
  $('telaLogin').hidden = true; $('telaPainel').hidden = false;
  const real = s.modo === 'real';
  $('badge').textContent = real ? 'API ONS' : 'Demonstração';
  $('badge').className = 'badge ' + (real ? 'real' : 'sim');
  $('aviso').hidden = real;
  $('usr').textContent = s.usuario;
  if (!iniciado) {
    iniciado = true;
    const salvo = lido('regiao');
    montarRegioes(s.regioes, salvo && s.regioes.some(r => r.id === salvo) ? salvo : s.padrao);
    $('dia').value = hoje(); $('dia').max = hoje();
    $('intervalo').value = lido('intervalo') ?? '60';
    criarGrafico();
    $('btn').onclick = () => atualizar();
    $('dia').onchange = () => atualizar();
    $('intervalo').onchange = () => { lembrar('intervalo', $('intervalo').value); agendar(); };
    document.addEventListener('visibilitychange', () => { if (!document.hidden && proxima && Date.now() > proxima) atualizar(); });
  }
  atualizar();
}

function criarGrafico() {
  if (!window.Chart) { $('erro').textContent = 'Biblioteca de gráficos não carregou (cdn.jsdelivr.net). Os números continuam funcionando.'; $('erro').hidden = false; chart = { data: { datasets: [{}, {}] }, options: { scales: { x: { ticks: {} } } }, update() {} }; return; }
  Chart.defaults.font.family = css('--fonte');
  Chart.defaults.font.size = 12;
  const verif = css('--verif'), prev = css('--prev'), mut = css('--mut'), borda = css('--borda');
  const preench = ctx => {
    const a = ctx.chart.chartArea; if (!a) return 'transparent';
    const g = ctx.chart.ctx.createLinearGradient(0, a.top, 0, a.bottom);
    g.addColorStop(0, verif + '33'); g.addColorStop(1, verif + '00');
    return g;
  };
  chart = new Chart($('graf'), {
    type: 'line',
    data: { datasets: [
      { label: 'Verificada', data: [], borderColor: verif, backgroundColor: preench, fill: 'origin', borderWidth: 2.5, pointRadius: 0, pointHoverRadius: 4, pointHoverBackgroundColor: verif, tension: .3 },
      { label: 'Prevista', data: [], borderColor: prev, backgroundColor: prev, borderWidth: 2, borderDash: [6, 5], pointRadius: 0, pointHoverRadius: 4, tension: .3 },
    ]},
    options: {
      responsive: true, maintainAspectRatio: false, animation: false, parsing: false,
      interaction: { mode: 'index', intersect: false },
      layout: { padding: { top: 4, right: 4 } },
      scales: {
        x: { type: 'linear', ticks: { color: mut, callback: v => hora(v), maxRotation: 0 }, grid: { display: false }, border: { color: borda },
             afterBuildTicks: ax => {   // marcas a cada 3 h (a cada 6 h em telas estreitas), em horas cheias
               const passo = (ax.width < 500 ? 6 : 3) * 3600e3, t = [];
               for (let v = ax.min; v <= ax.max; v += passo) t.push({ value: v });
               ax.ticks = t;
             } },
        y: { grace: '8%', ticks: { color: mut, callback: v => v.toLocaleString('pt-BR'), maxTicksLimit: 6 }, grid: { color: borda }, border: { display: false },
             title: { display: true, text: 'MW', color: mut, font: { weight: '600' } } },
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          backgroundColor: '#062f31', titleColor: '#fff', bodyColor: '#dceeef', padding: 10, cornerRadius: 8, boxPadding: 4, usePointStyle: true,
          titleFont: { weight: '700' },
          callbacks: { title: i => hora(i[0].parsed.x), label: i => ` ${i.dataset.label}: ${fmt(i.parsed.y)}` },
        },
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
  emCurso = true; $('btn').disabled = true; $('btn').classList.add('girando');
  $('notaReg').textContent = NOTAS[regiao] || '';
  const d0 = new Date($('dia').value + 'T12:00:00');
  $('diaTxt').textContent = isNaN(d0) ? '' : d0.toLocaleDateString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short' });
  $('dot').className = 'dot load'; $('st').textContent = 'consultando…';
  try {
    const r = await fetch(`/api/carga?regiao=${encodeURIComponent(regiao)}&dia=${$('dia').value}`, { credentials: 'same-origin' });
    const d = await r.json().catch(() => ({}));
    if (r.status === 401) { emCurso = false; $('btn').disabled = false; $('btn').classList.remove('girando'); return mostrarLogin(d.erro || 'Sessão expirada. Entre de novo.'); }
    if (!r.ok) throw new Error(d.erro || `HTTP ${r.status}`);
    desenhar(d);
    $('erro').hidden = true;
    $('dot').className = 'dot'; $('st').textContent = `Em dia (${d.latencia_ms} ms)`;
  } catch (e) {
    $('dot').className = 'dot err'; $('st').textContent = 'Falhou';
    $('erro').textContent = e.message; $('erro').hidden = false;
    document.querySelectorAll('.v.carregando').forEach(el => { el.classList.remove('carregando'); el.textContent = '–'; });
  } finally {
    emCurso = false; $('btn').disabled = false; $('btn').classList.remove('girando'); agendar();
  }
}

function desenhar(d) {
  const pts = d.serie.map(p => ({ ...p, x: new Date(p.instante).getTime() }));
  chart.data.datasets[0].data = pts.filter(p => p.verificada != null).map(p => ({ x: p.x, y: p.verificada }));
  chart.data.datasets[1].data = pts.filter(p => p.prevista != null).map(p => ({ x: p.x, y: p.prevista }));
  const x = chart.options.scales.x;
  const ini = new Date(`${$('dia').value}T00:00:00-03:00`).getTime();   // o dia inteiro, 00h às 24h de Brasília
  if (!isNaN(ini)) { x.min = ini; x.max = ini + 24 * 3600e3; } else if (pts.length) { x.min = pts[0].x; x.max = pts.at(-1).x; } else { x.min = x.max = undefined; }
  chart.update();

  const u = d.ultimo;
  const prevU = u ? pts.find(p => p.instante === u.instante)?.prevista : null;
  valor($('kV'), u?.verificada);
  $('kVt').textContent = u ? `às ${hora(u.instante)}` : 'sem dado verificado';
  valor($('kP'), prevU);
  const chip = $('kDp');
  if (u && prevU != null) {
    const dif = u.verificada - prevU, pct = dif / prevU * 100;
    valor($('kD'), dif, 'MW', true);
    chip.textContent = `${pct >= 0 ? '+' : ''}${pct.toFixed(1).replace('.', ',')}%`;
    chip.className = 'chip ' + (dif >= 0 ? 'acima' : 'abaixo');
  } else { valor($('kD'), null); chip.textContent = '–'; chip.className = 'chip'; }
  const vs = pts.filter(p => p.verificada != null);
  const pico = vs.reduce((a, b) => (!a || b.verificada > a.verificada) ? b : a, null);
  valor($('kM'), pico?.verificada);
  $('kMt').textContent = pico ? `às ${hora(pico.instante)}` : '–';
  $('consulta').textContent = `consultado às ${new Date(d.consultado_em).toLocaleTimeString('pt-BR')}`;
  $('regs').textContent = 'registros (verif./prev.): ' + Object.entries(d.registros).map(([a, n]) => `${a} ${n.verificada}/${n.prevista}`).join(' · ');
}

verificar().catch(e => mostrarLogin('Não consegui falar com o servidor: ' + e.message));
