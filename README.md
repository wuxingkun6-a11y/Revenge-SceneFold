# SceneFold v0.1.3

## 修复：折叠后无法展开

v0.1.2 已经能把 Discord Android 347.12 的转发消息折叠成一行，
但“展开”时重新注入缓存的转发消息并不可靠。

v0.1.3 改成：

- 点击“展开”后，先把本地折叠替身删除
- 把该记录切换为“未折叠”
- 直接让 Discord 从服务器重新拉取原消息
- 如果拉取失败，再使用本地缓存的原消息作为兜底
- 兼容 v0.1 / v0.1.1 旧记录格式

这样展开时恢复的是服务器上的真实转发消息，而不是插件自己拼出来的副本。

## 更新方式

解压后覆盖仓库根目录的：

- `index.js`
- `manifest.json`
- `README.md`

然后在 Revenge 中关闭 SceneFold 再打开。

安装地址：

`https://raw.githubusercontent.com/wuxingkun6-a11y/Revenge-SceneFold/main/`
