import { afterEach, beforeAll, describe, expect, it } from "vitest";

import {
  SENDER_ID,
  composeMessage,
  isFakeImplementation,
  openSession,
  readMessage,
} from "../messenger/static/messenger/js/app.js";
import { deriveKey } from "../messenger/static/messenger/js/crypto.js";
import { HEADER_SIZE, TAG_SIZE, unpack } from "../messenger/static/messenger/js/format.js";
import {
  ensureKeyPair,
  exportPublicKey,
  forgetPendingKeyPair,
  generateKeyPair,
  hasLocalKeyPair,
  savePeerPublicKey,
} from "../messenger/static/messenger/js/keys.js";
import {
  DATABASE_NAME,
  closeDatabase,
} from "../messenger/static/messenger/js/keystore.js";

const TEXTOS = {
  "texto simples": "Ola, mundo!",
  "acentuação e cedilha": "Ação, coração, çedilha, ünïcôdé — tudo junto.",
  "emoji e CJK": "Emoji: 🔐🇧🇷 e CJK: 日本語",
  "um caractere": "a",
  "quebras de linha": "primeira\nsegunda\n\nquarta",
  "parágrafo longo": "O rato roeu a roupa do rei de Roma. ".repeat(60),
};

let chaveDaAlice;
let chaveDoBob;

beforeAll(async () => {
  const [alice, bob] = await Promise.all([generateKeyPair(), generateKeyPair()]);
  chaveDaAlice = await deriveKey(alice.privateKey, bob.publicKey, "alice", "bob");
  chaveDoBob = await deriveKey(bob.privateKey, alice.publicKey, "alice", "bob");
});

describe("round-trip compor → ler", () => {
  for (const [nome, texto] of Object.entries(TEXTOS)) {
    it(`preserva ${nome}`, async () => {
      const { file } = await composeMessage(texto, chaveDaAlice);
      const lida = await readMessage(file, chaveDoBob);
      expect(lida.text).toBe(texto);
    });
  }

  it("entrega a mensagem do remetente ao destinatário, com as chaves de cada um", async () => {
    const texto = "Mensagem de ida e volta entre dois usuários distintos.";
    const ida = await composeMessage(texto, chaveDaAlice);
    expect((await readMessage(ida.file, chaveDoBob)).text).toBe(texto);

    const volta = await composeMessage("Resposta.", chaveDoBob);
    expect((await readMessage(volta.file, chaveDaAlice)).text).toBe("Resposta.");
  });
});

describe("metadados da mensagem", () => {
  it("preserva created_at e sender_id", async () => {
    const { file, createdAt } = await composeMessage("teste", chaveDaAlice);
    const lida = await readMessage(file, chaveDoBob);
    expect(lida.createdAt).toBe(createdAt);
    expect(lida.senderId).toBe(SENDER_ID);
  });

  it("gera um IV diferente a cada chamada", async () => {
    const a = await composeMessage("mesma mensagem", chaveDaAlice);
    const b = await composeMessage("mesma mensagem", chaveDaAlice);
    expect([...unpack(a.file).iv]).not.toEqual([...unpack(b.file).iv]);
  });

  it("sugere um nome de arquivo válido", async () => {
    const { name } = await composeMessage("teste", chaveDaAlice);
    expect(name).toMatch(/^msg-\d{8}-\d{6}\.msgenc$/);
  });
});

describe("estatísticas", () => {
  it("reporta tamanhos coerentes com o arquivo gerado", async () => {
    const texto = "Uma frase de teste com acentuação.";
    const { file, stats } = await composeMessage(texto, chaveDaAlice);

    expect(stats.characters).toBe([...texto].length);
    expect(stats.originalBytes).toBe(new TextEncoder().encode(texto).length);
    expect(stats.fileBytes).toBe(file.length);
    expect(stats.fileBytes).toBe(stats.compressedBytes + HEADER_SIZE + TAG_SIZE);
  });
});

describe("entradas inválidas", () => {
  it("recusa texto vazio", async () => {
    await expect(composeMessage("", chaveDaAlice)).rejects.toThrow(/Digite uma mensagem/);
  });

  it("recusa entrada que não é string", async () => {
    await expect(composeMessage(null, chaveDaAlice)).rejects.toThrow();
  });

  it("recusa compor sem chave, com a mensagem prevista em 9.5", async () => {
    await expect(composeMessage("teste")).rejects.toThrow(/troca de chaves/);
  });

  it("recusa arquivo corrompido", async () => {
    const { file } = await composeMessage("teste", chaveDaAlice);
    file[0] = 0x00;
    await expect(readMessage(file, chaveDoBob)).rejects.toThrow();
  });

  it("recusa arquivo com o cabeçalho adulterado, graças ao AAD", async () => {
    const { file } = await composeMessage("teste", chaveDaAlice);
    file[6] = file[6] === 0 ? 1 : 0;
    await expect(readMessage(file, chaveDoBob)).rejects.toThrow(/adulterado|sender_id/);
  });
});

describe("estado da implementação", () => {
  it("não sinaliza mais implementação falsa: Huffman e cifragem são reais", () => {
    expect(isFakeImplementation()).toBe(false);
  });
});

describe("estado da sessão (revisão de código)", () => {
  afterEach(async () => {
    forgetPendingKeyPair();
    closeDatabase();
    await new Promise((resolve) => {
      const request = indexedDB.deleteDatabase(DATABASE_NAME);
      request.onsuccess = resolve;
      request.onerror = resolve;
      request.onblocked = resolve;
    });
  });

  it("prepara a chave local mesmo sem a chave do outro usuário", async () => {
    const sessao = await openSession();

    expect(sessao.ready).toBe(false);
    expect(sessao.localKeyCreated).toBe(true);
    expect(sessao.aesKey).toBeUndefined();
    expect(await hasLocalKeyPair()).toBe(true);
  });

  it("explica o que falta em vez de deixar a tela falhar no clique", async () => {
    const sessao = await openSession();
    expect(sessao.reason).toMatch(/chave pública do outro/);
  });

  it("fica pronta assim que a chave do outro usuário chega", async () => {
    const outro = await generateKeyPair();
    await savePeerPublicKey({
      jwk: await exportPublicKey(outro.publicKey),
      localUsername: "diretor",
      peerUsername: "marcio",
    });

    const sessao = await openSession();
    expect(sessao.ready).toBe(true);
    expect(sessao.aesKey.algorithm.name).toBe("AES-GCM");
  });

  it("a chave da sessão cifra e o outro lado decifra", async () => {
    const outro = await generateKeyPair();
    await savePeerPublicKey({
      jwk: await exportPublicKey(outro.publicKey),
      localUsername: "diretor",
      peerUsername: "marcio",
    });

    const sessao = await openSession();
    const local = await ensureKeyPair();
    const chaveDoOutro = await deriveKey(
      outro.privateKey,
      local.pair.publicKey,
      "diretor",
      "marcio"
    );

    const texto = "Mensagem pela sessão do app.";
    const { file } = await composeMessage(texto, sessao.aesKey);
    expect((await readMessage(file, chaveDoOutro)).text).toBe(texto);
  });
});
