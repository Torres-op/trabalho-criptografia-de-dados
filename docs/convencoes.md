# Convenções de código

Regras que valem para todo código novo do projeto. Referência cruzada: as decisões travadas estão em [`backlog-detalhado.md`](backlog-detalhado.md) como **D1**–**D13**.

---

## 1. Idioma: código em inglês, interface em português

É a regra mais importante do projeto e vale sem exceção (**D13**).

### Em inglês

Tudo que é identificador de código:

| Categoria | Exemplos |
|---|---|
| Apps, módulos e arquivos | `messenger/`, `format.js`, `compose.html` |
| Rotas e nomes de URL | `/translator/`, `{% url 'messenger:compose' %}` |
| Classes, funções e métodos | `FormatError`, `requireSecureContext()`, `composeMessage()` |
| Variáveis, parâmetros e constantes | `createdAt`, `aesKey`, `HEADER_SIZE`, `FAKE_IMPLEMENTATION` |
| Chaves de objeto e campos de model | `{ senderId, compressed }`, `Message.received_at` |
| Endpoints da API | `/api/public-key/`, `/api/messages/` |
| IDs e classes CSS | `#dropzone`, `.status--error`, `--surface` |
| Blocos de template | `{% block content %}` |
| Nomes de branch e mensagens de commit | `feat/huffman-encoder` |

### Em português

Tudo que o usuário final lê na tela:

- Textos de template: títulos, rótulos, botões, placeholders, textos de apoio.
- Mensagens de erro exibidas na interface — **inclusive as que nascem como `throw new FormatError("...")`**, porque acabam na tela do usuário.
- Formatação de números e datas: `toLocaleString("pt-BR")`.
- `LANGUAGE_CODE = "pt-br"`, `lang="pt-BR"`.
- `verbose_name` de models e campos, e `description` de colunas e ações do Admin — é o texto que o Django Admin exibe. O nome do campo continua em inglês: `ecdh_public_key = models.TextField("chave pública ECDH")`.

### Na dúvida

Pergunte: *isso aparece na tela para o usuário?* Se sim, português. Se não, inglês.

Um mesmo arquivo mistura os dois normalmente — uma função `showStatus()` que recebe o título `"Arquivo gerado"` está correta.

---

## 2. Código sem comentários

Os arquivos de código não levam comentários. A explicação de como as coisas funcionam vive em `docs/`:

| Documento | Conteúdo |
|---|---|
| [`backlog-detalhado.md`](backlog-detalhado.md) | O plano e as decisões travadas **D1**–**D13** |
| [`infraestrutura.md`](infraestrutura.md) | Ambiente Docker, comandos, variáveis, troubleshooting |
| `convencoes.md` | Este arquivo |

Quando algo precisar de explicação, escreva no documento correspondente, não no arquivo de código.

**Marcações de código provisório também não são comentários.** Um módulo falso exporta `FAKE_IMPLEMENTATION = true` e a interface exibe o aviso a partir dessa flag. Isso é melhor que um `// FAKE`: o comentário avisa só quem abre o arquivo, a flag avisa quem usa a página.

---

## 3. Documentação em português

Toda a documentação (`docs/`, `README.md`) é escrita em português — o público é a equipe.

Identificadores citados dentro da documentação são referências ao código e permanecem em inglês: "o campo `created_at` do model `Message`".

---

## 4. Ambiente

Tudo roda em container. Não existe virtualenv nem Node local.

```bash
docker compose run --rm web python manage.py <comando>
docker compose run --rm js npm test
```

Portas do host são configuráveis por `.env` (`WEB_PORT`, `DB_PORT`) — **nunca edite o `docker-compose.yml`** para resolver conflito local de porta.

Detalhes em [`infraestrutura.md`](infraestrutura.md).

---

## 5. Antes de escrever código

Leia as decisões travadas (**D1**–**D13**) no início do [`backlog-detalhado.md`](backlog-detalhado.md).

Elas fixam o formato binário, os parâmetros de derivação de chave e o alfabeto do Huffman — coisas que precisam ser **idênticas nos dois lados da comunicação**. Divergir delas não gera erro de compilação: gera arquivo que não decifra, ou que decifra para lixo.

---

## 6. O nome do app

O app se chama **Treehash**. O nome aparece na interface, no Admin, na documentação e também nos identificadores abaixo — que, uma vez em uso, **não mudam mais**:

| Identificador | Onde | O que quebra se mudar |
|---|---|---|
| `"treehash/v1/aes-gcm-256"` | `info` do HKDF (**D4**), em `crypto.js` | Outro `info` deriva outra chave AES: nenhum arquivo já gerado decifra |
| `"TRHS"` | magic do cabeçalho (**D5**), em `format.js` e `message_format.py` | O tradutor passa a recusar os arquivos já gerados |
| `-----BEGIN TREEHASH-----` | marcador do texto armored (**D6**) | O tradutor deixa de reconhecer o texto já colado em conversas |
| `.treehash` | extensão dos arquivos, em `format.js` e no `accept` do tradutor | O seletor do tradutor deixa de mostrar os arquivos antigos |
| `"treehash"` | nome do banco IndexedDB, em `keystore.js` | O navegador deixa de encontrar a chave privada, gera um par novo e o servidor recusa com 409 |
| `treehash` | usuário e banco do Postgres (`.env.example`, `docker-compose.yml`) | O Postgres só cria usuário e banco junto com o volume; cada dev teria que recriar o próprio |

O nome anterior era `msgenc`. A troca foi feita antes de existir arquivo em circulação, o único momento em que ela não quebra nada. Quem já tinha o projeto rodando antes dela deve seguir o item *"Atualizei para o nome Treehash"* do troubleshooting em [`infraestrutura.md`](infraestrutura.md#12-troubleshooting).
