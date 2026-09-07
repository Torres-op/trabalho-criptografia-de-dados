export const FAKE_IMPLEMENTATION = true;

export function encode(text) {
  return { bytes: new TextEncoder().encode(text), compressed: false };
}

export function decode(bytes, compressed) {
  if (compressed) {
    throw new Error(
      "Arquivo comprimido com Huffman, mas o codec ainda não foi implementado (Épico 3)."
    );
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

export function stats(text) {
  const { bytes } = encode(text);
  const originalBytes = new TextEncoder().encode(text).length;
  const characters = [...text].length;
  return {
    characters,
    originalBytes,
    compressedBytes: bytes.length,
    ratio: originalBytes === 0 ? 1 : bytes.length / originalBytes,
    bitsPerChar: characters === 0 ? 0 : (bytes.length * 8) / characters,
  };
}
