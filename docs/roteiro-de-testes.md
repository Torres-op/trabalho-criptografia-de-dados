# Roteiro de testes manuais

O que as suítes automatizadas **não** cobrem: duas máquinas de verdade, dois navegadores, e as telas sendo usadas por uma pessoa. Este documento é o roteiro para essas partes.

Antes de qualquer coisa, as suítes precisam estar verdes:

```bash
docker compose run --rm web python manage.py test
docker compose run --rm js npm test
```

---

## 1. Ponta a ponta em duas máquinas (14.6)

> Duas **máquinas ou navegadores diferentes** — não duas abas. Numa máquina só, use `localhost` para um usuário e `127.0.0.1` para o outro: são origens distintas, com IndexedDB separado.

**Preparação**

1. `docker compose up` e, se for a primeira vez, `migrate` e `seed_users`.
2. Máquina A abre `http://localhost:8000`; máquina B abre o mesmo endereço (ou `127.0.0.1`).

**Passos**

| # | Onde | Ação | O que observar |
|---|---|---|---|
| 1 | A | Entrar como o primeiro usuário | Cai direto em **Identidade**, porque ainda não há backup |
| 2 | A | Definir a senha de backup e clicar em *Guardar backup* | Um `.treehashkey` é baixado e o aviso some. O indicador do topo sobe |
| 3 | B | Entrar como o segundo usuário e repetir o passo 2 | Idem |
| 4 | A | Recarregar a tela de Identidade | Agora aparecem **os dois códigos de segurança** |
| 5 | A e B | Comparar os dois códigos **por telefone, vídeo ou pessoalmente** | Os quatro valores batem dois a dois: o "meu" de A é o "do outro" em B |
| 6 | A e B | Clicar em *Já conferi pessoalmente* | O indicador do topo fica verde nos dois |
| 7 | A | Compor uma mensagem e gerar | O arquivo baixa, a árvore aparece e o status diz que foi salva no histórico |
| 8 | A | Enviar o arquivo para B pelo canal que quiser | — |
| 9 | B | Abrir o Tradutor e soltar o arquivo | O texto sai **idêntico** ao digitado, com autor e data |
| 10 | A | Compor outra e usar *Copiar como texto* | O bloco vai para a área de transferência |
| 11 | B | Colar o bloco no Tradutor e ler | Mesmo resultado do passo 9 |
| 12 | A e B | Abrir o Histórico | A envia aparece só em A; a recebida, só em B |
| 13 | B | Clicar em *Decifrar* numa mensagem antiga | O texto aparece sem precisar do arquivo |
| 14 | B | Clicar em *Baixar* | O arquivo baixado é igual ao que A enviou |

**Critério**: nenhum passo exige copiar chave, senha ou código na mão além do passo 5, que é a verificação de identidade e existe justamente para ser manual.

---

## 2. Adulteração de arquivo (14.7)

Os três casos estão automatizados em `tests/vectors.test.js`, rodando sobre os vetores fixos. O roteiro manual abaixo serve para conferir **na tela** o que o usuário vê.

1. Gere uma mensagem e abra o `.treehash` num editor hexadecimal.
2. Faça **uma** alteração por vez, salvando uma cópia de cada:
   - **Último byte do arquivo** — mexe no conteúdo cifrado.
   - **Byte no offset 8** — mexe no `created_at`, que está dentro do AAD.
   - **Byte no offset 6** — troca o `sender_id` de `0` para `1`.
3. Abra cada cópia no Tradutor.

**Critério**: os três são recusados com *"Arquivo adulterado ou chave incorreta"*. Em nenhum caso aparece texto, nem parcial nem errado.

---

## 3. Perda de chave — as três camadas (14.8)

> Cada camada é testada com as outras desabilitadas. Para apagar a chave local: DevTools → Application → IndexedDB → apagar o banco `treehash`.

### Camada 1 — backup no servidor (11.6)

1. Apague o IndexedDB e recarregue.
2. O app manda para Identidade e avisa que a chave deste navegador não é a registrada.
3. Em *Restaurar a chave*, use o bloco do servidor com a senha de backup.
4. A página recarrega sozinha.

**Critério**: o histórico volta a ser legível, sem usar arquivo nenhum. Senha errada mostra a mesma mensagem que arquivo corrompido, e as tentativas acabam depois de cinco.

### Camada 2 — arquivo `.treehashkey` (11.4)

1. Apague o IndexedDB **e** o backup no servidor (Admin → *Backups de chave*).
2. Restaure pelo arquivo baixado no passo 2 do roteiro 1.

**Critério**: o acesso volta usando só o arquivo e a senha.

### Camada 3 — recuperação assistida (11.7)

⏳ **Ainda não implementada.** Quando existir, o roteiro é: apagar a chave de A e o backup no servidor, A gerar uma chave nova (liberando o write-once pelo Admin), B reverificar o fingerprint e disparar a recifragem.

### Sem chave nenhuma (10.5)

1. Com o IndexedDB apagado, abra o **Histórico**.

**Critério**: a lista carrega normalmente, o aviso aparece, *Decifrar* fica desligado e *Baixar* continua funcionando. Nenhum erro no console.

---

## 4. Vetores fixos (14.9)

`tests/vectors/` tem um par de chaves de teste e quatro arquivos de referência, versionados de propósito. Eles rodam em `tests/vectors.test.js`.

**Não regenere os vetores para "consertar" um teste que falhou.** Eles existem justamente para quebrar quando o formato binário, a tabela de frequência do Huffman ou os parâmetros de derivação mudam. Se um teste falhar, a pergunta é o que mudou no código — não nos vetores.

Se a mudança for intencional e combinada com a equipe:

```bash
docker compose run --rm js node tools/generate-vectors.js
```

⚠️ As chaves em `tests/vectors/keys.json` são públicas por definição — estão no repositório. Nunca use nada dali fora dos testes.
