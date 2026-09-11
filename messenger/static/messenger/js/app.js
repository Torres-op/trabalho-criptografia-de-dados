import * as cipher from "./crypto.js";
import * as format from "./format.js";
import * as huffman from "./huffman.js";
import {
  ensureKeyPair,
  exportPublicKey,
  loadPeerPublicKey,
  samePublicKey,
  savePeerPublicKey,
} from "./keys.js";

export function isFakeImplementation() {
  return Boolean(huffman.FAKE_IMPLEMENTATION || cipher.FAKE_IMPLEMENTATION);
}

export function senderIdFor(username, peerUsername) {
  return cipher.orderUsernames(username, peerUsername)[0] === username ? 0 : 1;
}

export function senderNameFor(senderId, username, peerUsername) {
  return cipher.orderUsernames(username, peerUsername)[senderId];
}

export async function openSession(context, remote) {
  const { username, peerUsername } = context;
  const { pair, created } = await ensureKeyPair(username);
  const notices = [];
  const pendingSession = { ready: false, username, peerUsername, localKeyCreated: created, notices };

  try {
    await remote.publishPublicKey(await exportPublicKey(pair.publicKey));
  } catch (error) {
    if (error.code === "key_conflict") {
      return { ...pendingSession, reason: error.message };
    }
    notices.push(`Não foi possível confirmar sua chave pública com o servidor: ${error.message}`);
  }

  const peer = await resolvePeer(username, peerUsername, remote, notices);
  if (!peer.publicKey) {
    return { ...pendingSession, reason: peer.reason };
  }

  const aesKey = await cipher.deriveKey(pair.privateKey, peer.publicKey, username, peerUsername);
  return {
    ...pendingSession,
    ready: true,
    aesKey,
    senderId: senderIdFor(username, peerUsername),
  };
}

async function resolvePeer(owner, peerUsername, remote, notices) {
  const cached = await loadPeerPublicKey(owner);
  const usableCache = cached?.peerUsername === peerUsername ? cached : null;

  let published;
  try {
    published = await remote.fetchPeerPublicKey();
  } catch (error) {
    if (error.code === "key_not_published") {
      return {
        reason:
          `${peerUsername} ainda não acessou o app, então ainda não há chave pública ` +
          `registrada. Assim que ${peerUsername} entrar uma vez, a troca de chaves ` +
          "acontece automaticamente.",
      };
    }
    if (usableCache) {
      notices.push(
        `O servidor não respondeu; usando a chave de ${peerUsername} guardada neste navegador.`
      );
      return usableCache;
    }
    return { reason: `Não foi possível buscar a chave pública de ${peerUsername}: ${error.message}` };
  }

  if (usableCache && !samePublicKey(usableCache.jwk, published.jwk)) {
    notices.push(
      `A chave pública de ${peerUsername} mudou desde o seu último acesso. Confirme ` +
        `pessoalmente com ${peerUsername} que foi uma troca legítima antes de enviar ` +
        "algo sensível."
    );
  }

  await savePeerPublicKey(owner, { jwk: published.jwk, peerUsername });
  return loadPeerPublicKey(owner);
}

export async function composeMessage(text, session) {
  if (typeof text !== "string" || text.length === 0) {
    throw new Error("Digite uma mensagem antes de gerar o arquivo.");
  }
  cipher.requireAesKey(session?.aesKey);

  const { aesKey, senderId } = session;
  const createdAt = Date.now();
  const encoded = huffman.encode(text);
  const { bytes, compressed } = encoded;
  const aad = format.buildAad({ senderId, createdAt, compressed });
  const { iv, ciphertext } = await cipher.encrypt(bytes, aesKey, aad);
  const file = format.pack({ senderId, createdAt, compressed, iv, ciphertext });

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

export async function readMessage(file, session) {
  const header = format.unpack(file);
  const bytes = await cipher.decrypt(header.iv, header.ciphertext, session?.aesKey, header.aad);
  const text = huffman.decode(bytes, header.compressed);

  return {
    text,
    createdAt: header.createdAt,
    senderId: header.senderId,
    compressed: header.compressed,
    fileBytes: file.length,
  };
}
