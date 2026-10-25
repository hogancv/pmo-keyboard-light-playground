// 离线测「自定义灯光编辑器」：框选命中、填充、撤销重做、渐变、写槽、导入导出
// 不插键盘，用假 HID 设备 + 假 DOM 跑真代码
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
const code = (html.match(/<script[^>]*>([\s\S]*?)<\/script>/g) || [])
  .map(s => s.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, ''))
  .sort((a, b) => b.length - a.length)[0];

// ---------- 假固件（只关心 0x23 写槽） ----------
const fw = { fi: new Uint8Array(64), slot: new Uint8Array(384), log: [] };
fw.fi[1] = 0; fw.fi[2] = 253; fw.fi[3] = 160; fw.fi[10] = 0;

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
    if (cmd === 0x2e){                       // 攒最近的推帧内容，供"保持静态帧"断言比对
      if (!fw.acc) fw.acc = new Uint8Array(512);
      for (let i = 0; i < len; i++) fw.acc[off + i] = data[i];
    }
    const out = new Uint8Array(64);
    out[0] = 0xAA; out[1] = cmd; out[2] = b[2]; out[3] = b[3]; out[4] = len;
    const fill = (src) => { for (let i = 0; i < len; i++) out[8 + i] = src[off + i] || 0; };
    if (cmd === 0x10 || cmd === 0x11){
      // ok
    } else if (cmd === 0x12){
      fill(info);
    } else if (cmd === 0x14){
      fill(fw.fi);
    } else if (cmd === 0x15){
      // SET_FUNCINFO：真固件要等 STOP_COMM 才提交，这里直接落库
      for (let i = 0; i < len; i++) fw.fi[off + i] = data[i];
    } else if (cmd === 0x23 || cmd === 0x25 || cmd === 0x27 || cmd === 0x29 || cmd === 0x2B){
      for (let i = 0; i < len; i++) fw.slot[off + i] = data[i];
    } else if (cmd === 0x22 || cmd === 0x24 || cmd === 0x26 || cmd === 0x28 || cmd === 0x2A){
      fill(fw.slot);
    } else if (cmd === 0x32 || cmd === 0x34){
      for (let i = 0; i < len; i++) out[8 + i] = 0;
    }
    out[7] = 0x55;
    setImmediate(() => this.reply(out));
    return undefined;
  }
};

// ---------- 假 DOM ----------
const mkEl = (tag, id) => ({
  tagName: tag.toUpperCase(), id, textContent: '', innerHTML: '', value: '', title: '',
  disabled: false, className: '', children: [], style: {}, dataset: {}, checked: true,
  width: 940, height: 340,
  classList: { _s: new Set(), add(c){ this._s.add(c); }, remove(c){ this._s.delete(c); },
    toggle(c, v){ if (v === undefined) this._s.has(c) ? this._s.delete(c) : this._s.add(c); else v ? this._s.add(c) : this._s.delete(c); },
    contains(c){ return this._s.has(c); } },
  appendChild(c){ this.children.push(c); return c; },
  removeChild(c){ this.children = this.children.filter(x => x !== c); },
  addEventListener(){}, removeEventListener(){}, click(){},
  getContext(){ return new Proxy({}, { get: (t, k) => (k === 'canvas' ? this : () => {}) }); },
  getBoundingClientRect(){ return { left: 0, top: 0, width: this.width, height: this.height }; },
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
global.window = { addEventListener(){}, devicePixelRatio: 1 };
global.navigator = { hid: { getDevices: async () => [dev], requestDevice: async () => [dev], addEventListener(){} } };
global.requestAnimationFrame = () => 0;
global.performance = { now: () => Number(process.hrtime.bigint() / 1000n) / 1000 };
global.localStorage = { getItem: () => null, setItem(){}, removeItem(){} };
global.confirm = () => true;
global.alert = () => {};

// 导出用
let lastBlob = null, lastDownload = '';
global.Blob = function(parts, opt){ this.parts = parts; this.type = opt && opt.type; lastBlob = this; };
global.URL = { createObjectURL(){ return 'blob:fake'; }, revokeObjectURL(){} };
const origCreate = global.document.createElement;
global.document.createElement = function(tag){
  const e = origCreate(tag);
  if (tag === 'a'){
    Object.defineProperty(e, 'href', { set(v){}, get(){ return ''; }, configurable: true });
    e.click = function(){ lastDownload = e.download; };
  }
  return e;
};

const AsyncFunction = Object.getPrototypeOf(async function(){}).constructor;
const runner = new AsyncFunction(code + `
;return { S, ED, buildGrid, setLayout, attachRx, edOpen, edClose, edDown, edMove, edUp, edRectKeys,
  edFill, edUndo, edRedo, edGrad, edRowFix, edPreset, edBuildPresets, edWriteSlot, edExport, edImportFile,
  edLoadSlotQuiet, edSwitchSlot, edAutoSave,
  edSetColor, edGet, edPut, edKeys, edSelKeys, edSnap, edPushLive, edTakeOver, edRelease, pushFrame,
  edStartStream, edStopStream, switchTab, edGate, CMD, CMD_SLOT, CMD_SLOT_RD };`);

let pass = 0, fail = 0;
function ok(name, cond, extra){
  if (cond){ pass++; console.log('  ✅ ' + name + (extra ? '  ' + extra : '')); }
  else { fail++; console.log('  ❌ ' + name + (extra ? '  ' + extra : '')); }
}

(async () => {
  let api;
  try {
    api = await runner();
  } catch (e){
    console.log('❌ 初始化抛错：' + e.message + '\n' + (e.stack || ''));
    process.exit(1);
  }
  const { S, ED, buildGrid, edDown, edMove, edUp, edFill, edUndo, edRedo, edGrad,
          edWriteSlot, edExport, edImportFile, edGet, edKeys, edRectKeys } = api;

  S.dev = dev;
  api.attachRx(dev);
  S.reportId = 0;
  S.G = buildGrid('WAVE75');
  S.heat = new Float32Array(S.G.leds);
  S.armed = true;
  S.ledCount = 82;
  const G = S.G;
  console.log('布局 WAVE75：' + G.keys.length + ' 键，leds=' + G.leds + '\n');

  // ---- 1. 框选 ----
  console.log('1) 框选');
  const cv = el('edCv');
  cv.width = G.w; cv.height = G.h;

  // 整块画布
  let hit = edRectKeys(0, 0, G.w, G.h);
  ok('整块框选命中全部键', hit.length === G.keys.length, hit.length + '/' + G.keys.length);

  // 只框第二行（数字行）
  const row1 = G.keys.filter(k => Math.abs(k.y - 0.1838) < 1e-4);
  const hitRow = edRectKeys(0, 0.19 * G.h, G.w, 0.32 * G.h);
  ok('横向条带只命中该行', hitRow.length === row1.length && row1.length > 0,
     '命中 ' + hitRow.length + ' / 行内 ' + row1.length);

  // 用指针事件走一遍真实交互
  const ev = (x, y, extra) => Object.assign({
    clientX: x, clientY: y, pointerId: 1, preventDefault(){},
    shiftKey: false, ctrlKey: false, metaKey: false, altKey: false
  }, extra || {});
  ED.tool = 'box';
  edDown(ev(0.05 * G.w, 0.19 * G.h));
  edMove(ev(0.5 * G.w, 0.32 * G.h));
  edUp(ev(0.5 * G.w, 0.32 * G.h));
  const sel1 = ED.sel.size;
  ok('拖拽产生选区', sel1 > 0 && sel1 < G.keys.length, '选中 ' + sel1 + ' 颗');

  // Shift 追加
  edDown(ev(0.55 * G.w, 0.34 * G.h, { shiftKey: true }));
  edMove(ev(0.95 * G.w, 0.65 * G.h, { shiftKey: true }));
  edUp(ev(0.95 * G.w, 0.65 * G.h, { shiftKey: true }));
  ok('Shift 追加不覆盖原选区', ED.sel.size > sel1, sel1 + ' → ' + ED.sel.size);

  // 单击单颗
  const aKey = G.byName.get('A');
  edDown(ev((aKey.x + aKey.w / 2) * G.w, (aKey.y + aKey.h / 2) * G.h));
  edUp(ev((aKey.x + aKey.w / 2) * G.w, (aKey.y + aKey.h / 2) * G.h));
  ok('单击只选中一颗', ED.sel.size === 1 && ED.sel.has(aKey.li), 'A = LED ' + aKey.li);

  // ---- 2. 填充 / 撤销 ----
  console.log('\n2) 填充与撤销');
  edFill([255, 0, 0]);
  ok('填充写入 LED 47', JSON.stringify(edGet(aKey.li)) === '[255,0,0]', JSON.stringify(edGet(aKey.li)));
  ok('邻键没被误伤', JSON.stringify(edGet(aKey.li + 1)) === '[0,0,0]', 'LED ' + (aKey.li + 1));
  edUndo();
  ok('撤销回到黑色', JSON.stringify(edGet(aKey.li)) === '[0,0,0]');
  edRedo();
  ok('重做恢复红色', JSON.stringify(edGet(aKey.li)) === '[255,0,0]');

  // ---- 3. 全选 + 渐变 ----
  console.log('\n3) 渐变');
  ED.sel = new Set(G.keys.map(k => k.li));
  ED.color = [255, 0, 0]; ED.color2 = [0, 0, 255];
  edGrad('h');
  const esc = G.byName.get('Esc'), arrowR = G.byName.get('→');
  const cL = edGet(esc.li), cR = edGet(arrowR.li);
  ok('水平渐变左端偏红', cL[0] > cL[2], 'Esc=' + cL.join(','));
  ok('水平渐变右端偏蓝', cR[2] > cR[0], '→=' + cR.join(','));
  edUndo();

  // 预设图案
  ED.sel = new Set();
  api.edPreset(0);            // 极光（板载自定义一的静态备份）
  const aurA = edGet(G.byName.get('A').li), aurR = edGet(arrowR.li);
  ok('预设「极光」按灯号取到备份色（A = #d40cf9 → 212,12,249）',
     JSON.stringify(aurA) === '[212,12,249]', JSON.stringify(aurA));
  ok('预设「极光」把 → 落成 #0cfd99（12,253,153）',
     JSON.stringify(aurR) === '[12,253,153]', JSON.stringify(aurR));
  ok('预设「极光」没把空号 46 写脏', JSON.stringify(edGet(46)) === '[0,0,0]', JSON.stringify(edGet(46)));

  ED.sel = new Set();
  api.edPreset(3);            // 日落
  const pL = edGet(esc.li), pR = edGet(arrowR.li);
  ok('预设「日落」左暖右冷', pL[0] > pL[2] && pR[2] > pR[0],
     'Esc=' + pL.join(',') + ' →=' + pR.join(','));
  const before = JSON.stringify(edGet(aKey.li));
  api.edPreset(8);            // 随机
  const changed = edKeys().filter(function(k){ return JSON.stringify(edGet(k.li)) !== '[0,0,0]'; }).length;
  ok('预设「随机」给整把上色', changed === edKeys().length, changed + '/' + edKeys().length);
  edUndo();
  ED.sel = new Set();

  // ---- 4. 保存 / 自动保存 / 切槽 ----
  console.log('\n4) 保存 / 自动保存 / 切槽');
  ED.sel = new Set([aKey.li]);
  edFill([0, 255, 128]);
  // 先把键盘摆成"停在别的灯效上"，看保存后会不会被切到自定义槽
  fw.fi[1] = 1; fw.fi[2] = 7; fw.fi[10] = 0;
  await edWriteSlot();
  const o = aKey.li * 3;
  ok('保存后固件里 LED 47 = 0,255,128',
     fw.slot[o] === 0 && fw.slot[o + 1] === 255 && fw.slot[o + 2] === 128,
     '[' + fw.slot[o] + ',' + fw.slot[o + 1] + ',' + fw.slot[o + 2] + ']');
  ok('保存走的是 0x23（自定义一）', fw.log.some(l => l.startsWith('tx 0x23')), '');
  ok('保存后自动切到该槽：lightMode 7 → 253', fw.fi[2] === 253, 'mode=' + fw.fi[2]);
  ok('保存后 lightCustomIndex = 0（自定义一）', fw.fi[10] === 0, 'slot=' + fw.fi[10]);
  ok('保存后灯是开的：lightSwitch = 0', fw.fi[1] === 0, 'switch=' + fw.fi[1]);

  // 自动保存：改动停 1.2s 后自动落槽（不需要点任何按钮）
  fw.slot.fill(0);
  fw.log.length = 0;
  ED.open = true;                        // 自动保存只在自定义分页里生效
  ED.sel = new Set([aKey.li]);
  edFill([9, 99, 199]);
  ok('改动把画布标脏', ED.dirty === true, String(ED.dirty));
  await new Promise(r => setTimeout(r, 1700));
  ok('自动保存把 LED 47 落成 9,99,199',
     fw.slot[o] === 9 && fw.slot[o + 1] === 99 && fw.slot[o + 2] === 199,
     '[' + fw.slot[o] + ',' + fw.slot[o + 1] + ',' + fw.slot[o + 2] + ']');
  ok('自动保存走的也是 0x23', fw.log.some(l => l.startsWith('tx 0x23')), '');
  ok('保存后画布干净（dirty = false）', ED.dirty === false, String(ED.dirty));
  ED.open = false; ED.dirty = false;

  // 静默读槽（打开编辑器 / 切槽时自动载入板载配色）
  fw.slot.fill(0);
  fw.slot[o] = 12; fw.slot[o + 1] = 34; fw.slot[o + 2] = 56;
  await api.edLoadSlotQuiet();
  ok('读槽把 12,34,56 读回来了', JSON.stringify(edGet(aKey.li)) === '[12,34,56]',
     JSON.stringify(edGet(aKey.li)));

  // 点槽位数字 = 切槽：载入该槽内容 + 键盘切过去 + 撤销栈清空
  fw.fi[2] = 7; fw.fi[10] = 0;
  await api.edSwitchSlot(1);
  ok('切槽后 ED.slot = 1', ED.slot === 1, String(ED.slot));
  ok('切槽把固件指到自定义二（mode=253, index=1）', fw.fi[2] === 253 && fw.fi[10] === 1,
     fw.fi[2] + '/' + fw.fi[10]);
  ok('切槽清掉撤销栈和选区', ED.undo.length === 0 && ED.sel.size === 0,
     ED.undo.length + '/' + ED.sel.size);
  await api.edSwitchSlot(0);
  ok('切回自定义一（253/0）', ED.slot === 0 && fw.fi[10] === 0, fw.fi[2] + '/' + fw.fi[10]);
  ok('切回后载入了槽里的 12,34,56', JSON.stringify(edGet(aKey.li)) === '[12,34,56]',
     JSON.stringify(edGet(aKey.li)));
  ED.dirty = false;

  // ---- 5. 导出 / 导入 ----
  console.log('\n5) 导出与导入');
  edExport();
  ok('导出的文件名正确', lastDownload === 'pmo-custom1.json', lastDownload);
  const json = JSON.parse(lastBlob.parts.join(''));
  ok('导出含 128 个色值', Array.isArray(json.colors) && json.colors.length === 128);
  ok('导出含 81 条 key 记录', json.keys.length === 81);
  ok('导出里 A 的颜色是 #0c2238', json.keys.find(k => k.name === 'A').color === '#0c2238',
     json.keys.find(k => k.name === 'A').color);

  // 模拟导入：本页格式
  const back = ED.buf.slice();
  ED.buf = new Uint8Array(384);
  await new Promise(res => {
    api.edImportFile === edImportFile;
    // FileReader 桩
    global.FileReader = function(){
      this.readAsText = (f) => { this.result = f.__text; setTimeout(() => this.onload(), 0); };
    };
    edImportFile({ __text: JSON.stringify(json) });
    setTimeout(res, 20);
  });
  ok('导入后逐字节还原', Buffer.compare(Buffer.from(ED.buf), Buffer.from(back)) === 0);

  // 模拟导入：驱动导出的 rdr-profile 格式
  const prof = { keyItemColor: [
    { name: 'Esc', lightIndex: 0, color: '#112233' },
    { name: 'A', lightIndex: 47, color: '#445566' }
  ] };
  edImportFile({ __text: JSON.stringify(prof) });
  await new Promise(r => setTimeout(r, 20));
  ok('能导入驱动 profile 的 keyItemColor',
     JSON.stringify(edGet(0)) === '[17,34,51]' && JSON.stringify(edGet(47)) === '[68,85,102]',
     edGet(0) + ' / ' + edGet(47));
  ED.dirty = false;                     // 导入会标脏；掐掉自动保存，别干扰后面的推流计数

  // ---- 6. 行补齐 ----
  console.log('\n6) 同色补满整行');
  ED.buf = new Uint8Array(384);
  ED.sel = new Set([aKey.li]);
  edFill([10, 20, 30]);
  api.edRowFix();
  const rowOfA = edKeys().filter(k => k.r === aKey.r);
  const allSame = rowOfA.every(k => JSON.stringify(edGet(k.li)) === '[10,20,30]');
  ok('整行同步成同一色', allSame && rowOfA.length > 5, rowOfA.length + ' 颗');

  // ---- 7. 推流仲裁 ----
  console.log('\n7) 推流仲裁（编辑器和主循环不能同时推）');
  const pk = () => fw.log.filter(l => l.startsWith('tx 0x2e')).length;
  S.armed = true; S.fxPaused = false; S.txBusy = false;

  // 前面编辑动作留下的节流尾帧/重试先全部放完、掐掉，再开始计数
  if (ED.pushTimer){ clearTimeout(ED.pushTimer); ED.pushTimer = 0; }
  ED.lastPush = 0;
  await new Promise(r => setTimeout(r, 120));
  fw.log.length = 0;
  S.fxPaused = true;                       // 模拟编辑器已接管
  await api.pushFrame();
  ok('编辑器接管时主循环一帧都不推', pk() === 0, pk() + ' 包');

  S.fxPaused = false;
  await api.pushFrame();
  ok('交还通道后主循环恢复推帧', pk() === 3, pk() + ' 包（164B / 56 = 3 包）');

  fw.log.length = 0;
  S.txBusy = true;                         // 编辑器那一路正在发
  await api.pushFrame();
  ok('通道被占用时主循环跳过，不插队', pk() === 0, pk() + ' 包');
  S.txBusy = false;

  fw.log.length = 0;
  ED.live = true; S.txBusy = true;
  await api.edPushLive(true);
  ok('持续推流（force）遇占用直接跳过，不排队', pk() === 0, pk() + ' 包');
  S.txBusy = true;
  await api.edPushLive(false);           // 编辑动作触发的单次推送
  S.txBusy = false;
  ok('单次推送遇占用也没硬插', pk() === 0, pk() + ' 包');
  await new Promise(r => setTimeout(r, 150));   // 等尾帧放出来
  ok('排队的尾帧随后补上', pk() > 0, pk() + ' 包');

  // 编辑器关闭 = 交还通道
  fw.log.length = 0;
  S.fxPaused = true;
  api.edRelease();
  ok('edRelease 交还通道（fxPaused 归位）', S.fxPaused === false, String(S.fxPaused));

  // ---- 8. 持续推流 ----
  console.log('\n8) 持续推流（否则固件只显一帧就回原厂动画）');
  S.armed = true; S.fxPaused = true; ED.live = true; ED.open = true;
  ED.buf.fill(0); ED.buf[0] = 200; ED.buf[1] = 100; ED.buf[2] = 50;
  fw.log.length = 0;
  api.edStartStream();
  await new Promise(r => setTimeout(r, 220));
  const streamPk = pk();
  api.edStopStream();
  ok('220ms 内持续发出多帧（不是一帧）', streamPk >= 9,
     streamPk + ' 包 ≈ ' + Math.round(streamPk / 3) + ' 帧');

  fw.log.length = 0;
  await new Promise(r => setTimeout(r, 120));
  ok('edStopStream 之后彻底停手', pk() === 0, pk() + ' 包');

  // 空画布不能推（全黑帧会把键盘推灭）
  ED.buf.fill(0);
  fw.log.length = 0;
  api.edStartStream();
  await new Promise(r => setTimeout(r, 120));
  api.edStopStream();
  ok('空画布不推黑帧', pk() === 0, pk() + ' 包');
  ED.open = false;
  S.fxPaused = false;

  // ---- 9. 分页 + 门禁 ----
  console.log('\n9) 分页与通道门禁');
  ED.open = false;
  api.switchTab('ed');
  ok('切到自定义分页后进入编辑器', ED.open === true, String(ED.open));
  ok('通道已开时门禁收起', !el('edGate').classList.contains('on'));
  // 门禁：模拟通道未开
  ED.open = false;
  S.fxPaused = false;
  S.armed = false;
  api.switchTab('fx');
  api.switchTab('ed');
  ok('通道未开时门禁盖上（编辑器不可用）', el('edGate').classList.contains('on'));
  ok('通道未开时不接管推流（主循环继续）', S.fxPaused === false, String(S.fxPaused));

  // 通道开好以后重新进入：应当接管并持续推
  S.armed = true;
  S.fxPaused = false;
  api.switchTab('fx');
  api.switchTab('ed');
  await new Promise(r => setTimeout(r, 60));
  ok('通道开好后进入分页 = 接管推流', S.fxPaused === true, String(S.fxPaused));
  ED.buf = new Uint8Array(384); ED.buf[0] = 40; ED.buf[1] = 90; ED.buf[2] = 140;
  fw.log.length = 0;
  await new Promise(r => setTimeout(r, 500));   // 接管含 enterSlotMode（80+60ms 等待），窗口放宽
  ok('接管后持续推流（多帧，不是一帧）', fw.log.filter(l => l.startsWith('tx 0x2e')).length >= 6,
     fw.log.filter(l => l.startsWith('tx 0x2e')).length + ' 包');
  ok('接管时固件已指向当前槽（断流后停在自定义配色）', fw.fi[2] === 253, 'mode=' + fw.fi[2]);

  // 切回动画分页 = 交还通道，主循环恢复推
  fw.log.length = 0;
  api.switchTab('fx');
  ok('切回动画分页 = 交还通道', S.fxPaused === false && !ED.open, String(S.fxPaused) + ' / ' + ED.open);
  await api.pushFrame();
  ok('交还后主循环照常推一帧（3 包）', pk() === 3, pk() + ' 包');

  console.log('\n' + (fail ? '❌ ' : '✅ ') + '通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  process.exit(fail ? 1 : 0);
})().catch(e => { console.log('❌ 运行出错：' + e.message + '\n' + e.stack); process.exit(1); });
