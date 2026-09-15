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
    saveMessage: (file, direction) =>
      requestJson(endpoints.messages, {
        method: "POST",
        body: { blob: toBase64(file), direction },
        csrfToken,
      }),
  };
}
