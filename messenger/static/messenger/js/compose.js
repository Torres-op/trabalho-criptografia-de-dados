import { composeMessage, isFakeImplementation } from "./app.js";
import {
  EnvironmentError,
  requestPersistentStorage,
  requireSecureContext,
} from "./environment.js";
import { HEADER_SIZE, TAG_SIZE } from "./format.js";
import * as ui from "./ui.js";

const ENVELOPE_SIZE = HEADER_SIZE + TAG_SIZE;

const textArea = document.querySelector("#text");
const button = document.querySelector("#generate");
const counter = document.querySelector("#counter");
const status = document.querySelector("#status");
const statsPanel = document.querySelector("#stats");
const note = document.querySelector("#stats-note");
const notices = document.querySelector("#notices");

let last = null;

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
  ui.reportEnvironment(notices, { isFakeImplementation, requestPersistentStorage });
}

function updateCounter() {
  const n = [...textArea.value].length;
  counter.textContent = `${n.toLocaleString("pt-BR")} caractere${n === 1 ? "" : "s"}`;
  button.disabled = n === 0;
}

async function generate() {
  ui.clearStatus(status);
  statsPanel.hidden = true;
  note.hidden = true;
  button.disabled = true;
  button.textContent = "Gerando...";

  try {
    last = await composeMessage(textArea.value);
    ui.downloadFile(last.file, last.name);
    renderStats(last.stats);
    ui.showStatus(
      status,
      "success",
      "Arquivo gerado",
      `${last.name} — ${ui.formatBytes(last.file.length)}`
    );
  } catch (error) {
    ui.showStatus(status, "error", "Não foi possível gerar o arquivo", error.message);
  } finally {
    button.textContent = "Gerar mensagem criptografada";
    updateCounter();
  }
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

start();
