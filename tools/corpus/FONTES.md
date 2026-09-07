# Corpus de referência

Textos usados por `tools/generate-frequency-table.js` para levantar a frequência de bytes do português (item 3.1 do backlog).

**Todos são de domínio público.** O corpus é versionado para que a tabela seja reproduzível: rodar o gerador sobre estes arquivos produz sempre o mesmo `frequency-table.js`.

## Arquivos

| Arquivo | Origem | Situação legal |
|---|---|---|
| `dom-casmurro.txt` | Machado de Assis, *Dom Casmurro* — [Project Gutenberg #55752](https://www.gutenberg.org/ebooks/55752) | Domínio público (autor falecido em 1908) |
| `memorias-postumas.txt` | Machado de Assis, *Memórias Póstumas de Brás Cubas* — [Project Gutenberg #54829](https://www.gutenberg.org/ebooks/54829) | Domínio público |
| `quincas-borba.txt` | Machado de Assis, *Quincas Borba* — [Project Gutenberg #55682](https://www.gutenberg.org/ebooks/55682) | Domínio público |
| `constituicao-1988.txt` | Constituição da República Federativa do Brasil — [planalto.gov.br](https://www.planalto.gov.br/ccivil_03/constituicao/constituicao.htm) | Domínio público — Lei 9.610/98, art. 8º, IV (textos oficiais não são protegidos) |

Todos os arquivos estão em **UTF-8**, com o boilerplate de licença do Project Gutenberg removido (é texto em inglês e distorceria as frequências).

## Por que dois registros diferentes

A primeira versão da tabela usou só as três obras de Machado, e a medição revelou um problema: os textos do Gutenberg estão na **ortografia da época** ("vae", "titulo", "aquella"), que praticamente não usa crase.

O resultado é que `à` e `â` ficavam com frequência 1 — o piso da tabela — e custavam **24 bits cada**. Como esses caracteres ocupam 2 bytes em UTF-8, a compressão os *expandia* de 16 para 24 bits. E `à` é comuníssimo em português moderno ("às 19h", "à reunião").

O texto da Constituição foi acrescentado por ser moderno, extenso e inequivocamente de domínio público. Efeito medido:

| Caractere | Só Machado | Com a Constituição |
|---|---|---|
| `à` | 24,3 bits | 17,3 bits |
| `â` | 24,3 bits | 17,7 bits |
| `í` | 19,2 bits | 15,1 bits |
| `ê` | 17,2 bits | 16,1 bits |

E na estimativa de compressão para uma frase típica de chat: de **−31,4%** para **−33,0%**.

## Limitação conhecida

Nenhum dos dois registros é linguagem de mensagem instantânea, que é o uso real do app: frases curtas, informais, com abreviações e emoji. Um corpus de chat em português seria melhor, mas não há um de domínio público com tamanho suficiente.

Na prática o impacto é pequeno: os símbolos que dominam a compressão (espaço, `a`, `e`, `o`, `s`, `r`, `i`) têm distribuição estável em qualquer texto em português. O que o corpus define bem é justamente a **cauda** — acentuação e pontuação — e é aí que a mistura dos dois registros ajuda.

## Como regenerar

```bash
docker compose run --rm --entrypoint node js tools/generate-frequency-table.js
```

⚠️ **Rode apenas se o corpus mudar, e combine com a equipe antes.** Corpus diferentes produzem tabelas diferentes, e uma tabela diferente torna os arquivos `.msgenc` já gerados ilegíveis. O sintoma é "texto decifrado vira lixo" — que parece bug de criptografia e não é.
