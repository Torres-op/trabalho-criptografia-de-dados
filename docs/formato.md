# Formato de arquivo `.msgenc` (v1)

Referência: decisões **D4**, **D5** e **D6** de [`backlog-detalhado.md`](backlog-detalhado.md).

Este documento é suficiente para reimplementar o parser e o gerador do zero, em qualquer linguagem, sem olhar o código-fonte do projeto.

---

## 1. Visão geral

Um arquivo `.msgenc` é um envelope binário com:

1. Um cabeçalho fixo de **27 bytes**, com campos de controle e o vetor de inicialização (IV).
2. Um `ciphertext` de tamanho variável, produzido por AES-256-GCM, com a **tag de autenticação de 16 bytes já embutida no final**.

Os **primeiros 15 bytes do cabeçalho** (tudo antes do IV) são usados como **AAD** (`additionalData`) na cifragem — isso significa que magic, versão, flags, remetente e data de criação são **autenticados**, mesmo não sendo secretos: qualquer adulteração neles invalida a mensagem inteira.

Não há envelope JSON nem base64 no arquivo binário. Um envelope JSON com base64 (fator ×1,33) mais os nomes de campo devolveria exatamente o que a compressão Huffman economizou.

---

## 2. Layout de campos

| Offset | Tamanho | Campo | Descrição |
|---|---|---|---|
| 0 | 4 | `magic` | Bytes fixos `"MENC"` → `0x4D 0x45 0x4E 0x43` |
| 4 | 1 | `version` | `0x01` nesta versão |
| 5 | 1 | `flags` | bit 0 = payload comprimido (Huffman); bits 1–7 reservados, devem ser `0` |
| 6 | 1 | `sender_id` | `0` ou `1` — índice do remetente na lista de usernames em ordem alfabética |
| 7 | 8 | `created_at` | `uint64` **big-endian**, milissegundos desde a época UTC (1970-01-01) |
| 15 | 12 | `iv` | Vetor de inicialização do AES-GCM, aleatório e único por mensagem |
| 27 | N | `ciphertext` | Conteúdo cifrado; os **últimos 16 bytes** são a tag de autenticação GCM |

**AAD (offsets 0–14, 15 bytes):** `magic || version || flags || sender_id || created_at`. Não inclui o IV.

### Bits do campo `flags`

| Bit | Significado |
|---|---|
| 0 | `1` = payload comprimido com Huffman; `0` = payload é UTF-8 puro |
| 1–7 | Reservados. Devem ser `0`. Um leitor que encontrar bit reservado ligado deve rejeitar o arquivo como corrompido — não ignorar o bit silenciosamente. |

Quando bit 0 é `0`, é porque o `encode` comparou o resultado do Huffman com o UTF-8 original e a compressão teria expandido a mensagem (comum em textos muito curtos).

---

## 3. Validação obrigatória na leitura

Há **duas camadas** de checagem, em módulos diferentes — a distinção importa porque cada uma rejeita um problema diferente:

**Camada 1 — forma do envelope (`unpack`).** Rejeita, nesta ordem, antes de examinar o `ciphertext`:

1. Arquivo menor que 28 bytes (cabeçalho completo de 27 bytes + pelo menos 1 byte de conteúdo).
2. `magic` diferente de `"MENC"`.
3. `version` desconhecida (diferente de `0x01`, nesta especificação).
4. Algum bit reservado de `flags` (bits 1–7) ligado.
5. `sender_id` fora de `{0, 1}`.

Esse é o mínimo para que os campos do cabeçalho possam ser lidos — **não** garante que o arquivo seja decifrável. Um arquivo de 28 a 42 bytes passa por esta camada inteira.

**Camada 2 — autenticidade (`decrypt`).** O `ciphertext` só é entregue à operação de descriptografia depois de confirmar que tem pelo menos `TAG_SIZE` (16) bytes — o tamanho da tag GCM sozinha, sem conteúdo. Um `ciphertext` mais curto que isso é rejeitado antes de chamar `crypto.subtle.decrypt`, com uma mensagem própria ("Arquivo corrompido: conteúdo menor que a assinatura") — a implementação nunca tenta autenticar um ciphertext que estruturalmente não poderia conter a tag.

Um arquivo só é uma mensagem válida quando passa pelas **duas** camadas. Por isso o tamanho mínimo de uma mensagem real é:

mesmo a camada 1 aceitando estruturalmente qualquer coisa a partir de 28 bytes — esses 28–42 bytes nunca chegam a decifrar.

Depois das duas camadas, uma checagem **não bloqueante**: se `created_at` for anterior a `2024-01-01T00:00:00Z` ou mais de 24h no futuro em relação ao relógio local, o app deve **avisar** o usuário, mas continuar a leitura normalmente — um relógio dessincronizado de um dos lados não deve impedir a leitura de uma mensagem legítima.

Uma falha na tag de autenticação (`ciphertext` ou AAD adulterados) é reportada como "arquivo adulterado ou chave incorreta" — nunca como texto parcial ou incorreto.

---

## 4. Derivação da chave (D4)

Os dois lados da conversa precisam chegar à **mesma** chave AES-256-GCM de forma independente:

**Pontos que precisam ser exatos para interoperar:**

- A ordenação dos usernames usa comparação de **unidades de código** (`a < b` em JS, equivalente a comparação byte a byte de strings ASCII), **não** `localeCompare` — a ordenação por locale pode variar entre sistemas e produziria salts diferentes para a mesma dupla de usuários.
- O separador entre os dois usernames no material do salt é o byte `0x00` (NUL) — sem ele, duplas como `("ana", "luiza-silva")` e `("ana-luiza", "silva")` colidiriam no mesmo salt.
- `info` é a string fixa `"msgenc/v1/aes-gcm-256"`, codificada em UTF-8.
- A chave derivada é marcada como **não extraível** — nunca deve ser exportável de volta para bytes.

---

## 5. Formato armored (D6)

Para canais que não aceitam anexo binário confortavelmente (WhatsApp, corpo de e-mail via `mailto:`, que **não consegue anexar arquivos**), o mesmo conteúdo binário do `.msgenc` pode ser representado como texto:

Regras de leitura (`fromArmor`):

- Os marcadores são localizados por busca de substring, então **texto antes e depois do bloco é ignorado** — o WhatsApp e o cliente de e-mail costumam adicionar contexto ao redor do que foi colado.
- Espaços em branco e quebras de linha **dentro** do bloco (entre os marcadores) são ignorados antes da decodificação base64.
- Ausência de qualquer um dos dois marcadores, marcadores fora de ordem, bloco vazio, ou conteúdo que não decodifica como base64 válido são todos rejeitados com mensagem específica — nunca um erro genérico de parsing.
- `toArmor` rejeita `Uint8Array` vazio com o mesmo erro de "bloco vazio" que `fromArmor` usa na leitura — os dois lados compartilham o mesmo contrato, então nenhum valor aceito por um é rejeitado pelo outro.

---

## 6. Exemplo real

Gerado por uma execução real do pipeline (não um exemplo inventado à mão): AES-256-GCM de verdade via Web Crypto API, chave aleatória, IV aleatório.

**Entrada:**
- Texto: `"Reunião confirmada às 15h."`
- `sender_id`: `0`
- `created_at`: `1789569127000` (2026-09-16T14:32:07.000Z)
- `compressed`: `true` (flag ligada — o payload já veio de `huffman.encode`, aqui simulado)

**Arquivo `.msgenc` resultante — 71 bytes, dump em hex:**

**Leitura campo a campo:**

| Campo | Bytes (hex) | Valor |
|---|---|---|
| `magic` | `4d 45 4e 43` | `"MENC"` |
| `version` | `01` | `1` |
| `flags` | `01` | bit 0 ligado → comprimido |
| `sender_id` | `00` | `0` |
| `created_at` | `00 00 01 a0 aa a1 d2 58` | `1789569127000` → `2026-09-16T14:32:07.000Z` |
| `iv` (12 bytes) | `c4 01 67 01 85 25 ad 3e 0a ca 67 23` | — |
| `ciphertext` (44 bytes, últimos 16 = tag) | `dd c4 d6 8f f8 15 a0 74 ...` | 28 bytes de conteúdo cifrado + 16 de tag |

O `ciphertext` decifra de volta para exatamente `"Reunião confirmada às 15h."` com a chave AES original — confirmado por execução real, não apenas por inspeção do layout.

**O mesmo arquivo em formato armored:**

Este bloco, colado com texto ao redor (por exemplo `"Oi! segue a mensagem:\n\n-----BEGIN MENC-----...\n\nMe avisa quando ler 🙏"`), ainda é lido corretamente pelo `fromArmor` — testado na prática, não apenas descrito.

---

## 7. Checklist para uma reimplementação em outra linguagem

- [ ] `created_at` é lido/escrito como inteiro sem sinal de 64 bits **big-endian** — atenção especial em linguagens onde o padrão é little-endian.
- [ ] O AAD passado ao AES-GCM é exatamente `bytes[0:15]` — nunca o cabeçalho inteiro (que inclui o IV) nem só parte dos campos.
- [ ] A tag de 16 bytes do GCM fica **dentro** do `ciphertext`, no final — não é um campo separado no layout.
- [ ] `unpack` aceita a partir de 28 bytes; um leitor completo só considera a mensagem válida depois que `ciphertext.length >= TAG_SIZE` também é checado, antes de decifrar.
- [ ] A ordenação dos usernames para o salt do HKDF é por comparação de code points, não por coleção/locale da linguagem de implementação.
- [ ] O separador entre usernames no material do salt é o byte `0x00`, não uma string vazia nem outro caractere.
- [ ] Um arquivo com bits reservados de `flags` ligados é rejeitado, não tolerado.
- [ ] `toArmor` e `fromArmor` compartilham o mesmo contrato para entrada vazia: ambos tratam como erro.