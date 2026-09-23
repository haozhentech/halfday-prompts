# 星起半 · HALFDAY BAKERY

食品摄影提示词组合工具。把产品、场景、机位、光线、构图、切面与包装要求组合成完整提示词，复制到即梦等生图工具。支持黄金组合、场景锁定、多产品批量生成与 TXT 导出。

**工具本身不生成图片、不上传访客输入、不需要模型 API Key。** 示例食品资料是品牌概念探索，不是门店配方或实际出图效果保证。

## 离线使用

下载本仓库，双击 `index.html` 即可。包含 64 款产品、36 个场景、16 个机位、12 种光线、12 种构图及切面/包装说明。浏览器内的临时修改不会自动保存，刷新前请复制需要保留的结果。

## 自托管与后台

Node.js 22 或更新版本，不需要安装 npm 依赖。

```sh
# Set ADMIN_TOKEN to a privately generated random value of at least 32 characters.
export ADMIN_TOKEN="$(node -e 'console.log(require("node:crypto").randomBytes(36).toString("base64url"))')"
npm start
```

默认端口 4190；公开页面 `/`，管理页面 `/admin/`。可配置 `PORT`、`HOST`、`DATA_DIR`。公网部署请使用 HTTPS 反向代理，后台口令只在当前页内存中使用，不写入浏览器存储。

管理页支持修改产品、场景、机位、光线、构图、风味、切面、包装、黄金组合说明与通用摄影要求；可发布兼容的新版 `index.html`，并回退完整历史版本。所有发布前自动备份。系统检查 HTML 的脚本语法，不保证上传的新版本在视觉与交互上没有问题，发布后应实际检查。

服务器状态在 `data/state.json`，历史在 `data/history/`。请保留整个数据目录，**不要提交数据目录、口令或 .env 到公开仓库**。服务器重启不会丢失修改。管理页的修改进入在线状态，不会自动提交 GitHub；公开源码的预设更新需同步进源文件并提交。

修改产品/场景编号或数据结构时，应同步更新 `defaults.json`（`npm run defaults`）并测试迁移；管理页上传适用于维持数据结构的界面更新。已有在线状态优先于新镜像自带的 index.html，更新服务器程序不会默默覆盖线上编辑内容。

### Docker

```sh
docker build -t halfday-prompts .
docker volume create halfday-data
# The named volume is initialized using the directory ownership from the image.
docker run -d --name halfday-prompts --restart unless-stopped \
  -p 127.0.0.1:4190:4190 --env-file .env \
  -v halfday-data:/data halfday-prompts
```

`.env` 只需包含自行生成的 `ADMIN_TOKEN=...`。可以通过 Caddy/Nginx 转发到 4190。仅在可信反向代理覆盖 `X-Halfday-Client-IP` 且后端端口不对公网开放时设置 `TRUST_CADDY=1`。

## 开发与检查

```sh
npm test
```

覆盖访问控制、字段校验、脚本注入防护、发布冲突、状态持久化与回退，以及原有提示词引擎的基础兼容性。

## 许可与来源

代码、提示词预设和随附说明使用 [MIT License](LICENSE)，允许修改和商业使用，请保留版权与许可声明。品牌名称不构成对使用者的品牌授权或合作背书。

原始交付包名为“星期半-提示词工具-本地与服务器版”，此发布版按品牌方指定的“星起半”统一命名。原有交互参考见《界面参考与使用说明.txt》；其内容声明仅参考交互思路，没有复制相关项目代码或图像。本仓库没有接入其模型服务。

---

An offline-first bakery photography prompt composer, with an optional dependency-free Node.js admin server. Prompts are composed locally; no image generation or visitor-input uploads occur. MIT licensed.
