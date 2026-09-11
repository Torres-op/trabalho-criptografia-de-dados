# msgenc — Mensagens Criptografadas

Aplicativo de mensagens criptografadas entre **dois usuários fixos**. A mensagem é comprimida com uma árvore de Huffman e cifrada no navegador; o resultado vira um arquivo `.msgenc` que o remetente entrega ao destinatário por pen-drive, WhatsApp ou e-mail. O destinatário abre o arquivo no tradutor e lê o texto original.

**O servidor nunca vê texto puro nem chaves privadas.** Ele guarda apenas blobs cifrados e chaves públicas.

---

## Estado atual

| Épico | Situação |
|---|---|
| 0, 1 — esqueleto e infraestrutura | ✅ |
| 2 — autenticação e os 2 usuários fixos | ✅ |
| 3 — compressão com Huffman | ✅ |
| 4 — chaves ECDH, HKDF e AES-GCM | ✅ |
| 7 — fluxo de envio | ✅ |

A compressão e a cifragem são **reais**. O fluxo completo funciona: cada usuário gera o próprio par de chaves no primeiro acesso, o servidor distribui as chaves públicas, e o arquivo gerado por um só abre no navegador do outro.

⚠️ **Ainda não há verificação de fingerprint (Épico 11).** Até lá, quem controlar o servidor pode entregar uma chave falsa no primeiro acesso. Não use para nada realmente sensível.

---

## Começando

Só é preciso ter **Docker** e **Git** instalados. Nada de Python, Node ou Postgres na máquina.

```bash
git clone <url-do-repo>
cd projeto_criptografia
cp .env.example .env
docker compose build
docker compose run --rm web python manage.py migrate
docker compose run --rm web python manage.py seed_users
docker compose up
```

Abra **http://localhost:8000**.

Os dois usuários do sistema são os definidos em `SEED_USER_A`/`SEED_PASS_A` e `SEED_USER_B`/`SEED_PASS_B` no `.env`. Para o `/admin/`, crie um superusuário à parte com `createsuperuser` — ele não participa das conversas.

> Se a porta 8000 já estiver ocupada, ajuste `WEB_PORT` no seu `.env`. Não edite o `docker-compose.yml`.

**Acesse sempre por `localhost` ou `127.0.0.1`** — nunca pelo IP da rede. A Web Crypto API só funciona em contexto seguro, e fora dele o app quebra inteiro.

Guia completo, comandos do dia a dia e troubleshooting em **[`docs/infraestrutura.md`](docs/infraestrutura.md)**.

## Testes

```bash
docker compose run --rm js npm test                    # JS (Vitest)
docker compose run --rm web python manage.py test      # Django
```

## Testar os 2 usuários numa máquina só

Use duas origens diferentes — o navegador as trata como dispositivos distintos, com cookies e IndexedDB separados:

| Usuário | URL |
|---|---|
| `SEED_USER_A` | `http://localhost:8000` |
| `SEED_USER_B` | `http://127.0.0.1:8000` |

Entre com um usuário em cada aba. Assim que os dois tiverem aberto o app uma vez, a troca de chaves acontece sozinha. Use sempre a **mesma origem para o mesmo usuário**: cada origem tem o próprio IndexedDB, e entrar pela origem errada gera um par novo, que o servidor recusa.

---

## Estrutura

```
core/                      projeto Django (settings, urls, test_runner)
messenger/                 app principal
  models.py                Profile e Message
  participants.py          os 2 participantes e o sender_id
  api.py                   endpoints de chave pública e de histórico
  jwk.py                   validação e forma canônica da chave pública
  message_format.py        leitura do cabeçalho .msgenc no servidor
  admin.py
  tests/                   suíte Django
  templates/messenger/     compose, translator, login
  static/messenger/js/
    frequency-table.js     tabela de frequência (gerada)
    huffman-codebook.js    códebook canônico
    huffman.js             compressão
    crypto.js              ECDH + HKDF + AES-GCM
    keys.js                ciclo de vida das chaves
    keystore.js            IndexedDB, separado por usuário
    format.js              formato binário .msgenc
    api.js                 chamadas ao servidor
    app.js                 pipeline e sessão
    environment.js         guarda de contexto seguro
    ui.js, compose.js, translator.js
tests/                     suíte Vitest
tools/                     gerador da tabela de frequência e corpus
docs/                      backlog, infraestrutura e convenções
```

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/backlog-detalhado.md`](docs/backlog-detalhado.md) | O plano completo: 18 épicos e as decisões travadas **D1**–**D13** |
| [`docs/infraestrutura.md`](docs/infraestrutura.md) | Ambiente Docker, comandos, variáveis, troubleshooting |
| [`docs/convencoes.md`](docs/convencoes.md) | Convenções de código |

**Antes de escrever código, leia as decisões D1–D13** no início do backlog. Elas fixam o formato binário, os parâmetros de derivação de chave e o alfabeto do Huffman — coisas que precisam ser idênticas nos dois lados da comunicação. Divergir delas faz o app falhar silenciosamente.

## Convenções

- **Código em inglês, interface em português.** Identificadores, arquivos, rotas, campos de model e classes CSS em inglês; tudo que o usuário lê na tela em português, inclusive mensagens de erro e rótulos do Admin.
- **Código sem comentários.** A explicação vive em `docs/`.
- Detalhes em [`docs/convencoes.md`](docs/convencoes.md).

## Stack

Django 5.2 · PostgreSQL 16 · JavaScript sem framework (ES Modules + Web Crypto API) · Docker Compose · Vitest
