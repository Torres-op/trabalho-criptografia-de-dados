import { validatePublicJwk } from "./keys.js";

export const GROUPS = 12;
export const GROUP_SIZE = 4;

export function canonicalJwk(jwk) {
  validatePublicJwk(jwk);
  return JSON.stringify({ crv: jwk.crv, kty: jwk.kty, x: jwk.x, y: jwk.y });
}

export function formatDigest(digest) {
  const hex = [...digest].map((byte) => byte.toString(16).padStart(2, "0")).join("");
  const groups = hex.slice(0, GROUPS * GROUP_SIZE).match(new RegExp(`.{${GROUP_SIZE}}`, "g"));
  return groups.join(" ");
}

export async function fingerprintOf(jwk) {
  const canonical = new TextEncoder().encode(canonicalJwk(jwk));
  const digest = await crypto.subtle.digest("SHA-256", canonical);
  return formatDigest(new Uint8Array(digest));
}
