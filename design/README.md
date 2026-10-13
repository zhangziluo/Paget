# 设计参考（不进构建）

这个文件夹只放**给人看**的东西：效果图、手绘稿、量比例的参照。
它们不被前端打包（`vite` 只认 `public/` 与 `src/` 里被 import 的资源），
也不被 Tauri 打进安装包（`tauri.conf.json` 的 `bundle.resources` 只收 `binaries/werd-core`）。

| 文件 | 是什么 |
| --- | --- |
| `IMG_20261007_142023.png` | 摆件架新效果图：左边一台立式留声机、右边一台台式收音机。留声机与收音机就是照着它重画的（见 `src/App.css` 里那两节的注释、`memory-bank/progress.md` 的决策演变史） |
