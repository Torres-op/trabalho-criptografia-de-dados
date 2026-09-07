import { describe, expect, it } from "vitest";

import {
  HuffmanError,
  decode,
  encode,
  measure,
  stats,
} from "../messenger/static/messenger/js/huffman.js";

const roundTrip = (text) => {
  const { bytes, compressed } = encode(text);
  return decode(bytes, compressed);
};

const PARAGRAFO =
  "O rato roeu a roupa do rei de Roma enquanto a rainha, distraída, observava " +
  "a chuva cair sobre os telhados da cidade antiga. Não havia pressa naquela " +
  "tarde de domingo, e o silêncio da casa era interrompido apenas pelo " +
  "tique-taque do relógio de parede que o avô trouxera de Portugal há mais de " +
  "cinquenta anos. À janela, a gata dormia indiferente às conversas.";

describe("round-trip encode → decode", () => {
  const CASOS = {
    "frase simples": "Ola, mundo!",
    "acentos, cedilha e til": "Ação, coração, çedilha, ünïcôdé — tudo junto.",
    "crase e maiúsculas": "À noite, ÀS 19h, Ângela foi à reunião.",
    "texto vazio": "",
    "um caractere": "a",
    "um caractere acentuado": "ç",
    "só espaços": "     ",
    "quebras de linha": "primeira\nsegunda\r\n\nquarta",
    "emoji": "Chegando 🚗 em 5 min 🎉",
    "CJK": "日本語のテキスト",
    "cirílico e grego": "Привет κόσμε",
    "pontuação pesada": "«Ele disse: —Não!» ... (talvez?) [sim] {ok} #1 @2 50% $3",
    "dígitos": "0123456789 1234567890",
    "parágrafo longo": PARAGRAFO,
  };

  for (const [nome, texto] of Object.entries(CASOS)) {
    it(`preserva ${nome}`, () => {
      expect(roundTrip(texto)).toBe(texto);
    });
  }

  it("preserva a faixa Latin-1 inteira", () => {
    const texto = Array.from({ length: 256 }, (_, i) => String.fromCharCode(i)).join("");
    expect(roundTrip(texto)).toBe(texto);
  });

  it("preserva um texto que cobre todas as larguras de UTF-8", () => {
    const texto = "A é 日 🎉 ÿ Ω ← ✓ 𝕏 ﷽";
    expect(roundTrip(texto)).toBe(texto);
  });

  it("preserva um texto longo montado por repetição", () => {
    const texto = PARAGRAFO.repeat(20);
    expect(texto.length).toBeGreaterThan(2000);
    expect(roundTrip(texto)).toBe(texto);
  });
});

describe("fallback de expansão (D5)", () => {
  it("comprime um parágrafo em português", () => {
    const { bytes, compressed } = encode(PARAGRAFO);
    const originais = new TextEncoder().encode(PARAGRAFO).length;

    expect(compressed).toBe(true);
    expect(originais).toBeGreaterThanOrEqual(300);
    expect(bytes.length / originais).toBeLessThanOrEqual(0.65);
  });

  it("dispensa a compressão em texto curto demais", () => {
    expect(encode("oi").compressed).toBe(false);
  });

  it("dispensa a compressão quando o conteúdo só tem bytes raros", () => {
    expect(encode("🔐🇧🇷🎉").compressed).toBe(false);
  });

  it("nunca devolve um resultado maior que o UTF-8 original", () => {
    const textos = ["", "a", "oi", "🎉", PARAGRAFO, "日本語", "     "];
    for (const texto of textos) {
      const originais = new TextEncoder().encode(texto).length;
      expect(encode(texto).bytes.length).toBeLessThanOrEqual(originais);
    }
  });

  it("mantém o round-trip nos dois modos", () => {
    for (const texto of ["oi", PARAGRAFO]) {
      expect(roundTrip(texto)).toBe(texto);
    }
  });
});

describe("detecção de corrupção", () => {
  it("recusa fluxo truncado antes do EOF", () => {
    const { bytes, compressed } = encode(PARAGRAFO);
    expect(compressed).toBe(true);
    expect(() => decode(bytes.slice(0, bytes.length - 4), true)).toThrow(HuffmanError);
    expect(() => decode(bytes.slice(0, bytes.length - 4), true)).toThrow(/truncado/i);
  });

  it("recusa fluxo vazio marcado como comprimido", () => {
    expect(() => decode(new Uint8Array(0), true)).toThrow(HuffmanError);
  });

  it("recusa bytes que não formam UTF-8 válido", () => {
    expect(() => decode(new Uint8Array([0xff, 0xfe, 0xfd]), false)).toThrow(HuffmanError);
    expect(() => decode(new Uint8Array([0xff, 0xfe, 0xfd]), false)).toThrow(/texto válido/);
  });

  it("nunca devolve texto silenciosamente errado ao truncar", () => {
    const { bytes } = encode(PARAGRAFO);
    for (let corte = 1; corte < 12; corte++) {
      let resultado = null;
      try {
        resultado = decode(bytes.slice(0, bytes.length - corte), true);
      } catch (erro) {
        expect(erro).toBeInstanceOf(HuffmanError);
        continue;
      }
      expect(resultado).not.toBe(PARAGRAFO);
    }
  });
});

describe("estatísticas (3.6)", () => {
  it("reporta números coerentes com o resultado do encode", () => {
    const s = stats(PARAGRAFO);
    const { bytes, compressed } = encode(PARAGRAFO);

    expect(s.characters).toBe([...PARAGRAFO].length);
    expect(s.originalBytes).toBe(new TextEncoder().encode(PARAGRAFO).length);
    expect(s.compressedBytes).toBe(bytes.length);
    expect(s.compressed).toBe(compressed);
    expect(s.ratio).toBeCloseTo(bytes.length / s.originalBytes, 10);
    expect(s.bitsPerChar).toBeCloseTo((bytes.length * 8) / s.characters, 10);
  });

  it("relata menos de 5,5 bits por caractere em português corrido", () => {
    expect(stats(PARAGRAFO).bitsPerChar).toBeLessThan(5.5);
  });

  it("trata o texto vazio sem divisão por zero", () => {
    const s = stats("");
    expect(s.characters).toBe(0);
    expect(s.bitsPerChar).toBe(0);
    expect(s.originalBitsPerChar).toBe(0);
    expect(Number.isFinite(s.ratio)).toBe(true);
  });

  it("compara os bits por caractere com o custo do UTF-8", () => {
    const s = stats(PARAGRAFO);
    expect(s.originalBitsPerChar).toBeCloseTo((s.originalBytes * 8) / s.characters, 10);
    expect(s.bitsPerChar).toBeLessThan(s.originalBitsPerChar);
  });

  it("mede sem reprocessar quando já se tem o resultado do encode", () => {
    const encoded = encode(PARAGRAFO);
    expect(measure(PARAGRAFO, encoded)).toEqual(stats(PARAGRAFO));
  });

  it("expõe originalBytes no retorno do encode", () => {
    const esperado = new TextEncoder().encode(PARAGRAFO).length;
    expect(encode(PARAGRAFO).originalBytes).toBe(esperado);
    expect(encode("oi").originalBytes).toBe(2);
  });
});

describe("ponto de equilíbrio do arquivo", () => {
  const HEADER_SIZE = 27;

  it("compensa o cabeçalho a partir de algumas centenas de caracteres", () => {
    const { bytes } = encode(PARAGRAFO);
    const originais = new TextEncoder().encode(PARAGRAFO).length;
    expect(bytes.length + HEADER_SIZE).toBeLessThan(originais);
  });

  it("não compensa o cabeçalho em mensagem curta", () => {
    const curta = "Chego às 19h";
    const { bytes } = encode(curta);
    const originais = new TextEncoder().encode(curta).length;
    expect(bytes.length + HEADER_SIZE).toBeGreaterThan(originais);
  });
});

describe("desempenho", () => {
  it("processa 100 mil caracteres em menos de um segundo", () => {
    const texto = PARAGRAFO.repeat(320);
    expect(texto.length).toBeGreaterThan(100_000);

    const inicio = performance.now();
    const { bytes, compressed } = encode(texto);
    const saida = decode(bytes, compressed);
    const duracao = performance.now() - inicio;

    expect(saida).toBe(texto);
    expect(duracao).toBeLessThan(1000);
  });
});
