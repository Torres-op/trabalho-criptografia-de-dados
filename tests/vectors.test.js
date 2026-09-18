import { readFileSync } from "node:fs";

import { beforeAll, describe, expect, it } from "vitest";

import { decrypt, deriveKey } from "../messenger/static/messenger/js/crypto.js";
import { unpack } from "../messenger/static/messenger/js/format.js";
import { decode } from "../messenger/static/messenger/js/huffman.js";

const DIRECTORY = "tests/vectors";
const manifest = JSON.parse(readFileSync(`${DIRECTORY}/manifest.json`, "utf8"));
const stored = JSON.parse(readFileSync(`${DIRECTORY}/keys.json`, "utf8"));

const params = { name: "ECDH", namedCurve: "P-256" };
const bytesOf = (file) => new Uint8Array(readFileSync(`${DIRECTORY}/${file}`));
const byName = Object.fromEntries(manifest.vectors.map((vector) => [vector.file, vector]));

let aesKey;

beforeAll(async () => {
  const { sender, recipient } = manifest.usernames;
  const privateKey = await crypto.subtle.importKey("jwk", stored.keys[recipient], params, true, [
    "deriveKey",
    "deriveBits",
  ]);
  const { kty, crv, x, y } = stored.keys[sender];
  const publicKey = await crypto.subtle.importKey("jwk", { kty, crv, x, y }, params, true, []);

  aesKey = await deriveKey(privateKey, publicKey, sender, recipient);
});

async function read(bytes) {
  const header = unpack(bytes);
  const plain = await decrypt(header.iv, header.ciphertext, aesKey, header.aad);
  return { header, text: decode(plain, header.compressed) };
}

function mutated(file, position, change) {
  const bytes = bytesOf(file);
  bytes[position] = change(bytes[position]);
  return bytes;
}

describe("vetores fixos da equipe (14.9)", () => {
  for (const vector of manifest.vectors) {
    it(`${vector.file} decifra para o texto esperado`, async () => {
      const { header, text } = await read(bytesOf(vector.file));

      expect(text).toBe(vector.text);
      expect(header.senderId).toBe(vector.senderId);
      expect(header.compressed).toBe(vector.compressed);
      expect(header.createdAt).toBe(vector.createdAt);
    });
  }

  it("o texto curto aciona o fallback de compressão", () => {
    expect(byName["short.treehash"].compressed).toBe(false);
  });

  it("o parágrafo e o emoji passam comprimidos", () => {
    expect(byName["paragraph.treehash"].compressed).toBe(true);
    expect(byName["emoji.treehash"].compressed).toBe(true);
  });

  it("os arquivos começam com o magic do D5", () => {
    for (const vector of manifest.vectors) {
      expect([...bytesOf(vector.file).slice(0, 4)]).toEqual([0x54, 0x52, 0x48, 0x53]);
    }
  });
});

describe("adulteração (14.7)", () => {
  const original = "paragraph.treehash";

  it("o vetor adulterado do repositório é recusado", async () => {
    await expect(read(bytesOf(manifest.tampered.file))).rejects.toThrow(/adulterado/);
  });

  it("um byte trocado no ciphertext derruba a leitura", async () => {
    const bytes = bytesOf(original);
    const position = bytes.length - 1;

    await expect(read(mutated(original, position, (byte) => byte ^ 0xff))).rejects.toThrow(
      /adulterado/
    );
  });

  it("um byte trocado no created_at derruba a leitura, pelo AAD", async () => {
    await expect(read(mutated(original, 8, (byte) => byte ^ 0xff))).rejects.toThrow(/adulterado/);
  });

  it("trocar o sender_id derruba a leitura, pelo AAD", async () => {
    const bytes = mutated(original, 6, (byte) => (byte === 0 ? 1 : 0));

    expect(unpack(bytes).senderId).toBe(1);
    await expect(read(bytes)).rejects.toThrow(/adulterado/);
  });

  it("nenhum caso devolve texto parcial", async () => {
    for (const position of [6, 8, 30]) {
      const bytes = mutated(original, position, (byte) => byte ^ 0xff);
      await expect(read(bytes)).rejects.toThrow();
    }
  });
});
