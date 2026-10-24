// 离线跑一遍所有灯效：不插键盘，检查每帧输出是否合法
// 关键：把 out 换成 Float32Array（保留精度），这样负值 / NaN / 越界亮度都能被抓到
// 因为 Uint8Array 会把负值悄悄 mod 256 变成亮色，那才是最隐蔽的 bug
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const code = (html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [])
  .map(s => s.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''))
  .sort((a, b) => b.length - a.length)[0];

const mkEl = (tag, id) => ({
  tagName: tag, id, textContent: '', innerHTML: '', value: id === 'pFps' ? '25' : '85',
  disabled: false, className: '', children: [], style: {}, scrollTop: 0, scrollHeight: 0,
  width: 940, height: 340, dataset: {}, checked: false,
  classList: { add(){}, remove(){}, toggle(){}, contains(){ return false; } },
  querySelector(){ return null; },
  appendChild(c){ this.children.push(c); return c; },
  removeChild(c){ this.children = this.children.filter(x => x !== c); },
  get firstChild(){ return this.children[0]; },
  getContext(){ return new Proxy({}, { get: (t, k) => (k === 'canvas' ? this : () => {}) }); },
  toDataURL(){ return ''; }
});
const els = new Map();
const el = id => { if (!els.has(id)) els.set(id, mkEl('div', id)); return els.get(id); };

global.document = {
  body: el('body'), documentElement: el('html'), getElementById: el,
  querySelector: () => el('q'), createElement: t => mkEl(t, ''), addEventListener(){}
};
global.window = { addEventListener(){}, devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener(){} }) };
global.navigator = { hid: { getDevices: async () => [], requestDevice: async () => [], addEventListener(){} } };
global.requestAnimationFrame = () => 0;
global.performance = { now: () => 0 };
global.alert = () => {};
global.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const runner = new AsyncFunction(code + `
;return { EFFECTS, buildGrid, LAYOUTS, S, fbm2, hsv };`);

(async () => {
  const api = await runner();
  const { EFFECTS, buildGrid, LAYOUTS } = api;
  console.log('效果总数:', EFFECTS.length);

  const layoutKey = process.argv[2] || 'WAVE75';
  const G = buildGrid(layoutKey);
  console.log('布局:', layoutKey, 'cols=' + G.cols, 'rows=' + G.rows, 'leds=' + G.leds);

  const p = { speed: 1, scale: 1, bright: 85, fps: 25 };
  const dt = 1 / 60;
  let bad = [];

  for (const fx of EFFECTS){
    let inst;
    try {
      inst = fx.init(G, api.S);
    } catch (e){
      bad.push([fx.name, 'init 抛错: ' + e.message]);
      console.log(`❌ ${fx.name.padEnd(10)} init 抛错 ${e.message}`);
      continue;
    }
    // 用 Float32Array 跑，精度不丢才能看出负值
    const out = new Float32Array(G.leds * 3);
    let minV = Infinity, maxV = -Infinity, nan = 0, minLit = Infinity, maxLit = 0, litSum = 0;
    let err = null;
    for (let f = 0; f < 90; f++){
      const t = f * dt;
      try {
        inst(t, dt, out, p, null);
      } catch (e){ err = 't=' + t.toFixed(2) + ' ' + e.message; break; }
      let lit = 0;
      for (let i = 0; i < out.length; i++){
        const v = out[i];
        if (v !== v) nan++;
        if (v < minV) minV = v;
        if (v > maxV) maxV = v;
        if (v > 8) lit++;
      }
      minLit = Math.min(minLit, lit); maxLit = Math.max(maxLit, lit); litSum += lit;
    }
    if (err){ bad.push([fx.name, err]); console.log(`❌ ${fx.name.padEnd(10)} ${err}`); continue; }

    const avgLit = (litSum / 90).toFixed(1);
    const flags = [];
    if (nan) flags.push('NaN×' + nan);
    if (minV < -0.01) flags.push('负值 ' + minV.toFixed(1));
    if (maxV > 255.6) flags.push('超亮 ' + maxV.toFixed(1));
    if (maxLit === 0) flags.push('全程全黑');
    if (minLit === 0) flags.push('存在全黑帧');
    const tag = flags.length ? '⚠️ ' : '✅';
    console.log(`${tag} ${fx.name.padEnd(10)} 亮度[${minV.toFixed(0)},${maxV.toFixed(0)}] 亮灯/帧 ${avgLit} (${minLit}~${maxLit}) ${flags.join(' ')}`);
    if (flags.some(f => f.includes('NaN') || f.includes('负值') || f.includes('超亮') || f.includes('全程全黑'))) bad.push([fx.name, flags.join(' ')]);
  }

  console.log('\n' + (bad.length ? '❌ 有 ' + bad.length + ' 个效果需要修：' + bad.map(b => b[0] + '(' + b[1] + ')').join(', ')
                                  : '✅ 全部效果输出合法'));
  process.exit(bad.length ? 1 : 0);
})();
