import { beforeAll, describe, expect, it } from "vitest";

import {
  composeMessage,
  isFakeImplementation,
  readMessage,
  senderIdFor,
  senderNameFor,
} from "../messenger/static/messenger/js/app.js";
import { deriveKey } from "../messenger/static/messenger/js/crypto.js";
import { HEADER_SIZE, TAG_SIZE, unpack } from "../messenger/static/messenger/js/format.js";
import { generateKeyPair } from "../messenger/static/messenger/js/keys.js";

const TEXTOS = {
  "texto simples": "Ola, mundo!",
  "acentuação e cedilha": "Ação, coração, çedilha, ünïcôdé — tudo junto.",
  "emoji e CJK": "Emoji: 🔐🇧🇷 e CJK: 日本語",
  "um caractere": "a",
  "quebras de linha": "primeira\nsegunda\n\nquarta",
  "parágrafo longo": "O rato roeu a roupa do rei de Roma. ".repeat(60),
};

let sessaoDaAlice;
let sessaoDoBob;

beforeAll(async () => {
  const [alice, bob] = await Promise.all([generateKeyPair(), generateKeyPair()]);
  sessaoDaAlice = {
    aesKey: await deriveKey(alice.privateKey, bob.publicKey, "alice", "bob"),
    senderId: 0,
  };
  sessaoDoBob = {
    aesKey: await deriveKey(bob.privateKey, alice.publicKey, "alice", "bob"),
    senderId: 1,
  };
});

describe("round-trip compor → ler", () => {
  for (const [nome, texto] of Object.entries(TEXTOS)) {
    it(`preserva ${nome}`, async () => {
      const { file } = await composeMessage(texto, sessaoDaAlice);
      expect((await readMessage(file, sessaoDoBob)).text).toBe(texto);
    });
  }

  it("funciona nos dois sentidos", async () => {
    const ida = await composeMessage("Mensagem de ida.", sessaoDaAlice);
    expect((await readMessage(ida.file, sessaoDoBob)).text).toBe("Mensagem de ida.");

    const volta = await composeMessage("Resposta.", sessaoDoBob);
    expect((await readMessage(volta.file, sessaoDaAlice)).text).toBe("Resposta.");
  });

  it("o remetente também relê a própria mensagem", async () => {
    const { file } = await composeMessage("Anotação minha.", sessaoDaAlice);
    expect((await readMessage(file, sessaoDaAlice)).text).toBe("Anotação minha.");
  });
});

describe("metadados da mensagem", () => {
  it("grava o sender_id de quem compôs", async () => {
    const daAlice = await composeMessage("teste", sessaoDaAlice);
    const doBob = await composeMessage("teste", sessaoDoBob);
    expect((await readMessage(daAlice.file, sessaoDoBob)).senderId).toBe(0);
    expect((await readMessage(doBob.file, sessaoDaAlice)).senderId).toBe(1);
  });

  it("preserva created_at", async () => {
    const { file, createdAt } = await composeMessage("teste", sessaoDaAlice);
    expect((await readMessage(file, sessaoDoBob)).createdAt).toBe(createdAt);
  });

  it("gera um IV diferente a cada chamada", async () => {
    const a = await composeMessage("mesma mensagem", sessaoDaAlice);
    const b = await composeMessage("mesma mensagem", sessaoDaAlice);
    expect([...unpack(a.file).iv]).not.toEqual([...unpack(b.file).iv]);
  });

  it("sugere um nome de arquivo válido", async () => {
    const { name } = await composeMessage("teste", sessaoDaAlice);
    expect(name).toMatch(/^msg-\d{8}-\d{6}\.treehash$/);
  });
});

describe("estatísticas", () => {
  it("reporta tamanhos coerentes com o arquivo gerado", async () => {
    const texto = "Uma frase de teste com acentuação.";
    const { file, stats } = await composeMessage(texto, sessaoDaAlice);

    expect(stats.characters).toBe([...texto].length);
    expect(stats.originalBytes).toBe(new TextEncoder().encode(texto).length);
    expect(stats.fileBytes).toBe(file.length);
    expect(stats.fileBytes).toBe(stats.compressedBytes + HEADER_SIZE + TAG_SIZE);
  });
});

describe("entradas inválidas", () => {
  it("recusa texto vazio", async () => {
    await expect(composeMessage("", sessaoDaAlice)).rejects.toThrow(/Digite uma mensagem/);
  });

  it("recusa entrada que não é string", async () => {
    await expect(composeMessage(null, sessaoDaAlice)).rejects.toThrow();
  });

  it("recusa compor sem sessão, com a mensagem prevista em 9.5", async () => {
    await expect(composeMessage("teste")).rejects.toThrow(/troca de chaves/);
    await expect(composeMessage("teste", { ready: false })).rejects.toThrow(/troca de chaves/);
  });

  it("recusa ler sem sessão", async () => {
    const { file } = await composeMessage("teste", sessaoDaAlice);
    await expect(readMessage(file)).rejects.toThrow(/troca de chaves/);
  });

  it("recusa arquivo corrompido", async () => {
    const { file } = await composeMessage("teste", sessaoDaAlice);
    file[0] = 0x00;
    await expect(readMessage(file, sessaoDoBob)).rejects.toThrow();
  });

  it("recusa arquivo com o cabeçalho adulterado, graças ao AAD", async () => {
    const { file } = await composeMessage("teste", sessaoDaAlice);
    file[6] = file[6] === 0 ? 1 : 0;
    await expect(readMessage(file, sessaoDoBob)).rejects.toThrow(/adulterado/);
  });
});

describe("identidade do remetente (D5)", () => {
  it("atribui 0 ao primeiro nome na ordem de D4 e 1 ao segundo", () => {
    expect(senderIdFor("diretor", "marcio")).toBe(0);
    expect(senderIdFor("marcio", "diretor")).toBe(1);
  });

  it("segue a ordem de unidades de código, igual ao servidor", () => {
    expect(senderIdFor("ana", "Zoe")).toBe(1);
    expect(senderIdFor("Zoe", "ana")).toBe(0);
  });

  it("traduz o sender_id de volta para o nome", () => {
    expect(senderNameFor(0, "marcio", "diretor")).toBe("diretor");
    expect(senderNameFor(1, "marcio", "diretor")).toBe("marcio");
  });
});

describe("estado da implementação", () => {
  it("não sinaliza mais implementação falsa", () => {
    expect(isFakeImplementation()).toBe(false);
  });
});
