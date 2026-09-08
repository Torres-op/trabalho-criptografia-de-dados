import { requireSecureContext } from "./environment.js";
import {
  hasKeyPair,
  loadKeyPair,
  loadPeer,
  savePeer,
  saveKeyPairIfAbsent,
} from "./keystore.js";

export const CURVE = "P-256";
export const KEY_USAGES = Object.freeze(["deriveKey", "deriveBits"]);

export class KeyError extends Error {
  constructor(message) {
    super(message);
    this.name = "KeyError";
  }
}

export async function generateKeyPair() {
  requireSecureContext();
  return crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: CURVE },
    true,
    [...KEY_USAGES]
  );
}

let pending = null;

export async function ensureKeyPair() {
  if (!pending) {
    pending = resolveKeyPair().finally(() => {
      pending = null;
    });
  }
  return pending;
}

export function forgetPendingKeyPair() {
  pending = null;
}

async function resolveKeyPair() {
  requireSecureContext();

  const stored = await loadKeyPair();
  if (stored) {
    return { pair: stored, created: false };
  }

  const candidate = await generateKeyPair();
  const { pair, stored: wasStored } = await saveKeyPairIfAbsent(candidate);
  return { pair, created: wasStored };
}

export async function hasLocalKeyPair() {
  return hasKeyPair();
}

export async function loadPeerPublicKey() {
  const stored = await loadPeer();
  if (!stored) {
    return null;
  }
  return {
    publicKey: await importPublicKey(stored.jwk),
    localUsername: stored.localUsername,
    peerUsername: stored.peerUsername,
  };
}

export async function savePeerPublicKey({ jwk, localUsername, peerUsername }) {
  validatePublicJwk(jwk);
  await importPublicKey(jwk);
  await savePeer({ jwk, localUsername, peerUsername });
}

export async function exportPublicKey(publicKey) {
  const jwk = await crypto.subtle.exportKey("jwk", publicKey);
  return {
    kty: jwk.kty,
    crv: jwk.crv,
    x: jwk.x,
    y: jwk.y,
    ext: true,
    key_ops: [],
  };
}

export async function importPublicKey(jwk) {
  validatePublicJwk(jwk);
  try {
    return await crypto.subtle.importKey(
      "jwk",
      { ...jwk, key_ops: [], ext: true },
      { name: "ECDH", namedCurve: CURVE },
      true,
      []
    );
  } catch {
    throw new KeyError("A chave pública recebida é inválida.");
  }
}

export function validatePublicJwk(jwk) {
  if (jwk === null || typeof jwk !== "object") {
    throw new KeyError("A chave pública recebida é inválida.");
  }
  if (jwk.kty !== "EC") {
    throw new KeyError(`Tipo de chave não suportado: ${jwk.kty}. Esperado EC.`);
  }
  if (jwk.crv !== CURVE) {
    throw new KeyError(`Curva não suportada: ${jwk.crv}. Esperado ${CURVE}.`);
  }
  for (const field of ["x", "y"]) {
    if (typeof jwk[field] !== "string" || jwk[field].length === 0) {
      throw new KeyError(`A chave pública recebida não tem a coordenada ${field}.`);
    }
  }
  if ("d" in jwk) {
    throw new KeyError("O valor recebido é uma chave privada, não uma chave pública.");
  }
  return true;
}
