import { composeMessage, isFakeImplementation } from "./app.js";
import { EnvironmentError, requireSecureContext } from "./environment.js";
import * as ui from "./ui.js";

const textArea = document.querySelector("#text");
const button = document.querySelector("#generate");
const counter = document.querySelector("#counter");
const status = document.querySelector("#status");
const statsPanel = document.querySelector("#stats");
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
    ["Original", `${ui.formatBytes(stats.originalBytes)} (${stats.characters} caracteres)`],
    [
      "Após compressão",
      stats.compressed
        ? `${ui.formatBytes(stats.compressedBytes)} (${ui.formatPercent(stats.compressionRatio)})`
        : "compressão dispensada",
    ],
    [
      "Arquivo final",
      `${ui.formatBytes(stats.fileBytes)} (${ui.formatPercent(stats.fileRatio)})`,
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
}

start();
