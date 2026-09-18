import { describe, expect, it } from "vitest";

import { buildSignals, summarize } from "../messenger/static/messenger/js/badge.js";

const complete = {
  peerUsername: "marcio",
  localKey: true,
  peerKey: true,
  verified: true,
  backup: true,
};

describe("sinais do indicador (12.4)", () => {
  it("cobre os quatro sinais previstos no item", () => {
    expect(buildSignals(complete).map((signal) => signal.id)).toEqual([
      "localKey",
      "peerKey",
      "verified",
      "backup",
    ]);
  });

  it("fica pronto só quando os quatro estão em ordem", () => {
    expect(summarize(buildSignals(complete))).toEqual({ ok: 4, total: 4, ready: true });
  });

  it("conta quantos sinais faltam", () => {
    const signals = buildSignals({ ...complete, verified: false, backup: false });

    expect(summarize(signals)).toEqual({ ok: 2, total: 4, ready: false });
  });

  it("usa o nome do outro usuário no rótulo", () => {
    const [, peerKey] = buildSignals(complete);

    expect(peerKey.label).toBe("Chave de marcio");
  });

  it("cada sinal negativo diz o que resolve", () => {
    for (const signal of buildSignals({ peerUsername: "marcio" })) {
      expect(signal.ok).toBe(false);
      expect(signal.hint.length).toBeGreaterThan(20);
    }
  });

  it("a dica muda conforme o sinal está em ordem ou não", () => {
    const [ligado] = buildSignals(complete);
    const [desligado] = buildSignals({ ...complete, localKey: false });

    expect(ligado.hint).not.toBe(desligado.hint);
    expect(desligado.hint).toMatch(/backup/);
  });

  it("valor ausente conta como sinal negativo", () => {
    expect(summarize(buildSignals({ peerUsername: "marcio" })).ok).toBe(0);
  });
});
