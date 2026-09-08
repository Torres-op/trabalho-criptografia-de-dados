import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EnvironmentError,
  requestPersistentStorage,
  requireSecureContext,
} from "../messenger/static/messenger/js/environment.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("guarda de contexto seguro (1.8)", () => {
  it("passa quando o contexto é seguro e a Web Crypto existe", () => {
    expect(() => requireSecureContext()).not.toThrow();
  });

  it("bloqueia fora de contexto seguro", () => {
    vi.stubGlobal("isSecureContext", false);
    expect(() => requireSecureContext()).toThrow(EnvironmentError);
    expect(() => requireSecureContext()).toThrow("HTTPS obrigatório");
  });

  it("explica o motivo em vez de estourar erro genérico", () => {
    vi.stubGlobal("isSecureContext", false);
    expect.assertions(2);
    try {
      requireSecureContext();
    } catch (error) {
      expect(error.title).toBe("HTTPS obrigatório");
      expect(error.detail).toMatch(/https:\/\/ ou localhost/);
    }
  });

  it("inclui a origem na mensagem quando existe location", () => {
    vi.stubGlobal("isSecureContext", false);
    vi.stubGlobal("location", { protocol: "http:", host: "192.168.1.15:8000" });
    expect.assertions(1);
    try {
      requireSecureContext();
    } catch (error) {
      expect(error.detail).toContain("http://192.168.1.15:8000");
    }
  });

  it("funciona sem location, como num Web Worker", () => {
    vi.stubGlobal("isSecureContext", false);
    vi.stubGlobal("location", undefined);
    expect(() => requireSecureContext()).toThrow(EnvironmentError);
  });

  it("acusa navegador sem Web Crypto mesmo em contexto seguro", () => {
    vi.stubGlobal("crypto", {});
    expect(() => requireSecureContext()).toThrow("Navegador sem suporte");
  });
});

describe("armazenamento persistente (4.9)", () => {
  it("devolve false quando a API não existe", async () => {
    vi.stubGlobal("navigator", undefined);
    expect(await requestPersistentStorage()).toBe(false);
  });

  it("devolve o que o navegador respondeu", async () => {
    vi.stubGlobal("navigator", { storage: { persist: async () => true } });
    expect(await requestPersistentStorage()).toBe(true);

    vi.stubGlobal("navigator", { storage: { persist: async () => false } });
    expect(await requestPersistentStorage()).toBe(false);
  });

  it("devolve false em vez de propagar erro do navegador", async () => {
    vi.stubGlobal("navigator", {
      storage: {
        persist: async () => {
          throw new Error("negado");
        },
      },
    });
    await expect(requestPersistentStorage()).resolves.toBe(false);
  });

  it("não quebra quando navigator existe mas storage não", async () => {
    vi.stubGlobal("navigator", {});
    expect(await requestPersistentStorage()).toBe(false);
  });
});
