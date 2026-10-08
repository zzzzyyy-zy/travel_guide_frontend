// 全局配置：只改这里就能切换后端地址与 mock 策略

// ---------- 环境开关 ----------
// 'dev' = 开发联调（局域网直连队友机器）——日常开发只用这个
// 'prod' = 生产上线；生产地址在下面被注释保护，要发布时按三步操作（见 ENV_URLS 注释）
// 2026-10-08 18:05 切生产（用户要求「连服务器的域名」）：ENV='prod' + 解开 prod 行。
const ENV = 'prod'

const ENV_URLS = {
  // dev 2026-10-08 11:20 起改回「队友机局域网后端」（用户要求「连后端的开发环境」）：
  // 队友机 192.168.43.149:8080，与开发笔记本同 192.168.43.x 热点网段（本机 192.168.43.165）。
  // ⚠️ 前提：队友必须先启动 Spring Boot（8080）；连不上先跑 `node check_tunnel.cjs` 四验（默认读本行地址）。
  // ⚠️ 局域网地址只在同一 WiFi 下有效：开发者工具需勾「不校验合法域名」（project.private.config.json 里 urlCheck 已 false）；
  //    真机预览/体验版访问不到局域网地址，真机联调请用「真机调试」并在手机连同一热点。
  // 溯源：192.168.43.149:8080(9月) → cpolar 六代隧道 → lworld.site(10-06 直连服务器) → 本行(10-08 回局域网)。
  // 要回到服务器就把本行换回 'https://lworld.site'（注意：服务器库里有生产数据）。
  dev: 'http://192.168.43.149:8080',
  // ✅ 2026-10-08 18:05 起启用（当前 ENV='prod'，连服务器域名 lworld.site，走 HTTPS/WSS）：
  //    服务器库里有生产数据；新用户手机/真机/体验版都能访问（局域网地址做不到）。
  // ⛔ 切回开发时：① 本行重新注释 ② ENV 改 'dev'（dev 行保留，不用删）
  prod: 'https://lworld.site'
  // ⚠️ cpolar 免费版隧道地址每次重启会变：连不上时先找队友要新地址，改这里即可
}

const CONFIG = {
  ENV,
  // 后端地址（按上面的 ENV 自动选择）
  BASE_URL: ENV_URLS[ENV],

  // WebSocket 基址（AI 搭子实时通话 /ws/guide/call）：由 BASE_URL 推导，http→ws、https→wss
  // ⚠️ dev 是明文 ws://，开发者工具需勾「不校验合法域名」；
  //    上线前必须在 mp 后台「开发管理→开发设置→socket 合法域名」里配上 wss 域名，否则真机连不上
  WS_BASE_URL: ENV_URLS[ENV].replace(/^http/, 'ws'),

  // ---------- 订阅消息模板 ID ----------
  // 「旅行行程开始」一次性订阅：用户点「生成攻略」时申请一次额度，
  // 后端定时任务（每天 9 点扫描当天开始的行程）用它发提醒。
  // ⚠️ 必须与后端 application.yml 的 subscribe-template-id 完全一致，否则后端发不出去。
  // 申请路径：mp 后台 → 功能 → 订阅消息 → 公共模板库搜「行程开始提醒」→ 选用并复制模板 ID。
  // 留空 = 跳过授权：不影响生成，只是旅行当天收不到提醒。
  SUBSCRIBE_TEMPLATE_ID: 'Wt-3v2Y_wbtkNLCIOrcl8wg85BxPT6Ml7GVplzQ7_v4',

  // ---------- mock 开关（按模块分别控制） ----------
  // true = 走 services/mock.js 本地假数据；false = 打真实后端
  // 2026-10-01 13:50 恢复联调（走 cpolar 隧道，不再依赖同网段）：除 poi/event（后端未实现）外全部 false。
  // 切回断网演示：把下面各项改回 true（参考 2026-10-01 11:45 那次全量切 mock）。
  MOCK: {
    auth: false,    // 登录：真实后端（code 换 token）
    trips: false,   // 攻略生成/详情/列表/删除/分享：真实后端
    poi: true,      // POI 列表：mock（后端未实现）
    guide: false,   // 语音导游 identify/narrate/chat：真实后端
    voice: false,   // 语音 asr/tts：真实后端
    user: false,    // 用户资料 /api/user/profile：真实后端
    growth: false,  // 增长运营（签到/等级/成就/兑换 7.7）：真实后端
    event: true,    // 埋点上报：mock 静默（后端未实现）
    route: false,   // 自由路线规划 /api/route/optimize：真实后端
    nearby: false,  // 周边设施 /api/nearby/facilities：真实后端
    feedback: false,// 意见反馈 /api/feedback（含 /api/admin/feedbacks）：真实后端
    call: false     // AI 搭子 WS 通话：真实 WebSocket（wss/ws 由 BASE_URL 推导）
  },

  // 兜底开关：MOCK 里没单独列出的模块用它
  USE_MOCK: false,

  // 流式生成开关：false = 点生成直接走同步（跳过流式尝试）
  // 仅影响真实后端（mock 的流式演出不受此开关影响）；断流会自动回落同步
  STREAM: {
    generate: true
  },

  // 普通请求超时（毫秒）。cpolar 免费隧道冷启动 / 并发时首批请求偶发 1~16s，
  // 15s 会被判成 request:fail timeout（页面显示「网络异常」）→ 放宽到 30s；
  // 另见 api.js：GET 类请求遇 NETWORK_ERROR 会自动补一次（隧道抖动兜底）
  TIMEOUT: 30000,

  // 腾讯位置服务 WebServiceAPI Key（lbs.qq.com 免费申请，类型选「WebServiceAPI」）
  // 用途：添加景点时按关键字搜索地点（apis.map.qq.com/ws/place/v1/search）
  // 留空时搜索功能提示未配置；真机需把 apis.map.qq.com 加入 request 合法域名
  LBS_KEY: 'C73BZ-CTQKT-6C6XW-LLXNX-COOZH-LTBH6'
}

export default CONFIG
