# Backlog Detalhado — App de Mensagens Criptografadas (Django + JS)

> **Stack:** Django (backend/API/Admin) + JavaScript puro no navegador (Huffman + Web Crypto API para toda a criptografia).
> **Princípio central:** o servidor nunca vê texto puro nem chaves privadas. Ele guarda apenas blobs cifrados e chaves públicas.
> **Canal de entrega:** o arquivo `.msgenc`, trocado offline (pen-drive, WhatsApp, e-mail). O servidor é cofre de histórico, não canal de transporte.

---

## Decisões de arquitetura (travadas — não reabrir durante a implementação)

Esta seção existe para que os dois lados da implementação (`encode`/`decode`, `encrypt`/`decrypt`) sejam byte-a-byte compatíveis. Qualquer divergência aqui faz o app falhar silenciosamente ou não decifrar nada.

### D1. Huffman opera sobre **bytes UTF-8**, não sobre caracteres
O alfabeto é `0..255` mais um símbolo `EOF` (índice `256`) — 257 símbolos no total.

**Por quê:** elimina completamente o conceito de "caractere fora da tabela". Emoji, símbolos raros, qualquer idioma — tudo já é uma sequência de bytes conhecidos. Sem código de escape, sem ambiguidade de quantos bytes ler, sem tratamento especial. A compressão em PT-BR permanece essencialmente a mesma.

### D2. O fim do fluxo é marcado pelo símbolo `EOF`, não por um contador de bits
Ao empacotar bits em bytes, sobram bits de padding no último byte. Sem um marcador, o `decode` interpreta esse lixo como caracteres extras.

`encode` emite o código do `EOF` no fim; `decode` para ao encontrá-lo e descarta o resto do byte.

### D3. Huffman **canônico**, com desempate determinístico
Ao construir a árvore, empates de frequência na fila de prioridade são desempatados pelo **menor índice de símbolo**. Em seguida, os códigos são reatribuídos de forma canônica (ordenados por comprimento, depois por símbolo).

**Por quê:** garante que a árvore é idêntica em qualquer execução e em qualquer reimplementação. Sem isso, dois builds podem gerar códigos diferentes para a mesma tabela.

### D4. Derivação de chave (ECDH → HKDF → AES-256)

```
segredo   = ECDH.deriveBits(privadaLocal, publicaDoOutro, 256)
salt      = SHA-256( utf8( usernameMenor + "\x00" + usernameMaior ) )   // ordem alfabética
info      = utf8( "msgenc/v1/aes-gcm-256" )
aesKey  = HKDF-SHA256( segredo, salt, info ) → AES-GCM 256 bits
```

`usernameMenor`/`usernameMaior` são os dois usernames ordenados alfabeticamente, para que ambos os lados produzam o mesmo `salt` independentemente de quem está cifrando.

### D5. Formato binário `.msgenc` (v1)

Nada de JSON + base64 no arquivo final. Com o envelope JSON, o base64 (×1,33) mais os nomes de campo devolvem exatamente o que o Huffman economizou — o arquivo fica do mesmo tamanho do texto puro e a compressão deixa de existir na prática.

| Offset | Tamanho | Campo | Descrição |
|---|---|---|---|
| 0 | 4 | `magic` | `"MENC"` — `0x4D 0x45 0x4E 0x43` |
| 4 | 1 | `version` | `0x01` |
| 5 | 1 | `flags` | bit 0 = payload comprimido; bits 1–7 reservados (= 0) |
| 6 | 1 | `sender_id` | `0` ou `1` — índice do remetente na lista de usernames em ordem alfabética |
| 7 | 8 | `created_at` | uint64 big-endian, milissegundos desde a época UTC |
| 15 | 12 | `iv` | aleatório, único por mensagem |
| 27 | N | `ciphertext` | inclui a tag GCM de 16 bytes no final |

- **Cabeçalho:** 27 bytes fixos.
- **AAD (`additionalData` do AES-GCM):** os **primeiros 15 bytes** (offsets 0–14). Isso autentica `magic`, `version`, `flags`, `sender_id` e `created_at` — adulterar qualquer um invalida a mensagem inteira.
- **`flags` bit 0 = 0:** o payload é UTF-8 puro, sem Huffman. Usado quando a compressão expandiria a mensagem (textos muito curtos ou com muitos bytes raros). O `encode` compara os dois tamanhos e escolhe o menor.

### D6. Formato "armored" (texto colável)

Para WhatsApp e e-mail no celular, anexar arquivo é desconfortável — e `mailto:` **não consegue anexar arquivos**. Por isso o mesmo conteúdo também é oferecido como bloco de texto:

```
-----BEGIN MENC-----
<base64 do arquivo binário, quebrado em linhas de 64 caracteres>
-----END MENC-----
```

O tradutor aceita as duas formas: arquivo e texto colado.

### D7. Dois timestamps distintos, com papéis diferentes
- `created_at` — gerado pelo cliente, vai no cabeçalho e **dentro do AAD**. É o "quando foi escrita".
- `received_at` — `auto_now_add` no model Django. É o "quando chegou no servidor". Não é falsificável.

A UI deve deixar claro qual está exibindo.

### D8. Views Django puras com `JsonResponse`
Sem Django REST Framework. O escopo é de 6 endpoints simples e DRF traria mais configuração do que valor.

### D9. Testes JS com Vitest
Roda a Web Crypto API nativamente (Node 18+, via `globalThis.crypto`). Só o IndexedDB precisa de stub — usar `fake-indexeddb`.

### ⚠️ D10. `crypto.subtle` exige contexto seguro

A Web Crypto API **não existe** fora de um contexto seguro — `crypto.subtle` vem `undefined` e o app quebra inteiro, com um erro que parece bug de criptografia (`Cannot read properties of undefined`) e não de ambiente.

**O que conta como contexto seguro:**

| Endereço | Contexto seguro? |
|---|---|
| `http://localhost:8000` | ✅ sim (safelist do navegador) |
| `http://127.0.0.1:8000` | ✅ sim (faixa `127.0.0.0/8`) |
| `https://qualquer-coisa` | ✅ sim |
| `http://192.168.1.15:8000` | ❌ **não** |
| `http://0.0.0.0:8000` | ❌ **não** |

**Consequência prática — o desenvolvimento diário não é afetado.** Todo dev rodando `runserver` e acessando por `localhost` tem a Web Crypto funcionando sem nenhuma configuração. O problema só aparece ao acessar pelo IP da máquina na rede local, tipicamente para testar do celular.

Isso é tratado em três camadas: convenções de ambiente local (1.7), guarda explícita no boot do JS (1.8) e túnel HTTPS self-service quando um dispositivo real for necessário (16.3).

> `runserver 0.0.0.0:8000` é um *bind address* válido e útil, mas continue **navegando** para `localhost` — `0.0.0.0` não está na safelist.

### D11. Estratégia de recuperação de chave (três camadas)

Com ECDH estático, a chave que lê o histórico é derivada da **privada local + pública do outro**. Perder a privada e gerar outra torna todo o histórico anterior ilegível — inclusive para o outro usuário, já que tudo foi cifrado sob o segredo antigo. Por isso a recuperação é tratada em camadas, e não por um único arquivo de backup.

| Camada | Protege contra | Onde vive | Épico |
|---|---|---|---|
| **1. Backup cifrado no servidor** | Trocar de dispositivo, limpar o navegador | Conta do app (blob opaco) | 6.8, 11.6 |
| **2. Arquivo `.msgkey`** | Servidor fora do ar, conta perdida | Pen-drive, gerenciador de senhas | 11.3, 11.4 |
| **3. Recuperação assistida pelo outro usuário** | Falha das duas anteriores | Navegador do outro usuário | 11.7 |

Todas as camadas usam **PBKDF2-HMAC-SHA256 com 600.000 iterações** (recomendação atual da OWASP) e salt aleatório de 16 bytes.

**Limite honesto:** se os dois usuários perderem as chaves simultaneamente e não houver backup, o histórico é irrecuperável. Isso é inerente à criptografia fim-a-fim e deve estar escrito no `SEGURANCA.md` (15.3), não escondido.

### D12. Docker como ambiente padrão da equipe

Todo o ambiente roda em containers. Ninguém instala Python, Node ou Postgres na máquina — só Docker.

O ganho principal não é reprodutibilidade: é que **o ambiente vira código revisável**. Atualizar o Django deixa de ser um aviso no grupo que cada um aplica quando lembra, e passa a ser um diff no `Dockerfile` que entra por pull request e chega a todos no próximo `up`.

Regras que acompanham a decisão:
- **Tags de imagem sempre fixas** — `python:3.12-slim`, `postgres:16-alpine`, `node:22-alpine`. Nunca `latest`.
- **Dependências diretas com versão fixada** no `requirements.txt`; `package-lock.json` versionado.
- **Um `Dockerfile` multi-stage**, com alvo `dev` (bind mount, autoreload) e alvo `prod` (código copiado, gunicorn). CI e deploy usam o `prod`, então o time testa a mesma imagem que vai ao ar.
- **Serviços opcionais por profile** — `docker compose up` sobe apenas `db` e `web`; Node e túnel só quando pedidos.

Documentação operacional completa em [`infraestrutura.md`](infraestrutura.md).

### D13. Código em inglês, interface em português

**Em inglês** — todo identificador de código: apps, módulos, arquivos, rotas, classes, funções, variáveis, constantes, chaves de objeto, campos de model, endpoints, IDs e classes CSS, blocos de template, branches e mensagens de commit.

**Em português** — tudo que o usuário lê na tela: títulos, rótulos, botões, placeholders e **mensagens de erro exibidas na interface**, inclusive as lançadas de dentro do código (`throw new FormatError("Arquivo corrompido...")`). Também a formatação de números e datas (`toLocaleString("pt-BR")`).

Na dúvida: *isso aparece na tela para o usuário?* Se sim, português; se não, inglês. Um mesmo arquivo mistura os dois normalmente.

A **documentação** (`docs/`) é escrita em português, já que o público é a equipe. Identificadores citados nela seguem o código e permanecem em inglês.

Convenções completas em [`convencoes.md`](convencoes.md).

---

## Mapa de dependências

```
0 (skeleton) → 1 (infra) → 2 (auth) ─┬→ 3 (Huffman) ──┐
                                     │                 ├→ 5 (formato) → 7 (compor) → 8 (compartilhar)
                                     └→ 4 (cripto) ────┘                     ↓
                                                                       9 (tradutor) → 10 (histórico)
                                            6 (API) ────────────────────────┘
                                                                              ↓
                                                     11 (confiança) → 12 (UX) → 13 (hardening)
                                                                              ↓
                                                              14 (testes) → 15 (docs) → 16 (deploy)
```

**Épicos 3 e 4 são independentes entre si** e podem ser feitos em paralelo ou em qualquer ordem. Ambos precisam do Épico 1 e do 2.

Duas dependências que atravessam o diagrama e é fácil esquecer:
- **6.8 → 11.6** — a recuperação pelo backup no servidor precisa dos endpoints prontos antes.
- **1.7/1.8 → todo o resto** — sem as convenções de ambiente e a guarda de contexto seguro, o time perde tempo com um erro que não é de código.

---

## Épico 0 — Walking Skeleton (fluxo ponta a ponta com cripto falsa) ✅

> **Objetivo:** ter o caminho completo `usuário A escreve → arquivo → usuário B lê` funcionando na primeira semana, com as peças criptográficas substituídas por versões triviais. Todos os problemas de integração aparecem agora, e não no Épico 9.

**Entregue.** Estrutura resultante:

```
core/                     settings.py, urls.py
messenger/
  views.py, urls.py
  templates/messenger/   base.html, compose.html, translator.html
  static/messenger/
    css/app.css
    js/  environment.js  format.js  huffman.js  crypto.js
         app.js  ui.js  compose.js  translator.js
```

**O que é real e o que é falso:**

| Módulo | Estado | Vira real em |
|---|---|---|
| `format.js` | **real** — layout D5 completo, com validação de magic, versão, bits reservados e `sender_id` | (adiantou 5.1 e parte de 5.2) |
| `environment.js` | **real** — `requireSecureContext()` e `requestPersistentStorage()` | (adiantou 1.8 e 4.9) |
| `huffman.js` | **real desde o Épico 3** — Huffman canônico sobre bytes UTF-8 | (concluído) |
| `crypto.js` | falso — XOR com constante fixa | Épico 4 |

Os módulos falsos exportam `FAKE_IMPLEMENTATION = true`. O `app.js` lê essa flag e as páginas exibem um aviso permanente de que nada ali é seguro. Quando os Épicos 3 e 4 substituírem as implementações, a flag some e o aviso desaparece sozinho — **sem tocar no `app.js`**, que é o critério do 0.3.

### 0.1 Esqueleto Django mínimo
> A infraestrutura (1.9–1.11) já está pronta no repositório. O `startproject` e o `startapp` rodam **dentro do container**, garantindo que todos gerem os arquivos com a mesma versão do Django.

```bash
cp .env.example .env
docker compose build
docker compose run --rm web django-admin startproject core .
docker compose run --rm web python manage.py startapp messenger
docker compose run --rm web python manage.py migrate
docker compose up
```

- Uma view `compose` e uma view `translator`, sem autenticação ainda.
- **Critério de aceite**: as duas páginas abrem em `http://localhost:8000`, e um dev novo chega até aqui seguindo apenas o [`infraestrutura.md`](infraestrutura.md).

### 0.2 Pipeline falso ponta a ponta
- `encode` = converter texto para `Uint8Array` UTF-8 (sem compressão).
- `encrypt` = XOR com uma constante fixa. O módulo exporta `FAKE_IMPLEMENTATION = true` e a interface exibe o aviso a partir dessa flag — nada de comentário (D13).
- Montar o cabeçalho binário do D5 com valores fixos.
- **Critério de aceite**: escrever um texto na página Compor, baixar o arquivo, abrir no Tradutor e ver o texto original.

### 0.3 Contrato dos módulos JS congelado
- Definir e documentar as assinaturas que os épicos seguintes vão implementar:
  ```js
  // huffman.js
  export function encode(text: string): { bytes: Uint8Array, compressed: boolean }
  export function decode(bytes: Uint8Array, compressed: boolean): string

  // crypto.js
  export async function encrypt(bytes: Uint8Array, aesKey: CryptoKey, aad: Uint8Array): Promise<{ iv: Uint8Array, ciphertext: Uint8Array }>
  export async function decrypt(iv, ciphertext, aesKey, aad): Promise<Uint8Array>

  // format.js
  export function pack({ senderId, createdAt, compressed, iv, ciphertext }): Uint8Array
  export function unpack(bytes: Uint8Array): { version, flags, senderId, createdAt, iv, ciphertext, aad }
  ```
- **Critério de aceite**: trocar a implementação falsa pela real (Épicos 3–5) não exige mudar nenhuma linha do `app.js`.

---

## Épico 1 — Infraestrutura e Setup ✅

> **Concluído.** O repositório está pronto para ser clonado pela equipe: `git clone` → `cp .env.example .env` → `docker compose build` → `migrate` → `up`.

> **Ordem de execução:** os itens **1.9 a 1.11** (containerização) são pré-requisito de todos os demais e **já estão entregues no repositório** — `Dockerfile`, `docker-compose.yml`, `.dockerignore`, `requirements.txt`, `.env.example` e `.gitignore`. Comece pelo [`infraestrutura.md`](infraestrutura.md). A numeração os mantém no fim apenas para não deslocar as referências já feitas ao longo do documento.

### 1.1 Criar estrutura do projeto Django ✅
> Sem virtualenv local — tudo roda no container (**D12**).

- `django-admin startproject core .` + `startapp messenger`, ambos via `docker compose run --rm web`.
- Adicionar `messenger` em `INSTALLED_APPS` (`core/settings.py`).
- **Critério de aceite**: `docker compose up` sobe sem erro e mostra a página padrão do Django em `http://localhost:8000`.

### 1.2 Configurar `requirements.txt` ✅
- Listar **apenas as dependências diretas**, à mão, com versão fixada:
  ```
  Django==5.2.*
  psycopg[binary]==3.2.*
  dj-database-url==2.*
  python-decouple==3.8
  django-ratelimit==4.1.*
  gunicorn==23.0.*
  whitenoise==6.*
  ```
- Não usar `pip freeze` — ele captura dependências transitivas e deixa o arquivo ilegível e difícil de atualizar.
- `psycopg[binary]` traz a libpq embutida: não é preciso `build-essential` nem `libpq-dev` na imagem.
- Versionar o `package-lock.json` do lado JS.
- **Critério de aceite**: `docker compose build` em ambiente limpo reproduz o setup; alterar o arquivo e rebuildar traz a dependência nova.

### 1.3 Configurar banco de dados (Postgres via compose) ✅
> Decisão revista: o backlog original fixava SQLite. A troca é por ergonomia de equipe, não por escala.

- Serviço `db` com `postgres:16-alpine`, dados em volume nomeado (`pgdata`), **nunca** em bind mount.
- Porta `5433` no host (mapeada para a `5432` do container) para não conflitar com um Postgres instalado localmente.
- `healthcheck` com `pg_isready` — sem ele, o Django inicia antes do banco aceitar conexões e falha com `connection refused` na primeira execução.
- Conexão configurada por `DATABASE_URL` (via `dj-database-url`), com host `db` — o **nome do serviço**, não `localhost`.
- Motivos da troca, para registro: SQLite em bind mount gera `database is locked` intermitente; Render e Railway oferecem Postgres no plano gratuito (paridade com produção); o banco deixa de ser um arquivo dentro do repositório.
- **Critério de aceite**: `migrate` roda sem erro; `docker compose down -v` seguido de `up` recria o banco do zero.

### 1.4 Configurar arquivos estáticos (front-end JS) ✅
- `messenger/static/messenger/js/` para os módulos. Entregues: `environment.js`, `format.js`, `huffman.js`, `crypto.js`, `app.js`, `ui.js`, `compose.js`, `translator.js`. Ainda por vir: `keystore.js` (4.2) e `armor.js` (5.5).
- **ES Modules** (`<script type="module">`) — os módulos do 0.3 dependem de `import`/`export`. Importações relativas (`./format.js`) resolvem a partir da URL do módulo, então funcionam sem importmap.
- `STATIC_URL` e `STATIC_ROOT` em `settings.py`. **Não** é preciso `STATICFILES_DIRS`: o `AppDirectoriesFinder` (padrão) já encontra `messenger/static/`.
- WhiteNoise no middleware, com `CompressedManifestStaticFilesStorage` para produção.
- `messenger/templates/messenger/` para os HTMLs, encontrados pelo `APP_DIRS` padrão.
- **Critério de aceite**: um `import` entre dois arquivos JS funciona na página carregada — verificado: `compose.js` importa `app.js`, `environment.js` e `ui.js`, e o Django serve os módulos com `Content-Type: text/javascript`.

### 1.5 Configurar `.gitignore` e variáveis de ambiente ✅
- Ignorar `venv/`, `__pycache__/`, `.env`, `node_modules/`, `staticfiles/`, `*.msgkey` e `*.msgenc` — com exceção de `!tests/vectors/*.msgenc`, que são os vetores de teste do 14.9 e **precisam** ser versionados.
- Ler `SECRET_KEY`, `DJANGO_DEBUG`, `ALLOWED_HOSTS` e `DATABASE_URL` do ambiente (`python-decouple` + `dj-database-url`).
- `.env.example` versionado é o **contrato**: toda variável nova entra lá no mesmo commit que a usa.
- `.gitattributes` com `* text=auto eol=lf` — sem isso, um time em Windows e Linux gera diffs inteiros de fim de linha. Extensões binárias (`.msgenc`, `.msgkey`, imagens) marcadas como `binary` para não sofrerem conversão.
- `README.md` na raiz com o passo a passo de clone e subida, o aviso de que a criptografia ainda é falsa, a estrutura do projeto e os links para `docs/`.
- **Critério de aceite**: repositório não versiona segredos; um dev novo cria o `.env` só a partir do `.env.example`, sem perguntar nada a ninguém.

### 1.6 Configurar o ambiente de testes JS ✅
- `package.json` com `"type": "module"` (os módulos do app são ESM), scripts `test` (`vitest run`) e `test:watch`.
- `vitest` e `fake-indexeddb` como devDependencies; `package-lock.json` versionado.
- Executar pelo serviço `js` do compose (`docker compose run --rm js npm test`), não pelo Node do host — assim todos usam a mesma versão.
- Suíte inicial em `tests/`, cobrindo os dois módulos que já são reais:
  - `format.test.js` — layout do cabeçalho D5 offset a offset, round-trip `pack`/`unpack`, equivalência entre `buildAad` e o prefixo de `pack`, e cada caminho de rejeição (magic, versão, bits reservados, `sender_id`, truncado, IV com tamanho errado, ciphertext vazio).
  - `pipeline.test.js` — round-trip `composeMessage`/`readMessage` em 6 tipos de texto, unicidade do IV, coerência das estatísticas e recusa de entradas inválidas.
- **Critério de aceite**: `docker compose run --rm js npm test` passa numa máquina sem Node instalado. **36 testes, 2 arquivos.**

> Adiantou boa parte do 14.3. Quando os Épicos 3 e 4 trouxerem as implementações reais, `pipeline.test.js` passa a exercitar Huffman e AES-GCM de verdade sem precisar mudar — os testes usam apenas o contrato do 0.3.

### 1.7 Convenções de ambiente local (equipe) ✅
> Ver **D10**. Cada dev roda o próprio servidor e o próprio SQLite — não há ambiente compartilhado no fluxo de desenvolvimento.

**Testar os 2 usuários numa única máquina.** Não é preciso segunda máquina nem deploy: use duas origens diferentes apontando para o mesmo servidor.

| Usuário | URL |
|---|---|
| A | `http://localhost:8000` |
| B | `http://127.0.0.1:8000` |

Os dois são contexto seguro, mas o navegador os trata como **origens distintas**, o que dá:
- **cookies separados** — dá para estar logado como A numa aba e como B na outra simultaneamente;
- **IndexedDB separado** — cada aba tem seu próprio par de chaves ECDH, exatamente como dois dispositivos reais.

**Configurar o `settings.py` uma vez, para servir a todos os devs** (inclusive os túneis efêmeros do 16.3, cujo subdomínio muda a cada execução):
```python
if DEBUG:
    ALLOWED_HOSTS = ["localhost", "127.0.0.1", ".trycloudflare.com", ".ngrok-free.app"]
    CSRF_TRUSTED_ORIGINS = ["https://*.trycloudflare.com", "https://*.ngrok-free.app"]
```

**O Docker não muda nada nisso.** A porta publicada pelo compose responde tanto em `localhost:8000` quanto em `127.0.0.1:8000`, e as duas continuam sendo contexto seguro.

- **Critério de aceite**: um dev consegue executar o fluxo completo A compõe → arquivo → B decifra em uma única máquina, em duas abas, sem configuração adicional.

### 1.8 Guarda de contexto seguro (`environment.js`) ✅
Sem essa guarda, abrir a aplicação pelo IP da rede produz um erro que parece bug de criptografia. Com ela, vira uma mensagem de uma linha que qualquer dev resolve em segundos.

```js
// messenger/static/messenger/js/environment.js
export class ErroAmbiente extends Error {
  constructor(titulo, detalhe) { super(titulo); this.titulo = titulo; this.detalhe = detalhe; }
}

export function requireSecureContext() {
  if (!window.isSecureContext) {
    throw new ErroAmbiente(
      "HTTPS obrigatório",
      `O navegador só libera as funções de criptografia em https:// ou localhost. ` +
      `Esta página foi aberta em ${location.protocol}//${location.host}.`
    );
  }
  if (!window.crypto?.subtle) {
    throw new ErroAmbiente(
      "Navegador sem suporte",
      "A Web Crypto API não está disponível neste navegador."
    );
  }
}
```

- Chamar **uma vez** no início do `app.js`, antes de qualquer outra coisa.
- Em caso de erro, renderizar uma tela cheia de bloqueio exibindo `titulo` e `detalhe` — nunca deixar as features falharem individualmente.
- **Critério de aceite**: acessar a aplicação por `http://<ip-da-rede>:8000` exibe a mensagem explicativa, e não um erro de JS no console.

### 1.9 `Dockerfile` multi-stage ✅
> Ver **D12**. ✅ Entregue.

- Quatro estágios: `base` (Python 3.12 slim + variáveis), `deps` (`pip install` em prefixo isolado, camada reconstruída só quando `requirements.txt` muda), `dev` (usuário não-root com `UID`/`GID` do host, código por bind mount) e `prod` (código copiado, `collectstatic`, gunicorn).
- O alvo `dev` **não copia o código** — ele vem por bind mount, para o autoreload funcionar.
- O alvo `prod` é o mesmo usado pelo CI e pelo deploy (16.2), garantindo que o time testa a imagem que vai ao ar.
- `UID`/`GID` como `ARG`, alimentados pelo `.env`, evitam que arquivos gerados dentro do container (migrations, `startapp`) pertençam a `root` no host. No Linux, o dev ajusta para os valores de `id -u`/`id -g`.
- **Não** criar volume sobre `site-packages`: o bind mount cobre `/app`, e as dependências ficam fora dele. Um volume ali só produziria dependências obsoletas.
- **Critério de aceite**: `docker compose build` funciona em máquina limpa; um arquivo criado pelo `startapp` é editável pelo dev no host.

### 1.10 `docker-compose.yml` e `.dockerignore` ✅
> ✅ Entregue.

- Quatro serviços: `db` (Postgres, com healthcheck), `web` (Django, bind mount, porta 8000), `js` (Node 22 para o Vitest) e `tunnel` (cloudflared).
- `js` e `tunnel` ficam sob **profiles** (`tools` e `tunnel`): `docker compose up` sobe apenas `db` e `web`.
- Volume nomeado `node_modules` é obrigatório — sem ele o bind mount do host sobrescreve o do container.
- Portas do host configuráveis por `.env` (`WEB_PORT`, `DB_PORT`), com padrões `8000` e `5433`. Assim um conflito local — comum quando o dev tem containers de outros projetos rodando — é resolvido sem editar arquivo versionado.
- `runserver` precisa escutar em `0.0.0.0:8000`; no loopback do container ele fica inalcançável pelo mapeamento de porta. É o erro nº 1 ao containerizar Django.
- `.dockerignore` exclui `.git`, `venv/`, `node_modules/`, `.env`, `docs/` e artefatos — sem ele o build fica lento e bibliotecas compiladas para o SO errado entram na imagem.
- **Critério de aceite**: `docker compose up` sobe dois serviços; `docker compose run --rm js npm test` roda sem Node instalado no host.

### 1.11 Documentação de infraestrutura ✅
> ✅ Entregue: [`infraestrutura.md`](infraestrutura.md).

- **Sem `Makefile`.** O projeto usa `docker compose` direto: funciona igual em PowerShell, Git Bash, WSL, macOS e Linux, sem nenhuma instalação além do Docker. `make` não vem no Windows por padrão, e exigir a instalação acrescentaria um passo de onboarding para eliminar digitação — troca ruim.
- Todos os comandos seguem um único padrão: `docker compose run --rm web python manage.py <comando>`.
- Quem quiser encurtar usa um alias de shell pessoal (documentado em [`infraestrutura.md`](infraestrutura.md#7-comandos-do-dia-a-dia)), que não entra no repositório.
- Toda a explicação operacional vive no `infraestrutura.md`; os arquivos de configuração ficam **sem comentários**.
- **Critério de aceite**: um dev novo sobe o ambiente seguindo apenas o `infraestrutura.md`, sem instalar nada além do Docker.

---

## Épico 2 — Autenticação (2 usuários fixos)

### 2.1 Criar model `Profile` (extensão do `User`)
- `Profile` em `messenger/models.py` com:
  - `user` — `OneToOneField(User)`
  - `ecdh_public_key` — `TextField(blank=True)`, chave pública em formato JWK serializado
  - `key_registered_at` — `DateTimeField(null=True)`
  - `fingerprint_verified` — `BooleanField(default=False)` (usado no Épico 11)
- **Critério de aceite**: model aparece no banco; relação `user.profile` funciona no shell do Django.

### 2.2 Criar management command de seed
- `messenger/management/commands/seed_users.py`.
- Criar os 2 usuários fixos com `User.objects.get_or_create(...)` (idempotente) e o `Profile` correspondente.
- Senhas iniciais vêm de variável de ambiente, nunca hardcoded.
- Falhar com mensagem clara se as variáveis não estiverem definidas.
- **Critério de aceite**: rodar `python manage.py seed_users` duas vezes não duplica usuários nem gera erro.

### 2.3 Views de login/logout
- Usar `django.contrib.auth.views.LoginView` e `LogoutView` no `urls.py`.
- Template customizado `login.html`.
- Configurar `LOGIN_URL`, `LOGIN_REDIRECT_URL`, `LOGOUT_REDIRECT_URL` em `settings.py`.
- **Critério de aceite**: login com credenciais corretas redireciona para a home; credenciais erradas mostram mensagem de erro.

### 2.4 Proteger views internas
- Aplicar `LoginRequiredMixin` ou `@login_required` em todas as views do app, exceto login.
- **Critério de aceite**: acessar qualquer URL interna sem login redireciona para `/login/`.

### 2.5 Helper `get_other_user()`
- Função utilitária que, dado o usuário logado, retorna o outro `User` do sistema.
- Deve falhar de forma explícita se não houver exatamente 2 usuários — é uma premissa do sistema inteiro.
- **Critério de aceite**: com 2 usuários, retorna sempre o outro; com 1 ou 3+, lança exceção com mensagem clara.

### 2.6 Registrar no Django Admin
- Registrar `Profile` exibindo `user`, `ecdh_public_key` (somente leitura), `key_registered_at` e `fingerprint_verified`.
- **Critério de aceite**: superusuário consegue ver as chaves públicas cadastradas via `/admin/`.

---

## Épico 3 — Compressão: Huffman (JS) ✅

> Ver **D1, D2, D3**. Alfabeto = bytes `0..255` + `EOF` (índice 256).

### 3.1 Levantar a tabela de frequência de bytes (PT-BR) ✅
- Script `tools/generate-frequency-table.js` lê o corpus de `tools/corpus/`, conta a frequência de cada byte e escreve o módulo `frequency-table.js`.
- Frequência mínima **1** para todo byte que não apareceu, para que **todos os 256 bytes tenham código** — sem isso, um byte inesperado quebraria o `encode`. Frequência **1** também para o `EOF`.
- Saída em módulo próprio (`messenger/static/messenger/js/frequency-table.js`), e não dentro do `huffman.js`: um literal de 257 números deixaria o codec ilegível, e um módulo separado deixa claro que é **dado gerado**. Ele exporta também `SOURCE`, com o gerador e o corpus de origem — provenência como dado, já que o código não leva comentários.
- **Corpus (570 KB, todo em domínio público):** três obras de Machado de Assis via Project Gutenberg e o texto da Constituição de 1988. Fontes e situação legal em [`tools/corpus/FONTES.md`](../tools/corpus/FONTES.md).
- **Critério de aceite**: 257 entradas, todas ≥ 1, commitada como constante e não recalculada em runtime. **20 testes** em `tests/frequency-table.test.js`.

> **A medição mudou a escolha do corpus.** Com apenas as obras de Machado, `à` e `â` ficavam no piso da tabela (frequência 1) e custavam **24 bits** cada — como ocupam 2 bytes em UTF-8, a compressão os *expandia*. A causa é a ortografia de época dos textos do Gutenberg ("vae", "titulo", "aquella"), que quase não usa crase — e `à` é comuníssimo em português moderno.
>
> Acrescentar a Constituição (moderna, extensa, domínio público) levou `à` de 24,3 para 17,3 bits e tirou todos os acentuados comuns do piso. Em frase típica de chat, a estimativa de compressão foi de −31,4% para −33,0%.
>
> O teste `mantém %s acima do piso da tabela` trava essa propriedade: se alguém regenerar a tabela com um corpus ruim, a suíte acusa na hora.

### 3.2 Construir a árvore de Huffman canônica ✅
- `buildCodebook(frequencies)` em `huffman-codebook.js` → `{ lengths, codes, symbolsInCanonicalOrder, minLength, maxLength, countByLength, firstCode, firstIndex }`. O módulo também exporta `CODEBOOK`, já construído a partir da tabela do 3.1.
- Min-heap com **desempate pelo menor índice de símbolo** (D3). Nós internos herdam o menor índice da própria subárvore, o que torna a comparação uma ordem total — sem isso, dois nós de mesmo peso poderiam trocar de lugar entre execuções.
- A árvore é usada **apenas para medir os comprimentos** e depois descartada. Os códigos são reatribuídos na forma canônica: símbolos ordenados por (comprimento, índice) recebem valores incrementais.
- A atribuição usa multiplicação (`code *= 2 ** delta`) em vez de deslocamento à esquerda: `<<` em JavaScript opera em 32 bits com sinal e corromperia códigos longos.
- Em vez de materializar a árvore para decodificar, o códebook carrega o **índice canônico** (`firstCode`, `firstIndex`, `countByLength`) — decodificação em tempo constante por bit, sem alocar nós.
- **Critério de aceite**: 100 construções seguidas produzem `lengths` e `codes` idênticos; nenhum comprimento excede 32 bits. **35 testes** em `tests/huffman-codebook.test.js`.

**Endurecimento da validação de entrada** (revisão de código posterior). `buildCodebook` é exportado e valida o que recebe, então a validação precisa ser sólida mesmo para entradas que a aplicação nunca produz:

- **Profundidade era medida direto num `Uint8Array`**, antes da checagem de `MAX_CODE_LENGTH`. Uma profundidade de 256 viraria 0 por truncamento, e um códebook inválido passaria pela checagem. Medição passou a usar array comum; a conversão para `Uint8Array` só acontece depois de validar. Na prática a aritmética de ponto flutuante limitava a profundidade a 255 — mas depender disso é segurança acidental, não garantia.
- **A checagem `frequency >= 1` aceitava strings por coerção.** `"1" >= 1` é verdadeiro, e o valor chegava a `left.weight + right.weight`, onde JavaScript **concatena** em vez de somar: `"1" + "1"` dá `"11"`. A árvore resultante não era a de Huffman para as frequências informadas, e nada acusava. Trocado por `Number.isInteger(frequency) && frequency >= 1`, que rejeita string, `NaN`, `Infinity`, fracionário, `null` e objeto sem precisar de checagem de tipo à parte.
- **Nova guarda de determinismo:** a soma das frequências precisa caber em `Number.MAX_SAFE_INTEGER`. Acima disso a adição de doubles deixa de ser exata, empates aparecem por arredondamento e a árvore perde a reprodutibilidade que D3 exige. Nenhuma tabela real chega perto — o pior caso com `Uint32Array` é ~1,1×10¹², contra o limite de 9×10¹⁵.

Nenhuma dessas correções altera o códebook real: min 3 / max 20 bits e Kraft = 1, iguais a antes.

**Resultado medido sobre o corpus do 3.1:**

| Métrica | Valor |
|---|---|
| Comprimento mínimo / máximo | 3 / **20 bits** |
| Igualdade de Kraft | **exatamente 1** (código completo) |
| Bits por byte | **4,6306** |
| Entropia do corpus | 4,5937 |
| Excesso sobre a entropia | **0,80%** |
| Compressão esperada | **−42,1%** |

Os códigos de 3 bits ficaram com o espaço e o `a`; as vogais restantes e o `r`/`s` com 4 bits. Os 143 símbolos de 19 bits são os bytes que nunca aparecem no corpus e estão no piso da tabela.

> Os testes travam as propriedades que importam: determinismo em 100 execuções, ausência de prefixo entre quaisquer dois códigos (força bruta sobre os 257×257 pares), igualdade de Kraft, otimalidade (nenhum símbolo mais frequente recebe código mais longo) e consistência do índice de decodificação com os códigos.

### 3.3 Implementar `encode(text)` ✅
- `TextEncoder` para obter os bytes UTF-8; emite o código de cada byte, depois o do `EOF`, empacotando os bits **MSB-first** dentro de cada byte.
- O acumulador de bits usa **aritmética** (`acc * 2 ** length + code`), não deslocamento. `<<` opera em 32 bits com sinal e corromperia a saída se um código longo coincidisse com bits pendentes.
- O buffer de saída é alocado **exatamente**: a soma dos comprimentos dos códigos é conhecida antes de escrever, então não há realocação.
- **Fallback de expansão** (D5): se o resultado ficar maior ou igual ao UTF-8 original, devolve `{ bytes: utf8Original, compressed: false }`.
- **Critério de aceite**: parágrafo PT-BR de ≥ 300 caracteres dá taxa ≤ 0,65 com `compressed === true`; `"oi"` dá `compressed === false`. ✅

### 3.4 Implementar `decode(bytes, compressed)` ✅
- Com `compressed === false`, apenas `TextDecoder`. Com `true`, percorre os bits usando o **índice canônico** do 3.2 (`firstCode`/`firstIndex`/`countByLength`) — sem árvore materializada, sem alocar nós.
- O buffer de saída também é alocado de uma vez: cada símbolo consome no mínimo `minLength` bits, então `bytes.length × 8 / minLength` é um teto exato.
- Lança `HuffmanError` se os bits acabarem antes do `EOF`, com a mensagem de arquivo truncado prevista em 9.5.
- `TextDecoder` em modo `fatal` — bytes que não formam UTF-8 válido viram erro, nunca texto com caracteres de substituição.
- **Critério de aceite**: `decode(...encode(text)) === text` em todos os casos do 3.5. ✅

### 3.5 Testes unitários do módulo Huffman ✅
**30 testes** em `tests/huffman.test.js`, cobrindo o que o item pedia e mais:
- 14 round-trips: acentos, cedilha, til, **crase**, texto vazio, um caractere, só espaços, quebras de linha (incluindo `\r\n`), emoji, CJK, cirílico, grego, pontuação pesada e dígitos.
- Faixa Latin-1 completa (256 caracteres) e um texto cobrindo **todas as larguras de UTF-8** (1 a 4 bytes) — a validação de que D1 eliminou o problema do escape.
- Fallback nos dois sentidos, e a garantia de que `encode` **nunca** devolve resultado maior que o UTF-8 original.
- Truncamento: 11 cortes diferentes no fim do fluxo, exigindo erro ou texto diferente do original — nunca texto parcial silencioso.
- Desempenho: 100 mil caracteres em ida e volta.

**Compressão medida (round-trip verificado em todos):**

| Texto | Original | Comprimido | Taxa |
|---|---|---|---|
| Parágrafo PT-BR (313 B) | 313 B | 176 B | **−43,8%** |
| Chat longo | 279 B | 166 B | **−40,5%** |
| Texto formal | 172 B | 100 B | **−41,9%** |
| Chat curto | 46 B | 34 B | −26,1% |
| `"oi"` | 2 B | 2 B | 0% (fallback) |
| Só emoji | 16 B | 16 B | 0% (fallback) |

> O fallback dispara exatamente onde deveria: texto curto demais para amortizar o EOF, e conteúdo cujos bytes estão no piso da tabela. Em nenhum caso o arquivo cresce.

### 3.6 Medir a taxa de compressão ✅
- `stats(text)` devolve `{ characters, originalBytes, compressedBytes, compressed, ratio, bitsPerChar, originalBitsPerChar }`. O campo `originalBitsPerChar` foi acrescentado para o painel poder comparar o custo do Huffman com o do UTF-8 puro, que é o número mais didático da tela.
- `measure(text, encoded)` calcula os mesmos números **a partir de um `encode` já feito**. O `composeMessage` usa essa via: antes ele recalculava tamanho e taxa por conta própria, duplicando a lógica e reprocessando o texto. Agora há uma fonte única.
- `encode` passou a devolver também `originalBytes` — extensão aditiva ao contrato do 0.3, que não quebra nenhum consumidor e elimina o reprocessamento do texto só para saber seu tamanho.
- Painel ligado no `compose.js`, com as quatro linhas previstas no 7.5.
- **Critério de aceite**: os números batem com o cálculo manual. ✅ **35 testes** em `tests/huffman.test.js`.

**Painel como aparece na tela:**

```
Compressão
  Original             268 B · 256 caracteres
  Após Huffman         158 B · -41,0%
  Arquivo final        185 B · -31,0%
  Bits por caractere   4,94 · UTF-8 usaria 8,38
```

> **O painel expôs um comportamento que precisava de explicação.** Em mensagens curtas o *arquivo* cresce — "Chego às 19h" vira 40 B a partir de 13 B, +207,7% — porque o cabeçalho do D5 tem 27 bytes fixos. Sem contexto, o número parece defeito.
>
> A tela passou a exibir uma nota quando isso acontece, explicando que o cabeçalho é custo fixo e que a partir de algumas centenas de caracteres o arquivo já sai menor que o texto original. Dois testes travam os dois lados desse ponto de equilíbrio.

---

## Épico 4 — Chaves e Cifragem (JS, Web Crypto API)

> Ver **D4** para os parâmetros exatos de derivação, **D10** para o requisito de contexto seguro e **D11** para a estratégia de recuperação da chave.

### 4.1 Gerar par de chaves ECDH no navegador ✅
> Implementado em `keys.js`, módulo novo. A separação é deliberada: `keystore.js` cuida só de persistência e não sabe nada de criptografia; `keys.js` cuida do ciclo de vida das chaves e usa o keystore. Os itens 4.4 e 11.1 vão acrescentar cache da chave do outro e fingerprint sem misturar as duas responsabilidades.

- `generateKeyPair()` → `crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"])`.
- `ensureKeyPair()` → devolve `{ pair, created }`; só gera se o keystore estiver vazio.
- `requireSecureContext()` (1.8) chamado antes de qualquer operação.
- `exportPublicKey()`, `importPublicKey()` e `validatePublicJwk()` já entram aqui, prontos para o 4.3 e o 4.4. A exportação devolve **apenas** `kty`, `crv`, `x`, `y` — nunca o `d`, que é o segredo.
- **Chave privada extraível (`extractable: true`)** — exigência da camada 2 de D11: sem isso não há como exportar o backup `.msgkey` (11.3). O custo é que um XSS com acesso ao IndexedDB consegue exfiltrar a chave; é a CSP do 13.3 que reduz esse risco.
- **Critério de aceite**: primeiro acesso gera par único; acessos seguintes reutilizam. ✅ **19 testes** em `tests/keys.test.js`.

### 4.2 Persistir as chaves localmente (`keystore.js`) ✅
- `CryptoKey` guardado **diretamente** no IndexedDB, sem passar por JWK. Confirmado no ambiente de teste antes de implementar: `structuredClone` de `CryptoKey` e gravação no `fake-indexeddb` funcionam, e a chave lida ainda deriva bits.
- Nunca `localStorage`.
- API: `loadKeyPair()`, `saveKeyPair(pair)`, `hasKeyPair()`, `deleteKeyPair()`, mais `closeDatabase()` para desfazer a conexão memoizada.
- A conexão é memoizada, com `onversionchange` fechando e limpando o cache — sem isso, uma aba que abrisse versão nova do banco travaria a outra.
- `loadKeyPair()` valida o que leu: conteúdo corrompido vira erro explícito com instrução de restaurar o backup, em vez de um `TypeError` mais adiante.
- **Critério de aceite**: ao recarregar a página, a chave privada é recuperada sem gerar uma nova. ✅ **15 testes** em `tests/keystore.test.js`.

**Ajuste no `environment.js`.** Ele usava `window.isSecureContext` e `window.crypto`. Trocado por `globalThis`: equivalente no navegador, **funciona em Web Worker** (onde `window` não existe) e torna o módulo testável fora do DOM. O `location` na mensagem de erro passou a ser opcional pelo mesmo motivo.

**Infraestrutura de teste.** `vitest.config.js` com `tests/setup.js`, que carrega `fake-indexeddb/auto` e define `isSecureContext`. Sem isso, nenhum teste que toque em chaves rodaria.

### 4.3 Endpoints de chave pública (Django)
> Movido para cá porque o 4.4 depende dele — no backlog anterior estava dois épicos à frente.

- `POST /api/public-key/` — salva a JWK da chave pública no `Profile` do usuário logado.
  - **Write-once:** rejeitar com `409 Conflict` se o campo já estiver preenchido. Trocar a chave exige intervenção via Admin (e reverificação do fingerprint, Épico 11).
  - Validar que o corpo é uma JWK de curva P-256 com os campos esperados.
- `GET /api/public-key/<username>/` — retorna a JWK do outro usuário.
- **Critério de aceite**: só usuário autenticado acessa; retorna `404` para usuário inexistente; segundo `POST` retorna `409`.

### 4.4 Publicar a chave pública e buscar a do outro
- Exportar com `crypto.subtle.exportKey("jwk", publicKey)` e enviar via `POST` (4.3) no primeiro login.
- Buscar a JWK do outro usuário e importar com `crypto.subtle.importKey("jwk", ...)`.
- Cachear a chave pública do outro no IndexedDB, para não depender do servidor a cada operação.
- **Critério de aceite**: chave pública aparece no Django Admin após o primeiro login de cada usuário.

### 4.5 Derivar o segredo compartilhado
Implementar exatamente conforme **D4**:
```js
const segredo   = await crypto.subtle.deriveBits({ name: "ECDH", public: pubDoOutro }, privLocal, 256);
const hkdfKey   = await crypto.subtle.importKey("raw", segredo, "HKDF", false, ["deriveKey"]);
const aesKey  = await crypto.subtle.deriveKey(
  { name: "HKDF", hash: "SHA-256", salt, info },
  hkdfKey,
  { name: "AES-GCM", length: 256 },
  false,                      // não extraível
  ["encrypt", "decrypt"]
);
```
- `salt` e `info` construídos como especificado em D4.
- A chave derivada é marcada como **não extraível**.
- **Critério de aceite**: os dois usuários, independentemente, derivam a mesma chave — validado por um teste que simula os dois lados e compara um ciphertext cruzado (A cifra, B decifra).

### 4.6 Implementar `encrypt(bytes, aesKey, aad)`
- IV aleatório de 96 bits com `crypto.getRandomValues` — **único por mensagem**.
- `crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, aesKey, bytes)`.
- Retornar `{ iv, ciphertext }` (a tag de 16 bytes já vem embutida no ciphertext).
- **Critério de aceite**: cifrar o mesmo texto duas vezes gera IVs e ciphertexts diferentes.

### 4.7 Implementar `decrypt(iv, ciphertext, aesKey, aad)`
- `crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, aesKey, ciphertext)`.
- Capturar a falha de verificação de autenticidade e traduzir para um erro tipado do app (`AuthenticationError`), não deixar vazar o `OperationError` cru da Web Crypto.
- **Critério de aceite**: alterar 1 byte do ciphertext, do IV **ou do AAD** faz a função lançar `AuthenticationError`.

### 4.8 Testes do módulo de cifragem
- Round-trip com textos variados e com payload vazio.
- Rejeição de ciphertext adulterado (1 bit trocado).
- Rejeição de IV incorreto.
- **Rejeição de AAD adulterado** — cobre a proteção do cabeçalho (D5).
- Rejeição com chave derivada de um `info` diferente.
- **Critério de aceite**: todos os casos de adulteração lançam erro; nenhum decodifica silenciosamente para lixo.

### 4.9 Solicitar armazenamento persistente
Por padrão, o navegador pode limpar o IndexedDB sozinho sob pressão de disco — e junto vai a chave privada. Uma chamada reduz bastante esse risco:

```js
if (navigator.storage?.persist) {
  const persistido = await navigator.storage.persist();
  // false → armazenamento volátil; insistir no backup (Épico 11)
}
```

- Chamar no boot, logo após `requireSecureContext()`.
- **Não tentar detectar aba anônima** — as heurísticas para isso são frágeis e quebram a cada versão de navegador. O retorno `false` desta chamada já é o sinal confiável: qualquer que seja o motivo (aba anônima, configuração restritiva, pouco espaço), o armazenamento é volátil e o app deve insistir no backup.
- Registrar o resultado no indicador de estado criptográfico (12.4).
- **Critério de aceite**: o resultado da chamada fica visível na interface; quando `false`, o app exibe aviso e destaca a ação de backup.

---

## Épico 5 — Formato de Arquivo `.msgenc`

> Especificação completa em **D5**. Este épico implementa e documenta.

### 5.1 Implementar `pack()` e `unpack()` (`format.js`)
- `pack({ senderId, createdAt, compressed, iv, ciphertext })` → `Uint8Array` com o layout de D5.
- `unpack(bytes)` → todos os campos **mais o `aad`** (os primeiros 15 bytes), necessário para a decifragem.
- Usar `DataView` para os campos multibyte (`created_at` em big-endian).
- **Critério de aceite**: `unpack(empacotar(x))` devolve `x` campo a campo; o `aad` retornado é exatamente `bytes.slice(0, 15)`.

### 5.2 Validação estrita na leitura
Rejeitar **antes** de tentar decifrar, com mensagens distintas para cada caso:
- Arquivo menor que 28 bytes (cabeçalho + pelo menos a tag).
- `magic` diferente de `"MENC"` → "este arquivo não é uma mensagem do app".
- `version` desconhecida → "arquivo gerado por uma versão mais nova do app".
- `flags` com bits reservados diferentes de zero.
- `sender_id` fora de `{0, 1}`.
- `created_at` absurdo (antes de 2024 ou mais de 24h no futuro) → aviso, não bloqueio.
- **Critério de aceite**: cada caso produz uma mensagem específica; nenhum arquivo malformado chega a `crypto.subtle.decrypt`.

### 5.3 Exportação: download do arquivo
- `Blob` a partir do `Uint8Array` com tipo `application/octet-stream`, `URL.createObjectURL`, link com `download`.
- Nome sugerido: `msg-<AAAAMMDD-HHmmss>.msgenc`.
- Liberar a URL com `URL.revokeObjectURL` após o clique.
- **Critério de aceite**: o arquivo baixado, reimportado no próprio app, decifra corretamente.

### 5.4 Importação: leitura do arquivo
- `input type="file"` **e** drag-and-drop, ambos levando ao mesmo handler.
- Ler com `file.arrayBuffer()`.
- **Critério de aceite**: as duas formas de entrada produzem o mesmo resultado.

### 5.5 Formato armored (`armor.js`)
> Ver **D6**.
- `toArmor(bytes)` → string com cabeçalho, base64 em linhas de 64 caracteres, e rodapé.
- `fromArmor(text)` → `Uint8Array`. Deve ser tolerante: ignorar espaços em branco, quebras de linha extras e texto antes/depois dos marcadores (o WhatsApp costuma adicionar contexto ao redor do que foi colado).
- **Critério de aceite**: `fromArmor(paraArmor(b))` devolve `b`; texto colado com lixo em volta ainda funciona; texto sem os marcadores é rejeitado com mensagem clara.

### 5.6 Documentar em `FORMATO.md`
- Tabela de campos, exemplo de arquivo real em hex, exemplo de bloco armored, e o algoritmo de derivação de chave (D4).
- **Critério de aceite**: documento suficiente para reimplementar o parser do zero em outra linguagem.

---

## Épico 6 — API Django (histórico)

### 6.1 Model `Message`
- Campos:
  - `sender` — `FK(User, related_name="sent")`
  - `recipient` — `FK(User, related_name="received")`
  - `blob` — `BinaryField()` — o arquivo `.msgenc` completo, exatamente como gerado
  - `created_at` — `DateTimeField()` — extraído do cabeçalho, informado pelo cliente (D7)
  - `received_at` — `DateTimeField(auto_now_add=True)` (D7)
  - `direction` — `CharField(choices=["sent", "received"])` — sob a perspectiva de quem gravou
- Guardar o blob inteiro (e não `iv`/`ciphertext` separados) simplifica: o servidor não precisa entender o formato, e o cliente recebe de volta exatamente o que precisa para decifrar.
- Índice em `(recipient, -received_at)`.
- **Critério de aceite**: `makemigrations`/`migrate` aplicados sem erro.

### 6.2 Endpoint: salvar mensagem no histórico
- `POST /api/messages/` — recebe o blob binário (base64 no corpo JSON) e `direction`.
- O servidor **valida o cabeçalho** (magic, version, tamanho mínimo) mas nunca tenta decifrar.
- `sender`/`recipient` derivados do usuário logado e de `get_other_user()` (2.5) conforme o `direction` — nunca aceitos do cliente.
- `created_at` extraído do cabeçalho pelo servidor, não de um campo JSON separado.
- **Critério de aceite**: mensagem salva com os dois usuários corretos; um cliente que tente informar outro remetente é ignorado.

### 6.3 Endpoint: listar histórico
- `GET /api/messages/?page=N` — mensagens onde o usuário logado é remetente **ou** destinatário, mais recentes primeiro.
- Retornar apenas metadados (`id`, `sender`, `recipient`, `created_at`, `received_at`, `size`), **não** o blob.
- Usar `Paginator` do Django.
- **Critério de aceite**: usuário só vê mensagens em que participa; a resposta não contém nenhum byte de ciphertext.

### 6.4 Endpoint: buscar blob específico
- `GET /api/messages/<id>/blob/` — retorna o blob em base64 para re-decifrar no navegador.
- **Critério de aceite**: retorna `403` se o usuário logado não for remetente nem destinatário.

### 6.5 Endpoint: deduplicação
- `HEAD /api/messages/?hash=<sha256-do-blob>` — permite ao cliente saber se uma mensagem já está no histórico antes de gravar.
- Evita duplicatas quando o usuário importa o mesmo arquivo duas vezes.
- **Critério de aceite**: importar o mesmo arquivo duas vezes gera apenas um registro.

### 6.6 Proteção CSRF nas chamadas JS
- Incluir `{% csrf_token %}` no template e enviar em `X-CSRFToken` em todo `fetch` de escrita.
- Criar um helper `apiPost(url, data)` que faz isso automaticamente — evita esquecer em algum lugar.
- **Critério de aceite**: requisições POST sem o token são rejeitadas pelo Django.

### 6.7 Registrar `Message` no Django Admin
- Exibir `sender`, `recipient`, `created_at`, `received_at`, tamanho do blob.
- **Nunca** exibir o conteúdo do blob nem oferecer ação de decifrar.
- `has_change_permission = False` — o histórico é imutável.
- **Critério de aceite**: superusuário vê metadados, mas não o conteúdo, e não consegue editar.

### 6.8 Endpoints de backup da chave privada
> Camada 1 de **D11**. É a diferença entre "espero ainda ter aquele arquivo de meses atrás" e "faço login e digito a senha".

- Model `KeyBackup`: `user` (FK), `blob` (`BinaryField`), `created_at` (`auto_now_add`). Versionado — cada novo backup cria um registro, o mais recente é o ativo.
- `POST /api/key-backup/` — recebe o blob em base64 e grava.
- `GET /api/key-backup/` — retorna o blob mais recente do usuário logado, ou `404` se não houver.
- O `blob` é a chave privada em JWK, cifrada com AES-GCM sob chave derivada por PBKDF2 (600.000 iterações) da **senha de backup**, que é distinta da senha de login e nunca sai do navegador.
- Para o servidor é um array de bytes opaco — **o modelo de ameaça não muda**, ele continua sem conseguir ler nada.
- Registrar no Admin exibindo apenas `user`, `created_at` e tamanho; nunca o conteúdo.
- **Critério de aceite**: o blob armazenado, aberto em editor hex, não contém a chave em claro; `GET` de outro usuário retorna `404`.

---

## Épico 7 — Fluxo de Envio ("Compositor")

### 7.1 Template de composição
- `compor.html` com `<textarea>`, contador de caracteres e botão "Gerar mensagem criptografada".
- **Critério de aceite**: página renderiza e é acessível só logado.

### 7.2 Orquestração do pipeline (`app.js`)
```
texto
  → huffman.encode          → { bytes, compressed }
  → montar AAD (15 bytes)   → magic|version|flags|senderId|createdAt
  → cipher.encrypt(bytes, aesKey, aad)
  → format.pack       → Uint8Array final
```
- Atenção à ordem: o AAD precisa ser montado **antes** de cifrar, porque entra na cifragem (4.6).
- **Critério de aceite**: pipeline completo executa sem erros; o `app.js` não mudou em relação ao contrato do Épico 0.3.

### 7.3 Salvar cópia no histórico
- Após gerar o arquivo, `POST /api/messages/` com `direction = "sent"` (6.2).
- **Critério de aceite**: mensagem aparece no histórico do remetente logo após a geração.

### 7.4 Feedback visual
- Estado de carregamento durante o processamento.
- Mensagem de sucesso ou erro específico por etapa que falhou (compressão / cifragem / envio ao histórico).
- Falha ao salvar no histórico **não** deve impedir o download do arquivo — são operações independentes.
- **Critério de aceite**: o usuário sempre recebe feedback; uma falha de rede não bloqueia a geração do arquivo.

### 7.5 Painel de estatísticas de compressão
> Esta é a evidência visual de que a árvore de Huffman está fazendo trabalho real — vale mais para a apresentação do que várias features.

Após gerar, exibir:
```
Original:         520 bytes  (500 caracteres)
Após Huffman:     269 bytes  (−48,3%)
Arquivo final:    303 bytes  (−41,7%)
Bits/caractere:   4,31       (UTF-8: 8,32)
```
- Quando o fallback do 3.3 for acionado, exibir "compressão dispensada (texto muito curto)".
- **Critério de aceite**: os números conferem com o tamanho real do arquivo baixado.

---

## Épico 8 — Compartilhamento (pen-drive, WhatsApp, e-mail)

> Este épico não existia no backlog anterior, apesar de ser o requisito central do projeto. Cada canal tem um detalhe próprio.

### 8.1 Pen-drive — download do arquivo
- Botão "Baixar arquivo `.msgenc`" (usa 5.3).
- Texto de apoio explicando que basta copiar para o pen-drive.
- **Critério de aceite**: arquivo baixado, copiado e reaberto em outra máquina decifra corretamente.

### 8.2 WhatsApp / e-mail — bloco de texto colável
- Botão "Copiar como texto" que gera o bloco armored (5.5) e usa `navigator.clipboard.writeText`.
- Resolve os dois canais sem depender de anexo, e funciona bem no celular.
- Confirmação visual ("copiado!") após o clique.
- **Critério de aceite**: o bloco copiado, colado no tradutor, decifra corretamente.

### 8.3 E-mail — instrução explícita sobre anexo
- **`mailto:` não consegue anexar arquivos.** Não tentar implementar isso.
- Oferecer duas opções na interface: "Copiar como texto" (8.2) ou "Baixar e anexar manualmente" (8.1), com o botão `mailto:` preenchendo apenas assunto e corpo com uma instrução.
- **Critério de aceite**: a interface não promete anexo automático em nenhum momento.

### 8.4 Compartilhamento nativo (progressive enhancement)
- Se `navigator.canShare?.({ files: [...] })` for verdadeiro, exibir botão "Compartilhar" usando `navigator.share`.
- Abre o menu nativo do sistema (Android/iOS), entregando WhatsApp, e-mail e mais em um clique.
- Se a API não existir, o botão simplesmente não aparece — os demais caminhos continuam funcionando.
- **Critério de aceite**: no desktop sem suporte, nada quebra; no celular com suporte, o menu nativo abre com o arquivo anexado.

### 8.5 Aviso sobre o canal
- Texto curto na interface: o arquivo é seguro para trafegar por qualquer canal, mas **a senha/verificação de identidade nunca deve ir pelo mesmo canal**.
- **Critério de aceite**: o aviso aparece na tela de compartilhamento.

---

## Épico 9 — Fluxo de Recebimento ("Tradutor")

### 9.1 Template do tradutor
- `tradutor.html` com três entradas equivalentes: seletor de arquivo, área de drag-and-drop, e `<textarea>` para colar o bloco armored.
- **Critério de aceite**: as três formas de entrada funcionam.

### 9.2 Orquestração do pipeline reverso
```
arquivo ou texto armored
  → (fromArmor, se for texto)
  → format.unpack    → campos + aad
  → validação estrita (5.2)
  → cipher.decrypt(iv, ciphertext, aesKey, aad)
  → huffman.decode(bytes, compressed)
  → texto
```
- **Critério de aceite**: mensagem original aparece corretamente para um arquivo válido.

### 9.3 Exibição da mensagem decodificada
- Área de leitura não editável, com o texto, a data de criação (`created_at`) e quem enviou (`sender_id`).
- Botão "copiar texto".
- **Critério de aceite**: o texto exibido é idêntico ao digitado pelo remetente.

### 9.4 Salvar no histórico do destinatário
> Faltava no backlog anterior: o Épico 7 salvava no envio, mas nada era gravado quando B importava o arquivo.

- Após decifrar com sucesso, `POST /api/messages/` com `direction = "received"` (6.2).
- Consultar antes o endpoint de deduplicação (6.5).
- **Critério de aceite**: importar um arquivo faz a mensagem aparecer no histórico do destinatário; importar duas vezes não duplica.

### 9.5 Tratamento de erros
Cada falha tem mensagem própria:

| Situação | Mensagem |
|---|---|
| Não é um `.msgenc` (magic errado) | "Este arquivo não é uma mensagem do aplicativo." |
| Versão desconhecida | "Arquivo gerado por uma versão mais nova do app." |
| Cabeçalho malformado | "Arquivo corrompido." |
| Falha na tag GCM | "Arquivo adulterado ou chave incorreta." |
| Chave do outro usuário ausente | "Ainda não foi feita a troca de chaves com o outro usuário." |
| Bits acabam antes do EOF | "Arquivo truncado — o download pode ter sido interrompido." |

- **Critério de aceite**: cada tipo de erro mostra sua mensagem; nenhum erro cru de JS aparece só no console.

---

## Épico 10 — Histórico de Mensagens

### 10.1 Template de listagem
- `historico.html`, listando enviadas e recebidas com data, direção e tamanho.
- Carrega via `GET /api/messages/` (6.3).
- **Critério de aceite**: lista carrega e renderiza corretamente.

### 10.2 Ação "decifrar novamente"
- Botão em cada item que busca o blob via 6.4 e roda o pipeline do 9.2.
- **Critério de aceite**: mensagem antiga é decifrada sem precisar do arquivo original.

### 10.3 Ação "baixar novamente"
- Reoferece o download do `.msgenc` original a partir do blob armazenado.
- **Critério de aceite**: o arquivo rebaixado é byte-a-byte idêntico ao original.

### 10.4 Paginação e filtros
- `Paginator` no endpoint; filtro por direção (enviadas/recebidas) e por intervalo de datas via query params.
- **Critério de aceite**: histórico com muitas mensagens carrega em páginas sem travar a tela.

### 10.5 Aviso de dependência da chave local
- Se não houver chave privada no IndexedDB, o histórico ainda lista as mensagens, mas exibe aviso: "o conteúdo não pode ser lido neste dispositivo — restaure sua chave (ver Épico 11)".
- **Critério de aceite**: sem chave local, a lista aparece com o aviso e sem erro de JS.

---

## Épico 11 — Confiança: verificação de identidade e backup de chave

> Este épico fecha dois furos do modelo de ameaça que o backlog anterior não cobria.

### 11.1 Verificação de fingerprint (defesa contra MITM do servidor)
**Problema:** o documento promete que "o servidor nunca vê texto puro", e é verdade — mas o servidor **distribui as chaves públicas** (4.3). Um servidor comprometido entrega a chave dele no lugar da chave do outro usuário e passa a ler tudo, sem que ninguém perceba. É exatamente o ataque que Signal e WhatsApp mitigam com o "código de segurança".

- Calcular `SHA-256` da JWK canônica da chave pública.
- Exibir em formato legível: 12 grupos de 4 dígitos hexadecimais, ou 6 palavras de uma wordlist curta em português.
- Tela "Verificação de identidade" mostrando **o meu fingerprint e o do outro usuário**, lado a lado.
- **Critério de aceite**: os dois usuários, em máquinas diferentes, veem o mesmo par de fingerprints.

### 11.2 Marcar como verificado
- Botão "Já conferi pessoalmente" que grava `fingerprint_verified = True` no `Profile`.
- Enquanto não verificado, exibir um aviso discreto e permanente no compositor.
- Se a chave pública do outro mudar, resetar a flag e exibir aviso destacado.
- **Critério de aceite**: a flag aparece no Admin; a mudança de chave reseta a verificação.

### 11.3 Cifrar a chave privada com senha (base das duas camadas de backup)
**Problema:** a chave privada existe **apenas** no IndexedDB. Limpar dados do navegador, trocar de máquina ou usar aba anônima significa perder o acesso a todo o histórico, permanentemente. É o cenário mais provável de a demonstração falhar no dia da apresentação.

- Exportar o par como JWK e cifrar com AES-GCM sob chave derivada de uma **senha de backup** via `PBKDF2` (SHA-256, **600.000 iterações** — recomendação atual da OWASP, ~0,5 s no desktop, salt aleatório de 16 bytes).
- A senha de backup é distinta da senha de login e nunca sai do navegador.
- O mesmo blob cifrado alimenta as **duas camadas** de D11: enviado ao servidor (6.8) e oferecido como download.
- Layout do arquivo `.msgkey`: `magic("MKEY") | version | iterações(uint32) | salt(16) | iv(12) | ciphertext`.
- Avisar que a senha não pode ser recuperada.
- **Critério de aceite**: o blob gerado não contém a chave em claro (verificável abrindo em editor hex); o mesmo blob é aceito tanto pelo endpoint quanto pelo importador de arquivo.

### 11.4 Importar a chave privada (restauração)
- Ler o `.msgkey`, pedir a senha, decifrar e gravar no IndexedDB.
- Senha errada → mensagem clara, sem revelar nada sobre a chave.
- **Critério de aceite**: restaurar em um navegador limpo dá acesso ao histórico completo; senha errada falha de forma limpa.

### 11.5 Onboarding de primeiro acesso
- Fluxo guiado no primeiro login: gerar chave → publicar chave pública → definir senha de backup → **enviar o backup ao servidor** (6.8) → **baixar o `.msgkey`** → verificar fingerprint.
- As duas camadas de backup são criadas no mesmo passo, a partir do mesmo blob (11.3) — para o usuário é uma ação só.
- **Critério de aceite**: o usuário não consegue chegar ao compositor sem ter passado pelo backup.

### 11.6 Recuperação a partir do backup no servidor
> Camada 1 de **D11** — o caminho principal de recuperação.

- No boot, se não houver chave no IndexedDB, consultar `GET /api/key-backup/` (6.8).
- Havendo backup, exibir: *"Detectamos um backup da sua chave. Digite a senha de backup para restaurar o acesso ao histórico."*
- Decifrar no navegador e gravar o par no IndexedDB.
- Senha errada → mensagem clara, sem revelar nada sobre a chave. Limitar tentativas no cliente para desencorajar força bruta local.
- **Critério de aceite**: em um navegador limpo, login mais senha de backup devolvem o histórico completo, sem precisar de arquivo nenhum.

### 11.7 Recuperação assistida pelo outro usuário
> Camada 3 de **D11** — último recurso, possível apenas porque o sistema tem exatamente 2 usuários.

Se um usuário perde a chave e nenhum backup funciona, o outro ainda tem a dele — e como todo o histórico está cifrado sob o mesmo segredo compartilhado estático, **ele consegue decifrar tudo**. O fluxo:

1. **A** gera um par novo e publica a nova pública (exige liberar o write-once de 4.3 via Admin).
2. **B** recebe aviso de que a chave de A mudou e **reverifica o fingerprint** (11.1). Este passo é obrigatório — é o que impede alguém de se passar por A.
3. **B** decifra todo o histórico com o segredo antigo, recifra com o novo e reenvia os blobs.
4. **A** recupera o acesso ao histórico completo.

- Todo o processo roda no navegador de B; o servidor continua vendo apenas blobs opacos.
- Processar em lotes, com barra de progresso — pode haver muitas mensagens.
- **Critério de aceite**: após a recuperação, A lê todas as mensagens anteriores à perda da chave; um teste automatizado cobre a recifragem de um histórico de ao menos 20 mensagens.

---

## Épico 12 — Interface e UX

### 12.1 Layout base
- Template `base.html` com navegação: Compor · Tradutor · Histórico · Identidade · Sair.
- Indicação de qual usuário está logado.
- **Critério de aceite**: navegação consistente em todas as páginas.

### 12.2 CSS próprio, sem framework
- Escopo pequeno demais para justificar Bootstrap/Tailwind. CSS único, com variáveis para as cores.
- Responsivo — o tradutor será usado no celular com frequência (8.4).
- **Critério de aceite**: as quatro telas funcionam em 360px de largura.

### 12.3 Estados de tela padronizados
- Componentes reutilizáveis para: carregando, sucesso, erro, vazio.
- **Critério de aceite**: nenhuma tela fica sem resposta visual durante uma operação assíncrona.

### 12.4 Indicador de estado criptográfico
- Badge permanente no cabeçalho, cobrindo cinco sinais: chave local presente? chave do outro conhecida? fingerprint verificado? backup no servidor criado? armazenamento persistente concedido (4.9)?
- Qualquer sinal negativo leva, com um clique, à ação que o resolve.
- **Critério de aceite**: o usuário identifica em um olhar se o canal está pronto para uso e se sua chave está protegida contra perda.

---

## Épico 13 — Segurança e Hardening

### 13.1 Auditoria de dados sensíveis
- Revisar todo o backend confirmando que texto puro e chaves privadas nunca chegam ao servidor.
- Buscar por `print(`, `logger.debug(` e `console.log(` em caminhos que tocam plaintext.
- **Critério de aceite**: checklist de revisão documentado, com cada endpoint listado e assinado.

### 13.2 Rate limiting no login
- `django-ratelimit` na view de login (ex.: 5 tentativas por IP a cada 15 minutos).
- **Critério de aceite**: exceder o limite bloqueia novas tentativas temporariamente.

### 13.3 Content Security Policy
- Cabeçalho CSP restritivo: `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'`.
- Sem `unsafe-inline` — todo JS em arquivo externo. Isso protege a chave privada no IndexedDB contra XSS, que é o vetor mais realista neste app.
- **Critério de aceite**: nenhum script inline no HTML; o console não reporta violações de CSP.

### 13.4 Configurações de produção
- `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SECURE_HSTS_SECONDS` ativos fora de `localhost`, via variável de ambiente.
- `SESSION_COOKIE_HTTPONLY = True` e `SESSION_COOKIE_SAMESITE = "Lax"`.
- ⚠️ **Atrás de proxy reverso** (Render, Railway, Fly — todos terminam o TLS no proxy e repassam HTTP para a aplicação):
  ```python
  SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
  ```
  Sem essa linha, o Django vê "HTTP", `SECURE_SSL_REDIRECT` redireciona para HTTPS, o proxy repassa HTTP de novo — **loop infinito de redirecionamento**, e o site inteiro fica inacessível.
- **Critério de aceite**: `python manage.py check --deploy` não reporta avisos e o site em produção carrega sem loop de redirecionamento.

### 13.5 Limites de tamanho
- Limite client-side no compositor (ex.: 100.000 caracteres) e no tradutor (ex.: 1 MB de arquivo).
- `DATA_UPLOAD_MAX_MEMORY_SIZE` ajustado no Django para o endpoint de histórico.
- **Critério de aceite**: arquivos acima do limite são rejeitados com mensagem clara antes de qualquer processamento.

### 13.6 Revisão de logs
- Configurar `LOGGING` garantindo que nenhum dado sensível seja registrado, inclusive em stack traces.
- **Critério de aceite**: forçar erro em cada endpoint e conferir que nenhum log contém blob, chave ou senha.

### 13.7 `DEBUG` e `ALLOWED_HOSTS`
- Controlados por variável de ambiente; `DEBUG = False` por padrão (falhar seguro).
- **Critério de aceite**: rodar sem `.env` sobe em modo produção, não em modo debug.

---

## Épico 14 — Testes e Qualidade

### 14.1 Testes JS — Huffman
- Ver 3.5.

### 14.2 Testes JS — cifragem
- Ver 4.8.

### 14.3 Testes JS — formato e armor
- Round-trip de `empacotar`/`desempacotar` (5.1).
- Cada caso de validação estrita do 5.2.
- Round-trip do armor, incluindo texto com lixo em volta (5.5).
- **Critério de aceite**: cobertura de todos os caminhos de erro do 5.2.

### 14.4 Teste de interoperabilidade entre os dois lados
- Teste que instancia **dois pares de chaves diferentes**, deriva a chave AES dos dois lados, cifra com um e decifra com o outro.
- É o teste que pega erros de `salt`/`info` (D4) — o tipo de bug que passa despercebido quando só se testa um lado.
- **Critério de aceite**: A cifra → B decifra, e B cifra → A decifra, ambos com o texto exato.

### 14.5 Testes Django
- Login/logout (Épico 2).
- Cada endpoint (Épicos 4.3 e 6): sucesso, não autenticado, acesso negado, entrada malformada.
- Write-once da chave pública (409 no segundo POST).
- Deduplicação (6.5).
- **Critério de aceite**: `python manage.py test` passa 100%.

### 14.6 Teste end-to-end manual
- Roteiro escrito: A gera chave → publica → verifica fingerprint → compõe → baixa → B importa → decifra → confere histórico dos dois lados.
- Executar em **duas máquinas/navegadores diferentes**, não em duas abas.
- **Critério de aceite**: o roteiro completo passa sem intervenção manual em nenhuma etapa criptográfica.

### 14.7 Teste de adulteração manual
- Abrir um `.msgenc` em editor hex e alterar: 1 byte do ciphertext; 1 byte do `created_at` (testa o AAD); o `sender_id`.
- **Critério de aceite**: os três casos são rejeitados; o sistema nunca exibe texto incorreto.

### 14.8 Teste de perda de chave — as três camadas
Limpar o IndexedDB e validar cada camada de **D11** isoladamente:
- **Camada 1** — restaurar via backup no servidor (11.6), apenas com login e senha de backup.
- **Camada 2** — restaurar via arquivo `.msgkey` (11.4), com o endpoint de backup indisponível.
- **Camada 3** — recuperação assistida (11.7): apagar a chave de A **e** o backup no servidor, e recuperar o histórico pelo navegador de B.
- Confirmar também que, sem nenhuma chave, o histórico lista as mensagens com o aviso do 10.5 em vez de quebrar.
- **Critério de aceite**: as três camadas recuperam o acesso seguindo apenas a documentação, cada uma testada com as demais desabilitadas.

### 14.9 Vetores de teste fixos (compartilhados pela equipe)
> Cada dev tem o próprio banco e, portanto, chaves diferentes — um `.msgenc` gerado numa máquina **não abre** em outra. Sem uma base comum, o time não tem como testar compatibilidade de formato.

- Commitar em `tests/vectors/`: um par de chaves ECDH de teste conhecido (em JWK, claramente marcado como **somente para teste**), e alguns arquivos `.msgenc` de referência com o texto esperado de cada um.
- Cobrir: texto curto (com fallback de compressão acionado), parágrafo em PT-BR, texto com emoji, e um arquivo deliberadamente adulterado.
- Os testes do 14.3 e 14.4 rodam contra esses vetores.
- **Critério de aceite**: os vetores decifram para o texto esperado em qualquer máquina da equipe; uma mudança acidental no formato ou na tabela de frequência quebra o teste imediatamente.

---

## Épico 15 — Documentação

### 15.1 README principal
- Visão geral do projeto e do pipeline; setup resumido, apontando para o guia completo do 15.6.
- Aviso destacado sobre contexto seguro (D10): acessar por `localhost`/`127.0.0.1` em desenvolvimento, HTTPS em produção — **nunca pelo IP da rede**.
- Diagrama do pipeline completo (envio e recebimento).
- **Critério de aceite**: alguém de fora roda o app do zero seguindo só o README.

### 15.2 `FORMATO.md`
- Ver 5.6.

### 15.3 `SEGURANCA.md` — modelo de ameaça
- O que o sistema protege: leitura por terceiros no canal (WhatsApp, e-mail, pen-drive perdido); adulteração da mensagem; leitura por quem tiver acesso ao banco do servidor.
- O que **não** protege: servidor malicioso que troca chaves públicas (mitigado, não eliminado, pela verificação de fingerprint — 11.1); dispositivo comprometido; ausência de forward secrecy (17.1); metadados (quem falou com quem e quando ficam visíveis no servidor).
- **Limite de recuperação:** documentar explicitamente que, se os **dois** usuários perderem as chaves ao mesmo tempo e não houver backup, o histórico é irrecuperável — nem os administradores conseguem restaurá-lo. Isso é inerente à criptografia fim-a-fim e é a contrapartida de o servidor não conseguir ler nada.
- Ser honesto sobre os limites vale mais do que afirmar segurança absoluta.
- **Critério de aceite**: cada limitação listada tem a mitigação correspondente ou a justificativa de por que foi aceita.

### 15.4 Guia de primeiro uso para os dois usuários
- Passo a passo do onboarding (11.5), incluindo como comparar os fingerprints.
- **Critério de aceite**: os dois usuários reais seguem o guia sem ajuda extra.

### 15.5 Relatório técnico (entrega acadêmica)
- Explicar por que Huffman é **compressão, não criptografia** — a segurança vem inteiramente do AES-GCM. Este é o ponto mais comumente confundido em projetos deste tipo.
- Justificar cada decisão de D1 a D12.
- Incluir a comparação de compressão do 17.2.
- **Critério de aceite**: o relatório responde "por que assim e não de outro jeito" para cada decisão travada.

### 15.6 Guia de setup e convenções da equipe
> O passo a passo de infraestrutura já está em [`infraestrutura.md`](infraestrutura.md) (✅ entregue). Este item cobre o que é específico do domínio do projeto e não cabe lá.

- Apontar para o `infraestrutura.md` como ponto de partida: `cp .env.example .env` → `docker compose build` → bootstrap → `migrate` → `up`.
- **Reforçar a convenção de duas origens do 1.7** (`localhost` = usuário A, `127.0.0.1` = usuário B) — é o que evita que cada dev invente o próprio jeito de testar o fluxo entre os dois usuários.
- Regra da tabela de frequência: `tools/generate-frequency-table.js` roda **uma vez**, o resultado é commitado, e ninguém regenera sem combinar com a equipe. Corpus diferentes produzem tabelas diferentes, e o sintoma é "texto decifrado vira lixo" — que parece bug de criptografia e não é.
- Como usar os vetores de teste do 14.9.
- **Critério de aceite**: um dev novo tem o ambiente rodando e o fluxo dos 2 usuários testado seguindo apenas este guia.

---

## Épico 16 — Deploy e integração contínua

> O deploy **não é uma etapa de teste**. O desenvolvimento diário acontece em `localhost` (1.7), que já é contexto seguro. Este épico existe para a integração e a entrega final, e é automatizado justamente para não virar gargalo de equipe.

### 16.1 Escolher plataforma
- Opções com HTTPS automático no plano gratuito: Render, Railway, Fly.io, PythonAnywhere.
- **HTTPS não é opcional em produção** — sem ele, `crypto.subtle` não existe e o app não funciona (D10).
- **Critério de aceite**: decisão registrada no README com a justificativa.

### 16.2 Deploy contínuo a partir da `main`
- Pipeline que sobe automaticamente a cada merge na `main`, rodando `python manage.py test` e `npm test` antes de publicar.
- **Construir o alvo `prod` do mesmo `Dockerfile`** (1.9) — o CI e a plataforma usam a imagem que o time já conhece, sem um segundo caminho de build para manter em sincronia.
- **Ninguém faz deploy manual para testar.** O ambiente reflete o que já foi integrado, e serve para validação de integração e para a apresentação final.
- **Critério de aceite**: um merge na `main` atualiza o ambiente sem nenhuma ação humana; testes falhando bloqueiam a publicação.

### 16.3 Testar em dispositivo real — túnel self-service
Necessário apenas para o que só existe no celular (o compartilhamento nativo do 8.4). Cada dev sobe o próprio túnel apontando para o próprio `localhost` — não é ambiente compartilhado e ninguém depende de ninguém:

```bash
docker compose --profile tunnel up tunnel
# → https://algum-nome-aleatorio.trycloudflare.com (impresso nos logs)
```

- Já vem como serviço do compose (1.10), sob o profile `tunnel` — não sobe no `docker compose up` normal.
- Sem conta, sem instalar certificado no celular, URL efêmera com certificado válido. O login do Django protege o acesso enquanto o túnel estiver de pé.
- Os `ALLOWED_HOSTS` e `CSRF_TRUSTED_ORIGINS` do 1.7 já cobrem o subdomínio aleatório de qualquer dev.
- Alternativa totalmente offline: `mkcert` + `runserver_plus --cert-file`, mas exige instalar a CA raiz no celular — bem mais trabalhoso, só vale se não houver internet.
- **Critério de aceite**: qualquer dev consegue abrir o app no próprio celular com um comando, sem alterar o `settings.py`.

### 16.4 Configuração de produção
- `whitenoise` para servir estáticos, `collectstatic` no build, variáveis de ambiente configuradas na plataforma.
- Conferir o `SECURE_PROXY_SSL_HEADER` do 13.4 — é o erro mais comum neste passo.
- **Critério de aceite**: `python manage.py check --deploy` limpo no ambiente de produção.

### 16.5 Backup do banco
- Rotina de `pg_dump` agendada e documentada. Inclui a tabela `KeyBackup` (6.8) — perdê-la elimina a camada 1 de recuperação de D11.
- **Critério de aceite**: procedimento de restauração testado ao menos uma vez.

---

## Épico 17 — Extras (só depois que tudo acima estiver fechado)

### 17.1 Forward secrecy (ECIES com chave efêmera)
- Hoje, com ECDH estático, a mesma chave AES vale para sempre: se a chave privada vazar, **todo o histórico vaza junto**.
- Solução: o remetente gera um par ECDH efêmero por mensagem, deriva a chave com a pública estática do destinatário e inclui a pública efêmera (65 bytes, formato `raw`) no arquivo — nova `version = 0x02` do formato.
- Custa ~15 linhas e melhora substancialmente o modelo de ameaça.
- **Critério de aceite**: arquivos `v1` continuam sendo lidos; arquivos `v2` usam chave efêmera; a chave AES difere entre duas mensagens do mesmo remetente.

### 17.2 Comparação Huffman × gzip (para o relatório)
- Comprimir os mesmos textos com `CompressionStream('gzip')` (nativo do navegador) e tabular os resultados.
- Expectativa: gzip vence em textos longos (tem modelo de dicionário), **Huffman estático vence em textos curtos** (o gzip carrega ~18 bytes de cabeçalho, o Huffman estático carrega zero).
- É um resultado interessante e honesto de defender numa apresentação.
- **Critério de aceite**: tabela com ao menos 5 tamanhos de entrada, de 20 a 5000 caracteres.

### 17.3 Contadores anti-replay
- Número de sequência dentro do AAD, rejeitando mensagens já vistas.
- Só faz sentido se replay for considerado uma ameaça relevante — provavelmente não é, neste escopo.

---

## Changelog

### Revisão 4 — idioma do código

| Mudança | Motivo |
|---|---|
| **Nova D13** — código em inglês, interface em português | Convenção definida pela equipe. Detalhamento completo em [`convencoes.md`](convencoes.md) |
| App `mensageiro` → **`messenger`** | Inclui `templates/messenger/`, `static/messenger/` e o namespace de URL |
| Views e rotas | `compor`/`tradutor` → `compose`/`translator`; `/tradutor/` → `/translator/` |
| Módulos JS | `ambiente.js` → `environment.js`, `formato.js` → `format.js`, `compor.js` → `compose.js`, `tradutor.js` → `translator.js` |
| Funções e classes | `cifrar`/`decifrar` → `encrypt`/`decrypt`, `empacotar`/`desempacotar` → `pack`/`unpack`, `montarAad` → `buildAad`, `ErroFormato` → `FormatError`, `ErroAmbiente` → `EnvironmentError`, `ErroAutenticacao` → `AuthenticationError`, `exigirContextoSeguro` → `requireSecureContext` |
| Campos e constantes | `criado_em` → `created_at`, `recebido_em` → `received_at`, `comprimido` → `compressed`, `chaveAES` → `aesKey`, `TAMANHO_*` → `*_SIZE`, `IMPLEMENTACAO_FALSA` → `FAKE_IMPLEMENTATION` |
| Models e endpoints | `Mensagem` → `Message`, `remetente`/`destinatario` → `sender`/`recipient`, `origem` → `direction`, `chave_publica_ecdh` → `ecdh_public_key`, `BackupChave` → `KeyBackup`, `/api/chave-publica/` → `/api/public-key/`, `/api/mensagens/` → `/api/messages/`, `/api/backup-chave/` → `/api/key-backup/`, `seed_usuarios` → `seed_users`, `get_outro_usuario` → `get_other_user` |
| CSS | Classes e variáveis em inglês: `.estado--erro` → `.status--error`, `--fundo` → `--bg`, `.zona` → `.dropzone` |
| **Textos de interface mantidos em português** | Rótulos, botões e mensagens de erro exibidas ao usuário continuam em PT-BR, inclusive as lançadas de dentro do código |
| **0.2** — marcação de código falso | Trocado o comentário `// FAKE` por `FAKE_IMPLEMENTATION = true` + aviso na interface, conforme a regra de código sem comentários |

### Revisão 3 — containerização e Postgres

| Mudança | Motivo |
|---|---|
| **Nova D12** — Docker como ambiente padrão | O ambiente vira código revisável no PR, em vez de um aviso no grupo que cada dev aplica quando lembra |
| **1.3 revisada** — SQLite → **Postgres** | SQLite em bind mount gera `database is locked` intermitente; Render e Railway dão Postgres no plano gratuito (paridade com produção); acaba o "meu banco vs o seu" |
| **Novos 1.9, 1.10 e 1.11** — Dockerfile, compose e documentação | ✅ Já entregues no repositório, junto com `.dockerignore`, `requirements.txt`, `.env.example` e `.gitignore` |
| **Sem `Makefile`** — `docker compose` direto | `make` não vem no Windows; exigir a instalação acrescentaria um passo de onboarding só para economizar digitação. `UID`/`GID` migraram para o `.env`, que o Compose já interpola |
| **Novo `docs/infraestrutura.md`** | Toda a explicação operacional num lugar só; os arquivos de configuração ficam sem comentários |
| **1.1** — sem virtualenv local | `startproject`/`startapp` rodam dentro do container, garantindo a mesma versão do Django para todos |
| **1.2** — dependências atualizadas | Django 5.2 LTS, mais `psycopg[binary]`, `dj-database-url`, `gunicorn` e `whitenoise`; `package-lock.json` versionado |
| **1.5** — `.gitignore` com exceção para os vetores | `*.msgenc` é ignorado, mas `!tests/vectors/*.msgenc` precisa ser versionado (14.9) |
| **1.6** — Vitest pelo serviço `js` | Mesma versão de Node para todos, sem instalar Node no host |
| **1.7** — nota sobre Docker | A convenção das duas origens funciona igual sob container; a porta publicada responde nos dois endereços |
| **0.1** — reescrito com a sequência de bootstrap | Um dev novo chega ao primeiro `runserver` com seis comandos, todos copiáveis do backlog |
| **16.2** — CI constrói o alvo `prod` | Um único caminho de build; o time testa a imagem que vai ao ar |
| **16.3** — túnel como profile do compose | Um `docker compose --profile tunnel up` em vez de instalar `cloudflared` na máquina |
| **16.5** — `pg_dump` no lugar de cópia do SQLite | Consequência da troca de banco |

### Revisão 2 — contexto seguro e recuperação de chave

| Mudança | Motivo |
|---|---|
| **D10 reescrita** com a tabela do que conta como contexto seguro | A versão anterior dava a entender que HTTPS era necessário no desenvolvimento diário. Não é: `localhost` e `127.0.0.1` já são contexto seguro, e o problema só aparece ao acessar pelo IP da rede |
| **Nova D11** — estratégia de recuperação em três camadas | A perda da chave privada tornava o histórico permanentemente ilegível, e o arquivo de backup era a única defesa |
| **Novo 1.7** — convenções de ambiente local | Testar os 2 usuários numa máquina só, via `localhost` e `127.0.0.1` (origens distintas ⇒ cookies e IndexedDB separados). Elimina a necessidade de deploy ou segunda máquina para o fluxo A→B |
| **Novo 1.8** — guarda `requireSecureContext()` | Transforma `Cannot read properties of undefined` em uma mensagem que qualquer dev resolve em segundos |
| **Novo 4.9** — `navigator.storage.persist()` | O navegador pode limpar o IndexedDB sozinho sob pressão de disco, levando a chave privada junto |
| **Novo 6.8** — endpoints de backup da chave | Recuperação vira "login + senha de backup" em vez de "espero ainda ter aquele arquivo de meses atrás". O servidor continua vendo apenas um blob opaco |
| **11.3** — PBKDF2 de 200k → **600k** iterações | Recomendação atual da OWASP para PBKDF2-HMAC-SHA256; ~0,5 s numa operação que acontece uma vez |
| **Novos 11.6 e 11.7** — recuperação pelo servidor e assistida pelo outro usuário | Fecham o cenário de perda total; o 11.7 só é possível porque o sistema tem exatamente 2 usuários e o histórico compartilha o mesmo segredo |
| **13.4** — `SECURE_PROXY_SSL_HEADER` | Sem essa linha, `SECURE_SSL_REDIRECT` atrás de Render/Railway/Fly causa loop infinito de redirecionamento e derruba o site inteiro |
| **Novo 14.9** — vetores de teste fixos | Cada dev tem chaves próprias, então arquivos não são intercambiáveis entre máquinas; sem uma base comum não há como testar compatibilidade de formato |
| **Novo 15.6** — guia de setup para novos devs | Inclui a regra de não regenerar a tabela de frequência, cujo sintoma de erro parece bug de criptografia |
| **Épico 16 reescrito** — deploy contínuo por CI | Deploy manual por teste é inviável em equipe. Agora é automático a partir da `main`, e o teste em dispositivo real virou túnel self-service (16.3), sem ambiente compartilhado |
| **15.3** — limite de recuperação documentado | Perda simultânea das duas chaves é irrecuperável; é a contrapartida do fim-a-fim e precisa estar escrito |

### Revisão 1 — em relação à versão original

| Mudança | Motivo |
|---|---|
| Huffman passou a operar sobre **bytes UTF-8**, não caracteres (D1) | Eliminou o código de escape, que estava subespecificado (não dizia quantos bytes ler) e seria fonte de bug garantido |
| Adicionado símbolo **EOF** (D2) | Sem ele, os bits de padding do último byte viram caracteres-fantasma no `decode` |
| Huffman **canônico** com desempate por índice (D3) | Garante que a árvore é idêntica em qualquer execução |
| `salt` e `info` do HKDF **especificados** (D4) | Estavam ausentes; lados diferentes derivariam chaves diferentes e nada decifraria |
| Formato do arquivo passou de **JSON+base64 para binário** (D5) | O base64 (×1,33) mais os campos JSON anulavam integralmente o ganho do Huffman — o arquivo ficava do tamanho do texto puro |
| Cabeçalho entra como **AAD** do AES-GCM (D5, 4.6) | `sender` e `timestamp` estavam fora da autenticação e podiam ser adulterados livremente |
| **Fallback** quando a compressão expande (D5, 3.3) | Textos curtos ficavam maiores depois do Huffman |
| Separados `created_at` e `received_at` (D7) | O backlog anterior recebia `timestamp` do cliente **e** usava `auto_now_add` — dois conceitos misturados em um campo |
| Endpoints de chave pública movidos do Épico 6 para o **Épico 4** | O item 4.3 antigo dependia de um endpoint que só seria construído dois épicos depois |
| Chave pública passou a ser **write-once** (4.3) | Qualquer um com a sessão podia reconfigurar o canal |
| Critério de aceite do `encode` reescrito (3.3) | "Menor que o original" falha legitimamente em textos curtos — o teste acusaria erro onde não há |
| **Épico 0** (walking skeleton) criado | Problemas de integração só apareceriam no Épico 8 do backlog anterior |
| **Épico 8** (compartilhamento) criado | Pen-drive, WhatsApp e e-mail são o requisito central do projeto e não existiam no backlog; inclui o alerta de que `mailto:` não anexa arquivos |
| **Épico 11** (fingerprint + backup de chave) criado | Fechava dois furos: MITM do servidor na distribuição de chaves, e perda permanente de acesso ao limpar o navegador |
| Adicionado 9.4 — destinatário grava no histórico | O backlog anterior só gravava no envio; nada era salvo ao importar |
| **Épicos 12 (UX) e 16 (deploy)** criados | Não existiam |
| Alerta sobre **HTTPS obrigatório** (D10, 16.1, 16.3) | `crypto.subtle` é `undefined` fora de contexto seguro — quebraria o app inteiro sem erro óbvio |
| Painel de estatísticas de compressão (7.5) e comparação com gzip (17.2) | Tornam visível o trabalho do Huffman, que é a peça acadêmica do projeto |
| `requirements.txt` à mão em vez de `pip freeze` (1.2) | `pip freeze` captura dependências transitivas e torna o arquivo ilegível |
