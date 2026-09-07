export class EnvironmentError extends Error {
  constructor(title, detail) {
    super(title);
    this.name = "EnvironmentError";
    this.title = title;
    this.detail = detail;
  }
}

export function requireSecureContext() {
  if (!window.isSecureContext) {
    throw new EnvironmentError(
      "HTTPS obrigatório",
      "O navegador só libera as funções de criptografia em https:// ou localhost. " +
        `Esta página foi aberta em ${location.protocol}//${location.host}.`
    );
  }
  if (!window.crypto?.subtle) {
    throw new EnvironmentError(
      "Navegador sem suporte",
      "A Web Crypto API não está disponível neste navegador."
    );
  }
}

export async function requestPersistentStorage() {
  if (!navigator.storage?.persist) {
    return false;
  }
  try {
    return await navigator.storage.persist();
  } catch {
    return false;
  }
}
