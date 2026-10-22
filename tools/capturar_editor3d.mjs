// Captura as telas do editor visual 3D para as páginas do site (usa o Edge via DevTools; precisa do app rodando em modo demo).
// Uso: node tools/capturar_editor3d.mjs <pasta de saída> [url do app, padrão http://localhost:8797]
import { spawn } from "node:child_process";
import { writeFileSync, mkdirSync } from "node:fs";

const out = process.argv[2];
const app = process.argv[3] || "http://localhost:8797";
mkdirSync(out, { recursive: true });
const edge = "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe";
const perfil = `${out}/perfil_edge`;
const proc = spawn(edge, ["--headless=new", "--remote-debugging-port=9333", `--user-data-dir=${perfil}`, "--window-size=1360,860",
  "--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "about:blank"], { stdio: "ignore" });
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
let alvos;
for (let i = 0; i < 40; i++) {
  try { alvos = await (await fetch("http://127.0.0.1:9333/json")).json(); if (alvos.length) break; } catch { /* ainda subindo */ }
  await espera(500);
}
const ws = new WebSocket(alvos.find((t) => t.type === "page").webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0; const pend = new Map();
ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && pend.has(d.id)) { pend.get(d.id)(d); pend.delete(d.id); } };
const cdp = (method, params = {}) => new Promise((r) => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const js = async (expr) => (await cdp("Runtime.evaluate", { expression: expr, awaitPromise: true, returnByValue: true })).result?.result?.value;
const foto = async (nome) => {
  const r = await cdp("Page.captureScreenshot", { format: "png" });
  writeFileSync(`${out}/${nome}.png`, Buffer.from(r.result.data, "base64"));
  console.log("ok", nome);
};
const botao = (txt) => js(`(()=>{const b=[...document.querySelectorAll('button')].find(b=>(${JSON.stringify(txt)}==='Suspens'?b.innerText.includes('Suspens'):b.innerText.trim()===${JSON.stringify(txt)}));if(b){b.click();return true}return false})()`);
const ponto = (i) => js(`(()=>{const p=[...document.querySelectorAll('.sc3d-pt')][${i}];if(p){p.click();return true}return false})()`);

await cdp("Emulation.setDeviceMetricsOverride", { width: 1360, height: 860, deviceScaleFactor: 1, mobile: false });
await cdp("Page.navigate", { url: `${app}/?cap=${Date.now()}#/setups` });
await espera(5000);
console.log("abrir setup", await js(`(()=>{const r=[...document.querySelectorAll('tr')].find(r=>/296 GT3/.test(r.innerText));const td=r&&r.querySelector('td:nth-child(2)');if(td){td.click();return true}return false})()`));
await espera(2000);
console.log("editor", await js(`(()=>{const b=document.querySelector('#sEditor');if(b){b.click();return true}return false})()`));
await espera(12000);
// 1) carro em 3/4, sem nada selecionado
await foto("app-editor-3d-carro");
// 2) suspensão em raio-x com a roda traseira selecionada
await botao("Suspens");
await espera(4000);
await ponto(5);
await espera(5000);
await foto("app-editor-3d-suspensao");
// 3) cockpit e freios (volta para a vista do carro e espera a câmera terminar)
await botao("Suspens");
await espera(3000);
await botao("Carro");
await espera(20000);
await ponto(8);
await espera(8000);
await foto("app-editor-3d-freios");
// 4) frente, com o painel da aerodinâmica dianteira
await botao("Frente");
await espera(30000);
await ponto(0);
await espera(8000);
await foto("app-editor-3d-frente");
ws.close();
proc.kill();
process.exit(0);
