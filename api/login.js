const { autenticar } = require('./_lib/ons');
const sessao = require('./_lib/sessao');
const { json, mesmaOrigem, corpoJson } = require('./_lib/http');

module.exports = async (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { erro: 'use POST' });
  if (!mesmaOrigem(req) || !(req.headers['content-type'] || '').includes('application/json')) {
    return json(res, 403, { erro: 'origem não permitida' });
  }
  const b = await corpoJson(req);
  const criada = Math.floor(Date.now() / 1000);

  // Modo demonstração: sem falar com o ONS, dados simulados e marcados na tela.
  if (b.demo === true) {
    sessao.gravar(res, { modo: 'simulado', u: 'demonstração', criada });
    return json(res, 200, { ok: true, modo: 'simulado' });
  }

  const usuario = typeof b.usuario === 'string' ? b.usuario.trim() : '';
  const senha = typeof b.senha === 'string' ? b.senha : '';
  if (!usuario || !senha || usuario.length > 200 || senha.length > 200) {
    return json(res, 400, { erro: 'Informe usuário e senha.' });
  }
  try {
    const t = await autenticar(usuario, senha);   // a senha só é usada aqui e descartada
    sessao.gravar(res, { modo: 'real', u: usuario, criada, ...t });
    return json(res, 200, { ok: true, modo: 'real' });
  } catch (e) {
    // nunca registrar usuário/senha em log
    console.error('login falhou:', e.status || '', e.message);
    return json(res, e.status === 401 ? 401 : 502, { erro: e.message });
  }
};
