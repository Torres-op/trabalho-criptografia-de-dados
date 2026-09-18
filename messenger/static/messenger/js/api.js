export class ApiError extends Error {
  constructor(message, { status = 0, code = "network_error" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

const REQUIRED_SESSION_FIELDS = Object.freeze(["username", "peerUsername", "csrfToken"]);

export function readSessionData(root = globalThis.document) {
  const element = root?.getElementById?.("session-data");
  if (!element) {
    throw new ApiError(
      "Os dados da sessão não foram encontrados na página. Faça login novamente.",
      { code: "missing_session" }
    );
  }

  const data = JSON.parse(element.textContent);
  const missing = REQUIRED_SESSION_FIELDS.filter(
    (field) => typeof data?.[field] !== "string" || data[field].length === 0
  );
  if (missing.length > 0 || typeof data.endpoints !== "object" || data.endpoints === null) {
    throw new ApiError("Os dados da sessão estão incompletos. Recarregue a página.", {
      code: "invalid_session",
    });
  }
  return data;
}

export async function requestJson(url, { method = "GET", body, csrfToken } = {}) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
  }
  if (csrfToken) {
    headers["X-CSRFToken"] = csrfToken;
  }

  let response;
  try {
    response = await fetch(url, {
      method,
      headers,
      credentials: "same-origin",
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError("Não foi possível falar com o servidor. Verifique a conexão.", {
      code: "network_error",
    });
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }

  if (!response.ok) {
    throw new ApiError(payload?.error ?? `O servidor respondeu com erro ${response.status}.`, {
      status: response.status,
      code: payload?.code ?? "http_error",
    });
  }
  return payload;
}

export async function sha256Hex(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function requestStatus(url, { method = "HEAD" } = {}) {
  try {
    const response = await fetch(url, { method, credentials: "same-origin" });
    return response.status;
  } catch {
    throw new ApiError("Não foi possível falar com o servidor. Verifique a conexão.", {
      code: "network_error",
    });
  }
}

export function fromBase64(text) {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

export function toBase64(bytes) {
  const chunk = 0x8000;
  let binary = "";
  for (let start = 0; start < bytes.length; start += chunk) {
    binary += String.fromCharCode(...bytes.subarray(start, start + chunk));
  }
  return btoa(binary);
}

export function createRemote(session) {
  const { endpoints, csrfToken } = session;
  return {
    publishPublicKey: (jwk) =>
      requestJson(endpoints.publishPublicKey, { method: "POST", body: { jwk }, csrfToken }),
    fetchPeerPublicKey: () => requestJson(endpoints.peerPublicKey),
    listMessages: (filters = {}) => {
      const query = new URLSearchParams();
      for (const [key, value] of Object.entries(filters)) {
        if (value !== undefined && value !== null && value !== "") {
          query.set(key, value);
        }
      }
      const search = query.toString();
      return requestJson(search ? `${endpoints.messages}?${search}` : endpoints.messages);
    },
    fetchBlob: (id) => requestJson(`${endpoints.messages}${id}/blob/`),
    hasMessage: async (file) => {
      const status = await requestStatus(`${endpoints.messages}?hash=${await sha256Hex(file)}`);
      if (status !== 200 && status !== 404) {
        throw new ApiError(`O servidor respondeu com erro ${status}.`, {
          status,
          code: "http_error",
        });
      }
      return status === 200;
    },
    saveKeyBackup: (bytes) =>
      requestJson(endpoints.keyBackup, {
        method: "POST",
        body: { blob: toBase64(bytes) },
        csrfToken,
      }),
    fetchKeyBackup: () => requestJson(endpoints.keyBackup),
    verifyFingerprint: (value) =>
      requestJson(endpoints.fingerprint, {
        method: "POST",
        body: { fingerprint: value },
        csrfToken,
      }),
    saveMessage: (file, direction) =>
      requestJson(endpoints.messages, {
        method: "POST",
        body: { blob: toBase64(file), direction },
        csrfToken,
      }),
  };
}
