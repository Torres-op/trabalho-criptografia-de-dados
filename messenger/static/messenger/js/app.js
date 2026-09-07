import * as cipher from "./crypto.js";
import * as format from "./format.js";
import * as huffman from "./huffman.js";

export const SENDER_ID = 0;

export function isFakeImplementation() {
  return Boolean(huffman.FAKE_IMPLEMENTATION || cipher.FAKE_IMPLEMENTATION);
}

export async function composeMessage(text, aesKey = null) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("Digite uma mensagem antes de gerar o arquivo.");
  }

  const createdAt = Date.now();
  const { bytes, compressed } = huffman.encode(text);
  const aad = format.buildAad({ senderId: SENDER_ID, createdAt, compressed });
  const { iv, ciphertext } = await cipher.encrypt(bytes, aesKey, aad);
  const file = format.pack({
    senderId: SENDER_ID,
    createdAt,
    compressed,
    iv,
    ciphertext,
  });

  const originalBytes = new TextEncoder().encode(text).length;

  return {
    file,
    createdAt,
    name: format.fileName(createdAt),
    stats: {
      characters: [...text].length,
      originalBytes,
      compressedBytes: bytes.length,
      fileBytes: file.length,
      compressed,
      compressionRatio: originalBytes === 0 ? 1 : bytes.length / originalBytes,
      fileRatio: originalBytes === 0 ? 1 : file.length / originalBytes,
    },
  };
}

export async function readMessage(file, aesKey = null) {
  const header = format.unpack(file);
  const bytes = await cipher.decrypt(
    header.iv,
    header.ciphertext,
    aesKey,
    header.aad
  );
  const text = huffman.decode(bytes, header.compressed);

  return {
    text,
    createdAt: header.createdAt,
    senderId: header.senderId,
    compressed: header.compressed,
    fileBytes: file.length,
  };
}
