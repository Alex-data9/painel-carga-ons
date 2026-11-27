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

## Painel
- Três gráficos lado a lado (Amazonas, Amapá, Roraima), um estado em foco (botão Focar ou seletor) ou a soma AM + AP + RR.
- Botão Recolher em cada estado (e "Recolher todas as informações") esconde os cartões e deixa só o gráfico; a escolha fica salva no navegador.
- Curvas: carga medida (`val_cargaglobalsmmg`, líquida de MMGD), carga com MMGD (`val_cargaglobal`) e carga programada; cartões com MMGD (`val_cargammgd`), Δ medida − programada e Δ com MMGD − medida.
- Zoom: arrastar sobre o gráfico, Ctrl + roda, pinça no celular, botões + / − / Dia inteiro (sincronizado entre os três, opcional). Shift + arrastar move a janela.
- Tema: botão sol/lua no topo alterna modo claro e escuro (verde-petróleo); sem escolha salva, segue o tema do sistema (`tema.js`).
- Medição de Δ: clique em dois pontos do mesmo gráfico (podem ser de curvas diferentes).
- Aba **Geração Norte**: geração hidráulica, térmica, eólica e solar (áreas empilhadas ou linhas) e a carga do subsistema Norte, minuto a minuto, só o dia de hoje. `GET /api/geracao?sub=Norte` busca no servidor os conjuntos públicos do ONS `Geracao_Norte_<Fonte>_json` e `Carga_Norte_json` (em `https://tr.ons.org.br/Content/Get/…`, sem token; HTTP 204 = fonte sem usina, ex.: nuclear), com cache de 60 s. Para outro subsistema (SIN, Nordeste, SudesteECentroOeste, Sul), acrescente-o em `SUBSISTEMAS` em `api/geracao.js`.
- Aba **Cruzamento** (só hoje): junta `/api/geracao?sub=Norte` e `/api/carga?regiao=AM_AP_RR` no navegador. A geração e a carga do Norte (por minuto) viram médias de cada semi-hora `[t, t + 30 min)` (só com 20 minutos ou mais) e são casadas com o instante `t` da carga verificada. Mostra a geração do Norte empilhada com a carga do Norte e a carga medida de AM + AP + RR, e um gráfico em % com a participação dos três estados na carga do Norte e a cobertura térmica (térmica do Norte ÷ carga dos três estados; é um indicador, não a origem da energia). Cartões: carga dos três estados, participação, cobertura térmica, saldo do Norte (geração − carga) e o saldo no pico dos três estados.
- `GET /api/carga?regiao=AM_AP_RR&dia=AAAA-MM-DD&separado=1` devolve uma série por área.

## Regiões
Os dicionários de dados do ONS (Carga Verificada e Carga Programada) listam AM, AP e RR como áreas de carga (`cod_areacarga`).
A opção "soma" junta as três por horário, só quando as três têm o dado.

## Arquivos
- `index.html`, `app.js`, `estilo.css`: tela de login e painel (fonte Manrope local em `fonts/`; logo e foto de usina da Eneva em `img/`)
- `api/login.js`, `api/logout.js`, `api/sessao.js`, `api/carga.js`: funções serverless (Node 22, sem dependências)
- `api/_lib/`: sessão em cookie, cliente da API do ONS, lista de regiões
- `vercel.json`: região gru1 (São Paulo) e cabeçalhos de segurança

## Variáveis de ambiente
| Variável | Obrigatória | Para quê |
|---|---|---|
| `SESSION_SECRET` | sim | chave do cookie (32+ caracteres aleatórios) |
| `ONS_BASE_URL` | não | padrão `https://integra.ons.org.br/api` |
