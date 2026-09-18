# Treehash — Mensagens Criptografadas

Aplicativo de mensagens criptografadas entre **dois usuários fixos**. A mensagem é comprimida com uma árvore de Huffman e cifrada no navegador; o resultado vira um arquivo `.treehash` que o remetente entrega ao destinatário por pen-drive, WhatsApp ou e-mail. O destinatário abre o arquivo no tradutor e lê o texto original.

**O servidor nunca vê texto puro nem chaves privadas.** Ele guarda apenas blobs cifrados e chaves públicas.

---

## Estado atual

| Épico | Situação |
|---|---|
| 0, 1 — esqueleto e infraestrutura | ✅ |
| 2 — autenticação e os 2 usuários fixos | ✅ |
| 3 — compressão com Huffman | ✅ |
| 4 — chaves ECDH, HKDF e AES-GCM | ✅ |
| 5 — formato do arquivo e bloco armored | ✅ |
| 6 — API de histórico | ✅ |
| 7 — fluxo de envio | ✅ |
| 8 — compartilhamento | ✅ |
| 9 — tradutor | ✅ |
| 10 — histórico | ✅ |
| 11 — identidade e backup de chave | parcial: falta 11.7 |
| 12 — interface e UX | ✅ |
| 13 — segurança e hardening | ✅ |
| 14 — testes e qualidade | parcial: 14.6 e 14.8 são manuais |
| 15 — documentação | parcial: falta a comparação com gzip (17.2) |

A compressão e a cifragem são **reais**. O fluxo completo funciona: cada usuário gera o próprio par de chaves no primeiro acesso, o servidor distribui as chaves públicas, e o arquivo gerado por um só abre no navegador do outro.

⚠️ **A verificação de identidade existe, mas depende de você.** A tela **Identidade** mostra o código de segurança das duas chaves; enquanto você não comparar os códigos com a outra pessoa por um canal fora do app, um servidor comprometido ainda pode ter entregado uma chave falsa no primeiro acesso. O modelo de ameaça completo está em [`docs/SEGURANCA.md`](docs/SEGURANCA.md).

---

## Como a mensagem viaja

```
ENVIO — no navegador de quem escreve

    texto digitado
        │
        ▼  Huffman          comprime (ou passa direto, quando comprimir aumentaria)
        │
        ▼  AES-256-GCM      cifra e autentica
        │
        ▼
    TRHS │ versão │ flags │ remetente │ data │ IV │ conteúdo cifrado + tag
        │
        ├──► arquivo .treehash
        └──► bloco -----BEGIN TREEHASH-----

             WhatsApp · e-mail · pen-drive · o que for mais prático


RECEBIMENTO — no navegador de quem lê

    arquivo aberto ou bloco colado
        │
        ▼  AES-256-GCM      verifica a autenticação e decifra
        │                   (se alguém mexeu no arquivo, falha aqui)
        ▼  Huffman          descomprime
        │
        ▼
    texto original
```

A chave que cifra nunca trafega — cada lado a calcula sozinho:

```
    minha chave privada  +  chave pública da outra pessoa
              └───────── ECDH P-256 ─────────┘
                            │
                            ▼  HKDF-SHA256    salt = SHA-256 dos dois usernames
                            │                 info = treehash/v1/aes-gcm-256
                            ▼
                    AES-256-GCM — idêntica nos dois navegadores
```

O servidor faz duas coisas, e só: **distribui as chaves públicas** e **guarda os blobs cifrados** do histórico. Texto puro e chave privada nunca saem do navegador.

A compressão é separada da segurança: **Huffman comprime, AES-GCM protege**. A tabela de frequência está no repositório e é pública de propósito — ela não é segredo nenhum. O porquê está em [`docs/relatorio-tecnico.md`](docs/relatorio-tecnico.md).

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

Guia completo, comandos do dia a dia e troubleshooting em **[`docs/infraestrutura.md`](docs/infraestrutura.md)**. Se você acabou de entrar no projeto, comece pelo **[`docs/guia-da-equipe.md`](docs/guia-da-equipe.md)**; se você é um dos dois usuários do app, o seu guia é o **[`docs/primeiro-uso.md`](docs/primeiro-uso.md)**.

## Testes

```bash
docker compose run --rm js npm ci                      # uma vez: instala o Vitest
docker compose run --rm js npm test                    # JS (Vitest)
docker compose run --rm web python manage.py test      # Django
```

O `npm ci` só é necessário na primeira vez e quando o `package-lock.json` mudar. O app não depende dele: o Django serve o JavaScript direto, sem build.

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
core/                      projeto Django (settings, urls, middleware, test_runner)
messenger/                 app principal
  models.py                Profile e Message
  participants.py          os 2 participantes e o sender_id
  throttle.py              limite de tentativas de login
  api.py                   endpoints de chave pública e de histórico
  jwk.py                   validação e forma canônica da chave pública
  message_format.py        leitura do cabeçalho .treehash no servidor
  admin.py
  tests/                   suíte Django
  templates/messenger/     compose, translator, history, identity, login
  static/messenger/js/
    frequency-table.js     tabela de frequência (gerada)
    huffman-codebook.js    códebook canônico
    huffman.js             compressão
    crypto.js              ECDH + HKDF + AES-GCM
    keys.js                ciclo de vida das chaves
    fingerprint.js         código de segurança da chave pública
    key-backup.js          backup da chave privada cifrado por senha
    keystore.js            IndexedDB, separado por usuário
    format.js              formato binário .treehash
    armor.js               bloco de texto colável para WhatsApp e e-mail
    share.js               download, cópia, e-mail e compartilhamento nativo
    search-tree.js         árvore binária de busca dos caracteres
    tree-view.js           desenho da árvore no compositor
    api.js                 chamadas ao servidor
    history.js             tela de histórico: filtros, decifrar e baixar de novo
    identity.js            tela de identidade: fingerprint, backup e restauração
    badge.js               indicador de estado criptográfico no topo
    app.js                 pipeline e sessão
    environment.js         guarda de contexto seguro
    ui.js, compose.js, translator.js
tests/                     suíte Vitest
  vectors/                 chaves e arquivos de referência, versionados (14.9)
tools/                     geradores da tabela de frequência e dos vetores
docs/                      backlog, infraestrutura e convenções
```

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/backlog-detalhado.md`](docs/backlog-detalhado.md) | O plano completo: 18 épicos e as decisões travadas **D1**–**D13** |
| [`docs/formato.md`](docs/formato.md) | O formato `.treehash` byte a byte, com exemplo real e checklist para reimplementar |
| [`docs/infraestrutura.md`](docs/infraestrutura.md) | Ambiente Docker, comandos, variáveis, troubleshooting |
| [`docs/convencoes.md`](docs/convencoes.md) | Convenções de código |
| [`docs/roteiro-de-testes.md`](docs/roteiro-de-testes.md) | Os testes que não dá para automatizar: duas máquinas, adulteração e perda de chave |
| [`docs/SEGURANCA.md`](docs/SEGURANCA.md) | O que o sistema protege, o que **não** protege, e o limite da recuperação |
| [`docs/relatorio-tecnico.md`](docs/relatorio-tecnico.md) | Por que cada decisão foi essa e não outra; números medidos |
| [`docs/primeiro-uso.md`](docs/primeiro-uso.md) | Guia dos dois usuários finais: backup, comparação dos códigos, primeiro envio |
| [`docs/guia-da-equipe.md`](docs/guia-da-equipe.md) | Para o dev novo: duas origens, tabela de frequência, vetores e o que roda antes do PR |

**Antes de escrever código, leia as decisões D1–D13** no início do backlog. Elas fixam o formato binário, os parâmetros de derivação de chave e o alfabeto do Huffman — coisas que precisam ser idênticas nos dois lados da comunicação. Divergir delas faz o app falhar silenciosamente.

## Convenções

- **Código em inglês, interface em português.** Identificadores, arquivos, rotas, campos de model e classes CSS em inglês; tudo que o usuário lê na tela em português, inclusive mensagens de erro e rótulos do Admin.
- **Código sem comentários.** A explicação vive em `docs/`.
- Detalhes em [`docs/convencoes.md`](docs/convencoes.md).

## Stack

Django 5.2 · PostgreSQL 16 · JavaScript sem framework (ES Modules + Web Crypto API) · Docker Compose · Vitest
