import { describe, expect, it } from "vitest";

import {
  SENDER_ID,
  composeMessage,
  isFakeImplementation,
  readMessage,
} from "../messenger/static/messenger/js/app.js";
import { unpack } from "../messenger/static/messenger/js/format.js";

const TEXTOS = {
  "texto simples": "Ola, mundo!",
  "acentuação e cedilha": "Ação, coração, çedilha, ünïcôdé — tudo junto.",
  "emoji e CJK": "Emoji: 🔐🇧🇷 e CJK: 日本語",
  "um caractere": "a",
  "quebras de linha": "primeira\nsegunda\n\nquarta",
  "parágrafo longo": "O rato roeu a roupa do rei de Roma. ".repeat(60),
};

describe("round-trip compor → ler", () => {
  for (const [nome, texto] of Object.entries(TEXTOS)) {
    it(`preserva ${nome}`, async () => {
      const { file } = await composeMessage(texto);
      const lida = await readMessage(file);
      expect(lida.text).toBe(texto);
    });
  }
});

describe("metadados da mensagem", () => {
  it("preserva created_at e sender_id", async () => {
    const { file, createdAt } = await composeMessage("teste");
    const lida = await readMessage(file);
    expect(lida.createdAt).toBe(createdAt);
    expect(lida.senderId).toBe(SENDER_ID);
  });

  it("gera um IV diferente a cada chamada", async () => {
    const a = await composeMessage("mesma mensagem");
    const b = await composeMessage("mesma mensagem");
    expect([...unpack(a.file).iv]).not.toEqual([...unpack(b.file).iv]);
  });

  it("sugere um nome de arquivo válido", async () => {
    const { name } = await composeMessage("teste");
    expect(name).toMatch(/^msg-\d{8}-\d{6}\.msgenc$/);
  });
});

describe("estatísticas", () => {
  it("reporta tamanhos coerentes com o arquivo gerado", async () => {
    const texto = "Uma frase de teste com acentuação.";
    const { file, stats } = await composeMessage(texto);

    expect(stats.characters).toBe([...texto].length);
    expect(stats.originalBytes).toBe(new TextEncoder().encode(texto).length);
    expect(stats.fileBytes).toBe(file.length);
    expect(stats.fileBytes).toBe(stats.compressedBytes + 27);
  });
});

describe("entradas inválidas", () => {
  it("recusa texto vazio", async () => {
    await expect(composeMessage("")).rejects.toThrow(/Digite uma mensagem/);
  });

  it("recusa entrada que não é string", async () => {
    await expect(composeMessage(null)).rejects.toThrow();
  });

  it("recusa arquivo corrompido", async () => {
    const { file } = await composeMessage("teste");
    file[0] = 0x00;
    await expect(readMessage(file)).rejects.toThrow();
  });
});

describe("marcação de implementação falsa", () => {
  it("sinaliza que huffman e crypto ainda são falsos no Épico 0", () => {
    expect(isFakeImplementation()).toBe(true);
  });
});
