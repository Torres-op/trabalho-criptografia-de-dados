export function blockPage(title, detail) {
  document.body.innerHTML = "";
  const box = document.createElement("div");
  box.className = "blocked";
  const h = document.createElement("h1");
  h.textContent = title;
  const p = document.createElement("p");
  p.textContent = detail;
  box.append(h, p);
  document.body.append(box);
}

export function showNotices(target, messages) {
  target.innerHTML = "";
  target.hidden = messages.length === 0;
  if (messages.length === 0) {
    return;
  }
  if (messages.length === 1) {
    target.textContent = messages[0];
    return;
  }
  const list = document.createElement("ul");
  for (const message of messages) {
    const item = document.createElement("li");
    item.textContent = message;
    list.append(item);
  }
  target.append(list);
}

export async function reportEnvironment(target, checks) {
  const messages = [];

  if (checks.isFakeImplementation()) {
    messages.push(
      "A compressão ou a cifragem ainda são implementações provisórias. " +
        "Nenhuma mensagem gerada aqui é segura."
    );
  }

  if (!(await checks.requestPersistentStorage())) {
    messages.push(
      "O navegador não garantiu armazenamento permanente para este site. " +
        "Se ele limpar os dados, a chave privada guardada aqui é perdida junto " +
        "e as mensagens antigas ficam ilegíveis."
    );
  }

  showNotices(target, messages);
  return messages;
}

export function showStatus(target, kind, title, detail = "") {
  target.hidden = false;
  target.className = `status status--${kind}`;
  target.innerHTML = "";
  const strong = document.createElement("strong");
  strong.textContent = title;
  target.append(strong);
  if (detail) {
    const p = document.createElement("p");
    p.textContent = detail;
    target.append(p);
  }
}

export function clearStatus(target) {
  target.hidden = true;
  target.innerHTML = "";
}

export function downloadFile(bytes, name) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function formatBytes(n) {
  return `${n.toLocaleString("pt-BR")} B`;
}

export function formatPercent(ratio) {
  const delta = (ratio - 1) * 100;
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta.toFixed(1).replace(".", ",")}%`;
}

export function formatDecimal(value, decimals = 2) {
  return value.toLocaleString("pt-BR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

export function formatDate(ms) {
  return new Date(ms).toLocaleString("pt-BR");
}
