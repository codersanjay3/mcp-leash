import type { Risk } from "../src/types.js";
import { type Analysis, DEFAULT_SERVER, presetExamples, run } from "./core.js";

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

const serverEl = $<HTMLInputElement>("server");
const toolsEl = $<HTMLTextAreaElement>("tools");
const chipsEl = $("chips");
const chipNote = $("chip-note");
const summaryEl = $("summary");
const errorEl = $("error");
const tbody = document.querySelector("#table tbody") as HTMLElement;
const snippetEl = $("snippet");
const copySnip = $<HTMLButtonElement>("copy-snip");

const examples = presetExamples();
let activeChip: string | undefined;

function level(): "balanced" | "strict" {
  const el = document.querySelector<HTMLInputElement>('input[name="level"]:checked');
  return el?.value === "strict" ? "strict" : "balanced";
}

function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, text?: string) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function summaryText(a: Analysis): string {
  const c = a.counts;
  if (c.total === 0) return "No tools yet.";
  const parts = [
    `${c.total} tool${c.total === 1 ? "" : "s"}`,
    `${c.critical} critical`,
    `${c.write} write`,
    `${c.read} read`,
  ];
  if (c.unknown) parts.push(`${c.unknown} unknown`);
  return `${parts.join(", ")}. lock would deny ${c.deny} and ask for ${c.ask}.`;
}

const ACTION_LABEL = { deny: "deny", ask: "ask", none: "no rule" } as const;

function render(): void {
  const a = run(serverEl.value, toolsEl.value, level());
  errorEl.hidden = !a.error;
  errorEl.textContent = a.error ?? "";
  summaryEl.textContent = a.error ? "" : summaryText(a);
  tbody.replaceChildren();
  const multi = new Set(a.rows.map((r) => r.server)).size > 1;
  for (const r of a.rows) {
    const tr = el("tr");
    const tool = el("td", "tool");
    if (multi) tool.append(el("span", "srv", r.server));
    // Let long snake_case names wrap at underscores instead of mid-word.
    const nameEl = el("span", "name");
    r.name.split(/(?<=_)/).forEach((part, i) => {
      if (i > 0) nameEl.append(document.createElement("wbr"));
      nameEl.append(part);
    });
    // On narrow screens the Risk column is hidden and this inline badge shows instead.
    const inlineBadge = el("span", `badge badge-inline ${r.risk}`, r.risk.toUpperCase());
    tool.append(inlineBadge, nameEl, el("span", "reason", r.reason));
    const risk = el("td");
    risk.append(el("span", `badge ${r.risk satisfies Risk}`, r.risk.toUpperCase()));
    tr.append(tool, risk, el("td", `act ${r.action}`, ACTION_LABEL[r.action]));
    tbody.append(tr);
  }
  if (a.snippet) {
    snippetEl.textContent = a.snippet;
  } else {
    snippetEl.textContent = a.rows.length
      ? "// nothing to add at this level"
      : "// add tools to see the snippet";
  }
  copySnip.disabled = !a.snippet;
  copySnip.dataset.text = a.snippet ?? "";
  if (a.detected === "text" && a.rows.length) {
    const hit = a.presets[0];
    chipNote.textContent = chipNote.dataset.chip
      ? chipNote.dataset.chip
      : hit
        ? `Server name matched the ${hit.split(": ")[1]} preset.`
        : "No preset matched this server name; classifying by annotations-free name verbs.";
  } else if (a.detected === "json") {
    chipNote.textContent =
      "Detected scan --json output; using the risks and reasons recorded by the CLI.";
  }
}

function pick(id: string): void {
  const ex = examples.find((e) => e.id === id);
  if (!ex) return;
  activeChip = id;
  serverEl.value = ex.serverName;
  toolsEl.value = ex.tools.join("\n");
  chipNote.dataset.chip = `Example tool list from the ${ex.label} preset (what \`scan --offline\` uses), not a live server.`;
  for (const b of chipsEl.querySelectorAll("button"))
    b.setAttribute("aria-pressed", String(b.dataset.id === id));
  render();
}

for (const ex of examples) {
  const b = el("button", "chip", ex.label);
  b.type = "button";
  b.dataset.id = ex.id;
  b.title = `Example tool list from the ${ex.label} preset`;
  b.setAttribute("aria-pressed", "false");
  b.addEventListener("click", () => pick(ex.id));
  chipsEl.append(b);
}

function onEdit(): void {
  if (activeChip) {
    activeChip = undefined;
    delete chipNote.dataset.chip;
    for (const b of chipsEl.querySelectorAll("button")) b.setAttribute("aria-pressed", "false");
  }
  render();
}
serverEl.addEventListener("input", onEdit);
toolsEl.addEventListener("input", onEdit);
for (const r of document.querySelectorAll('input[name="level"]'))
  r.addEventListener("change", render);

async function copy(text: string, btn: HTMLButtonElement): Promise<void> {
  const old = btn.textContent;
  try {
    await navigator.clipboard.writeText(text);
    btn.textContent = "Copied";
  } catch {
    btn.textContent = "Copy failed";
  }
  setTimeout(() => {
    btn.textContent = old;
  }, 1500);
}
$<HTMLButtonElement>("copy-cmd").addEventListener("click", (e) =>
  copy("npx mcp-leash", e.currentTarget as HTMLButtonElement),
);
copySnip.addEventListener("click", (e) =>
  copy(copySnip.dataset.text ?? "", e.currentTarget as HTMLButtonElement),
);

serverEl.placeholder = DEFAULT_SERVER;
pick("github");
