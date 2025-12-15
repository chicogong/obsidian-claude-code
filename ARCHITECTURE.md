# ClaudeTerm Plugin - 架构设计文档

## 概述

这是一个为 Obsidian 开发的终端插件,提供完整的终端模拟体验,支持交互式命令(如 claude、vim 等)。

## 核心架构

### 三层架构设计

```
┌─────────────────────────────────────────────────┐
│           Obsidian Plugin (main.js)            │
│  - 插件生命周期管理                               │
│  - 视图注册和激活                                 │
│  - 用户交互(Ribbon Icon, Commands)              │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────┴────────────────────────────────┐
│       Terminal View (TerminalView class)       │
│  - xterm.js 终端实例管理                         │
│  - 用户输入处理                                   │
│  - 终端输出渲染                                   │
│  - 进程生命周期管理                               │
└────────────────┬────────────────────────────────┘
                 │
┌────────────────┴────────────────────────────────┐
│       Python PTY Proxy (pty_proxy.py)          │
│  - 创建伪终端 (PTY)                              │
│  - Shell 进程管理                                │
│  - 双向数据桥接 (stdin/stdout)                   │
│  - 终端窗口大小管理                               │
└─────────────────────────────────────────────────┘
```

## 组件详解

### 1. Obsidian Plugin Layer (TerminalPlugin)

**职责**:
- 插件注册和初始化
- 视图类型注册
- 用户界面入口(Ribbon Icon, Command Palette)

**关键方法**:
- `onload()`: 注册视图和命令
- `activateView()`: 创建或显示终端视图
- `onunload()`: 清理资源

**设计要点**:
- 单一终端实例:复用已存在的终端视图
- 右侧栏固定:使用 `getRightLeaf()` 确保位置一致

### 2. Terminal View Layer (TerminalView)

**职责**:
- xterm.js 终端实例生命周期
- 用户输入到 Python 进程的转发
- Python 进程输出到终端显示
- 窗口大小自适应

**核心数据流**:

```
用户输入 → xterm.js.onData()
         → pythonProcess.stdin.write()
         → Python PTY Proxy
         → Shell

Shell 输出 → Python PTY Proxy
          → pythonProcess.stdout
          → xterm.js.write()
          → 终端显示
```

**关键属性**:
- `terminal`: xterm.js Terminal 实例
- `pythonProcess`: Node.js child_process 实例
- `fitAddon`: 自动调整终端大小
- `resizeObserver`: 监听容器尺寸变化

**设计要点**:
- **异步加载 xterm.js**: 通过 CDN 动态加载,避免打包体积
- **FitAddon 集成**: 自动适应容器大小,提供流畅体验
- **进程重启机制**: Shell 退出后按任意键重启
- **错误处理**: stderr 红色显示,清晰提示

### 3. Python PTY Proxy Layer (pty_proxy.py)

**职责**:
- 创建和管理伪终端 (Pseudo Terminal)
- 桥接 Node.js 进程和 Shell 进程
- 处理终端控制命令(窗口大小调整)

**核心技术**:

#### PTY 创建流程
```python
master_fd, slave_fd = os.openpty()  # 创建 PTY 对
set_winsize(master_fd, rows, cols)  # 设置终端大小
attrs = termios.tcgetattr(slave_fd)
attrs[3] &= ~termios.ECHO            # 禁用 PTY 回显
termios.tcsetattr(slave_fd, ...)    # 应用设置

pid = os.fork()                      # 分叉进程
if pid == 0:
    # 子进程: 设置 slave 为 stdin/stdout/stderr
    # 启动 Shell
else:
    # 父进程: 监听 stdin/master_fd
    # 双向数据传输
```

#### 数据流处理
```
stdin (Node.js) → 读取数据 → 写入 master_fd → Shell 接收
Shell 输出 → master_fd → 读取数据 → stdout (Node.js)
```

**设计要点**:
- **os.openpty() vs pty.fork()**:
  - 使用 `os.openpty()` 获得更精细的控制
  - 可以在 fork 前配置 slave 终端属性
- **禁用 ECHO 的时机**:
  - 必须在 fork 之前禁用 slave 的 ECHO
  - 子进程继承这个配置,避免字符重复
- **TERM 环境变量**:
  - 设置 `TERM=xterm-256color` 确保完整终端能力
  - 支持颜色、光标控制、zsh 语法高亮
- **非阻塞 I/O + select()**:
  - 使用 `select.select()` 多路复用
  - 避免阻塞,实现流畅的双向通信
- **特殊命令处理**:
  - `__RESIZE__:` 前缀用于窗口大小调整
  - JSON 格式传递 cols/rows 参数

## 关键技术决策

### 为什么使用 Python PTY 而不是 node-pty?

**问题**: Electron 限制加载原生模块
- `node-pty` 是原生 Node.js 模块
- Obsidian 基于 Electron,有严格的模块加载限制
- 尝试 `@electron/rebuild` 编译失败

**解决方案**: Python 作为 PTY 代理
- Python 是系统自带,macOS/Linux 默认安装
- `pty` 模块是 Python 标准库,无需额外依赖
- 通过 `child_process.spawn()` 启动 Python 脚本
- 绕过 Electron 原生模块限制

**优势**:
- ✅ 跨平台兼容(macOS, Linux)
- ✅ 零编译,零依赖
- ✅ 完整 PTY 功能
- ✅ 易于调试和维护

### 为什么禁用 convertEol?

**问题**: xterm.js 默认会转换换行符
- `convertEol: true` 会将 `\n` 转换为 `\r\n`
- 但 PTY 已经处理了换行符转换
- 重复转换导致显示异常

**解决**: `convertEol: false`
- 让 PTY 完全控制换行符处理
- xterm.js 只负责原样显示

### 为什么要禁用 PTY ECHO?

**问题**: 字符重复显示
- PTY 默认开启 ECHO(本地回显)
- Shell 也会回显字符
- 加上 zsh 的语法高亮,字符显示多次

**解决**: 禁用 PTY 的 ECHO
```python
attrs[3] &= ~termios.ECHO  # 禁用 ECHO
```
- PTY 不再自动回显
- 只保留 Shell 的输出
- zsh 语法高亮正常工作

### 为什么使用亮色主题?

**设计理念**: 与 Obsidian 界面统一
- 大多数用户使用亮色主题笔记
- 终端使用亮色更协调
- VS Code 风格配色,专业且清晰

**色彩选择**:
- 前景色: `#1a1a1a` (深黑,高对比度)
- 背景色: `#ffffff` (纯白)
- ANSI 颜色: 参考 VS Code Light+ 主题
- 光标: `#007acc` (蓝色,醒目但不刺眼)

## 数据流图

### 用户输入流程
```
用户按键
  ↓
xterm.js 捕获
  ↓
terminal.onData() 事件
  ↓
pythonProcess.stdin.write(data)
  ↓
Python 脚本 stdin
  ↓
os.write(master_fd, data)
  ↓
Shell 进程接收
  ↓
Shell 处理命令
  ↓
Shell 输出结果
  ↓
master_fd 可读
  ↓
os.read(master_fd, 4096)
  ↓
sys.stdout.write(data)
  ↓
pythonProcess.stdout 事件
  ↓
terminal.write(data)
  ↓
xterm.js 渲染显示
```

### 窗口大小调整流程
```
容器大小变化
  ↓
ResizeObserver 触发
  ↓
fitAddon.fit()
  ↓
获取新的 cols, rows
  ↓
sendResize(cols, rows)
  ↓
写入特殊命令: "__RESIZE__:{...}\n"
  ↓
Python 脚本识别
  ↓
JSON.parse() 解析
  ↓
set_winsize(master_fd, rows, cols)
  ↓
fcntl.ioctl(TIOCSWINSZ)
  ↓
Shell 接收 SIGWINCH 信号
  ↓
Shell 更新显示布局
```

## 错误处理策略

### Python 进程启动失败
- **检测**: `pythonProcess.on('error')`
- **显示**: 红色错误消息 + 安装提示
- **恢复**: 无自动恢复,用户需修复环境

### Shell 进程异常退出
- **检测**: `pythonProcess.on('exit')`
- **显示**: 黄色提示消息
- **恢复**: 按任意键重启 Python 进程

### 窗口大小调整失败
- **检测**: `sendResize()` 捕获异常
- **记录**: console.error 日志
- **影响**: 不影响正常使用,仅布局可能错位

## 性能优化

### 1. 懒加载 xterm.js
```javascript
if (window.Terminal) {
  resolve();  // 已加载,直接返回
  return;
}
// 否则动态加载
```

### 2. 非阻塞 I/O
```python
fcntl.fcntl(fd, fcntl.F_SETFL, flags | os.O_NONBLOCK)
select.select([stdin, master_fd], [], [], 0.1)
```

### 3. 缓冲读取
```python
data = sys.stdin.buffer.read(4096)  # 批量读取
data = os.read(master_fd, 4096)      # 批量读取
```

### 4. 单例终端视图
```javascript
if (leaves.length > 0) {
  leaf = leaves[0];  // 复用已存在的终端
}
```

## 未来改进方向

### 功能增强
- [ ] 多终端标签页支持
- [ ] 自定义主题配置
- [ ] 终端历史持久化
- [ ] 快捷键绑定系统
- [ ] 与当前笔记联动(自动 cd 到笔记目录)

### 技术改进
- [ ] Windows 支持(目前仅 macOS/Linux)
- [ ] 错误恢复机制增强
- [ ] 性能监控和优化
- [ ] 更完善的测试覆盖

## 总结

这个终端插件采用了创新的 **Python PTY 代理** 架构,成功绕过了 Electron 原生模块限制,实现了完整的终端功能。通过精心的错误处理、性能优化和用户体验设计,提供了接近原生终端的使用体验。

**核心优势**:
- 零依赖,零编译
- 完整 PTY 支持
- 与 Obsidian 无缝集成
- 支持所有交互式命令

**技术亮点**:
- Python 作为 PTY 桥接
- 精确的 ECHO 控制
- 流畅的数据流设计
- 优雅的错误处理
