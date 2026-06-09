# stock-console

一个本地控制台股票行情查询工具。可以直接查询股票代码，也可以把常看的股票保存为自选股后用 `stock` 一键查看。

查询结果默认会在 3 秒后自动清屏，适合在公共环境里临时查看行情。

## 环境要求

- 操作系统：macOS、Linux 或 Windows 终端环境。
- Node.js：18 或更高版本。
- npm：随 Node.js 一起安装即可。
- 网络：需要能访问腾讯行情接口 `https://qt.gtimg.cn`，否则会出现 `fetch failed` 或行情接口错误。

检查本机环境：

```bash
node -v
npm -v
```

如果 `node -v` 低于 18，请先升级 Node.js。macOS 用户可以用官网安装包、Homebrew 或 nvm 安装；Windows 用户建议使用 Node.js 官网安装包。

## 第一次安装

进入项目目录：

```bash
cd ~/Projects/stock-console
```

把 `stock` 安装成本机命令：

```bash
npm link
```

安装完成后，在任意目录都可以运行：

```bash
stock --help
```

如果能看到用法说明，说明安装成功。

## 快速使用

查询指定股票：

```bash
stock 600519 AAPL 00700.HK
```

不带股票代码时，会查询本地自选股：

```bash
stock
```

如果还没有添加自选股，直接运行 `stock` 会进入交互模式，可以输入股票代码查询，输入 `q` 退出。

## 自选股

添加自选股：

```bash
stock add 600519 000001 AAPL
```

也可以按中文名称搜索后添加：

```bash
stock search 三花智控
stock add 三花智控 贵州茅台
```

查看自选股：

```bash
stock list
```

删除自选股：

```bash
stock remove AAPL
```

清空自选股：

```bash
stock clear
```

自选股保存在项目目录里的 `watchlist.json`。一般不需要手动编辑这个文件，优先使用上面的命令管理。

当前已添加：

- 三花智控：`002050`
- 云天化：`600096`

## 阅后即焚

行情查询结果默认 3 秒后自动清屏。

```bash
stock                 # 查询自选股，3 秒后清屏
stock --seconds 5     # 查询自选股，5 秒后清屏
stock --keep          # 查询自选股，不自动清屏
```

查询指定股票时也支持同样参数：

```bash
stock --seconds 10 002050 600096
stock --keep 600519 AAPL
```

`--seconds` 支持 `0.5` 到 `60` 之间的数字。

## 代码格式

- A股：`600519`、`000001`、`sh600519`、`sz000001`
- ETF：`513770`、`sh513770`、`159915`、`sz159915`
- 北交所：`830799`、`bj830799`
- 港股：`00700.HK`、`hk00700`
- 美股：`AAPL`、`TSLA`、`usAAPL`

说明：

- 常见 A 股 6 位代码可以直接输入，程序会自动判断沪深北市场。
- `stock add` 支持中文名称，但不会自动添加。程序会先展示搜索结果，输入序号或直接回车确认后才会保存。
- 可以先用 `stock search 中文名称` 查看候选代码。
- 上海 ETF 常见前缀 `50`、`51`、`52`、`56`、`58` 会自动识别为 `sh`。
- 港股可以写成 `00700.HK` 或 `hk00700`。
- 美股可以直接写 `AAPL`，也可以写 `usAAPL`。

## 项目内运行方式

如果不想安装全局 `stock` 命令，也可以在项目目录内运行：

```bash
cd ~/Projects/stock-console
npm run stock -- 600519 AAPL
```

查询自选股：

```bash
npm run stock
```

## 常见问题

### `stock: command not found`

说明全局命令还没有安装，或当前终端没有加载 npm 的全局命令路径。

先重新执行：

```bash
cd ~/Projects/stock-console
npm link
```

然后重新打开一个终端，再运行：

```bash
stock --help
```

如果仍然不可用，可以先使用项目内运行方式：

```bash
cd ~/Projects/stock-console
npm run stock -- 600519
```

### `查询失败: fetch failed`

通常是网络无法访问行情接口。确认当前网络可用，并且没有被代理、防火墙或公司网络策略拦截。

### 添加的股票没有出现在查询结果里

先查看保存状态：

```bash
stock list
```

如果列表里没有，重新添加：

```bash
stock add 代码
```

如果列表里有但查询不到，可能是代码格式不被行情接口支持。可以尝试加上市场前缀，例如 `sh600519`、`sz000001`、`hk00700`、`usAAPL`。

### 如何卸载全局命令

在项目目录执行：

```bash
cd ~/Projects/stock-console
npm unlink
```
