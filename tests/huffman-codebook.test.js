import { describe, expect, it } from "vitest";

import {
  ALPHABET_SIZE,
  EOF_SYMBOL,
  FREQUENCY_TABLE,
} from "../messenger/static/messenger/js/frequency-table.js";
import {
  CODEBOOK,
  CodebookError,
  MAX_CODE_LENGTH,
  buildCodebook,
} from "../messenger/static/messenger/js/huffman-codebook.js";

const uniformTable = (value = 1) => new Uint32Array(ALPHABET_SIZE).fill(value);

function isPrefix(shortCode, shortLength, longCode, longLength) {
  if (shortLength > longLength) return false;
  return Math.floor(longCode / 2 ** (longLength - shortLength)) === shortCode;
}

describe("determinismo (D3)", () => {
  it("produz o mesmo códebook em 100 construções seguidas", () => {
    const referencia = buildCodebook(FREQUENCY_TABLE);
    for (let i = 0; i < 100; i++) {
      const atual = buildCodebook(FREQUENCY_TABLE);
      expect([...atual.lengths]).toEqual([...referencia.lengths]);
      expect([...atual.codes]).toEqual([...referencia.codes]);
    }
  });

  it("desempata de forma estável quando todas as frequências são iguais", () => {
    const primeiro = buildCodebook(uniformTable());
    for (let i = 0; i < 20; i++) {
      expect([...buildCodebook(uniformTable()).codes]).toEqual([...primeiro.codes]);
    }
  });

  it("chega ao mesmo resultado do códebook exportado", () => {
    expect([...buildCodebook(FREQUENCY_TABLE).codes]).toEqual([...CODEBOOK.codes]);
  });
});

describe("validade do código de prefixo", () => {
  it("satisfaz a igualdade de Kraft, ou seja, é um código completo", () => {
    const soma = [...CODEBOOK.lengths].reduce((acc, len) => acc + 2 ** -len, 0);
    expect(soma).toBeCloseTo(1, 12);
  });

  it("não tem nenhum código que seja prefixo de outro", () => {
    const { lengths, codes } = CODEBOOK;
    const colisoes = [];

    for (let a = 0; a < ALPHABET_SIZE; a++) {
      for (let b = 0; b < ALPHABET_SIZE; b++) {
        if (a === b) continue;
        if (isPrefix(codes[a], lengths[a], codes[b], lengths[b])) {
          colisoes.push([a, b]);
        }
      }
    }

    expect(colisoes).toEqual([]);
  });

  it("dá a todos os símbolos um comprimento entre 1 e o limite", () => {
    for (let symbol = 0; symbol < ALPHABET_SIZE; symbol++) {
      expect(CODEBOOK.lengths[symbol]).toBeGreaterThanOrEqual(1);
      expect(CODEBOOK.lengths[symbol]).toBeLessThanOrEqual(MAX_CODE_LENGTH);
    }
  });

  it("cabe em 32 bits, o que permite guardar os códigos em Uint32Array", () => {
    expect(CODEBOOK.maxLength).toBeLessThanOrEqual(MAX_CODE_LENGTH);
  });
});

describe("otimalidade de Huffman", () => {
  it("nunca dá código mais longo a um símbolo mais frequente", () => {
    const inversoes = [];
    for (let a = 0; a < ALPHABET_SIZE; a++) {
      for (let b = 0; b < ALPHABET_SIZE; b++) {
        if (FREQUENCY_TABLE[a] > FREQUENCY_TABLE[b] && CODEBOOK.lengths[a] > CODEBOOK.lengths[b]) {
          inversoes.push([a, b]);
        }
      }
    }
    expect(inversoes).toEqual([]);
  });

  it("dá ao espaço um dos códigos mais curtos", () => {
    expect(CODEBOOK.lengths[0x20]).toBe(CODEBOOK.minLength);
  });

  it("empurra o EOF para a cauda, já que aparece uma vez por mensagem", () => {
    expect(CODEBOOK.lengths[EOF_SYMBOL]).toBeGreaterThan(CODEBOOK.lengths[0x20]);
  });

  it("fica a menos de 2% da entropia do corpus", () => {
    const total = [...FREQUENCY_TABLE].reduce((acc, n) => acc + n, 0);
    let medio = 0;
    let entropia = 0;
    for (let symbol = 0; symbol < ALPHABET_SIZE; symbol++) {
      const p = FREQUENCY_TABLE[symbol] / total;
      medio += CODEBOOK.lengths[symbol] * p;
      entropia -= p * Math.log2(p);
    }
    expect(medio).toBeGreaterThanOrEqual(entropia);
    expect(medio / entropia).toBeLessThan(1.02);
  });
});

describe("forma canônica", () => {
  it("ordena os símbolos por comprimento e depois por índice", () => {
    const ordem = [...CODEBOOK.symbolsInCanonicalOrder];
    for (let i = 1; i < ordem.length; i++) {
      const anterior = ordem[i - 1];
      const atual = ordem[i];
      const chaveAnterior = [CODEBOOK.lengths[anterior], anterior];
      const chaveAtual = [CODEBOOK.lengths[atual], atual];
      expect(
        chaveAnterior[0] < chaveAtual[0] ||
          (chaveAnterior[0] === chaveAtual[0] && chaveAnterior[1] < chaveAtual[1])
      ).toBe(true);
    }
  });

  it("atribui códigos consecutivos dentro de cada comprimento", () => {
    const ordem = [...CODEBOOK.symbolsInCanonicalOrder];
    for (let i = 1; i < ordem.length; i++) {
      const anterior = ordem[i - 1];
      const atual = ordem[i];
      if (CODEBOOK.lengths[anterior] === CODEBOOK.lengths[atual]) {
        expect(CODEBOOK.codes[atual]).toBe(CODEBOOK.codes[anterior] + 1);
      }
    }
  });
});

describe("índice de decodificação", () => {
  it("conta corretamente quantos símbolos há em cada comprimento", () => {
    const esperado = new Uint32Array(CODEBOOK.maxLength + 1);
    for (const length of CODEBOOK.lengths) {
      esperado[length] += 1;
    }
    expect([...CODEBOOK.countByLength]).toEqual([...esperado]);
  });

  it("aponta firstCode e firstIndex para o primeiro símbolo de cada comprimento", () => {
    const { lengths, codes, symbolsInCanonicalOrder, countByLength } = CODEBOOK;

    for (let length = 1; length <= CODEBOOK.maxLength; length++) {
      if (countByLength[length] === 0) continue;

      const indice = CODEBOOK.firstIndex[length];
      const symbol = symbolsInCanonicalOrder[indice];

      expect(lengths[symbol]).toBe(length);
      expect(codes[symbol]).toBe(CODEBOOK.firstCode[length]);
      expect(indice === 0 || lengths[symbolsInCanonicalOrder[indice - 1]]).not.toBe(length);
    }
  });

  it("permite recuperar qualquer símbolo a partir do seu código", () => {
    const { lengths, codes, symbolsInCanonicalOrder, firstCode, firstIndex } = CODEBOOK;

    for (let symbol = 0; symbol < ALPHABET_SIZE; symbol++) {
      const length = lengths[symbol];
      const posicao = firstIndex[length] + (codes[symbol] - firstCode[length]);
      expect(symbolsInCanonicalOrder[posicao]).toBe(symbol);
    }
  });
});

describe("validação da tabela de entrada", () => {
  it("recusa tabela com tamanho diferente de 257", () => {
    expect(() => buildCodebook(new Uint32Array(256).fill(1))).toThrow(CodebookError);
    expect(() => buildCodebook(new Uint32Array(258).fill(1))).toThrow(/257 entradas/);
  });

  it("recusa frequência zero", () => {
    const tabela = uniformTable();
    tabela[42] = 0;
    expect(() => buildCodebook(tabela)).toThrow(/símbolo 42/);
  });

  it("aceita frequências grandes sem estourar o limite de bits", () => {
    const tabela = uniformTable();
    tabela[0x20] = 10_000_000;
    const codebook = buildCodebook(tabela);
    expect(codebook.maxLength).toBeLessThanOrEqual(MAX_CODE_LENGTH);
  });

  it("aceita o extremo do Uint32Array", () => {
    const tabela = uniformTable();
    tabela[0x20] = 4_294_967_295;
    expect(() => buildCodebook(tabela)).not.toThrow();
  });
});

describe("entradas mal formadas em array comum", () => {
  const comValor = (valor, posicao = 42) => {
    const tabela = new Array(ALPHABET_SIZE).fill(1);
    tabela[posicao] = valor;
    return tabela;
  };

  it("recusa string numérica, que a comparação com >= aceitaria por coerção", () => {
    expect(() => buildCodebook(new Array(ALPHABET_SIZE).fill("1"))).toThrow(CodebookError);
    expect(() => buildCodebook(comValor("5"))).toThrow(/símbolo 42/);
  });

  it.each([
    ["NaN", NaN],
    ["Infinity", Infinity],
    ["fracionário", 1.5],
    ["negativo", -3],
    ["zero", 0],
    ["null", null],
    ["undefined", undefined],
    ["objeto", {}],
    ["array", [2]],
    ["boolean", true],
  ])("recusa %s", (_rotulo, valor) => {
    expect(() => buildCodebook(comValor(valor))).toThrow(CodebookError);
  });

  it("aponta o símbolo culpado na mensagem", () => {
    expect(() => buildCodebook(comValor(0, 200))).toThrow(/símbolo 200/);
  });
});

describe("limites numéricos", () => {
  it("recusa soma que passa do inteiro seguro, onde a adição deixa de ser exata", () => {
    const tabela = new Array(ALPHABET_SIZE).fill(1);
    tabela[0] = Number.MAX_SAFE_INTEGER;
    expect(() => buildCodebook(tabela)).toThrow(/determinismo/);
  });

  it("recusa profundidade acima do limite em vez de truncá-la", () => {
    const tabela = new Array(ALPHABET_SIZE).fill(1);
    let acumulado = 2;
    for (let symbol = 2; symbol < ALPHABET_SIZE; symbol++) {
      tabela[symbol] = Math.min(acumulado + 1, 2 ** 40);
      acumulado += tabela[symbol];
    }
    expect(() => buildCodebook(tabela)).toThrow(/excede o limite de 32/);
  });

  it("relata a profundidade real, sem passar por Uint8Array antes da checagem", () => {
    const tabela = new Array(ALPHABET_SIZE).fill(1);
    let acumulado = 2;
    for (let symbol = 2; symbol < ALPHABET_SIZE; symbol++) {
      tabela[symbol] = Math.min(acumulado + 1, 2 ** 40);
      acumulado += tabela[symbol];
    }

    let relatada = null;
    try {
      buildCodebook(tabela);
    } catch (erro) {
      relatada = Number(erro.message.match(/Código de (\d+) bits/)[1]);
    }

    expect(relatada).toBeGreaterThan(MAX_CODE_LENGTH);
    expect(relatada).not.toBe(0);
  });
});
