// 离线跑一遍「index.html」的协议链路：用假 HID 设备模拟固件回包
// 目的：在不插键盘的情况下证明 armMatrix → testFrame → pushFrame → stopAll 不再抛异常
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const m = html.match(/<script[^>]*>([\s\S]*?)<\/script>\s*<\/body>/);
const code = (html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [])
  .map(s => s.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''))
  .sort((a, b) => b.length - a.length)[0];

// ---------- 假固件 ----------
const fw = {
  fi: new Uint8Array(64),
  pending: null,
  frames: [],          // {off, len, data}
  log: []
};
fw.fi[1] = 1;          // switch=1 关着
fw.fi[2] = 1;          // mode=流光溢彩
fw.fi[3] = 0;          // bright=0
fw.fi[4] = 3;          // speedRev
fw.fi[10] = 0;

const info = new Uint8Array(56);
[0xAA, 0xBB, 0xB0, 0x36, 0x09, 0x30, 0x02, 0x01, 0x03, 0x01].forEach((v, i) => info[i] = v);
info[15] = 21; info[16] = 160; info[17] = 4; info[19] = 1; info[23] = 0;

const dev = {
  vendorId: 14000, productId: 0x3009, productName: 'WAVE 75 RGB',
  opened: true, __listeners: [], __rxHook: null,
  addEventListener(t, f){ this.__listeners.push(f); },
  removeEventListener(t, f){ this.__listeners = this.__listeners.filter(x => x !== f); },
  close(){ this.opened = false; },
  async open(){ this.opened = true; },
  reply(bytes){
    const buf = new Uint8Array(64);
    buf.set(bytes.subarray(0, 64));
    const dv = new DataView(buf.buffer);
    for (const f of this.__listeners) f({ reportId: 0, data: dv });
  },
  async sendReport(rid, payload){
    const b = Uint8Array.from(payload);
    const cmd = b[1], off = b[2] | (b[3] << 8), len = b[4];
    const data = b.slice(8, 8 + len);
    fw.log.push('tx 0x' + cmd.toString(16) + ' off=' + off + ' len=' + len);
    const out = new Uint8Array(64);
    out[0] = 0xAA; out[1] = cmd; out[2] = b[2]; out[3] = b[3]; out[4] = len;
    const fill = (src) => { for (let i = 0; i < len; i++) out[8 + i] = src[off + i] || 0; };
    if (cmd === 0x10 || cmd === 0x11){
      if (cmd === 0x11 && fw.pending){ fw.fi.set(fw.pending); fw.pending = null; }
    } else if (cmd === 0x12){
      fill(info);
    } else if (cmd === 0x14){
      fill(fw.fi);
    } else if (cmd === 0x15){
      if (!fw.pending) fw.pending = Uint8Array.from(fw.fi);
      for (let i = 0; i < len; i++) fw.pending[off + i] = data[i];
    } else if (cmd === 0x2E){
      fw.frames.push({ off, len, data: Array.from(data) });
    } else if (cmd === 0x32 || cmd === 0x34){
      for (let i = 0; i < len; i++) out[8 + i] = 0;
    } else if (cmd === 0x2F){
      // ok
    }
    out[7] = 0x55;
    setImmediate(() => this.reply(out));
    return undefined;
  }
};

// ---------- 假环境 ----------
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
function el(id){
  if (els.has(id)) return els.get(id);
  const e = mkEl('div', id);
  els.set(id, e);
  return e;
}

global.document = {
  body: el('body'),
  documentElement: el('html'),
  getElementById: el,
  querySelector: () => el('q'),
  createElement: (tag) => mkEl(tag, ''),
  addEventListener(){}
};
global.window = { addEventListener(){}, devicePixelRatio: 1, matchMedia: () => ({ matches: false, addEventListener(){} }) };
global.navigator = { hid: { getDevices: async () => [dev], requestDevice: async () => [dev], addEventListener(){} } };
global.requestAnimationFrame = () => 0;
global.performance = { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 };
global.alert = m => console.log('[alert]', m);
global.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
global.AudioContext = function(){ return { resume(){}, createMediaStreamSource(){}, analyser: { getByteFrequencyData(){}, frequencyBinCount: 32 }, close(){} }; };

// ---------- 执行 ----------
const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const runner = new AsyncFunction(code + `
;return { S, armMatrix, testFrame, pushFrame, stopAll, writeSlot, buildGrid, setLayout, readFuncInfo, CMD, attachRx, diag,
  previewChannel, setPreviewMode, FIRMWARE_BRIGHTNESS, FIRMWARE_PREVIEW_SCALE };`);

(async () => {
  let api;
  try {
    api = await runner();
  } catch (e){
    console.log('❌ 脚本初始化就抛错：', e.message);
    process.exit(1);
  }
  console.log('✅ 脚本初始化通过');

  const { S, armMatrix, pushFrame, stopAll, buildGrid, testFrame } = api;
  S.dev = dev;
  api.attachRx(dev);
  S.reportId = 0;
  S.G = buildGrid('WAVE75');
  S.heat = new Float32Array(S.G.leds);
  S.armed = false;

  // 先跑一次开启通道
  try {
    await armMatrix();
  } catch (e){
    console.log('❌ armMatrix 抛错：', e.message);
    process.exit(1);
  }
  console.log('   固件内 mode =', fw.fi[2], ' switch =', fw.fi[1], ' bright =', fw.fi[3]);
  console.log('   S.armed =', S.armed, ' S.ledCount =', S.ledCount, ' origMode =', S.origMode);
  const red = fw.frames.filter(f => f.len && f.data[0] === 0x00 && f.data[1] === 0xF8);
  console.log('   收到 0x2E 包 ' + fw.frames.length + ' 个，红色包 ' + red.length + ' 个');

  // 再推一帧（模拟渲染循环）
  fw.frames.length = 0;
  const out = S.G.out;
  for (let i = 0; i < S.G.leds; i++){ out[i*3] = 0; out[i*3+1] = 255; out[i*3+2] = 0; }
  // 单独给 → 刷蓝，验证最后一颗灯真的进了帧（灯号 46 不存在，A 起顺延一位）
  const arrowLi = (S.G.byName.get('→') || {}).li;
  const escLi = (S.G.byName.get('Esc') || {}).li;
  if (arrowLi !== undefined){ out[arrowLi*3] = 0; out[arrowLi*3+1] = 0; out[arrowLi*3+2] = 255; }
  S.pushAt = 0;
  await pushFrame();
  const total = fw.frames.reduce((a, f) => a + f.len, 0);
  const flat = [];
  for (const f of fw.frames) for (let i = 0; i < f.len; i++) flat[f.off + i] = f.data[i];
  const beadArrow = (flat[arrowLi*2] | (flat[arrowLi*2+1] << 8));
  console.log('   布局键数 ' + S.G.keys.length + '，G.leds = ' + S.G.leds
    + '（WAVE75：81 键占 0..81，46 号是固件里的空号，没有实体灯）');
  console.log('   Esc = ' + escLi + ' 号，→ = ' + arrowLi + ' 号（实测应为 0 / 81）');
  console.log('   pushFrame 包数 ' + fw.frames.length + '，总字节 ' + total + '（应为 3 / 164）');
  console.log('   ' + arrowLi + ' 号灯（→）RGB565 = 0x' + beadArrow.toString(16) + '（蓝 0x001F）');
  console.log('   首灯 RGB565 = 0x' + (fw.frames[0].data[0] | (fw.frames[0].data[1] << 8)).toString(16) + '（绿 0x07E0）');

  // 真实预览只缩放显示通道：255→159（160/256），原始帧与 HID 推流数据不变
  const rawBeforePreview = Array.from(out);
  api.setPreviewMode(true);
  const realWhite = api.previewChannel(255), realMid = api.previewChannel(128);
  api.setPreviewMode(false);
  const rawWhite = api.previewChannel(255);
  const previewOk = api.FIRMWARE_BRIGHTNESS === 160 && api.FIRMWARE_PREVIEW_SCALE === 0.625
    && realWhite === 159 && realMid === 80 && rawWhite === 255
    && rawBeforePreview.every((v, i) => out[i] === v);
  console.log('   真实预览 255→' + realWhite + '，128→' + realMid + '；原始 RGB=' + rawWhite
    + '；原始帧未修改=' + rawBeforePreview.every((v, i) => out[i] === v));
  api.setPreviewMode(true);

  // 停止还原
  await stopAll();
  console.log('   停止后 固件 mode =', fw.fi[2], 'switch =', fw.fi[1], '（应回到 1 / 1）');

  const okShape = fw.frames.length === 3 && total === 164 && arrowLi === 81 && escLi === 0
    && S.G.leds === 82 && (S.G.byName.get('A') || {}).li === 47 && previewOk;
  console.log(okShape ? '\n✅ 协议链路无异常，帧长与分块正确' : '\n❌ 帧结构不对');
  process.exit(okShape ? 0 : 1);
})();
