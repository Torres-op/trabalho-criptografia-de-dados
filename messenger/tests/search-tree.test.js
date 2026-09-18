import { describe, expect, it } from "vitest";

import {
  SearchTreeError,
  buildCharacterTree,
  countCharacters,
  entriesFor,
  entryFor,
  height,
  inOrder,
  insert,
  layout,
  search,
  searchPath,
  sharedValues,
} from "../messenger/static/messenger/js/search-tree.js";

const valuesOf = (root) => inOrder(root).map((node) => node.value);
const labelsOf = (root) => inOrder(root).map((node) => node.label);

describe("contagem dos caracteres", () => {
  it("conta cada caractere distinto", () => {
    expect([...countCharacters("arara")]).toEqual([
      ["a", 3],
      ["r", 2],
    ]);
  });

  it("preserva a ordem de primeira aparição", () => {
    expect([...countCharacters("zaz").keys()]).toEqual(["z", "a"]);
  });

  it("recusa entrada que não é texto", () => {
    expect(() => countCharacters(null)).toThrow(SearchTreeError);
  });
});

describe("valor de cada nó", () => {
  it("multiplica o código do caractere pela quantidade", () => {
    expect(entryFor("a", 3).value).toBe(97 * 3);
    expect(entryFor("A", 1).value).toBe(65);
  });

  it("guarda o caractere, o código e a contagem", () => {
    const entry = entryFor("r", 2);

    expect(entry.char).toBe("r");
    expect(entry.code).toBe(114);
    expect(entry.count).toBe(2);
  });

  it("mostra espaço e quebra de linha com um símbolo visível", () => {
    expect(entryFor(" ", 1).label).toBe("␣");
    expect(entryFor("\n", 1).label).toBe("⏎");
    expect(entryFor("\t", 1).label).toBe("⇥");
  });

  it("usa o ponto de código para caracteres fora do ASCII", () => {
    expect(entryFor("ç", 2).value).toBe(231 * 2);
  });

  it("recusa contagem inválida e mais de um caractere", () => {
    expect(() => entryFor("ab", 1)).toThrow(SearchTreeError);
    expect(() => entryFor("a", 0)).toThrow(SearchTreeError);
    expect(() => entryFor("a", 1.5)).toThrow(SearchTreeError);
  });
});

describe("montagem da árvore", () => {
  it("devolve árvore vazia para texto vazio", () => {
    expect(buildCharacterTree("")).toBeNull();
  });

  it("usa o primeiro caractere da mensagem como raiz", () => {
    const root = buildCharacterTree("arara");

    expect(root.char).toBe("a");
    expect(root.value).toBe(291);
    expect(root.left.char).toBe("r");
    expect(root.left.value).toBe(228);
  });

  it("organiza os valores à esquerda e à direita da raiz", () => {
    const root = buildCharacterTree("bac");

    expect(root.value).toBe(98);
    expect(root.left.value).toBe(97);
    expect(root.right.value).toBe(99);
  });

  it("é remontada do zero a cada mensagem, porque o valor depende da contagem", () => {
    expect(buildCharacterTree("a").value).toBe(97);
    expect(buildCharacterTree("aa").value).toBe(194);
    expect(buildCharacterTree("aaa").value).toBe(291);
  });

  it("recusa inserir duas vezes o mesmo valor e caractere", () => {
    const root = buildCharacterTree("a");

    expect(() => insert(root, entryFor("a", 1))).toThrow(SearchTreeError);
    expect(() => insert(root, entryFor("a", 1))).toThrow(/já está na árvore/);
  });
});

describe("empate de valores", () => {
  it("dois caracteres podem cair no mesmo valor", () => {
    const root = buildCharacterTree("  @");

    expect(root.value).toBe(64);
    expect(root.right.value).toBe(64);
    expect(labelsOf(root)).toEqual(["␣", "@"]);
  });

  it("desempata pelo código, mantendo a árvore determinística", () => {
    expect(labelsOf(buildCharacterTree("  @"))).toEqual(labelsOf(buildCharacterTree("@  ")));
  });

  it("aponta quais caracteres empataram", () => {
    const groups = sharedValues(buildCharacterTree("  @"));

    expect(groups).toHaveLength(1);
    expect(groups[0].map((node) => node.label)).toEqual(["␣", "@"]);
    expect(sharedValues(buildCharacterTree("arara"))).toEqual([]);
  });
});

describe("percurso em ordem", () => {
  it("devolve os valores em ordem crescente", () => {
    expect(valuesOf(buildCharacterTree("arara come cacau"))).toEqual(
      [...valuesOf(buildCharacterTree("arara come cacau"))].sort((a, b) => a - b)
    );
  });

  it("não depende da ordem em que os caracteres chegaram", () => {
    expect(valuesOf(buildCharacterTree("cba"))).toEqual([97, 98, 99]);
    expect(valuesOf(buildCharacterTree("abc"))).toEqual([97, 98, 99]);
  });
});

describe("busca", () => {
  it("caminha só pelos nós comparados", () => {
    const { found, path } = searchPath(buildCharacterTree("bac"), 97);

    expect(found).toBe(true);
    expect(path.map((node) => node.value)).toEqual([98, 97]);
  });

  it("encontra o caractere certo quando dois valores empatam", () => {
    const root = buildCharacterTree("  @");

    expect(search(root, 64, 32).char).toBe(" ");
    expect(search(root, 64, 64).char).toBe("@");
  });

  it("devolve o caminho percorrido mesmo quando não encontra", () => {
    const { found, path } = searchPath(buildCharacterTree("bac"), 200);

    expect(found).toBe(false);
    expect(path.map((node) => node.value)).toEqual([98, 99]);
  });

  it("não encontra nada em árvore vazia", () => {
    expect(search(null, 97)).toBeNull();
    expect(searchPath(null, 97)).toEqual({ found: false, path: [] });
  });

  it("recusa busca por algo que não é valor inteiro", () => {
    expect(() => searchPath(buildCharacterTree("a"), "a")).toThrow(SearchTreeError);
  });
});

describe("altura", () => {
  it("conta os níveis da árvore", () => {
    expect(height(null)).toBe(0);
    expect(height(buildCharacterTree("a"))).toBe(1);
    expect(height(buildCharacterTree("bac"))).toBe(2);
    expect(height(buildCharacterTree("abc"))).toBe(3);
  });
});

describe("posicionamento para desenho", () => {
  it("numera as colunas na ordem do percurso em ordem", () => {
    const { nodes } = layout(buildCharacterTree("bac"));

    expect(nodes.map((node) => node.value)).toEqual([97, 98, 99]);
    expect(nodes.map((node) => node.column)).toEqual([0, 1, 2]);
  });

  it("usa a profundidade do nó como linha", () => {
    const { nodes, depth } = layout(buildCharacterTree("bac"));
    const root = nodes.find((node) => node.value === 98);

    expect(root.depth).toBe(0);
    expect(nodes[root.left].depth).toBe(1);
    expect(nodes[root.right].depth).toBe(1);
    expect(depth).toBe(2);
  });

  it("valores já crescentes viram uma árvore degenerada, e o desenho mostra isso", () => {
    const { nodes, columns, depth } = layout(buildCharacterTree("abc"));

    expect(columns).toBe(3);
    expect(depth).toBe(3);
    expect(nodes.every((node) => node.left === null)).toBe(true);
  });

  it("leva caractere, código, contagem e valor para o desenho", () => {
    const [node] = layout(buildCharacterTree("aa")).nodes;

    expect(node).toMatchObject({ char: "a", label: "a", code: 97, count: 2, value: 194 });
  });

  it("não quebra com árvore vazia", () => {
    expect(layout(null)).toEqual({ nodes: [], columns: 0, depth: 0 });
  });
});

describe("ordem de inserção", () => {
  it("numera as entradas pela ordem de primeira aparição", () => {
    expect(entriesFor("bacab").map((entry) => [entry.char, entry.order, entry.count])).toEqual([
      ["b", 0, 2],
      ["a", 1, 2],
      ["c", 2, 1],
    ]);
  });

  it("devolve entradas novas a cada chamada, para a árvore ser remontada do zero", () => {
    expect(entriesFor("ab")[0]).not.toBe(entriesFor("ab")[0]);
  });

  it("leva a ordem de inserção até o desenho", () => {
    const { nodes } = layout(buildCharacterTree("bac"));

    expect(nodes.map((node) => node.order)).toEqual([1, 0, 2]);
  });
});
