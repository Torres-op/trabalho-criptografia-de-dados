import { IV_SIZE } from "./format.js";

export const FAKE_IMPLEMENTATION = true;

const XOR_KEY = 0x5a;

export class AuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export async function deriveKey() {
  return null;
}

export async function encrypt(bytes, aesKey, aad) {
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
  const ciphertext = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    ciphertext[i] = bytes[i] ^ XOR_KEY;
  }
  return { iv, ciphertext };
}

export async function decrypt(iv, ciphertext, aesKey, aad) {
  if (iv.length !== IV_SIZE) {
    throw new AuthenticationError("IV com tamanho inválido.");
  }
  const bytes = new Uint8Array(ciphertext.length);
  for (let i = 0; i < ciphertext.length; i++) {
    bytes[i] = ciphertext[i] ^ XOR_KEY;
  }
  return bytes;
}
