import { afterEach, describe, expect, it } from "vitest";

import {
  DATABASE_NAME,
  KeystoreError,
  closeDatabase,
  deleteKeyPair,
  hasKeyPair,
  loadKeyPair,
  saveKeyPair,
  saveKeyPairIfAbsent,
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

describe("validação estrutural do par (revisão de código)", () => {
  it("recusa objeto que só imita os campos type", async () => {
    const impostor = {
      privateKey: { type: "private" },
      publicKey: { type: "public" },
    };
    await expect(saveKeyPair(impostor)).rejects.toThrow(KeystoreError);
  });

  it("recusa CryptoKey de algoritmo diferente de ECDH", async () => {
    const aes = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, true, [
      "encrypt",
      "decrypt",
    ]);
    await expect(saveKeyPair({ privateKey: aes, publicKey: aes })).rejects.toThrow(
      KeystoreError
    );
  });

  it("recusa par de curva diferente de P-256", async () => {
    const outro = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-384" },
      true,
      ["deriveKey", "deriveBits"]
    );
    await expect(saveKeyPair(outro)).rejects.toThrow(KeystoreError);
  });

  it("recusa chave privada sem os usos de derivação", async () => {
    const semUsos = await crypto.subtle.generateKey(
      { name: "ECDH", namedCurve: "P-256" },
      true,
      ["deriveBits"]
    );
    await expect(saveKeyPair(semUsos)).rejects.toThrow(KeystoreError);
  });

  it("acusa impostor gravado direto no banco, em vez de devolvê-lo", async () => {
    await new Promise((resolve, reject) => {
      const abrir = indexedDB.open(DATABASE_NAME, 1);
      abrir.onupgradeneeded = () => abrir.result.createObjectStore("keys");
      abrir.onsuccess = () => {
        const db = abrir.result;
        const tx = db.transaction("keys", "readwrite");
        tx.objectStore("keys").put(
          { privateKey: { type: "private" }, publicKey: { type: "public" } },
          "local-key-pair"
        );
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      abrir.onerror = () => reject(abrir.error);
    });

    await expect(loadKeyPair()).rejects.toThrow(/corrompido/);
  });
});

describe("gravação sem sobrescrever (corrida entre abas)", () => {
  it("grava quando não há nada", async () => {
    const par = await novoPar();
    const resultado = await saveKeyPairIfAbsent(par);

    expect(resultado.stored).toBe(true);
    expect(resultado.pair).toBe(par);
  });

  it("preserva o par existente e devolve o vencedor", async () => {
    const primeiro = await novoPar();
    await saveKeyPair(primeiro);

    const segundo = await novoPar();
    const resultado = await saveKeyPairIfAbsent(segundo);

    expect(resultado.stored).toBe(false);

    const guardado = await crypto.subtle.exportKey("jwk", (await loadKeyPair()).publicKey);
    const esperado = await crypto.subtle.exportKey("jwk", primeiro.publicKey);
    expect(guardado.x).toBe(esperado.x);
  });

  it("mantém um único par mesmo com gravações concorrentes", async () => {
    const candidatos = await Promise.all([novoPar(), novoPar(), novoPar(), novoPar()]);
    const resultados = await Promise.all(candidatos.map(saveKeyPairIfAbsent));

    expect(resultados.filter((r) => r.stored)).toHaveLength(1);

    const guardado = await crypto.subtle.exportKey("jwk", (await loadKeyPair()).publicKey);
    const vencedor = resultados.find((r) => r.stored).pair;
    const esperado = await crypto.subtle.exportKey("jwk", vencedor.publicKey);
    expect(guardado.x).toBe(esperado.x);

    for (const resultado of resultados) {
      const devolvido = await crypto.subtle.exportKey("jwk", resultado.pair.publicKey);
      expect(devolvido.x).toBe(guardado.x);
    }
  });
});
