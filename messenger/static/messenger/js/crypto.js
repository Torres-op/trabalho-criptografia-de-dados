import { IV_SIZE } from "./format.js";

export const HKDF_INFO = "treehash/v1/aes-gcm-256";
export const USERNAME_SEPARATOR = String.fromCharCode(0);
export const HKDF_HASH = "SHA-256";
export const AES_LENGTH = 256;
export const TAG_LENGTH = 16;

export class AuthenticationError extends Error {
  constructor(message) {
    super(message);
    this.name = "AuthenticationError";
  }
}

export class KeyError extends Error {
  constructor(message) {
    super(message);
    this.name = "KeyError";
  }
}

export function orderUsernames(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || b.length === 0) {
    throw new KeyError("Os dois nomes de usuário são obrigatórios para derivar a chave.");
  }
  if (a === b) {
    throw new KeyError("Os dois nomes de usuário não podem ser iguais.");
  }
  return a < b ? [a, b] : [b, a];
}

export async function deriveSalt(usernameA, usernameB) {
  const [first, second] = orderUsernames(usernameA, usernameB);
  const material = new TextEncoder().encode(first + USERNAME_SEPARATOR + second);
  return new Uint8Array(await crypto.subtle.digest(HKDF_HASH, material));
}

export async function deriveKey(privateKey, peerPublicKey, usernameA, usernameB) {
  requirePrivateKey(privateKey);
  requirePublicKey(peerPublicKey);

  const salt = await deriveSalt(usernameA, usernameB);
  const info = new TextEncoder().encode(HKDF_INFO);

  const secret = await crypto.subtle.deriveBits(
    { name: "ECDH", public: peerPublicKey },
    privateKey,
    AES_LENGTH
  );

  const hkdfKey = await crypto.subtle.importKey("raw", secret, "HKDF", false, [
    "deriveKey",
  ]);

  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: HKDF_HASH, salt, info },
    hkdfKey,
    { name: "AES-GCM", length: AES_LENGTH },
    false,
    ["encrypt", "decrypt"]
  );
}

export async function encrypt(bytes, aesKey, aad) {
  requireAesKey(aesKey);
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: aad },
    aesKey,
    bytes
  );
  return { iv, ciphertext: new Uint8Array(ciphertext) };
}

export async function decrypt(iv, ciphertext, aesKey, aad) {
  requireAesKey(aesKey);
  if (iv.length !== IV_SIZE) {
    throw new AuthenticationError("Arquivo corrompido: vetor de inicialização inválido.");
  }
  if (ciphertext.length < TAG_LENGTH) {
    throw new AuthenticationError("Arquivo corrompido: conteúdo menor que a assinatura.");
  }

  try {
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv, additionalData: aad },
      aesKey,
      ciphertext
    );
    return new Uint8Array(plaintext);
  } catch {
    throw new AuthenticationError("Arquivo adulterado ou chave incorreta.");
  }
}

export function requireAesKey(aesKey) {
  if (aesKey?.algorithm?.name !== "AES-GCM") {
    throw new KeyError("Ainda não foi feita a troca de chaves com o outro usuário.");
  }
}

function requirePrivateKey(key) {
  if (key?.type !== "private" || key?.algorithm?.name !== "ECDH") {
    throw new KeyError("Chave privada ECDH ausente ou inválida.");
  }
}

function requirePublicKey(key) {
  if (key?.type !== "public" || key?.algorithm?.name !== "ECDH") {
    throw new KeyError("Chave pública do outro usuário ausente ou inválida.");
  }
}
