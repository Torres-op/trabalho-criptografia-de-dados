import { composeMessage, isFakeImplementation } from "./app.js";
import { EnvironmentError, requireSecureContext } from "./environment.js";
import { HEADER_SIZE } from "./format.js";
import * as ui from "./ui.js";

const textArea = document.querySelector("#text");
const button = document.querySelector("#generate");
const counter = document.querySelector("#counter");
const status = document.querySelector("#status");
const statsPanel = document.querySelector("#stats");
const note = document.querySelector("#stats-note");
const warning = document.querySelector("#fake-warning");

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

  if (isFakeImplementation()) {
    ui.showFakeWarning(warning);
  }

  textArea.addEventListener("input", updateCounter);
  button.addEventListener("click", generate);
  updateCounter();
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
      `O arquivo carrega ${HEADER_SIZE} bytes fixos de cabeçalho — formato, versão, ` +
      "remetente, data e vetor de inicialização. Em mensagens curtas esse custo " +
      "supera o ganho da compressão; a partir de umas poucas centenas de " +
      "caracteres o arquivo já sai menor que o texto original.";
  }
}

start();
