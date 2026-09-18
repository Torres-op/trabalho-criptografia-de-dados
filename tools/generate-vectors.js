import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { deriveKey, encrypt } from "../messenger/static/messenger/js/crypto.js";
import { buildAad, pack } from "../messenger/static/messenger/js/format.js";
import { encode } from "../messenger/static/messenger/js/huffman.js";

const DIRECTORY = "tests/vectors";
const KEYS = `${DIRECTORY}/keys.json`;
const MANIFEST = `${DIRECTORY}/manifest.json`;
const SENDER = "diretor";
const RECIPIENT = "marcio";

const WARNING =
  "Chaves e arquivos de teste, publicados de propósito no repositório. " +
  "Nunca use nada daqui em mensagem real.";

const TEXTS = [
  {
    file: "short.treehash",
    text: "Chego às 19h.",
    createdAt: Date.UTC(2026, 8, 17, 12, 0, 0),
  },
  {
    file: "paragraph.treehash",
    text:
      "O relatório trimestral ficou pronto e segue em anexo para conferência. " +
      "Qualquer ajuste, me avise ainda hoje para revisarmos juntos amanhã de manhã.",
    createdAt: Date.UTC(2026, 8, 17, 12, 30, 0),
  },
  {
    file: "emoji.treehash",
    text: "Combinado 👍🔐 até amanhã, às 9h em ponto — não esqueça o crachá.",
    createdAt: Date.UTC(2026, 8, 17, 13, 0, 0),
  },
];

const params = { name: "ECDH", namedCurve: "P-256" };
const usages = ["deriveKey", "deriveBits"];

async function loadKeys() {
  if (existsSync(KEYS)) {
    return JSON.parse(readFileSync(KEYS, "utf8"));
  }

  const pairs = {};
  for (const username of [SENDER, RECIPIENT]) {
    const pair = await crypto.subtle.generateKey(params, true, usages);
    pairs[username] = await crypto.subtle.exportKey("jwk", pair.privateKey);
  }
  return { warning: WARNING, keys: pairs };
}

async function privateKeyOf(jwk) {
  return crypto.subtle.importKey("jwk", jwk, params, true, usages);
}

async function publicKeyOf(jwk) {
  const { kty, crv, x, y } = jwk;
  return crypto.subtle.importKey("jwk", { kty, crv, x, y }, params, true, []);
}

const stored = await loadKeys();
mkdirSync(DIRECTORY, { recursive: true });
writeFileSync(KEYS, `${JSON.stringify(stored, null, 2)}\n`);

const senderKey = await deriveKey(
  await privateKeyOf(stored.keys[SENDER]),
  await publicKeyOf(stored.keys[RECIPIENT]),
  SENDER,
  RECIPIENT
);

const vectors = [];
for (const { file, text, createdAt } of TEXTS) {
  const { bytes, compressed } = encode(text);
  const aad = buildAad({ senderId: 0, createdAt, compressed });
  const { iv, ciphertext } = await encrypt(bytes, senderKey, aad);
  const packed = pack({ senderId: 0, createdAt, compressed, iv, ciphertext });

  writeFileSync(`${DIRECTORY}/${file}`, packed);
  vectors.push({ file, text, senderId: 0, compressed, createdAt, size: packed.length });
}

const source = readFileSync(`${DIRECTORY}/${TEXTS[1].file}`);
const tampered = Uint8Array.from(source);
tampered[tampered.length - 5] ^= 0xff;
writeFileSync(`${DIRECTORY}/tampered.treehash`, tampered);

writeFileSync(
  MANIFEST,
  `${JSON.stringify(
    {
      warning: WARNING,
      usernames: { sender: SENDER, recipient: RECIPIENT },
      vectors,
      tampered: { file: "tampered.treehash", from: TEXTS[1].file },
    },
    null,
    2
  )}\n`
);

console.log(`vetores gerados em ${DIRECTORY}:`);
for (const vector of vectors) {
  console.log(`  ${vector.file} — ${vector.size} B, comprimido: ${vector.compressed}`);
}
console.log("  tampered.treehash");
