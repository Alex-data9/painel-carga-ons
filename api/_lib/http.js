function json(res, status, obj) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(obj));
}

// Barreira simples contra CSRF: além do cookie SameSite=Strict, exige
// requisição JSON vinda da própria origem.
function mesmaOrigem(req) {
  const origem = req.headers.origin;
  if (!origem) return true;
  try { return new URL(origem).host === req.headers.host; } catch { return false; }
}

async function corpoJson(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return {};
}

module.exports = { json, mesmaOrigem, corpoJson };
