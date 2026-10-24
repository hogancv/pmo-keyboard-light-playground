// 把一个灯效在若干时刻的画面拼成一张 PNG，用来整体检查节奏（起势/推进/收尾）
// 用法: node effect_montage.js 跑马灯 out.png 0.9,1.6,3.2,6.1,8.9,11.7,13.4,15.6 [WAVE75] [4]
const fs = require('fs'), zlib = require('zlib'), path = require('path');

const jsRoot = __dirname;
const html = fs.readFileSync(path.join(jsRoot, 'index.html'), 'utf8');

// --- LAYOUTS ---
const li0 = html.indexOf('const LAYOUTS'), st = html.indexOf('{', li0);
let dep = 0, en = -1;
for (let p = st; p < html.length; p++){
  const ch = html[p];
  if (ch === '"'){ p++; while (html[p] !== '"'){ if (html[p] === '\\') p++; p++; } continue; }
  if (ch === '{') dep++; else if (ch === '}'){ dep--; if (!dep){ en = p; break; } }
}
const LAYOUTS = eval('(' + html.slice(st, en + 1) + ')');

const fxName = process.argv[2] || '跑马灯';
const outFile = process.argv[3] || (fxName + '_总览.png');
const times = (process.argv[4] || '0.9,1.6,3.2,6.1,8.9,11.7,13.4,15.6').split(',').map(Number);
const layoutName = process.argv[5] || 'WAVE75';
const COLS = +(process.argv[6] || 4);
const L = LAYOUTS[layoutName];
const OFF = L ? (L.off || 0) : 0;   // 实机灯号偏移（WAVE75 = +1）
if (!L){ console.log('没有该布局:', layoutName); process.exit(1); }

// --- 假 DOM，跑效果 ---
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

// --- PNG ---
function crc32(buf){
  let c, t = [];
  for (let n = 0; n < 256; n++){ c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  let crc = 0xffffffff;
  for (const b of buf) crc = t[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
function chunk(type, data){
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, c]);
}

(async () => {
  const api = await new AsyncFunction(code + ';return { EFFECTS, buildGrid, S };')();
  const fx = api.EFFECTS.find(f => f.name === fxName);
  if (!fx){ console.log('没有这个效果。可选：' + api.EFFECTS.map(f => f.name).join(' / ')); process.exit(1); }
  const G = api.buildGrid(layoutName);
  const inst = fx.init(G, api.S);
  const out = new Uint8Array(G.leds * 3);
  const p = { speed: 1, scale: 1, bright: 100, fps: 25 };

  const S = 0.5, PW = Math.round(L.w * S), PH = Math.round(L.h * S), GAP = 8;
  const ROWS = Math.ceil(times.length / COLS);
  const W = COLS * PW + GAP * (COLS + 1), H = ROWS * PH + GAP * (ROWS + 1);
  const px = Buffer.alloc(W * H * 3, 0x14);
  const setPx = (x, y, r, g, b) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const o = (y * W + x) * 3; px[o] = r; px[o+1] = g; px[o+2] = b; };

  let prev = 0;
  for (let pi = 0; pi < times.length; pi++){
    const steps = Math.max(0, Math.round((times[pi] - prev) * 60));
    for (let k = 0; k < steps; k++){ prev += 1 / 60; inst(prev, 1 / 60, out, p, null); }
    const ox = GAP + (pi % COLS) * (PW + GAP), oy = GAP + Math.floor(pi / COLS) * (PH + GAP);
    for (const k of L.k){
      const o = (k[0] + OFF) * 3, r = out[o], g2 = out[o+1], b = out[o+2];
      const x0 = ox + Math.round(k[1] * PW) + 1, y0 = oy + Math.round(k[2] * PH) + 1;
      const x1 = ox + Math.round((k[1] + k[3]) * PW) - 1, y1 = oy + Math.round((k[2] + k[4]) * PH) - 1;
      for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++){
        const edge = (xx <= x0 || xx >= x1 || yy <= y0 || yy >= y1);
        setPx(xx, yy,
          edge ? Math.min(255, r + 40) : Math.round(r * 0.85),
          edge ? Math.min(255, g2 + 40) : Math.round(g2 * 0.85),
          edge ? Math.min(255, b + 40) : Math.round(b * 0.85));
      }
    }
  }
  const raw = Buffer.alloc((W * 3 + 1) * H);
  for (let y = 0; y < H; y++){ raw[y * (W * 3 + 1)] = 0; px.copy(raw, y * (W * 3 + 1) + 1, y * W * 3, (y + 1) * W * 3); }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(H, 4); ihdr[8] = 8; ihdr[9] = 2;
  fs.writeFileSync(outFile, Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))
  ]));
  console.log(fxName + ' · ' + layoutName + ' → ' + outFile, W + 'x' + H, '时刻', times.join(' / '));
})().catch(e => { console.log('ERR', e.stack); process.exit(1); });
