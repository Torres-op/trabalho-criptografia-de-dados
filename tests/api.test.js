import { afterEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  createRemote,
  readSessionData,
  requestJson,
  requestStatus,
  sha256Hex,
  toBase64,
} from "../messenger/static/messenger/js/api.js";

const SESSAO = {
  username: "diretor",
  peerUsername: "marcio",
  csrfToken: "token-123",
  endpoints: {
    publishPublicKey: "/api/public-key/",
    peerPublicKey: "/api/public-key/marcio/",
    messages: "/api/messages/",
  },
};

const documentoCom = (dados) => ({
  getElementById: (id) =>
    id === "session-data" && dados !== undefined ? { textContent: JSON.stringify(dados) } : null,
});

function fetchFalso(status, payload, { json = true } = {}) {
  const mock = vi.fn(async () => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => {
      if (!json) {
        throw new SyntaxError("não é JSON");
      }
      return payload;
    },
  }));
  vi.stubGlobal("fetch", mock);
  return mock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("readSessionData", () => {
  it("lê os dados que a página publicou", () => {
    expect(readSessionData(documentoCom(SESSAO))).toEqual(SESSAO);
  });

  it("acusa página sem dados de sessão", () => {
    expect(() => readSessionData(documentoCom(undefined))).toThrow(/Faça login novamente/);
  });

  it("acusa dados incompletos", () => {
    expect(() => readSessionData(documentoCom({ ...SESSAO, peerUsername: "" }))).toThrow(
      /incompletos/
    );
    expect(() => readSessionData(documentoCom({ ...SESSAO, endpoints: null }))).toThrow(
      /incompletos/
    );
  });
});

describe("requestJson", () => {
  it("devolve o JSON das respostas de sucesso", async () => {
    fetchFalso(200, { ok: true });
    expect(await requestJson("/x")).toEqual({ ok: true });
  });

  it("envia método, corpo JSON, token CSRF e cookies da mesma origem", async () => {
    const mock = fetchFalso(201, {});
    await requestJson("/api/x/", { method: "POST", body: { a: 1 }, csrfToken: "t" });

    const [url, opcoes] = mock.mock.calls[0];
    expect(url).toBe("/api/x/");
    expect(opcoes.method).toBe("POST");
    expect(opcoes.credentials).toBe("same-origin");
    expect(opcoes.headers["Content-Type"]).toBe("application/json");
    expect(opcoes.headers["X-CSRFToken"]).toBe("t");
    expect(JSON.parse(opcoes.body)).toEqual({ a: 1 });
  });

  it("não manda corpo nem Content-Type num GET", async () => {
    const mock = fetchFalso(200, {});
    await requestJson("/api/x/");
    const [, opcoes] = mock.mock.calls[0];
    expect(opcoes.body).toBeUndefined();
    expect(opcoes.headers).not.toHaveProperty("Content-Type");
  });

  it("traduz erro do servidor em ApiError com código e mensagem", async () => {
    fetchFalso(409, { error: "Já existe outra chave.", code: "key_conflict" });
    const erro = await requestJson("/x").catch((e) => e);

    expect(erro).toBeInstanceOf(ApiError);
    expect(erro.status).toBe(409);
    expect(erro.code).toBe("key_conflict");
    expect(erro.message).toBe("Já existe outra chave.");
  });

  it("usa mensagem genérica quando o erro não vem em JSON", async () => {
    fetchFalso(403, null, { json: false });
    const erro = await requestJson("/x").catch((e) => e);
    expect(erro.message).toMatch(/erro 403/);
    expect(erro.code).toBe("http_error");
  });

  it("traduz falha de rede em ApiError", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new TypeError("Failed to fetch")));
    const erro = await requestJson("/x").catch((e) => e);
    expect(erro).toBeInstanceOf(ApiError);
    expect(erro.code).toBe("network_error");
  });
});

describe("toBase64", () => {
  const decodificar = (texto) => Uint8Array.from(atob(texto), (c) => c.charCodeAt(0));

  it("codifica todos os valores de byte", () => {
    const bytes = Uint8Array.from({ length: 256 }, (_, i) => i);
    expect([...decodificar(toBase64(bytes))]).toEqual([...bytes]);
  });

  it("aguenta arquivos maiores que o limite de argumentos de uma chamada", () => {
    const bytes = Uint8Array.from({ length: 200_000 }, (_, i) => i % 251);
    expect(decodificar(toBase64(bytes))).toEqual(bytes);
  });

  it("codifica vazio como texto vazio", () => {
    expect(toBase64(new Uint8Array(0))).toBe("");
  });
});

describe("createRemote", () => {
  it("publica a chave no endpoint da sessão, com CSRF", async () => {
    const mock = fetchFalso(201, {});
    await createRemote(SESSAO).publishPublicKey({ kty: "EC" });

    const [url, opcoes] = mock.mock.calls[0];
    expect(url).toBe("/api/public-key/");
    expect(opcoes.method).toBe("POST");
    expect(opcoes.headers["X-CSRFToken"]).toBe("token-123");
    expect(JSON.parse(opcoes.body)).toEqual({ jwk: { kty: "EC" } });
  });

  it("busca a chave do outro usuário", async () => {
    const mock = fetchFalso(200, {});
    await createRemote(SESSAO).fetchPeerPublicKey();
    expect(mock.mock.calls[0][0]).toBe("/api/public-key/marcio/");
    expect(mock.mock.calls[0][1].method).toBe("GET");
  });

  it("salva a mensagem em base64 com a direção", async () => {
    const mock = fetchFalso(201, {});
    await createRemote(SESSAO).saveMessage(new Uint8Array([1, 2, 3]), "sent");

    const [url, opcoes] = mock.mock.calls[0];
    expect(url).toBe("/api/messages/");
    expect(JSON.parse(opcoes.body)).toEqual({ blob: "AQID", direction: "sent" });
  });
});

describe("sha256Hex", () => {
  it("devolve o hash em hexadecimal minúsculo", async () => {
    const bytes = new TextEncoder().encode("abc");

    expect(await sha256Hex(bytes)).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
  });

  it("dá o mesmo hash do servidor para bytes vazios", async () => {
    expect(await sha256Hex(new Uint8Array(0))).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
  });
});

describe("requestStatus", () => {
  it("devolve o código da resposta sem ler corpo nenhum", async () => {
    const mock = fetchFalso(404, null, { json: false });

    expect(await requestStatus("/api/messages/?hash=abc")).toBe(404);
    expect(mock.mock.calls[0][1].method).toBe("HEAD");
    expect(mock.mock.calls[0][1].credentials).toBe("same-origin");
  });

  it("vira ApiError quando a rede falha", async () => {
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("offline");
    });

    await expect(requestStatus("/api/messages/")).rejects.toThrow(ApiError);
  });
});

describe("createRemote.hasMessage", () => {
  const blob = new Uint8Array([1, 2, 3]);

  it("pergunta pelo hash do arquivo", async () => {
    const mock = fetchFalso(404, null, { json: false });
    await createRemote(SESSAO).hasMessage(blob);

    expect(mock.mock.calls[0][0]).toBe(`/api/messages/?hash=${await sha256Hex(blob)}`);
  });

  it("diz que já está salva quando o servidor responde 200", async () => {
    fetchFalso(200, null, { json: false });

    expect(await createRemote(SESSAO).hasMessage(blob)).toBe(true);
  });

  it("diz que não está salva quando o servidor responde 404", async () => {
    fetchFalso(404, null, { json: false });

    expect(await createRemote(SESSAO).hasMessage(blob)).toBe(false);
  });

  it("não engole outros códigos de erro", async () => {
    fetchFalso(500, null, { json: false });

    await expect(createRemote(SESSAO).hasMessage(blob)).rejects.toThrow(/erro 500/);
  });
});
