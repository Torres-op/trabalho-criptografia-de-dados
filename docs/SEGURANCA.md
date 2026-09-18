# Segurança — modelo de ameaça do Treehash

O que este sistema protege, o que ele **não** protege, e por quê. Onde há limitação, ela está escrita com a mitigação correspondente ou com a justificativa de ter sido aceita — afirmar segurança absoluta seria mais confortável e menos verdadeiro.

Referências cruzadas: as decisões travadas estão em [`backlog-detalhado.md`](backlog-detalhado.md) como **D1**–**D13**; o formato binário está em [`formato.md`](formato.md).

---

## 1. Como o sistema funciona, em um parágrafo

Dois usuários fixos. Cada um gera um par de chaves ECDH no próprio navegador. O servidor distribui as **chaves públicas** e guarda o histórico **já cifrado**. Ao escrever, o navegador comprime o texto com Huffman, cifra com AES-256-GCM sob uma chave derivada do par (ECDH → HKDF) e produz um arquivo `.treehash`, que o remetente entrega pelo canal que quiser. O destinatário abre o arquivo no tradutor e o decifra no próprio navegador.

**O servidor nunca vê texto puro nem chave privada.** Essa é a promessa, e o resto deste documento existe para dizer exatamente até onde ela vale.

### Onde cada segredo vive

| Segredo | Onde fica | Sai de lá? |
|---|---|---|
| Chave privada ECDH | IndexedDB do navegador | Só dentro do backup cifrado por senha |
| Chave AES da conversa | Memória, marcada como não extraível | Nunca; é recalculada a cada carregamento |
| Senha de backup | Memória, enquanto digitada | Nunca; nem para o servidor, nem para o disco |
| Texto das mensagens | Memória do navegador | Só cifrado |
| Chave pública, código de segurança | Servidor e telas | Público por design |

---

## 2. Huffman é compressão, não criptografia

É a confusão mais comum em projetos deste tipo, e vale ser explícito.

A tabela de frequência está commitada no repositório **e é servida ao navegador**. Qualquer pessoa que abra o app lê a tabela inteira no DevTools; o corpus que a gerou também está versionado, de propósito, para que ela seja reproduzível. Isso é inevitável: a tabela roda no navegador dos dois usuários, então precisa estar no cliente.

**E não há nada nela para quebrar.** A árvore de Huffman é uma transformação fixa e reversível, da mesma natureza que UTF-8, Base64 ou ZIP — ela não tem chave. Se o Huffman fosse a proteção do app, o esquema estaria quebrado no primeiro dia, tabela pública ou não: bastaria análise de frequência sobre alguns arquivos para reconstruir os códigos.

O que protege é a ordem das operações:

```
texto → Huffman → AES-256-GCM → arquivo .treehash
```

Quem intercepta o arquivo vê **apenas a saída do AES-GCM**: bytes indistinguíveis de aleatórios. Não se chega à camada do Huffman sem antes quebrar o AES-256 — e nesse ponto a tabela é irrelevante, porque o atacante já teria o texto.

### Princípio de Kerckhoffs

Um sistema criptográfico deve permanecer seguro mesmo que tudo sobre ele seja público, exceto a chave.

| Público por design | Secreto |
|---|---|
| Tabela de frequência e corpus | **Chave privada ECDH** |
| Formato binário `.treehash` (D5) | Chave AES derivada (não extraível) |
| Algoritmo de derivação (D4) | Senha de backup |
| Código de segurança (fingerprint) | |
| Todo o código-fonte | |

O código de segurança merece nota à parte: ele é o SHA-256 da chave **pública**, então carrega menos informação que a própria chave, que já é distribuída pelo servidor. Ele aparece na tela de propósito — escondido, não serviria para nada, porque a função dele é ser lido em voz alta e comparado.

---

## 3. O que o sistema protege

| Ameaça | O que impede |
|---|---|
| **Leitura por terceiros no canal** — WhatsApp, e-mail, pen-drive perdido | O arquivo é AES-256-GCM. Sem a chave privada de um dos dois, é ruído |
| **Adulteração da mensagem** | A tag GCM de 16 bytes autentica o conteúdo, e o AAD estende isso ao cabeçalho: magic, versão, flags, remetente e data. Um byte alterado invalida a mensagem inteira, sem texto parcial |
| **Leitura por quem acessa o banco** | O servidor guarda blobs cifrados e chaves públicas. Um dump completo do Postgres não revela nenhuma mensagem |
| **Troca de remetente** | O servidor confere o `sender_id` do cabeçalho contra quem afirma ter enviado, e o destinatário valida o AAD com a chave |
| **Força bruta no login** | Cinco tentativas por endereço a cada 15 minutos |
| **XSS exfiltrando a chave** | CSP sem `unsafe-inline`; todo JavaScript vem de arquivo externo |
| **Perda do navegador** | Backup em duas camadas: blob cifrado no servidor e arquivo `.treehashkey` |

---

## 4. O que o sistema NÃO protege

### 4.1 Servidor malicioso na primeira troca de chaves

**A fraqueza estrutural mais séria.** O servidor entrega as chaves públicas. Comprometido, ele pode entregar a chave *dele* no lugar da do outro usuário e ler tudo daí em diante.

**Mitigação, não eliminação:** a verificação de código de segurança (fingerprint). Os dois usuários comparam os códigos por um canal fora do app; se batem, não há ninguém no meio. O app também guarda a chave do outro e avisa se ela mudar.

**O limite honesto:** o app não tem como saber se a comparação aconteceu de verdade. Marcar "já conferi" sem conferir deixa o indicador verde e a proteção inexistente. **Esta é a única defesa contra esse ataque, e ela depende inteiramente do usuário.**

### 4.2 Dispositivo comprometido

Malware com acesso ao perfil do navegador obtém a chave privada do IndexedDB. Um XSS na aplicação faria o mesmo.

**Mitigação:** a CSP restritiva (13.3) reduz a superfície de XSS. Contra malware no sistema operacional, não há defesa do lado da aplicação — e a chave é exportável de propósito, porque o backup exige. É uma troca consciente: aceitamos esse risco para não perder o histórico ao limpar o navegador, que é o cenário muito mais provável.

### 4.3 Ausência de forward secrecy

Com ECDH estático, a mesma chave AES vale para sempre entre os dois usuários. Quem obtiver uma chave privada lê **todo** o histórico, inclusive mensagens antigas.

**Justificativa:** chave efêmera por mensagem (item 17.1) resolveria, ao custo de um protocolo de sessão muito mais complexo, fora do escopo. Aceito e documentado.

### 4.4 Metadados

O servidor vê quem falou com quem, quando, e o tamanho de cada mensagem. Só o conteúdo é opaco.

**Justificativa:** é o histórico que o projeto se propõe a oferecer. Esconder metadados exigiria outro desenho (armazenamento cego, preenchimento de tamanho), desproporcional para dois usuários fixos.

### 4.5 O canal de verificação

Se o atacante controla também o canal usado para comparar os códigos — por exemplo, se a comparação for feita pelo próprio app, ou por um WhatsApp já comprometido —, a verificação não vale nada.

**Mitigação:** a interface pede explicitamente um canal diferente, e avisa para nunca mandar senha ou confirmação de identidade pelo mesmo caminho da mensagem.

### 4.6 Senha de backup fraca

O backup transforma a chave privada em algo que existe em dois lugares novos: um blob no servidor e um arquivo baixado. Os dois são inúteis sem a senha — **a senha vira o elo mais fraco da cadeia**, e uma senha curta anula o AES-256 inteiro.

**Mitigação:** PBKDF2-HMAC-SHA256 com 600.000 iterações (recomendação da OWASP), medidas em ~270 ms, e mínimo de 8 caracteres na interface. Oito caracteres é pouco para um blob que pode ser atacado offline; elevar esse mínimo é a melhoria mais barata disponível hoje.

---

## 5. Vazamentos conhecidos e aceitos

**Comprimir antes de cifrar revela quanto o texto comprimiu.** Existe uma classe de ataque que explora isso (CRIME/BREACH), mas ela exige que o atacante injete texto escolhido dentro da mensagem da vítima e observe o tamanho resultante, repetidamente. Alguém digitando uma mensagem à mão não oferece esse cenário. **Não explorável aqui.**

**O cabeçalho viaja em claro.** Flags, remetente e data precisam ser lidos antes de decifrar. Eles são autenticados pelo AAD — adulterar invalida a mensagem —, mas são visíveis. Combinados com o tamanho do arquivo, entregam o mesmo tipo de metadado que o servidor já vê.

**O `/admin/` roda com CSP mais frouxa.** O Admin do Django usa script e estilo embutidos; aplicar a política estrita quebraria a tela usada para liberar chave. É exceção consciente: o Admin é servidor puro e não tem acesso à chave privada.

**O limite de login é por processo.** O cache padrão vive na memória do worker; com vários workers, o limite efetivo multiplica. Em produção, isso pede cache compartilhado.

---

## 6. Perda de chave: as três camadas e o limite

| Camada | Protege contra | Onde vive |
|---|---|---|
| **1. Backup cifrado no servidor** | Trocar de dispositivo, limpar o navegador | Conta do app, como blob opaco |
| **2. Arquivo `.treehashkey`** | Servidor fora do ar, conta perdida | Pen-drive, gerenciador de senhas |
| **3. Recuperação assistida pelo outro usuário** | Falha das duas anteriores | Navegador do outro usuário |

A camada 3 ainda não está implementada (item 11.7). A decisão já tomada: ela **não vai reescrever blobs já gravados** — vai gravar cópias novas recifradas, porque o servidor guardar exatamente o que o cliente gerou é parte do que este projeto promete.

**O limite honesto:** se os dois usuários perderem as chaves ao mesmo tempo e não houver backup, **o histórico é irrecuperável** — nem os administradores restauram. Isso não é falha: é a contrapartida direta de o servidor não conseguir ler nada. Um sistema em que o administrador pudesse recuperar seria um sistema em que ele poderia ler.

É por isso que o app **exige** o backup antes de liberar o compositor.

---

## 7. Parâmetros, para quem for auditar

| O quê | Valor |
|---|---|
| Acordo de chaves | ECDH P-256, par estático por usuário |
| Derivação | HKDF-SHA256 · salt = `SHA-256(menor + NUL + maior)` dos dois usernames · info = `treehash/v1/aes-gcm-256` |
| Cifragem | AES-256-GCM, IV aleatório de 12 bytes por mensagem, tag de 16 bytes |
| Autenticação do cabeçalho | AAD = primeiros 15 bytes do arquivo |
| Backup da chave | PBKDF2-HMAC-SHA256, 600.000 iterações, salt de 16 bytes, AES-256-GCM |
| Chave pública no servidor | Write-once; trocar exige intervenção no Admin |
| Tamanho máximo de mensagem | 1 MB, conferido no cliente e no servidor |

A ordenação dos usernames no salt usa comparação de unidades de código, **não** `localeCompare` — comparação por locale varia entre sistemas e produziria chaves diferentes nas duas pontas, uma falha silenciosa. O separador `NUL` também não é decorativo: sem ele, `("ana", "luiza-silva")` e `("ana-luiza", "silva")` colidiriam no mesmo salt.

---

## 8. O que é verificado automaticamente

| Propriedade | Como |
|---|---|
| Adulteração é sempre recusada | Testes que trocam byte do ciphertext, do `created_at` e do `sender_id` sobre vetores fixos |
| As duas pontas derivam a mesma chave | Testes que cifram com um par e decifram com o outro |
| Formato e tabela não mudam sem avisar | Vetores versionados em `tests/vectors/`, que param de abrir se algo mudar |
| A chave privada não vaza para o backup | Teste que varre o blob procurando as coordenadas da chave |
| O backup restaurado devolve o histórico | Teste que deriva a chave AES com o par restaurado e decifra o que o original cifrou |
| Nenhuma página carrega script embutido | Teste que varre o HTML das quatro telas |
| O servidor não aceita backup inválido | Testes de envelope: magic, versão, tamanho |
| O código de segurança é igual nos dois lados | O mesmo valor fixado em um teste Python e um JavaScript |

São 158 testes no servidor e 378 no navegador. O que não dá para automatizar — duas máquinas de verdade, editor hexadecimal, apagar o IndexedDB — está no [`roteiro-de-testes.md`](roteiro-de-testes.md).

---

## 9. Resumo para quem tem pressa

O conteúdo das mensagens está protegido por criptografia de ponta a ponta com parâmetros atuais e bem implementados, e isso é verificável por teste.

**A proteção depende de um ato humano:** comparar os códigos de segurança uma vez, por telefone ou pessoalmente. Sem isso, um servidor comprometido pode ter se colocado no meio desde o primeiro acesso, e nada no app denuncia.

**E depende de uma senha:** a de backup, que é o que protege a chave privada fora do navegador.

Feitas essas duas coisas, o que sobra de risco é dispositivo comprometido, metadados e ausência de forward secrecy — todos documentados acima, nenhum escondido.
