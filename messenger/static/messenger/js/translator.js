import { isFakeImplementation, openSession, readMessage } from "./app.js";
import {
  EnvironmentError,
  requestPersistentStorage,
  requireSecureContext,
} from "./environment.js";
import * as ui from "./ui.js";

const dropzone = document.querySelector("#dropzone");
const input = document.querySelector("#file");
const status = document.querySelector("#status");
const result = document.querySelector("#result");
const output = document.querySelector("#output");
const meta = document.querySelector("#meta");
const notices = document.querySelector("#notices");

let session = null;

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
      process(input.files[0]);
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
      process(event.dataTransfer.files[0]);
    }
  });
}

async function openKeys() {
  const messages = await ui.reportEnvironment(notices, {
    isFakeImplementation,
    requestPersistentStorage,
  });

  try {
    session = await openSession();
    if (!session.ready) {
      messages.push(session.reason);
    }
  } catch (error) {
    messages.push(`Não foi possível preparar suas chaves: ${error.message}`);
  }

  ui.showNotices(notices, messages);
}

async function process(file) {
  ui.clearStatus(status);
  result.hidden = true;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const message = await readMessage(bytes, session?.aesKey);

    output.textContent = message.text;
    meta.textContent =
      `Escrita em ${ui.formatDate(message.createdAt)} · ` +
      `remetente ${message.senderId} · ` +
      `${ui.formatBytes(message.fileBytes)}`;
    result.hidden = false;
    ui.showStatus(status, "success", "Mensagem decifrada", file.name);
  } catch (error) {
    ui.showStatus(status, "error", "Não foi possível ler o arquivo", error.message);
  }
}

start();
