# SceneFold v0.1.2

## 为什么又改了一版

截图确认你测试的是 Discord 的“已转发”消息。

Discord Android 347.12 显示转发内容时，真正渲染的是 forwarded message snapshot，
不是普通的顶层 `content`。所以 v0.1 / v0.1.1 虽然能弹出“已折叠”的提示，
但可见的转发正文没有变。

## v0.1.2 的新方案

这一版不再单纯编辑顶层正文，而是：

1. 本地保存原消息
2. 从 Discord 本地消息列表删除这一条
3. 用同一个消息 ID 注入一个仅包含 `🎭 已玩｜摘要` 的本地替身
4. 拦截 Discord 后续加载，把已折叠消息在进入 MessageStore 前替换掉
5. 展开时删除替身并恢复原始转发消息

整个过程仍然只发生在你自己的客户端，不修改服务器消息，也不会影响朋友。

## 上传

解压后覆盖仓库根目录的：

- `index.js`
- `manifest.json`
- `README.md`

然后关闭再打开 SceneFold 插件，最好回到频道后重新进一次再测试。

安装地址：

`https://raw.githubusercontent.com/wuxingkun6-a11y/Revenge-SceneFold/main/`
