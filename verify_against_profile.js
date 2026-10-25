#!/usr/bin/env node
/*
 * 用「官方导出的配置表」核对 index.html 里 WAVE75 的灯号映射。
 *
 *   官方文件：PMO/RDR 驱动「配置管理 → 导出」出来的 rdr-profile-*.json
 *   里面 keyInfos[layer][] 每个键都带 index（矩阵槽位）和 lightIndex（灯号）。
 *
 * 用法:
 *   node verify_against_profile.js <rdr-profile.json> [布局名=WAVE75]
 *
 * 检查四件事，任何一项不一致都会打印并返回非 0：
 *   1. 键的集合（键名数量一致、不多不少）
 *   2. 每个键的 lightIndex 与页面布局 k[0] 是否一致
 *   3. 灯号是否连续可覆盖（缺口、leds 是否够）
 *   4. 如果同目录有 slot1_colors.json（read_slot1.py 的产物），再拿官方
 *      keyItemColor[].color 和实际从键盘读回的色值做逐字节比对
 */
const fs = require('fs');
const path = require('path');

const file = process.argv[2];
const layoutKey = process.argv[3] || 'WAVE75';
if (!file) {
  console.error('用法: node verify_against_profile.js <rdr-profile.json> [布局名]');
  process.exit(2);
}

// 从 index.html 里抠出 LAYOUTS 对象（不执行整页脚本）
function loadLayouts(htmlFile) {
  const html = fs.readFileSync(htmlFile, 'utf8');
  const i = html.indexOf('const LAYOUTS');
  if (i < 0) throw new Error('index.html 里找不到 const LAYOUTS');
  const s = html.indexOf('{', i);
  let d = 0, e = -1;
  for (let p = s; p < html.length; p++) {
    const c = html[p];
    if (c === '"') { p++; while (html[p] !== '"') { if (html[p] === '\\') p++; p++; } continue; }
    if (c === '{') d++;
    else if (c === '}') { d--; if (!d) { e = p; break; } }
  }
  return eval('(' + html.slice(s, e + 1) + ')');
}

// 键名归一化：官方写 "Caps Lock" / "Page Up" / "Delete"，页面里是 "Caps" / "PgUp" / "Del"
const norm = n => String(n)
  .replace(/\s+/g, '').toLowerCase()
  .replace('delete', 'del')
  .replace('backspace', 'bksp')
  .replace('pageup', 'pgup')
  .replace('pagedown', 'pgdn')
  .replace('capslock', 'caps')
  .replace(/^`$/, '~');

const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
const layouts = loadLayouts(path.join(__dirname, 'index.html'));
const lay = layouts[layoutKey];
if (!lay) {
  console.error('index.html 里没有布局 "' + layoutKey + '"');
  process.exit(2);
}

const official = new Map();
for (const k of profile.keyInfos[0]) official.set(norm(k.keyName), k.lightIndex);

const mine = new Map();
for (const k of lay.k) mine.set(norm(k[7] || ''), k[0]);

console.log('官方文件 : ' + path.basename(file));
console.log('设备     : ' + (profile.deviceName || '?') + '  固件 ' + (profile.deviceVersion || '?') +
            '  协议 ' + (profile.protocol || '?'));
console.log('导出时间 : ' + (profile.exportedAt || '?'));
console.log('配置     : ' + (profile.profileName || '?') + ' #' + profile.profileIndex);
console.log('页面布局 : ' + layoutKey + '  leds=' + lay.leds + ' off=' + (lay.off || 0) +
            ' 键数=' + lay.k.length);
console.log('官方键数 : ' + official.size + '  (keyInfos 共 ' + profile.keyInfos.length + ' 层)');
console.log('');

let fail = 0;

// 1. 键集合
const onlyMine = [...mine.keys()].filter(n => !official.has(n));
const onlyOff = [...official.keys()].filter(n => !mine.has(n));
if (onlyMine.length || onlyOff.length) {
  fail++;
  console.log('✗ 键集合不一致');
  if (onlyMine.length) console.log('    页面多出: ' + onlyMine.join(', '));
  if (onlyOff.length) console.log('    页面缺少: ' + onlyOff.join(', '));
} else {
  console.log('✓ 键集合一致（' + official.size + ' / ' + mine.size + '）');
}

// 2. 逐键灯号
const diffs = [];
for (const [n, li] of official) {
  if (!mine.has(n)) continue;
  if (mine.get(n) !== li) diffs.push({ n, mine: mine.get(n), off: li });
}
if (diffs.length) {
  fail++;
  console.log('✗ 灯号不一致 ' + diffs.length + ' 处');
  for (const d of diffs) console.log('    ' + d.n.padEnd(12) + ' 页面 ' + d.mine + ' / 官方 ' + d.off);
} else {
  console.log('✓ 灯号逐键一致（0 处差异）');
}

// 3. 灯号覆盖
const used = [...official.values()].sort((a, b) => a - b);
const maxLi = used[used.length - 1];
const holes = [];
for (let i = 0; i <= maxLi; i++) if (!used.includes(i)) holes.push(i);
const needLeds = maxLi + 1;
console.log('✓ 灯号范围 0..' + maxLi + '（需要 leds >= ' + needLeds + '），空号: ' +
            (holes.length ? holes.join(',') : '无'));
if (lay.leds < needLeds) {
  fail++;
  console.log('✗ 布局 leds = ' + lay.leds + '，不够覆盖到 ' + maxLi);
} else if (lay.leds > needLeds) {
  console.log('  · 布局 leds = ' + lay.leds + '，比需要的 ' + needLeds + ' 多（固件若按整帧收，保持原值即可）');
}
const maxPage = Math.max(...lay.k.map(k => k[0] + (lay.off || 0)));
if (maxPage !== maxLi) {
  fail++;
  console.log('✗ 页面最大灯号 ' + maxPage + ' 与官方最大灯号 ' + maxLi + ' 不符');
}

// 4. 逐键色值（需要 slot1_colors.json —— 用 read_slot1.py 从键盘 0x22 读回）
const slotFile = path.join(__dirname, 'slot1_colors.json');
if (profile.keyItemColor && profile.keyItemColor.length && fs.existsSync(slotFile)) {
  const slot = JSON.parse(fs.readFileSync(slotFile, 'utf8')).colors;
  let same = 0;
  const diff = [];
  const unpainted = [];
  for (const e of profile.keyItemColor) {
    const li = e.lightIndex;
    const want = String(e.color || '').toLowerCase();
    const got = String(slot[li] || '').toLowerCase();
    if (want === got) { same++; continue; }
    if (want === '#000000') { unpainted.push(e.name + '(li' + li + ' 官方记录为黑，槽内 ' + got + ')'); continue; }
    diff.push({ n: e.name, li, want, got });
  }
  console.log('');
  console.log('· 逐键色值：官方 keyItemColor vs 键盘 0x22 实读');
  console.log('  完全相同 ' + same + ' / ' + profile.keyItemColor.length +
              (unpainted.length ? ('，官方记录为未上色 ' + unpainted.length + ' 个') : '') +
              (diff.length ? ('，实差 ' + diff.length + ' 个') : ''));
  for (const u of unpainted) console.log('    ○ ' + u);
  for (const d of diff) {
    fail++;
    console.log('    ✗ ' + d.n.padEnd(10) + ' li' + d.li + '  官方 ' + d.want + '  实读 ' + d.got);
  }
} else if (profile.keyItemColor && profile.keyItemColor.length) {
  console.log('');
  console.log('· 官方 keyItemColor 有 ' + profile.keyItemColor.length +
              ' 个键的色值；想连颜色一起核对，先跑 python read_slot1.py');
}

// 物理顺序表
console.log('');
console.log('官方物理顺序（键 = 灯号）:');
const rowsByLine = [];
let line = [];
for (const k of profile.keyInfos[0]) {
  line.push((k.keyName + '=' + k.lightIndex).padEnd(16));
  if (line.length === 8) { rowsByLine.push(line.join('')); line = []; }
}
if (line.length) rowsByLine.push(line.join(''));
for (const l of rowsByLine) console.log('  ' + l);

console.log('');
console.log(fail ? ('✗ 共 ' + fail + ' 项不通过') : '✓ 全部通过：页面布局与官方导出完全一致');
process.exit(fail ? 1 : 0);
