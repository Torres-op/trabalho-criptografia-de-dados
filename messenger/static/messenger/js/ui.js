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

export function showFakeWarning(target) {
  target.hidden = false;
  target.textContent =
    "Criptografia e compressão ainda são implementações falsas do Épico 0. " +
    "Nenhuma mensagem gerada aqui é segura.";
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
