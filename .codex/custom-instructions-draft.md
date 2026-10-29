# Custom Instructions Draft

## Pending updates

## Pending update - 2026-10-29

### Reason

终端访问 GitHub 失败被误判为凭证无效；设置当前进程使用已启用的系统代理后认证成功。

### Suggested instruction

浏览器能访问但终端认证或下载失败时，先比较终端与系统代理路径，再判断凭证是否失效；优先临时设置当前进程，不更改全局网络配置，不输出凭证。

### Scope

- 全局适用

### Status

- Pending

## Pending update - 2026-10-29 - Desktop bridge

### Reason

类型检查和模拟函数测试没有发现 Vue 响应式对象无法跨 Electron 桥接的问题，隔离桌面界面场景才复现。

### Suggested instruction

桌面应用跨进程传递界面数据时，先转换为可复制的普通数据；需要验证写操作参数时优先使用隔离服务，避免测试直接修改用户的真实应用配置。

### Scope

- 全局适用

### Status

- Pending

## Pending update - 2026-10-29 - Async state

### Reason

离开页面、换账号或实时事件更新后，旧的网络请求和异步缓存读取仍可能完成，并覆盖新状态。

### Suggested instruction

异步操作依赖账号、页面、阶段或用户选择时，在返回后再次核对上下文；实时事件优先于较早的轮询结果。测试应覆盖响应乱序和切换后的缓存回退。

### Scope

- 全局适用

### Status

- Pending

## Applied updates

项目经验：双窗/实时视图的写操作必须区分“浏览”与“应用”，写前重核当前身份与会话；与现有异步状态草案一致，本次不另加重复全局指令。

暂无；以上仅项目内草案，未修改全局设置。
