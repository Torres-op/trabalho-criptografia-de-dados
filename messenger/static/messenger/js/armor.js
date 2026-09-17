export class ArmorError extends Error {
  constructor(message) {
    super(message);
    this.name = "ArmorError";
  }
}

export const ARMOR_HEADER = "-----BEGIN MENC-----";
export const ARMOR_FOOTER = "-----END MENC-----";
export const LINE_LENGTH = 64;

export function toArmor(bytes) {
  if (!(bytes instanceof Uint8Array)) {
    throw new ArmorError("Entrada inválida: esperado Uint8Array.");
  }
  if (bytes.length === 0) {
    throw new ArmorError("Bloco de mensagem está vazio.");
  }

  const base64 = bytesToBase64(bytes);
  const lines = [];
  for (let i = 0; i < base64.length; i += LINE_LENGTH) {
    lines.push(base64.slice(i, i + LINE_LENGTH));
  }

  return [ARMOR_HEADER, ...lines, ARMOR_FOOTER].join("\n");
}

export function fromArmor(text) {
  if (typeof text !== "string") {
    throw new ArmorError("Entrada inválida: esperado texto.");
  }

  const headerIndex = text.indexOf(ARMOR_HEADER);
  const footerIndex = text.indexOf(ARMOR_FOOTER);

  if (headerIndex === -1 || footerIndex === -1) {
    throw new ArmorError(
      "Este texto não contém um bloco de mensagem criptografada reconhecível."
    );
  }
  if (footerIndex < headerIndex) {
    throw new ArmorError("Bloco de mensagem malformado: marcadores fora de ordem.");
  }

  const body = text.slice(headerIndex + ARMOR_HEADER.length, footerIndex);
  const base64 = body.replace(/\s+/g, "");

  if (base64.length === 0) {
    throw new ArmorError("Bloco de mensagem está vazio.");
  }

  try {
    return base64ToBytes(base64);
  } catch {
    throw new ArmorError("Conteúdo do bloco não é base64 válido.");
  }
}

function bytesToBase64(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function base64ToBytes(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}