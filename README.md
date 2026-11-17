# @oheco/dsh-open-sessions

仓库：[oheco/dsh-open-sessions](https://github.com/oheco/dsh-open-sessions)。

在 DSH Web 左侧栏的工作区列表上方显示“已打开”会话列表。

- 在主区域打开过的会话（非空白、非子代理、未归档）会自动加入列表，顺序与打开顺序一致，并保存在浏览器 localStorage（`oheco.dsh-open-sessions.v1`）。
- 点击列表项通过 `ctx.uiWorkspace.openSession()` 在右侧主区域显示该会话。
- 插件为最近显示过的至多 10 个会话额外持有一个 `ctx.sessions.retain(id, { source: 'openSessions' })` 引用。主视图切走时，这些会话的 Client 实例和已加载的历史不会被释放，切回来时无需重新加载。超过 10 个时，最久未显示的会话仍留在列表中，但会释放引用。
- 关闭按钮（或在行上中键单击）会把会话移出列表并释放引用。关闭当前会话时，会切换到相邻项。
- 刷新页面后列表会恢复；恢复出来的会话要等第一次点开后才会进入保持加载状态，避免启动时一次加载所有会话。

## 位置说明

DSH 没有提供“工作区上方”的扩展位。插件先在 `sidebar.footer.action` 中注册一个隐藏锚点，再在侧边栏根节点中、工作区区域（`*_regionArea`）之前插入一个容器，并通过 React portal 渲染列表。如果以后 DSH 改动了侧边栏结构、找不到该区域，列表会退回到侧边栏底部显示，并在控制台给出警告。

## 安装

在 DSH 里用 `plugin_manager` 执行 `install_bundle`，目标为本目录的绝对路径。
