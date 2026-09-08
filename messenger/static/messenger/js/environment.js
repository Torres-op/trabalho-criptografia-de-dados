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
