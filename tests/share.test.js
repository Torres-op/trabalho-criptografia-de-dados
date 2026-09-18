import { afterEach, describe, expect, it, vi } from "vitest";

import { ARMOR_HEADER, fromArmor } from "../messenger/static/messenger/js/armor.js";
import {
  PASTE_INTRO,
  copyText,
  pasteBlock,
} from "../messenger/static/messenger/js/share.js";

const sample = () => new Uint8Array([0x54, 0x52, 0x48, 0x53, 1, 1, 0, 200, 15, 42, 7]);

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bloco colável (8.2)", () => {
  it("volta a ser o mesmo arquivo depois de colado", () => {
    expect([...fromArmor(pasteBlock(sample()))]).toEqual([...sample()]);
  });

  it("explica o que é antes do bloco, e o tradutor continua lendo", () => {
    const block = pasteBlock(sample());

    expect(block.startsWith(PASTE_INTRO)).toBe(true);
    expect(block).toContain(ARMOR_HEADER);
  });

  it("sobrevive ao que o WhatsApp acrescenta em volta", () => {
    const pasted = `Oi! ${pasteBlock(sample())}\n\nMe avisa quando ler.`;

    expect([...fromArmor(pasted)]).toEqual([...sample()]);
  });
});

describe("cópia para a área de transferência", () => {
  it("copia quando o navegador deixa", async () => {
    const copied = [];
    vi.stubGlobal("navigator", { clipboard: { writeText: async (text) => copied.push(text) } });

    expect(await copyText("bloco")).toBe(true);
    expect(copied).toEqual(["bloco"]);
  });

  it("devolve falso quando não há área de transferência", async () => {
    vi.stubGlobal("navigator", {});

    expect(await copyText("bloco")).toBe(false);
  });

  it("devolve falso quando o navegador recusa a permissão", async () => {
    vi.stubGlobal("navigator", {
      clipboard: {
        writeText: async () => {
          throw new Error("negado");
        },
      },
    });

    expect(await copyText("bloco")).toBe(false);
  });
});
