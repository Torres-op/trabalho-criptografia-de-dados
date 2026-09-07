# msgenc — Mensagens Criptografadas

Aplicativo de mensagens criptografadas entre **dois usuários fixos**. A mensagem é comprimida com uma árvore de Huffman e cifrada no navegador; o resultado vira um arquivo `.msgenc` que o remetente entrega ao destinatário por pen-drive, WhatsApp ou e-mail. O destinatário abre o arquivo no tradutor e lê o texto original.

**O servidor nunca vê texto puro nem chaves privadas.** Ele guarda apenas blobs cifrados e chaves públicas.

---

## ⚠️ Estado atual

**Épicos 0 e 1 concluídos** — esqueleto e infraestrutura.

A criptografia e a compressão ainda são **implementações falsas**: `huffman.js` devolve UTF-8 puro e `crypto.js` faz um XOR com constante fixa. Ambos exportam `FAKE_IMPLEMENTATION = true`, e a interface exibe um aviso permanente enquanto for assim.

**Nenhuma mensagem gerada hoje é segura.** As implementações reais chegam nos Épicos 3 (Huffman) e 4 (ECDH + AES-GCM).

---

## Começando

Só é preciso ter **Docker** e **Git** instalados. Nada de Python, Node ou Postgres na máquina.

```bash
git clone <url-do-repo>
cd projeto_criptografia
cp .env.example .env
docker compose build
docker compose run --rm web python manage.py migrate
docker compose up
```

Abra **http://localhost:8000**.

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
| A | `http://localhost:8000` |
| B | `http://127.0.0.1:8000` |

---

## Estrutura

```
core/                    projeto Django (settings, urls)
messenger/               app principal
  templates/messenger/   compose.html, translator.html
  static/messenger/
    css/app.css
    js/
      format.js          formato binário .msgenc  (real)
      environment.js     guarda de contexto seguro (real)
      huffman.js         compressão                (falso — Épico 3)
      crypto.js          cifragem                  (falso — Épico 4)
      app.js             pipeline (não muda ao trocar as implementações)
      ui.js              helpers de interface
      compose.js         página Compor
      translator.js      página Tradutor
tests/                   suíte Vitest
docs/                    backlog e infraestrutura
```

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/backlog-detalhado.md`](docs/backlog-detalhado.md) | O plano completo: 18 épicos e as decisões travadas **D1**–**D13** |
| [`docs/infraestrutura.md`](docs/infraestrutura.md) | Ambiente Docker, comandos, variáveis, troubleshooting |
| [`docs/convencoes.md`](docs/convencoes.md) | Convenções de código |

**Antes de escrever código, leia as decisões D1–D13** no início do backlog. Elas fixam o formato binário, os parâmetros de derivação de chave e o alfabeto do Huffman — coisas que precisam ser idênticas nos dois lados da comunicação. Divergir delas faz o app falhar silenciosamente.

## Convenções

- **Código em inglês, interface em português.** Identificadores, arquivos, rotas e classes CSS em inglês; tudo que o usuário lê na tela em português, inclusive mensagens de erro.
- **Código sem comentários.** A explicação vive em `docs/`.
- Detalhes em [`docs/convencoes.md`](docs/convencoes.md).

## Stack

Django 5.2 · PostgreSQL 16 · JavaScript sem framework (ES Modules + Web Crypto API) · Docker Compose · Vitest
