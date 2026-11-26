const sessao = require('./_lib/sessao');
const { json } = require('./_lib/http');
const { REGIOES, PADRAO } = require('./_lib/regioes');

module.exports = (req, res) => {
  let s;
  try { s = sessao.ler(req); } catch (e) { return json(res, 500, { erro: e.message }); }
  if (!s) return json(res, 200, { logado: false });
  json(res, 200, {
    logado: true, modo: s.modo, usuario: s.u,
    regioes: Object.entries(REGIOES).map(([id, r]) => ({ id, nome: r.nome })),
    padrao: PADRAO,
  });
};
