import { afterEach, describe, expect, it } from "vitest";

import {
  DATABASE_NAME,
  KeystoreError,
  closeDatabase,
  deleteKeyPair,
  hasKeyPair,
  loadKeyPair,
  saveKeyPair,
} from "../messenger/static/messenger/js/keystore.js";

const novoPar = () =>
  crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
    "deriveKey",
    "deriveBits",
  ]);

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

describe("armazenamento do par local", () => {
  it("começa vazio", async () => {
    expect(await hasKeyPair()).toBe(false);
    expect(await loadKeyPair()).toBeNull();
  });

  it("guarda e devolve o par", async () => {
    const par = await novoPar();
    await saveKeyPair(par);

    expect(await hasKeyPair()).toBe(true);
    const lido = await loadKeyPair();
    expect(lido.privateKey.type).toBe("private");
    expect(lido.publicKey.type).toBe("public");
  });

  it("devolve uma chave que ainda funciona para derivar", async () => {
    const par = await novoPar();
    await saveKeyPair(par);

    const lido = await loadKeyPair();
    const bits = await crypto.subtle.deriveBits(
      { name: "ECDH", public: lido.publicKey },
      lido.privateKey,
      256
    );
    expect(bits.byteLength).toBe(32);
  });

  it("sobrevive a fechar e reabrir a conexão, como num reload", async () => {
    const par = await novoPar();
    await saveKeyPair(par);
    const antes = await crypto.subtle.exportKey("jwk", par.publicKey);

    closeDatabase();

    const lido = await loadKeyPair();
    const depois = await crypto.subtle.exportKey("jwk", lido.publicKey);
    expect(depois.x).toBe(antes.x);
    expect(depois.y).toBe(antes.y);
  });

  it("substitui o par anterior ao salvar de novo", async () => {
    const primeiro = await novoPar();
    await saveKeyPair(primeiro);
    const segundo = await novoPar();
    await saveKeyPair(segundo);

    const lido = await loadKeyPair();
    const esperado = await crypto.subtle.exportKey("jwk", segundo.publicKey);
    const obtido = await crypto.subtle.exportKey("jwk", lido.publicKey);
    expect(obtido.x).toBe(esperado.x);
  });

  it("apaga o par", async () => {
    await saveKeyPair(await novoPar());
    await deleteKeyPair();

    expect(await hasKeyPair()).toBe(false);
    expect(await loadKeyPair()).toBeNull();
  });

  it("aceita apagar quando não há nada guardado", async () => {
    await expect(deleteKeyPair()).resolves.toBeUndefined();
  });
});

describe("validação", () => {
  it.each([
    ["null", null],
    ["undefined", undefined],
    ["objeto vazio", {}],
    ["string", "par"],
    ["só a pública", { publicKey: { type: "public" } }],
    ["só a privada", { privateKey: { type: "private" } }],
    ["tipos trocados", { privateKey: { type: "public" }, publicKey: { type: "private" } }],
  ])("recusa salvar %s", async (_rotulo, valor) => {
    await expect(saveKeyPair(valor)).rejects.toThrow(KeystoreError);
  });

  it("acusa conteúdo corrompido na leitura", async () => {
    const gravarDireto = () =>
      new Promise((resolve, reject) => {
        const abrir = indexedDB.open(DATABASE_NAME, 1);
        abrir.onupgradeneeded = () => abrir.result.createObjectStore("keys");
        abrir.onsuccess = () => {
          const db = abrir.result;
          const tx = db.transaction("keys", "readwrite");
          tx.objectStore("keys").put({ lixo: true }, "local-key-pair");
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => reject(tx.error);
        };
        abrir.onerror = () => reject(abrir.error);
      });

    await gravarDireto();
    await expect(loadKeyPair()).rejects.toThrow(/corrompido/);
  });
});
