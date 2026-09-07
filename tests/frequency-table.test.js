import { describe, expect, it } from "vitest";

import {
  ALPHABET_SIZE,
  EOF_SYMBOL,
  FREQUENCY_TABLE,
  SOURCE,
} from "../messenger/static/messenger/js/frequency-table.js";

const bytesOf = (char) => [...new TextEncoder().encode(char)];

describe("estrutura da tabela", () => {
  it("cobre 257 símbolos: os 256 bytes mais o EOF", () => {
    expect(ALPHABET_SIZE).toBe(257);
    expect(FREQUENCY_TABLE.length).toBe(ALPHABET_SIZE);
    expect(EOF_SYMBOL).toBe(256);
  });

  it("dá frequência mínima 1 a todos os símbolos", () => {
    const abaixoDoPiso = [...FREQUENCY_TABLE].filter((n) => n < 1);
    expect(abaixoDoPiso).toEqual([]);
  });

  it("reserva frequência 1 para o EOF", () => {
    expect(FREQUENCY_TABLE[EOF_SYMBOL]).toBe(1);
  });

  it("registra a procedência do corpus", () => {
    expect(SOURCE.generator).toBe("tools/generate-frequency-table.js");
    expect(SOURCE.corpus.length).toBeGreaterThan(0);
    expect(SOURCE.corpusBytes).toBeGreaterThan(100_000);
  });
});

describe("distribuição do português", () => {
  it("tem o espaço como símbolo mais frequente", () => {
    const maior = Math.max(...FREQUENCY_TABLE);
    expect(FREQUENCY_TABLE[0x20]).toBe(maior);
  });

  it("ordena as vogais acima das consoantes raras", () => {
    for (const vogal of ["a", "e", "o"]) {
      for (const rara of ["k", "w", "y"]) {
        expect(FREQUENCY_TABLE[vogal.charCodeAt(0)]).toBeGreaterThan(
          FREQUENCY_TABLE[rara.charCodeAt(0)]
        );
      }
    }
  });

  it("dá ao prefixo 0xC3 dos acentuados uma frequência alta", () => {
    expect(FREQUENCY_TABLE[0xc3]).toBeGreaterThan(1000);
  });
});

describe("cobertura de acentuação moderna", () => {
  const ACENTUADOS = ["á", "à", "â", "ã", "ç", "é", "ê", "í", "ó", "ô", "õ", "ú"];

  it.each(ACENTUADOS)("mantém %s acima do piso da tabela", (char) => {
    for (const byte of bytesOf(char)) {
      expect(FREQUENCY_TABLE[byte]).toBeGreaterThan(1);
    }
  });

  it("codifica cada acentuado em menos de 20 bits", () => {
    const total = [...FREQUENCY_TABLE].reduce((soma, n) => soma + n, 0);
    const custo = (char) =>
      bytesOf(char).reduce(
        (soma, byte) => soma - Math.log2(FREQUENCY_TABLE[byte] / total),
        0
      );

    for (const char of ACENTUADOS) {
      expect(custo(char)).toBeLessThan(20);
    }
  });
});
