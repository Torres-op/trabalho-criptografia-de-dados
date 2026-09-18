# Guia da equipe

O que um dev novo precisa saber além do passo a passo de ambiente. O ambiente em si está em [`infraestrutura.md`](infraestrutura.md) — comece por lá e volte para cá.

---

## 1. Subir o ambiente

```bash
git clone <url-do-repo>
cd projeto_criptografia
cp .env.example .env
docker compose build
docker compose run --rm web python manage.py migrate
docker compose run --rm web python manage.py seed_users
docker compose up
```

Nada é instalado na máquina: nem Python, nem Node, nem Postgres. Todo comando roda no container:

```bash
docker compose run --rm web python manage.py <comando>
docker compose run --rm js npm test
```

Se a porta 8000 estiver ocupada, mude `WEB_PORT` no **seu** `.env`. Não edite o `docker-compose.yml` — ele é de todo mundo.

Detalhes, variáveis e troubleshooting: [`infraestrutura.md`](infraestrutura.md).

## 2. A convenção das duas origens

O app é uma conversa entre dois usuários, e quase todo bug interessante só aparece com os dois lados abertos. Para testar sem duas máquinas, use **duas origens** na mesma:

| Usuário | Origem |
|---|---|
| `SEED_USER_A` | `http://localhost:8000` |
| `SEED_USER_B` | `http://127.0.0.1:8000` |

O navegador trata as duas como dispositivos diferentes: cookies e IndexedDB separados. Um usuário em cada aba, e a troca de chaves acontece sozinha assim que os dois abrirem o app uma vez.

**Sempre a mesma origem para o mesmo usuário.** Cada origem tem o próprio IndexedDB; entrar pela origem errada gera um par de chaves novo, e o servidor recusa com 409 — a chave pública é gravada uma vez só, por decisão de projeto. O sintoma é "não consigo mais publicar minha chave", e a correção é voltar para a origem certa, não apagar dados.

Essa convenção existe para todo mundo testar do mesmo jeito. Sem ela, cada dev inventa a própria combinação e os relatos de bug deixam de ser comparáveis.

> **Nunca acesse pelo IP da rede** (`http://192.168.x.x:8000`). Fora de contexto seguro, `crypto.subtle` não existe e o app quebra inteiro — com um erro que parece bug de criptografia e é de ambiente (D10). Para testar no celular, use o túnel HTTPS: `docker compose --profile tunnel up tunnel`.

## 3. A tabela de frequência roda uma vez

`tools/generate-frequency-table.js` já foi executado e o resultado está commitado em `messenger/static/messenger/js/frequency-table.js`.

**Ninguém regenera sem combinar com a equipe.** Corpus diferentes produzem tabelas diferentes, tabelas diferentes produzem códigos de Huffman diferentes, e o sintoma é **"texto decifrado vira lixo"** — que parece bug de criptografia e não é. Mensagens já cifradas com a tabela antiga deixam de abrir.

Se houver motivo real para mudar o corpus, é uma decisão da equipe, com os vetores de teste regenerados no mesmo commit e o aviso de que o histórico anterior fica ilegível.

## 4. Os vetores de teste

`tests/vectors/` guarda chaves fixas e arquivos `.treehash` de referência, versionados de propósito. `tests/vectors.test.js` decifra cada um e compara com o texto esperado, além de conferir que o arquivo adulterado falha.

```bash
docker compose run --rm js npm test
```

As chaves ali são públicas e existem só para teste — **nunca use nada de `tests/vectors/` em mensagem real**. O `manifest.json` traz esse aviso no primeiro campo.

**Não regenere os vetores para consertar um teste que falhou.** Eles existem justamente para quebrar quando o formato binário, a tabela do Huffman ou os parâmetros de derivação mudam. Um vetor quebrado é uma pergunta sobre o que mudou no código, não sobre os vetores.

Regenerar é um ato deliberado, que acompanha uma mudança de versão do formato:

```bash
docker compose run --rm js node tools/generate-vectors.js
```

## 5. Antes de abrir um PR

```bash
docker compose run --rm web python manage.py test
docker compose run --rm js npm test
```

As duas suítes precisam passar. Algumas propriedades estão travadas nas duas linguagens de propósito (o magic `TRHS`, o `TKEY`, o valor do fingerprint, o limite de 1 MB): se você mudar de um lado e não do outro, um dos dois lados falha — é o objetivo.

Leia também as decisões **D1–D13** no início de [`backlog-detalhado.md`](backlog-detalhado.md). Elas fixam o formato binário, os parâmetros criptográficos e o alfabeto do Huffman, coisas que precisam ser idênticas nos dois lados da comunicação. Divergir delas faz o app falhar silenciosamente.

## 6. Convenções que aparecem na revisão

- **Código em inglês, interface em português.** Identificadores, arquivos, rotas, campos de model e classes CSS em inglês; tudo que o usuário lê na tela em português — inclusive mensagens de erro lançadas de dentro do código.
- **Commits em português**, no imperativo: `adiciona`, `corrige`, `remove`.
- **Código sem comentários.** A explicação vai para `docs/`.
- Tudo roda em container.

O texto completo está em [`convencoes.md`](convencoes.md).

## 7. Onde procurar

| Pergunta | Documento |
|---|---|
| Como subo e opero o ambiente? | [`infraestrutura.md`](infraestrutura.md) |
| O que é cada épico e o que já está pronto? | [`backlog-detalhado.md`](backlog-detalhado.md) |
| Como escrevo o código deste projeto? | [`convencoes.md`](convencoes.md) |
| O que tem dentro de um `.treehash`? | [`formato.md`](formato.md) |
| O que o sistema protege e o que não protege? | [`SEGURANCA.md`](SEGURANCA.md) |
| Por que as decisões foram essas? | [`relatorio-tecnico.md`](relatorio-tecnico.md) |
| O que precisa ser testado à mão? | [`roteiro-de-testes.md`](roteiro-de-testes.md) |
| O que digo para os dois usuários finais? | [`primeiro-uso.md`](primeiro-uso.md) |
