// 全局配置：只改这里就能切换后端地址与 mock 策略
const CONFIG = {
  // 后端地址（当前未用：MOCK 全开时所有请求走本地假数据，不发网络请求）
  BASE_URL: 'http://192.168.43.149:8080',

  // ---------- mock 开关（按模块分别控制） ----------
  // true = 走 services/mock.js 本地假数据；false = 打真实后端
  // 2026-09-22 19:48 恢复联调：登录接口实测连通（假 code 返回 invalid code，code2session 在跑）
  // poi / event 后端仍未实现，继续 mock；ask 已退役（chat 走 /api/guide/chat）
  MOCK: {
    auth: false,    // 登录：真实后端（code 换 token）
    trips: false,   // 攻略生成/详情/列表/删除/分享：真实后端
    poi: true,      // POI 列表：mock 数据（后端未出）
    guide: false,   // 语音导游 identify/narrate/chat：真实后端（文档 7.3）
    voice: false,   // 语音 asr/tts：真实后端（文档 7.4）
    user: false,    // 用户资料 /api/user/profile：真实后端（2026-09-23 上线）
    event: true     // 埋点上报：mock 静默（后端未出）
  },

  // 兜底开关：MOCK 里没单独列出的模块用它
  USE_MOCK: true,

  // 流式生成开关：false = 点生成直接走同步（跳过流式尝试）
  // 仅影响真实后端（mock 的流式演出不受此开关影响）；断流会自动回落同步
  STREAM: {
    generate: true
  },

  TIMEOUT: 15000
}

export default CONFIG
