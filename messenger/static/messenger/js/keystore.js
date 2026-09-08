export const DATABASE_NAME = "msgenc";
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

function isEcdhKey(value, type) {
  return (
    typeof CryptoKey === "function" &&
    value instanceof CryptoKey &&
    value.type === type &&
    value.algorithm?.name === "ECDH" &&
    value.algorithm?.namedCurve === CURVE
  );
}

function isPeerRecord(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    value.jwk !== null &&
    typeof value.jwk === "object" &&
    typeof value.localUsername === "string" &&
    value.localUsername.length > 0 &&
    typeof value.peerUsername === "string" &&
    value.peerUsername.length > 0
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

export async function loadKeyPair() {
  const stored = await run("readonly", (store) => store.get(LOCAL_KEY_PAIR));
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

export async function saveKeyPair(pair) {
  if (!isKeyPair(pair)) {
    throw new KeystoreError("Par de chaves inválido.");
  }
  await run("readwrite", (store) => store.put(pair, LOCAL_KEY_PAIR));
}

export async function saveKeyPairIfAbsent(pair) {
  if (!isKeyPair(pair)) {
    throw new KeystoreError("Par de chaves inválido.");
  }

  const database = await openDatabase();

  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    const store = transaction.objectStore(STORE_NAME);
    const existing = store.get(LOCAL_KEY_PAIR);
    let winner = null;

    existing.onsuccess = () => {
      if (isKeyPair(existing.result)) {
        winner = { pair: existing.result, stored: false };
      } else {
        store.put(pair, LOCAL_KEY_PAIR);
        winner = { pair, stored: true };
      }
    };

    transaction.oncomplete = () => resolve(winner);
    transaction.onabort = () =>
      reject(new KeystoreError("A gravação do par de chaves foi cancelada."));
    transaction.onerror = () =>
      reject(new KeystoreError("Falha ao gravar o par de chaves."));
  });
}

export async function hasKeyPair() {
  const total = await run("readonly", (store) => store.count(LOCAL_KEY_PAIR));
  return total > 0;
}

export async function deleteKeyPair() {
  await run("readwrite", (store) => store.delete(LOCAL_KEY_PAIR));
}

export async function loadPeer() {
  const stored = await run("readonly", (store) => store.get(PEER_PUBLIC_KEY));
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

export async function savePeer(record) {
  if (!isPeerRecord(record)) {
    throw new KeystoreError("Registro de chave do outro usuário inválido.");
  }
  await run("readwrite", (store) => store.put(record, PEER_PUBLIC_KEY));
}

export async function deletePeer() {
  await run("readwrite", (store) => store.delete(PEER_PUBLIC_KEY));
}

export function closeDatabase() {
  const pending = connection;
  connection = null;
  if (pending) {
    pending.then((database) => database.close()).catch(() => {});
  }
}
