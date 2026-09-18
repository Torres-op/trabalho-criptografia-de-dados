import { afterEach, describe, expect, it } from "vitest";

import {
  CURVE,
  KEY_USAGES,
  KeyError,
  ensureKeyPair,
  exportPublicKey,
  forgetPendingKeyPair,
  generateKeyPair,
  hasLocalKeyPair,
  importPublicKey,
  loadPeerPublicKey,
  samePublicKey,
  savePeerPublicKey,
  validatePublicJwk,
} from "../messenger/static/messenger/js/keys.js";
import {
  DATABASE_NAME,
  closeDatabase,
  loadKeyPair,
} from "../messenger/static/messenger/js/keystore.js";

const OWNER = "diretor";
const OTHER = "marcio";

function limparBanco() {
  closeDatabase();
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = resolve;
    request.onerror = resolve;
    request.onblocked = resolve;
  });
}

afterEach(async () => {
  forgetPendingKeyPair();
  await limparBanco();
});

describe("geração do par ECDH (4.1)", () => {
  it("usa a curva P-256 e os usos previstos em D4", async () => {
    const par = await generateKeyPair();
    expect(par.privateKey.algorithm.name).toBe("ECDH");
    expect(par.privateKey.algorithm.namedCurve).toBe(CURVE);
    expect([...par.privateKey.usages].sort()).toEqual([...KEY_USAGES].sort());
    expect(par.publicKey.type).toBe("public");
  });

  it("marca a chave privada como extraível, para permitir backup", async () => {
    expect((await generateKeyPair()).privateKey.extractable).toBe(true);
  });

  it("gera um par diferente a cada chamada", async () => {
    const [a, b] = await Promise.all([generateKeyPair(), generateKeyPair()]);
    expect((await exportPublicKey(a.publicKey)).x).not.toBe((await exportPublicKey(b.publicKey)).x);
  });
});

describe("ensureKeyPair", () => {
  it("gera no primeiro acesso", async () => {
    expect(await hasLocalKeyPair(OWNER)).toBe(false);
    const { pair, created } = await ensureKeyPair(OWNER);
    expect(created).toBe(true);
    expect(pair.privateKey.type).toBe("private");
    expect(await hasLocalKeyPair(OWNER)).toBe(true);
  });

  it("reutiliza o mesmo par nos acessos seguintes", async () => {
    const primeiro = await ensureKeyPair(OWNER);
    closeDatabase();
    const segundo = await ensureKeyPair(OWNER);

    expect(primeiro.created).toBe(true);
    expect(segundo.created).toBe(false);
    expect(await exportPublicKey(segundo.pair.publicKey)).toEqual(
      await exportPublicKey(primeiro.pair.publicKey)
    );
  });

  it("dá um par próprio a cada usuário do mesmo navegador", async () => {
    const doDiretor = await ensureKeyPair(OWNER);
    const doMarcio = await ensureKeyPair(OTHER);

    expect(doMarcio.created).toBe(true);
    expect((await exportPublicKey(doMarcio.pair.publicKey)).x).not.toBe(
      (await exportPublicKey(doDiretor.pair.publicKey)).x
    );
  });
});

describe("corrida na criação do par", () => {
  it("chamadas concorrentes do mesmo usuário compartilham a promessa em voo", async () => {
    const resultados = await Promise.all([
      ensureKeyPair(OWNER),
      ensureKeyPair(OWNER),
      ensureKeyPair(OWNER),
    ]);
    for (const resultado of resultados) {
      expect(resultado.pair).toBe(resultados[0].pair);
    }
  });

  it("o par devolvido é o que ficou guardado", async () => {
    const resultados = await Promise.all([ensureKeyPair(OWNER), ensureKeyPair(OWNER)]);
    const guardado = await exportPublicKey((await loadKeyPair(OWNER)).publicKey);
    for (const resultado of resultados) {
      expect(await exportPublicKey(resultado.pair.publicKey)).toEqual(guardado);
    }
  });

  it("usuários diferentes não compartilham a mesma promessa", async () => {
    const [a, b] = await Promise.all([ensureKeyPair(OWNER), ensureKeyPair(OTHER)]);
    expect(a.pair).not.toBe(b.pair);
  });
});

describe("exportação e importação da chave pública", () => {
  it("exporta apenas os campos públicos da JWK", async () => {
    const jwk = await exportPublicKey((await generateKeyPair()).publicKey);
    expect(jwk).not.toHaveProperty("d");
    expect(Object.keys(jwk).sort()).toEqual(["crv", "ext", "key_ops", "kty", "x", "y"]);
  });

  it("faz round-trip export → import preservando as coordenadas", async () => {
    const jwk = await exportPublicKey((await generateKeyPair()).publicKey);
    expect(await exportPublicKey(await importPublicKey(jwk))).toEqual(jwk);
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

  it("recusa curva e tipo errados", () => {
    expect(() => validatePublicJwk({ ...jwkValida, crv: "P-384" })).toThrow(/Curva/);
    expect(() => validatePublicJwk({ ...jwkValida, kty: "RSA" })).toThrow(/Tipo de chave/);
  });

  it.each([["x"], ["y"]])("recusa JWK sem a coordenada %s", (campo) => {
    const incompleta = { ...jwkValida };
    delete incompleta[campo];
    expect(() => validatePublicJwk(incompleta)).toThrow(new RegExp(`coordenada ${campo}`));
  });

  it("recusa coordenadas que não formam um ponto da curva", async () => {
    await expect(importPublicKey({ ...jwkValida, x: "AAAA" })).rejects.toThrow(KeyError);
  });
});

describe("chave pública do outro usuário", () => {
  it("não existe antes da troca de chaves", async () => {
    expect(await loadPeerPublicKey(OWNER)).toBeNull();
  });

  it("guarda só os membros públicos e devolve a chave pronta para uso", async () => {
    const jwk = await exportPublicKey((await generateKeyPair()).publicKey);
    await savePeerPublicKey(OWNER, { jwk, peerUsername: OTHER });

    const lido = await loadPeerPublicKey(OWNER);
    expect(lido.peerUsername).toBe(OTHER);
    expect(lido.jwk).toEqual({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y });
    expect(lido.publicKey.type).toBe("public");
  });

  it("recusa JWK inválida na gravação", async () => {
    await expect(
      savePeerPublicKey(OWNER, { jwk: { kty: "RSA" }, peerUsername: OTHER })
    ).rejects.toThrow(KeyError);
  });

  it("guarda por dono: o que o diretor guardou não aparece para o marcio", async () => {
    const jwk = await exportPublicKey((await generateKeyPair()).publicKey);
    await savePeerPublicKey(OWNER, { jwk, peerUsername: OTHER });
    expect(await loadPeerPublicKey(OTHER)).toBeNull();
  });
});

describe("samePublicKey", () => {
  const base = { kty: "EC", crv: "P-256", x: "a", y: "b" };

  it("compara só os membros que definem a chave", () => {
    expect(samePublicKey(base, { ...base, ext: true, key_ops: [] })).toBe(true);
  });

  it("detecta coordenadas diferentes", () => {
    expect(samePublicKey(base, { ...base, x: "c" })).toBe(false);
    expect(samePublicKey(base, { ...base, y: "c" })).toBe(false);
  });

  it("trata ausência como diferente", () => {
    expect(samePublicKey(base, null)).toBe(false);
    expect(samePublicKey(undefined, base)).toBe(false);
  });
});
