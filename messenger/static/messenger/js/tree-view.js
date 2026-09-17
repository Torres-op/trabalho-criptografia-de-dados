const SVG_NS = "http://www.w3.org/2000/svg";
const COLUMN = 58;
const ROW = 74;
const RADIUS = 21;
const MARGIN = 16;
const MIN_SCALE = 0.2;
const MAX_SCALE = 3;
const ZOOM_STEP = 1.12;

function shape(name, attributes = {}) {
  const node = document.createElementNS(SVG_NS, name);
  for (const [key, value] of Object.entries(attributes)) {
    node.setAttribute(key, value);
  }
  return node;
}

function centerOf(node) {
  return { x: RADIUS + node.column * COLUMN, y: RADIUS + node.depth * ROW };
}

function describe(node) {
  const times = node.count === 1 ? "vez" : "vezes";
  return `${node.label} · ASCII ${node.code} · ${node.count} ${times} · valor ${node.value}`;
}

function drawEdges(world, layout, path) {
  for (const node of layout.nodes) {
    const from = centerOf(node);
    for (const child of [node.left, node.right]) {
      if (child === null) {
        continue;
      }
      const target = layout.nodes[child];
      const to = centerOf(target);
      const onPath = path.has(node.order) && path.has(target.order);
      world.append(
        shape("line", {
          class: onPath ? "tree-edge tree-edge--path" : "tree-edge",
          x1: from.x,
          y1: from.y + RADIUS,
          x2: to.x,
          y2: to.y - RADIUS,
        })
      );
    }
  }
}

function drawNodes(world, layout, path, current) {
  for (const node of layout.nodes) {
    const { x, y } = centerOf(node);
    const classes = ["tree-node"];
    if (path.has(node.order)) {
      classes.push("tree-node--path");
    }
    if (node.order === current) {
      classes.push("tree-node--current");
    }

    const group = shape("g", { class: classes.join(" ") });
    const title = document.createElementNS(SVG_NS, "title");
    title.textContent = describe(node);

    const value = shape("text", { class: "tree-value", x, y });
    value.textContent = node.value;

    const char = shape("text", { class: "tree-char", x, y: y + RADIUS + 14 });
    char.textContent = `${node.label} ×${node.count}`;

    group.append(title, shape("circle", { cx: x, cy: y, r: RADIUS }), value, char);
    world.append(group);
  }
}

export function createTreeView(container) {
  const svg = shape("svg", { class: "tree", width: "100%", height: "100%", role: "img" });
  const title = document.createElementNS(SVG_NS, "title");
  title.textContent = "Árvore binária de busca dos valores desta mensagem";
  const world = shape("g");
  svg.append(title, world);
  container.replaceChildren(svg);

  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let moved = false;
  let size = { width: 0, height: 0 };
  let pointer = null;

  function apply() {
    world.setAttribute("transform", `translate(${offsetX} ${offsetY}) scale(${scale})`);
  }

  function fit() {
    const box = container.getBoundingClientRect();
    if (size.width === 0 || box.width === 0) {
      return;
    }

    const available = { width: box.width - MARGIN * 2, height: box.height - MARGIN * 2 };
    scale = Math.min(1, available.width / size.width, available.height / size.height);
    scale = Math.max(MIN_SCALE, scale);
    offsetX = (box.width - size.width * scale) / 2;
    offsetY = MARGIN;
    moved = false;
    apply();
  }

  function zoomAt(clientX, clientY, factor) {
    const box = container.getBoundingClientRect();
    const x = clientX - box.left;
    const y = clientY - box.top;
    const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, scale * factor));

    offsetX = x - ((x - offsetX) / scale) * next;
    offsetY = y - ((y - offsetY) / scale) * next;
    scale = next;
    moved = true;
    apply();
  }

  container.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomAt(event.clientX, event.clientY, event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP);
    },
    { passive: false }
  );

  container.addEventListener("pointerdown", (event) => {
    pointer = { id: event.pointerId, x: event.clientX, y: event.clientY };
    container.setPointerCapture(event.pointerId);
    container.classList.add("is-panning");
  });

  container.addEventListener("pointermove", (event) => {
    if (pointer === null || event.pointerId !== pointer.id) {
      return;
    }
    offsetX += event.clientX - pointer.x;
    offsetY += event.clientY - pointer.y;
    pointer = { id: pointer.id, x: event.clientX, y: event.clientY };
    moved = true;
    apply();
  });

  for (const name of ["pointerup", "pointercancel", "pointerleave"]) {
    container.addEventListener(name, () => {
      pointer = null;
      container.classList.remove("is-panning");
    });
  }

  return {
    update(layout, { current = null, path = [] } = {}) {
      world.replaceChildren();
      size = {
        width: Math.max(layout.columns - 1, 0) * COLUMN + RADIUS * 2,
        height: Math.max(layout.depth - 1, 0) * ROW + RADIUS * 3,
      };

      const onPath = new Set(path);
      drawEdges(world, layout, onPath);
      drawNodes(world, layout, onPath, current);

      if (moved) {
        apply();
      } else {
        fit();
      }
    },
    fit,
  };
}

function cell(tag, text) {
  const node = document.createElement(tag);
  node.textContent = text;
  return node;
}

export function renderValueTable(table, nodes, current = null) {
  const body = table.querySelector("tbody");
  body.replaceChildren();

  for (const node of nodes) {
    const row = document.createElement("tr");
    if (node.order === current) {
      row.classList.add("is-current");
    }
    row.append(
      cell("th", node.label),
      cell("td", node.code.toLocaleString("pt-BR")),
      cell("td", node.count.toLocaleString("pt-BR")),
      cell("td", node.value.toLocaleString("pt-BR"))
    );
    body.append(row);
  }
}
