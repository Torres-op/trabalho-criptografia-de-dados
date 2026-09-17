import { describe, expect, it } from "vitest";

import { EOF_SYMBOL } from "../messenger/static/messenger/js/frequency-table.js";
import { encode } from "../messenger/static/messenger/js/huffman.js";
import { CODEBOOK } from "../messenger/static/messenger/js/huffman-codebook.js";
import {
  SearchTreeError,
  buildCharacterTree,
  inOrder,
  insert,
  layout,
  search,
  searchPath,
  totalBits,
} from "../messenger/static/messenger/js/search-tree.js";

const labelsOf = (root) => inOrder(root).map((node) => node.label);
const countOf = (root, char) => search(root, char)?.count ?? 0;

describe("inserção", () => {
  it("devolve árvore vazia para texto vazio", () => {
    expect(buildCharacterTree("")).toBeNull();
  });

  it("conta quantas vezes cada caractere aparece", () => {
    const root = buildCharacterTree("arara");

    expect(countOf(root, "a")).toBe(3);
    expect(countOf(root, "r")).toBe(2);
    expect(countOf(root, "z")).toBe(0);
  });

  it("guarda cada caractere distinto uma única vez", () => {
    expect(labelsOf(buildCharacterTree("aaaa"))).toEqual(["a"]);
  });

  it("a ordem de chegada define o formato da árvore", () => {
    const first = buildCharacterTree("ba");
    const second = buildCharacterTree("ab");

    expect(first.char).toBe("b");
    expect(first.left.char).toBe("a");
    expect(second.char).toBe("a");
    expect(second.right.char).toBe("b");
  });

  it("aceita acentos, emoji e espaços", () => {
    const root = buildCharacterTree("çã 🔐🔐");

    expect(countOf(root, "🔐")).toBe(2);
    expect(countOf(root, " ")).toBe(1);
    expect(search(root, "ç").label).toBe("ç");
  });

  it("mostra espaço e quebra de linha com um símbolo visível", () => {
    const root = buildCharacterTree(" \n\t");

    expect(labelsOf(root).sort()).toEqual(["␣", "⇥", "⏎"].sort());
  });

  it("recusa entrada que não é texto", () => {
    expect(() => buildCharacterTree(null)).toThrow(SearchTreeError);
    expect(() => insert(null, "ab")).toThrow(SearchTreeError);
    expect(() => insert(null, "")).toThrow(SearchTreeError);
  });
});

describe("percurso em ordem", () => {
  it("devolve o alfabeto da mensagem ordenado", () => {
    expect(labelsOf(buildCharacterTree("arara come cacau"))).toEqual([
      "␣",
      "a",
      "c",
      "e",
      "m",
      "o",
      "r",
      "u",
    ]);
  });

  it("ordena por ponto de código, independentemente da chegada", () => {
    expect(labelsOf(buildCharacterTree("zyxw"))).toEqual(["w", "x", "y", "z"]);
  });
});

describe("busca", () => {
  it("caminha só pelos nós comparados", () => {
    const root = buildCharacterTree("dbfaceg");
    const { found, path } = searchPath(root, "a");

    expect(found).toBe(true);
    expect(path.map((node) => node.char)).toEqual(["d", "b", "a"]);
  });

  it("devolve o caminho percorrido mesmo quando não encontra", () => {
    const { found, path } = searchPath(buildCharacterTree("dbf"), "c");

    expect(found).toBe(false);
    expect(path.map((node) => node.char)).toEqual(["d", "b"]);
  });

  it("não encontra nada em árvore vazia", () => {
    expect(search(null, "a")).toBeNull();
    expect(searchPath(null, "a")).toEqual({ found: false, path: [] });
  });
});

describe("códigos do Huffman em cada nó", () => {
  it("usa o código canônico do códebook", () => {
    const node = search(buildCharacterTree("a"), "a");
    const symbol = "a".charCodeAt(0);

    expect(node.codes).toEqual([
      CODEBOOK.codes[symbol].toString(2).padStart(CODEBOOK.lengths[symbol], "0"),
    ]);
    expect(node.bits).toBe(CODEBOOK.lengths[symbol]);
  });

  it("dá um código por byte quando o caractere ocupa mais de um (D1)", () => {
    const node = search(buildCharacterTree("ç"), "ç");

    expect(node.bytes).toHaveLength(2);
    expect(node.codes).toHaveLength(2);
    expect(node.bits).toBe(node.codes[0].length + node.codes[1].length);
  });

  it("soma os bits de toda a mensagem", () => {
    const root = buildCharacterTree("aa");
    const bits = search(root, "a").bits;

    expect(totalBits(root)).toBe(bits * 2);
  });

  it("bate com o tamanho real produzido pelo encoder", () => {
    const text =
      "O relatório trimestral ficou pronto e segue em anexo para conferência. " +
      "Qualquer ajuste, me avise ainda hoje para revisarmos juntos amanhã.";
    const encoded = encode(text);
    const bits = totalBits(buildCharacterTree(text)) + CODEBOOK.lengths[EOF_SYMBOL];

    expect(encoded.compressed).toBe(true);
    expect(Math.ceil(bits / 8)).toBe(encoded.bytes.length);
  });
});

describe("posicionamento para desenho", () => {
  it("numera as colunas na ordem do percurso em ordem", () => {
    const { nodes } = layout(buildCharacterTree("bca"));

    expect(nodes.map((node) => node.label)).toEqual(["a", "b", "c"]);
    expect(nodes.map((node) => node.column)).toEqual([0, 1, 2]);
  });

  it("usa a profundidade do nó como linha", () => {
    const { nodes, depth } = layout(buildCharacterTree("bca"));
    const byLabel = Object.fromEntries(nodes.map((node) => [node.label, node]));

    expect(byLabel.b.depth).toBe(0);
    expect(byLabel.a.depth).toBe(1);
    expect(byLabel.c.depth).toBe(1);
    expect(depth).toBe(2);
  });

  it("aponta cada filho pelo índice do nó", () => {
    const { nodes } = layout(buildCharacterTree("bca"));
    const root = nodes.find((node) => node.label === "b");

    expect(nodes[root.left].label).toBe("a");
    expect(nodes[root.right].label).toBe("c");
  });

  it("texto já ordenado vira uma árvore degenerada, e o desenho mostra isso", () => {
    const { nodes, depth, columns } = layout(buildCharacterTree("abcde"));

    expect(columns).toBe(5);
    expect(depth).toBe(5);
    expect(nodes.every((node) => node.left === null)).toBe(true);
  });

  it("não quebra com árvore vazia", () => {
    expect(layout(null)).toEqual({ nodes: [], columns: 0, depth: 0 });
  });
});
