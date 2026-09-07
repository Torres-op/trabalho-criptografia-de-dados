# Infraestrutura e Ambiente de Desenvolvimento

Documento de referência do ambiente containerizado do projeto. Explica o que cada arquivo faz, por que foi feito assim, e como operar o dia a dia.

Referência cruzada: o backlog está em [`backlog-detalhado.md`](backlog-detalhado.md). As decisões travadas aparecem lá como **D1**–**D13**.

---

## Índice

1. [Visão geral](#1-visão-geral)
2. [Pré-requisitos](#2-pré-requisitos)
3. [Primeiro setup](#3-primeiro-setup)
4. [Bootstrap do Épico 0](#4-bootstrap-do-épico-0)
5. [Os serviços do compose](#5-os-serviços-do-compose)
6. [O Dockerfile explicado](#6-o-dockerfile-explicado)
7. [Comandos do dia a dia](#7-comandos-do-dia-a-dia)
8. [Variáveis de ambiente](#8-variáveis-de-ambiente)
9. [Testar os 2 usuários numa máquina só](#9-testar-os-2-usuários-numa-máquina-só)
10. [Testar no celular](#10-testar-no-celular)
11. [Por que Postgres e não SQLite](#11-por-que-postgres-e-não-sqlite)
12. [Troubleshooting](#12-troubleshooting)

---

## 1. Visão geral

O ambiente inteiro roda em containers. Ninguém instala Python, Node ou Postgres na máquina — só Docker.

| Arquivo | Papel |
|---|---|
| `Dockerfile` | Imagem da aplicação, com alvos separados para desenvolvimento e produção |
| `docker-compose.yml` | Orquestra os 4 serviços do ambiente local |
| `.dockerignore` | O que não entra no contexto de build |
| `requirements.txt` | Dependências Python **diretas**, com versão fixada |
| `.env.example` | Modelo das variáveis de ambiente; cada dev copia para `.env` |
| `.gitignore` | Segredos, artefatos e dependências fora do versionamento |

**O ganho principal não é reprodutibilidade — é que o ambiente virou código revisável.** Atualizar o Django deixa de ser um aviso no grupo que cada um aplica quando lembra, e passa a ser um diff no `Dockerfile` que entra por pull request e chega para todo mundo no próximo `up`.

---

## 2. Pré-requisitos

- **Docker Desktop** (Windows/macOS) ou Docker Engine + Compose plugin (Linux).
- **Git**.

Nada de Python, Node ou Postgres instalados localmente. Todos os comandos deste documento são `docker compose`, que funciona igual em PowerShell, Git Bash, WSL, macOS e Linux.

---

## 3. Primeiro setup

```bash
git clone <url-do-repo>
cd projeto_criptografia
cp .env.example .env
docker compose build
docker compose up
```

No PowerShell, troque `cp` por `Copy-Item .env.example .env`.

Abra `http://localhost:8000`. Se essa porta já estiver ocupada na sua máquina, ajuste `WEB_PORT` no `.env` — todas as URLs deste documento usam a porta padrão.

> **Nunca acesse pelo IP da rede** (`http://192.168.x.x:8000`). A Web Crypto API não existe fora de um contexto seguro, e o app quebra inteiro. Ver **D10** no backlog e a seção [10](#10-testar-no-celular).

### Ajuste obrigatório no Linux

Antes do `build`, abra o `.env` e coloque seu ID de usuário real:

```bash
id -u   # → coloque em UID
id -g   # → coloque em GID
```

Isso faz os arquivos que o container cria (migrations, `startapp`) pertencerem a você, e não a `root`. No Windows e no macOS o padrão `1000` já serve — o Docker Desktop cuida da tradução de permissões.

---

## 4. Bootstrap do Épico 0

Na primeira vez, o projeto Django ainda não existe — não há `manage.py`, então o serviço `web` não sobe. Crie a estrutura pelo container:

```bash
docker compose run --rm web django-admin startproject core .
docker compose run --rm web python manage.py startapp messenger
```

Rodar **dentro do container** é o que garante que os arquivos gerados usem a mesma versão do Django que todos vão usar.

Depois disso:

```bash
docker compose run --rm web python manage.py migrate
docker compose run --rm web python manage.py createsuperuser
docker compose up
```

---

## 5. Os serviços do compose

### `db` — Postgres 16

- Dados num volume nomeado (`pgdata`), não em bind mount. Isso evita os problemas de lock do SQLite e mantém o banco fora do repositório.
- **Porta `5433` no host**, mapeada para a `5432` do container. A porta trocada evita conflito com um Postgres instalado localmente. Para conectar com DBeaver/pgAdmin: `localhost:5433`.
- O `healthcheck` com `pg_isready` existe porque o Django tenta conectar assim que sobe. Sem ele, o `web` inicia antes do banco aceitar conexões e falha com `connection refused` na primeira execução.

### `web` — a aplicação Django

- Construído com `target: dev`, então usa o alvo de desenvolvimento do `Dockerfile`.
- O código vem por **bind mount** (`.:/app`) para o autoreload funcionar. É por isso que o alvo `dev` não copia o código na imagem.
- `depends_on` com `condition: service_healthy` amarra a inicialização ao healthcheck do banco.
- **`runserver` escuta em `0.0.0.0:8000`.** Sem isso, ele escutaria no loopback *do container*, inalcançável pelo mapeamento de porta — é o erro mais comum ao containerizar Django.

### `js` — Node 22 (profile `tools`)

Roda o Vitest. Não sobe no `docker compose up`; é executado sob demanda:

```bash
docker compose run --rm js npm test
```

O volume nomeado `node_modules` é obrigatório: como `/app` é bind mount do host, sem ele o `node_modules` do host (inexistente, ou compilado para outro SO) sobrescreveria o do container.

### `tunnel` — cloudflared (profile `tunnel`)

Túnel HTTPS para testar em dispositivo real. Ver seção [10](#10-testar-no-celular).

---

## 6. O Dockerfile explicado

Quatro estágios:

**`base`** — Python 3.12 slim e as variáveis de ambiente comuns. `PYTHONDONTWRITEBYTECODE` evita `.pyc` no bind mount; `PYTHONUNBUFFERED` faz os logs aparecerem em tempo real no `docker compose logs`.

**`deps`** — instala as dependências num prefixo isolado (`/install`). Fica numa camada separada, reconstruída **apenas** quando `requirements.txt` muda. Alterar código não refaz o `pip install`.

Não há `build-essential` nem `libpq-dev` porque `psycopg[binary]` já traz a libpq compilada. Isso mantém a imagem pequena e o build rápido.

**`dev`** — copia as dependências do estágio anterior e cria um usuário não-root com o `UID`/`GID` recebidos do `.env` via build args. Não copia o código: ele vem por bind mount.

**`prod`** — copia o código, roda `collectstatic` e serve com gunicorn. Usado pelo CI e pelo deploy (Épico 16), garantindo que o time testa a mesma imagem que vai ao ar.

O `SECRET_KEY=build-only` nessa linha existe porque `collectstatic` carrega o `settings.py`, que exige a variável. É descartado ao fim da camada e **não** vai para a imagem final como configuração.

> O alvo `prod` só é construído explicitamente (`docker build --target prod`). O `docker compose build` usa apenas o `dev`, então a ausência do projeto Django durante o Épico 0 não atrapalha.

### Por que não há um volume para `site-packages`

Um erro comum é montar um volume sobre `site-packages` para "preservar" as dependências. Aqui não é necessário: o bind mount cobre `/app`, e as dependências ficam em `/usr/local/lib/python3.12/site-packages`, fora dele. Não há conflito — e um volume ali só criaria dependências obsoletas quando o `requirements.txt` mudasse.

---

## 7. Comandos do dia a dia

| Comando | O que faz |
|---|---|
| `docker compose build` | Reconstrói a imagem |
| `docker compose up` | Sobe `db` + `web` |
| `docker compose down` | Derruba os serviços |
| `docker compose down -v` | Derruba **e apaga o banco** |
| `docker compose logs -f web` | Acompanha os logs |
| `docker compose exec web bash` | Shell dentro do container |
| `docker compose exec db psql -U msgenc -d msgenc` | Console do Postgres |
| `docker compose run --rm web python manage.py migrate` | Aplica migrations |
| `docker compose run --rm web python manage.py makemigrations` | Gera migrations |
| `docker compose run --rm web python manage.py createsuperuser` | Cria admin |
| `docker compose run --rm web python manage.py seed_users` | Cria os 2 usuários fixos (Épico 2.2) |
| `docker compose run --rm web python manage.py test` | Testes Django |
| `docker compose run --rm web python manage.py shell` | Shell do Django |
| `docker compose run --rm js npm test` | Testes JS (Vitest) |
| `docker compose --profile tunnel up tunnel` | Túnel HTTPS |

O padrão é sempre o mesmo: `docker compose run --rm web python manage.py <comando>`. Qualquer comando do `manage.py` funciona nesse formato.

> `docker compose down -v` remove o volume `pgdata`. O banco é apagado. Use quando quiser começar do zero.

### Atalho opcional

Se o vaivém de `makemigrations` e `test` incomodar, vale um alias no seu shell — é preferência pessoal e não entra no repositório:

```bash
# Git Bash / WSL / Linux / macOS — em ~/.bashrc
alias dcm='docker compose run --rm web python manage.py'
# uso: dcm migrate
```

```powershell
# PowerShell — em $PROFILE
function dcm { docker compose run --rm web python manage.py @args }
# uso: dcm migrate
```

---

## 8. Variáveis de ambiente

Cada dev tem o próprio `.env`, criado a partir do `.env.example` e **nunca versionado**. O `.env.example` é versionado e serve de contrato: toda variável nova precisa ser adicionada lá.

O arquivo tem dois papéis: o Compose o usa para **interpolar** valores no `docker-compose.yml` (`UID`, `GID`, `POSTGRES_*`) e para **injetar** variáveis dentro do container `web` (`env_file`).

| Variável | Para que serve |
|---|---|
| `UID` / `GID` | Repassados como build args ao `Dockerfile`, definem o dono dos arquivos criados pelo container. No Linux, ajustar para os valores de `id -u` / `id -g` |
| `WEB_PORT` | Porta do host onde a aplicação responde (padrão `8000`). Ajuste se já houver algo nessa porta — inclusive containers de outros projetos |
| `DB_PORT` | Porta do host para o Postgres (padrão `5433`) |
| `SECRET_KEY` | Chave do Django. Em desenvolvimento qualquer valor serve; em produção, gerado e guardado na plataforma |
| `DJANGO_DEBUG` | `1` em desenvolvimento, `0` em produção. O padrão do código deve ser `0` — falhar seguro |
| `ALLOWED_HOSTS` | Hosts aceitos pelo Django |
| `POSTGRES_DB` / `POSTGRES_USER` / `POSTGRES_PASSWORD` | Consumidas pelo serviço `db` na criação do banco |
| `DATABASE_URL` | Consumida pelo Django via `dj-database-url`. O host é `db` — o **nome do serviço** no compose, não `localhost` |
| `SEED_USER_A` / `SEED_PASS_A` / `SEED_USER_B` / `SEED_PASS_B` | Credenciais dos 2 usuários fixos (Épico 2.2). Nunca hardcoded no código |

**Atenção ao host do banco.** Dentro do compose, o Postgres responde em `db:5432`. Se você rodar o Django fora do container por algum motivo, precisa trocar para `localhost:5433`.

---

## 9. Testar os 2 usuários numa máquina só

Não é preciso segunda máquina, segundo navegador nem deploy. Use duas origens diferentes apontando para o mesmo servidor:

| Usuário | URL |
|---|---|
| **A** | `http://localhost:8000` |
| **B** | `http://127.0.0.1:8000` |

As duas chegam ao mesmo container, mas o navegador as trata como **origens distintas**:

- **Cookies separados** — cookies são indexados por host, e `localhost` e `127.0.0.1` são hosts diferentes. Dá para estar logado como A numa aba e como B na outra, ao mesmo tempo.
- **IndexedDB separado** — cada origem tem seu próprio armazenamento, então cada aba gera e guarda o próprio par de chaves ECDH. É exatamente o cenário de dois dispositivos reais.
- **Ambas são contexto seguro** — `localhost` e a faixa `127.0.0.0/8` estão na safelist do navegador, então `crypto.subtle` funciona nas duas.

O mapeamento de porta do Docker não muda nada nisso: a porta publicada responde nos dois endereços.

---

## 10. Testar no celular

Necessário apenas para o que só existe em dispositivo real — o compartilhamento nativo do Épico 8.4.

```bash
docker compose --profile tunnel up tunnel
```

O cloudflared imprime nos logs uma URL do tipo `https://algum-nome-aleatorio.trycloudflare.com`. Abra no celular.

- Sem conta, sem instalar certificado no aparelho, certificado público válido.
- URL efêmera: muda a cada execução. O `ALLOWED_HOSTS` do projeto aceita `.trycloudflare.com` inteiro, então nenhum dev precisa editar o `settings.py`.
- É **self-service**: cada dev sobe o próprio túnel apontando para o próprio container. Não há ambiente compartilhado nem fila.
- O login do Django protege o acesso enquanto o túnel estiver de pé. Derrube com `Ctrl+C` ao terminar.

### Por que não usar o IP da rede local

`http://192.168.x.x:8000` **não é contexto seguro**. `crypto.subtle` vem `undefined` e o app quebra com um erro que parece bug de criptografia. A guarda do Épico 1.8 detecta isso e mostra uma mensagem explicando — mas o caminho certo é o túnel.

A alternativa totalmente offline é `mkcert` + certificado local, mas exige instalar a CA raiz no celular. Só vale se não houver internet.

---

## 11. Por que Postgres e não SQLite

O backlog originalmente fixava SQLite, e para 2 usuários ele seria tecnicamente suficiente. A troca foi motivada por ergonomia de equipe, não por escala:

- **SQLite em bind mount apresenta erros de lock intermitentes** (`database is locked`), que parecem bug do Django e não são.
- **Paridade com produção.** Render e Railway oferecem Postgres no plano gratuito. Desenvolver em SQLite e publicar em Postgres é fonte de surpresa no deploy.
- **Acaba o "meu banco vs o seu".** O banco é um volume nomeado, descartável com `docker compose down -v`, e não um arquivo dentro do repositório.

O custo foi uma dependência (`psycopg[binary]`, que traz a libpq embutida e não exige compilação) e um bloco no compose. A decisão é reversível.

---

## 12. Troubleshooting

**`docker compose up` falha com `env file .env not found`**
O `.env` não foi criado. Rode `cp .env.example .env`.

**`connection refused` ao conectar no banco**
O `healthcheck` do `db` deve resolver isso. Se persistir, confirme que o host no `DATABASE_URL` é `db` e não `localhost`.

**Arquivos criados pelo container pertencem a `root` (Linux)**
`UID`/`GID` no `.env` não batem com o seu usuário. Ajuste para os valores de `id -u` e `id -g` e rode `docker compose build` de novo.

**`crypto.subtle is undefined`**
A página foi aberta fora de um contexto seguro. Use `localhost`, `127.0.0.1` ou o túnel — nunca o IP da rede. Ver **D10** no backlog.

**`Bind for 0.0.0.0:8000 failed: port is already allocated`**
Outro processo ocupa a porta — frequentemente um container de outro projeto (`docker ps` mostra quais). Ajuste `WEB_PORT` no seu `.env` (ex.: `WEB_PORT=8001`) e suba de novo. Não altere o `docker-compose.yml`: a porta é configurável justamente para que cada dev resolva conflitos locais sem tocar em arquivo versionado. O mesmo vale para `DB_PORT`.

**Mudei o `requirements.txt` e a dependência não aparece**
A camada `deps` precisa ser reconstruída: `docker compose build web`.
