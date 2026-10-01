# SceneFold v0.1.0

一个给 Revenge / Vendetta 兼容插件系统使用的本地“小剧场折叠”插件。

## 当前功能

- 长按 Discord 消息 → `🎭 标记已玩并折叠`
- 折叠后只在自己手机上显示一行摘要
- 长按已折叠消息可展开 / 重新折叠
- 可手动编辑一句话摘要
- 可取消“已玩”标记并恢复原文
- 数据只保存在每个人自己的本地 storage
- 不修改服务器原消息，不影响朋友看到的内容
- 对 Discord 转发消息（message snapshots）做了兼容尝试

## 上传到 GitHub

把压缩包解压后，将这 3 个文件直接上传到仓库根目录：

- `index.js`
- `manifest.json`
- `README.md`

仓库：
`https://github.com/wuxingkun6-a11y/Revenge-SceneFold`

## Revenge 安装地址

上传成功以后，在：

`Revenge → Plugins → Install a plugin`

填写：

`https://raw.githubusercontent.com/wuxingkun6-a11y/Revenge-SceneFold/main/`

## 说明

这是第一版测试版。Discord / Revenge 的内部组件经常变化，如果“长按菜单没有出现 SceneFold”或折叠效果不完整，需要根据你当前 Discord 版本继续适配。
