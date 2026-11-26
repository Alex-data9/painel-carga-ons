# Painel de Carga ONS na Vercel

URL: https://painel-carga-ons.vercel.app (projeto Vercel `painel-carga-ons`, conta alex-data9)

## Uso
1. Abra a URL e entre com usuário e senha do SINtegre (precisa do sistema APIAvaliacaoOperacao liberado em "Meus Sistemas").
2. Escolha a região: Amazonas + Amapá + Roraima (soma), Amazonas, Amapá, Roraima ou Subsistema Norte (referência), e o dia.
3. Atualiza sozinho a cada 1 min (ou 5 min / desligado). "Sair" apaga a sessão.
Sem login: botão "Ver demonstração" mostra dados SIMULADOS.

## Segurança
- A senha só passa pela função `api/login.js` para o `POST /autenticar` do ONS; não é gravada nem registrada em log.
- O cookie (`ons_sess0..3`) é httpOnly, Secure, SameSite=Strict e guarda só access/refresh token, criptografado com AES-256-GCM.
  Chave: variável de ambiente `SESSION_SECRET` (tipo sensitive). Trocar essa variável derruba todas as sessões.
- Sessão dura no máximo 8 h; o token é renovado via `/renovar` automaticamente.

## Regiões
Os dicionários de dados do ONS (Carga Verificada e Carga Programada) listam AM, AP e RR como áreas de carga (`cod_areacarga`).
A opção "soma" junta as três por horário, só quando as três têm o dado.

## Arquivos
- `index.html`, `app.js`: tela de login e painel
- `api/login.js`, `api/logout.js`, `api/sessao.js`, `api/carga.js`: funções serverless (Node 22, sem dependências)
- `api/_lib/`: sessão em cookie, cliente da API do ONS, lista de regiões
- `vercel.json`: região gru1 (São Paulo) e cabeçalhos de segurança

## Variáveis de ambiente
| Variável | Obrigatória | Para quê |
|---|---|---|
| `SESSION_SECRET` | sim | chave do cookie (32+ caracteres aleatórios) |
| `ONS_BASE_URL` | não | padrão `https://integra.ons.org.br/api` |
