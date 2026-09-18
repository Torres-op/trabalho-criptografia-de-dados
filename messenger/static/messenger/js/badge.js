import { hasPersistentStorage } from "./environment.js";

export function buildSignals({ peerUsername, localKey, peerKey, verified, backup, persisted }) {
  return [
    {
      id: "localKey",
      label: "Chave deste navegador",
      ok: Boolean(localKey),
      hint: localKey
        ? "A chave guardada aqui é a mesma registrada no servidor."
        : "A chave deste navegador não é a registrada. Restaure o seu backup.",
    },
    {
      id: "peerKey",
      label: `Chave de ${peerUsername}`,
      ok: Boolean(peerKey),
      hint: peerKey
        ? `A chave pública de ${peerUsername} já chegou.`
        : `${peerUsername} ainda não publicou a chave, ou ela não pôde ser buscada.`,
    },
    {
      id: "verified",
      label: "Identidade conferida",
      ok: Boolean(verified),
      hint: verified
        ? `Você já conferiu o código de segurança de ${peerUsername}.`
        : "Compare os códigos de segurança por um canal fora do app.",
    },
    {
      id: "backup",
      label: "Backup da chave",
      ok: Boolean(backup),
      hint: backup
        ? "Há um backup da sua chave guardado no servidor."
        : "Sem backup, limpar este navegador apaga o acesso ao histórico.",
    },
    {
      id: "persisted",
      label: "Armazenamento permanente",
      ok: Boolean(persisted),
      hint: persisted
        ? "O navegador prometeu não limpar os dados deste site sozinho."
        : "O navegador pode limpar os dados deste site para liberar espaço.",
    },
  ];
}

export function summarize(signals) {
  const ok = signals.filter((signal) => signal.ok).length;
  return { ok, total: signals.length, ready: ok === signals.length };
}

export function renderBadge(target, signals) {
  const { ok, total, ready } = summarize(signals);

  target.className = ready ? "badge-status badge-status--ready" : "badge-status";
  target.title = signals
    .map((signal) => `${signal.ok ? "OK" : "falta"} · ${signal.label}: ${signal.hint}`)
    .join("\n");
  target.replaceChildren();

  for (const signal of signals) {
    const dot = document.createElement("span");
    dot.className = signal.ok ? "signal signal--ok" : "signal";
    target.append(dot);
  }

  const count = document.createElement("span");
  count.className = "badge-count";
  count.textContent = `${ok}/${total}`;
  target.append(count);
  target.hidden = false;
}

export async function hasKeyBackup(remote) {
  try {
    await remote.fetchKeyBackup();
    return true;
  } catch {
    return false;
  }
}

export async function showBadge(target, { context, session, remote, backup }) {
  if (target === null || context === null) {
    return;
  }

  const stored = backup === undefined ? await hasKeyBackup(remote) : backup;
  const persisted = await hasPersistentStorage();

  renderBadge(
    target,
    buildSignals({
      peerUsername: context.peerUsername,
      localKey: session !== null && session.keyConflict !== true,
      peerKey: Boolean(session?.ready),
      verified: Boolean(session?.peerVerified),
      backup: stored,
      persisted,
    })
  );
}
