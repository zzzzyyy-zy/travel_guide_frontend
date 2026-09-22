// 全局配置：只改这里就能切换后端地址与 mock 策略
const CONFIG = {
  // 后端地址（当前未用：MOCK 全开时所有请求走本地假数据，不发网络请求）
  BASE_URL: 'http://192.168.43.149:8080',

  // ---------- mock 开关（按模块分别控制） ----------
  // true = 走 services/mock.js 本地假数据；false = 打真实后端
  // 2026-09-21 23:37 暂停联调（后端 192.168.43.149:8080 失联），全量切回 mock；
  // 恢复联调时改这里：auth/trips/guide/voice 置 false，STREAM.generate 置 true
  MOCK: {
    auth: true,     // 登录：mock 秒登录（任意环境可用）
    trips: true,    // 攻略生成/详情/列表/删除/分享：mock 数据
    poi: true,      // POI 列表：mock 数据
    guide: true,    // 语音导游 identify/narrate/chat：mock 数据
    voice: true,    // 语音 asr/tts：mock 数据（tts 返回空音频，页面降级纯文字）
    event: true     // 埋点上报：mock 静默
  },

  // 兜底开关：MOCK 里没单独列出的模块用它
  USE_MOCK: true,

  // 流式生成开关：false = 点生成直接走同步（跳过流式尝试）
  // 仅影响真实后端（mock 的流式演出不受此开关影响）；恢复联调时置 true
  STREAM: {
    generate: false
  },

  TIMEOUT: 15000
}

export default CONFIG
