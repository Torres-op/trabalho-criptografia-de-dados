import { createRemote, readSessionData } from "./api.js";
import { isFakeImplementation, openSession, readMessage, senderNameFor } from "./app.js";
import { fromArmor } from "./armor.js";
import {
  EnvironmentError,
  requestPersistentStorage,
  requireSecureContext,
} from "./environment.js";
import { MAX_FILE_SIZE } from "./format.js";
import { copyText } from "./share.js";
import { showBadge } from "./badge.js";
import * as ui from "./ui.js";

const STAGE_TITLES = Object.freeze({
  ArmorError: "Bloco de texto inválido",
  FormatError: "Arquivo inválido",
  KeyError: "Faltam as chaves",
  AuthenticationError: "Arquivo adulterado ou chave incorreta",
  HuffmanError: "Arquivo corrompido",
});

const COPY_LABEL = "Copiar texto";

const dropzone = document.querySelector("#dropzone");
const input = document.querySelector("#file");
const pasted = document.querySelector("#pasted");
const readPastedButton = document.querySelector("#read-pasted");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const output = document.querySelector("#output");
const meta = document.querySelector("#meta");
const copyButton = document.querySelector("#copy-text");
const notices = document.querySelector("#notices");

let context = null;
let session = null;
let remote = null;

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

  openKeys();

  dropzone.addEventListener("click", () => input.click());
  dropzone.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      input.click();
    }
  });

  input.addEventListener("change", () => {
    if (input.files.length > 0) {
      readFile(input.files[0]);
    }
  });

  for (const name of ["dragenter", "dragover"]) {
    dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      dropzone.classList.add("dropzone--active");
    });
  }
  for (const name of ["dragleave", "drop"]) {
    dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      dropzone.classList.remove("dropzone--active");
    });
  }
  dropzone.addEventListener("drop", (event) => {
    if (event.dataTransfer.files.length > 0) {
      readFile(event.dataTransfer.files[0]);
    }
  });

  readPastedButton.addEventListener("click", readPasted);
  copyButton.addEventListener("click", copyMessage);
}

async function openKeys() {
  const messages = await ui.reportEnvironment(notices, {
    isFakeImplementation,
    requestPersistentStorage,
  });

  try {
    context = readSessionData();
    remote = createRemote(context);
    session = await openSession(context, remote);
    messages.push(...session.notices);
    if (!session.ready) {
      messages.push(session.reason);
    }
  } catch (error) {
    messages.push(`Não foi possível preparar suas chaves: ${error.message}`);
  }

  ui.showNotices(notices, messages);
  showBadge(document.querySelector("#badge"), { context, session, remote });
}

function authorLabel(senderId) {
  if (!session?.username) {
    return `remetente ${senderId}`;
  }
  const name = senderNameFor(senderId, session.username, session.peerUsername);
  return name === session.username ? "você" : name;
}

function stageTitle(error) {
  return STAGE_TITLES[error?.name] ?? "Não foi possível ler a mensagem";
}

async function readFile(file) {
  if (file.size > MAX_FILE_SIZE) {
    ui.showStatus(
      status,
      "error",
      "Arquivo grande demais",
      `O limite é ${ui.formatBytes(MAX_FILE_SIZE)} e este arquivo tem ${ui.formatBytes(file.size)}.`
    );
    return;
  }

  process(new Uint8Array(await file.arrayBuffer()), file.name);
}

function readPasted() {
  ui.clearStatus(status);

  if (pasted.value.trim().length === 0) {
    ui.showStatus(status, "error", "Nada para ler", "Cole o bloco de texto que você recebeu.");
    return;
  }

  let bytes;
  try {
    bytes = fromArmor(pasted.value);
  } catch (error) {
    ui.showStatus(status, "error", stageTitle(error), error.message);
    return;
  }

  if (bytes.length > MAX_FILE_SIZE) {
    ui.showStatus(
      status,
      "error",
      "Bloco grande demais",
      `O limite é ${ui.formatBytes(MAX_FILE_SIZE)}.`
    );
    return;
  }

  process(bytes, "bloco colado");
}

async function process(bytes, label) {
  ui.showLoading(status, "Lendo a mensagem...", label);
  result.hidden = true;

  let message;
  try {
    message = await readMessage(bytes, session);
  } catch (error) {
    ui.showStatus(status, "error", stageTitle(error), error.message);
    return;
  }

  output.textContent = message.text;
  meta.textContent =
    `Escrita por ${authorLabel(message.senderId)} em ${ui.formatDate(message.createdAt)} · ` +
    `${ui.formatBytes(message.fileBytes)}` +
    (message.suspiciousCreatedAt
      ? " · ⚠️ data de criação improvável — confira o relógio dos dispositivos"
      : "");
  result.hidden = false;
  copyButton.textContent = COPY_LABEL;

  const history = await saveToHistory(bytes);
  if (history.saved) {
    ui.showStatus(status, "success", "Mensagem decifrada", `${label} — ${history.detail}`);
  } else {
    ui.showStatus(
      status,
      "warning",
      "Mensagem decifrada, mas não foi salva no histórico",
      `${label} — ${history.detail}`
    );
  }
}

async function saveToHistory(bytes) {
  if (remote === null) {
    return { saved: false, detail: "a sessão não foi carregada." };
  }

  try {
    if (await remote.hasMessage(bytes)) {
      return { saved: true, detail: "já estava no seu histórico." };
    }
    await remote.saveMessage(bytes, "received");
    return { saved: true, detail: "guardada no seu histórico." };
  } catch (error) {
    return { saved: false, detail: error.message };
  }
}

async function copyMessage() {
  const copied = await copyText(output.textContent);
  copyButton.textContent = copied ? "Copiado!" : "Use Ctrl+C";
  setTimeout(() => {
    copyButton.textContent = COPY_LABEL;
  }, 2000);
}

start();
