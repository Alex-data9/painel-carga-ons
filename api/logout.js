const sessao = require('./_lib/sessao');
const { json, mesmaOrigem } = require('./_lib/http');

module.exports = (req, res) => {
  if (req.method !== 'POST') return json(res, 405, { erro: 'use POST' });
  if (!mesmaOrigem(req)) return json(res, 403, { erro: 'origem não permitida' });
  sessao.apagar(res);
  json(res, 200, { ok: true });
};
