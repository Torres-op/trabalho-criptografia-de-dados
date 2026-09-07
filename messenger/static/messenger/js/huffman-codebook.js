import { ALPHABET_SIZE, FREQUENCY_TABLE } from "./frequency-table.js";

export const MAX_CODE_LENGTH = 32;

export class CodebookError extends Error {
  constructor(message) {
    super(message);
    this.name = "CodebookError";
  }
}

class MinHeap {
  constructor() {
    this.items = [];
  }

  get size() {
    return this.items.length;
  }

  push(item) {
    const items = this.items;
    items.push(item);
    let i = items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (precedes(items[i], items[parent])) {
        [items[i], items[parent]] = [items[parent], items[i]];
        i = parent;
      } else {
        break;
      }
    }
  }

  pop() {
    const items = this.items;
    const top = items[0];
    const last = items.pop();
    if (items.length > 0) {
      items[0] = last;
      let i = 0;
      for (;;) {
        const left = 2 * i + 1;
        const right = left + 1;
        let smallest = i;
        if (left < items.length && precedes(items[left], items[smallest])) smallest = left;
        if (right < items.length && precedes(items[right], items[smallest])) smallest = right;
        if (smallest === i) break;
        [items[i], items[smallest]] = [items[smallest], items[i]];
        i = smallest;
      }
    }
    return top;
  }
}

function precedes(a, b) {
  if (a.weight !== b.weight) return a.weight < b.weight;
  return a.tieKey < b.tieKey;
}

function measureCodeLengths(frequencies) {
  const heap = new MinHeap();
  for (let symbol = 0; symbol < frequencies.length; symbol++) {
    heap.push({ weight: frequencies[symbol], tieKey: symbol, symbol, left: null, right: null });
  }

  while (heap.size > 1) {
    const left = heap.pop();
    const right = heap.pop();
    heap.push({
      weight: left.weight + right.weight,
      tieKey: Math.min(left.tieKey, right.tieKey),
      symbol: -1,
      left,
      right,
    });
  }

  const lengths = new Uint8Array(frequencies.length);
  const stack = [{ node: heap.pop(), depth: 0 }];

  while (stack.length > 0) {
    const { node, depth } = stack.pop();
    if (node.symbol >= 0) {
      lengths[node.symbol] = Math.max(depth, 1);
    } else {
      stack.push({ node: node.left, depth: depth + 1 });
      stack.push({ node: node.right, depth: depth + 1 });
    }
  }

  return lengths;
}

function assignCanonicalCodes(lengths) {
  const order = [...lengths.keys()].sort(
    (a, b) => lengths[a] - lengths[b] || a - b
  );

  const codes = new Uint32Array(lengths.length);
  let code = 0;
  let previousLength = lengths[order[0]];

  for (const symbol of order) {
    code *= 2 ** (lengths[symbol] - previousLength);
    codes[symbol] = code;
    code += 1;
    previousLength = lengths[symbol];
  }

  return { codes, order };
}

function buildDecodeIndex(lengths, codes, order) {
  const maxLength = Math.max(...lengths);
  const countByLength = new Uint32Array(maxLength + 1);
  const firstCode = new Uint32Array(maxLength + 1);
  const firstIndex = new Int32Array(maxLength + 1).fill(-1);

  for (const length of lengths) {
    countByLength[length] += 1;
  }

  for (let i = 0; i < order.length; i++) {
    const length = lengths[order[i]];
    if (firstIndex[length] === -1) {
      firstIndex[length] = i;
      firstCode[length] = codes[order[i]];
    }
  }

  return { maxLength, countByLength, firstCode, firstIndex };
}

export function buildCodebook(frequencies) {
  if (frequencies.length !== ALPHABET_SIZE) {
    throw new CodebookError(
      `A tabela precisa ter ${ALPHABET_SIZE} entradas, recebeu ${frequencies.length}.`
    );
  }
  for (let symbol = 0; symbol < frequencies.length; symbol++) {
    if (!(frequencies[symbol] >= 1)) {
      throw new CodebookError(
        `Frequência inválida no símbolo ${symbol}: ${frequencies[symbol]}. O mínimo é 1.`
      );
    }
  }

  const lengths = measureCodeLengths(frequencies);
  const maxLength = Math.max(...lengths);
  if (maxLength > MAX_CODE_LENGTH) {
    throw new CodebookError(
      `Código de ${maxLength} bits excede o limite de ${MAX_CODE_LENGTH}.`
    );
  }

  const { codes, order } = assignCanonicalCodes(lengths);
  const index = buildDecodeIndex(lengths, codes, order);

  return Object.freeze({
    lengths,
    codes,
    symbolsInCanonicalOrder: Int32Array.from(order),
    minLength: lengths[order[0]],
    ...index,
  });
}

export const CODEBOOK = buildCodebook(FREQUENCY_TABLE);
