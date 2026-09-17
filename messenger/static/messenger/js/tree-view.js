const SVG_NS = "http://www.w3.org/2000/svg";
const COLUMN = 48;
const ROW = 64;
const RADIUS = 17;
const PADDING = 26;

function shape(name, attributes) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }
  return node;
}

function centerOf(node) {
  return { x: PADDING + node.column * COLUMN, y: PADDING + node.depth * ROW };
}

function describe(node) {
  return (
    `${node.label} · ${node.count} ${node.count === 1 ? "vez" : "vezes"} · ` +
    `${node.codes.join(" ")} · ${node.bits} bits`
  );
}

export function renderTree(target, layout) {
  target.replaceChildren();
  if (layout.nodes.length === 0) {
    return;
  }

  const width = PADDING * 2 + (layout.columns - 1) * COLUMN;
  const height = PADDING * 2 + (layout.depth - 1) * ROW + RADIUS;
  const svg = shape("svg", {
    viewBox: `0 0 ${width} ${height}`,
    width,
    height,
    class: "tree",
    role: "img",
  });

  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = "Árvore binária de busca com os caracteres da mensagem";
  svg.append(title);

  for (const node of layout.nodes) {
    const from = centerOf(node);
    for (const child of [node.left, node.right]) {
      if (child === null) {
        continue;
      }
      const to = centerOf(layout.nodes[child]);
      svg.append(
        shape("line", {
          class: "tree-edge",
          x1: from.x,
          y1: from.y + RADIUS,
          x2: to.x,
          y2: to.y - RADIUS,
        })
      );
    }
  }

  for (const node of layout.nodes) {
    const { x, y } = centerOf(node);
    const group = shape("g", { class: "tree-node" });
    const label = document.createElementNS(SVG_NS, "title");
    label.textContent = describe(node);

    const char = shape("text", { class: "tree-char", x, y });
    char.textContent = node.label;

    const count = shape("text", { class: "tree-count", x, y: y + RADIUS + 13 });
    count.textContent = `×${node.count}`;

    group.append(label, shape("circle", { cx: x, cy: y, r: RADIUS }), char, count);
    svg.append(group);
  }

  target.append(svg);
}

function cell(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

export function renderCodeTable(table, nodes) {
  const body = table.querySelector("tbody");
  body.replaceChildren();

  for (const node of nodes) {
    const codes = document.createElement("td");
    for (const code of node.codes) {
      const bits = document.createElement("code");
      bits.textContent = code;
      codes.append(bits, " ");
    }

    const row = document.createElement("tr");
    row.append(
      cell("th", node.label),
      cell("td", node.count.toLocaleString("pt-BR")),
      codes,
      cell("td", node.bits.toLocaleString("pt-BR")),
      cell("td", (node.bits * node.count).toLocaleString("pt-BR"))
    );
    body.append(row);
  }
}
