import { afterEach, describe, expect, it } from "vitest";

import {
  CURVE,
  KEY_USAGES,
  KeyError,
  ensureKeyPair,
  exportPublicKey,
  generateKeyPair,
  hasLocalKeyPair,
  importPublicKey,
  validatePublicJwk,
} from "../messenger/static/messenger/js/keys.js";
import {
  DATABASE_NAME,
  closeDatabase,
} from "../messenger/static/messenger/js/keystore.js";

function limparBanco() {
  closeDatabase();
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = resolve;
    request.onerror = resolve;
    request.onblocked = resolve;
  });
}

afterEach(limparBanco);

describe("geração do par ECDH (4.1)", () => {
  it("usa a curva P-256 e os usos previstos em D4", async () => {
    const par = await generateKeyPair();

    expect(par.privateKey.algorithm.name).toBe("ECDH");
    expect(par.privateKey.algorithm.namedCurve).toBe(CURVE);
    expect([...par.privateKey.usages].sort()).toEqual([...KEY_USAGES].sort());
    expect(par.publicKey.type).toBe("public");
  });

  it("marca a chave privada como extraível, para permitir backup", async () => {
    const par = await generateKeyPair();
    expect(par.privateKey.extractable).toBe(true);
  });

  it("gera um par diferente a cada chamada", async () => {
    const [a, b] = await Promise.all([generateKeyPair(), generateKeyPair()]);
    const [ja, jb] = await Promise.all([
      crypto.subtle.exportKey("jwk", a.publicKey),
      crypto.subtle.exportKey("jwk", b.publicKey),
    ]);
    expect(ja.x).not.toBe(jb.x);
  });
});

describe("ensureKeyPair", () => {
  it("gera no primeiro acesso", async () => {
    expect(await hasLocalKeyPair()).toBe(false);

    const { pair, created } = await ensureKeyPair();
    expect(created).toBe(true);
    expect(pair.privateKey.type).toBe("private");
    expect(await hasLocalKeyPair()).toBe(true);
  });

  it("reutiliza o mesmo par nos acessos seguintes", async () => {
    const primeiro = await ensureKeyPair();
    closeDatabase();
    const segundo = await ensureKeyPair();

    expect(primeiro.created).toBe(true);
    expect(segundo.created).toBe(false);

    const [a, b] = await Promise.all([
      exportPublicKey(primeiro.pair.publicKey),
      exportPublicKey(segundo.pair.publicKey),
    ]);
    expect(b).toEqual(a);
  });

  it("mantém a chave utilizável depois de recarregar", async () => {
    const { pair } = await ensureKeyPair();
    closeDatabase();

    const { pair: recarregado } = await ensureKeyPair();
    const bits = await crypto.subtle.deriveBits(
      { name: "ECDH", public: pair.publicKey },
      recarregado.privateKey,
      256
    );
    expect(bits.byteLength).toBe(32);
  });
});

describe("exportação e importação da chave pública", () => {
  it("exporta apenas os campos públicos da JWK", async () => {
    const par = await generateKeyPair();
    const jwk = await exportPublicKey(par.publicKey);

    expect(jwk.kty).toBe("EC");
    expect(jwk.crv).toBe(CURVE);
    expect(typeof jwk.x).toBe("string");
    expect(typeof jwk.y).toBe("string");
    expect(jwk).not.toHaveProperty("d");
    expect(Object.keys(jwk).sort()).toEqual(["crv", "ext", "key_ops", "kty", "x", "y"]);
  });

  it("faz round-trip export → import preservando as coordenadas", async () => {
    const par = await generateKeyPair();
    const jwk = await exportPublicKey(par.publicKey);
    const importada = await importPublicKey(jwk);

    expect(await exportPublicKey(importada)).toEqual(jwk);
  });

  it("permite derivar com a chave importada", async () => {
    const alice = await generateKeyPair();
    const bob = await generateKeyPair();
    const publicaDoBob = await importPublicKey(await exportPublicKey(bob.publicKey));

    const bits = await crypto.subtle.deriveBits(
      { name: "ECDH", public: publicaDoBob },
      alice.privateKey,
      256
    );
    expect(bits.byteLength).toBe(32);
  });
});

describe("validação da JWK recebida", () => {
  const jwkValida = {
    kty: "EC",
    crv: "P-256",
    x: "f83OJ3D2xF1Bg8vub9tD2VqV6uNRnCVvzOgOb5m7Vfs",
    y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
  };

  it("aceita uma JWK bem formada", () => {
    expect(validatePublicJwk(jwkValida)).toBe(true);
  });

  it("recusa uma chave privada disfarçada de pública", async () => {
    const comD = { ...jwkValida, d: "qualquer-coisa" };
    expect(() => validatePublicJwk(comD)).toThrow(/chave privada/);
    await expect(importPublicKey(comD)).rejects.toThrow(KeyError);
  });

  it("recusa curva diferente de P-256", () => {
    expect(() => validatePublicJwk({ ...jwkValida, crv: "P-384" })).toThrow(/Curva/);
  });

  it("recusa tipo de chave diferente de EC", () => {
    expect(() => validatePublicJwk({ ...jwkValida, kty: "RSA" })).toThrow(/Tipo de chave/);
  });

  it.each([["x"], ["y"]])("recusa JWK sem a coordenada %s", (campo) => {
    const incompleta = { ...jwkValida };
    delete incompleta[campo];
    expect(() => validatePublicJwk(incompleta)).toThrow(new RegExp(`coordenada ${campo}`));
  });

  it.each([
    ["null", null],
    ["string", "chave"],
    ["número", 42],
  ])("recusa %s", (_rotulo, valor) => {
    expect(() => validatePublicJwk(valor)).toThrow(KeyError);
  });

  it("recusa coordenadas que não formam um ponto da curva", async () => {
    await expect(importPublicKey({ ...jwkValida, x: "AAAA" })).rejects.toThrow(KeyError);
  });
});
