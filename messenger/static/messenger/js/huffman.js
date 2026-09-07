import { EOF_SYMBOL } from "./frequency-table.js";
import { CODEBOOK } from "./huffman-codebook.js";

export class HuffmanError extends Error {
  constructor(message) {
    super(message);
    this.name = "HuffmanError";
  }
}

export function encode(text) {
  const utf8 = new TextEncoder().encode(text);
  const packed = compress(utf8);

  if (packed.length >= utf8.length) {
    return { bytes: utf8, compressed: false };
  }
  return { bytes: packed, compressed: true };
}

export function decode(bytes, compressed) {
  const utf8 = compressed ? decompress(bytes) : bytes;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(utf8);
  } catch {
    throw new HuffmanError("O conteúdo decifrado não é um texto válido.");
  }
}

export function stats(text) {
  const originalBytes = new TextEncoder().encode(text).length;
  const characters = [...text].length;
  const { bytes, compressed } = encode(text);

  return {
    characters,
    originalBytes,
    compressedBytes: bytes.length,
    compressed,
    ratio: originalBytes === 0 ? 1 : bytes.length / originalBytes,
    bitsPerChar: characters === 0 ? 0 : (bytes.length * 8) / characters,
  };
}

function compress(utf8) {
  const { lengths, codes } = CODEBOOK;

  let totalBits = lengths[EOF_SYMBOL];
  for (const byte of utf8) {
    totalBits += lengths[byte];
  }

  const out = new Uint8Array(Math.ceil(totalBits / 8));
  let accumulator = 0;
  let pending = 0;
  let position = 0;

  const emit = (code, length) => {
    accumulator = accumulator * 2 ** length + code;
    pending += length;
    while (pending >= 8) {
      pending -= 8;
      const chunk = 2 ** pending;
      out[position++] = Math.floor(accumulator / chunk);
      accumulator %= chunk;
    }
  };

  for (const byte of utf8) {
    emit(codes[byte], lengths[byte]);
  }
  emit(codes[EOF_SYMBOL], lengths[EOF_SYMBOL]);

  if (pending > 0) {
    out[position] = accumulator * 2 ** (8 - pending);
  }

  return out;
}

function decompress(bytes) {
  const {
    countByLength,
    firstCode,
    firstIndex,
    symbolsInCanonicalOrder,
    minLength,
    maxLength,
  } = CODEBOOK;

  const out = new Uint8Array(Math.ceil((bytes.length * 8) / minLength));
  let written = 0;
  let code = 0;
  let length = 0;

  for (let i = 0; i < bytes.length; i++) {
    const byte = bytes[i];
    for (let bit = 7; bit >= 0; bit--) {
      code = code * 2 + ((byte >> bit) & 1);
      length += 1;

      if (length > maxLength) {
        throw new HuffmanError("Arquivo corrompido: sequência de bits inválida.");
      }
      if (countByLength[length] === 0) {
        continue;
      }

      const offset = code - firstCode[length];
      if (offset < 0 || offset >= countByLength[length]) {
        continue;
      }

      const symbol = symbolsInCanonicalOrder[firstIndex[length] + offset];
      if (symbol === EOF_SYMBOL) {
        return out.subarray(0, written);
      }

      out[written++] = symbol;
      code = 0;
      length = 0;
    }
  }

  throw new HuffmanError(
    "Arquivo truncado — o download ou a cópia pode ter sido interrompida."
  );
}
