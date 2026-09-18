import { describe, expect, it } from "vitest";

import {
  canonicalJwk,
  fingerprintOf,
  formatDigest,
} from "../messenger/static/messenger/js/fingerprint.js";
import { KeyError } from "../messenger/static/messenger/js/keys.js";

const JWK_A = {
  kty: "EC",
  crv: "P-256",
  x: "f83OJ3D2xF1Bg8vub9tD2VqV6uNRnCVvzOgOb5m7Vfs",
  y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
};

const JWK_B = {
  kty: "EC",
  crv: "P-256",
  x: "MKBCTNIcKUSDii11ySs3526iDZ8AiTo7Tu6KPAqv7D4",
  y: "4Etl6SRW2YiLUrN5vfvVHuhp7x8PxltmWWlbbM4IFyM",
};

const FINGERPRINT_A = "e7fd 7e75 f50a 36ce 60fe 0e9e 08e4 adda f9f3 cd8b dbdb 6f8d";

describe("forma canônica da chave", () => {
  it("usa a mesma ordem e o mesmo formato compacto do servidor", () => {
    expect(canonicalJwk(JWK_A)).toBe(
      '{"crv":"P-256","kty":"EC",' +
        '"x":"f83OJ3D2xF1Bg8vub9tD2VqV6uNRnCVvzOgOb5m7Vfs",' +
        '"y":"x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0"}'
    );
  });

  it("não depende da ordem em que as chaves chegam", () => {
    const embaralhada = { y: JWK_A.y, kty: "EC", x: JWK_A.x, crv: "P-256" };

    expect(canonicalJwk(embaralhada)).toBe(canonicalJwk(JWK_A));
  });

  it("recusa chave privada e entrada inválida", () => {
    expect(() => canonicalJwk({ ...JWK_A, d: "segredo" })).toThrow(KeyError);
    expect(() => canonicalJwk(null)).toThrow(KeyError);
  });
});

describe("fingerprint (11.1)", () => {
  it("bate com o valor fixado, que o servidor também calcula", async () => {
    expect(await fingerprintOf(JWK_A)).toBe(FINGERPRINT_A);
  });

  it("são 12 grupos de 4 dígitos hexadecimais", async () => {
    expect(await fingerprintOf(JWK_B)).toMatch(/^([0-9a-f]{4} ){11}[0-9a-f]{4}$/);
  });

  it("chaves diferentes dão fingerprints diferentes", async () => {
    expect(await fingerprintOf(JWK_A)).not.toBe(await fingerprintOf(JWK_B));
  });

  it("a mesma chave dá sempre o mesmo fingerprint", async () => {
    expect(await fingerprintOf(JWK_A)).toBe(await fingerprintOf({ ...JWK_A }));
  });

  it("agrupa os bytes de quatro em quatro", () => {
    expect(formatDigest(new Uint8Array(32).fill(0xab))).toBe(
      "abab abab abab abab abab abab abab abab abab abab abab abab"
    );
  });
});
