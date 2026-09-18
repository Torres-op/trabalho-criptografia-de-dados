import { afterEach, describe, expect, it, vi } from "vitest";

import { ARMOR_HEADER, fromArmor } from "../messenger/static/messenger/js/armor.js";
import {
  FILE_TYPE,
  MAIL_SUBJECT,
  PASTE_INTRO,
  canShareFile,
  copyText,
  fileFor,
  mailBody,
  mailtoLink,
  pasteBlock,
  shareFile,
} from "../messenger/static/messenger/js/share.js";

const sample = () => new Uint8Array([0x54, 0x52, 0x48, 0x53, 1, 1, 0, 200, 15, 42, 7]);
const NAME = "msg-20260917-143200.treehash";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("e-mail (8.3)", () => {
  it("monta um mailto com assunto e corpo", () => {
    const link = mailtoLink(NAME);

    expect(link.startsWith("mailto:?")).toBe(true);
    expect(link).toContain(encodeURIComponent(MAIL_SUBJECT));
    expect(link).toContain(encodeURIComponent(NAME));
  });

  it("não promete anexo automático: manda o usuário anexar", () => {
    const body = mailBody(NAME);

    expect(body).toMatch(/Anexe o arquivo/);
    expect(body).toMatch(/não consegue anexar o arquivo sozinho/);
  });

  it("não leva o conteúdo da mensagem no corpo", () => {
    expect(mailBody(NAME)).not.toContain(ARMOR_HEADER);
  });
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

describe("arquivo para compartilhar", () => {
  it("embrulha os bytes num File com o nome e o tipo certos", () => {
    const file = fileFor(sample(), NAME);

    expect(file).toBeInstanceOf(File);
    expect(file.name).toBe(NAME);
    expect(file.type).toBe(FILE_TYPE);
    expect(file.size).toBe(sample().length);
  });
});

describe("compartilhamento nativo (8.4)", () => {
  const file = { name: NAME };

  it("aparece quando o navegador aceita compartilhar arquivos", () => {
    vi.stubGlobal("navigator", { share: () => {}, canShare: () => true });

    expect(canShareFile(file)).toBe(true);
  });

  it("some quando o navegador não tem a API", () => {
    vi.stubGlobal("navigator", {});
    expect(canShareFile(file)).toBe(false);

    vi.stubGlobal("navigator", undefined);
    expect(canShareFile(file)).toBe(false);
  });

  it("some quando o navegador compartilha texto, mas não arquivos", () => {
    vi.stubGlobal("navigator", { share: () => {}, canShare: () => false });

    expect(canShareFile(file)).toBe(false);
  });

  it("some quando o próprio canShare estoura", () => {
    vi.stubGlobal("navigator", {
      share: () => {},
      canShare: () => {
        throw new TypeError("sem suporte a arquivos");
      },
    });

    expect(canShareFile(file)).toBe(false);
  });
});

describe("resultado do compartilhamento", () => {
  it("avisa quando deu certo", async () => {
    vi.stubGlobal("navigator", { share: async () => undefined });

    expect(await shareFile({ name: NAME })).toBe("shared");
  });

  it("não trata desistência do usuário como erro", async () => {
    vi.stubGlobal("navigator", {
      share: async () => {
        const error = new Error("cancelado");
        error.name = "AbortError";
        throw error;
      },
    });

    expect(await shareFile({ name: NAME })).toBe("cancelled");
  });

  it("avisa quando falhou de verdade", async () => {
    vi.stubGlobal("navigator", {
      share: async () => {
        throw new Error("falhou");
      },
    });

    expect(await shareFile({ name: NAME })).toBe("failed");
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
