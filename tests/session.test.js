import { afterEach, describe, expect, it } from "vitest";

import { ApiError } from "../messenger/static/messenger/js/api.js";
import { composeMessage, openSession, readMessage } from "../messenger/static/messenger/js/app.js";
import {
  exportPublicKey,
  forgetPendingKeyPair,
  generateKeyPair,
  loadPeerPublicKey,
  samePublicKey,
} from "../messenger/static/messenger/js/keys.js";
import { DATABASE_NAME, closeDatabase } from "../messenger/static/messenger/js/keystore.js";

const DIRETOR = "diretor";
const MARCIO = "marcio";

function servidorFalso() {
  const chaves = new Map();

  const remoteFor = (username, peerUsername) => ({
    async publishPublicKey(jwk) {
      const existente = chaves.get(username);
      if (existente && !samePublicKey(existente, jwk)) {
        throw new ApiError("Já existe outra chave pública registrada para você no servidor.", {
          status: 409,
          code: "key_conflict",
        });
      }
      chaves.set(username, jwk);
      return { username, jwk };
    },
    async fetchPeerPublicKey() {
      const jwk = chaves.get(peerUsername);
      if (!jwk) {
        throw new ApiError(`${peerUsername} ainda não registrou uma chave pública.`, {
          status: 404,
          code: "key_not_published",
        });
      }
      return { username: peerUsername, jwk };
    },
    async saveMessage() {
      return {};
    },
  });

  return { chaves, remoteFor };
}

const semRede = () => new ApiError("Não foi possível falar com o servidor.", { code: "network_error" });

const offline = {
  async publishPublicKey() {
    throw semRede();
  },
  async fetchPeerPublicKey() {
    throw semRede();
  },
};

const contexto = (username, peerUsername) => ({ username, peerUsername });

async function abrir(servidor, username, peerUsername) {
  return openSession(contexto(username, peerUsername), servidor.remoteFor(username, peerUsername));
}

async function trocaCompleta(servidor) {
  await abrir(servidor, DIRETOR, MARCIO);
  const marcio = await abrir(servidor, MARCIO, DIRETOR);
  const diretor = await abrir(servidor, DIRETOR, MARCIO);
  return { diretor, marcio };
}

afterEach(async () => {
  forgetPendingKeyPair();
  closeDatabase();
  await new Promise((resolve) => {
    const request = indexedDB.deleteDatabase(DATABASE_NAME);
    request.onsuccess = resolve;
    request.onerror = resolve;
    request.onblocked = resolve;
  });
});

describe("primeiro acesso", () => {
  it("publica a chave local mesmo sem a do outro usuário", async () => {
    const servidor = servidorFalso();
    const sessao = await abrir(servidor, DIRETOR, MARCIO);

    expect(sessao.ready).toBe(false);
    expect(sessao.localKeyCreated).toBe(true);
    expect(servidor.chaves.has(DIRETOR)).toBe(true);
  });

  it("explica que o outro usuário ainda não acessou", async () => {
    const sessao = await abrir(servidorFalso(), DIRETOR, MARCIO);
    expect(sessao.reason).toMatch(/marcio ainda não acessou o app/);
  });
});

describe("troca de chaves completa (4.4)", () => {
  it("fica pronta para os dois depois que ambos acessam", async () => {
    const { diretor, marcio } = await trocaCompleta(servidorFalso());
    expect(diretor.ready).toBe(true);
    expect(marcio.ready).toBe(true);
  });

  it("dá sender_id 0 e 1 conforme a ordem dos nomes", async () => {
    const { diretor, marcio } = await trocaCompleta(servidorFalso());
    expect(diretor.senderId).toBe(0);
    expect(marcio.senderId).toBe(1);
  });

  it("o que um compõe o outro lê, ponta a ponta", async () => {
    const { diretor, marcio } = await trocaCompleta(servidorFalso());
    const texto = "Reunião confirmada para às 14h de amanhã. Levo os gráficos.";

    const { file } = await composeMessage(texto, diretor);
    const lida = await readMessage(file, marcio);

    expect(lida.text).toBe(texto);
    expect(lida.senderId).toBe(diretor.senderId);
  });

  it("guarda a chave do outro no navegador para os próximos acessos", async () => {
    const servidor = servidorFalso();
    await trocaCompleta(servidor);
    const cache = await loadPeerPublicKey(DIRETOR);
    expect(samePublicKey(cache.jwk, servidor.chaves.get(MARCIO))).toBe(true);
  });

  it("dá a cada usuário do mesmo navegador o próprio par de chaves", async () => {
    const servidor = servidorFalso();
    await trocaCompleta(servidor);
    expect(servidor.chaves.get(DIRETOR).x).not.toBe(servidor.chaves.get(MARCIO).x);
  });
});

describe("conflito de chave (write-once do 4.3)", () => {
  it("não fica pronta se o servidor já tem outra chave para o usuário", async () => {
    const servidor = servidorFalso();
    servidor.chaves.set(DIRETOR, await exportPublicKey((await generateKeyPair()).publicKey));

    const sessao = await abrir(servidor, DIRETOR, MARCIO);

    expect(sessao.ready).toBe(false);
    expect(sessao.reason).toMatch(/Já existe outra chave pública/);
  });
});

describe("sem conexão com o servidor", () => {
  it("usa a chave do outro guardada no navegador", async () => {
    await trocaCompleta(servidorFalso());

    const sessao = await openSession(contexto(DIRETOR, MARCIO), offline);

    expect(sessao.ready).toBe(true);
    expect(sessao.notices.join(" ")).toMatch(/usando a chave de marcio guardada/);
  });

  it("não fica pronta quando nunca houve troca de chaves", async () => {
    const sessao = await openSession(contexto(DIRETOR, MARCIO), offline);
    expect(sessao.ready).toBe(false);
    expect(sessao.reason).toMatch(/Não foi possível buscar a chave pública de marcio/);
  });

  it("segue em frente se só a publicação falhar", async () => {
    const servidor = servidorFalso();
    await trocaCompleta(servidor);
    const remoto = {
      ...servidor.remoteFor(DIRETOR, MARCIO),
      async publishPublicKey() {
        throw semRede();
      },
    };

    const sessao = await openSession(contexto(DIRETOR, MARCIO), remoto);

    expect(sessao.ready).toBe(true);
    expect(sessao.notices.join(" ")).toMatch(/Não foi possível confirmar sua chave pública/);
  });
});

describe("mudança da chave do outro usuário", () => {
  it("avisa e passa a usar a chave nova", async () => {
    const servidor = servidorFalso();
    await trocaCompleta(servidor);
    const nova = await exportPublicKey((await generateKeyPair()).publicKey);
    servidor.chaves.set(MARCIO, nova);

    const sessao = await abrir(servidor, DIRETOR, MARCIO);

    expect(sessao.notices.join(" ")).toMatch(/A chave pública de marcio mudou/);
    expect((await loadPeerPublicKey(DIRETOR)).jwk.x).toBe(nova.x);
  });

  it("não avisa quando a chave continua a mesma", async () => {
    const servidor = servidorFalso();
    await trocaCompleta(servidor);
    const sessao = await abrir(servidor, DIRETOR, MARCIO);
    expect(sessao.notices).toEqual([]);
  });

  it("não usa a chave do outro se ela for de outra dupla", async () => {
    const servidor = servidorFalso();
    await trocaCompleta(servidor);

    const sessao = await openSession(contexto(DIRETOR, "terceiro"), offline);

    expect(sessao.ready).toBe(false);
  });
});
