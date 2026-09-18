export class EnvironmentError extends Error {
  constructor(title, detail) {
    super(title);
    this.name = "EnvironmentError";
    this.title = title;
    this.detail = detail;
  }
}

export function requireSecureContext() {
  if (!globalThis.isSecureContext) {
    const origin = globalThis.location
      ? ` Esta página foi aberta em ${location.protocol}//${location.host}.`
      : "";
    throw new EnvironmentError(
      "HTTPS obrigatório",
      "O navegador só libera as funções de criptografia em https:// ou localhost." + origin
    );
  }
  if (!globalThis.crypto?.subtle) {
    throw new EnvironmentError(
      "Navegador sem suporte",
      "A Web Crypto API não está disponível neste navegador."
    );
  }
}

export async function requestPersistentStorage() {
  if (!globalThis.navigator?.storage?.persist) {
    return false;
  }
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}

export const PERSISTENCE_NOTICE =
  "O navegador não garantiu armazenamento permanente para este site e você ainda não guardou " +
  "um backup da sua chave. Se ele limpar os dados do site, a chave some junto e o histórico " +
  "fica ilegível. Guarde o backup na tela de Identidade.";

export function storageNotices({ persisted = false, backup = false } = {}) {
  return persisted || backup ? [] : [PERSISTENCE_NOTICE];
}
