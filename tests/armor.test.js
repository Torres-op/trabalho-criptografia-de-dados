import { describe, expect, it } from "vitest";

import {
  ARMOR_FOOTER,
  ARMOR_HEADER,
  ArmorError,
  fromArmor,
  toArmor,
} from "../messenger/static/messenger/js/armor.js";

const amostra = () =>
  new Uint8Array([0x4d, 0x45, 0x4e, 0x43, 1, 0, 0, 255, 254, 253, 10, 20, 30]);

describe("formato armored (D6)", () => {
  it("envolve o conteúdo com os marcadores esperados", () => {
    const armored = toArmor(amostra());
    expect(armored.startsWith(ARMOR_HEADER)).toBe(true);
    expect(armored.endsWith(ARMOR_FOOTER)).toBe(true);
  });

  it("quebra o base64 em linhas de até 64 caracteres", () => {
    const bytes = new Uint8Array(200).map((_, i) => i % 256);
    const linhas = toArmor(bytes).split("\n").slice(1, -1);
    for (const linha of linhas) {
      expect(linha.length).toBeLessThanOrEqual(64);
    }
  });

  it("faz round-trip com bytes arbitrários", () => {
    const bytes = new Uint8Array(300).map((_, i) => (i * 37) % 256);
    expect([...fromArmor(toArmor(bytes))]).toEqual([...bytes]);
  });

  it("faz round-trip com um único byte", () => {
    expect([...fromArmor(toArmor(new Uint8Array([42])))]).toEqual([42]);
  });
});

describe("tolerância na leitura (o WhatsApp adiciona contexto ao redor)", () => {
  it("ignora texto antes e depois dos marcadores", () => {
    const armored = toArmor(amostra());
    const comLixo = `Oi, segue a mensagem:\n\n${armored}\n\nQualquer dúvida me chama!`;
    expect([...fromArmor(comLixo)]).toEqual([...amostra()]);
  });

  it("ignora espaços em branco e quebras de linha extras dentro do bloco", () => {
    const armored = toArmor(amostra());
    const comEspacos = armored.replace(/\n/g, "\n\n   ");
    expect([...fromArmor(comEspacos)]).toEqual([...amostra()]);
  });
});

describe("rejeição de entrada inválida", () => {
  it("rejeita texto sem os marcadores", () => {
    expect(() => fromArmor("apenas um texto qualquer")).toThrow(ArmorError);
    expect(() => fromArmor("apenas um texto qualquer")).toThrow(/não contém/);
  });

  it("rejeita quando falta o marcador final", () => {
    const semRodape = toArmor(amostra()).split("\n").slice(0, -1).join("\n");
    expect(() => fromArmor(semRodape)).toThrow(ArmorError);
  });

  it("rejeita marcadores fora de ordem", () => {
    const invertido = `${ARMOR_FOOTER}\nQUJD\n${ARMOR_HEADER}`;
    expect(() => fromArmor(invertido)).toThrow(/fora de ordem/);
  });

  it("rejeita bloco vazio entre os marcadores", () => {
    expect(() => fromArmor(`${ARMOR_HEADER}\n${ARMOR_FOOTER}`)).toThrow(/vazio/);
  });

  it("rejeita conteúdo que não é base64 válido", () => {
    expect(() =>
      fromArmor(`${ARMOR_HEADER}\n!!!não é base64!!!\n${ARMOR_FOOTER}`)
    ).toThrow(/base64 válido/);
  });

  it.each([
    ["null", null],
    ["número", 42],
  ])("rejeita fromArmor com %s", (_rotulo, valor) => {
    expect(() => fromArmor(valor)).toThrow(ArmorError);
  });

  it.each([
    ["string", "não é bytes"],
    ["array comum", [1, 2, 3]],
  ])("rejeita toArmor com %s", (_rotulo, valor) => {
    expect(() => toArmor(valor)).toThrow(ArmorError);
  });
});