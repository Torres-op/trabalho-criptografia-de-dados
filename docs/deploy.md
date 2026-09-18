# Deploy e integração contínua

O deploy **não é etapa de teste**. O desenvolvimento acontece em `localhost`, que já é contexto seguro; este ambiente existe para integração e para a apresentação final, e é automatizado para não virar gargalo.

---

## 1. A plataforma: Render

| Opção | Por que sim | Por que não |
|---|---|---|
| **Render** | HTTPS automático, roda Docker, Postgres gerenciado e blueprint versionado (`render.yaml`) — tudo no plano gratuito | O serviço gratuito hiberna com 15 min de inatividade e o banco gratuito **expira em 30 dias** |
| Railway | Ótimo suporte a Docker e Postgres | Não tem mais plano gratuito, só crédito de teste |
| Fly.io | Roda a imagem Docker sem intermediário | Acabou a franquia gratuita; exige cartão e um `fly.toml` à parte |
| PythonAnywhere | Simples para Django puro | Não roda Docker e não oferece Postgres no plano gratuito — obrigaria a abandonar o caminho de container que o time já usa |

**Escolhemos o Render** porque é o único dos quatro que junta, de graça, as três coisas de que este projeto precisa: **HTTPS automático** (sem ele `crypto.subtle` não existe e o app não abre — D10), **build da mesma imagem Docker que o time já usa** (D12) e **Postgres gerenciado**.

As duas limitações são conhecidas e têm contrapartida:

- **Hibernação.** A primeira requisição depois de um tempo parado leva quase um minuto. Antes de uma apresentação, abra o app alguns minutos antes.
- **Banco gratuito expira em 30 dias.** É exatamente por isso que o backup da seção 5 existe e roda todo dia. Expirado o banco, cria-se outro e restaura-se o dump.

## 2. Primeiro deploy

**Antes de abrir o painel:** o [`render.yaml`](../render.yaml) precisa estar na `main`, porque é dela que o serviço é construído (`branch: main`). Enquanto o arquivo existir só numa branch de trabalho, o blueprint não enxerga nada.

1. No painel do Render: **New > Blueprint**, apontando para o repositório e para a branch `main`. Ele lê o [`render.yaml`](../render.yaml) e cria o serviço web mais o banco.
2. Preencher as quatro variáveis marcadas como `sync: false` — elas ficam fora do repositório de propósito: `SEED_USER_A`, `SEED_PASS_A`, `SEED_USER_B`, `SEED_PASS_B`.
3. Copiar a URL em **Settings > Deploy Hook** e guardar no GitHub como o segredo **`RENDER_DEPLOY_HOOK`** (*Settings > Secrets and variables > Actions*).
4. Copiar a **External Database URL** do banco e guardar como o segredo **`DATABASE_URL_EXTERNAL`**, usado pelo backup.

O resto o blueprint resolve sozinho: a `SECRET_KEY` é gerada pelo próprio Render e a `DATABASE_URL` vem do banco criado junto.

O host entra por dois caminhos, de propósito: o blueprint traz `ALLOWED_HOSTS` com o domínio do serviço, e o `settings.py` ainda acrescenta o `RENDER_EXTERNAL_HOSTNAME`, que a plataforma injeta em execução. Um cobre o outro — se o serviço subir com um domínio diferente do que está escrito no blueprint, o app continua respondendo.

> **Não use `fromService` apontando para o próprio serviço** para preencher o `ALLOWED_HOSTS`. Era assim na primeira versão do blueprint: a variável chegou vazia, toda requisição virou `400 DisallowedHost` e o health check nunca passou — com a agravante de o erro aparecer no log do app, parecendo problema de Django.

Não é preciso rodar nada à mão depois. O [`deploy/start.sh`](../deploy/start.sh) roda `migrate` e `seed_users` — que é idempotente e nunca troca a senha de quem já existe — antes de subir o gunicorn. Isso importa porque o plano gratuito do Render não dá shell no container.

> **As senhas dos dois usuários valem a partir do primeiro deploy.** Como o `seed_users` preserva a senha de quem já existe, mudar `SEED_PASS_A` depois não muda nada: a troca passa a ser pelo `/admin/`. Escolha as senhas de produção antes de aplicar o blueprint, e não reaproveite as do `.env` de desenvolvimento.

### Comandos avulsos sem shell no container

O plano gratuito não dá terminal no serviço, mas o banco aceita conexão externa. Qualquer comando pontual — criar o superusuário do `/admin/`, por exemplo — roda do seu próprio container apontando para o banco publicado:

```bash
docker compose run --rm -e DATABASE_URL="<External Database URL>" \
  web python manage.py createsuperuser
```

O superusuário não participa das conversas: ele enxerga o Admin, e o histórico continua fechado para quem não é um dos dois participantes.

## 3. O pipeline

O [`ci.yml`](../.github/workflows/ci.yml) roda em todo push nas branches `main` e `dev` e em toda pull request:

| Job | O que faz |
|---|---|
| **Testes do navegador** | `npm ci && npm test` na mesma imagem `node:22-alpine` do compose |
| **Testes do servidor** | Constrói o alvo `prod`, roda a suíte do Django dentro dela e depois o `check --deploy` com `DJANGO_DEBUG=0` |
| **Publica no Render** | Só em push na `main`, e só depois de os dois jobs acima passarem |

Três decisões que valem explicar:

- **`autoDeploy: false` no blueprint.** Se o Render publicasse sozinho a cada push, os testes não bloqueariam nada — o deploy sairia em paralelo com o CI. Quem dispara a publicação é o job final, pelo deploy hook, e só depois do verde.
- **A suíte roda dentro da imagem de produção.** O que é testado é a imagem que vai ao ar, não um ambiente parecido com ela.
- **Um passo confere que `prod` é o último estágio do Dockerfile.** As plataformas constroem o último estágio quando nenhum alvo é informado; se alguém acrescentar um estágio depois do `prod`, o deploy passaria a publicar o estágio errado em silêncio. O CI falha antes.

O `check --deploy` roda com uma `SECRET_KEY` aleatória gerada na hora e com `--fail-level WARNING`: qualquer aviso de segurança derruba o build.

> A suíte do Django roda com `DJANGO_DEBUG=1` **de propósito**. Com `DEBUG=0` o `SECURE_SSL_REDIRECT` entra em cena e o cliente de teste, que fala HTTP, receberia 301 em toda requisição. A configuração de produção é verificada no passo seguinte, que é o lugar certo para isso.

## 4. Produção

Já está tudo no [`settings.py`](../core/settings.py) e no [`Dockerfile`](../Dockerfile):

| Item | Onde |
|---|---|
| Estáticos servidos pelo WhiteNoise, com hash e `immutable` | `STORAGES` + middleware |
| `collectstatic` no build | estágio `prod` do Dockerfile |
| `SECURE_PROXY_SSL_HEADER` | `settings.py`, fora do `DEBUG` |
| Redirecionamento para HTTPS, HSTS, cookies `Secure` | idem |
| CSP | `core/middleware.py` |

**O `SECURE_PROXY_SSL_HEADER` é o erro mais comum deste passo.** Sem ele, o Django vê a requisição interna como HTTP, redireciona para HTTPS, o proxy entrega de novo em HTTP e o navegador roda em círculo. Com ele configurado, o comportamento correto é o de baixo — e dá para conferir na sua máquina, com o compose de pé:

```bash
docker build --target prod -t treehash:local .
docker run --rm -p 8099:8000 --network projeto_criptografia_default \
  -e SECRET_KEY="$(openssl rand -base64 48)" -e DJANGO_DEBUG=0 \
  -e ALLOWED_HOSTS=localhost \
  -e DATABASE_URL=postgres://treehash:treehash@db:5432/treehash \
  -e SEED_USER_A=diretor -e SEED_PASS_A=x -e SEED_USER_B=marcio -e SEED_PASS_B=x \
  treehash:local
```

```bash
curl -o /dev/null -w "%{http_code}\n" -H "X-Forwarded-Proto: https" http://localhost:8099/login/
# 200 — atrás do proxy, serve normalmente

curl -o /dev/null -w "%{http_code}\n" http://localhost:8099/login/
# 301 — sem o cabeçalho do proxy, manda para HTTPS
```

> O build de produção passa uma `DATABASE_URL` de mentira para o `collectstatic`. Não é gambiarra de configuração: o `settings.py` exige a variável no import, e a máquina de build não tem banco nenhum — nem deveria ter. Em execução a variável continua obrigatória.

### Por que um worker só

O `start.sh` sobe o gunicorn com **1 worker e 4 threads**, e não com vários processos.

O limite de tentativas de login (13.2) vive no cache do Django, que aqui é o cache local **do processo**. Com 3 workers, cada um teria o próprio contador e o limite de 5 tentativas viraria 15 na prática — um enfraquecimento silencioso de um controle de segurança, causado pela configuração de deploy e não pelo código.

Com um worker, o contador é único e o `cache.incr` continua atômico. Para dois usuários, um worker com quatro threads sobra. Se um dia for preciso escalar, **o cache precisa virar compartilhado (Redis) antes de aumentar o `WEB_CONCURRENCY`** — não é opcional.

## 5. Backup do banco

O [`backup.yml`](../.github/workflows/backup.yml) roda todo dia às 03:17 de Brasília, e também sob demanda por *Run workflow*:

1. Gera o dump com o `pg_dump` da imagem `postgres:16-alpine`, comprimido.
2. **Restaura o dump num banco vazio** criado na hora e conta usuários, mensagens e backups de chave.
3. Publica o arquivo como artefato do workflow, com retenção de 30 dias.

O passo 2 é o que dá valor ao resto: backup que nunca foi restaurado não é backup. Aqui a restauração é exercitada **em toda execução**, e o workflow falha se o dump não voltar.

Para restaurar de verdade, baixe o artefato e aponte para o banco novo:

```bash
gunzip -c treehash-AAAAMMDD-HHMM.sql.gz | psql "<External Database URL do banco novo>"
```

O dump inclui a tabela `messenger_keybackup`. **Perdê-la elimina a camada 1 de recuperação de chave do D11** — o backup guardado no servidor — e sobra só o arquivo `.treehashkey` de cada usuário.

O conteúdo do dump é cifrado (blobs das mensagens, backups de chave) ou hash (senhas de login), mas ainda assim é dado do sistema: trate o artefato como material do projeto, não como arquivo público.

## 6. Testar no celular

Só é necessário para o que existe apenas no celular, como o compartilhamento nativo. Cada dev sobe o próprio túnel, apontado para o próprio `localhost`:

```bash
docker compose --profile tunnel up tunnel
```

A URL `https://algo-aleatorio.trycloudflare.com` aparece nos logs. Não é ambiente compartilhado, não exige conta e o certificado é válido — o celular abre em contexto seguro. Os `ALLOWED_HOSTS` e `CSRF_TRUSTED_ORIGINS` já aceitam qualquer subdomínio do `trycloudflare.com` **quando `DEBUG=1`**, então nada precisa ser editado no `settings.py`.

O login do Django continua protegendo o acesso enquanto o túnel estiver de pé. Feche o túnel ao terminar: a URL é efêmera, mas enquanto existe ela é pública.

## 7. Armadilhas conhecidas

| Sintoma | Causa |
|---|---|
| Redirecionamento infinito em produção | `SECURE_PROXY_SSL_HEADER` ausente, ou proxy sem `X-Forwarded-Proto` |
| `DisallowedHost` | O `ALLOWED_HOSTS` chegou vazio ou sem o domínio em uso. Confira a variável no painel; um domínio próprio precisa ser acrescentado à mão |
| Primeira requisição do dia demora um minuto | Hibernação do plano gratuito |
| O app some depois de um mês | O banco gratuito do Render expirou; crie outro e restaure o dump |
| Deploy publicou sem passar pelos testes | Alguém ligou o `autoDeploy` no painel; o painel vence o blueprint |
| Limite de login parecendo alto demais | `WEB_CONCURRENCY` maior que 1 sem cache compartilhado |
