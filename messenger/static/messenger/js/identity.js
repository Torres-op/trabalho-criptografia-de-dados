import { createRemote, fromBase64, readSessionData } from "./api.js";
import { isFakeImplementation } from "./app.js";
import {
  EnvironmentError,
  requestPersistentStorage,
  requireSecureContext,
} from "./environment.js";
import { showBadge } from "./badge.js";
import { fingerprintOf } from "./fingerprint.js";
import { backupFileName, keyPairFrom, openBackup, packBackup } from "./key-backup.js";
import { ensureKeyPair, exportPublicKey } from "./keys.js";
import { saveKeyPair } from "./keystore.js";
import * as ui from "./ui.js";

const MIN_PASSWORD = 8;
const MAX_ATTEMPTS = 5;

const status = document.querySelector("#status");
const notices = document.querySelector("#notices");
const peerNames = document.querySelectorAll("#peer-name, .peer-name");
const myFingerprint = document.querySelector("#my-fingerprint");
const peerFingerprint = document.querySelector("#peer-fingerprint");
const verifiedState = document.querySelector("#verified-state");
const verifyButton = document.querySelector("#verify");
const backupState = document.querySelector("#backup-state");
const password = document.querySelector("#password");
const confirmPassword = document.querySelector("#confirm");
const createButton = document.querySelector("#create-backup");
const serverBackup = document.querySelector("#server-backup");
const serverDate = document.querySelector("#server-date");
const serverPassword = document.querySelector("#server-password");
const restoreServerButton = document.querySelector("#restore-server");
const backupFile = document.querySelector("#backup-file");
const filePassword = document.querySelector("#file-password");
const restoreFileButton = document.querySelector("#restore-file");

let context = null;
let remote = null;
let pair = null;
let peerText = null;
let session = { ready: false, peerVerified: false, keyConflict: false };
let attempts = 0;

function start() {
  try {
    requireSecureContext();
  } catch (error) {
    if (error instanceof EnvironmentError) {
      ui.blockPage(error.title, error.detail);
      return;
    }
    throw error;
  }

  verifyButton.addEventListener("click", verifyPeer);
  createButton.addEventListener("click", createBackup);
  restoreServerButton.addEventListener("click", () => restore(serverBackupBytes, serverPassword));
  restoreFileButton.addEventListener("click", () => restore(fileBytes, filePassword));
  load();
}

async function load() {
  const messages = await ui.reportEnvironment(notices, {
    isFakeImplementation,
    requestPersistentStorage,
  });

  try {
    context = readSessionData();
    remote = createRemote(context);
    for (const name of peerNames) {
      name.textContent = context.peerUsername;
    }

    pair = (await ensureKeyPair(context.username)).pair;
    myFingerprint.textContent = await fingerprintOf(await exportPublicKey(pair.publicKey));

    await publishMine(messages);
    await showPeer(messages);
    await showBackupState();
  } catch (error) {
    messages.push(`Não foi possível preparar esta tela: ${error.message}`);
  }

  ui.showNotices(notices, messages);
  showBadge(document.querySelector("#badge"), { context, session, remote });
}

async function publishMine(messages) {
  try {
    await remote.publishPublicKey(await exportPublicKey(pair.publicKey));
  } catch (error) {
    if (error.code === "key_conflict") {
      session.keyConflict = true;
      messages.push(
        "A chave deste navegador não é a que está registrada no servidor. Restaure o seu " +
          "backup abaixo para voltar a ler o histórico."
      );
      return;
    }
    messages.push(`Não foi possível confirmar sua chave pública: ${error.message}`);
  }
}

async function showPeer(messages) {
  let published;
  try {
    published = await remote.fetchPeerPublicKey();
  } catch (error) {
    peerFingerprint.textContent = "—";
    verifiedState.textContent =
      error.code === "key_not_published"
        ? `${context.peerUsername} ainda não acessou o app, então ainda não há chave para conferir.`
        : `Não foi possível buscar a chave de ${context.peerUsername}: ${error.message}`;
    return;
  }

  session.ready = true;
  peerText = await fingerprintOf(published.jwk);
  peerFingerprint.textContent = peerText;
  showVerified(published.fingerprintVerified === true);

  if (published.fingerprintVerified !== true) {
    messages.push(
      `Confira o código de segurança de ${context.peerUsername} por um canal fora do app antes ` +
        "de trocar algo sensível."
    );
  }
}

function showVerified(verified) {
  session.peerVerified = verified;
  verifiedState.textContent = verified
    ? `Você já confirmou que este é o código de ${context.peerUsername}.`
    : "Ainda não confirmado. Compare os dois códigos com a outra pessoa antes de marcar.";
  verifyButton.disabled = verified || peerText === null;
  verifyButton.textContent = verified ? "Conferido" : "Já conferi pessoalmente";
}

async function verifyPeer() {
  ui.clearStatus(status);
  verifyButton.disabled = true;

  try {
    const answer = await remote.verifyFingerprint(peerText);
    showVerified(answer.fingerprintVerified === true);
    showBadge(document.querySelector("#badge"), { context, session, remote });
    ui.showStatus(status, "success", "Identidade confirmada", "");
  } catch (error) {
    showVerified(false);
    ui.showStatus(status, "error", "Não foi possível confirmar", error.message);
  }
}

async function showBackupState() {
  try {
    const backup = await remote.fetchKeyBackup();
    backupState.textContent = `Há um backup guardado no servidor, de ${ui.formatDate(
      Date.parse(backup.createdAt)
    )}. Guardar de novo cria uma versão nova, e a mais recente é a que o app usa.`;
    serverDate.textContent = ui.formatDate(Date.parse(backup.createdAt));
    serverBackup.hidden = false;
  } catch (error) {
    if (error.code !== "backup_not_found") {
      throw error;
    }
    backupState.textContent =
      "Você ainda não guardou um backup. Sem ele, perder este navegador é perder o histórico.";
    serverBackup.hidden = true;
  }
}

async function createBackup() {
  ui.clearStatus(status);

  if (password.value.length < MIN_PASSWORD) {
    ui.showStatus(
      status,
      "error",
      "Senha curta demais",
      `Use pelo menos ${MIN_PASSWORD} caracteres.`
    );
    return;
  }
  if (password.value !== confirmPassword.value) {
    ui.showStatus(status, "error", "As senhas não são iguais", "Digite a mesma senha nos dois campos.");
    return;
  }

  ui.showLoading(status, "Cifrando a chave...", "A senha passa por 600 mil rodadas de PBKDF2.");
  createButton.disabled = true;
  createButton.textContent = "Cifrando a chave...";

  let stored = false;
  try {
    const bytes = await packBackup(pair.privateKey, password.value);
    await remote.saveKeyBackup(bytes);
    stored = true;
    ui.downloadFile(bytes, backupFileName(context.username));
    password.value = "";
    confirmPassword.value = "";
    await showBackupState();
    ui.showStatus(
      status,
      "success",
      "Backup guardado",
      "Uma cópia ficou no servidor e outra foi baixada. Guarde o arquivo fora deste computador."
    );
  } catch (error) {
    if (stored) {
      ui.showStatus(
        status,
        "warning",
        "Backup guardado, mas a tela não atualizou",
        `O servidor recebeu a chave cifrada, então não repita a operação. Motivo: ${error.message}`
      );
    } else {
      ui.showStatus(status, "error", "Não foi possível guardar o backup", error.message);
    }
  } finally {
    createButton.disabled = false;
    createButton.textContent = "Guardar backup e baixar o arquivo";
  }
}

async function serverBackupBytes() {
  return fromBase64((await remote.fetchKeyBackup()).blob);
}

async function fileBytes() {
  if (backupFile.files.length === 0) {
    throw new Error("Escolha o arquivo .treehashkey.");
  }
  return new Uint8Array(await backupFile.files[0].arrayBuffer());
}

async function restore(source, field) {
  ui.showLoading(status, "Abrindo o backup...", "A senha passa por 600 mil rodadas de PBKDF2.");

  if (attempts >= MAX_ATTEMPTS) {
    return;
  }

  try {
    const jwk = await openBackup(await source(), field.value);
    await saveKeyPair(context.username, await keyPairFrom(jwk));
    field.value = "";
    ui.showStatus(
      status,
      "success",
      "Chave restaurada",
      "Recarregando a página para voltar a ler o histórico..."
    );
    setTimeout(() => globalThis.location.reload(), 1500);
  } catch (error) {
    attempts += 1;
    const left = MAX_ATTEMPTS - attempts;
    if (left <= 0) {
      restoreServerButton.disabled = true;
      restoreFileButton.disabled = true;
      ui.showStatus(
        status,
        "error",
        "Tentativas esgotadas",
        "Recarregue a página para tentar de novo."
      );
      return;
    }
    ui.showStatus(
      status,
      "error",
      "Não foi possível restaurar",
      `${error.message} Restam ${left} tentativa${left === 1 ? "" : "s"}.`
    );
  }
}

start();
