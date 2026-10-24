// 把内嵌 LAYOUTS 渲染成 PNG，用于肉眼核对键位是否缺失/重叠；也能渲染某个灯效的真实帧
// 用法:
//   node preview_png.js WAVE75 out.png                → 每个灯位一种颜色，检查键位覆盖
//   node preview_png.js WAVE75 out.png 彩虹波 60       → 跑到第 60 帧截图，检查效果分布
const fs = require('fs'), zlib = require('zlib'), path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');

// ---- 取出 LAYOUTS 对象字面量（不执行整段脚本，避免副作用）----
const i = html.indexOf('const LAYOUTS');
const start = html.indexOf('{', i);
let d = 0, end = -1;
for (let p = start; p < html.length; p++){
  const ch = html[p];
  if (ch === '"'){ p++; while (html[p] !== '"'){ if (html[p] === '\\') p++; p++; } continue; }
  if (ch === '{') d++; else if (ch === '}'){ d--; if (!d){ end = p; break; } }
}
const LAYOUTS = eval('(' + html.slice(start, end + 1) + ')');

const name = process.argv[2] || 'WAVE75';
const outFile = process.argv[3] || (name.replace(/\s/g, '_') + '_preview.png');
const fxName = process.argv[4] || '';
const fxFrames = +(process.argv[5] || 60);
const L = LAYOUTS[name];
const OFF = L ? (L.off || 0) : 0;   // 实机灯号偏移（WAVE75 = +1）
if (!L){ console.log('没有该布局:', name, '可选:', Object.keys(LAYOUTS).join(', ')); process.exit(1); }

const SCALE = 1.4;
const W = Math.round(L.w * SCALE), H = Math.round(L.h * SCALE);
const px = Buffer.alloc(W * H * 3, 0x0d);

function setPx(x, y, r, g, b){
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const o = (y * W + x) * 3;
  px[o] = r; px[o + 1] = g; px[o + 2] = b;
}

function hsl2rgb(h, s, l){
  const k = n => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = n => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function paintKey(k, r, g, b){
  const [, x, y, w, h] = k;
  const x0 = Math.round(x * L.w * SCALE) + 2, y0 = Math.round(y * L.h * SCALE) + 2;
  const x1 = Math.round((x + w) * L.w * SCALE) - 2, y1 = Math.round((y + h) * L.h * SCALE) - 2;
  for (let yy = y0; yy <= y1; yy++)
    for (let xx = x0; xx <= x1; xx++){
      const edge = (xx <= x0 + 1 || xx >= x1 - 1 || yy <= y0 + 1 || yy >= y1 - 1);
      if (edge) setPx(xx, yy, Math.min(255, r + 60), Math.min(255, g + 60), Math.min(255, b + 60));
      else setPx(xx, yy, Math.round(r * 0.62), Math.round(g * 0.62), Math.round(b * 0.62));
    }
}

async function renderEffect(){
  // 复用整段脚本的假 DOM 环境跑效果，取最后一帧的 out 缓冲
  const code = (html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [])
    .map(s => s.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''))
    .sort((a, b) => b.length - a.length)[0];
  const mkEl = (tag, id) => ({
    tagName: tag, id, textContent: '', innerHTML: '', value: '85', disabled: false, className: '',
    children: [], style: {}, dataset: {},
    classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
    querySelector(){ return null; }, appendChild(c){ this.children.push(c); return c; },
    removeChild(c){ this.children = this.children.filter(x => x !== c); },
    get firstChild(){ return this.children[0]; },
    getContext(){ return new Proxy({}, { get: (t, k) => (k === 'canvas' ? this : () => {}) }); },
    toDataURL(){ return ''; }
  });
  const els = new Map();
  const el = id => { if (!els.has(id)) els.set(id, mkEl('div', id)); return els.get(id); };
  global.document = { body: el('body'), documentElement: el('html'), getElementById: el,
    querySelector: () => el('q'), createElement: t => mkEl(t, ''), addEventListener(){} };
  global.window = { addEventListener(){}, devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener(){} }) };
  global.navigator = { hid: { getDevices: async () => [], requestDevice: async () => [], addEventListener(){} } };
  global.requestAnimationFrame = () => 0;
  global.performance = { now: () => 0 };
  global.alert = () => {};

  const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
  const api = await new AsyncFunction(code + ';return { EFFECTS, buildGrid, S };')();
  const fx = api.EFFECTS.find(f => f.name === fxName);
  if (!fx){ console.log('没有这个效果。可选：' + api.EFFECTS.map(f => f.name).join(' / ')); process.exit(1); }
  const G = api.buildGrid(name);
  const out = new Uint8Array(G.leds * 3);
  const inst = fx.init(G, api.S);
  const p = { speed: 1, scale: 1, bright: 85, fps: 25 };
  const dt = 1 / 60;
  for (let f = 0; f < fxFrames; f++) inst(f * dt, dt, out, p, null);
  for (const k of L.k){
    const o = (k[0] + OFF) * 3;
    paintKey(k, out[o], out[o + 1], out[o + 2]);
  }
  console.log('效果帧:', fxName, '第 ' + fxFrames + ' 帧', '灯数', G.leds);
}

function crc32(buf){
  let c, table = [];
  for (let n = 0; n < 256; n++){ c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function savePng(){
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++){
    raw[y * (W * 3 + 1)] = 0;
    px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(outFile, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]));
  console.log(name, '→', outFile, W + 'x' + H, '键数', L.k.length);
}

(async () => {
  if (fxName) await renderEffect();
  else for (const k of L.k){
    const [r, g, b] = hsl2rgb((k[0] * 137.5) % 360, 0.75, 0.55);
    paintKey(k, r, g, b);
  }
  savePng();
})();
