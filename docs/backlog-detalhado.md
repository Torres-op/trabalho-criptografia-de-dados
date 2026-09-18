| **12.5 — `search-tree.js` e painel no compositor** | A organização da árvore precisa aparecer para o usuário. A árvore organiza e exibe; o conteúdo do arquivo não muda por causa dela |
| **Valor do nó = código × quantidade, com desempate pelo código** | Formato pedido pelo cliente. A multiplicação não garante valor único: dois espaços e um `@` valem 64 |
| **Painel de compressão fora da tela (7.5)** | Pedido do cliente: o usuário não precisa ver esses números. O Huffman continua comprimindo o arquivo |
| **Árvore montada passo a passo, com arrastar e zoom** | Mostrar como ela se organiza, e não só o resultado pronto |
| **Percurso em ordem ao lado da árvore** | Cabe melhor na tela; abaixo de 720px volta a empilhar |
| **Valor do nó = código × quantidade, com desempate pelo código** | Formato pedido pelo cliente. A multiplicação não garante valor único: dois espaços e um `@` valem 64 |
| **Painel de compressão fora da tela (7.5)** | Pedido do cliente: o usuário não precisa ver esses números. O Huffman continua comprimindo o arquivo |
| **Árvore montada passo a passo, com arrastar e zoom** | Mostrar como ela se organiza, e não só o resultado pronto |
| **Percurso em ordem ao lado da árvore** | Cabe melhor na tela; abaixo de 720px volta a empilhar |
| **Ordenar o texto antes de comprimir: descartado**# Backlog Detalhado — Treehash (Django + JS)

> **Stack:** Django (backend/API/Admin) + JavaScript puro no navegador (Huffman + Web Crypto API para toda a criptografia).
> **Princípio central:** o servidor nunca vê texto puro nem chaves privadas. Ele guarda apenas blobs cifrados e chaves públicas.
> **Canal de entrega:** o arquivo `.treehash`, trocado offline (pen-drive, WhatsApp, e-mail). O servidor é cofre de histórico, não canal de transporte.

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
info      = utf8( "treehash/v1/aes-gcm-256" )
aesKey  = HKDF-SHA256( segredo, salt, info ) → AES-GCM 256 bits
```

`usernameMenor`/`usernameMaior` são os dois usernames ordenados alfabeticamente, para que ambos os lados produzam o mesmo `salt` independentemente de quem está cifrando.

### D5. Formato binário `.treehash` (v1)

Nada de JSON + base64 no arquivo final. Com o envelope JSON, o base64 (×1,33) mais os nomes de campo devolvem exatamente o que o Huffman economizou — o arquivo fica do mesmo tamanho do texto puro e a compressão deixa de existir na prática.

| Offset | Tamanho | Campo | Descrição |
|---|---|---|---|
| 0 | 4 | `magic` | `"TRHS"` — `0x54 0x52 0x48 0x53` |
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
-----BEGIN TREEHASH-----
<base64 do arquivo binário, quebrado em linhas de 64 caracteres>
-----END TREEHASH-----
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
| **2. Arquivo `.treehashkey`** | Servidor fora do ar, conta perdida | Pen-drive, gerenciador de senhas | 11.3, 11.4 |
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

**Em inglês** — todo identificador de código: apps, módulos, arquivos, rotas, classes, funções, variáveis, constantes, chaves de objeto, campos de model, endpoints, IDs e classes CSS, blocos de template e nomes de branch.

**Em português** — tudo que o usuário lê na tela: títulos, rótulos, botões, placeholders e **mensagens de erro exibidas na interface**, inclusive as lançadas de dentro do código (`throw new FormatError("Arquivo corrompido...")`). Também a formatação de números e datas (`toLocaleString("pt-BR")`) e as **mensagens de commit**, curtas e no imperativo — só o prefixo (`feat`, `fix`, `docs`) fica em inglês, porque é palavra-chave do formato.

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
- Ignorar `venv/`, `__pycache__/`, `.env`, `node_modules/`, `staticfiles/`, `*.treehashkey` e `*.treehash` — com exceção de `!tests/vectors/*.treehash`, que são os vetores de teste do 14.9 e **precisam** ser versionados.
- Ler `SECRET_KEY`, `DJANGO_DEBUG`, `ALLOWED_HOSTS` e `DATABASE_URL` do ambiente (`python-decouple` + `dj-database-url`).
- `.env.example` versionado é o **contrato**: toda variável nova entra lá no mesmo commit que a usa.
- `.gitattributes` com `* text=auto eol=lf` — sem isso, um time em Windows e Linux gera diffs inteiros de fim de linha. Extensões binárias (`.treehash`, `.treehashkey`, imagens) marcadas como `binary` para não sofrerem conversão.
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

## Épico 2 — Autenticação (2 usuários fixos) ✅

### 2.1 Criar model `Profile` (extensão do `User`) ✅
- `Profile` em `messenger/models.py` com:
  - `user` — `OneToOneField(User)`
  - `ecdh_public_key` — `TextField(blank=True)`, chave pública em formato JWK serializado
  - `key_registered_at` — `DateTimeField(null=True)`
  - `fingerprint_verified` — `BooleanField(default=False)` (usado no Épico 11)
- **Critério de aceite**: model aparece no banco; relação `user.profile` funciona no shell do Django.

> **Entregue por outro dev; nomes corrigidos depois (D13).** A primeira versão veio com identificadores em português (`chave_publica_ecdh`, `chave_registrada_em`, `fingerprint_verificado`), junto com o model `Mensagem` do 6.1. A migration `0003_english_identifiers` renomeia tudo sem perder dados: `RenameField`/`RenameModel`, um `RunPython` que traduz os valores de `direction` (`enviada` → `sent`) e a troca do índice. As migrations 0001 e 0002, já publicadas no `dev`, **não foram reescritas** — quem já as aplicou recebe só a 0003. Os rótulos que o Admin mostra ficam em português via `verbose_name`.
>
> `test_migrations.py` sobe o banco até a 0002, grava dados com os nomes antigos, migra para a 0003 e confere que tudo foi preservado — e que a volta também funciona.

### 2.2 Criar management command de seed ✅
- `messenger/management/commands/seed_users.py`.
- Criar os 2 usuários fixos com `User.objects.get_or_create(...)` (idempotente) e o `Profile` correspondente.
- Senhas iniciais vêm de variável de ambiente, nunca hardcoded.
- Falhar com mensagem clara se as variáveis não estiverem definidas.
- **Critério de aceite**: rodar `python manage.py seed_users` duas vezes não duplica usuários nem gera erro.

> **Corrigido.** A versão entregue fixava os nomes `usuario1`/`usuario2` e lia `USER1_PASSWORD`/`USER2_PASSWORD`, ignorando `SEED_USER_A`/`SEED_USER_B` do `.env`. Como os nomes entram no salt do D4, isso não era cosmético. Agora o comando lê `SEED_USER_{A,B}` e `SEED_PASS_{A,B}` via `python-decouple` (mesma convenção do `settings.py`), recusa nomes iguais, mantém a senha de quem já existe e avisa quando sobram participantes de seeds antigos. As variáveis duplicadas saíram do `.env.example`. **7 testes** em `messenger/tests/test_seed.py`.

### 2.3 Views de login/logout ✅
- Usar `django.contrib.auth.views.LoginView` e `LogoutView` no `urls.py`.
- Template customizado `login.html`.
- Configurar `LOGIN_URL`, `LOGIN_REDIRECT_URL`, `LOGOUT_REDIRECT_URL` em `settings.py`.
- **Critério de aceite**: login com credenciais corretas redireciona para a home; credenciais erradas mostram mensagem de erro.

### 2.4 Proteger views internas ✅
- Aplicar `LoginRequiredMixin` ou `@login_required` em todas as views do app, exceto login.
- **Critério de aceite**: acessar qualquer URL interna sem login redireciona para `/login/`.

> Ajustes feitos junto com o 2.5: o menu e o botão "Sair" só aparecem para quem está logado (antes apareciam na própria tela de login), as classes CSS usadas pelo login (`login-card`, `logout-form`, `link-button`) passaram a existir, e as rotas duplicadas do `urls.py` foram removidas.

### 2.5 Helper `get_other_user()` ✅
- Função utilitária que, dado o usuário logado, retorna o outro `User` do sistema.
- Deve falhar de forma explícita se não houver exatamente 2 usuários — é uma premissa do sistema inteiro.
- **Critério de aceite**: com 2 usuários, retorna sempre o outro; com 1 ou 3+, lança exceção com mensagem clara.

> **Participante = usuário com `Profile`.** A regra "exatamente 2 usuários" colidia com o 2.6, que exige um superusuário para abrir o Admin — ele seria o terceiro. Como o seed cria `Profile` só para os dois usuários fixos, o superusuário não conta. Em `messenger/participants.py`:
> - `get_other_user(user)` levanta `ParticipantsNotConfigured` (subclasse de `ImproperlyConfigured`) quando não há exatamente 2 participantes, listando quem encontrou; e `NotAParticipant` (subclasse de `PermissionDenied`) para quem está fora da conversa — dentro de uma view, isso vira **403** sozinho.
> - `sender_id_for(user, other)` calcula o índice do D5 no servidor ordenando por **unidades UTF-16** (`encode("utf-16-be")`), para bater exatamente com o `<` do JavaScript mesmo em nomes com caracteres fora do plano básico.
>
> **11 testes** em `messenger/tests/test_participants.py`.

### 2.6 Registrar no Django Admin ✅
- Registrar `Profile` exibindo `user`, `ecdh_public_key` (somente leitura), `key_registered_at` e `fingerprint_verified`.
- **Critério de aceite**: superusuário consegue ver as chaves públicas cadastradas via `/admin/`.

> `ProfileAdmin` mostra usuário, se há chave, quando foi registrada e se o fingerprint foi verificado; a chave e a data são somente leitura, e o usuário também, depois de criado. A **ação "Apagar a chave pública"** é a "intervenção via Admin" que o write-once do 4.3 exige para trocar de chave: limpa a chave, a data e a verificação. **8 testes** em `messenger/tests/test_admin.py`, junto com o `MessageAdmin` do 6.7.

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

> **O painel expôs um comportamento que precisava de explicação.** Em mensagens curtas o *arquivo* cresce — "Chego às 19h" vira 56 B a partir de 13 B — porque o envelope tem tamanho fixo. Sem contexto, o número parece defeito.
>
> A tela exibe uma nota quando isso acontece, explicando que o custo é fixo e não cresce com a mensagem. Quatro testes travam o ponto de equilíbrio.

> **Nota corrigida no Épico 4.** Ela dizia "27 bytes fixos de cabeçalho", número correto enquanto a cifragem era XOR. Com o AES-GCM real entra a tag de autenticação de 16 bytes, e o custo fixo passou a **43 bytes**. A nota agora discrimina as duas parcelas, e o texto e os testes usam `HEADER_SIZE + TAG_SIZE` em vez de números soltos — foi o valor cravado no código que deixou a documentação envelhecer sem avisar.
>
> **O painel saiu da interface no 12.5** (17/09/2026, pedido do cliente): `stats()` e `measure()` continuam no `huffman.js` e testados, só a exibição foi removida.
>
> **Ponto de equilíbrio medido: 96 caracteres.** Abaixo disso o arquivo sai maior que o texto; acima, menor. A nota diz "por volta de 100 caracteres", e há teste garantindo que o valor real fica entre 60 e 140 — se o formato mudar de tamanho, a suíte acusa que a frase da tela ficou mentirosa.

---

## Épico 4 — Chaves e Cifragem (JS, Web Crypto API) ✅

> Ver **D4** para os parâmetros exatos de derivação, **D10** para o requisito de contexto seguro e **D11** para a estratégia de recuperação da chave.

### 4.1 Gerar par de chaves ECDH no navegador ✅
> Implementado em `keys.js`, módulo novo. A separação é deliberada: `keystore.js` cuida só de persistência e não sabe nada de criptografia; `keys.js` cuida do ciclo de vida das chaves e usa o keystore. Os itens 4.4 e 11.1 vão acrescentar cache da chave do outro e fingerprint sem misturar as duas responsabilidades.

- `generateKeyPair()` → `crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveKey", "deriveBits"])`.
- `ensureKeyPair()` → devolve `{ pair, created }`; só gera se o keystore estiver vazio.
- `requireSecureContext()` (1.8) chamado antes de qualquer operação.
- `exportPublicKey()`, `importPublicKey()` e `validatePublicJwk()` já entram aqui, prontos para o 4.3 e o 4.4. A exportação devolve **apenas** `kty`, `crv`, `x`, `y` — nunca o `d`, que é o segredo.
- **Chave privada extraível (`extractable: true`)** — exigência da camada 2 de D11: sem isso não há como exportar o backup `.treehashkey` (11.3). O custo é que um XSS com acesso ao IndexedDB consegue exfiltrar a chave; é a CSP do 13.3 que reduz esse risco.
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

### 4.3 Endpoints de chave pública (Django) ✅
> Movido para cá porque o 4.4 depende dele — no backlog anterior estava dois épicos à frente.

- `POST /api/public-key/` — salva a JWK da chave pública no `Profile` do usuário logado.
  - **Write-once:** rejeitar com `409 Conflict` se o campo já estiver preenchido. Trocar a chave exige intervenção via Admin (e reverificação do fingerprint, Épico 11).
  - Validar que o corpo é uma JWK de curva P-256 com os campos esperados.
- `GET /api/public-key/<username>/` — retorna a JWK do outro usuário.
- **Critério de aceite**: só usuário autenticado acessa; retorna `404` para usuário inexistente; segundo `POST` retorna `409`.

> Implementado em `messenger/api.py`, com a validação em `messenger/jwk.py`.
> - **Write-once sem corrida:** a leitura e a gravação acontecem dentro de `transaction.atomic()` com `select_for_update()` — dois POSTs simultâneos não conseguem ambos ver o campo vazio. É o espelho, no servidor, da corrida corrigida no keystore.
> - **Reenviar a mesma chave devolve 200**, não 409. O navegador publica a chave a cada abertura de página; tratar isso como conflito geraria erro a cada reload. Só uma chave **diferente** é 409, que é o caso que o write-once existe para barrar.
> - **Forma canônica:** a chave é guardada como `{"crv","kty","x","y"}` em ordem lexicográfica e sem espaços — exatamente a entrada do thumbprint da RFC 7638. O fingerprint do 11.1 vira `SHA-256` do texto guardado, sem normalização extra.
> - O servidor valida **formato** (EC, P-256, coordenadas base64url de 32 bytes, sem `d`), não se o ponto está na curva — isso exigiria uma biblioteca criptográfica no Python. Quem garante o ponto é o `importKey` do navegador do outro lado, que recusa pontos inválidos (coberto em `keys.test.js`).
> - Erros em JSON com `code`: `unauthenticated` (401), `not_participant` (403), `invalid_jwk` (400), `key_conflict` (409), `user_not_found` e `key_not_published` (404). Um superusuário consultado por `/api/public-key/admin/` recebe o mesmo 404 de usuário inexistente — a API não revela quem existe fora da conversa.
>
> **19 testes** em `test_public_key_api.py` e **13** em `test_jwk.py`.

### 4.4 Publicar a chave pública e buscar a do outro ✅
- Exportar com `crypto.subtle.exportKey("jwk", publicKey)` e enviar via `POST` (4.3) no primeiro login.
- Buscar a JWK do outro usuário e importar com `crypto.subtle.importKey("jwk", ...)`.
- Cachear a chave pública do outro no IndexedDB, para não depender do servidor a cada operação.
- **Critério de aceite**: chave pública aparece no Django Admin após o primeiro login de cada usuário.

> **Como o navegador descobre quem é quem.** As views passam ao template um objeto de sessão — `username`, `peerUsername`, token CSRF e as URLs da API — renderizado com `json_script`, que gera `<script type="application/json">`: dado inerte, não executável, compatível com a CSP do 13.3. O `api.js` lê esse objeto e monta as chamadas.
>
> **O fluxo do `openSession`:** carrega ou cria o par local → publica a chave pública → busca a do outro → guarda em cache no IndexedDB → deriva a chave AES e calcula o `sender_id`.
>
> | Situação | Comportamento |
> |---|---|
> | Outro usuário ainda não entrou | Não fica pronta; explica que a troca acontece sozinha no primeiro acesso do outro |
> | Servidor tem **outra** chave para você (409) | Não fica pronta; explica que os dados do navegador foram apagados ou que é outro navegador |
> | Servidor fora do ar, com cache | Fica pronta usando a chave guardada, com aviso |
> | Servidor fora do ar, sem cache | Não fica pronta |
> | A chave do outro **mudou** | Usa a nova, mas avisa para confirmar pessoalmente — sinal de possível MITM, precursor do 11.2 |
>
> **Bug encontrado e corrigido: o IndexedDB não separava por usuário.** Se o `diretor` saísse e o `marcio` entrasse no mesmo navegador, o `marcio` carregaria o par do `diretor` e o publicaria como seu — e, com o write-once, isso ficaria gravado errado no servidor. Os registros do keystore agora são indexados pelo dono (`local-key-pair:<username>`, `peer-public-key:<username>`). A convenção de duas origens do 1.7 escondia o problema, porque ali cada usuário tem um IndexedDB próprio.
>
> **Verificado ponta a ponta contra o servidor real**, por HTTP: login, token CSRF da página, publicação, idempotência, conflito, recusa sem CSRF e troca de chaves nos dois sentidos — 17 de 17. **14 testes** em `tests/session.test.js`, com um servidor falso que reproduz as respostas da API, e **15** em `tests/api.test.js`.

### 4.5 Derivar o segredo compartilhado ✅
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
- **Critério de aceite**: os dois usuários, independentemente, derivam a mesma chave — validado por teste que simula os dois lados com ciphertext cruzado. ✅ **29 testes** em `tests/crypto.test.js`.

**Detalhes fixados na implementação, que D4 deixava em aberto:**

- **"Ordem alfabética" virou ordem de unidades de código** (`a < b`), não `localeCompare`. A comparação por locale depende de configuração do ambiente e poderia ordenar a mesma dupla de nomes de forma diferente em máquinas diferentes — os dois lados derivariam chaves distintas e nada decifraria, sem erro visível. Há teste travando isso (`"Zoe"` antes de `"ana"`).
- **O separador `\x00` é uma constante nomeada**, `USERNAME_SEPARATOR = String.fromCharCode(0)`, e não um NUL digitado no meio de um template literal. Um byte de controle literal no código-fonte é invisível no editor, faz o `grep` tratar o arquivo como binário e desaparece silenciosamente numa edição descuidada.
- O separador NUL não é decorativo: sem ele, as duplas `("ana", "luiza-silva")` e `("ana-luiza", "silva")` produziriam o mesmo material de salt. Há teste cobrindo essa colisão.
- `orderUsernames()` recusa nomes iguais ou vazios, em vez de derivar uma chave sem sentido.
- `deriveKey()` valida o papel de cada chave: passar a pública no lugar da privada, ou vice-versa, dá erro nomeado em vez de falha obscura da Web Crypto.

### 4.6 Implementar `encrypt(bytes, aesKey, aad)` ✅
- IV aleatório de 96 bits com `crypto.getRandomValues` — **único por mensagem**.
- `crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad }, aesKey, bytes)`.
- Retornar `{ iv, ciphertext }` (a tag de 16 bytes já vem embutida no ciphertext).
- **Critério de aceite**: cifrar o mesmo texto duas vezes gera IVs e ciphertexts diferentes.

### 4.7 Implementar `decrypt(iv, ciphertext, aesKey, aad)` ✅
- `crypto.subtle.decrypt({ name: "AES-GCM", iv, additionalData: aad }, aesKey, ciphertext)`.
- Capturar a falha de verificação de autenticidade e traduzir para um erro tipado do app (`AuthenticationError`), não deixar vazar o `OperationError` cru da Web Crypto.
- **Critério de aceite**: alterar 1 byte do ciphertext, do IV **ou do AAD** faz a função lançar `AuthenticationError`.

### 4.8 Testes do módulo de cifragem ✅
- Round-trip com textos variados e com payload vazio.
- Rejeição de ciphertext adulterado (1 bit trocado).
- Rejeição de IV incorreto.
- **Rejeição de AAD adulterado** — cobre a proteção do cabeçalho (D5).
- Rejeição com chave derivada de outra dupla de usernames e com par de chaves de terceiro.
- **Critério de aceite**: todos os casos de adulteração lançam erro; nenhum decodifica silenciosamente para lixo. ✅

> **O último `FAKE_IMPLEMENTATION` saiu.** `isFakeImplementation()` agora devolve `false` e o aviso permanente da interface desapareceu — Huffman e cifragem são reais.
>
> **Resolvido no 4.4.** Registro do estado anterior: **o app ainda não fechava o fluxo ponta a ponta**, porque nada popula a chave pública do outro usuário: isso é o 4.4, que depende do Épico 2. Até lá, compor uma mensagem devolve a mensagem prevista em 9.5 — *"Ainda não foi feita a troca de chaves com o outro usuário."* Os 29 testes provam que o módulo funciona; falta apenas a origem da chave do outro lado.
>
> **Custo fixo do arquivo subiu para 43 bytes** — 27 do cabeçalho D5 mais 16 da tag GCM. Uma mensagem de 114 B agora gera arquivo de 113 B (−0,9%), contra os 97 B da versão com XOR. O ponto de equilíbrio da nota exibida no painel de compressão (3.6) precisa ser reconferido.

### 4.9 Solicitar armazenamento persistente ✅
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
- **Critério de aceite**: o resultado da chamada fica visível na interface; quando `false`, o app exibe aviso. ✅ **10 testes** em `tests/environment.test.js`, que até então não tinha nenhum — cobrem também a guarda do 1.8.

**Faixa de avisos unificada.** O elemento `#fake-warning`, que existia só para sinalizar a cripto falsa do Épico 0, virou `#notices` e passou a acomodar vários avisos numa lista. Hoje ele carrega dois: implementação provisória (que já não dispara) e armazenamento volátil. Quando o 12.4 chegar, o indicador de estado criptográfico entra no mesmo lugar em vez de criar outro.

`ui.reportEnvironment(target, checks)` recebe as verificações por parâmetro em vez de importá-las, o que a torna testável sem DOM e sem mexer em globais.

> ✅ **Pendência fechada em 18/09/2026.** O aviso agora só aparece quando o navegador negou o armazenamento **e** não há backup guardado, e aponta a saída: guardar o backup na tela de Identidade. Com backup guardado, ele cala — o risco vira aborrecimento, não perda, e quem continua marcando o ponto é o sinal do 12.4.
>
> A decisão ficou em `storageNotices()`, função pura em `environment.js`, com **4 testes**. Vale registrar o que o `persist()` faz de verdade: o Chrome nunca pergunta e concede por heurística de engajamento (site instalado, favoritado, muito uso), então em `localhost` ele costuma negar calado; o Firefox pergunta. Receber `false` não é sintoma de bug no app.

---

## Épico 5 — Formato de Arquivo `.treehash` ✅

> Especificação completa em **D5**. Este épico implementa e documenta.

> ✅ **Entregue no `feature/epico-5` e integrado aqui.** 5.1, 5.3 e 5.4 já existiam desde os Épicos 0 e 3; o épico acrescentou o aviso de `created_at` suspeito (5.2), o `armor.js` (5.5) e o [`formato.md`](formato.md) (5.6).
>
> Corrigido na integração:
> - Marcadores do bloco armored, extensão e magic passaram a seguir o nome Treehash (Revisão 6).
> - O `formato.md` chegou **sem nenhum bloco de código**: faltavam o dump em hex, o bloco armored, o pseudocódigo da derivação (D4) e a conta do tamanho mínimo, todos anunciados no texto. Reescritos, com o exemplo regerado por execução real do pipeline.
> - Os testes de `created_at` suspeito vieram escritos contra a API anterior à sessão do 4.4 e foram reescritos.
>
> O `armor.js` está pronto e testado (**16 testes**), mas nenhuma tela o usa ainda: quem liga é o 8.2 (copiar como texto) e o 9.1 (colar no tradutor).

### 5.1 Implementar `pack()` e `unpack()` (`format.js`) ✅
- `pack({ senderId, createdAt, compressed, iv, ciphertext })` → `Uint8Array` com o layout de D5.
- `unpack(bytes)` → todos os campos **mais o `aad`** (os primeiros 15 bytes), necessário para a decifragem.
- Usar `DataView` para os campos multibyte (`created_at` em big-endian).
- **Critério de aceite**: `unpack(empacotar(x))` devolve `x` campo a campo; o `aad` retornado é exatamente `bytes.slice(0, 15)`.

### 5.2 Validação estrita na leitura ✅
Rejeitar **antes** de tentar decifrar, com mensagens distintas para cada caso:
- Arquivo menor que 28 bytes (cabeçalho + pelo menos a tag).
- `magic` diferente de `"TRHS"` → "este arquivo não é uma mensagem do app".
- `version` desconhecida → "arquivo gerado por uma versão mais nova do app".
- `flags` com bits reservados diferentes de zero.
- `sender_id` fora de `{0, 1}`.
- `created_at` absurdo (antes de 2024 ou mais de 24h no futuro) → aviso, não bloqueio.
- **Critério de aceite**: cada caso produz uma mensagem específica; nenhum arquivo malformado chega a `crypto.subtle.decrypt`.

### 5.3 Exportação: download do arquivo ✅
- `Blob` a partir do `Uint8Array` com tipo `application/octet-stream`, `URL.createObjectURL`, link com `download`.
- Nome sugerido: `msg-<AAAAMMDD-HHmmss>.treehash`.
- Liberar a URL com `URL.revokeObjectURL` após o clique.
- **Critério de aceite**: o arquivo baixado, reimportado no próprio app, decifra corretamente.

### 5.4 Importação: leitura do arquivo ✅
- `input type="file"` **e** drag-and-drop, ambos levando ao mesmo handler.
- Ler com `file.arrayBuffer()`.
- **Critério de aceite**: as duas formas de entrada produzem o mesmo resultado.

### 5.5 Formato armored (`armor.js`) ✅
> Ver **D6**.
- `toArmor(bytes)` → string com cabeçalho, base64 em linhas de 64 caracteres, e rodapé.
- `fromArmor(text)` → `Uint8Array`. Deve ser tolerante: ignorar espaços em branco, quebras de linha extras e texto antes/depois dos marcadores (o WhatsApp costuma adicionar contexto ao redor do que foi colado).
- **Critério de aceite**: `fromArmor(paraArmor(b))` devolve `b`; texto colado com lixo em volta ainda funciona; texto sem os marcadores é rejeitado com mensagem clara.

### 5.6 Documentar em `formato.md` ✅
- Tabela de campos, exemplo de arquivo real em hex, exemplo de bloco armored, e o algoritmo de derivação de chave (D4).
- **Critério de aceite**: documento suficiente para reimplementar o parser do zero em outra linguagem.

---

## Épico 6 — API Django (histórico)

### 6.1 Model `Message` ✅
- Campos:
  - `sender` — `FK(User, related_name="sent_messages")`
  - `recipient` — `FK(User, related_name="received_messages")`
  - `blob` — `BinaryField()` — o arquivo `.treehash` completo, exatamente como gerado
  - `created_at` — `DateTimeField()` — extraído do cabeçalho, informado pelo cliente (D7)
  - `received_at` — `DateTimeField(auto_now_add=True)` (D7)
  - `direction` — `CharField(choices=["sent", "received"])` — sob a perspectiva de quem gravou
- Guardar o blob inteiro (e não `iv`/`ciphertext` separados) simplifica: o servidor não precisa entender o formato, e o cliente recebe de volta exatamente o que precisa para decifrar.
- Índice em `(recipient, -received_at)`.
- **Critério de aceite**: `makemigrations`/`migrate` aplicados sem erro.

> ✅ Criado adiantado pelo outro dev (como `Mensagem`) e renomeado na migration 0003. `related_name` virou `sent_messages`/`received_messages` — `user.sent` sozinho não deixava claro o que era.

### 6.2 Endpoint: salvar mensagem no histórico ✅
- `POST /api/messages/` — recebe o blob binário (base64 no corpo JSON) e `direction`.
- O servidor **valida o cabeçalho** (magic, version, tamanho mínimo) mas nunca tenta decifrar.
- `sender`/`recipient` derivados do usuário logado e de `get_other_user()` (2.5) conforme o `direction` — nunca aceitos do cliente.
- `created_at` extraído do cabeçalho pelo servidor, não de um campo JSON separado.
- **Critério de aceite**: mensagem salva com os dois usuários corretos; um cliente que tente informar outro remetente é ignorado.

> ✅ **Adiantado — o 7.3 depende dele.** Além do previsto:
> - **Checagem de remetente:** o servidor calcula o `sender_id` esperado (2.5) e recusa com `sender_mismatch` um arquivo cujo cabeçalho aponte o outro usuário. Não dá para registrar como "enviada por mim" uma mensagem que o cabeçalho diz ter sido escrita pelo outro.
> - O parser do cabeçalho (`messenger/message_format.py`) espelha o `format.js`: magic, versão, bits reservados, `sender_id` e `created_at` com precisão de milissegundo. Arquivos acima de 1 MB são recusados (13.5).
>
> **19 testes** em `test_messages_api.py` (11 aqui, 8 no 6.3) e **12** em `test_message_format.py`.

### 6.3 Endpoint: listar histórico ✅

> ✅ **Veio do `anderson-branch` e foi corrigido na integração:**
> - **Filtro por dono.** "Remetente **ou** destinatário" parece certo, mas com 2 participantes as duas cópias da mesma mensagem — a "enviada" de quem escreveu e a "recebida" de quem importou (9.4) — têm exatamente o mesmo par de usuários. Cada um via a própria cópia **e** a do outro, ou seja, a mensagem repetida na tela. O filtro passou a ser por dono, em `Message.objects.owned_by()`, cruzando `direction` com `sender`/`recipient`.
> - **Endpoint movido para `api.py`** e protegido pelo `participant_api` do 4.3. A versão entregue vivia em `views.py` e só checava autenticação, então um superusuário conseguia listar o histórico.
> - **Payload em camelCase**, igual ao resto da API, e com o `direction` — a tela do 10.1 precisa dele para separar enviadas de recebidas.
> - **8 testes** em `test_messages_api.py`.

- `GET /api/messages/?page=N` — a cópia do usuário logado, mais recentes primeiro.
- Retornar apenas metadados (`id`, `sender`, `recipient`, `direction`, `createdAt`, `receivedAt`, `size`), **não** o blob.
- Usar `Paginator` do Django.
- **Critério de aceite**: cada usuário vê só a própria cópia; a resposta não contém nenhum byte de ciphertext.

### 6.4 Endpoint: buscar blob específico ✅
- `GET /api/messages/<id>/blob/` — retorna o blob em base64 para re-decifrar no navegador.
- **Critério de aceite**: retorna `403` se o usuário logado não for remetente nem destinatário.

> ✅ **Feito junto com o Épico 10, que depende dele.**
> - `GET /api/messages/<id>/blob/` devolve o blob em base64 **mais os metadados** da mensagem, para a tela poder nomear o arquivo no download sem uma segunda chamada.
> - **Quem não é dono recebe 404, não 403.** Este item foi escrito antes do conceito de dono (6.3): com 2 participantes, quem não participa já é barrado com 403 pelo `participant_api`, e a cópia do outro usuário não é "proibida", ela simplesmente não está no seu histórico. Responder 404 evita confirmar que a linha existe.
> - **5 testes** em `test_messages_api.py`.

### 6.5 Endpoint: deduplicação ✅
- `HEAD /api/messages/?hash=<sha256-do-blob>` — permite ao cliente saber se uma mensagem já está no histórico antes de gravar.
- Evita duplicatas quando o usuário importa o mesmo arquivo duas vezes.
- **Critério de aceite**: importar o mesmo arquivo duas vezes gera apenas um registro.

> ✅ **Feito junto com o 9.4, que depende dele.**
> - `Message` ganhou `blob_sha256`, preenchido no `save()` e indexado (migration **0004**, com backfill das linhas antigas).
> - `HEAD /api/messages/?hash=<sha256>` responde **200** se a mensagem já está no histórico *do usuário logado*, **404** se não está e **400** se o parâmetro não é um sha256.
> - **O POST também ficou idempotente**: reenviar o mesmo arquivo devolve 200 com a mensagem que já existia, em vez de criar outra linha. O HEAD economiza o upload; o POST é o que garante o critério mesmo se o cliente esquecer de perguntar.
> - **O hash não é único no banco, de propósito.** As duas cópias da mesma mensagem — a "enviada" de quem escreveu e a "recebida" de quem importou (9.4) — têm exatamente os mesmos bytes. A deduplicação acontece sempre dentro do dono (`owned_by`), nunca no banco inteiro.
> - **A gravação é atômica.** A checagem por hash é o caminho rápido; quem garante é a restrição `message_unique_copy` no banco (migration **0006**). Dois POSTs simultâneos com o mesmo arquivo não criam duas linhas: o segundo bate na restrição e recebe 200 com a linha que já existia.
> - **8 testes** em `test_messages_api.py`, incluindo um que confirma a recusa no nível do banco.

### 6.6 Proteção CSRF nas chamadas JS ✅
- Incluir `{% csrf_token %}` no template e enviar em `X-CSRFToken` em todo `fetch` de escrita.
- `requestJson()` em `api.js` envia `X-CSRFToken` em toda escrita; o token vem do objeto de sessão da página (`get_token(request)`), sem leitura de cookie. ✅ Há teste com `enforce_csrf_checks=True` confirmando que POST sem token é recusado e que o token entregue pela página é aceito.
- **Critério de aceite**: requisições POST sem o token são rejeitadas pelo Django.

### 6.7 Registrar `Message` no Django Admin ✅
- Exibir `sender`, `recipient`, `created_at`, `received_at`, tamanho do blob.
- **Nunca** exibir o conteúdo do blob nem oferecer ação de decifrar.
- `has_change_permission = False` — o histórico é imutável.
- **Critério de aceite**: superusuário vê metadados, mas não o conteúdo, e não consegue editar.

> ✅ **Adiantado junto com o 2.6** — é o único lugar para conferir o critério do 7.3 enquanto a tela de histórico (Épico 10) não existe. Sem adicionar nem editar; o conteúdo cifrado não aparece, só o tamanho.

### 6.8 Endpoints de backup da chave privada ✅
> Camada 1 de **D11**. É a diferença entre "espero ainda ter aquele arquivo de meses atrás" e "faço login e digito a senha".

- Model `KeyBackup`: `user` (FK), `blob` (`BinaryField`), `created_at` (`auto_now_add`). Versionado — cada novo backup cria um registro, o mais recente é o ativo.
- `POST /api/key-backup/` — recebe o blob em base64 e grava.
- `GET /api/key-backup/` — retorna o blob mais recente do usuário logado, ou `404` se não houver.
- O `blob` é a chave privada em JWK, cifrada com AES-GCM sob chave derivada por PBKDF2 (600.000 iterações) da **senha de backup**, que é distinta da senha de login e nunca sai do navegador.
- Para o servidor é um array de bytes opaco — **o modelo de ameaça não muda**, ele continua sem conseguir ler nada.
- Registrar no Admin exibindo apenas `user`, `created_at` e tamanho; nunca o conteúdo.
- **Critério de aceite**: o blob armazenado, aberto em editor hex, não contém a chave em claro; `GET` de outro usuário retorna `404`.

> ✅ **Feito junto com o 11.3 e o 11.6.**
> - `POST /api/key-backup/` grava (limite de 8 KB; o backup real tem ~180 bytes) e `GET` devolve o mais recente do usuário logado, ou 404 com `backup_not_found`.
> - **Versionado:** cada envio cria uma linha. O histórico de backups fica no Admin, sem o conteúdo.
> - **O servidor valida o envelope antes de aceitar** (`key_backup_format.py`): magic `TKEY`, versão e faixa de tamanho. Ele não consegue — nem deve — decifrar, mas recusar bytes aleatórios impede que alguém satisfaça a trava do 11.5 mandando lixo pela API.
> - O blob é opaco para o servidor: AES-GCM sob chave derivada por PBKDF2 da senha de backup, que nunca sai do navegador. **21 testes** em `test_key_backup.py`.

---

## Épico 7 — Fluxo de Envio ("Compositor") ✅

> **Concluído.** 7.1, 7.2 e 7.5 já estavam prontos desde os Épicos 0 e 3; faltavam o 7.3 e o 7.4, que dependiam do 6.2. O `sender_id` gravado no arquivo, fixo em `0` desde o Épico 0, agora vem da sessão real (4.4).

### 7.1 Template de composição ✅
- `compor.html` com `<textarea>`, contador de caracteres e botão "Gerar mensagem criptografada".
- **Critério de aceite**: página renderiza e é acessível só logado.

### 7.2 Orquestração do pipeline (`app.js`) ✅
```
texto
  → huffman.encode          → { bytes, compressed }
  → montar AAD (15 bytes)   → magic|version|flags|senderId|createdAt
  → cipher.encrypt(bytes, aesKey, aad)
  → format.pack       → Uint8Array final
```
- Atenção à ordem: o AAD precisa ser montado **antes** de cifrar, porque entra na cifragem (4.6).
- **Critério de aceite**: pipeline completo executa sem erros; o `app.js` não mudou em relação ao contrato do Épico 0.3.

### 7.3 Salvar cópia no histórico ✅
- Após gerar o arquivo, `POST /api/messages/` com `direction = "sent"` (6.2).
- **Critério de aceite**: mensagem aparece no histórico do remetente logo após a geração.

> ✅ Depois do download, o `compose.js` chama `POST /api/messages/` com `direction = "sent"`. Verificável no Admin (6.7) enquanto o Épico 10 não traz a tela de histórico.

### 7.4 Feedback visual ✅
- Estado de carregamento durante o processamento.
- Mensagem de sucesso ou erro específico por etapa que falhou (compressão / cifragem / envio ao histórico).
- Falha ao salvar no histórico **não** deve impedir o download do arquivo — são operações independentes.
- **Critério de aceite**: o usuário sempre recebe feedback; uma falha de rede não bloqueia a geração do arquivo.

> ✅ O título do erro indica a etapa (*Falha na compressão*, *Falha na cifragem*, *Falha ao montar o arquivo*). O download acontece **antes** da gravação no histórico: se o servidor falhar, o arquivo já foi entregue e a tela mostra um aviso amarelo — *"Arquivo gerado, mas não foi salvo no histórico"* — com o motivo.

### 7.5 Painel de estatísticas de compressão ❌ removido da interface
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

> ❌ **Fora da tela desde 17/09/2026, a pedido do cliente.** O usuário não precisa ver os números da compressão. O Huffman continua comprimindo o arquivo, e `stats()`/`measure()` (3.6) continuam no `huffman.js`, testados — o que saiu foi só a exibição. Para trazer de volta, basta voltar a renderizar `last.stats` no `compose.js`.

---

## Épico 8 — Compartilhamento (pen-drive, WhatsApp, e-mail) ✅

> Este épico não existia no backlog anterior, apesar de ser o requisito central do projeto. Cada canal tem um detalhe próprio.

> ✅ **Concluído em 17/09/2026.** A seção *Enviar para o destinatário* aparece no compositor assim que o arquivo é gerado, com quatro caminhos: baixar de novo, copiar como texto, abrir no e-mail e o compartilhamento nativo do sistema.
>
> - **O bloco colável leva uma linha de apresentação antes dos marcadores.** O `fromArmor` ignora texto em volta (5.5), então quem recebe entende o que é aquilo sem quebrar a leitura. Há teste com o bloco cercado de texto dos dois lados.
> - **A cópia tem plano B.** Se o navegador recusar a área de transferência, o bloco aparece numa caixa de texto já selecionada, em vez de falhar em silêncio.
> - **O botão nativo só existe quando dá.** `navigator.canShare({ files })` é consultado com o arquivo real; no desktop ele simplesmente não aparece, e um `canShare` que estoura também derruba o botão.
> - **Desistir do compartilhamento não é erro.** `AbortError` é tratado à parte, sem mensagem de falha.
> - **17 testes** em `tests/share.test.js`.
>
> **O que ainda não dá para conferir na tela:** colar o bloco no tradutor, porque a entrada de texto colado é o 9.1. Hoje o round-trip é garantido por teste (`fromArmor(pasteBlock(bytes))`), não pela interface.

### 8.1 Pen-drive — download do arquivo ✅
- Botão "Baixar arquivo `.treehash`" (usa 5.3).
- Texto de apoio explicando que basta copiar para o pen-drive.
- **Critério de aceite**: arquivo baixado, copiado e reaberto em outra máquina decifra corretamente.

### 8.2 WhatsApp / e-mail — bloco de texto colável ✅
- Botão "Copiar como texto" que gera o bloco armored (5.5) e usa `navigator.clipboard.writeText`.
- Resolve os dois canais sem depender de anexo, e funciona bem no celular.
- Confirmação visual ("copiado!") após o clique.
- **Critério de aceite**: o bloco copiado, colado no tradutor, decifra corretamente.

### 8.3 E-mail — instrução explícita sobre anexo ✅
- **`mailto:` não consegue anexar arquivos.** Não tentar implementar isso.
- Oferecer duas opções na interface: "Copiar como texto" (8.2) ou "Baixar e anexar manualmente" (8.1), com o botão `mailto:` preenchendo apenas assunto e corpo com uma instrução.
- **Critério de aceite**: a interface não promete anexo automático em nenhum momento.

### 8.4 Compartilhamento nativo (progressive enhancement) ✅
- Se `navigator.canShare?.({ files: [...] })` for verdadeiro, exibir botão "Compartilhar" usando `navigator.share`.
- Abre o menu nativo do sistema (Android/iOS), entregando WhatsApp, e-mail e mais em um clique.
- Se a API não existir, o botão simplesmente não aparece — os demais caminhos continuam funcionando.
- **Critério de aceite**: no desktop sem suporte, nada quebra; no celular com suporte, o menu nativo abre com o arquivo anexado.

### 8.5 Aviso sobre o canal ✅
- Texto curto na interface: o arquivo é seguro para trafegar por qualquer canal, mas **a senha/verificação de identidade nunca deve ir pelo mesmo canal**.
- **Critério de aceite**: o aviso aparece na tela de compartilhamento.

---

## Épico 9 — Fluxo de Recebimento ("Tradutor") ✅

> ✅ **Concluído em 17/09/2026.** As três entradas do 9.1 funcionam: seletor de arquivo, arrastar e soltar, e o bloco de texto colado. Arquivo e texto caem no mesmo caminho — o texto passa antes pelo `fromArmor`.
>
> - **O que decifra é gravado** (9.4): o tradutor pergunta ao 6.5 se a mensagem já está lá e só então faz o `POST` com `direction = "received"`. Importar o mesmo arquivo duas vezes não duplica.
> - **Servidor fora do ar não atrapalha a leitura.** A mensagem aparece do mesmo jeito, com aviso amarelo de que não foi guardada no histórico e o motivo — mesma escolha do 7.4.
> - **Cada falha tem título próprio** (9.5): *Bloco de texto inválido*, *Arquivo inválido*, *Faltam as chaves*, *Arquivo adulterado ou chave incorreta* e *Arquivo corrompido*. O texto de cada erro continua vindo do módulo que o detectou, já em português.
> - **Botão "copiar texto"** no resultado (9.3), com plano B quando o navegador recusa a área de transferência.
> - **8 testes** novos em `tests/api.test.js` cobrem o hash e a consulta ao 6.5.

### 9.1 Template do tradutor ✅
- `tradutor.html` com três entradas equivalentes: seletor de arquivo, área de drag-and-drop, e `<textarea>` para colar o bloco armored.
- **Critério de aceite**: as três formas de entrada funcionam.

### 9.2 Orquestração do pipeline reverso ✅
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

### 9.3 Exibição da mensagem decodificada ✅
- Área de leitura não editável, com o texto, a data de criação (`created_at`) e quem enviou (`sender_id`).
- Botão "copiar texto".
- **Critério de aceite**: o texto exibido é idêntico ao digitado pelo remetente.

### 9.4 Salvar no histórico do destinatário ✅
> Faltava no backlog anterior: o Épico 7 salvava no envio, mas nada era gravado quando B importava o arquivo.

- Após decifrar com sucesso, `POST /api/messages/` com `direction = "received"` (6.2).
- Consultar antes o endpoint de deduplicação (6.5).
- **Critério de aceite**: importar um arquivo faz a mensagem aparecer no histórico do destinatário; importar duas vezes não duplica.

### 9.5 Tratamento de erros ✅
Cada falha tem mensagem própria:

| Situação | Mensagem |
|---|---|
| Não é um `.treehash` (magic errado) | "Este arquivo não é uma mensagem do aplicativo." |
| Versão desconhecida | "Arquivo gerado por uma versão mais nova do app." |
| Cabeçalho malformado | "Arquivo corrompido." |
| Falha na tag GCM | "Arquivo adulterado ou chave incorreta." |
| Chave do outro usuário ausente | "Ainda não foi feita a troca de chaves com o outro usuário." |
| Bits acabam antes do EOF | "Arquivo truncado — o download pode ter sido interrompido." |

- **Critério de aceite**: cada tipo de erro mostra sua mensagem; nenhum erro cru de JS aparece só no console.

---

## Épico 10 — Histórico de Mensagens ✅

> ✅ **Concluído em 17/09/2026.** Tela em `/history/`, ligada no menu, com filtros, paginação, decifrar e baixar.
>
> - **Decifrar de novo (10.2) e baixar de novo (10.3)** buscam o blob pelo 6.4. O nome do arquivo é recalculado pelo `fileName(createdAt)` do `format.js`, o mesmo que gerou o nome original — o arquivo rebaixado sai idêntico, com o mesmo nome.
> - **Filtros (10.4)** por origem e por intervalo de datas, sobre o `created_at` (D7), que é a data que a tela mostra. Data ou origem inválida devolve 400 com `invalid_filter`, em vez de ignorar o filtro em silêncio.
> - **Sem a chave, a lista continua de pé (10.5).** O aviso aparece e o botão *Decifrar* fica desligado, mas *Baixar* continua funcionando: o download é só bytes, não precisa de chave nenhuma. Isso é o que permite recuperar o arquivo num aparelho novo e abri-lo noutro que tenha a chave.
> - **11 testes** novos no servidor e **6** no cliente.

### 10.1 Template de listagem ✅
- `historico.html`, listando enviadas e recebidas com data, direção e tamanho.
- Carrega via `GET /api/messages/` (6.3).
- **Critério de aceite**: lista carrega e renderiza corretamente.

### 10.2 Ação "decifrar novamente" ✅
- Botão em cada item que busca o blob via 6.4 e roda o pipeline do 9.2.
- **Critério de aceite**: mensagem antiga é decifrada sem precisar do arquivo original.

### 10.3 Ação "baixar novamente" ✅
- Reoferece o download do `.treehash` original a partir do blob armazenado.
- **Critério de aceite**: o arquivo rebaixado é byte-a-byte idêntico ao original.

### 10.4 Paginação e filtros ✅
- `Paginator` no endpoint; filtro por direção (enviadas/recebidas) e por intervalo de datas via query params.
- **Critério de aceite**: histórico com muitas mensagens carrega em páginas sem travar a tela.

### 10.5 Aviso de dependência da chave local ✅
- Se não houver chave privada no IndexedDB, o histórico ainda lista as mensagens, mas exibe aviso: "o conteúdo não pode ser lido neste dispositivo — restaure sua chave (ver Épico 11)".
- **Critério de aceite**: sem chave local, a lista aparece com o aviso e sem erro de JS.

---

## Épico 11 — Confiança: verificação de identidade e backup de chave 🟡

> 🟡 **11.1 a 11.6 concluídos em 17/09/2026. Falta o 11.7** (recuperação assistida pelo outro usuário), que é uma entrega à parte — ver a nota no próprio item.
>
> Tudo isso vive na tela **Identidade** (`/identity/`), nova no menu.

> Este épico fecha dois furos do modelo de ameaça que o backlog anterior não cobria.

### 11.1 Verificação de fingerprint (defesa contra MITM do servidor) ✅
**Problema:** o documento promete que "o servidor nunca vê texto puro", e é verdade — mas o servidor **distribui as chaves públicas** (4.3). Um servidor comprometido entrega a chave dele no lugar da chave do outro usuário e passa a ler tudo, sem que ninguém perceba. É exatamente o ataque que Signal e WhatsApp mitigam com o "código de segurança".

- Calcular `SHA-256` da JWK canônica da chave pública.
- Exibir em formato legível: 12 grupos de 4 dígitos hexadecimais, ou 6 palavras de uma wordlist curta em português.
- Tela "Verificação de identidade" mostrando **o meu fingerprint e o do outro usuário**, lado a lado.
- **Critério de aceite**: os dois usuários, em máquinas diferentes, veem o mesmo par de fingerprints.

> ✅ **O fingerprint é calculado nos dois lados e os dois chegam ao mesmo valor.** O navegador monta a forma canônica da JWK (as mesmas 4 chaves em ordem, sem espaços) e tira o SHA-256; o servidor faz o mesmo em `jwk.fingerprint()`. Um teste em cada linguagem trava o mesmo valor para o mesmo vetor de chave — se um lado mudar, o outro acusa.
>
> A tela mostra os dois códigos lado a lado, em 12 grupos de 4 dígitos. **O servidor nunca envia o fingerprint pronto**: se enviasse, um servidor comprometido poderia mandar o código "certo" junto com a chave falsa. O navegador calcula a partir da chave que recebeu.

### 11.2 Marcar como verificado ✅
- Botão "Já conferi pessoalmente" que grava `fingerprint_verified = True` no `Profile`.
- Enquanto não verificado, exibir um aviso discreto e permanente no compositor.
- Se a chave pública do outro mudar, resetar a flag e exibir aviso destacado.
- **Critério de aceite**: a flag aparece no Admin; a mudança de chave reseta a verificação.

> ✅ **A flag vive no perfil de quem é conferido.** `marcio.profile.fingerprint_verified = True` significa "a chave do marcio foi conferida pelo outro usuário" — e como são exatamente 2 participantes, quem marca é sempre o outro. Isso encaixa com o 4.3, que já zerava a flag quando uma chave nova é registrada.
>
> **O servidor confere o código antes de marcar.** O cliente envia o fingerprint que exibiu; se ele não bate com a chave registrada naquele momento, a resposta é 409 e nada é marcado — é o caso de a página estar velha, ou de a chave ter mudado no meio do caminho.
>
> No compositor, enquanto não houver confirmação, a faixa de avisos diz que falta conferir o código.

### 11.3 Cifrar a chave privada com senha (base das duas camadas de backup) ✅
**Problema:** a chave privada existe **apenas** no IndexedDB. Limpar dados do navegador, trocar de máquina ou usar aba anônima significa perder o acesso a todo o histórico, permanentemente. É o cenário mais provável de a demonstração falhar no dia da apresentação.

- Exportar o par como JWK e cifrar com AES-GCM sob chave derivada de uma **senha de backup** via `PBKDF2` (SHA-256, **600.000 iterações** — recomendação atual da OWASP, ~0,5 s no desktop, salt aleatório de 16 bytes).
- A senha de backup é distinta da senha de login e nunca sai do navegador.
- O mesmo blob cifrado alimenta as **duas camadas** de D11: enviado ao servidor (6.8) e oferecido como download.
- Layout do arquivo `.treehashkey`: `magic("TKEY") | version | iterações(uint32) | salt(16) | iv(12) | ciphertext`.
- Avisar que a senha não pode ser recuperada.
- **Critério de aceite**: o blob gerado não contém a chave em claro (verificável abrindo em editor hex); o mesmo blob é aceito tanto pelo endpoint quanto pelo importador de arquivo.

> ✅ **`key-backup.js`, com o layout de arquivo previsto aqui.** Cabeçalho de 37 bytes — magic `TKEY`, versão, iterações (uint32), salt (16) e IV (12) — seguido do ciphertext. Os 25 primeiros bytes entram como AAD, então mexer nas iterações ou no salt invalida o arquivo.
>
> - **O teste do critério de aceite existe:** o blob é varrido e não contém nem a coordenada `d` nem o `x` da chave em claro.
> - **As iterações vêm do arquivo, com limite.** Ler o parâmetro do próprio arquivo é o que permite abrir backups antigos se o número mudar um dia; o limite de 2 milhões evita que um arquivo hostil trave o navegador pedindo uma derivação eterna.
> - **O mesmo blob vai para as duas camadas** no mesmo clique: sobe para o servidor (6.8) e é baixado como `chave-<usuário>-<data>.treehashkey`.

### 11.4 Importar a chave privada (restauração) ✅
- Ler o `.treehashkey`, pedir a senha, decifrar e gravar no IndexedDB.
- Senha errada → mensagem clara, sem revelar nada sobre a chave.
- **Critério de aceite**: restaurar em um navegador limpo dá acesso ao histórico completo; senha errada falha de forma limpa.

> ✅ **`openBackup` + `keyPairFrom` reconstroem o par a partir do JWK guardado.** O teste mais forte aqui não é o round-trip do arquivo: é derivar a chave AES com o par restaurado e decifrar uma mensagem cifrada com o par original. É isso que prova que restaurar devolve o histórico.
>
> Senha errada e arquivo adulterado dão a **mesma** mensagem — "senha incorreta ou arquivo corrompido" —, porque distinguir os dois casos contaria a quem tem o arquivo se a senha testada chegou perto.

### 11.5 Onboarding de primeiro acesso ✅
- Fluxo guiado no primeiro login: gerar chave → publicar chave pública → definir senha de backup → **enviar o backup ao servidor** (6.8) → **baixar o `.treehashkey`** → verificar fingerprint.
- As duas camadas de backup são criadas no mesmo passo, a partir do mesmo blob (11.3) — para o usuário é uma ação só.
- **Critério de aceite**: o usuário não consegue chegar ao compositor sem ter passado pelo backup.

> ✅ **A trava é no servidor, não na tela.** Compositor e tradutor só abrem se existir um `KeyBackup` do usuário; sem ele, redirecionam para `/identity/`. Não dá para contornar digitando a URL.
>
> O histórico e a própria tela de identidade continuam abertos: o histórico porque ele funciona sem chave (10.5), e a identidade porque é onde o backup é criado.

### 11.6 Recuperação a partir do backup no servidor ✅
> Camada 1 de **D11** — o caminho principal de recuperação.

- No boot, se não houver chave no IndexedDB, consultar `GET /api/key-backup/` (6.8).
- Havendo backup, exibir: *"Detectamos um backup da sua chave. Digite a senha de backup para restaurar o acesso ao histórico."*
- Decifrar no navegador e gravar o par no IndexedDB.
- Senha errada → mensagem clara, sem revelar nada sobre a chave. Limitar tentativas no cliente para desencorajar força bruta local.
- **Critério de aceite**: em um navegador limpo, login mais senha de backup devolvem o histórico completo, sem precisar de arquivo nenhum.

> ✅ **A tela de identidade consulta o 6.8 sozinha e mostra o bloco de restauração quando há backup guardado**, com a data. A senha abre o blob no navegador, o par volta para o IndexedDB e a página recarrega para tudo ser derivado de novo.
>
> - **Tentativas limitadas a 5** por carregamento de página, como o item pede. É um freio contra tentativa e erro manual; quem tem o blob e tempo continua limitado pelo PBKDF2 de 600 mil iterações, que é a defesa real.
> - **Se a chave local não for a registrada**, a tela avisa antes mesmo de o usuário tentar qualquer coisa: o `publish` devolve 409, e é esse o sinal de que o navegador perdeu a chave.

### 11.7 Recuperação assistida pelo outro usuário ⏳
> Camada 3 de **D11** — último recurso, possível apenas porque o sistema tem exatamente 2 usuários.

Se um usuário perde a chave e nenhum backup funciona, o outro ainda tem a dele — e como todo o histórico está cifrado sob o mesmo segredo compartilhado estático, **ele consegue decifrar tudo**. O fluxo:

1. **A** gera um par novo e publica a nova pública (exige liberar o write-once de 4.3 via Admin).
2. **B** recebe aviso de que a chave de A mudou e **reverifica o fingerprint** (11.1). Este passo é obrigatório — é o que impede alguém de se passar por A.
3. **B** decifra todo o histórico com o segredo antigo, recifra com o novo e reenvia os blobs.
4. **A** recupera o acesso ao histórico completo.

- Todo o processo roda no navegador de B; o servidor continua vendo apenas blobs opacos.
- Processar em lotes, com barra de progresso — pode haver muitas mensagens.
- **Critério de aceite**: após a recuperação, A lê todas as mensagens anteriores à perda da chave; um teste automatizado cobre a recifragem de um histórico de ao menos 20 mensagens.

> ⏳ **Único item do épico que ficou de fora**, e não por esquecimento: ele mexe no histórico inteiro.
>
> **Decidido em 17/09/2026: não reescrever blobs.** Substituir o que já está gravado contraria o 6.7 ("o histórico é imutável") e o que o projeto promete — o servidor guarda exatamente o que o cliente gerou, byte a byte. A recifragem vai gravar **linhas novas** para quem perdeu a chave; as antigas continuam onde estão, ilegíveis para ele e legíveis para quem manteve a chave.
>
> O resto do trabalho é conhecido: reverificar o fingerprint (obrigatório, é o que impede alguém de se passar por A), decifrar e recifrar em lotes com barra de progresso, e um teste com pelo menos 20 mensagens.

---

## Épico 12 — Interface e UX ✅

> ✅ **Concluído em 17/09/2026**, junto com o 12.5 que já estava feito.

### 12.1 Layout base ✅
- Template `base.html` com navegação: Compor · Tradutor · Histórico · Identidade · Sair.
- Indicação de qual usuário está logado.
- **Critério de aceite**: navegação consistente em todas as páginas.

> ✅ A navegação ficou completa quando o Épico 10 trouxe o Histórico e o 11 a Identidade. O nome do usuário logado e o botão de sair ficam à direita, em todas as páginas, e a tela de login não mostra menu nenhum.

### 12.2 CSS próprio, sem framework ✅
- Escopo pequeno demais para justificar Bootstrap/Tailwind. CSS único, com variáveis para as cores.
- Responsivo — o tradutor será usado no celular com frequência (8.4).
- **Critério de aceite**: as quatro telas funcionam em 360px de largura.

> ✅ CSS único, com variáveis de cor, sem framework. Três pontos de quebra: 720px (a tabela do percurso desce para baixo da árvore), 480px (botões e filtros ocupam a largura toda) e 400px (topo mais compacto, fingerprint menor e quebrando linha).
>
> **Limite honesto:** conferi as regras e os pontos de quebra lendo o CSS, não abrindo as telas em 360px — daqui não tenho navegador. Vale abrir pelo túnel (16.3) antes de considerar o item fechado de verdade.

### 12.3 Estados de tela padronizados ✅
- Componentes reutilizáveis para: carregando, sucesso, erro, vazio.
- **Critério de aceite**: nenhuma tela fica sem resposta visual durante uma operação assíncrona.

> ✅ Quatro estados, todos no `ui.js`: `showLoading`, `showStatus` (sucesso, erro e aviso), `showEmpty` e `clearStatus`.
>
> - **Carregando** agora aparece em toda operação demorada: gerar a mensagem, ler o arquivo, carregar o histórico e — onde mais importa — cifrar ou abrir o backup, que passa 600 mil rodadas de PBKDF2 e demora o suficiente para parecer travado sem aviso.
> - **Vazio** virou componente: o `showEmpty` monta `<li>` dentro de lista e `<p>` fora dela, então serve tanto para o histórico quanto para qualquer outra tela.
> - A animação do "carregando" respeita `prefers-reduced-motion`.

### 12.4 Indicador de estado criptográfico ✅
- Badge permanente no cabeçalho, cobrindo cinco sinais: chave local presente? chave do outro conhecida? fingerprint verificado? backup no servidor criado? armazenamento persistente concedido (4.9)?
- Qualquer sinal negativo leva, com um clique, à ação que o resolve.
- **Critério de aceite**: o usuário identifica em um olhar se o canal está pronto para uso e se sua chave está protegida contra perda.

> ✅ Badge no topo, em todas as páginas, com os cinco sinais previstos: chave deste navegador, chave do outro usuário, identidade conferida, backup guardado e armazenamento permanente. Mostra "3/5" e fica verde só quando os cinco estão em ordem; o clique leva para a tela de Identidade, que é onde três deles se resolvem.
>
> - **A lógica ficou fora do DOM** (`buildSignals` e `summarize` em `badge.js`), então dá para testar: **7 testes** em `tests/badge.test.js`.
> - O sinal da chave local usa o 409 do write-once: se o servidor recusa a chave deste navegador, é porque ela não é a registrada — e a dica manda restaurar o backup.
> - O armazenamento permanente é consultado com `navigator.storage.persisted()`, que **não** dispara pedido de permissão — quem pede é o boot da página (4.9).

### 12.5 Árvore Binária de Busca na tela ✅

> Pedido em 17/09/2026: a organização da árvore precisa aparecer para o usuário, com cada caractere virando um valor e a árvore sendo remontada a cada mensagem.

**Como o valor é formado**

- **Valor do nó = código do caractere × quantas vezes ele aparece.** Como o valor depende da contagem, a árvore só pode ser montada depois de ler a mensagem inteira, e é remontada do zero a cada uma: `a` sozinho vale 97, `aa` vale 194.
- **O valor não é único, ao contrário do que parece.** Dois espaços valem 32 × 2 = 64 e um `@` sozinho também vale 64; um `d` vale 100 e dois `2` também. O desempate é pelo código do caractere — sem ele a árvore fica ambígua. A tela avisa quando a mensagem tem um empate desses.
- A ordem de inserção é a de primeira aparição no texto, e é ela que dá forma à árvore. Texto cujos valores já chegam em ordem crescente produz uma árvore degenerada, e o desenho mostra isso.
- Caracteres fora do ASCII usam o ponto de código Unicode: a tabela ASCII vai só até 127, e `ç` (231) ou emoji não cabem nela.

**Como aparece na tela**

- **A árvore é montada passo a passo**, um nó por vez, destacando o nó que acabou de entrar e o caminho de comparações que levou até ele — é isso que mostra *como* a árvore se organiza, e não só o resultado. A montagem inteira leva cerca de 5 segundos, com o passo ajustado ao número de nós.
- Botões *Mostrar tudo* (pula para o fim) e *Montar de novo* (repete a montagem), mais *Centralizar* para reenquadrar.
- **Arrastar move a árvore e o scroll aproxima ou afasta**, entre 0,2× e 3×. Enquanto o usuário não mexer, o enquadramento se ajusta sozinho a cada passo; depois que ele mexe, a visão fica onde ele deixou.
- O percurso em ordem fica **ao lado** da árvore, numa tabela rolável com cabeçalho fixo, destacando a linha do nó recém-inserido. Abaixo de 720px de largura, a tabela desce para baixo da árvore.
- Quem tem `prefers-reduced-motion` ligado recebe a árvore pronta, sem animação.

**Limites**

- `search-tree.js` faz contagem, inserção, busca devolvendo o caminho percorrido, percurso em ordem, altura, detecção de empates e posicionamento para desenho. `tree-view.js` cuida do SVG, do arrastar e do zoom.
- Só no compositor. **A árvore não entra no pipeline do arquivo**: ela organiza e exibe, e o conteúdo cifrado não muda por causa dela.
- **Critério de aceite**: a árvore muda a cada mensagem; a montagem é visível passo a passo; o percurso em ordem devolve os valores em ordem crescente; empates aparecem na tela. ✅ **32 testes** em `tests/search-tree.test.js`.

---

## Épico 13 — Segurança e Hardening ✅

### 13.1 Auditoria de dados sensíveis ✅
- Revisar todo o backend confirmando que texto puro e chaves privadas nunca chegam ao servidor.
- Buscar por `print(`, `logger.debug(` e `console.log(` em caminhos que tocam plaintext.
- **Critério de aceite**: checklist de revisão documentado, com cada endpoint listado e assinado.

> ✅ **Revisão feita endpoint a endpoint em 17/09/2026.** Nenhum recebe texto puro nem chave privada:
>
> | Endpoint | Recebe | Guarda | Devolve |
> |---|---|---|---|
> | `POST /api/public-key/` | JWK **pública** | a forma canônica no `Profile` | a mesma chave |
> | `GET /api/public-key/<user>/` | — | — | a chave pública do outro |
> | `GET /api/messages/` | filtros | — | metadados, **sem** blob |
> | `HEAD /api/messages/?hash=` | um sha256 | — | só o código de status |
> | `POST /api/messages/` | blob cifrado em base64 | o blob exatamente como veio | metadados |
> | `GET /api/messages/<id>/blob/` | — | — | o mesmo blob cifrado |
> | `POST /api/key-backup/` | blob cifrado por senha | o blob | data e tamanho |
> | `GET /api/key-backup/` | — | — | o blob cifrado |
> | `POST /api/fingerprint/` | o código conferido | a flag de verificação | o estado da chave |
>
> - **Nenhum `print`, `logger.` ou `console.log`** no código do servidor ou do cliente — conferido por busca, e é isso que a busca do item pedia.
> - `django.db.backends` fica em `WARNING` no `LOGGING` (13.6): em `DEBUG` o Django loga o SQL **com os parâmetros**, e é por ali que um blob vazaria para o log.
> - As funções que manipulam blob e senha levam `@sensitive_variables`, então não aparecem em relatório de exceção.

### 13.2 Rate limiting no login ✅
- `django-ratelimit` na view de login (ex.: 5 tentativas por IP a cada 15 minutos).
- **Critério de aceite**: exceder o limite bloqueia novas tentativas temporariamente.

> ✅ **Sem dependência nova.** O limitador é um decorator de 30 linhas (`messenger/throttle.py`) sobre o cache do Django: conta tentativas por endereço, bloqueia com **429** depois de 5 em 15 minutos e zera o contador quando o login dá certo. Parâmetros por variável de ambiente.
>
> - **A contagem é atômica** (`cache.add` seguido de `cache.incr`): tentativas simultâneas do mesmo endereço não sobrescrevem umas às outras, que é o que aconteceria lendo e escrevendo o contador em dois passos.
> - **`GET` nunca é bloqueado** — a tela de login continua abrindo, só o envio do formulário é barrado.
> - **O endereço vem do `REMOTE_ADDR`**, e só olha o `X-Forwarded-For` quando a aplicação está atrás de proxy (detectado pelo `SECURE_PROXY_SSL_HEADER`). Confiar no cabeçalho sem proxy deixaria qualquer um trocar de "IP" e furar o limite.
> - ⚠️ **Limite conhecido:** o cache padrão é por processo. Com vários workers do gunicorn, cada um conta em separado e o limite efetivo multiplica. Em produção isso pede um cache compartilhado (Redis ou o banco).
> - **7 testes** em `test_security.py`, junto com os da CSP.

### 13.3 Content Security Policy ✅
- Cabeçalho CSP restritivo: `default-src 'self'; script-src 'self'; object-src 'none'; base-uri 'none'`.
- Sem `unsafe-inline` — todo JS em arquivo externo. Isso protege a chave privada no IndexedDB contra XSS, que é o vetor mais realista neste app.
- **Critério de aceite**: nenhum script inline no HTML; o console não reporta violações de CSP.

> ✅ **Middleware próprio** (`core/middleware.py`), sem dependência. A política do app é a prevista aqui, mais `style-src 'self'`, `form-action 'self'` e `frame-ancestors 'none'`.
>
> - **Um teste varre as quatro telas** e falha se aparecer qualquer `<script>` que não seja `src=` externo ou o `type="application/json"` do `json_script` — que é dado inerte, não executa, e por isso não esbarra na CSP.
> - **O `/admin/` recebe uma política à parte, com `unsafe-inline`.** O Admin do Django usa scripts e estilos embutidos nas próprias páginas; aplicar a política estrita ali quebraria a tela que o time usa para liberar chave. O que a CSP protege é a chave privada no IndexedDB, e o Admin não tem acesso a ela.

### 13.4 Configurações de produção ✅
- `SECURE_SSL_REDIRECT`, `SESSION_COOKIE_SECURE`, `CSRF_COOKIE_SECURE`, `SECURE_HSTS_SECONDS` ativos fora de `localhost`, via variável de ambiente.
- `SESSION_COOKIE_HTTPONLY = True` e `SESSION_COOKIE_SAMESITE = "Lax"`.
- ⚠️ **Atrás de proxy reverso** (Render, Railway, Fly — todos terminam o TLS no proxy e repassam HTTP para a aplicação):
  ```python
  SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
  ```
  Sem essa linha, o Django vê "HTTP", `SECURE_SSL_REDIRECT` redireciona para HTTPS, o proxy repassa HTTP de novo — **loop infinito de redirecionamento**, e o site inteiro fica inacessível.
- **Critério de aceite**: `python manage.py check --deploy` não reporta avisos e o site em produção carrega sem loop de redirecionamento.

> ✅ Faltavam o HSTS e a conferência. Acrescentados `SECURE_HSTS_SECONDS` (um ano, configurável), `SECURE_HSTS_INCLUDE_SUBDOMAINS` e `SECURE_HSTS_PRELOAD`, todos dentro do `if not DEBUG`. O `SECURE_PROXY_SSL_HEADER` já estava lá desde o Épico 1 — é a linha que evita o loop de redirecionamento.
>
> **`manage.py check --deploy` com `DJANGO_DEBUG=0`**: só sobra o aviso `security.W009`, do `SECRET_KEY` de exemplo do `.env` local. Em produção, com uma chave gerada de verdade, a saída fica limpa. Para gerar: `python -c "import secrets; print(secrets.token_urlsafe(64))"`.

### 13.5 Limites de tamanho ✅
- Limite client-side no compositor (ex.: 100.000 caracteres) e no tradutor (ex.: 1 MB de arquivo).
- `DATA_UPLOAD_MAX_MEMORY_SIZE` ajustado no Django para o endpoint de histórico.
- **Critério de aceite**: arquivos acima do limite são rejeitados com mensagem clara antes de qualquer processamento.

> ✅ Três limites, e o cliente recusa **antes** de processar:
> - **Compositor:** 100.000 caracteres. Passou disso, o contador muda de cor e o botão desliga.
> - **Tradutor:** 1 MB, conferido no `file.size` antes de ler o arquivo, e de novo no tamanho do bloco colado depois do `fromArmor`.
> - **Servidor:** `MAX_SIZE` de 1 MB no `message_format` (já existia) e `DATA_UPLOAD_MAX_MEMORY_SIZE` de 3 MB, que é o base64 de 1 MB com folga.
>
> O limite de 1 MB agora está travado nos dois lados por teste, como o magic do D5: se um lado mudar, o outro acusa.

### 13.6 Revisão de logs ✅
- Configurar `LOGGING` garantindo que nenhum dado sensível seja registrado, inclusive em stack traces.
- **Critério de aceite**: forçar erro em cada endpoint e conferir que nenhum log contém blob, chave ou senha.

> ✅ `LOGGING` explícito no `settings.py`, com um handler de console e três decisões:
> - **`django.db.backends` em `WARNING`** — é o logger que, em `DEBUG`, imprime o SQL com os parâmetros. Seria por ali que um blob cifrado apareceria no log.
> - **`django.request` em `ERROR`** — 404 e 400 não viram ruído, e o corpo da requisição nunca é logado.
> - **Nível da raiz por variável de ambiente** (`LOG_LEVEL`), para subir o detalhe em depuração sem editar código.
>
> Junto com o `@sensitive_variables` do 13.1, é o que impede blob e senha de saírem num rastreamento de erro.

### 13.7 `DEBUG` e `ALLOWED_HOSTS` ✅
- Controlados por variável de ambiente; `DEBUG = False` por padrão (falhar seguro).
- **Critério de aceite**: rodar sem `.env` sobe em modo produção, não em modo debug.

> ✅ Já estava assim desde o Épico 1 e foi reconferido: `DEBUG = config("DJANGO_DEBUG", default=False, cast=bool)` — sem `.env`, o app sobe em modo produção. `ALLOWED_HOSTS` também vem do ambiente, e os domínios de túnel só entram na lista quando `DEBUG` está ligado.

---

## Épico 14 — Testes e Qualidade 🟡

> 🟡 **14.1 a 14.5, 14.7 e 14.9 concluídos em 17/09/2026.** O 14.6 e o 14.8 têm o roteiro escrito em [`roteiro-de-testes.md`](roteiro-de-testes.md), mas a execução é manual e cabe à equipe — e a camada 3 do 14.8 depende do 11.7.

### 14.1 Testes JS — Huffman ✅
- Ver 3.5.

### 14.2 Testes JS — cifragem ✅
- Ver 4.8.

### 14.3 Testes JS — formato e armor ✅
- Round-trip de `empacotar`/`desempacotar` (5.1).
- Cada caso de validação estrita do 5.2.
- Round-trip do armor, incluindo texto com lixo em volta (5.5).
- **Critério de aceite**: cobertura de todos os caminhos de erro do 5.2.

### 14.4 Teste de interoperabilidade entre os dois lados ✅
- Teste que instancia **dois pares de chaves diferentes**, deriva a chave AES dos dois lados, cifra com um e decifra com o outro.
- É o teste que pega erros de `salt`/`info` (D4) — o tipo de bug que passa despercebido quando só se testa um lado.
- **Critério de aceite**: A cifra → B decifra, e B cifra → A decifra, ambos com o texto exato.

> ✅ Coberto em dois níveis: `crypto.test.js` tem "Alice cifra e Bob decifra" e o caminho inverso, com dois pares de chaves de verdade; `pipeline.test.js` faz o mesmo pelo pipeline inteiro em "funciona nos dois sentidos". Desde o 14.9, os vetores fixos fazem o teste na direção A → B partindo de arquivos gravados no repositório.

### 14.5 Testes Django ✅
- Login/logout (Épico 2).
- Cada endpoint (Épicos 4.3 e 6): sucesso, não autenticado, acesso negado, entrada malformada.
- Write-once da chave pública (409 no segundo POST).
- Deduplicação (6.5).
- **Critério de aceite**: `python manage.py test` passa 100%.

> ✅ **150 testes**, com `manage.py test` passando por inteiro. Cobrem login e logout, cada endpoint nos quatro estados (sucesso, sem login, sem permissão e entrada malformada), o write-once da chave pública, a deduplicação do 6.5, a migration 0003 com dados reais, a CSP e o limite de login.

### 14.6 Teste end-to-end manual 🟡
- Roteiro escrito: A gera chave → publica → verifica fingerprint → compõe → baixa → B importa → decifra → confere histórico dos dois lados.
- Executar em **duas máquinas/navegadores diferentes**, não em duas abas.
- **Critério de aceite**: o roteiro completo passa sem intervenção manual em nenhuma etapa criptográfica.

> 🟡 **Roteiro escrito** em [`roteiro-de-testes.md`](roteiro-de-testes.md), com 14 passos e o que observar em cada um. **A execução em duas máquinas é de vocês** — daqui não dá para rodar dois navegadores de verdade.
>
> O passo 5 é o único que exige trabalho manual de propósito: comparar os códigos de segurança por um canal fora do app. É a verificação do 11.1, e automatizá-la seria o mesmo que não tê-la.

### 14.7 Teste de adulteração manual ✅
- Abrir um `.treehash` em editor hex e alterar: 1 byte do ciphertext; 1 byte do `created_at` (testa o AAD); o `sender_id`.
- **Critério de aceite**: os três casos são rejeitados; o sistema nunca exibe texto incorreto.

> ✅ **Automatizado** em `tests/vectors.test.js`, sobre os vetores fixos: um byte trocado no ciphertext, um no `created_at` e o `sender_id` invertido. Os três são recusados com "arquivo adulterado", e um quarto teste confirma que nenhum deles devolve texto parcial.
>
> O `sender_id` é o caso que prova o AAD: o arquivo continua estruturalmente válido — o `unpack` lê `1` sem reclamar —, e quem recusa é a tag do AES-GCM. O roteiro manual está no [`roteiro-de-testes.md`](roteiro-de-testes.md) para conferir a mensagem na tela.

### 14.8 Teste de perda de chave — as três camadas 🟡
Limpar o IndexedDB e validar cada camada de **D11** isoladamente:
- **Camada 1** — restaurar via backup no servidor (11.6), apenas com login e senha de backup.
- **Camada 2** — restaurar via arquivo `.treehashkey` (11.4), com o endpoint de backup indisponível.
- **Camada 3** — recuperação assistida (11.7): apagar a chave de A **e** o backup no servidor, e recuperar o histórico pelo navegador de B.
- Confirmar também que, sem nenhuma chave, o histórico lista as mensagens com o aviso do 10.5 em vez de quebrar.
- **Critério de aceite**: as três camadas recuperam o acesso seguindo apenas a documentação, cada uma testada com as demais desabilitadas.

> 🟡 **Roteiro escrito** para as camadas 1 e 2 e para o caso sem chave nenhuma (10.5), em [`roteiro-de-testes.md`](roteiro-de-testes.md). A camada 3 espera o 11.7.
>
> O que já está automatizado é o miolo criptográfico: `key-backup.test.js` prova que o par restaurado do backup deriva a mesma chave AES do original e decifra o que o par antigo cifrou. O que o roteiro cobre é o resto — apagar o IndexedDB, a tela reagir, a senha errada falhar direito.

### 14.9 Vetores de teste fixos (compartilhados pela equipe) ✅
> Cada dev tem o próprio banco e, portanto, chaves diferentes — um `.treehash` gerado numa máquina **não abre** em outra. Sem uma base comum, o time não tem como testar compatibilidade de formato.

- Commitar em `tests/vectors/`: um par de chaves ECDH de teste conhecido (em JWK, claramente marcado como **somente para teste**), e alguns arquivos `.treehash` de referência com o texto esperado de cada um.
- Cobrir: texto curto (com fallback de compressão acionado), parágrafo em PT-BR, texto com emoji, e um arquivo deliberadamente adulterado.
- Os testes do 14.3 e 14.4 rodam contra esses vetores.
- **Critério de aceite**: os vetores decifram para o texto esperado em qualquer máquina da equipe; uma mudança acidental no formato ou na tabela de frequência quebra o teste imediatamente.

> ✅ **`tests/vectors/` versionado**, com o par de chaves de teste (marcado no próprio arquivo como público e só para teste), três arquivos de referência e um adulterado:
>
> | Arquivo | Conteúdo | Cobre |
> |---|---|---|
> | `short.treehash` | "Chego às 19h." | O fallback do 3.3: 57 bytes, sem compressão |
> | `paragraph.treehash` | Parágrafo em PT-BR | Compressão de verdade, 133 bytes |
> | `emoji.treehash` | Texto com emoji | UTF-8 de 4 bytes passando pela árvore |
> | `tampered.treehash` | Cópia do parágrafo com um byte trocado | A recusa pela tag |
>
> - **11 testes** em `tests/vectors.test.js`. Eles travam de uma vez o formato binário (D5), a tabela de frequência do Huffman (D1–D3) e os parâmetros de derivação (D4): qualquer um que mude, os vetores param de abrir.
> - O gerador está em `tools/generate-vectors.js`, mas **regenerar é a última coisa a fazer** quando um teste falha — o valor deles está em não mudarem. O aviso está no roteiro.

---

## Épico 15 — Documentação

### 15.1 README principal ✅
- Visão geral do projeto e do pipeline; setup resumido, apontando para o guia completo do 15.6.
- Aviso destacado sobre contexto seguro (D10): acessar por `localhost`/`127.0.0.1` em desenvolvimento, HTTPS em produção — **nunca pelo IP da rede**.
- Diagrama do pipeline completo (envio e recebimento).
- **Critério de aceite**: alguém de fora roda o app do zero seguindo só o README.

> ✅ **O pipeline virou desenho.** O README traz o percurso de ida (texto → Huffman → AES-GCM → arquivo ou bloco armored) e o de volta, mais o diagrama da derivação da chave, que é o ponto onde a pergunta "mas a chave não trafega?" costuma aparecer. O aviso de que faltava a CSP saiu: ficou obsoleto no Épico 13.

### 15.2 `formato.md` ✅
- Ver 5.6 — entregue em [`formato.md`](formato.md).

### 15.3 `SEGURANCA.md` — modelo de ameaça ✅
- O que o sistema protege: leitura por terceiros no canal (WhatsApp, e-mail, pen-drive perdido); adulteração da mensagem; leitura por quem tiver acesso ao banco do servidor.
- O que **não** protege: servidor malicioso que troca chaves públicas (mitigado, não eliminado, pela verificação de fingerprint — 11.1); dispositivo comprometido; ausência de forward secrecy (17.1); metadados (quem falou com quem e quando ficam visíveis no servidor).
- **Limite de recuperação:** documentar explicitamente que, se os **dois** usuários perderem as chaves ao mesmo tempo e não houver backup, o histórico é irrecuperável — nem os administradores conseguem restaurá-lo. Isso é inerente à criptografia fim-a-fim e é a contrapartida de o servidor não conseguir ler nada.
- Ser honesto sobre os limites vale mais do que afirmar segurança absoluta.
- **Critério de aceite**: cada limitação listada tem a mitigação correspondente ou a justificativa de por que foi aceita.

> ✅ **Entregue em [`SEGURANCA.md`](SEGURANCA.md).** Cada limitação da lista aparece com a mitigação ao lado ou com a justificativa de por que foi aceita — servidor malicioso na primeira troca (mitigado pela comparação dos códigos, não eliminado), dispositivo comprometido, ausência de forward secrecy, metadados, o canal de verificação e a senha fraca de backup.
>
> O limite de recuperação está escrito sem rodeio, inclusive no resumo do topo: perdidas as duas chaves e sem backup, o histórico não volta — nem para os administradores.

### 15.4 Guia de primeiro uso para os dois usuários ✅
- Passo a passo do onboarding (11.5), incluindo como comparar os fingerprints.
- **Critério de aceite**: os dois usuários reais seguem o guia sem ajuda extra.

> ✅ **Entregue em [`primeiro-uso.md`](primeiro-uso.md).** Cinco passos, sem jargão: entrar, criar a senha de backup, guardar o `.treehashkey`, comparar os códigos por telefone e enviar a primeira mensagem. A comparação tem o roteiro literal do que cada um lê em voz alta, e o que fazer se os códigos não baterem. No fim, um "o que fazer quando..." com os quatro problemas que aparecem na prática.

### 15.5 Relatório técnico (entrega acadêmica) 🟡
- Explicar por que Huffman é **compressão, não criptografia** — a segurança vem inteiramente do AES-GCM. Este é o ponto mais comumente confundido em projetos deste tipo.
- Justificar cada decisão de D1 a D12.
- Incluir a comparação de compressão do 17.2.
- **Critério de aceite**: o relatório responde "por que assim e não de outro jeito" para cada decisão travada.

> 🟡 **Entregue em [`relatorio-tecnico.md`](relatorio-tecnico.md), menos a tabela do 17.2.** O documento abre pelo ponto que mais se confunde — Huffman é transformação fixa e sem chave, a tabela está publicada de propósito, a proteção é toda do AES-GCM — e depois justifica D1 a D13 dizendo, em cada uma, qual era a alternativa e por que ela foi descartada. Traz também os números medidos (4,6306 bits por byte, 0,80% acima da entropia, equilíbrio em 96 caracteres) e uma lista do que ficou de fora.
>
> **Falta a comparação com gzip (17.2)**, adiada por decisão da equipe. É o contraponto honesto ao Huffman e cabe na apresentação; enquanto não existir, o relatório registra a ausência em vez de omiti-la.

### 15.6 Guia de setup e convenções da equipe ✅
> O passo a passo de infraestrutura já está em [`infraestrutura.md`](infraestrutura.md) (✅ entregue). Este item cobre o que é específico do domínio do projeto e não cabe lá.

- Apontar para o `infraestrutura.md` como ponto de partida: `cp .env.example .env` → `docker compose build` → bootstrap → `migrate` → `up`.
- **Reforçar a convenção de duas origens do 1.7** (`localhost` = usuário A, `127.0.0.1` = usuário B) — é o que evita que cada dev invente o próprio jeito de testar o fluxo entre os dois usuários.
- Regra da tabela de frequência: `tools/generate-frequency-table.js` roda **uma vez**, o resultado é commitado, e ninguém regenera sem combinar com a equipe. Corpus diferentes produzem tabelas diferentes, e o sintoma é "texto decifrado vira lixo" — que parece bug de criptografia e não é.
- Como usar os vetores de teste do 14.9.
- **Critério de aceite**: um dev novo tem o ambiente rodando e o fluxo dos 2 usuários testado seguindo apenas este guia.

> ✅ **Entregue em [`guia-da-equipe.md`](guia-da-equipe.md).** Começa apontando para o [`infraestrutura.md`](infraestrutura.md) e cobre o que é do domínio do projeto: a convenção das duas origens (com o 409 explicado, que é o sintoma de entrar pela origem errada), a regra de que a tabela de frequência roda uma vez só, o uso dos vetores do 14.9 — com o aviso de não regenerá-los para calar um teste — e o que rodar antes de abrir PR.

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

### Revisão 17 — Épico 15 (documentação)

| Mudança | Motivo |
|---|---|
| **[`SEGURANCA.md`](SEGURANCA.md)** | O modelo de ameaça não existia como documento: cada limite estava espalhado pelas notas dos épicos |
| **[`relatorio-tecnico.md`](relatorio-tecnico.md)** | A entrega acadêmica precisa responder "por que assim e não de outro jeito" para D1–D13, e separar compressão de criptografia |
| **[`primeiro-uso.md`](primeiro-uso.md)** | Os dois usuários finais não têm por onde começar; a comparação dos códigos depende deles e não estava explicada em lugar nenhum |
| **[`guia-da-equipe.md`](guia-da-equipe.md)** | A convenção das duas origens, a regra da tabela de frequência e o uso dos vetores só existiam na cabeça de quem implementou |
| **Diagrama do pipeline no README** | O 15.1 pedia envio e recebimento desenhados; o README descrevia o fluxo só em prosa |
| **Aviso da CSP removido do README** | Ficou obsoleto quando o Épico 13 entregou a CSP |

### Revisão 16 — correções de revisão de código

| Mudança | Motivo |
|---|---|
| **Contador de login atômico** | `get` seguido de `set` deixava tentativas simultâneas se sobrescreverem e passarem do limite |
| **Restrição `message_unique_copy` (migration 0006)** | A checagem de duplicata e a gravação não eram atômicas: dois POSTs iguais ao mesmo tempo criavam duas linhas |
| **Envelope do backup validado no servidor (`key_backup_format.py`)** | A trava do 11.5 aceitava qualquer linha; bytes aleatórios pela API liberavam o compositor |
| **Backup: a tela não mente mais sobre substituir** | O 6.8 é versionado de propósito; quem falava em substituir era só o texto |
| **Falha ao atualizar a tela ≠ falha ao guardar** | Depois de o servidor aceitar o backup, um erro na consulta seguinte fazia o usuário repetir a operação |
| **Histórico ignora resposta atrasada** | Trocar de página rápido deixava a resposta antiga sobrescrever a nova |

### Revisão 15 — Épico 14 (testes e qualidade)

| Mudança | Motivo |
|---|---|
| **Vetores fixos versionados (14.9)** | Cada dev tem chaves diferentes; sem uma base comum ninguém testa compatibilidade de formato |
| **Adulteração automatizada (14.7)** | Os três casos do item viraram teste; o `sender_id` é o que prova o AAD |
| **`roteiro-de-testes.md`** | O que sobra é manual por natureza: duas máquinas, editor hexadecimal e apagar o IndexedDB |
| **14.6 e 14.8 ficam 🟡** | O roteiro existe, a execução é da equipe — e a camada 3 do 14.8 espera o 11.7 |

### Revisão 14 — Épico 13 (segurança e hardening)

| Mudança | Motivo |
|---|---|
| **CSP por middleware próprio (13.3)** | Protege a chave privada no IndexedDB contra XSS, que é o vetor mais realista aqui |
| **Política separada para o `/admin/`** | O Admin do Django usa script e estilo embutidos; a política estrita quebraria a tela que libera chave |
| **Limite de login sem dependência nova (13.2)** | 30 linhas sobre o cache do Django resolvem o caso; a ressalva de vários workers ficou escrita |
| **`LOGGING` explícito (13.6)** | `django.db.backends` em `DEBUG` imprime SQL com parâmetros — é por ali que um blob vazaria |
| **Limites de tamanho nos dois lados (13.5)** | O cliente recusa antes de processar, e o limite de 1 MB está travado por teste nas duas linguagens |
| **11.7: decidido não reescrever blobs** | Reescrever contraria o que o projeto promete sobre o servidor guardar o que o cliente gerou |

### Revisão 13 — Épico 12 (interface e UX)

| Mudança | Motivo |
|---|---|
| **Indicador de estado no topo (12.4)** | Cinco sinais num olhar: sem isso o usuário não sabe se o canal está pronto nem se a chave está protegida |
| **Estados de tela reutilizáveis (12.3)** | Faltava "carregando" e "vazio"; cifrar o backup demora e sem aviso parece travado |
| **Lógica do badge fora do DOM** | `buildSignals` é função pura, então tem teste; o desenho fica numa função fina |
| **Terceiro ponto de quebra, em 400px** | O fingerprint de 48 dígitos e o topo com cinco itens não cabiam em tela estreita |

### Revisão 12 — Épico 11 (identidade e backup de chave)

| Mudança | Motivo |
|---|---|
| **11.1 a 11.6 concluídos** | Eram os dois furos mais sérios: distribuição de chave sem verificação e chave privada sem cópia |
| **Fingerprint calculado nos dois lados, com o mesmo teste** | O servidor nunca envia o código pronto — se enviasse, poderia mandar o código "certo" junto com a chave falsa |
| **6.8 junto do 11.3** | As duas camadas de backup do D11 saem do mesmo blob, no mesmo clique |
| **Compositor e tradutor exigem backup (11.5)** | Perder o navegador sem backup é perder o histórico, e não há como desfazer |
| **11.7 ficou para depois** | Ele reescreve blobs já gravados, o que contraria a imutabilidade do 6.7; a decisão vem antes do código |

### Revisão 11 — Épico 10 (histórico) e o blob do 6.4

| Mudança | Motivo |
|---|---|
| **Épico 10 concluído** | Tela em `/history/` com filtros, paginação, decifrar e baixar de novo |
| **6.4 antecipado** | O 10.2 e o 10.3 precisam do blob guardado; sem ele a tela só listaria metadados |
| **404 em vez de 403 para a cópia do outro** | O item foi escrito antes do conceito de dono (6.3); responder 404 não confirma que a linha existe |
| **Baixar funciona sem a chave** | O download é só bytes. Só o *Decifrar* depende da chave, e é ele que o 10.5 desliga |

### Revisão 10 — Épico 9 (tradutor) e a deduplicação do 6.5

| Mudança | Motivo |
|---|---|
| **Épico 9 concluído** | O tradutor aceita texto colado, grava no histórico de quem recebe e dá nome a cada falha |
| **6.5 antecipado** | O critério do 9.4 é "importar duas vezes não duplica", e quem garante isso é o 6.5 |
| **`blob_sha256` no `Message` (migration 0004)** | Deduplicar por dono sem varrer e hashear todos os blobs a cada requisição |
| **POST idempotente, além do HEAD** | O HEAD economiza o upload; o critério só fica garantido se o servidor recusar a segunda cópia |

### Revisão 9 — Épico 8 (compartilhamento)

| Mudança | Motivo |
|---|---|
| **Seção de envio no compositor** | Baixar de novo, copiar como texto, abrir no e-mail e compartilhamento nativo, num lugar só |
| **`share.js` separado da tela** | O que dá para testar (mailto, bloco colável, decisão do botão nativo) ficou fora do DOM, com 17 testes |
| **Aviso do 8.5 na tela** | O arquivo pode ir por qualquer canal, mas a confirmação de identidade e senhas não podem ir pelo mesmo |

### Revisão 8 — árvore binária de busca na tela

| Mudança | Motivo |
|---|---|
| **12.5 — `search-tree.js` e painel no compositor** | A organização da árvore precisa aparecer para o usuário. A árvore organiza e exibe; o conteúdo do arquivo não muda por causa dela |
| **Valor do nó = código × quantidade, com desempate pelo código** | Formato pedido pelo cliente. A multiplicação não garante valor único: dois espaços e um `@` valem 64 |
| **Painel de compressão fora da tela (7.5)** | Pedido do cliente: o usuário não precisa ver esses números. O Huffman continua comprimindo o arquivo |
| **Árvore montada passo a passo, com arrastar e zoom** | Mostrar como ela se organiza, e não só o resultado pronto |
| **Percurso em ordem ao lado da árvore** | Cabe melhor na tela; abaixo de 720px volta a empilhar |
| **Ordenar o texto antes de comprimir: descartado** | A ordem dos caracteres é a mensagem, e guardar a permutação para desfazer custa mais que a compressão economiza |

### Revisão 7 — Épico 5 integrado e listagem do histórico corrigida

| Mudança | Motivo |
|---|---|
| **Épico 5 mesclado do `dev`** | Trazia `armor.js`, o aviso de `created_at` suspeito e o `formato.md`, escritos antes da Revisão 6 e do 4.4 |
| **`formato.md` reconstruído** | O arquivo chegou sem nenhum bloco de código; o dump em hex, o bloco armored e o pseudocódigo do D4 eram prometidos no texto e não existiam. O exemplo foi regerado por execução real |
| **6.3 em `api.py`, filtrado por dono** | Em `views.py` faltava a checagem de participante, e o filtro "remetente ou destinatário" mostrava a cópia do outro usuário junto da própria |
| **Migrations 0001/0002 preservadas** | O `anderson-branch` apagou o cabeçalho gerado pelo Django e a quebra de linha final; migration publicada não se reescreve |

### Revisão 6 — nome do app

| Mudança | Motivo |
|---|---|
| **Nome do app: Treehash** (antes `msgenc`) — interface, Admin, extensão `.treehash`, magic `TRHS`, `info` do HKDF, marcador armored, IndexedDB e Postgres; no backup do Épico 11, `.treehashkey` e `TKEY` | Feito antes de existir arquivo em circulação, o único momento em que trocar esses identificadores não quebra nada. Daqui em diante eles não mudam — lista em [`convencoes.md`](convencoes.md#6-o-nome-do-app) |

### Revisão 5 — Épico 2 concluído, Épico 4 fechado e Épico 7

| Mudança | Motivo |
|---|---|
| **Migration `0003_english_identifiers`** | O Épico 2 chegou com models em português, violando D13. Renomeação preservando dados, sem reescrever as migrations já publicadas no `dev` |
| **Seed lê `SEED_USER_*`/`SEED_PASS_*`** | A versão entregue fixava `usuario1`/`usuario2` e ignorava o `.env`; os nomes entram no salt do D4 |
| **Participante = usuário com `Profile`** (2.5) | "Exatamente 2 usuários" colidia com o superusuário exigido pelo 2.6 |
| **Admin com ação de apagar a chave** (2.6) | É a "intervenção via Admin" que o write-once do 4.3 prevê |
| **Endpoints de chave pública** (4.3) | Write-once com `select_for_update`; mesma chave reenviada devolve 200; forma canônica compatível com a RFC 7638 |
| **Sessão entregue por `json_script`** (4.4) | Dado inerte na página, compatível com a CSP do 13.3 |
| **Keystore separado por usuário** (4.4) | Dois usuários no mesmo navegador compartilhavam o par — o segundo publicaria a chave do primeiro |
| **`POST /api/messages/` e `MessageAdmin`** (6.2, 6.7) | Adiantados porque o 7.3 depende deles |
| **`sender_id` real** (7.x) | Era fixo em `0` desde o Épico 0 |
| **`core.test_runner.TestRunner`** | Os testes rodam com `DEBUG=False`, e aí o storage com manifesto exige `collectstatic`; qualquer teste que renderizasse template quebrava |
| **Suíte Django criada** | O projeto não tinha nenhum teste Python; agora são 93, incluindo um teste da migration |

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
| **1.5** — `.gitignore` com exceção para os vetores | `*.treehash` é ignorado, mas `!tests/vectors/*.treehash` precisa ser versionado (14.9) |
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
