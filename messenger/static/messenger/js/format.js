export class FormatError extends Error {
  constructor(message) {
    super(message);
    this.name = "FormatError";
  }
}

export const MAGIC = Object.freeze([0x54, 0x52, 0x48, 0x53]);
export const VERSION = 0x01;
export const FLAG_COMPRESSED = 0x01;
export const RESERVED_FLAGS = 0xfe;
export const AAD_SIZE = 15;
export const IV_SIZE = 12;
export const HEADER_SIZE = 27;
export const TAG_SIZE = 16;
export const EXTENSION = ".treehash";

export function buildAad({ senderId, createdAt, compressed }) {
  validateSenderId(senderId);
  validateCreatedAt(createdAt);

  const aad = new Uint8Array(AAD_SIZE);
  const view = new DataView(aad.buffer);

  aad.set(MAGIC, 0);
  aad[4] = VERSION;
  aad[5] = compressed ? FLAG_COMPRESSED : 0x00;
  aad[6] = senderId;
  view.setBigUint64(7, BigInt(createdAt), false);

  return aad;
}

export function pack({ senderId, createdAt, compressed, iv, ciphertext }) {
  if (!(iv instanceof Uint8Array) || iv.length !== IV_SIZE) {
    throw new FormatError(`O IV precisa ter exatamente ${IV_SIZE} bytes.`);
  }
  if (!(ciphertext instanceof Uint8Array) || ciphertext.length === 0) {
    throw new FormatError("O ciphertext está vazio.");
  }

  const aad = buildAad({ senderId, createdAt, compressed });
  const bytes = new Uint8Array(HEADER_SIZE + ciphertext.length);

  bytes.set(aad, 0);
  bytes.set(iv, AAD_SIZE);
  bytes.set(ciphertext, HEADER_SIZE);

  return bytes;
}

export function unpack(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new FormatError("Entrada inválida: esperado Uint8Array.");
  }
  if (bytes.length < HEADER_SIZE + 1) {
    throw new FormatError("Arquivo corrompido: menor que o cabeçalho mínimo.");
  }
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC[i]) {
      throw new FormatError("Este arquivo não é uma mensagem do aplicativo.");
    }
  }

  const version = bytes[4];
  if (version !== VERSION) {
    throw new FormatError(
      `Arquivo gerado por uma versão diferente do app (versão ${version}).`
    );
  }

  const flags = bytes[5];
  if (flags & RESERVED_FLAGS) {
    throw new FormatError("Arquivo corrompido: bits reservados em uso.");
  }

  const senderId = bytes[6];
  validateSenderId(senderId);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const createdAt = Number(view.getBigUint64(7, false));

  return {
    version,
    flags,
    senderId,
    createdAt,
    compressed: Boolean(flags & FLAG_COMPRESSED),
    iv: bytes.slice(AAD_SIZE, HEADER_SIZE),
    ciphertext: bytes.slice(HEADER_SIZE),
    aad: bytes.slice(0, AAD_SIZE),
  };
}

export function fileName(createdAt) {
  const d = new Date(createdAt);
  const p = (n) => String(n).padStart(2, "0");
  const stamp =
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `msg-${stamp}${EXTENSION}`;
}

function validateSenderId(senderId) {
  if (senderId !== 0 && senderId !== 1) {
    throw new FormatError(`sender_id inválido: ${senderId}. Esperado 0 ou 1.`);
  }
}

function validateCreatedAt(createdAt) {
  if (!Number.isSafeInteger(createdAt) || createdAt < 0) {
    throw new FormatError(`created_at inválido: ${createdAt}.`);
  }
}
