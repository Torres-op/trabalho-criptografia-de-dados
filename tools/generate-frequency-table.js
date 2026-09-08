import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const CORPUS_DIR = join(ROOT, "tools", "corpus");
const OUTPUT = join(ROOT, "messenger", "static", "messenger", "js", "frequency-table.js");

const ALPHABET_SIZE = 257;
const EOF_SYMBOL = 256;
const PER_LINE = 16;

function readCorpus() {
  const files = readdirSync(CORPUS_DIR).filter((n) => n.endsWith(".txt")).sort();
  if (files.length === 0) {
    throw new Error(`Nenhum arquivo .txt em ${CORPUS_DIR}`);
  }
  return files.map((name) => ({ name, bytes: readFileSync(join(CORPUS_DIR, name)) }));
}

function countFrequencies(sources) {
  const counts = new Uint32Array(ALPHABET_SIZE).fill(1);
  for (const { bytes } of sources) {
    for (const byte of bytes) {
      counts[byte]++;
    }
  }
  counts[EOF_SYMBOL] = 1;
  return counts;
}

function render(counts, sources, corpusBytes) {
  const rows = [];
  for (let i = 0; i < ALPHABET_SIZE; i += PER_LINE) {
    const slice = [...counts.slice(i, i + PER_LINE)];
    rows.push("  " + slice.map((n) => String(n)).join(", ") + ",");
  }

  const corpus = sources.map((s) => `    ${JSON.stringify(s.name)},`).join("\n");

  return `export const ALPHABET_SIZE = ${ALPHABET_SIZE};
export const EOF_SYMBOL = ${EOF_SYMBOL};

export const SOURCE = Object.freeze({
  generator: "tools/generate-frequency-table.js",
  corpusBytes: ${corpusBytes},
  corpus: Object.freeze([
${corpus}
  ]),
});

export const FREQUENCY_TABLE = Uint32Array.from([
${rows.join("\n")}
]);
`;
}

function report(counts) {
  const printable = (symbol) => {
    if (symbol === EOF_SYMBOL) return "EOF";
    if (symbol === 0x20) return "espaço";
    if (symbol === 0x0a) return "\\n";
    if (symbol >= 0x21 && symbol <= 0x7e) return String.fromCharCode(symbol);
    return `0x${symbol.toString(16).padStart(2, "0")}`;
  };

  const ranked = [...counts]
    .map((count, symbol) => ({ symbol, count }))
    .sort((a, b) => b.count - a.count);

  const total = ranked.reduce((sum, r) => sum + r.count, 0);

  console.log("\nSímbolos mais frequentes:");
  for (const { symbol, count } of ranked.slice(0, 15)) {
    const pct = ((count / total) * 100).toFixed(2);
    console.log(`  ${printable(symbol).padEnd(8)} ${String(count).padStart(7)}  ${pct}%`);
  }

  const atFloor = ranked.filter((r) => r.count === 1).length;
  console.log(`\nSímbolos no piso (frequência 1): ${atFloor} de ${ALPHABET_SIZE}`);
  console.log(`Símbolos observados no corpus: ${ALPHABET_SIZE - atFloor}`);
}

const sources = readCorpus();
const corpusBytes = sources.reduce((sum, s) => sum + s.bytes.length, 0);
const counts = countFrequencies(sources);

writeFileSync(OUTPUT, render(counts, sources, corpusBytes), "utf8");

console.log(`Corpus: ${sources.length} arquivos, ${corpusBytes.toLocaleString("pt-BR")} bytes`);
for (const s of sources) {
  console.log(`  ${s.name} — ${s.bytes.length.toLocaleString("pt-BR")} bytes`);
}
report(counts);
console.log(`\nEscrito em ${OUTPUT}`);
