# 智慧文旅小程序 · 前端

一个面向旅行的微信小程序：AI 生成行程攻略、语音导游讲解、行程协作、记账/备忘/行李清单等一站式旅行工具。

技术栈 **Taro 4.2.1 + Vue 3 (`<script setup>`)**，产物为原生微信小程序（`dist/`）。

---

## 功能一览

| 模块 | 页面 | 说明 |
|---|---|---|
| 首页 | `pages/home` | 精选专题、热门城市海报、最近行程；游客可直接浏览 |
| AI 规划 | `pages/index` | 填需求（目的地/天数/偏好）→ 流式生成行程（SSE） |
| 行程详情 | `pages/itinerary` | 行程时间线、天气卡、成员卡、协作、收藏、加入行程 |
| 旅行账单 | `pages/expense` | 总支出/剩余预算、分类环形占比、按日账单明细、记一笔 |
| 行程备忘 | `pages/memo` | 服务端同步的个人/行程备忘，支持完成勾选 |
| 行李清单 | `pages/packing` | AI 一键生成清单、勾选打包、一键清空 |
| 周边设施 | `pages/nearby` | 定位周边餐饮/住宿/加油站等 |
| 路线优化 | `pages/route` | 多点路线距离优化（`/api/route/optimize`） |
| AI 搭子 | `pages/guide`、`pages/chat`、`pages/videocall` | 语音导游讲解、文字多轮聊天、实时语音/视频通话 |
| 历史行程 | `pages/history` | 全部/收藏/协作筛选、搜索、加入协作 |
| 城市足迹 | `pages/footprint` | 已打卡城市地图，按省份点亮 |
| 成就墙 | `pages/badges` | 成长体系的徽章展示 |
| 我的 | `pages/profile` | 资料、成长卡、邀请有礼、意见反馈等 |
| 分享 | `pages/share` | 免登录只读的行程分享页（凭分享 token） |
| 登录 | `pages/login` | 微信一键登录 + 完善头像昵称（可跳过） |

---

## 目录结构

```
travel_guide_frontend/
├── src/
│   ├── app.js / app.config.js / app.css   # 入口、全局页面注册与 tabBar/权限声明
│   ├── pages/                             # 18 个页面（每个含 .vue / .config.js）
│   ├── components/AuthMask.vue            # 统一登录遮罩（游客点功能时弹）
│   ├── custom-tab-bar/                    # 自定义 tabBar（4 tab + 中央凸起「＋」）
│   ├── services/
│   │   ├── api.js                         # 全部后端接口封装（请求/重试/401 恢复）
│   │   ├── mock.js / mockDetail.js         # 本地假数据（离线演示）
│   │   ├── memo.js                         # 备忘缓存 + 服务端同步
│   │   └── callSocket.js                   # AI 搭子 WebSocket 长连
│   ├── utils/
│   │   ├── config.js                       # ★ 环境开关 / 后端地址 / MOCK 开关
│   │   ├── token.js                        # 登录态唯一入口
│   │   ├── auth.js                         # requireLogin / finishLogin 闸门
│   │   ├── collab.js                       # 协作行程判定（≥2 人，成员数去重）
│   │   ├── invite.js / share.js            # 邀请归因、分享统一封装
│   │   ├── subscribe.js                    # 订阅消息（永不 throw）
│   │   └── badges.js / position.js / region.js / stream.js / file.js / tabbar.js / callIntent.js
│   ├── data/                               # 城市坐标、城市图、热门行程、省份轮廓
│   └── assets/                             # 图标（icons/）、图片（images/）、tabbar 图标
├── babel.config.js
└── package.json
```

---

## 快速开始

```bash
npm install

# 构建微信小程序（产物在 dist/）
NODE_OPTIONS= npm run build:weapp

# 开发模式（watch 增量构建）
NODE_OPTIONS= npm run dev:weapp
```

> **必须带 `NODE_OPTIONS=` 前缀**：否则部分环境构建时会卡死或报 `app.json not found`。

构建完成后，用微信开发者工具「导入项目」选择 **仓库根目录**（工具会读取 `project.config.json` 并指向 `dist/`），AppID 为 `wx99cb28a572945fc1`。

---

## 环境配置

所有环境相关配置集中在 **`src/utils/config.js`**，改完后**必须重新构建**（配置在编译期进入产物）。

### 1. 后端地址

```js
const ENV = 'prod'                 // 'dev' 局域网联调 | 'prod' 生产
const ENV_URLS = {
  dev:  'http://192.168.43.149:8080',  // 队友机的 Spring Boot
  prod: 'https://lworld.site'          // 生产服务器（HTTPS/WSS）
}
```

`WS_BASE_URL` 由 `BASE_URL` 自动推导（`http→ws`、`https→wss`）。

### 2. Mock 开关

`CONFIG.MOCK` 按模块分别控制是否走本地假数据（离线演示时可全量打开）：

```js
MOCK: { auth: false, trips: false, poi: true, guide: false, ... }
```

> 后端未实现的模块（POI、埋点）默认走 mock。

### 3. 其他

- `SUBSCRIBE_TEMPLATE_ID`：行程开始提醒的订阅消息模板 ID（须与后端 `application.yml` 一致，留空则跳过授权）。
- `LBS_KEY`：腾讯位置服务 WebServiceAPI Key（添加景点时关键字搜索地点）。
- `TIMEOUT`：请求超时，默认 30s。

---

## 后端接口约定

- **HTTP 状态恒为 200，业务结果在 body 的 `code` 字段** —— 前端只看 `body.code` 判断成败。
- 鉴权靠 `Authorization` 头携带 token；`utils/token.js` 是登录态唯一入口。
- `/api/auth/*` 不参与 401 自动重登；其他接口 401 时由 `api.js` 静默重登并重试一次。
- **游客态**：本地无 token 时不做静默重登（直接抛 `AUTH_REQUIRED`），由页面引导用户主动登录（微信审核要求：先浏览、后授权）。
- GET 请求由 `api.js` 手工拼 query（无参时连 `?` 都不带），避免被序列化成 `?{}` 触发后端 400。
- 主要接口分组：`/api/trip/*`（生成/详情/列表/协作/分享）、`/api/expense/*`、`/api/trip/{id}/notes`、`/api/route/optimize`、`/api/nearby/facilities`、`/api/growth/*`、`/api/feedback`、`WS /ws/guide/call`。

后端 Swagger（含全部接口与字段定义）：`{后端地址}/v3/api-docs`。

---

## 开发约定

1. **改 `app.config.js` 或新增页面后必须完整重建**，并清理开发者工具缓存。
2. **新增图标**：统一放 `src/assets/icons/`，`<image>` 必须显式写宽高，否则会按 320×240 渲染成巨图。
3. **小图会被内联成 base64** 进 JS 包（约 2KB 以下），校验产物时不能只查 assets 目录。
4. **登录闸门**：用 `requireLogin(cb, { tip, skippable })`，不要在页面 `useDidShow` 里做强制跳转式拦截。
5. **日期**用 `new Date(y, m, d)` 构造，避免 iOS 下 `toDateString()` 得到 Invalid Date。
6. **网络**：超时 30s；仅 GET 网络异常自动补发一次；401 统一由 `recoverAuth()` 承接。
7. 本地校验脚本（`check_*.cjs`、`gen-*.cjs`）是构建产物校验/图标生成的一次性工具，已加入 `.gitignore`，不入库。

---

## 常见问题

| 现象 | 排查方向 |
|---|---|
| 构建卡死 / `app.json not found` | 命令前加 `NODE_OPTIONS=` |
| 接口 502 | 后端没启动（dev 环境先让队友起 Spring Boot） |
| 接口 404 | 后端地址不对（检查 `config.js` 的 `ENV`） |
| 无参 GET 报 400 | URL 里出现非法字符（检查是否被拼上 `?{}`） |
| WS 连不上 | 检查 mp 后台 socket 合法域名是否配了 `wss://lworld.site` |
| 游客态自测不弹登录 | 本地有旧 token → 开发者工具「清缓存 → 清除全部缓存」 |

**上线前提**：mp 后台需配置合法域名 —— request / uploadFile / downloadFile 填 `https://lworld.site`，socket 填 `wss://lworld.site`。

---

## License

见 [LICENSE](./LICENSE)
