import { afterEach, describe, expect, it } from "vitest";

import {
  DATABASE_NAME,
  KeystoreError,
  closeDatabase,
  deleteKeyPair,
  deletePeer,
  hasKeyPair,
  loadKeyPair,
  loadPeer,
  recordKey,
  saveKeyPair,
  saveKeyPairIfAbsent,
  savePeer,
} from "../messenger/static/messenger/js/keystore.js";

const OWNER = "diretor";
const OTHER = "marcio";

const PEER_JWK = {
  kty: "EC",
  crv: "P-256",
  x: "f83OJ3D2xF1Bg8vub9tD2VqV6uNRnCVvzOgOb5m7Vfs",
  y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
};

const novoPar = () =>
  crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey",
    "deriveBits",
  ]);

const coordenadaX = async (par) => (await crypto.subtle.exportKey("jwk", par.publicKey)).x;

function limparBanco() {
  closeDatabase();
  return new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = resolve;
    request.onerror = resolve;
    request.onblocked = resolve;
  });
}

function gravarDireto(key, value) {
  return new Promise((resolve, reject) => {
    const abrir = indexedDB.open(DATABASE_NAME, 1);
    abrir.onupgradeneeded = () => abrir.result.createObjectStore("keys");
    abrir.onsuccess = () => {
      const db = abrir.result;
      const tx = db.transaction("keys", "readwrite");
      tx.objectStore("keys").put(value, key);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => reject(tx.error);
    };
    abrir.onerror = () => reject(abrir.error);
  });
}

afterEach(limparBanco);

describe("armazenamento do par local", () => {
  it("começa vazio", async () => {
    expect(await hasKeyPair(OWNER)).toBe(false);
    expect(await loadKeyPair(OWNER)).toBeNull();
  });

  it("guarda e devolve o par", async () => {
    await saveKeyPair(OWNER, await novoPar());
    expect(await hasKeyPair(OWNER)).toBe(true);
    const lido = await loadKeyPair(OWNER);
    expect(lido.privateKey.type).toBe("private");
    expect(lido.publicKey.type).toBe("public");
  });

  it("devolve uma chave que ainda funciona para derivar", async () => {
    await saveKeyPair(OWNER, await novoPar());
    const lido = await loadKeyPair(OWNER);
    const bits = await crypto.subtle.deriveBits(
      { name: "ECDH", public: lido.publicKey },
      lido.privateKey,
      256
    );
    expect(bits.byteLength).toBe(32);
  });

  it("sobrevive a fechar e reabrir a conexão, como num reload", async () => {
    const par = await novoPar();
    await saveKeyPair(OWNER, par);
    closeDatabase();
    expect(await coordenadaX(await loadKeyPair(OWNER))).toBe(await coordenadaX(par));
  });

  it("substitui o par anterior ao salvar de novo", async () => {
    await saveKeyPair(OWNER, await novoPar());
    const segundo = await novoPar();
    await saveKeyPair(OWNER, segundo);
    expect(await coordenadaX(await loadKeyPair(OWNER))).toBe(await coordenadaX(segundo));
  });

  it("apaga o par", async () => {
    await saveKeyPair(OWNER, await novoPar());
    await deleteKeyPair(OWNER);
    expect(await hasKeyPair(OWNER)).toBe(false);
  });

  it("aceita apagar quando não há nada guardado", async () => {
    await expect(deleteKeyPair(OWNER)).resolves.toBeUndefined();
  });
});

describe("separação por usuário no mesmo navegador", () => {
  it("guarda pares independentes para cada usuário", async () => {
    const doDiretor = await novoPar();
    const doMarcio = await novoPar();
    await saveKeyPair(OWNER, doDiretor);
    await saveKeyPair(OTHER, doMarcio);

    expect(await coordenadaX(await loadKeyPair(OWNER))).toBe(await coordenadaX(doDiretor));
    expect(await coordenadaX(await loadKeyPair(OTHER))).toBe(await coordenadaX(doMarcio));
  });

  it("um usuário não enxerga o par do outro", async () => {
    await saveKeyPair(OWNER, await novoPar());
    expect(await hasKeyPair(OTHER)).toBe(false);
    expect(await loadKeyPair(OTHER)).toBeNull();
  });

  it("apagar o par de um usuário preserva o do outro", async () => {
    await saveKeyPair(OWNER, await novoPar());
    await saveKeyPair(OTHER, await novoPar());
    await deleteKeyPair(OWNER);
    expect(await hasKeyPair(OTHER)).toBe(true);
  });

  it("exige saber a quem as chaves pertencem", async () => {
    await expect(loadKeyPair("")).rejects.toThrow(KeystoreError);
    await expect(saveKeyPair(undefined, await novoPar())).rejects.toThrow(/qual usuário/);
  });
});

describe("validação estrutural do par", () => {
  it.each([
    ["null", null],
    ["objeto vazio", {}],
    ["string", "par"],
    ["objeto que só imita os campos type", { privateKey: { type: "private" }, publicKey: { type: "public" } }],
  ])("recusa salvar %s", async (_rotulo, valor) => {
    await expect(saveKeyPair(OWNER, valor)).rejects.toThrow(KeystoreError);
  });

  it("recusa CryptoKey de algoritmo diferente de ECDH", async () => {
    const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt",
    ]);
    await expect(saveKeyPair(OWNER, { privateKey: aes, publicKey: aes })).rejects.toThrow(
      KeystoreError
    );
  });

  it("recusa par de curva diferente de P-256", async () => {
    const outro = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-384" }, true, [
      "deriveKey",
      "deriveBits",
    ]);
    await expect(saveKeyPair(OWNER, outro)).rejects.toThrow(KeystoreError);
  });

  it("recusa chave privada sem os usos de derivação", async () => {
    const semUsos = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ]);
    await expect(saveKeyPair(OWNER, semUsos)).rejects.toThrow(KeystoreError);
  });

  it("acusa impostor gravado direto no banco, em vez de devolvê-lo", async () => {
    await gravarDireto(recordKey("local-key-pair", OWNER), {
      privateKey: { type: "private" },
      publicKey: { type: "public" },
    });
    await expect(loadKeyPair(OWNER)).rejects.toThrow(/corrompido/);
  });
});

describe("gravação sem sobrescrever (corrida entre abas)", () => {
  it("grava quando não há nada", async () => {
    const par = await novoPar();
    const resultado = await saveKeyPairIfAbsent(OWNER, par);
    expect(resultado.stored).toBe(true);
    expect(resultado.pair).toBe(par);
  });

  it("preserva o par existente e devolve o vencedor", async () => {
    const primeiro = await novoPar();
    await saveKeyPair(OWNER, primeiro);
    const resultado = await saveKeyPairIfAbsent(OWNER, await novoPar());

    expect(resultado.stored).toBe(false);
    expect(await coordenadaX(await loadKeyPair(OWNER))).toBe(await coordenadaX(primeiro));
  });

  it("mantém um único par mesmo com gravações concorrentes", async () => {
    const candidatos = await Promise.all([novoPar(), novoPar(), novoPar(), novoPar()]);
    const resultados = await Promise.all(candidatos.map((par) => saveKeyPairIfAbsent(OWNER, par)));

    expect(resultados.filter((r) => r.stored)).toHaveLength(1);
    const guardado = await coordenadaX(await loadKeyPair(OWNER));
    for (const resultado of resultados) {
      expect(await coordenadaX(resultado.pair)).toBe(guardado);
    }
  });
});

describe("chave do outro usuário", () => {
  it("começa vazia", async () => {
    expect(await loadPeer(OWNER)).toBeNull();
  });

  it("guarda e devolve o registro", async () => {
    await savePeer(OWNER, { jwk: PEER_JWK, peerUsername: OTHER });
    expect(await loadPeer(OWNER)).toEqual({ jwk: PEER_JWK, peerUsername: OTHER });
  });

  it("mantém registros separados por dono", async () => {
    await savePeer(OWNER, { jwk: PEER_JWK, peerUsername: OTHER });
    expect(await loadPeer(OTHER)).toBeNull();
  });

  it("apaga", async () => {
    await savePeer(OWNER, { jwk: PEER_JWK, peerUsername: OTHER });
    await deletePeer(OWNER);
    expect(await loadPeer(OWNER)).toBeNull();
  });

  it.each([
    ["sem jwk", { peerUsername: OTHER }],
    ["sem peerUsername", { jwk: PEER_JWK }],
    ["peerUsername vazio", { jwk: PEER_JWK, peerUsername: "" }],
    ["null", null],
  ])("recusa registro %s", async (_rotulo, registro) => {
    await expect(savePeer(OWNER, registro)).rejects.toThrow(KeystoreError);
  });

  it("acusa registro corrompido", async () => {
    await gravarDireto(recordKey("peer-public-key", OWNER), { lixo: true });
    await expect(loadPeer(OWNER)).rejects.toThrow(/corrompido/);
  });
});
