export const DATABASE_NAME = "treehash";
export const DATABASE_VERSION = 1;
export const STORE_NAME = "keys";
export const CURVE = "P-256";

const LOCAL_KEY_PAIR = "local-key-pair";
const PEER_PUBLIC_KEY = "peer-public-key";
const REQUIRED_PRIVATE_USAGES = Object.freeze(["deriveBits", "deriveKey"]);

export class KeystoreError extends Error {
  constructor(message) {
    super(message);
    this.name = "KeystoreError";
  }
}

let connection = null;

function openDatabase() {
  if (connection) {
    return connection;
  }

  connection = new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new KeystoreError("Este navegador não oferece armazenamento local seguro."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => {
      const database = request.result;
      database.onversionchange = () => {
        database.close();
        connection = null;
      };
      resolve(database);
    };

    request.onerror = () =>
      reject(new KeystoreError("Não foi possível abrir o armazenamento local."));

    request.onblocked = () =>
      reject(
        new KeystoreError(
          "Outra aba está usando uma versão diferente do armazenamento. Feche as demais abas e recarregue."
        )
      );
  });

  connection.catch(() => {
    connection = null;
  });

  return connection;
}

function run(mode, operation) {
  return openDatabase().then(
    (database) =>
      new Promise((resolve, reject) => {
        const transaction = database.transaction(STORE_NAME, mode);
        const request = operation(transaction.objectStore(STORE_NAME));

        transaction.onabort = () =>
          reject(new KeystoreError("A gravação no armazenamento local foi cancelada."));
        transaction.onerror = () =>
          reject(new KeystoreError("Falha ao acessar o armazenamento local."));

        if (request) {
          request.onsuccess = () => resolve(request.result);
          request.onerror = () =>
            reject(new KeystoreError("Falha ao acessar o armazenamento local."));
        } else {
          transaction.oncomplete = () => resolve(undefined);
        }
      })
  );
}

export function recordKey(kind, owner) {
  if (typeof owner !== "string" || owner.length === 0) {
    throw new KeystoreError("É preciso informar a qual usuário as chaves pertencem.");
  }
  return `${kind}:${owner}`;
}

function isEcdhKey(value, type) {
  return (
    typeof CryptoKey === "function" &&
    value instanceof CryptoKey &&
    value.type === type &&
    value.algorithm?.name === "ECDH" &&
    value.algorithm?.namedCurve === CURVE
  );
}

function isKeyPair(value) {
  if (value === null || typeof value !== "object") {
    return false;
  }
  if (!isEcdhKey(value.privateKey, "private") || !isEcdhKey(value.publicKey, "public")) {
    return false;
  }
  return REQUIRED_PRIVATE_USAGES.every((usage) => value.privateKey.usages.includes(usage));
}

function isPeerRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.jwk !== null &&
    typeof value.jwk === "object" &&
    typeof value.peerUsername === "string" &&
    value.peerUsername.length > 0
  );
}

export async function loadKeyPair(owner) {
  const key = recordKey(LOCAL_KEY_PAIR, owner);
  const stored = await run("readonly", (store) => store.get(key));
  if (stored === undefined) {
    return null;
  }
  if (!isKeyPair(stored)) {
    throw new KeystoreError(
      "O par de chaves guardado está corrompido. Restaure o backup para recuperar o acesso."
    );
  }
  return stored;
}

export async function saveKeyPair(owner, pair) {
  const key = recordKey(LOCAL_KEY_PAIR, owner);
  if (!isKeyPair(pair)) {
    throw new KeystoreError("Par de chaves inválido.");
  }
  await run("readwrite", (store) => store.put(pair, key));
}

export async function saveKeyPairIfAbsent(owner, pair) {
  const key = recordKey(LOCAL_KEY_PAIR, owner);
  if (!isKeyPair(pair)) {
    throw new KeystoreError("Par de chaves inválido.");
  }

  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const existing = store.get(key);
    let winner = null;

    existing.onsuccess = () => {
      if (isKeyPair(existing.result)) {
        winner = { pair: existing.result, stored: false };
      } else {
        store.put(pair, key);
        winner = { pair, stored: true };
      }
    };

    transaction.oncomplete = () => resolve(winner);
    transaction.onabort = () =>
      reject(new KeystoreError("A gravação do par de chaves foi cancelada."));
    transaction.onerror = () => reject(new KeystoreError("Falha ao gravar o par de chaves."));
  });
}

export async function hasKeyPair(owner) {
  const key = recordKey(LOCAL_KEY_PAIR, owner);
  const total = await run("readonly", (store) => store.count(key));
  return total > 0;
}

export async function deleteKeyPair(owner) {
  const key = recordKey(LOCAL_KEY_PAIR, owner);
  await run("readwrite", (store) => store.delete(key));
}

export async function loadPeer(owner) {
  const key = recordKey(PEER_PUBLIC_KEY, owner);
  const stored = await run("readonly", (store) => store.get(key));
  if (stored === undefined) {
    return null;
  }
  if (!isPeerRecord(stored)) {
    throw new KeystoreError(
      "O registro da chave do outro usuário está corrompido. Refaça a troca de chaves."
    );
  }
  return stored;
}

export async function savePeer(owner, record) {
  const key = recordKey(PEER_PUBLIC_KEY, owner);
  if (!isPeerRecord(record)) {
    throw new KeystoreError("Registro de chave do outro usuário inválido.");
  }
  await run("readwrite", (store) => store.put(record, key));
}

export async function deletePeer(owner) {
  const key = recordKey(PEER_PUBLIC_KEY, owner);
  await run("readwrite", (store) => store.delete(key));
}

export function closeDatabase() {
  const pending = connection;
  connection = null;
  if (pending) {
    pending.then((database) => database.close()).catch(() => {});
  }
}
