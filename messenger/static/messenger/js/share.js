import { toArmor } from "./armor.js";

export const MAIL_SUBJECT = "Mensagem criptografada do Treehash";
export const PASTE_INTRO = "Mensagem criptografada do Treehash. Abra no tradutor do app:";
export const FILE_TYPE = "application/octet-stream";

export function mailBody(name) {
  return [
    "Segue uma mensagem criptografada.",
    "",
    `Anexe o arquivo ${name} antes de enviar, ou cole aqui o bloco de texto gerado pelo app —`,
    "este botão abre o seu programa de e-mail, mas não consegue anexar o arquivo sozinho.",
    "",
    "Para ler, abra o tradutor do Treehash e envie o arquivo recebido.",
  ].join("\n");
}

export function mailtoLink(name) {
  const subject = encodeURIComponent(MAIL_SUBJECT);
  const body = encodeURIComponent(mailBody(name));
  return `mailto:?subject=${subject}&body=${body}`;
}

export function pasteBlock(bytes) {
  return `${PASTE_INTRO}\n\n${toArmor(bytes)}`;
}

export function fileFor(bytes, name) {
  return new File([bytes], name, { type: FILE_TYPE });
}

export function canShareFile(file) {
  const target = globalThis.navigator;
  if (typeof target?.share !== "function" || typeof target?.canShare !== "function") {
    return false;
  }

  try {
    return target.canShare({ files: [file] });
  } catch {
    return false;
  }
}

export async function shareFile(file) {
  try {
    await globalThis.navigator.share({ files: [file], title: file.name });
    return "shared";
  } catch (error) {
    return error?.name === "AbortError" ? "cancelled" : "failed";
  }
}

export async function copyText(text) {
  const clipboard = globalThis.navigator?.clipboard;
  if (typeof clipboard?.writeText !== "function") {
    return false;
  }

  try {
    await clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}
