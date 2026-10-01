# SceneFold v0.1.1

这是针对 Discord Android 347.12 / Revenge Classic 的第二个测试版。

## v0.1.1 修复

v0.1 菜单可以正常出现，但某些 Discord 版本不会接受“只包含少数字段”的本地 MESSAGE_UPDATE，
所以会出现“提示已经折叠，但画面没变化”。

这一版改成：

- 用完整 Message 对象触发本地刷新
- 在消息渲染阶段直接做本地视觉替换
- 尝试兼容 `message_snapshots` 和 `messageSnapshots`
- 折叠状态下隐藏转发快照、附件、embed、components，只显示一行摘要
- 展开 / 取消标记时恢复原文
- 仍然只改自己的本地显示，不修改 Discord 服务器消息

## 上传

把解压后的：

- `index.js`
- `manifest.json`
- `README.md`

覆盖上传到 GitHub 仓库根目录，然后在 Revenge 中重新加载/重新安装插件。

安装 URL：

`https://raw.githubusercontent.com/wuxingkun6-a11y/Revenge-SceneFold/main/`
