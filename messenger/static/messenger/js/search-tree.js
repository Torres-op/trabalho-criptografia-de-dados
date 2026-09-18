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

export function countCharacters(text) {
  if (typeof text !== "string") {
    throw new SearchTreeError("A árvore só organiza texto.");
  }

  const counts = new Map();
  for (const char of text) {
    counts.set(char, (counts.get(char) ?? 0) + 1);
  }
  return counts;
}

export function entryFor(char, count, order = 0) {
  if (typeof char !== "string" || [...char].length !== 1) {
    throw new SearchTreeError("Cada nó guarda um caractere.");
  }
  if (!Number.isInteger(count) || count < 1) {
    throw new SearchTreeError("A contagem precisa ser um inteiro positivo.");
  }

  const code = char.codePointAt(0);
  return {
    char,
    label: LABELS[char] ?? char,
    code,
    count,
    order,
    value: code * count,
    left: null,
    right: null,
  };
}

export function entriesFor(text) {
  const entries = [];
  for (const [char, count] of countCharacters(text)) {
    entries.push(entryFor(char, count, entries.length));
  }
  return entries;
}

function compare(value, code, node) {
  if (value !== node.value) {
    return value < node.value ? -1 : 1;
  }
  if (code === null || code === node.code) {
    return 0;
  }
  return code < node.code ? -1 : 1;
}

export function insert(root, entry) {
  if (root === null) {
    return entry;
  }

  let current = root;
  for (;;) {
    const direction = compare(entry.value, entry.code, current);
    if (direction === 0) {
      throw new SearchTreeError(`O valor ${entry.value} já está na árvore.`);
    }

    const side = direction < 0 ? "left" : "right";
    if (current[side] === null) {
      current[side] = entry;
      return root;
    }
    current = current[side];
  }
}

export function buildCharacterTree(text) {
  let root = null;
  for (const entry of entriesFor(text)) {
    root = insert(root, entry);
  }
  return root;
}

export function searchPath(root, value, code = null) {
  if (!Number.isInteger(value)) {
    throw new SearchTreeError("A busca recebe um valor inteiro.");
  }

  const path = [];
  let current = root;

  while (current !== null) {
    path.push(current);
    const direction = compare(value, code, current);
    if (direction === 0) {
      return { found: true, path };
    }
    current = direction < 0 ? current.left : current.right;
  }

  return { found: false, path };
}

export function search(root, value, code = null) {
  const { found, path } = searchPath(root, value, code);
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

export function height(root) {
  let deepest = 0;
  const stack = root === null ? [] : [{ node: root, depth: 1 }];

  while (stack.length > 0) {
    const { node, depth } = stack.pop();
    deepest = Math.max(deepest, depth);
    for (const child of [node.left, node.right]) {
      if (child !== null) {
        stack.push({ node: child, depth: depth + 1 });
      }
    }
  }

  return deepest;
}

export function sharedValues(root) {
  const byValue = new Map();
  for (const node of inOrder(root)) {
    byValue.set(node.value, [...(byValue.get(node.value) ?? []), node]);
  }
  return [...byValue.values()].filter((nodes) => nodes.length > 1);
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
    code: node.code,
    count: node.count,
    value: node.value,
    order: node.order,
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
