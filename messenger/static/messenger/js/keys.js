import { requireSecureContext } from "./environment.js";
import {
  hasKeyPair,
  loadKeyPair,
  loadPeer,
  saveKeyPairIfAbsent,
  savePeer,
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
  return crypto.subtle.generateKey({ name: "ECDH", namedCurve: CURVE }, true, [...KEY_USAGES]);
}

const pending = new Map();

export function ensureKeyPair(owner) {
  if (!pending.has(owner)) {
    const promise = resolveKeyPair(owner).finally(() => {
      if (pending.get(owner) === promise) {
        pending.delete(owner);
      }
    });
    pending.set(owner, promise);
  }
  return pending.get(owner);
}

export function forgetPendingKeyPair() {
  pending.clear();
}

async function resolveKeyPair(owner) {
  requireSecureContext();

  const stored = await loadKeyPair(owner);
  if (stored) {
    return { pair: stored, created: false };
  }

  const candidate = await generateKeyPair();
  const { pair, stored: wasStored } = await saveKeyPairIfAbsent(owner, candidate);
  return { pair, created: wasStored };
}

export async function hasLocalKeyPair(owner) {
  return hasKeyPair(owner);
}

export async function loadPeerPublicKey(owner) {
  const stored = await loadPeer(owner);
  if (!stored) {
    return null;
  }
  return {
    publicKey: await importPublicKey(stored.jwk),
    jwk: stored.jwk,
    peerUsername: stored.peerUsername,
  };
}

export async function savePeerPublicKey(owner, { jwk, peerUsername }) {
  validatePublicJwk(jwk);
  await importPublicKey(jwk);
  await savePeer(owner, { jwk: publicMembers(jwk), peerUsername });
}

export function samePublicKey(a, b) {
  return (
    Boolean(a && b) && a.kty === b.kty && a.crv === b.crv && a.x === b.x && a.y === b.y
  );
}

function publicMembers(jwk) {
  return { kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y };
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
      { ...publicMembers(jwk), key_ops: [], ext: true },
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
