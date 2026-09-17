import { createRemote, readSessionData } from "./api.js";
import { composeMessage, isFakeImplementation, openSession } from "./app.js";
import {
  EnvironmentError,
  requestPersistentStorage,
  requireSecureContext,
} from "./environment.js";
import { HEADER_SIZE, TAG_SIZE } from "./format.js";
import { buildCharacterTree, inOrder, layout, totalBits } from "./search-tree.js";
import { renderCodeTable, renderTree } from "./tree-view.js";
import * as ui from "./ui.js";

const ENVELOPE_SIZE = HEADER_SIZE + TAG_SIZE;

const STAGE_TITLES = Object.freeze({
  HuffmanError: "Falha na compressão",
  KeyError: "Falha na cifragem",
  AuthenticationError: "Falha na cifragem",
  FormatError: "Falha ao montar o arquivo",
});

const textArea = document.querySelector("#text");
const button = document.querySelector("#generate");
const counter = document.querySelector("#counter");
const status = document.querySelector("#status");
const statsPanel = document.querySelector("#stats");
const note = document.querySelector("#stats-note");
const treePanel = document.querySelector("#tree-panel");
const treeNote = document.querySelector("#tree-note");
const treeView = document.querySelector("#tree");
const treeCodes = document.querySelector("#tree-codes");
const notices = document.querySelector("#notices");

let last = null;
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

  textArea.addEventListener("input", updateCounter);
  button.addEventListener("click", generate);
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
  statsPanel.hidden = true;
  note.hidden = true;
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
  renderStats(last.stats);
  renderTreePanel(textArea.value, last.stats);

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

function renderStats(stats) {
  const rows = [
    [
      "Original",
      `${ui.formatBytes(stats.originalBytes)} · ${stats.characters.toLocaleString("pt-BR")} caracteres`,
    ],
    [
      "Após Huffman",
      stats.compressed
        ? `${ui.formatBytes(stats.compressedBytes)} · ${ui.formatPercent(stats.compressionRatio)}`
        : "compressão dispensada — o texto ficaria maior",
    ],
    [
      "Arquivo final",
      `${ui.formatBytes(stats.fileBytes)} · ${ui.formatPercent(stats.fileRatio)}`,
    ],
    [
      "Bits por caractere",
      `${ui.formatDecimal(stats.bitsPerChar)} · UTF-8 usaria ${ui.formatDecimal(stats.originalBitsPerChar)}`,
    ],
  ];

  const body = statsPanel.querySelector("tbody");
  body.innerHTML = "";
  for (const [label, value] of rows) {
    const tr = document.createElement("tr");
    const th = document.createElement("th");
    th.textContent = label;
    const td = document.createElement("td");
    td.textContent = value;
    tr.append(th, td);
    body.append(tr);
  }
  statsPanel.hidden = false;

  const grew = stats.fileRatio > 1;
  note.hidden = !grew;
  if (grew) {
    note.textContent =
      `O arquivo carrega ${ENVELOPE_SIZE} bytes fixos: ${HEADER_SIZE} de cabeçalho ` +
      `— formato, versão, remetente, data e vetor de inicialização — mais ${TAG_SIZE} ` +
      "da assinatura que detecta adulteração. Esse custo não cresce com a mensagem, " +
      "então em textos curtos ele supera o ganho da compressão; por volta de 100 " +
      "caracteres o arquivo já sai menor que o texto original.";
  }
}

function renderTreePanel(text, stats) {
  const root = buildCharacterTree(text);
  if (root === null) {
    treePanel.hidden = true;
    return;
  }

  const nodes = inOrder(root);
  renderTree(treeView, layout(root));
  renderCodeTable(treeCodes, nodes);

  const plural = nodes.length === 1 ? "" : "s";
  treeCodes.querySelector("caption").textContent =
    `Percurso em ordem — ${nodes.length} caractere${plural} distinto${plural}, ` +
    `${totalBits(root).toLocaleString("pt-BR")} bits no total`;

  treeNote.textContent =
    "Cada caractere distinto entrou numa árvore binária de busca na ordem em que apareceu na " +
    "mensagem, e o percurso em ordem devolve o alfabeto ordenado. Os códigos vêm da árvore de " +
    "Huffman, que é fixa e igual para os dois usuários: a sua mensagem decide apenas quais " +
    "caminhos são percorridos. Caracteres acentuados ocupam mais de um byte em UTF-8 e recebem " +
    "um código por byte." +
    (stats.compressed
      ? ""
      : " Esta mensagem saiu sem compressão, porque o Huffman a deixaria maior: os códigos " +
        "abaixo não foram usados no arquivo.");

  treePanel.hidden = false;
}

start();
