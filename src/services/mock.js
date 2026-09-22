// 本地模拟：后端没就绪时前端照常开发
// 是否走这里由 src/utils/config.js 的 MOCK（按模块）决定，未配置的模块回落到 USE_MOCK
// 当前已连真实后端的模块：auth（登录）、trips（攻略）；仍走 mock：poi / guide / event / ask
// 对齐后端《微信小程序接口文档》攻略模块（2026-09-19）：
//   POST /api/trip/generate（同步一次性返回 { tripId, result }）
//   GET /api/trip/{id} · GET /api/trip/list（简单数组）· DELETE /api/trip/{id}
import { buildMockDetail } from './mockDetail'

// ---------- 讲解页用的模拟 POI / 讲稿（poi 接口后端未出；narrate 供 mock 模式使用） ----------
const POIS = [
  { poiId: 'item_d1_01', name: '西湖风景名胜区', type: 'attraction', lng: 120.14751, lat: 30.24537, tags: ['湖景', '平缓'], stayMinutes: 150, intensity: 1, ticket: 0, closedDays: [], accessibility: {} },
  { poiId: 'item_d1_02', name: '湖滨商圈本地菜午餐', type: 'food', lng: 120.16342, lat: 30.25588, tags: ['餐饮'], stayMinutes: 90, intensity: 1, ticket: 0, closedDays: [], accessibility: {} }
]

// 讲稿按景点名索引（POST /api/guide/narrate 的 body 就是 { attraction }）
const NARRATIONS = {
  '西湖风景名胜区': '西湖三面环山，一面临市。你脚下的苏堤是北宋苏轼任杭州知州时疏浚西湖、用挖出的葑泥筑成的，后人为纪念他而命名。走完这条 2.8 公里的长堤，正好把西里湖的景致看个遍。'
}

// 语音问答 mock 的多轮会话存储（sessionId → 历史问题数组）
const chatSessions = new Map()

// ---------- 行程内存库 ----------
const trips = new Map() // id -> { ...详情字段, detail }
let nextId = 1

function now() {
  return new Date().toISOString()
}

// 预算自由文本 → 数字（"3000" / "3000元左右" / "三千" 都能取到 3000）
function budgetToNumber(text) {
  if (!text) return 0
  const m = String(text).match(/\d+(?:\.\d+)?/)
  return m ? parseFloat(m[0]) : 0
}

// 把新契约请求体规范成 mock 内部结构
function normalizeRequest(data) {
  data = data || {}
  return {
    destinationCity: data.city,
    startDate: data.startDate,
    days: data.days,
    peopleCount: data.peopleCount || 1,
    budgetText: data.budget || '',
    budgetCny: budgetToNumber(data.budget),
    preferences: data.preferences || [],
    energyLevel: data.energyLevel || 'medium',
    transportModes: data.transportation || ['transit'],
    extraRequirements: data.extraRequirements || ''
  }
}

function detailResponse(t) {
  const r = t.request
  return {
    id: t.id,
    city: r.destinationCity,
    startDate: r.startDate,
    days: r.days,
    peopleCount: r.peopleCount,
    preferences: r.preferences.join(','),
    budget: r.budgetText,
    energyLevel: r.energyLevel,
    transportation: r.transportModes.join(','),
    extraRequirements: r.extraRequirements,
    status: 'done',
    result: t.detail,
    createdAt: t.createdAt
  }
}

// ---------- 请求分发（mock 返回的已经是拆包后的 data，api 层不再包装） ----------
function mockRequest(path, method, data) {
  method = method || 'GET'

  // 登录：POST /api/auth/login（公开，body: { code }）
  // 严格对齐后端文档 2026-09-20 的返回结构（含 nickname/avatarUrl 为 null 的真实情形）
  if (path.indexOf('/api/auth/login') === 0) {
    if (!data || !data.code) {
      return delayer(() => { throw { code: 400, message: '缺少 code' } })
    }
    return delayer(() => ({
      token: 'mock_token_' + Date.now(),
      user: {
        id: 1,
        openid: 'mock_openid_001',
        nickname: null,
        avatarUrl: null
      }
    }))
  }

  // POI 列表（后端未出，继续 mock）
  if (path.indexOf('/api/poi/list') === 0) {
    return delayer(() => POIS)
  }

  // 语音导游（后端文档 2026-09-21 · 7.3）
  if (path === '/api/guide/identify') {
    return delayer(() => {
      const hasLoc = data && typeof data.lat === 'number' && typeof data.lng === 'number'
      const hasImg = data && data.image
      if (!hasLoc && !hasImg) return Promise.reject({ code: 400, message: 'lat/lng 与 image 都未提供' })
      // mock 按坐标就近返回第一个 POI；真实后端做地理围栏/图片识别
      return { attraction: POIS[0].name, source: hasLoc ? 'location' : 'image' }
    })
  }
  if (path === '/api/guide/narrate') {
    return delayer(() => {
      const name = data && data.attraction
      if (!name) return Promise.reject({ code: 400, message: 'attraction 为空' })
      return { attraction: name, script: NARRATIONS[name] || `欢迎来到${name}。这里的相关讲解词正在准备中，你可以先欣赏眼前的景致，稍后再来听更详细的介绍。` }
    })
  }
  if (path === '/api/guide/chat') {
    return delayer(() => {
      const q = data && data.question
      if (!q) return Promise.reject({ code: 400, message: 'question 为空' })
      // 多轮：首次生成 sessionId，后续沿用（真实后端按 sessionId 记上下文）
      if (!chatSessions.has(data.sessionId)) {
        const sid = 'mock-session-' + Date.now() + '-' + Math.floor(Math.random() * 1e4)
        chatSessions.set(sid, [])
        data.sessionId = sid
      }
      chatSessions.get(data.sessionId).push(q)
      const turns = chatSessions.get(data.sessionId).length
      const answer = turns === 1
        ? '西湖最著名的传说是白蛇传——许仙与白娘子在断桥相会、被法海镇压于雷峰塔下的故事，就发生在这片湖山之间。'
        : `这是第 ${turns} 轮回答。你刚才问的是「${q}」，mock 模式下多轮上下文已记录，真实后端将基于 sessionId 续写。`
      return { sessionId: data.sessionId, answer }
    })
  }

  // 语音模块（后端文档 2026-09-21 · 7.4）
  if (path === '/api/voice/asr') {
    return delayer(() => {
      if (!data || !data.audio) return Promise.reject({ code: 400, message: 'audio 为空' })
      return { text: '西湖有什么传说' }
    })
  }
  if (path === '/api/voice/tts') {
    return delayer(() => {
      if (!data || !data.text) return Promise.reject({ code: 400, message: 'text 为空' })
      // mock 无法产出真实语音：audio 置空，页面按「无音频」降级为纯字幕
      return { audio: '', contentType: 'audio/mp3' }
    })
  }

  // 埋点上报（后端待补）：本地直接吞掉，返回空体
  if (path.indexOf('/api/event') === 0) {
    return delayer(() => null, 0)
  }

  // 生成攻略：POST /api/trip/generate（同步，一次性返回）
  if (path === '/api/trip/generate' && method === 'POST') {
    return delayer(() => {
      const req = normalizeRequest(data)
      if (!req.destinationCity) {
        return Promise.reject({ code: 400, message: '城市为空' })
      }
      if (!(req.days >= 1 && req.days <= 15)) {
        return Promise.reject({ code: 400, message: '天数须为 1–15' })
      }
      // 测试失败态：其他需求里写「触发失败」
      if (req.extraRequirements.indexOf('触发失败') >= 0) {
        return Promise.reject({ code: 502, message: 'AI 服务暂时不可用，请稍后重试' })
      }
      const t = {
        id: nextId++,
        title: `${req.destinationCity} ${req.days}天`,
        request: req,
        detail: buildMockDetail(req),
        createdAt: now()
      }
      trips.set(t.id, t)
      return { tripId: t.id, result: t.detail }
    }, 2500) // 模拟 AI 生成耗时
  }

  // 历史列表：GET /api/trip/list（简单数组）
  // 首页「最近行程」需要出发日期/人数算倒计时——真后端契约只有 id/title/createdAt，
  // 这里 mock 附加 startDate/peopleCount，前端对缺省字段做了防御，真后端不会因此出错
  if (path === '/api/trip/list') {
    return delayer(() =>
      Array.from(trips.values())
        .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
        .map(t => ({
          id: t.id, title: t.title, createdAt: t.createdAt,
          startDate: (t.request && t.request.startDate) || '',
          peopleCount: (t.request && t.request.peopleCount) || ''
        }))
    )
  }

  // 分享：公开访问（无需登录，须在 trip id 匹配前处理）GET /api/trip/public/{token}
  const pubToken = (path.match(/\/api\/trip\/public\/([A-Za-z0-9]+)/) || [])[1]
  if (pubToken) {
    const pub = Array.from(trips.values()).find(x => x.shareToken === pubToken)
    if (!pub) return delayer(() => { throw { code: 404, message: '分享不存在或已失效' } })
    return delayer(() => ({ id: pub.id, city: pub.city, days: pub.days, result: pub.result }))
  }

  // 分享：小程序码 / 开启 / 撤销  GET|POST|DELETE /api/trip/{id}/qrcode|share
  const shareMatch = path.match(/\/api\/trip\/(\d+)\/(qrcode|share)/)
  if (shareMatch) {
    const st = trips.get(Number(shareMatch[1]))
    if (!st) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    const action = shareMatch[2]
    if (method === 'DELETE') {
      return delayer(() => { st.shareToken = ''; return null })
    }
    return delayer(() => {
      // 16 位 token，开启后挂到行程上供公开访问查询
      if (!st.shareToken) st.shareToken = Array.from({ length: 16 }, () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)]).join('')
      if (action === 'qrcode') {
        // 1x1 透明 PNG 的 base64（模拟图片占位，真实后端返回真实小程序码）
        return { image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', contentType: 'image/png', token: st.shareToken }
      }
      return { token: st.shareToken }
    })
  }

  // 详情 / 删除：/api/trip/{id}
  const tripId = Number((path.match(/\/api\/trip\/([^/?]+)/) || [])[1])
  const t = trips.get(tripId)
  if (!t) return Promise.reject({ code: 404, message: '行程不存在' })

  if (method === 'DELETE') {
    return delayer(() => {
      trips.delete(tripId)
      return null
    })
  }
  return delayer(() => detailResponse(t))
}

// ---------- 生成攻略（流式 mock）：模拟后端 SSE 事件节奏，行为与真实接口对齐 ----------
// 协议（2026-09-20）：step=进度文案 · token=JSON 文本片段 · done={tripId} · error=错误信息
// 与真实接口同契约：resolve({ tripId })；进度经 handlers.onStep、逐字文本经 handlers.onToken 送达
function streamGenerate(payload, handlers) {
  const steps = [
    '正在理解你的需求…',
    '正在搜索：景点与开放时间',
    '正在搜索：本地美食推荐',
    '正在规划每日行程路线',
    '正在核算交通与预算…'
  ]
  return new Promise((resolve, reject) => {
    let i = 0
    // 先同步生成好行程数据（不通知页面），再按事件节奏演出：step → token 逐字 → done
    mockRequest('/api/trip/generate', 'POST', payload || {})
      .then(d => {
        const text = JSON.stringify(d.result, null, 1)
        let pos = 0
        const timer = setInterval(() => {
          if (i < steps.length) {
            if (handlers.onStep) handlers.onStep(steps[i++])
            return
          }
          if (pos < text.length) {
            // 每帧吐 8~20 个字符，模拟大模型逐字输出
            const n = 8 + Math.floor(Math.random() * 12)
            if (handlers.onToken) handlers.onToken(text.slice(pos, pos + n))
            pos += n
            return
          }
          clearInterval(timer)
          resolve({ tripId: d.tripId })
        }, 60)
      })
      .catch(e => reject(e))
  })
}

function delayer(fn, ms) {
  // fn 抛错时转为 reject，让 mock 的失败形态与真实接口一致（页面 catch 逻辑得以验证）
  return new Promise((resolve, reject) => {
    setTimeout(() => {
      try { resolve(fn()) } catch (e) { reject(e) }
    }, ms || 200)
  })
}

export { mockRequest as request, streamGenerate, POIS, NARRATIONS }
