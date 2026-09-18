# Relatório técnico — Treehash

Aplicativo de mensagens criptografadas entre dois usuários fixos. A mensagem é comprimida com uma árvore de Huffman e cifrada no navegador; o resultado é um arquivo `.treehash` entregue por pen-drive, WhatsApp ou e-mail. O servidor guarda apenas blobs cifrados e chaves públicas.

Este documento responde, para cada decisão do projeto, **por que assim e não de outro jeito**.

---

## 1. O ponto que mais se confunde: Huffman comprime, não protege

Num trabalho que junta "árvore de Huffman" e "criptografia", a leitura apressada é de que a árvore embaralha o texto e a tabela é o segredo. **Não é.**

A árvore de Huffman é uma transformação **fixa e reversível**, da mesma natureza que UTF-8 ou ZIP. Ela não tem chave. A tabela de frequência está commitada no repositório e é servida ao navegador — qualquer um a lê no DevTools. Se ela fosse a proteção, o esquema cairia no primeiro dia: análise de frequência sobre alguns arquivos reconstrói os códigos.

O que protege é a ordem das operações:

```
texto → Huffman (comprime) → AES-256-GCM (cifra) → arquivo
```

Quem intercepta vê só a saída do AES-GCM. E a ordem não é arbitrária: **cifra boa produz bytes com aparência aleatória, e dado aleatório não comprime**. Comprimir depois de cifrar não economizaria nada.

A confidencialidade vem inteiramente do AES-256-GCM, com chave derivada por ECDH que nunca trafega. Publicar o código, o formato e a tabela não enfraquece o sistema — é o princípio de Kerckhoffs, e está detalhado no [`SEGURANCA.md`](SEGURANCA.md).

---

## 2. As decisões, uma a uma

### D1 — Huffman opera sobre bytes UTF-8, não sobre caracteres

O alfabeto é `0..255` mais um símbolo `EOF`: 257 símbolos.

**A alternativa descartada** era construir a árvore sobre caracteres. Ela obriga a responder "o que fazer com um caractere fora da tabela?" — e qualquer resposta (código de escape, tabela dinâmica, ignorar) acrescenta complexidade e caminhos de erro. Trabalhando sobre bytes, emoji, acentos e qualquer idioma já são sequências de símbolos conhecidos. A compressão em português permanece praticamente a mesma.

### D2 — O fim do fluxo é marcado por um símbolo EOF

Ao empacotar bits em bytes, sobram bits de padding no último byte. Sem marcador, o decodificador lê esse lixo como caracteres extras.

**A alternativa** era guardar a contagem de bits num campo do cabeçalho. Custa bytes e cria uma segunda fonte de verdade que pode divergir do conteúdo. O `EOF` resolve dentro do próprio fluxo.

### D3 — Huffman canônico, com desempate determinístico

Empates de frequência são resolvidos pelo menor índice de símbolo, e os códigos são reatribuídos na forma canônica: ordenados por comprimento, depois por símbolo.

**Por quê:** a árvore precisa ser idêntica nas duas pontas. Sem regra de desempate, duas execuções podem gerar códigos diferentes para a mesma tabela — e o sintoma seria "texto decifrado vira lixo", que parece bug de criptografia e não é. Com o código canônico, só os **comprimentos** importam: os dois lados chegam aos mesmos códigos sem trocar a árvore.

Um detalhe de implementação que virou decisão: a atribuição usa multiplicação (`code *= 2 ** delta`) em vez de deslocamento à esquerda, porque `<<` opera em 32 bits com sinal em JavaScript e corromperia códigos longos.

### D4 — ECDH P-256 → HKDF-SHA256 → AES-256-GCM

```
segredo = ECDH.deriveBits(privadaLocal, publicaDoOutro, 256)
salt    = SHA-256( utf8( usernameMenor + "\x00" + usernameMaior ) )
info    = utf8( "treehash/v1/aes-gcm-256" )
aesKey  = HKDF-SHA256( segredo, salt, info ) → AES-GCM 256 bits
```

**Por que ECDH e não RSA:** P-256 dá segurança equivalente a RSA de 3072 bits com chaves muito menores e operações mais rápidas; RSA sozinho também não cifra textos longos, exigindo esquema híbrido de qualquer forma.

**Por que P-256 e não X25519:** X25519 é uma curva melhor em vários aspectos, mas só chegou à Web Crypto de todos os navegadores principais recentemente. P-256 funciona em qualquer navegador com Web Crypto há anos.

**Por que HKDF e não usar o segredo direto:** o segredo bruto do ECDH não é uniformemente distribuído. O HKDF (RFC 5869) é o padrão para extrair e expandir esse material, e dá dois parâmetros úteis: o `salt`, que amarra a chave a esta dupla de usuários, e o `info`, que a amarra ao propósito e à versão do protocolo.

**Por que AES-GCM e não AES-CBC + HMAC:** GCM é cifragem autenticada numa operação só, com suporte a dados associados (AAD). Combinar CBC com HMAC à mão é onde nascem os erros clássicos, como o padding oracle. ChaCha20-Poly1305 seria igualmente boa, mas não existe na Web Crypto.

**Detalhes que parecem menores e não são:** a ordenação dos usernames usa comparação de unidades de código, não `localeCompare` — ordenação por locale varia entre sistemas e produziria chaves diferentes nas duas pontas. E o separador `NUL` entre os nomes evita que `("ana", "luiza-silva")` e `("ana-luiza", "silva")` colidam no mesmo salt.

### D5 — Formato binário próprio, sem JSON

| Offset | Tamanho | Campo |
|---|---|---|
| 0 | 4 | `magic` = `TRHS` |
| 4 | 1 | `version` |
| 5 | 1 | `flags` (bit 0 = comprimido) |
| 6 | 1 | `sender_id` |
| 7 | 8 | `created_at`, uint64 big-endian |
| 15 | 12 | `iv` |
| 27 | N | `ciphertext`, com a tag GCM no fim |

**A alternativa descartada** era um envelope JSON com o conteúdo em base64. O base64 infla 33%, e somados os nomes dos campos, o arquivo voltaria ao tamanho do texto original — a compressão deixaria de existir na prática.

Os **primeiros 15 bytes são o AAD** da cifragem. Com isso, magic, versão, flags, remetente e data ficam autenticados mesmo sem serem secretos: adulterar qualquer um invalida a mensagem inteira. O campo `flags` também carrega o fallback: quando o Huffman expandiria o texto, o payload vai como UTF-8 puro e o bit 0 fica em zero.

### D6 — Formato "armored" para colar em texto

`mailto:` **não consegue anexar arquivos**, e anexar no WhatsApp pelo celular é desconfortável. Por isso o mesmo conteúdo é oferecido como bloco de texto entre marcadores `-----BEGIN TREEHASH-----`.

A leitura é deliberadamente tolerante: ignora texto antes e depois dos marcadores, porque as pessoas colam o bloco com "oi, segue a mensagem" em volta.

### D7 — Dois timestamps, com papéis diferentes

`created_at` é gerado pelo cliente, vai no cabeçalho e **dentro do AAD** — é o "quando foi escrita", e não pode ser adulterado sem invalidar a mensagem. `received_at` é gravado pelo servidor e não é falsificável pelo cliente. A interface deixa claro qual está exibindo.

Como o relógio do cliente pode estar errado, uma data anterior a 2024 ou mais de 24h no futuro gera **aviso, não bloqueio**: barrar a leitura puniria o usuário por um erro de relógio do outro lado.

### D8 — Views Django puras, sem Django REST Framework

São nove endpoints simples que recebem e devolvem JSON. O DRF traria serializers, viewsets e roteadores para um ganho que aqui é nulo, e mais superfície para manter.

### D9 — Vitest para os testes de navegador

O Node 18+ traz a Web Crypto API nativa, então o código real de criptografia é testado **sem mock**. O Vitest roda ES Modules nativamente; o Jest ainda exige configuração extra para isso. Só o IndexedDB precisa de substituto (`fake-indexeddb`).

### D10 — `crypto.subtle` exige contexto seguro

A Web Crypto API não existe fora de contexto seguro: `crypto.subtle` vem `undefined` e o app quebra inteiro, com um erro que parece bug de criptografia e é de ambiente.

| Endereço | Contexto seguro? |
|---|---|
| `http://localhost:8000` | sim |
| `http://127.0.0.1:8000` | sim |
| `https://qualquer-coisa` | sim |
| `http://192.168.1.15:8000` | **não** |

Tratado em três camadas: convenção de ambiente local, guarda explícita no boot do JavaScript (que bloqueia a página com explicação em vez de estourar no console) e túnel HTTPS quando for preciso testar no celular.

### D11 — Recuperação de chave em três camadas

Com ECDH estático, perder a chave privada torna todo o histórico ilegível — inclusive para o outro usuário, já que tudo foi cifrado sob o mesmo segredo. Um único arquivo de backup seria frágil demais para esse risco, daí as três camadas: blob cifrado no servidor, arquivo `.treehashkey` e, por último, recuperação assistida pelo outro usuário.

Todas usam PBKDF2-HMAC-SHA256 com **600.000 iterações** (recomendação atual da OWASP) e salt aleatório de 16 bytes.

**O limite honesto**, que o [`SEGURANCA.md`](SEGURANCA.md) repete: se os dois perderem as chaves e não houver backup, o histórico é irrecuperável. É a contrapartida de o servidor não conseguir ler nada.

### D12 — Docker como ambiente padrão

Ninguém instala Python, Node ou Postgres. O ganho principal não é reprodutibilidade: é que **o ambiente vira código revisável** — atualizar o Django deixa de ser um aviso no grupo e passa a ser um diff que entra por pull request.

Tags de imagem sempre fixas, dependências com versão fixada, um Dockerfile multi-stage com alvo `dev` e `prod`, e serviços opcionais por profile.

### D13 — Código em inglês, interface em português

Identificadores, arquivos, rotas, campos de model e classes CSS em inglês; tudo que o usuário lê na tela em português, inclusive mensagens de erro lançadas de dentro do código. A documentação é em português, porque o público é a equipe.

A regra prática: *isso aparece na tela para o usuário?* Se sim, português; se não, inglês.

---

## 3. Números medidos

### Compressão

| Métrica | Valor |
|---|---|
| Corpus | 570 KB de domínio público: três obras de Machado de Assis e a Constituição de 1988 |
| Bits por byte | **4,6306** |
| Entropia do corpus | 4,5937 |
| Excesso sobre a entropia | **0,80%** |
| Comprimento mínimo / máximo de código | 3 / 20 bits |
| Igualdade de Kraft | exatamente 1 (código completo) |

| Texto | Original | Comprimido | Taxa |
|---|---|---|---|
| Parágrafo em PT-BR | 313 B | 176 B | **−43,8%** |
| Chat longo | 279 B | 166 B | −40,5% |
| Texto formal | 172 B | 100 B | −41,9% |
| Chat curto | 46 B | 34 B | −26,1% |
| `"oi"` | 2 B | 2 B | 0% (fallback) |

O envelope custa **43 bytes fixos** (27 de cabeçalho + 16 de tag). Isso faz mensagens curtas gerarem arquivos maiores que o texto: o **ponto de equilíbrio medido é 96 caracteres**. Abaixo disso o arquivo sai maior; acima, menor. O custo é fixo e não cresce com a mensagem.

> A escolha do corpus foi corrigida por medição. Só com as obras de Machado, `à` e `â` caíam no piso da tabela e custavam 24 bits cada — como ocupam 2 bytes em UTF-8, a compressão os *expandia*. A causa é a ortografia de época dos textos do Gutenberg, que quase não usa crase. Acrescentar a Constituição levou `à` de 24,3 para 17,3 bits e melhorou a estimativa de −31,4% para −33,0% em frase típica de chat.

### Criptografia

| O quê | Valor |
|---|---|
| Exemplo real documentado | 65 bytes: 27 de cabeçalho, 22 de conteúdo comprimido, 16 de tag |
| PBKDF2 com 600.000 iterações | ~270 ms |
| Testes automatizados | 158 no servidor, 378 no navegador |

---

## 4. O que ficou de fora, e por quê

| Item | Situação |
|---|---|
| **Forward secrecy** (17.1) | Fora do escopo. Exigiria chave efêmera por mensagem e um protocolo de sessão bem mais complexo. O risco está documentado |
| **Recuperação assistida** (11.7) | Decidido que não vai reescrever blobs já gravados; a implementação ficou para depois |
| **Comparação com gzip** (17.2) | Não medida. Seria o contraponto honesto ao Huffman: um algoritmo com dicionário provavelmente comprime mais texto em português |
| **Wordlist de palavras** para o código de segurança | Só a forma hexadecimal foi implementada; palavras seriam mais fáceis de ditar por telefone |

---

## 5. Conclusão

O sistema entrega o que se propõe: o conteúdo das mensagens é protegido de ponta a ponta, com parâmetros atuais, e isso é verificável por teste automatizado — inclusive por vetores fixos que quebram se o formato, a tabela do Huffman ou os parâmetros de derivação mudarem.

A parte que nenhum código resolve é a verificação de identidade: ela depende de os dois usuários compararem os códigos de segurança por um canal fora do app, uma vez. É a única defesa contra um servidor que distribua chaves falsas, e está documentada como tal em vez de escondida atrás de um indicador verde.
