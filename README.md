# PMO Keyboard Lighting Playground

**在浏览器里给键盘逐键点灯——24 种灯效实时推流，单文件、零依赖、无需安装。**

**Live per-key lighting effects for RDR-protocol keyboards, straight from your browser over WebHID.**

![single file](https://img.shields.io/badge/single--file-HTML-2ea44f)
![dependencies](https://img.shields.io/badge/dependencies-none-blue)
![api](https://img.shields.io/badge/WebHID-Chrome%20%2F%20Edge-4a90e2)

**🔗 在线体验：<https://hogancv.github.io/pmo-keyboard-light-playground/>**（需 Chrome / Edge 桌面版）

---

## ⚠️ 兼容性声明 / Compatibility notice

> **本项目目前仅在 WAVE75 键盘上完成实机测试，并确认其功能正常。除此之外的所有机型均未进行测试。**
>
> **This project has only been tested on the WAVE75 keyboard so far, and it works as expected on that model.  
> No other keyboard model has been tested at all.**

具体来说：

- **已实测**：WAVE75（`VID 0x36B0 / PID 0x3009`）。连接、逐键推帧、停止后交还固件、写死到自定义一，全部验证通过；灯号映射经真机逐键校准（`Esc = 1`、`→ = 81`，固件上报 82 颗灯）。
- **未测试**：另外 9 个机型、共 10 套布局（PMO P75、K87、K75、Crush 80、GL68、GP68、ZEN 65 等）是按同族协议与公开资料**推断**出来的，从未上机验证。可能出现**灯位错位、部分键不亮、固件直接拒绝、甚至需要重新插拔**等情况。
- 未测试机型请自行承担风险，可能出现键盘无法输入重新插拔即可。

*Only the WAVE75 (`VID 0x36B0 / PID 0x3009`) has been verified on real hardware. The other nine layouts are inferred from the same protocol family and have never been tested — expect possible LED misalignment, dead keys, or firmware rejection. Use at your own risk.*

---

## 这是什么

键盘厂商的驱动只能给你几种固定的灯效，改一点参数就得到处点。这个东西把控制权拿回来：

- 浏览器通过 **WebHID** 直接连键盘，**每一颗灯**单独寻址，逐帧推送 RGB 数据；
- 页面上同时跑一份**实时预览**，边调边看，不用等键盘反应；
- **24 种效果**，从跑马灯、等离子、生命游戏到烟花、贪吃蛇，全部是逐灯计算的二维动画；
- 纯单文件 HTML，**没有构建、没有 CDN、没有后端**，断网也能用。

## 功能

|             |                                                                                                        |
| ----------- | ------------------------------------------------------------------------------------------------------ |
| **24 种灯效**  | 跑马灯（原创四圈螺旋）、等离子、极光、生命游戏、数字雨、螺旋彩虹、彗星、李萨如、血浆球、彩珠雨滴、EQ 频谱、彩虹波、彩虹闪粉、彩纸、杂耍、心跳、深海、彩色波浪、云雾、扫描眼、星空、烟花、贪吃蛇、自动涟漪 |
| **实时预览**    | 与键盘同帧的 2D 画布预览，可切换机型布局                                                                                 |
| **亮度 / 帧率** | 亮度 5–100（默认 100），推帧 10–60 Hz（默认 25 Hz）                                                                 |
| **中英文界面**   | 右上角一键切换，选择记在 `localStorage`                                                                            |
| **写死到自定义一** | 把当前这一帧的**静态 RGB** 写进板载槽，掉电保留                                                                           |
| **诊断日志**    | 从握手到每一包的状态都留痕，出问题不用猜                                                                                   |
| **零依赖**     | 单个 HTML 文件，双击即开                                                                                        |

> **关于「写死到自定义一」**：板载槽只有一帧的容量（384 字节 = 128 键 × RGB888），写进去的是**按下按钮那一瞬间的静态画面，不是动画**。想让键盘自己跑动画，得靠固件支持，浏览器推流做不到。

## 快速开始

1. 用 **Chrome / Edge**（桌面版 89+）打开 `index.html`。  
   Safari、Firefox 不支持 WebHID，手机上也不行。
2. 点 **「连接键盘」**，在浏览器弹窗里选中你的键盘（同一台设备只需授权一次）。
3. 点 **「开启灯光通道」**，键盘进入自定义模式，页面开始推帧。
4. 左侧挑效果、调亮度与帧率。
5. 结束前点 **「停止并交还固件」**——把 `lightMode` 还原成连接前的值，否则键盘会停在自定义模式，帧一停就全黑。

如果页面打不开设备、或连上了却没反应，先看页面底部的诊断日志，通常能直接看出是哪一步被固件拒了。

## 支持的机型

| 机型         | VID / PID         | 布局        | 测试状态        |
| ---------- | ----------------- | --------- | ----------- |
| **WAVE75** | `0x36B0 / 0x3009` | 81 键（75%） | ✅ **已实测通过** |
| PMO P75    | `0x36B0 / 0x302B` | 75%       | ⚪ 未测试       |
| PMO 80     | `0x36B0 / 0x3012` | K87       | ⚪ 未测试       |
| Aurora 80  | `0x36B0 / 0x3004` | K87       | ⚪ 未测试       |
| RDR 2.4G   | `0x36B0 / 0x3002` | K87       | ⚪ 未测试       |
| ZEN 65     | `0x36B0 / 0x3025` | 65%       | ⚪ 未测试       |
| Rainy 75   | `0x320F / 0x5010` | K75       | ⚪ 未测试       |
| Crush 80   | `0x320F / 0x5055` | 80%       | ⚪ 未测试       |
| GL68       | `0x1CA6 / 0x3D09` | 68 配列     | ⚪ 未测试       |
| GP68       | `0x1CA5 / 0x2B01` | 68 配列     | ⚪ 未测试       |

连接时除上述 VID 外，还会兜底枚举 `usagePage 0xFF00 / 0xFF60` 的自定义设备，所以不在表里的键盘也可能被列出来——但**能用 ≠ 灯位对**，布局选择仍以你手上这把为准。

## 技术说明

**协议格式**（RDR 系私有协议，65 字节定长包）

```
reportId(0) | 0xAA | cmd | offset(2, LE) | len | 00 00 | status | data[56]
```

- `status`：`0x55` 成功，`0x0F` 固件拒绝（回包第 8 字节）。
- 逐键推帧走 **`0x2E SET_LIGHT_SYNC`**，每颗灯 **RGB565**（2 字节小端），整帧按 56 字节分块。  
  以 WAVE75 的 82 颗灯为例：164 字节拆成 56 + 56 + 52，共 3 包。
- 结束用 `0x2F CLOSE_SYNC`；`0x10 START` / `0x11 STOP_COMM` 管通信开关，`0x14/0x15` 读写灯光模式，`0x12` 取设备信息。
- **`0x2E` 只写 RAM**：帧一停，键盘立刻回落到槽内的静态色。若想落盘，用 **`0x23 SET_USERLIGHT_1`** 写 384 字节 RGB888（128 键 × 1 帧）进 Flash。

**灯号映射的一个坑**：WAVE75 厂商给的 `lightIndex` 整体比真实灯珠小 1，所以布局里写了 `"off": 1` 做补偿——81 个键落在 1..81，`0` 号是那颗没有键的灯，固件因此上报 82 颗。偏移量不能靠推理，必须真机逐个点亮确认（这个项目为此返工过两次）。

## 已知限制

- **板载存不了动画**：自定义槽只有一帧的容量，动画必须靠页面持续推流。
- **一次只能一个页面占用**：另一个标签页连着同一把键盘时，这里会推帧失败。
- **浏览器限制**：只有 Chromium 系桌面浏览器支持 WebHID；每次会话的授权弹窗无法绕过。
- **布局靠实测**：新机型大概率需要重新标灯号（点一颗、看哪颗亮），没有捷径。

## 目录结构

```
index.html                           主程序，全部逻辑与样式的唯一运行文件
test_playground.js                   离线协议链路测试（假 HID）
test_effects.js                      灯效数值回归
preview_png.js / effect_montage.js   布局与动画的 PNG 渲染工具
README.md                            本文件
```

另外几个 `PMOHub_*.html`、`webhid-light-lab.html`、`pmohub_research/` 是前期逆向协议的调研产物，不是运行所需，可以不带。

## 许可与免责

个人逆向与学习项目，**与任何键盘厂商无关，非官方工具**。协议细节来自自有设备的抓包与试错。

代码以 MIT 许可发布；据此操作造成的设备异常、配置丢失，作者不承担责任。刷写类操作（写自定义槽）会覆盖板载原有配置，动手前请知悉。

---

<sub>Built for the fun of watching 81 LEDs do something they were never designed to do.</sub>
