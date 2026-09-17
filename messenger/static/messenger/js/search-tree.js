import { CODEBOOK } from "./huffman-codebook.js";

export class SearchTreeError extends Error {
  constructor(message) {
    super(message);
    this.name = "SearchTreeError";
  }
}

const LABELS = Object.freeze({
  " ": "␣",
  "\n": "⏎",
  "\r": "⏎",
  "\t": "⇥",
});

const encoder = new TextEncoder();

function codeOf(byte) {
  return CODEBOOK.codes[byte].toString(2).padStart(CODEBOOK.lengths[byte], "0");
}

function createNode(char) {
  const bytes = [...encoder.encode(char)];
  const codes = bytes.map(codeOf);

  return {
    char,
    label: LABELS[char] ?? char,
    codePoint: char.codePointAt(0),
    bytes,
    codes,
    bits: codes.reduce((total, code) => total + code.length, 0),
    count: 1,
    left: null,
    right: null,
  };
}

export function insert(root, char) {
  if (typeof char !== "string" || [...char].length !== 1) {
    throw new SearchTreeError("A árvore recebe um caractere por vez.");
  }

  if (root === null) {
    return createNode(char);
  }

  const codePoint = char.codePointAt(0);
  let current = root;

  for (;;) {
    if (codePoint === current.codePoint) {
      current.count += 1;
      return root;
    }

    const side = codePoint < current.codePoint ? "left" : "right";
    if (current[side] === null) {
      current[side] = createNode(char);
      return root;
    }
    current = current[side];
  }
}

export function buildCharacterTree(text) {
  if (typeof text !== "string") {
    throw new SearchTreeError("A árvore só organiza texto.");
  }

  let root = null;
  for (const char of text) {
    root = insert(root, char);
  }
  return root;
}

export function searchPath(root, char) {
  if (typeof char !== "string" || [...char].length !== 1) {
    throw new SearchTreeError("A busca recebe um caractere por vez.");
  }

  const codePoint = char.codePointAt(0);
  const path = [];
  let current = root;

  while (current !== null) {
    path.push(current);
    if (codePoint === current.codePoint) {
      return { found: true, path };
    }
    current = codePoint < current.codePoint ? current.left : current.right;
  }

  return { found: false, path };
}

export function search(root, char) {
  const { found, path } = searchPath(root, char);
  return found ? path[path.length - 1] : null;
}

export function inOrder(root) {
  const nodes = [];
  const stack = [];
  let current = root;

  while (current !== null || stack.length > 0) {
    while (current !== null) {
      stack.push(current);
      current = current.left;
    }
    current = stack.pop();
    nodes.push(current);
    current = current.right;
  }

  return nodes;
}

export function totalBits(root) {
  return inOrder(root).reduce((total, node) => total + node.bits * node.count, 0);
}

export function layout(root) {
  const items = [];
  const positions = new Map();
  const stack = [];
  let current = root;
  let depth = 0;

  while (current !== null || stack.length > 0) {
    while (current !== null) {
      stack.push({ node: current, depth });
      current = current.left;
      depth += 1;
    }
    const { node, depth: nodeDepth } = stack.pop();
    positions.set(node, items.length);
    items.push({ node, column: items.length, depth: nodeDepth });
    current = node.right;
    depth = nodeDepth + 1;
  }

  const nodes = items.map(({ node, column, depth: nodeDepth }) => ({
    char: node.char,
    label: node.label,
    count: node.count,
    codes: node.codes,
    bits: node.bits,
    column,
    depth: nodeDepth,
    left: node.left === null ? null : positions.get(node.left),
    right: node.right === null ? null : positions.get(node.right),
  }));

  return {
    nodes,
    columns: nodes.length,
    depth: nodes.reduce((deepest, node) => Math.max(deepest, node.depth + 1), 0),
  };
}
