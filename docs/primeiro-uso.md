# Guia de primeiro uso

Para as duas pessoas que vão conversar pelo Treehash. Não é preciso saber nada de programação: são cinco passos, feitos uma única vez.

O Treehash não envia mensagens sozinho. Você escreve o texto, o app gera um **arquivo cifrado**, e você entrega esse arquivo à outra pessoa do jeito que preferir — WhatsApp, e-mail, pen-drive. Quem recebe abre o arquivo no Treehash e lê o texto.

---

## Antes de começar

Abra o app sempre pelo endereço que combinaram com a equipe (`http://localhost:8000` ou o endereço publicado). **Use sempre o mesmo navegador, no mesmo computador.** A sua chave fica guardada nele, e só nele.

Combine também um jeito de falar com a outra pessoa **fora do app** — telefone, vídeo ou pessoalmente. Vai ser necessário uma vez, no passo 4.

---

## Passo 1 — Entrar

Use o usuário e a senha que a equipe entregou. Essa é a senha de **login**; mais adiante você vai criar outra, a de **backup**. São diferentes de propósito.

No primeiro acesso o app cria a sua chave sozinho, sem perguntar nada. A partir daí ele vai levar você para a tela **Identidade** — e é normal: só depois de guardar o backup o compositor e o tradutor abrem.

## Passo 2 — Criar a senha de backup

Ainda na tela **Identidade**, no bloco **Backup da sua chave**:

1. Digite uma senha de backup e repita.
2. Clique em **Guardar backup e baixar o arquivo**.

Duas coisas acontecem de uma vez: uma cópia protegida da sua chave fica guardada no servidor, e um arquivo `.treehashkey` é baixado para o seu computador.

> **Essa senha não tem "esqueci minha senha".** Sem ela, o backup não abre — nem por você, nem pela equipe. Anote em lugar seguro.

## Passo 3 — Guardar o arquivo `.treehashkey`

Coloque o arquivo baixado em algum lugar que sobreviva ao computador: pen-drive, HD externo, uma pasta na nuvem. Ele é a sua segunda garantia, para o caso de não conseguir chegar ao servidor.

O arquivo sozinho não serve para ninguém: está protegido pela senha do passo 2.

## Passo 4 — Comparar os códigos de segurança

Esse é o passo que realmente garante que você está falando com quem pensa que está — e é o único que o app não consegue fazer no seu lugar.

No alto da tela **Identidade** aparecem dois códigos, cada um com 12 grupos de 4 caracteres:

```
A sua chave                  e7fd 7e75 f50a 36ce 60fe 0e9e 08e4 adda f9f3 cd8b dbdb 6f8d
A chave de <a outra pessoa>  3b91 c40a 77de 1f52 a8c3 6b04 d219 e7aa 05fc 9138 42be cc71
```

Agora, **por telefone, vídeo ou pessoalmente** — nunca pelo próprio app:

1. Ligue para a outra pessoa e peça que ela abra a tela **Identidade** também.
2. Leia em voz alta o código que aparece para você como **"a chave de [nome dela]"**.
3. Ela confere se é exatamente o mesmo que aparece na tela dela como **"a sua chave"**.
4. Façam o contrário: ela lê o código dela e você confere do seu lado.

**Os dois pares batem?** Clique em **Já conferi pessoalmente**. Pronto, a verificação está feita e não precisa ser repetida.

**Algum código está diferente?** Pare por aqui e avise a equipe antes de trocar qualquer mensagem. Códigos diferentes significam que uma das chaves não é a que você pensa que é.

> Por que isso importa: o app confia no servidor para entregar a chave da outra pessoa. Se alguém trocasse essa chave, conseguiria ler as mensagens sem que nada na tela parecesse errado. A comparação por fora do app é o que fecha essa porta — e por isso ela tem que ser por fora, porque um app comprometido mostraria os códigos que quisesse.

## Passo 5 — Enviar a primeira mensagem

Agora o compositor está liberado.

**Para enviar:**

1. Abra **Compor**, escreva o texto e clique em cifrar.
2. Escolha como entregar: **baixar o arquivo** ou **copiar o bloco de texto** para colar onde quiser.
3. Mande para a outra pessoa pelo canal que preferir. Pode ser WhatsApp mesmo: o que trafega já está cifrado.

**Para ler o que recebeu:**

1. Abra **Traduzir**.
2. Arraste o arquivo `.treehash` para a tela — ou cole o bloco de texto que começa com `-----BEGIN TREEHASH-----`.
3. O texto original aparece.

Se você colar o bloco junto com outras coisas ("oi, segue a mensagem"), tudo bem: o app ignora o que está em volta.

---

## O que fazer quando...

**Troquei de computador ou limpei os dados do navegador.**
Entre normalmente. Na tela **Identidade**, no bloco **Restaurar a chave**, digite a senha de backup e clique em **Restaurar do servidor**. Se não aparecer backup no servidor, use o arquivo `.treehashkey` que você guardou no passo 3.

**Esqueci a senha de backup.**
Se a chave ainda estiver no navegador que você usa, nada foi perdido: vá à tela **Identidade** e crie um backup novo com uma senha nova. Se a chave já se perdeu junto com a senha, o histórico daquele lado não volta — nem a equipe consegue recuperá-lo.

**O app diz que não estou em contexto seguro.**
Você abriu por um endereço que o navegador não considera seguro. Use `http://localhost:8000`, `http://127.0.0.1:8000` ou o endereço `https://` que a equipe passou — nunca o número de IP da rede.

**A mensagem não abre no tradutor.**
Costuma ser uma das três: o arquivo foi alterado no caminho (alguns apps recomprimem anexos), você colou só um pedaço do bloco de texto, ou o arquivo é de outra pessoa. Peça para reenviar.

**O arquivo ficou maior que o texto que escrevi.**
É esperado em mensagens curtas: toda mensagem carrega 43 bytes fixos de cabeçalho e assinatura. Acima de umas 100 letras o arquivo já sai menor que o texto.

---

## Duas regras que resumem tudo

1. **A senha de backup não é recuperável.** Anote.
2. **A comparação dos códigos é feita fora do app, uma vez.** É a única coisa que o Treehash não pode fazer sozinho — e é ela que garante o resto.
