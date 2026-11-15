// Records docs/demo.gif from REAL mcp-leash output against the stub servers in demo/.
// macOS only (uses Quick Look `qlmanage` to rasterize SVG frames) + ffmpeg.
// Usage: npm run build && node demo/record.mjs
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, readdirSync, renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const home = mkdtempSync(join(tmpdir(), "leash-demo-"));
const env = { ...process.env, HOME: home, MCP_LEASH_HOME: join(home, ".mcp-leash"), NO_COLOR: "1" };
const run = (args) =>
  execFileSync("node", [join(root, "dist/cli.js"), ...args, "--project", "demo"], { cwd: root, env, encoding: "utf8" })
    .replaceAll(home, "~")
    .replace(/node "~\/\.mcp-leash\/hook\.mjs"/, "~/.mcp-leash/hook.mjs")
    .replace(/^mcp-leash scan .*$/m, "mcp-leash scan  ~/my-project")
    .replace(/ · node stub-server\.mjs \w+/g, "")
    .split("\n");

const scanOut = run(["scan"]);
const lockOut = run(["lock", "--yes"]).filter((l) => !l.startsWith("✔ Updated") && !l.includes("backup:"));

const W = 1280, H = 860, FS = 19, LH = 27, X = 36, Y0 = 92;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const color = (l) =>
  /CRITICAL|^\s*permissions\.deny/.test(l) ? "#ff7b72"
  : /WRITE|^\s*permissions\.ask/.test(l) ? "#e3b341"
  : /READ/.test(l) ? "#79c0ff"
  : /^\$ /.test(l) ? "#7ee787"
  : /^\s*\+ /.test(l) ? "#c9d1d9"
  : /^Run:|Undo|Restart/.test(l) ? "#8b949e"
  : "#c9d1d9";
function svg(lines, cursor) {
  const shown = lines.slice(-Math.floor((H - Y0 - 20) / LH));
  const body = shown
    .map((l, i) => {
      const txt = esc(l) + (cursor && i === shown.length - 1 ? "▌" : "");
      return `<text x="${X}" y="${Y0 + i * LH}" fill="${color(l)}" xml:space="preserve">${txt}</text>`;
    })
    .join("");
  // Square canvas: qlmanage renders thumbnails square; we crop to W x H afterwards.
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${W}" viewBox="0 0 ${W} ${W}">
<rect width="${W}" height="${W}" fill="#0d1117"/>
<rect x="0" y="0" width="${W}" height="44" fill="#161b22"/>
<circle cx="26" cy="22" r="7" fill="#ff5f57"/><circle cx="50" cy="22" r="7" fill="#febc2e"/><circle cx="74" cy="22" r="7" fill="#28c840"/>
<text x="${W / 2}" y="28" fill="#8b949e" font-family="Helvetica Neue, sans-serif" font-size="15" text-anchor="middle">~/my-project</text>
<g font-family="Menlo, monospace" font-size="${FS}">${body}</g></svg>`;
}

const frames = []; // [lines, cursor, seconds]
const typeCmd = (prefix, cmd) => {
  for (let i = 0; i <= cmd.length; i += 2) frames.push([[...prefix, `$ ${cmd.slice(0, i)}`], true, 0.06]);
  frames.push([[...prefix, `$ ${cmd}`], true, 0.5]);
};
typeCmd([], "npx mcp-leash");
let screen = ["$ npx mcp-leash"];
for (const l of scanOut) { screen = [...screen, l]; if (l.trim()) frames.push([screen, false, 0.09]); }
frames.push([screen, false, 2.8]);
const prefix = [...screen, ""];
typeCmd(prefix, "npx mcp-leash lock");
let s2 = [...prefix, "$ npx mcp-leash lock"];
for (const l of lockOut) { s2 = [...s2, l]; if (l.trim()) frames.push([s2, false, 0.08]); }
frames.push([s2, false, 4]);

const work = mkdtempSync(join(tmpdir(), "leash-frames-"));
const list = [];
frames.forEach(([lines, cursor, secs], i) => {
  const name = `f${String(i).padStart(4, "0")}`;
  writeFileSync(join(work, `${name}.svg`), svg(lines, cursor));
  list.push([name, secs]);
});
const svgs = list.map(([n]) => join(work, `${n}.svg`));
for (let i = 0; i < svgs.length; i += 40) {
  execFileSync("qlmanage", ["-t", "-s", String(W), "-o", work, ...svgs.slice(i, i + 40)], { stdio: "ignore" });
}
mkdirSync(join(work, "png"));
for (const f of readdirSync(work)) if (f.endsWith(".svg.png")) renameSync(join(work, f), join(work, "png", f.replace(".svg.png", ".png")));
const concat = list.map(([n, s]) => `file '${join(work, "png", `${n}.png`)}'\nduration ${s}`).join("\n") +
  `\nfile '${join(work, "png", `${list.at(-1)[0]}.png`)}'\n`;
writeFileSync(join(work, "list.txt"), concat);
const out = join(root, "docs/demo.gif");
execFileSync("ffmpeg", ["-y", "-hide_banner", "-loglevel", "error", "-f", "concat", "-safe", "0", "-i", join(work, "list.txt"),
  "-vf", `crop=${W}:${H}:0:0,scale=960:-1:flags=lanczos,split[a][b];[a]palettegen=max_colors=64[p];[b][p]paletteuse=dither=none`,
  "-loop", "0", out]);
rmSync(work, { recursive: true, force: true });
rmSync(home, { recursive: true, force: true });
console.log(`wrote ${out} (${frames.length} frames)`);
