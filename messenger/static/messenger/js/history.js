import { createRemote, fromBase64, readSessionData } from "./api.js";
import { isFakeImplementation, openSession, readMessage } from "./app.js";
import {
  EnvironmentError,
  requestPersistentStorage,
  requireSecureContext,
  storageNotices,
} from "./environment.js";
import { fileName } from "./format.js";
import { hasKeyBackup, showBadge } from "./badge.js";
import * as ui from "./ui.js";

const DIRECTION_LABELS = Object.freeze({ sent: "Enviada", received: "Recebida" });

const NO_KEY_NOTICE =
  "Sem a sua chave neste dispositivo o conteúdo não pode ser lido aqui: a lista e o download " +
  "continuam funcionando, mas o botão de decifrar fica desligado até você restaurar a chave.";

const directionFilter = document.querySelector("#direction");
const fromFilter = document.querySelector("#from");
const toFilter = document.querySelector("#to");
const applyButton = document.querySelector("#apply");
const status = document.querySelector("#status");
const list = document.querySelector("#messages");
const pager = document.querySelector("#pager");
const pageInfo = document.querySelector("#page-info");
const previousButton = document.querySelector("#previous");
const nextButton = document.querySelector("#next");
const notices = document.querySelector("#notices");

let context = null;
let session = null;
let remote = null;
let page = 1;
let request = 0;

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

  applyButton.addEventListener("click", () => load(1));
  previousButton.addEventListener("click", () => load(page - 1));
  nextButton.addEventListener("click", () => load(page + 1));
  openKeys();
}

async function openKeys() {
  const { messages, persisted } = await ui.reportEnvironment(notices, {
    isFakeImplementation,
    requestPersistentStorage,
  });

  let backup = false;

  try {
    context = readSessionData();
    remote = createRemote(context);
    session = await openSession(context, remote);
    backup = await hasKeyBackup(remote);
    messages.push(...session.notices);
    if (!session.ready) {
      messages.push(NO_KEY_NOTICE);
    }
  } catch (error) {
    messages.push(`Não foi possível preparar suas chaves: ${error.message}`);
  }

  messages.push(...storageNotices({ persisted, backup }));
  ui.showNotices(notices, messages);
  showBadge(document.querySelector("#badge"), { context, session, remote, backup });
  load(1);
}

function filters() {
  return { direction: directionFilter.value, from: fromFilter.value, to: toFilter.value };
}

async function load(target) {
  if (remote === null || target < 1) {
    return;
  }

  const attempt = request + 1;
  request = attempt;
  ui.showLoading(status, "Carregando o histórico...");

  try {
    const answer = await remote.listMessages({ ...filters(), page: target });
    if (attempt !== request) {
      return;
    }
    ui.clearStatus(status);
    render(answer);
  } catch (error) {
    if (attempt !== request) {
      return;
    }
    list.replaceChildren();
    pager.hidden = true;
    ui.showStatus(status, "error", "Não foi possível carregar o histórico", error.message);
  }
}

function render(answer) {
  page = answer.page;
  list.replaceChildren();

  if (answer.count === 0) {
    ui.showEmpty(list, "Nenhuma mensagem com esses filtros.");
    pager.hidden = true;
    return;
  }

  for (const message of answer.results) {
    list.append(itemFor(message));
  }

  pageInfo.textContent =
    `Página ${answer.page} de ${answer.numPages} · ` +
    `${answer.count} ${answer.count === 1 ? "mensagem" : "mensagens"}`;
  previousButton.disabled = answer.page <= 1;
  nextButton.disabled = answer.page >= answer.numPages;
  pager.hidden = false;
}

function authorLabel(message) {
  return message.sender === session?.username ? "você" : message.sender;
}

function itemFor(message) {
  const head = document.createElement("div");
  head.className = "message-head";

  const badge = document.createElement("span");
  badge.className = `badge badge--${message.direction}`;
  badge.textContent = DIRECTION_LABELS[message.direction] ?? message.direction;

  const when = document.createElement("span");
  when.textContent =
    `escrita por ${authorLabel(message)} em ${ui.formatDate(Date.parse(message.createdAt))}`;

  const size = document.createElement("span");
  size.className = "counter";
  size.textContent = ui.formatBytes(message.size);

  head.append(badge, when, size);

  const output = document.createElement("pre");
  output.className = "output";
  output.hidden = true;

  const readButton = document.createElement("button");
  readButton.type = "button";
  readButton.className = "link-button";
  readButton.textContent = "Decifrar";
  readButton.disabled = !session?.ready;
  readButton.addEventListener("click", () => decipher(message, output, readButton));

  const downloadButton = document.createElement("button");
  downloadButton.type = "button";
  downloadButton.className = "link-button";
  downloadButton.textContent = "Baixar";
  downloadButton.addEventListener("click", () => downloadAgain(message));

  const actions = document.createElement("div");
  actions.className = "message-actions";
  actions.append(readButton, downloadButton);

  const item = document.createElement("li");
  item.className = "message";
  item.append(head, actions, output);
  return item;
}

async function decipher(message, output, button) {
  ui.clearStatus(status);
  button.disabled = true;
  button.textContent = "Decifrando...";

  try {
    const answer = await remote.fetchBlob(message.id);
    output.textContent = (await readMessage(fromBase64(answer.blob), session)).text;
    output.hidden = false;
    button.textContent = "Decifrar de novo";
  } catch (error) {
    ui.showStatus(status, "error", "Não foi possível decifrar", error.message);
    button.textContent = "Decifrar";
  } finally {
    button.disabled = !session?.ready;
  }
}

async function downloadAgain(message) {
  ui.clearStatus(status);

  try {
    const answer = await remote.fetchBlob(message.id);
    ui.downloadFile(fromBase64(answer.blob), fileName(Date.parse(message.createdAt)));
  } catch (error) {
    ui.showStatus(status, "error", "Não foi possível baixar o arquivo", error.message);
  }
}

start();
