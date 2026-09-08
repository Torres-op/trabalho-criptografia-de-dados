export const DATABASE_NAME = "msgenc";
export const DATABASE_VERSION = 1;
export const STORE_NAME = "keys";

const LOCAL_KEY_PAIR = "local-key-pair";

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

function isKeyPair(value) {
  return (
    value !== null &&
    typeof value === "object" &&
    typeof value.privateKey === "object" &&
    typeof value.publicKey === "object" &&
    value.privateKey?.type === "private" &&
    value.publicKey?.type === "public"
  );
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

export async function hasKeyPair() {
  const total = await run("readonly", (store) => store.count(LOCAL_KEY_PAIR));
  return total > 0;
}

export async function deleteKeyPair() {
  await run("readwrite", (store) => store.delete(LOCAL_KEY_PAIR));
}

export function closeDatabase() {
  const pending = connection;
  connection = null;
  if (pending) {
    pending.then((database) => database.close()).catch(() => {});
  }
}
