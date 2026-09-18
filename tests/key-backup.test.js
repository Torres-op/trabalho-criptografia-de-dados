import { beforeAll, describe, expect, it } from "vitest";

import { decrypt, deriveKey, encrypt } from "../messenger/static/messenger/js/crypto.js";
import {
  ITERATIONS,
  KeyBackupError,
  MAGIC,
  VERSION,
  backupFileName,
  keyPairFrom,
  openBackup,
  packBackup,
  readHeader,
} from "../messenger/static/messenger/js/key-backup.js";
import { generateKeyPair } from "../messenger/static/messenger/js/keys.js";

const PASSWORD = "senha-de-backup-123";

let pair;
let backup;
let exported;

beforeAll(async () => {
  pair = await generateKeyPair();
  exported = await crypto.subtle.exportKey("jwk", pair.privateKey);
  backup = await packBackup(pair.privateKey, PASSWORD);
}, 30000);

describe("arquivo .treehashkey (11.3)", () => {
  it("começa com o magic TKEY e a versão", () => {
    expect([...backup.slice(0, 4)]).toEqual([...MAGIC]);
    expect(backup[4]).toBe(VERSION);
  });

  it("guarda as iterações e o tamanho dos campos", () => {
    const header = readHeader(backup);

    expect(header.iterations).toBe(ITERATIONS);
    expect(header.salt).toHaveLength(16);
    expect(header.iv).toHaveLength(12);
    expect(header.ciphertext.length).toBeGreaterThan(16);
  });

  it("não guarda a chave privada em claro", () => {
    const raw = String.fromCharCode(...backup);

    expect(raw).not.toContain(exported.d);
    expect(raw).not.toContain(exported.x);
  });

  it("dá um salt e um IV novos a cada backup", async () => {
    const outro = await packBackup(pair.privateKey, PASSWORD);

    expect([...readHeader(outro).salt]).not.toEqual([...readHeader(backup).salt]);
  });

  it("sugere um nome com o usuário e a data", () => {
    expect(backupFileName("diretor", Date.UTC(2026, 8, 17, 12))).toMatch(
      /^chave-diretor-2026091\d\.treehashkey$/
    );
  });

  it("recusa senha vazia", async () => {
    await expect(packBackup(pair.privateKey, "")).rejects.toThrow(KeyBackupError);
  });
});

describe("abrir o backup (11.4)", () => {
  it("devolve a chave privada com a senha certa", async () => {
    const jwk = await openBackup(backup, PASSWORD);

    expect(jwk.crv).toBe("P-256");
    expect(jwk.d).toBe(exported.d);
  });

  it("recusa a senha errada sem contar nada sobre a chave", async () => {
    await expect(openBackup(backup, "senha-errada")).rejects.toThrow(
      /Senha incorreta ou arquivo corrompido/
    );
  });

  it("recusa arquivo que não é um backup", () => {
    expect(() => readHeader(new Uint8Array(50))).toThrow(/não é um backup/);
  });

  it("recusa arquivo menor que o cabeçalho", () => {
    expect(() => readHeader(new Uint8Array(10))).toThrow(/incompleto/);
  });

  it("recusa conteúdo adulterado", async () => {
    const adulterado = backup.slice();
    adulterado[adulterado.length - 1] ^= 0xff;

    await expect(openBackup(adulterado, PASSWORD)).rejects.toThrow(
      /Senha incorreta ou arquivo corrompido/
    );
  });

  it("recusa um número de iterações absurdo", () => {
    const evil = backup.slice();
    new DataView(evil.buffer).setUint32(5, 4000000000, false);

    expect(() => readHeader(evil)).toThrow(/iterações/);
  });
});

describe("restaurar o par de chaves", () => {
  it("volta a derivar a mesma chave AES do par original", async () => {
    const outro = await generateKeyPair();
    const restaurado = await keyPairFrom(await openBackup(backup, PASSWORD));

    const original = await deriveKey(pair.privateKey, outro.publicKey, "diretor", "marcio");
    const doBackup = await deriveKey(restaurado.privateKey, outro.publicKey, "diretor", "marcio");

    const aad = new Uint8Array(15);
    const cifrado = await encrypt(new TextEncoder().encode("mensagem antiga"), original, aad);
    const aberto = await decrypt(cifrado.iv, cifrado.ciphertext, doBackup, aad);

    expect(new TextDecoder().decode(aberto)).toBe("mensagem antiga");
  });

  it("recusa um backup sem chave privada", async () => {
    await expect(
      keyPairFrom({ kty: "EC", crv: "P-256", x: exported.x, y: exported.y })
    ).rejects.toThrow(/não contém uma chave privada/);
  });
});
