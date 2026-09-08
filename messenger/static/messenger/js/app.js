import * as cipher from "./crypto.js";
import * as format from "./format.js";
import * as huffman from "./huffman.js";
import { ensureKeyPair, loadPeerPublicKey } from "./keys.js";

export const SENDER_ID = 0;

export function isFakeImplementation() {
  return Boolean(huffman.FAKE_IMPLEMENTATION || cipher.FAKE_IMPLEMENTATION);
}

export async function openSession() {
  const { pair, created } = await ensureKeyPair();
  const peer = await loadPeerPublicKey();

  if (!peer) {
    return {
      ready: false,
      localKeyCreated: created,
      reason:
        "Sua chave local está pronta, mas ainda não há a chave pública do outro " +
        "usuário. Enquanto a troca de chaves não for feita, não é possível cifrar " +
        "nem decifrar mensagens.",
    };
  }

  const aesKey = await cipher.deriveKey(
    pair.privateKey,
    peer.publicKey,
    peer.localUsername,
    peer.peerUsername
  );

  return { ready: true, localKeyCreated: created, aesKey };
}

export async function composeMessage(text, aesKey = null) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("Digite uma mensagem antes de gerar o arquivo.");
  }

  const createdAt = Date.now();
  const encoded = huffman.encode(text);
  const { bytes, compressed } = encoded;
  const aad = format.buildAad({ senderId: SENDER_ID, createdAt, compressed });
  const { iv, ciphertext } = await cipher.encrypt(bytes, aesKey, aad);
  const file = format.pack({
    senderId: SENDER_ID,
    createdAt,
    compressed,
    iv,
    ciphertext,
  });

  const measured = huffman.measure(text, encoded);

  return {
    file,
    createdAt,
    name: format.fileName(createdAt),
    stats: {
      ...measured,
      compressionRatio: measured.ratio,
      fileBytes: file.length,
      fileRatio: measured.originalBytes === 0 ? 1 : file.length / measured.originalBytes,
    },
  };
}

export async function readMessage(file, aesKey = null) {
  const header = format.unpack(file);
  const bytes = await cipher.decrypt(
    header.iv,
    header.ciphertext,
    aesKey,
    header.aad
  );
  const text = huffman.decode(bytes, header.compressed);

  return {
    text,
    createdAt: header.createdAt,
    senderId: header.senderId,
    compressed: header.compressed,
    fileBytes: file.length,
  };
}
