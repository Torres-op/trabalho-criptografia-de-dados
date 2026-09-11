import { beforeAll, describe, expect, it } from "vitest";

import {
  AES_LENGTH,
  AuthenticationError,
  HKDF_HASH,
  HKDF_INFO,
  KeyError,
  USERNAME_SEPARATOR,
  decrypt,
  deriveKey,
  deriveSalt,
  encrypt,
  orderUsernames,
} from "../messenger/static/messenger/js/crypto.js";
import { generateKeyPair } from "../messenger/static/messenger/js/keys.js";

const ALICE = "alice";
const BOB = "bob";

const bytes = (texto) => new TextEncoder().encode(texto);
const aad = () => new Uint8Array([0x54, 0x52, 0x48, 0x53, 1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);

let alice;
let bob;
let chaveDaAlice;
let chaveDoBob;

beforeAll(async () => {
  [alice, bob] = await Promise.all([generateKeyPair(), generateKeyPair()]);
  chaveDaAlice = await deriveKey(alice.privateKey, bob.publicKey, ALICE, BOB);
  chaveDoBob = await deriveKey(bob.privateKey, alice.publicKey, ALICE, BOB);
});

describe("ordenação dos usernames (D4)", () => {
  it("devolve sempre a mesma ordem, venha como vier", () => {
    expect(orderUsernames(ALICE, BOB)).toEqual([ALICE, BOB]);
    expect(orderUsernames(BOB, ALICE)).toEqual([ALICE, BOB]);
  });

  it("usa ordem de unidades de código, não ordem de locale", () => {
    expect(orderUsernames("Zoe", "ana")).toEqual(["Zoe", "ana"]);
  });

  it("recusa nomes iguais ou vazios", () => {
    expect(() => orderUsernames(ALICE, ALICE)).toThrow(/não podem ser iguais/);
    expect(() => orderUsernames("", BOB)).toThrow(KeyError);
    expect(() => orderUsernames(null, BOB)).toThrow(KeyError);
  });
});

describe("salt (D4)", () => {
  it("tem 32 bytes, como manda o SHA-256", async () => {
    expect((await deriveSalt(ALICE, BOB)).length).toBe(32);
  });

  it("independe da ordem dos argumentos", async () => {
    const a = await deriveSalt(ALICE, BOB);
    const b = await deriveSalt(BOB, ALICE);
    expect([...a]).toEqual([...b]);
  });

  it("muda quando a dupla de usuários muda", async () => {
    const a = await deriveSalt(ALICE, BOB);
    const b = await deriveSalt(ALICE, "carol");
    expect([...a]).not.toEqual([...b]);
  });

  it("separa os nomes por NUL, e não por caractere imprimível", async () => {
    expect(USERNAME_SEPARATOR).toBe(String.fromCharCode(0));
    expect(USERNAME_SEPARATOR.charCodeAt(0)).toBe(0);

    const material = `${ALICE}${USERNAME_SEPARATOR}${BOB}`;
    const esperado = new Uint8Array(
      await crypto.subtle.digest(HKDF_HASH, new TextEncoder().encode(material))
    );
    expect([...(await deriveSalt(ALICE, BOB))]).toEqual([...esperado]);
  });

  it("não confunde duplas que colidiriam com separador comum", async () => {
    const a = await deriveSalt("ana", "luiza-silva");
    const b = await deriveSalt("ana-luiza", "silva");
    expect([...a]).not.toEqual([...b]);
  });
});

describe("derivação da chave compartilhada (4.5)", () => {
  it("produz uma chave AES-GCM de 256 bits, não extraível", () => {
    expect(chaveDaAlice.algorithm.name).toBe("AES-GCM");
    expect(chaveDaAlice.algorithm.length).toBe(AES_LENGTH);
    expect(chaveDaAlice.extractable).toBe(false);
    expect([...chaveDaAlice.usages].sort()).toEqual(["decrypt", "encrypt"]);
  });

  it("usa o info fixado em D4", () => {
    expect(HKDF_INFO).toBe("treehash/v1/aes-gcm-256");
  });

  it("é determinística: derivar de novo dá a mesma chave", async () => {
    const outra = await deriveKey(alice.privateKey, bob.publicKey, ALICE, BOB);
    const conteudo = bytes("determinismo");
    const cifrado = await encrypt(conteudo, chaveDaAlice, aad());
    const aberto = await decrypt(cifrado.iv, cifrado.ciphertext, outra, aad());
    expect([...aberto]).toEqual([...conteudo]);
  });

  it("recusa chaves ausentes ou trocadas de papel", async () => {
    await expect(deriveKey(null, bob.publicKey, ALICE, BOB)).rejects.toThrow(KeyError);
    await expect(deriveKey(alice.privateKey, null, ALICE, BOB)).rejects.toThrow(KeyError);
    await expect(
      deriveKey(alice.publicKey, bob.publicKey, ALICE, BOB)
    ).rejects.toThrow(/Chave privada/);
    await expect(
      deriveKey(alice.privateKey, bob.privateKey, ALICE, BOB)
    ).rejects.toThrow(/Chave pública/);
  });
});

describe("interoperabilidade entre os dois lados (14.4)", () => {
  it("Alice cifra e Bob decifra", async () => {
    const conteudo = bytes("Mensagem da Alice para o Bob, com acentuação.");
    const cifrado = await encrypt(conteudo, chaveDaAlice, aad());
    const aberto = await decrypt(cifrado.iv, cifrado.ciphertext, chaveDoBob, aad());
    expect(new TextDecoder().decode(aberto)).toBe(
      "Mensagem da Alice para o Bob, com acentuação."
    );
  });

  it("Bob cifra e Alice decifra", async () => {
    const conteudo = bytes("Resposta do Bob.");
    const cifrado = await encrypt(conteudo, chaveDoBob, aad());
    const aberto = await decrypt(cifrado.iv, cifrado.ciphertext, chaveDaAlice, aad());
    expect([...aberto]).toEqual([...conteudo]);
  });

  it("um terceiro par de chaves não abre a conversa", async () => {
    const carol = await generateKeyPair();
    const chaveDaCarol = await deriveKey(carol.privateKey, alice.publicKey, ALICE, "carol");

    const cifrado = await encrypt(bytes("segredo"), chaveDaAlice, aad());
    await expect(
      decrypt(cifrado.iv, cifrado.ciphertext, chaveDaCarol, aad())
    ).rejects.toThrow(AuthenticationError);
  });

  it("chave derivada com outra dupla de usernames não abre", async () => {
    const outraDupla = await deriveKey(alice.privateKey, bob.publicKey, ALICE, "carol");
    const cifrado = await encrypt(bytes("segredo"), chaveDaAlice, aad());
    await expect(
      decrypt(cifrado.iv, cifrado.ciphertext, outraDupla, aad())
    ).rejects.toThrow(AuthenticationError);
  });
});

describe("cifragem (4.6)", () => {
  it("gera IV de 12 bytes", async () => {
    const { iv } = await encrypt(bytes("teste"), chaveDaAlice, aad());
    expect(iv.length).toBe(12);
  });

  it("gera IV e ciphertext diferentes para o mesmo texto", async () => {
    const conteudo = bytes("mesma mensagem");
    const a = await encrypt(conteudo, chaveDaAlice, aad());
    const b = await encrypt(conteudo, chaveDaAlice, aad());

    expect([...a.iv]).not.toEqual([...b.iv]);
    expect([...a.ciphertext]).not.toEqual([...b.ciphertext]);
  });

  it("acrescenta os 16 bytes da tag GCM ao tamanho do conteúdo", async () => {
    const conteudo = bytes("doze bytes!!");
    const { ciphertext } = await encrypt(conteudo, chaveDaAlice, aad());
    expect(ciphertext.length).toBe(conteudo.length + 16);
  });

  it("cifra conteúdo vazio", async () => {
    const cifrado = await encrypt(new Uint8Array(0), chaveDaAlice, aad());
    expect(cifrado.ciphertext.length).toBe(16);
    const aberto = await decrypt(cifrado.iv, cifrado.ciphertext, chaveDoBob, aad());
    expect(aberto.length).toBe(0);
  });

  it("recusa cifrar sem chave, com a mensagem prevista em 9.5", async () => {
    await expect(encrypt(bytes("x"), null, aad())).rejects.toThrow(/troca de chaves/);
  });
});

describe("rejeição de adulteração (4.7)", () => {
  const cifrar = () => encrypt(bytes("conteúdo autêntico"), chaveDaAlice, aad());

  it("rejeita ciphertext com um bit trocado", async () => {
    const { iv, ciphertext } = await cifrar();
    ciphertext[3] ^= 0x01;
    await expect(decrypt(iv, ciphertext, chaveDoBob, aad())).rejects.toThrow(
      AuthenticationError
    );
  });

  it("rejeita adulteração na tag, no fim do ciphertext", async () => {
    const { iv, ciphertext } = await cifrar();
    ciphertext[ciphertext.length - 1] ^= 0x80;
    await expect(decrypt(iv, ciphertext, chaveDoBob, aad())).rejects.toThrow(
      AuthenticationError
    );
  });

  it("rejeita IV alterado", async () => {
    const { iv, ciphertext } = await cifrar();
    iv[0] ^= 0xff;
    await expect(decrypt(iv, ciphertext, chaveDoBob, aad())).rejects.toThrow(
      AuthenticationError
    );
  });

  it("rejeita AAD alterado, protegendo o cabeçalho do D5", async () => {
    const { iv, ciphertext } = await cifrar();
    const cabecalhoFalso = aad();
    cabecalhoFalso[6] = 1;
    await expect(decrypt(iv, ciphertext, chaveDoBob, cabecalhoFalso)).rejects.toThrow(
      AuthenticationError
    );
  });

  it("rejeita AAD ausente quando a cifragem usou um", async () => {
    const { iv, ciphertext } = await cifrar();
    await expect(
      decrypt(iv, ciphertext, chaveDoBob, new Uint8Array(0))
    ).rejects.toThrow(AuthenticationError);
  });

  it("rejeita IV com tamanho errado antes de chamar a Web Crypto", async () => {
    const { ciphertext } = await cifrar();
    await expect(
      decrypt(new Uint8Array(8), ciphertext, chaveDoBob, aad())
    ).rejects.toThrow(/vetor de inicialização/);
  });

  it("rejeita ciphertext menor que a tag", async () => {
    const { iv } = await cifrar();
    await expect(
      decrypt(iv, new Uint8Array(8), chaveDoBob, aad())
    ).rejects.toThrow(/menor que a assinatura/);
  });

  it("nunca devolve texto decifrado errado em vez de erro", async () => {
    for (let posicao = 0; posicao < 8; posicao++) {
      const { iv, ciphertext } = await cifrar();
      ciphertext[posicao] ^= 0xff;
      await expect(decrypt(iv, ciphertext, chaveDoBob, aad())).rejects.toThrow(
        AuthenticationError
      );
    }
  });
});
