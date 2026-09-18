import { CURVE, KEY_USAGES, importPublicKey } from "./keys.js";

export class KeyBackupError extends Error {
  constructor(message) {
    super(message);
    this.name = "KeyBackupError";
  }
}

export const MAGIC = Object.freeze([0x54, 0x4b, 0x45, 0x59]);
export const VERSION = 0x01;
export const ITERATIONS = 600000;
export const MAX_ITERATIONS = 2000000;
export const SALT_SIZE = 16;
export const IV_SIZE = 12;
export const AAD_SIZE = 25;
export const HEADER_SIZE = 37;
export const EXTENSION = ".treehashkey";

function requirePassword(password) {
  if (typeof password !== "string" || password.length === 0) {
    throw new KeyBackupError("Digite a senha de backup.");
  }
}

async function deriveBackupKey(password, salt, iterations) {
  requirePassword(password);
  const material = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt, iterations, hash: "SHA-256" },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"]
  );
}

export function backupFileName(username, when = Date.now()) {
  const date = new Date(when);
  const pad = (value) => String(value).padStart(2, "0");
  const stamp = `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  return `chave-${username}-${stamp}${EXTENSION}`;
}

export async function packBackup(privateKey, password) {
  requirePassword(password);

  let jwk;
  try {
    jwk = await crypto.subtle.exportKey("jwk", privateKey);
  } catch {
    throw new KeyBackupError("Esta chave privada não pode ser exportada para backup.");
  }

  const salt = crypto.getRandomValues(new Uint8Array(SALT_SIZE));
  const iv = crypto.getRandomValues(new Uint8Array(IV_SIZE));
  const header = new Uint8Array(HEADER_SIZE);
  const view = new DataView(header.buffer);

  header.set(MAGIC, 0);
  header[4] = VERSION;
  view.setUint32(5, ITERATIONS, false);
  header.set(salt, 9);
  header.set(iv, AAD_SIZE);

  const key = await deriveBackupKey(password, salt, ITERATIONS);
  const plain = new TextEncoder().encode(
    JSON.stringify({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y, d: jwk.d })
  );
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv, additionalData: header.subarray(0, AAD_SIZE) },
      key,
      plain
    )
  );

  const file = new Uint8Array(HEADER_SIZE + ciphertext.length);
  file.set(header, 0);
  file.set(ciphertext, HEADER_SIZE);
  return file;
}

export function readHeader(bytes) {
  if (!(bytes instanceof Uint8Array) || bytes.length <= HEADER_SIZE) {
    throw new KeyBackupError("Arquivo de backup incompleto.");
  }
  for (let index = 0; index < MAGIC.length; index += 1) {
    if (bytes[index] !== MAGIC[index]) {
      throw new KeyBackupError("Este arquivo não é um backup de chave do Treehash.");
    }
  }

  const version = bytes[4];
  if (version !== VERSION) {
    throw new KeyBackupError(`Backup gerado por outra versão do app (versão ${version}).`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const iterations = view.getUint32(5, false);
  if (iterations < 1 || iterations > MAX_ITERATIONS) {
    throw new KeyBackupError("Arquivo de backup corrompido: número de iterações fora da faixa.");
  }

  return {
    version,
    iterations,
    salt: bytes.slice(9, AAD_SIZE),
    iv: bytes.slice(AAD_SIZE, HEADER_SIZE),
    ciphertext: bytes.slice(HEADER_SIZE),
    aad: bytes.slice(0, AAD_SIZE),
  };
}

export async function openBackup(bytes, password) {
  const header = readHeader(bytes);
  const key = await deriveBackupKey(password, header.salt, header.iterations);

  let plain;
  try {
    plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: header.iv, additionalData: header.aad },
      key,
      header.ciphertext
    );
  } catch {
    throw new KeyBackupError("Senha incorreta ou arquivo corrompido.");
  }

  try {
    return JSON.parse(new TextDecoder().decode(plain));
  } catch {
    throw new KeyBackupError("Senha incorreta ou arquivo corrompido.");
  }
}

export async function keyPairFrom(jwk) {
  const members = { kty: jwk?.kty, crv: jwk?.crv, x: jwk?.x, y: jwk?.y };
  if (typeof jwk?.d !== "string" || jwk.d.length === 0) {
    throw new KeyBackupError("O backup não contém uma chave privada.");
  }

  let privateKey;
  try {
    privateKey = await crypto.subtle.importKey(
      "jwk",
      { ...members, d: jwk.d, ext: true, key_ops: [...KEY_USAGES] },
      { name: "ECDH", namedCurve: CURVE },
      true,
      KEY_USAGES
    );
  } catch {
    throw new KeyBackupError("A chave guardada no backup é inválida.");
  }

  return { privateKey, publicKey: await importPublicKey(members) };
}
