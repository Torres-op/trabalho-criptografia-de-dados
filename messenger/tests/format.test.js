import { describe, expect, it } from "vitest";

import {
  AAD_SIZE,
  EXTENSION,
  FLAG_COMPRESSED,
  FormatError,
  HEADER_SIZE,
  IV_SIZE,
  MAGIC,
  VERSION,
  buildAad,
  fileName,
  pack,
  unpack,
} from "../messenger/static/messenger/js/format.js";

const iv = () => new Uint8Array(IV_SIZE).fill(7);
const ciphertext = () => new Uint8Array([1, 2, 3, 4, 5]);

function sample(overrides = {}) {
  return pack({
    senderId: 0,
    createdAt: 1_757_000_000_000,
    compressed: false,
    iv: iv(),
    ciphertext: ciphertext(),
    ...overrides,
  });
}

describe("layout do cabeçalho (D5)", () => {
  it("usa o magic TRHS fixado em D5", () => {
    expect([...MAGIC]).toEqual([0x54, 0x52, 0x48, 0x53]);
  });

  it("escreve o magic nos 4 primeiros bytes", () => {
    expect([...sample().slice(0, 4)]).toEqual([...MAGIC]);
  });

  it("escreve a versão no offset 4", () => {
    expect(sample()[4]).toBe(VERSION);
  });

  it("reflete o flag de compressão no offset 5", () => {
    expect(sample({ compressed: false })[5]).toBe(0x00);
    expect(sample({ compressed: true })[5]).toBe(FLAG_COMPRESSED);
  });

  it("escreve o sender_id no offset 6", () => {
    expect(sample({ senderId: 1 })[6]).toBe(1);
  });

  it("escreve created_at como uint64 big-endian no offset 7", () => {
    const createdAt = 1_757_000_000_000;
    const bytes = sample({ createdAt });
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    expect(Number(view.getBigUint64(7, false))).toBe(createdAt);
  });

  it("posiciona iv e ciphertext nos offsets corretos", () => {
    const bytes = sample();
    expect([...bytes.slice(AAD_SIZE, HEADER_SIZE)]).toEqual([...iv()]);
    expect([...bytes.slice(HEADER_SIZE)]).toEqual([...ciphertext()]);
  });

  it("usa cabeçalho de exatamente 27 bytes", () => {
    expect(sample().length - ciphertext().length).toBe(HEADER_SIZE);
  });
});

describe("pack e unpack", () => {
  it("faz round-trip de todos os campos", () => {
    const entrada = {
      senderId: 1,
      createdAt: 1_757_123_456_789,
      compressed: true,
      iv: iv(),
      ciphertext: ciphertext(),
    };
    const saida = unpack(pack(entrada));

    expect(saida.senderId).toBe(entrada.senderId);
    expect(saida.createdAt).toBe(entrada.createdAt);
    expect(saida.compressed).toBe(true);
    expect([...saida.iv]).toEqual([...entrada.iv]);
    expect([...saida.ciphertext]).toEqual([...entrada.ciphertext]);
    expect(saida.version).toBe(VERSION);
  });

  it("devolve o aad igual aos 15 primeiros bytes do arquivo", () => {
    const bytes = sample();
    const { aad } = unpack(bytes);
    expect(aad.length).toBe(AAD_SIZE);
    expect([...aad]).toEqual([...bytes.slice(0, AAD_SIZE)]);
  });

  it("buildAad produz o mesmo prefixo que pack", () => {
    const campos = { senderId: 1, createdAt: 1_757_000_000_000, compressed: true };
    const aad = buildAad(campos);
    const bytes = pack({ ...campos, iv: iv(), ciphertext: ciphertext() });
    expect([...aad]).toEqual([...bytes.slice(0, AAD_SIZE)]);
  });
});

describe("validação na escrita", () => {
  it("rejeita iv com tamanho errado", () => {
    expect(() => sample({ iv: new Uint8Array(8) })).toThrow(FormatError);
  });

  it("rejeita ciphertext vazio", () => {
    expect(() => sample({ ciphertext: new Uint8Array(0) })).toThrow(FormatError);
  });

  it("rejeita sender_id fora de {0, 1}", () => {
    expect(() => sample({ senderId: 2 })).toThrow(FormatError);
  });

  it("rejeita created_at inválido", () => {
    expect(() => sample({ createdAt: -1 })).toThrow(FormatError);
    expect(() => sample({ createdAt: 1.5 })).toThrow(FormatError);
  });
});

describe("validação na leitura", () => {
  const corromper = (mutacao) => {
    const bytes = sample();
    mutacao(bytes);
    return bytes;
  };

  it("rejeita entrada que não é Uint8Array", () => {
    expect(() => unpack([1, 2, 3])).toThrow(FormatError);
  });

  it("rejeita arquivo menor que o cabeçalho", () => {
    expect(() => unpack(sample().slice(0, 10))).toThrow(FormatError);
  });

  it("rejeita magic diferente", () => {
    expect(() => unpack(corromper((b) => (b[0] = 0x00)))).toThrow(
      /não é uma mensagem do aplicativo/
    );
  });

  it("rejeita versão desconhecida", () => {
    expect(() => unpack(corromper((b) => (b[4] = 0x99)))).toThrow(/versão diferente/);
  });

  it("rejeita bits reservados em uso", () => {
    expect(() => unpack(corromper((b) => (b[5] = 0x80)))).toThrow(/bits reservados/);
  });

  it("rejeita sender_id inválido", () => {
    expect(() => unpack(corromper((b) => (b[6] = 7)))).toThrow(/sender_id inválido/);
  });
});

describe("fileName", () => {
  it("usa a extensão do formato", () => {
    expect(fileName(Date.now()).endsWith(EXTENSION)).toBe(true);
  });

  it("segue o padrão msg-AAAAMMDD-HHmmss", () => {
    expect(fileName(Date.now())).toMatch(/^msg-\d{8}-\d{6}\.treehash$/);
  });
});
