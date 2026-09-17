import { createRemote, readSessionData } from "./api.js";
import { composeMessage, isFakeImplementation, openSession } from "./app.js";
import {
  EnvironmentError,
  requestPersistentStorage,
  requireSecureContext,
} from "./environment.js";
import {
  buildCharacterTree,
  entriesFor,
  height,
  inOrder,
  insert,
  layout,
  searchPath,
  sharedValues,
} from "./search-tree.js";
import { createTreeView, renderValueTable } from "./tree-view.js";
import * as ui from "./ui.js";

const STAGE_TITLES = Object.freeze({
  HuffmanError: "Falha na compressão",
  KeyError: "Falha na cifragem",
  AuthenticationError: "Falha na cifragem",
  FormatError: "Falha ao montar o arquivo",
});

const NOTE =
  "Cada caractere vira um valor: o código ASCII multiplicado pelo número de vezes que ele " +
  "aparece na mensagem. Os valores entram numa árvore binária de busca, remontada do zero a " +
  "cada mensagem, e o percurso em ordem devolve os valores em ordem crescente. Caracteres " +
  "fora do ASCII, como ç ou emoji, usam o ponto de código Unicode, já que a tabela ASCII vai " +
  "só até 127.";

const BUILD_MS = 5000;
const MIN_STEP_MS = 90;
const MAX_STEP_MS = 420;

const textArea = document.querySelector("#text");
const button = document.querySelector("#generate");
const counter = document.querySelector("#counter");
const status = document.querySelector("#status");
const notices = document.querySelector("#notices");
const treePanel = document.querySelector("#tree-panel");
const treeNote = document.querySelector("#tree-note");
const treeValues = document.querySelector("#tree-values");
const treeCaption = treeValues.querySelector("caption");
const replayButton = document.querySelector("#tree-replay");
const fitButton = document.querySelector("#tree-fit");

let last = null;
let session = null;
let remote = null;
let view = null;
let build = null;

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

  textArea.addEventListener("input", updateCounter);
  button.addEventListener("click", generate);
  replayButton.addEventListener("click", replayOrSkip);
  fitButton.addEventListener("click", () => view?.fit());
  updateCounter();
  openKeys();
}

async function openKeys() {
  const messages = await ui.reportEnvironment(notices, {
    isFakeImplementation,
    requestPersistentStorage,
  });

  try {
    const context = readSessionData();
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
  updateCounter();
}

function updateCounter() {
  const n = [...textArea.value].length;
  counter.textContent = `${n.toLocaleString("pt-BR")} caractere${n === 1 ? "" : "s"}`;
  button.disabled = n === 0 || !session?.ready;
}

async function generate() {
  ui.clearStatus(status);
  stopBuild();
  treePanel.hidden = true;
  button.disabled = true;
  button.textContent = "Gerando...";

  try {
    last = await composeMessage(textArea.value, session);
  } catch (error) {
    ui.showStatus(status, "error", stageTitle(error), error.message);
    finish();
    return;
  }

  ui.downloadFile(last.file, last.name);
  showTree(textArea.value);

  const size = ui.formatBytes(last.file.length);
  try {
    await remote.saveMessage(last.file, "sent");
    ui.showStatus(status, "success", "Arquivo gerado e salvo no histórico", `${last.name} — ${size}`);
  } catch (error) {
    ui.showStatus(
      status,
      "warning",
      "Arquivo gerado, mas não foi salvo no histórico",
      `${last.name} — ${size}. O download não foi afetado. Motivo: ${error.message}`
    );
  }
  finish();
}

function finish() {
  button.textContent = "Gerar mensagem criptografada";
  updateCounter();
}

function stageTitle(error) {
  return STAGE_TITLES[error?.name] ?? "Não foi possível gerar o arquivo";
}

function showTree(text) {
  const entries = entriesFor(text);
  if (entries.length === 0) {
    treePanel.hidden = true;
    return;
  }

  treePanel.hidden = false;
  if (view === null) {
    view = createTreeView(document.querySelector("#tree"));
  }

  treeNote.textContent = NOTE + tieNote(sharedValues(buildCharacterTree(text)));
  view.fit();
  build = { text, entries, root: null, index: 0, timer: null };

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    skipBuild();
    return;
  }

  replayButton.textContent = "Mostrar tudo";
  step();
}

function step() {
  const entry = build.entries[build.index];
  build.root = insert(build.root, entry);
  build.index += 1;

  const { path } = searchPath(build.root, entry.value, entry.code);
  draw(
    entry.order,
    path.map((node) => node.order)
  );

  if (build.index < build.entries.length) {
    build.timer = setTimeout(step, stepDelay(build.entries.length));
  } else {
    finishBuild();
  }
}

function draw(current, path) {
  const nodes = inOrder(build.root);
  view.update(layout(build.root), { current, path });
  renderValueTable(treeValues, nodes, current);

  const total = build.entries.length;
  const progress =
    nodes.length < total
      ? `${nodes.length} de ${total}`
      : `${total} ${total === 1 ? "nó" : "nós"}`;
  treeCaption.textContent = `Percurso em ordem — ${progress}, altura ${height(build.root)}`;
}

function stepDelay(total) {
  return Math.max(MIN_STEP_MS, Math.min(MAX_STEP_MS, Math.round(BUILD_MS / total)));
}

function skipBuild() {
  stopBuild();
  while (build.index < build.entries.length) {
    build.root = insert(build.root, build.entries[build.index]);
    build.index += 1;
  }
  draw(null, []);
  finishBuild();
}

function finishBuild() {
  build.timer = null;
  replayButton.textContent = "Montar de novo";
}

function stopBuild() {
  if (build?.timer) {
    clearTimeout(build.timer);
    build.timer = null;
  }
}

function replayOrSkip() {
  if (build === null) {
    return;
  }
  if (build.index < build.entries.length) {
    skipBuild();
  } else {
    showTree(build.text);
  }
}

function tieNote(groups) {
  if (groups.length === 0) {
    return "";
  }

  const collisions = groups
    .map((group) => `${group.map((node) => node.label).join(" e ")} valem ${group[0].value}`)
    .join("; ");

  return (
    ` Dois caracteres podem cair no mesmo valor, e nesta mensagem isso aconteceu: ${collisions}. ` +
    "O desempate é pelo código do caractere, para a árvore continuar determinística."
  );
}

start();
