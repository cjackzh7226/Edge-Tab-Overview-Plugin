# 页览 · Edge 自用标签页扩展

当前版本为 1.2.2，安装目录是本仓库下的 `edge-tab-overview/`。本次仅将菜单改为横向三列：普通浮层加宽到 1051 像素，兼容菜单在最大 800 像素宽度内显示三列。保留其他样式和交互。

请阅读 [中文安装与使用说明](edge-tab-overview/使用说明.md)。

## 交付

- `edge-tab-overview/`：可以直接在 Edge 加载的扩展，也是完整源码。
- `页览-Edge扩展-v1.2.2.zip`：最新版本，便于备份和转移。使用前先解压。此前版本的压缩包为旧版。
- `tests/results/integration.json`：真实 Edge 自动化验证结果。
- `tests/results/popup-light.png`、`popup-dark.png`：真正叠在网页上的浮层截图，周围能看到实际网页及圆角外的背景。
- `tests/results/popup-fallback.png`：特殊页面使用的原生兼容菜单。
- `tests/results/transparency/feasibility.json`：原生透明限制的独立实验。透明 CSS 的原生弹窗在更换底下网页颜色后画面完全相同；普通网页允许真实浮层，Edge 内部页拒绝注入。

## 验证方式

仓库内保留的验证结果来自 2026-09-14：使用独立测试配置启动 Microsoft Edge 153.0.4234.32，无头模式下加载真实扩展，操作网页浮层和原生兼容菜单。结果记录在 `tests/results/integration.json`，覆盖三列布局、1051 像素浮层及原有卡片尺寸、兼容菜单宽度上限、16:9 预览、内部滚动、切换与恢复、搜索和滚动位置、关闭与新建、窗口隔离、滚动更新、内存清理、重启清空，以及深浅模式的真实透明像素比较、圆角外背景、截图排除浮层和访问令牌检查。

测试通过 `Extensions.triggerAction` 触发真实扩展入口，并监听 `Target.targetCreated` / `Target.targetInfoChanged`，确认首次打开及连续切换不创建 `popup.html` 原生中转弹窗；只有兼容页面才临时打开原生菜单。

普通网页使用真正透出页面的浮层，保持最大 600 像素高度；不保证同时完整显示四排。Edge 内部页、其他扩展页面和不允许注入的页面回退到普通菜单，无法真正透出网页，外框仍受浏览器控制。

没有安装到用户的个人 Edge 配置中。个人配置下的观感、操作系统缩放和弹窗短暂重绘仍应在首次加载后体验确认。

运行测试：`node tests/edge-integration.cjs`。该脚本需要 Playwright 和本机 Edge，可通过 `PLAYWRIGHT_MODULE`、`EDGE_PATH` 指定路径。测试页面由脚本临时在 127.0.0.1 提供，结束后关闭服务。
