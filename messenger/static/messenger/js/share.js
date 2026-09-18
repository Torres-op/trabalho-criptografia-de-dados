import { toArmor } from "./armor.js";

export const PASTE_INTRO = "Mensagem criptografada do Treehash. Abra no tradutor do app:";

export function pasteBlock(bytes) {
  return `${PASTE_INTRO}\n\n${toArmor(bytes)}`;
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
