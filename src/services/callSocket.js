// AI 搭子实时通话通道：WS /ws/guide/call（后端协议 2026-10-04 版）
// 【前端 → 后端】JSON 文本帧：
//   start    { tripId(必传), sessionId?, lat?, lng? }  绑定攻略；lat/lng = 当前位置（供附近推荐）
//   audio    { data: base64 PCM }                      实时音频帧（16kHz 单声道）
//   frame    { data: base64 JPEG }                     视频帧（videocall 页截帧上行，间隔见该页 CAM_INTERVAL_MS）
//   location { lat, lng }                              实时位置（每 5 秒，供附近推荐/讲解）
//   narrate  {}                                        「听听讲解」：videocall 信息带的按钮触发，讲解词照旧从下行 tts 回来
//   stop     {}                                        结束通话
//   ⚠️ 上行已经没有 text 了（2026-10-04）：打字聊天整体迁到 REST POST /api/guide/chat-text（纯文字返回、不 TTS）。
//      通话通道上行只负责「语音 / 视频 / 位置」三件事，页面里不该再出现 WS 文本提问。
//      🔴 别和**下行** text 搞混（最容易错的一处）：上行 text = 用户打字，已删除；
//         下行 text = 搭子的回答文字，2026-10-04 才**新增**。方向相反，别一起删。
// 【后端 → 前端】
//   ready | asr_partial | asr_final | vision | text | tts | error
//   vision（2026-10-03 起，替代旧 attraction）：{ type:'vision', attraction:'西湖或空', description:'一句话描述' }
//      前端静默存最近一次结果，只在用户发问（如「这是什么」）时才展示 —— 不随截帧弹消息（噪声策略）。
//   text: { text:'回答正文' } —— 搭子的回答文字，2026-10-04 起从 tts 里**拆出来独立下发**（先于音频到）。
//      「回答上屏」只认这条；tts 不再承担回答字幕，否则同一个回答会显示两遍。
//   tts:  { data: base64 mp3, text? } —— 只管**播音频**（data 空 = 只有字幕没声音）。
//      text 只在**主动提醒**（如行程到点提醒）时才带，页面补一次上屏；普通回答不带 text。
//   ⚠️ 单条 audio 消息体积 = 帧字节 ×4/3 + 信封 ≈ 30B。Java(Tomcat) 服务端对**文本消息**有缓冲上限
//      （默认 8KB），超了会以 1009 直接关连接。帧大小由页面侧的帧参数控制，两端要一起看。
// MOCK.call = true 时走本地演示脚本（后端连不上也能看完整通话效果），事件形状与真链路完全一致。
import Taro from '@tarojs/taro'
import CONFIG from '../utils/config'
import { getToken } from '../utils/token'
import { getPosition } from '../utils/position'   // 位置周期上报用（统一入口，自带 5 秒防连点缓存）

let task = null        // SocketTask（真链路）
let opened = false
let everOpened = false // 本通是否**曾经** open 过（onClose 里不能用 opened：hangUp 会先把它置 false，
                       // 于是自己挂断时永远打 wasOpen=false，看着像「压根没连上」，极具误导性）
let handlers = null    // { onEvent, onStatus }
let closed = false     // hangUp 已调用：迟到的连接要立刻关掉，避免泄漏
let demoTimers = []
let demoNarrate = null // 演示模式下的「听听讲解」应答器（由 sendNarrate 调用）
// start 的 sessionId（可选字段）：后端在 ready 里给，按 tripId 记住 —— 同一次行程内重拨时带上，
// 搭子就能接着上一段会话（不记住也不会错，历史本来就按 guide:call:{userId}:{tripId} 存）
const sidByTrip = {}

// 【握手窗口的音频暂存】tap 进通话 → onOpen 之间有几百毫秒（真机实测 200~800ms），
// 而录音是进入通话就起的（guide.vue beginCall）。这段窗口里的帧若直接丢，
// 表现就是「用户开口第一句搭子没反应」——恰恰是最容易被当成「搭子不说话」的那种症状。
// 处理：未 open 期间暂存，onOpen 发出 start 之后按序补发（start 必须先于 audio，顺序不能反）。
// cap ≈ 3 秒音频（4KB/帧 ≈ 128ms，8 帧/秒），超限丢新帧避免内存与积压雪崩。
let pendingAudio = []
const PENDING_AUDIO_MAX = 24
let pendingLogged = false

export function isDemoCall() { return !!CONFIG.MOCK.call }

// 供上层做诊断日志（判断「帧没上来」是录音问题还是 WS 没开）
export function isSocketOpen() { return opened }

function emit(evt) { if (handlers && handlers.onEvent) handlers.onEvent(evt) }
function status(s) { if (handlers && handlers.onStatus) handlers.onStatus(s) }

function sendJson(obj) {
  if (!task) return
  try {
    task.send({ data: JSON.stringify(obj) })
  } catch (e) {
    // 连接已断：静默忽略。通话中每秒都有音频帧，抛错会刷屏且打断界面
  }
}

// ⚠️ 踩坑（2026-10-01 真机联调）：Taro 把 connectSocket 归进了 needPromiseApis，
// Taro.connectSocket() 返回的是 **Promise**（只有 uploadFile/downloadFile 会被挂上 task 方法），
// 于是 `task.onOpen(...)` 直接抛 "g.onOpen is not a function" —— 连接静默失败，
// 没有 start / 没有音频上行 / 没有 TTS 下行，表现为「搭子一句都不说」。
// 小程序端优先用原生 wx.connectSocket：同步返回 SocketTask，onOpen 一定能挂上、不会错过；
// 其他端（H5 等）退回 Taro，并用 Promise.resolve 同时兼容「直接返回 task」与「返回 Promise」两种形态。
function openSocket(url) {
  try {
    if (typeof wx !== 'undefined' && wx && typeof wx.connectSocket === 'function') {
      return wx.connectSocket({ url })
    }
  } catch (e) { /* 非小程序环境：wx 不存在，走下面的 Taro 分支 */ }
  return Promise.resolve(Taro.connectSocket({ url }))
}

// 建立连接并发 start。opts = { tripId, lat, lng, onEvent, onStatus }
export function connectCall(opts) {
  handlers = { onEvent: opts.onEvent, onStatus: opts.onStatus }
  closed = false
  everOpened = false
  pendingAudio = []        // 每次通话独立：上次挂断残留的帧绝不能补发到这一通
  pendingLogged = false
  if (isDemoCall()) return startDemo(opts)

  // 鉴权二选一（文档）：这里用 query 参数，省掉自定义 header 在部分机型上的兼容问题
  const token = getToken() || ''
  const url = CONFIG.WS_BASE_URL + '/ws/guide/call?token=' + encodeURIComponent(token)
  // ⚠️ 微信开发者工具控制台会**截断长行**（约 90 字符），整串 URL 打出来必然被腰斩，
  // 后面拼的诊断信息全都看不见。所以这里只打「目标 host + token 长度」——
  // 长度是判断 token 是否完整的硬指标（正常 JWT 100+ 字符；若只有 20 出头说明登录态坏了）。
  console.log('[call] WS 目标', CONFIG.WS_BASE_URL + '/ws/guide/call', '｜token', token.length, '字符')
  if (!token) console.warn('[call] 未取到 token：WS 必被拒，先查登录态（utils/token.js）')
  status('connecting')

  // 事件绑定：拿到真正的 SocketTask 之后才能挂 onOpen/onMessage/onError/onClose
  const bind = raw => {
    if (!raw || typeof raw.onOpen !== 'function') {
      status('error')
      emit({ type: 'error', message: '通话通道创建失败（连接对象异常），请重进页面再试' })
      return null
    }
    if (closed) {   // 还没连上用户就挂断了：立刻关掉，避免残留连接
      try { raw.close({}) } catch (e) { /* 已关闭 */ }
      return raw
    }
    task = raw

    raw.onOpen(() => {
      opened = true
      everOpened = true
      status('open')
      const start = { type: 'start', tripId: opts.tripId }
      // sessionId 可选：优先用调用方显式传入的，其次用本行程上次 ready 拿到的（重拨接着聊）
      const sid = opts.sessionId || sidByTrip[String(opts.tripId)]
      if (sid) start.sessionId = sid
      // lat/lng 可选：后端据此做「附近推荐」工具；没有就省略，不传 null 占位
      if (typeof opts.lat === 'number' && typeof opts.lng === 'number') {
        start.lat = opts.lat
        start.lng = opts.lng
      }
      console.log('[call] WS 已连接，发送 start：', start)
      sendJson(start)
      // 顺序不能反：start 先发（搭子据此 buildMemory），再补发握手期间暂存的音频帧
      if (pendingAudio.length) {
        console.log('[call] 补发握手期间暂存的音频帧', pendingAudio.length, '帧')
        pendingAudio.forEach(d => sendJson({ type: 'audio', data: d }))
        pendingAudio = []
      }
      // 位置周期上报：start 只带「通话开始那一刻」的坐标，用户走动后就偏了 → 5 秒补发一条。
      // 关掉的办法：connectCall({ trackLocation: false })，或 storage 置 LOC_OFF=1（真机 A/B、省电）
      if (opts.trackLocation !== false && !Taro.getStorageSync('LOC_OFF')) startLocLoop()
    })

    raw.onMessage(res => {
      let msg = res && res.data
      if (typeof msg === 'string') {
        try {
          msg = JSON.parse(msg)
        } catch (e) {
          return   // 心跳等非 JSON 帧：忽略
        }
      }
      if (msg && msg.type) {
        // 【下行日志】自证「搭子听得到 / 答得出」的硬证据（短行 + 关键信息前置，长行会被控制台截断）：
        //   asr_partial / asr_final → 我们的音频确实到了后端、并被识别成文字（听到 = 通）
        //   text                    → 搭子的**回答文字**（2026-10-04 起独立下发，先于 tts 音频到达）
        //   tts                     → 搭子开口（data 是 base64 mp3，只打长度，别把音频刷进控制台）
        //   error                   → 后端明确报错，message 必须完整打出来
        const brief = msg.type === 'tts'
          ? (msg.data ? 'audio ' + msg.data.length + ' 字符' : '（无音频，仅字幕）')
          : (msg.text || msg.name || msg.message || msg.description || msg.attraction || '')
        console.log('[call] ←', msg.type, String(brief).slice(0, 40))
        // 后端主动报的错（里面常是 Java 异常原文，如 "Connection reset by peer"）：
        // 明确标注来源，免得被当成小程序侧连接问题去查 —— 两者排查方向完全不同。
        if (msg.type === 'error') console.warn('[call] 该 error 来自后端（Java 侧），不是小程序连接问题')
        // ready 里若带 sessionId：按 tripId 记住，重拨时放进 start（见 onOpen）
        if (msg.type === 'ready' && msg.sessionId) sidByTrip[String(opts.tripId)] = msg.sessionId
        emit(msg)
      }
    })

    raw.onError(e => {
      status('error')
      // 短行 + 关键信息前置（长行会被控制台截断，errMsg 是最重要的判据，必须第一个打出来）：
      //   含「not in domain list / 不在以下 socket 合法域名列表」⇒ 域名配置问题，与后端无关
      //   其他（多为 "fail"）且 onClose 不带 code ⇒ 握手被后端拒（拦截器返回 false）
      const detail = (e && (e.errMsg || e.message)) || String(e)
      console.warn('[call] WS 失败 errMsg =', detail)
      // 「url not in domain list」= 微信在客户端就掐了连接，请求根本没出小程序：
      // 把 wss 域名填进 mp 后台「socket 合法域名」，或开发者工具勾「不校验合法域名」（真机需开调试模式）。
      // 这是真机/演示最高频的坑，单独给一句能直接照做的提示，别让看的人去猜。
      if (/not in domain list|domain list/i.test(detail)) {
        emit({ type: 'error', message: '通话域名未加白名单：请把 wss 域名配到 mp 后台「socket 合法域名」，或开发者工具勾选「不校验合法域名」' })
        return
      }
      emit({ type: 'error', message: '连接失败：请检查网络（非 wss 需在开发者工具勾「不校验合法域名」）' })
    })

    raw.onClose(e => {
      const code = (e && e.code) || '-'
      const reason = (e && e.reason) || '-'
      const wasOpen = everOpened   // 不用 opened：自己挂断时它已被 hangUp 置 false（见 everOpened 注释）
      // 短行 + 关键信息前置：reason 可能很长（后端会塞一整句英文），放末尾免得把 code 挤出可视区
      console.log('[call] WS 关闭 code=', code, '｜wasOpen=', wasOpen, '｜reason=', reason)
      // 关闭码速查（给不熟悉 WebSocket 的人一个能直接照做的结论，别对着数字猜）：
      //   1000 正常关闭（我们主动挂断）      1001 对端离开
      //   1002 协议错误                      1003 数据类型不支持
      //   1006 异常断开（没有关闭帧）：多为网络/代理掐断，例如网关未透传 Upgrade 头
      //   1008 服务端按策略拒绝：多为鉴权或业务校验不通过
      //   1009 消息过大 ★ 见下              1011 服务端内部错误
      if (code === 1009) {
        // 服务端原文：「The decoded text message was too big for the output buffer and the
        // endpoint does not support partial messages」= 我们发的这一条**文本消息**超过了
        // 服务端配置的文本消息缓冲上限（Java/Tomcat WebSocket 的说法）。
        // 本通话音量：每帧 4480 字节 PCM → base64 约 5976 字符 + JSON 信封 ≈ 6KB/条。
        //   根治 → 后端调大 WS 文本消息缓冲（Tomcat 默认 8KB，被拒说明配得比 6KB 更小）；
        //   兜底 → 调小 guide.vue 里的 FRAME_KB（帧越小，单条消息越小）。
        console.warn('[call] 1009 = 服务端拒收过大的文本消息（音频帧 base64 超了它的缓冲上限）')
      } else if (code === 1006) {
        console.warn('[call] 1006 = 异常断开（没有正常关闭帧）：多为网络/代理掐断，例如网关没透传 Upgrade 头')
      } else if (code === 1008) {
        console.warn('[call] 1008 = 服务端按策略拒绝（多为鉴权或业务校验不通过）')
      }
      opened = false
      stopLocLoop()       // 连接断了就别再定位了（否则通话结束后还在后台每 5 秒拉一次定位）
      pendingAudio = []   // 连接已断：暂存帧补发无望，清掉（否则会攒到上限 24 帧白占内存）
      status('closed')
      handlers = null
    })

    return raw
  }

  const pending = openSocket(url)
  // Taro 分支拿到的是 Promise，必须等它 resolve 出 SocketTask 再绑事件（见 openSocket 注释）
  if (pending && typeof pending.then === 'function') {
    pending.then(bind).catch(() => {
      status('error')
      emit({ type: 'error', message: '连接失败：请检查网络（非 wss 需在开发者工具勾「不校验合法域名」）' })
    })
    return pending
  }
  return bind(pending)
}

export function sendAudio(base64) {
  if (!task || closed) return                 // 还没有连接对象 / 已挂断：丢掉（补发也没意义）
  if (!opened) {                              // 握手未完成：暂存，onOpen 后按序补发（见 pendingAudio 注释）
    if (pendingAudio.length < PENDING_AUDIO_MAX) pendingAudio.push(base64)
    if (!pendingLogged) {
      pendingLogged = true
      console.log('[call] WS 尚未 open，音频帧先暂存，open 后补发（窗口', PENDING_AUDIO_MAX, '帧 ≈ 3 秒）')
    }
    return
  }
  sendJson({ type: 'audio', data: base64 })
}

// 视频帧：{ type:'frame', data: base64 JPEG }。截帧节奏由 videocall 页控制（CAM_INTERVAL_MS，现 10 秒）。
export function sendFrame(base64) {
  if (opened) sendJson({ type: 'frame', data: base64 })
}

// 「听听讲解」：{ type:'narrate' } —— 无字段，后端用**自己刚下发的那次 vision 识别结果**当讲解对象
// （所以前端不必回传景点名，识别结果与讲解对象天然一致，不会出现「说 A 讲 B」）。
// 空对象体是刻意的：后端按 type 分派，不需要任何参数。
// 返回 false = 连接没 open / 已断开 → 调用方提示「没发出去」，别让用户干等一段不会来的讲解。
export function sendNarrate() {
  if (isDemoCall()) {          // 演示模式：本地造一段讲解词（无音频，与真链路「有音频才出声」的降级路径一致）
    if (demoNarrate) demoNarrate()
    return true
  }
  if (!opened) return false
  sendJson({ type: 'narrate' })
  return true
}

// 位置上报：{ type:'location', lat, lng }。坐标是 GCJ-02（与 start 消息一致）。
// 一般不直接调它 —— 用下面的 startLocLoop() 让通道自己按 5 秒周期上报。
export function sendLocation(lat, lng) {
  if (!opened) return
  if (typeof lat !== 'number' || typeof lng !== 'number') return
  sendJson({ type: 'location', lat, lng })
}

// ---------- 位置周期上报（每 5 秒一条 location）----------
// 为什么要周期上报：start 里只带「通话开始那一刻」的坐标，而用户是边走边聊的，
// 位置偏了几百米，「附近有什么好玩的」就会推荐到身后去了。
// 实现要点：
//   ① 走 utils/position.js 的统一入口（getPosition）—— 它自带 5 秒防连点缓存，正好与本周期对齐，
//      不会因为自己加定时器而额外撞微信的定位限频（getFuzzyLocation:fail frequency limit）；
//   ② 走兜底坐标（isFallback，模拟器必失败）时**不发**——发假坐标会让搭子一本正经地推荐「景区主入口」周边；
//   ③ 断连/挂断一律 stopLocLoop()，别让定时器活到通话之后（否则后台每 5 秒拉一次定位，白耗电）。
const LOC_INTERVAL_MS = 5000
let locTimer = null

function tickLocation() {
  getPosition(false).then(pos => {
    if (!pos || pos.isFallback) return          // 兜底坐标：宁可不报，也不报假的
    sendLocation(pos.lat, pos.lng)
  }).catch(() => { /* 拿不到定位就跳过这一次，下个周期再试 */ })
}

export function startLocLoop() {
  if (locTimer) return                          // 幂等：重复调不会叠出两个定时器
  tickLocation()                                // 立刻补一条（start 之后用户可能已经走开了）
  locTimer = setInterval(tickLocation, LOC_INTERVAL_MS)
  console.log('[call] 位置周期上报已开启：每', LOC_INTERVAL_MS / 1000, '秒一条 location')
}

export function stopLocLoop() {
  if (locTimer) { clearInterval(locTimer); locTimer = null }
}

export function hangUp() {
  closed = true          // 标记：此后即便有「迟到的连接」建立成功，也会被 bind 立即关掉
  clearDemo()
  stopLocLoop()          // 位置周期上报必须随挂断停掉（onClose 也会停，两条路都堵上：主动挂断时 onClose 不一定先到）
  pendingAudio = []      // 挂断即清：残留帧不能留给下一通
  if (task) {
    if (opened) sendJson({ type: 'stop' })
    try { task.close({}) } catch (e) { /* 已关闭 */ }
    task = null
  }
  opened = false
  handlers = null
}

// ---------- 本地演示脚本（MOCK.call）：事件节奏与真链路一致 ----------
// 演示语料刻意覆盖搭子的四类能力：查行程 / 查记账 / 推荐附近 / 查天气
const DEMO_TURNS = [
  {
    q: '今天上午去哪儿？',
    vision: { attraction: '西湖风景名胜区', description: '湖面游船与远山，游人沿湖边漫步' },
    a: '今天上午安排的是西湖风景名胜区，建议从北山街入口进，那边人相对少。环湖慢走一圈大约两个半小时，记得带防晒和饮用水。'
  },
  {
    q: '这趟一共花了多少钱？',
    a: '目前记了 3 笔，一共 680 元：餐饮 320、门票 300、交通 60。要我按分类念一遍明细吗？'
  },
  {
    q: '附近有什么好玩的？',
    a: '离你大约六百米有个中国茶叶博物馆，室内场馆、午后避晒，周一闭馆；下午过去正好接上灵隐那条线。'
  },
  {
    q: '明天天气怎么样？',
    a: '明天多云，24 到 31 度，午后有三成左右的阵雨概率，建议把运河游船放在上午。'
  }
]

function clearDemo() {
  demoTimers.forEach(t => clearTimeout(t))
  demoTimers = []
  demoNarrate = null
}
function later(fn, ms) { demoTimers.push(setTimeout(fn, ms)) }

// 演示模式的「听听讲解」文案：模拟 narrate 工具返回的讲解词。
// 真链路里这段文字由下行 tts.text 带回来（页面同一条分支处理，演示与真实完全同构）。
const DEMO_NARRATE = '这里是西湖风景名胜区。湖面被苏堤分成东西两片，白堤连接孤山，环湖一圈约十五公里；清晨和傍晚光线最好、游人也最少。'

// 把整句切成逐段增长的中间结果，模拟 ASR 上屏（最后一段 = 整句）
function splitPartial(q) {
  const n = q.length
  if (n <= 3) return [q]
  return [q.slice(0, Math.ceil(n / 3)), q.slice(0, Math.ceil((n * 2) / 3)), q]
}

function startDemo(opts) {
  status('connecting')
  later(() => {
    status('open')
    emit({ type: 'ready', sessionId: 'demo-' + Date.now() })
  }, 500)
  // 「听听讲解」的演示应答：按新协议拆两条 —— 文字走 text 消息、音频走 tts（演示无真音频，data 空）
  demoNarrate = () => {
    later(() => emit({ type: 'text', text: DEMO_NARRATE }), 700)
    later(() => emit({ type: 'tts', data: '' }), 800)
  }
  // 连接时的欢迎语：属于「主动提醒」那一类 —— 按协议它的文字仍随 tts 一起下发（text 消息只管回答）
  later(() => {
    const who = opts && opts.city ? `「${opts.city}」这份` : '当前这份'
    emit({ type: 'tts', data: '', text: `我是小沃，已经绑定${who}攻略。今天去哪儿、花了多少、附近有什么、明天天气，直接问我就行。` })
  }, 1300)

  let at = 3000
  DEMO_TURNS.forEach(turn => {
    const segs = splitPartial(turn.q)
    segs.forEach((seg, i) => later(() => emit({ type: 'asr_partial', text: seg }), at + i * 280))
    const finAt = at + (segs.length - 1) * 280
    later(() => emit({ type: 'asr_final', text: turn.q }), finAt)
    if (turn.vision) later(() => emit({ type: 'vision', ...turn.vision }), finAt + 200)
    // 问答回答：新协议拆两条 —— 文字先到（text 消息），音频后到（tts）；演示无真音频，只有字幕
    later(() => emit({ type: 'text', text: turn.a }), finAt + 900)
    later(() => emit({ type: 'tts', data: '' }), finAt + 1000)
    at = finAt + 5600   // 轮间隔：留出「AI 正在说」的时间
  })
}
