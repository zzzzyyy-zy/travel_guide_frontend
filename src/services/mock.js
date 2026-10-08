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
        avatarUrl: null,
        isAdmin: true   // mock 给管理员身份，演示时「运营看板」入口可见（真实后端按 DB is_admin 下发）
      }
    }))
  }

  // POI 列表（后端未出，继续 mock）
  if (path.indexOf('/api/poi/list') === 0) {
    return delayer(() => POIS)
  }

  // 自由路线规划（最近邻演示：直线距离×1.3 近似步行，÷1.1m/s 估时长，与真实接口字段对齐）
  if (path === '/api/route/optimize') {
    return delayer(() => {
      const pts = (data && Array.isArray(data.points) && data.points) || []
      if (!pts.length) throw { code: 400, message: '未标注景点' }
      if (pts.some(p => !isFinite(p.lat) || !isFinite(p.lng))) throw { code: 400, message: '景点缺坐标' }
      // 后端已移除 origin：固定从第一个点出发（route[0] 的 distance 为 null）
      let cur = null
      const left = pts.map(p => ({ name: p.name, lat: p.lat, lng: p.lng }))
      const route = []
      while (left.length) {
        let bi = 0
        let bd = Infinity
        left.forEach((p, i) => {
          if (!cur) { bi = i; bd = 0; return }   // 无起点：第一个点 distance 为 null
          const d = Math.hypot((p.lng - cur.lng) * 97, (p.lat - cur.lat) * 111) * 1000
          if (d < bd) { bd = d; bi = i }
        })
        const p = left.splice(bi, 1)[0]
        const dist = cur ? Math.round(bd * 1.3) : null
        // 与真实契约对齐（2026-10-06）：只回 distance（米），**不回 duration** —— 前端也不推算时长，只显示距离
        route.push({ name: p.name, lat: p.lat, lng: p.lng, distance: dist })
        cur = { lat: p.lat, lng: p.lng }
      }
      return {
        route,
        totalDistance: route.reduce((s, r) => s + (r.distance || 0), 0)
      }
    })
  }

  // 周边设施（GET /api/nearby/facilities，后端文档 2026-10-02）：四类各回 1km 内最近一个。
  // 以请求坐标为圆心随手撒点，距离用直线距离估算；「充电桩」固定回 null 演示空态。
  if (path === '/api/nearby/facilities') {
    return delayer(() => {
      const lat = data && Number(data.lat)
      const lng = data && Number(data.lng)
      // 与真实后端对齐：坐标缺失/为 0 一律 400（页面据此提示「需要定位」，不给假结果）
      if (!isFinite(lat) || !isFinite(lng) || (lat === 0 && lng === 0)) throw { code: 400, message: '定位信息无效' }
      const around = (dLat, dLng, name, distance, address) => ({
        name, distance, address,
        lat: +(lat + dLat).toFixed(6), lng: +(lng + dLng).toFixed(6)
      })
      return {
        公厕: around(0.0009, 0.0006, '景区公共厕所', 120, '景区北门旁'),
        民宿: around(-0.0032, 0.0035, '山脚湖畔民宿', 480, '湖畔路 12 号'),
        停车场: around(0.0005, -0.0007, '游客中心停车场', 80, '游客中心地下一层'),
        充电桩: null   // 演示「1km 内未找到」空态
      }
    })
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
  if (path === '/api/user/profile') {
    return delayer(() => {
      // 部分更新：传哪个改哪个；mock 的头像用假 OSS 地址模拟转存
      const out = {}
      if (data && data.nickname) out.nickname = data.nickname
      if (data && data.avatar) out.avatarUrl = 'https://mock.oss/avatar/mock-' + Date.now() + '.png'
      return out
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
      const at = (data && data.attraction) || '当前景点'
      const answer = turns === 1
        ? `关于${at}：西湖最著名的传说是白蛇传——许仙与白娘子在断桥相会、被法海镇压于雷峰塔下的故事，就发生在这片湖山之间。`
        : `这是第 ${turns} 轮回答。你在${at}问的是「${q}」，mock 模式下多轮上下文已记录，真实后端将基于 sessionId + attraction 续写。`
      return { sessionId: data.sessionId, answer }
    })
  }

  // 搭子文字聊天（REST，2026-10-04）：body { tripId, text } → { answer }
  // 与真实后端同约定：tripId 必传，历史由服务端按 guide:call:{userId}:{tripId} 承接
  if (path === '/api/guide/chat-text') {
    return delayer(() => {
      if (!data || !data.tripId) return Promise.reject({ code: 404, message: '行程不存在' })
      const t = data && data.text
      if (!t) return Promise.reject({ code: 400, message: '问题为空' })
      return { answer: `（mock）收到关于这份攻略的问题：「${t}」。真实后端会带上这份攻略的行程、账本、行李清单来回答。` }
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

  // 增长运营（7.7）：独立状态机在 mockGrowth 里，未匹配返回 null 继续往下走
  if (path.indexOf('/api/growth/') === 0) {
    const r = mockGrowth(path, method, data)
    if (r) return r
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
          // 2026-09-29 新契约：city/days/startDate 给列表摘要行用；isOwner 区分「我创建的」与「加入协作的」
          // mock 是单用户内存库，自己生成的都算 owner（要演示协作行程项得连真后端）
          city: (t.request && t.request.destinationCity) || '',
          days: (t.request && t.request.days) || '',
          isOwner: t.isOwner !== false,
          // 成员总数（含创建者）：mock 是单用户内存库 → owner 行程默认只有自己；
          // 访问过详情页生成 collaborators 后按实际条数回，前端以此判「≥2 人 = 协作行程」（2026-10-08）
          memberCount: (t.collaborators ? t.collaborators.length : 1),
          isFavorite: !!(t.request && t.request.isFavorite),
          startDate: (t.request && t.request.startDate) || '',
          peopleCount: (t.request && t.request.peopleCount) || ''
        }))
    )
  }

  // 收藏 / 取消收藏（2026-09-25）：内存标记挂 request 上，data 为 null
  const favMatch = path.match(/\/api\/trip\/(\d+)\/favorite/)
  if (favMatch) {
    const st = trips.get(Number(favMatch[1]))
    if (!st) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    return delayer(() => {
      st.request = st.request || {}
      st.request.isFavorite = method !== 'DELETE'
      return null
    })
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

  // 行程编辑（后端文档 2026-09-24）：spot 增删改移 + result 整体覆盖（不触发 RAG 摄入）
  // 统一用 dayIndex/spotIndex（数组下标从 0 起）定位，越界 400、行程不存在 404
  const moveMatch = path.match(/\/api\/trip\/(\d+)\/spot\/move/)
  if (moveMatch && method === 'PUT') {
    const t = trips.get(Number(moveMatch[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    return delayer(() => {
      const days = t.detail.days || []
      const src = days[data.fromDay]
      const dst = days[data.toDay]
      if (!src || !dst) throw { code: 400, message: '天数索引越界' }
      const arr = src.spots || []
      if (!(data.fromSpot >= 0 && data.fromSpot < arr.length)) throw { code: 400, message: '景点索引越界' }
      const item = arr.splice(data.fromSpot, 1)[0]
      const target = dst.spots || []
      // 语义：先移出、再按 toSpot 插入（toSpot 超长时追加到末尾）
      target.splice(Math.max(0, Math.min(data.toSpot, target.length)), 0, item)
      src.spots = arr
      dst.spots = target
      return null
    })
  }
  const spotMatch = path.match(/\/api\/trip\/(\d+)\/spot$/)
  if (spotMatch) {
    const t = trips.get(Number(spotMatch[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    return delayer(() => {
      const days = t.detail.days || []
      const day = days[data.dayIndex]
      if (!day) throw { code: 400, message: '天数索引越界' }
      if (!Array.isArray(day.spots)) day.spots = []
      if (method === 'POST') {
        if (!data.spot || !data.spot.name) throw { code: 400, message: 'spot 缺失或无 name' }
        day.spots.push(data.spot)
        return null
      }
      if (!(data.spotIndex >= 0 && data.spotIndex < day.spots.length)) throw { code: 400, message: '景点索引越界' }
      if (method === 'PUT') {
        if (!data.spot || !data.spot.name) throw { code: 400, message: 'spot 缺失或无 name' }
        day.spots[data.spotIndex] = data.spot
        return null
      }
      if (method === 'DELETE') {
        day.spots.splice(data.spotIndex, 1)
        return null
      }
      throw { code: 400, message: '不支持的方法' }
    })
  }
  const resultMatch = path.match(/\/api\/trip\/(\d+)\/result$/)
  if (resultMatch && method === 'PUT') {
    const t = trips.get(Number(resultMatch[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    return delayer(() => {
      if (!data || !data.result || !Array.isArray(data.result.days)) throw { code: 400, message: 'result 结构不合法' }
      t.detail = data.result
      return null
    })
  }

  // 对话式行程重排：POST /api/trip/{id}/replan（演示模式：原样返回攻略对象并附演示标记）
  const replanMatch = path.match(/\/api\/trip\/(\d+)\/replan$/)
  if (replanMatch && method === 'POST') {
    const t = trips.get(Number(replanMatch[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    return delayer(() => {
      if (!data || !String(data.instruction || '').trim()) throw { code: 400, message: '指令为空' }
      const result = JSON.parse(JSON.stringify(t.detail))
      result.tips = [...(result.tips || []), `已按「${data.instruction}」调整（演示模式，未真正重排）`]
      return result
    }, 1200)
  }

  // ---------- 协作（后端文档 2026-09-26）----------
  // 加入协作：POST /api/trip/join（幂等；须在 tripId 兜底前处理，否则 "join" 会被当 id）
  if (path === '/api/trip/join' && method === 'POST') {
    return delayer(() => {
      const tk = data && data.token
      if (!tk) throw { code: 400, message: 'token 为空' }
      const st = Array.from(trips.values()).find(x => x.shareToken === tk)
      if (!st) throw { code: 404, message: '分享不存在或已失效' }
      // 幂等：mock 单用户永远"已加入"，直接返回 tripId
      return { tripId: st.id }
    })
  }
  // 协作成员列表：GET /api/trip/{id}/collaborators（演示：创建者 + 小红，可试移除）
  const collabMatch = path.match(/\/api\/trip\/(\d+)\/collaborators$/)
  if (collabMatch && method === 'GET') {
    const t = trips.get(Number(collabMatch[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    return delayer(() => {
      if (!t.collaborators) {
        t.collaborators = [
          { userId: 1, nickname: '创建者', avatarUrl: null, isOwner: true },
          { userId: 2, nickname: '小红', avatarUrl: null, isOwner: false }
        ]
      }
      return t.collaborators
    })
  }
  // 退出协作：DELETE /api/trip/{id}/collaborator/me（协作者自身退出；创建者应删除行程）
  // 注意必须排在 /collaborator/{userId} 的数字正则之前，「me」不是数字不会误匹配，但顺序更清晰
  const quitCollabMatch = path.match(/\/api\/trip\/(\d+)\/collaborator\/me$/)
  if (quitCollabMatch && method === 'DELETE') {
    const t = trips.get(Number(quitCollabMatch[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    return delayer(() => {
      const meId = 1   // mock 单用户固定 userId=1（见登录返回）
      const me = (t.collaborators || []).find(c => c.userId === meId)
      if (!me) throw { code: 400, message: '不是该行程协作者' }
      if (me.isOwner) throw { code: 400, message: '创建者不能退出协作，请直接删除行程' }
      t.collaborators = t.collaborators.filter(c => c.userId !== meId)
      return null
    })
  }
  // 移除协作者：DELETE /api/trip/{id}/collaborator/{userId}（仅 owner）
  const rmCollabMatch = path.match(/\/api\/trip\/(\d+)\/collaborator\/(\d+)$/)
  if (rmCollabMatch && method === 'DELETE') {
    const t = trips.get(Number(rmCollabMatch[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    return delayer(() => {
      const uid = Number(rmCollabMatch[2])
      const list = t.collaborators || []
      if (list.some(c => c.userId === uid && c.isOwner)) throw { code: 400, message: '不能移除创建者' }
      t.collaborators = list.filter(c => c.userId !== uid)
      return null
    })
  }

  // ---------- 行李清单（后端文档 2026-09-26）----------
  // AI 生成（清空重建）：POST /api/trip/{id}/packing/generate
  const packGenMatch = path.match(/\/api\/trip\/(\d+)\/packing\/generate$/)
  if (packGenMatch && method === 'POST') {
    const t = trips.get(Number(packGenMatch[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    return delayer(() => {
      const city = (t.detail && t.detail.city) || '目的地'
      t.packing = ['身份证/护照', '手机充电器', '充电宝', '换洗衣物', '舒适运动鞋', '防晒霜', '太阳镜',
        '洗漱包', '常用药品', '雨伞', '水杯', `"${city}"出行攻略（打印版）`].map((name, i) => ({
        id: i + 1, tripId: t.id, name, checked: false, createdAt: now()
      }))
      t.packNextId = t.packing.length + 1
      return t.packing
    }, 1500)
  }
  // 一键清除勾选：PUT /api/trip/{id}/packing/check/reset（无 data；须放在 {itemId} 规则之前）
  const packResetMatch = path.match(/\/api\/trip\/(\d+)\/packing\/check\/reset$/)
  if (packResetMatch && method === 'PUT') {
    const t = trips.get(Number(packResetMatch[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    return delayer(() => {
      (t.packing || []).forEach(p => { p.checked = false })
      return null
    })
  }
  // 列表 / 新增：GET|POST /api/trip/{id}/packing
  const packMatch = path.match(/\/api\/trip\/(\d+)\/packing$/)
  if (packMatch) {
    const t = trips.get(Number(packMatch[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    if (method === 'GET') return delayer(() => t.packing || [])
    return delayer(() => {
      const name = data && String(data.name || '').trim()
      if (!name) throw { code: 400, message: '物品名为空' }
      if (!t.packing) t.packing = []
      if (!t.packNextId) t.packNextId = t.packing.length + 1
      const item = { id: t.packNextId++, tripId: t.id, name, checked: false, createdAt: now() }
      t.packing.push(item)
      return t.packing
    })
  }
  // 修改 / 删除：PUT|DELETE /api/trip/{id}/packing/{itemId}
  const packItemMatch = path.match(/\/api\/trip\/(\d+)\/packing\/(\d+)$/)
  if (packItemMatch) {
    const t = trips.get(Number(packItemMatch[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    return delayer(() => {
      const list = t.packing || []
      const item = list.find(p => p.id === Number(packItemMatch[2]))
      if (!item) throw { code: 404, message: '物品不存在' }
      if (method === 'PUT') {
        const name = data && String(data.name || '').trim()
        if (!name) throw { code: 400, message: '物品名为空' }
        item.name = name
        item.checked = !!(data && data.checked)
        return list
      }
      t.packing = list.filter(p => p.id !== item.id)
      return t.packing
    })
  }

  // 目的地天气：GET /api/trip/{id}/weather（演示：按城市给固定实况+三天预报）
  const weatherMatch = path.match(/\/api\/trip\/(\d+)\/weather$/)
  if (weatherMatch && method === 'GET') {
    const t = trips.get(Number(weatherMatch[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    return delayer(() => {
      const city = (t.detail && t.detail.city) || '目的地'
      const day = offset => {
        const d = new Date(Date.now() + offset * 86400000)
        return d.toISOString().slice(0, 10)
      }
      return {
        city,
        now: { text: '多云', temp: '24', feelsLike: '26', humidity: '62' },
        forecast: [
          { date: day(0), text: '多云', tempMax: '27', tempMin: '19' },
          { date: day(1), text: '小雨', tempMax: '24', tempMin: '18' },
          { date: day(2), text: '阴', tempMax: '26', tempMin: '20' }
        ]
      }
    })
  }

  // 城市热门景点：GET /api/attractions/popular?city=xx（预置数据演示）
  if (path.indexOf('/api/attractions/popular') === 0 && method === 'GET') {
    const qcity = decodeURIComponent((path.split('?')[1] || '').match(/city=([^&]+)/)?.[1] || '')
    return delayer(() => {
      if (!qcity.trim()) throw { code: 400, message: '缺少 city' }
      return [
        { name: `${qcity}博物馆`, imageUrl: 'https://img.icons8.com/fluency/96/museum.png', description: '城市文化地标，了解历史与民俗的首选' },
        { name: `${qcity}老街`, imageUrl: 'https://img.icons8.com/fluency/96/street-view.png', description: '百年骑楼老街，本地小吃与文创聚集地' },
        { name: `${qcity}湖滨公园`, imageUrl: 'https://img.icons8.com/fluency/96/park-bench.png', description: '市民休闲胜地，适合傍晚散步观景' },
        { name: `${qcity}夜市`, imageUrl: 'https://img.icons8.com/fluency/96/open-sign.png', description: '人气夜市，地道美食一站式打卡' }
      ]
    }, 250)
  }

  // 图片上传（演示：把上传的 base64 原样包成 data URL 返回，离线也能预览）
  if (path === '/api/upload/image' && method === 'POST') {
    return delayer(() => {
      const img = (data && data.image) || ''
      if (!img) throw { code: 400, message: '图片为空' }
      const url = img.indexOf('data:') === 0 ? img : `data:image/jpeg;base64,${img}`
      return { url }
    }, 400)
  }

  // ---------- 开支记账（list / summary / add / update / delete）----------
  const CATS = ['accommodation', 'transport', 'food', 'misc']
  const ensureExpenses = t => {
    if (!t.expenses) {
      t.expenses = [
        { id: 1, tripId: t.id, category: 'food', amount: 128.5, note: '特色午餐', expenseDate: new Date().toISOString().slice(0, 10), createdAt: now() }
      ]
      t.expNextId = 2
    }
    return t.expenses
  }
  const sumExpenses = t => {
    const list = ensureExpenses(t)
    const categories = { accommodation: 0, transport: 0, food: 0, misc: 0 }
    list.forEach(e => { categories[e.category] = +(categories[e.category] + e.amount).toFixed(2) })
    return { total: +list.reduce((s, e) => s + e.amount, 0).toFixed(2), categories }
  }
  const validExpBody = data => {
    const body = data || {}
    const amount = Number(body.amount)
    if (!CATS.includes(body.category)) return { error: '分类不合法' }
    if (!isFinite(amount) || amount < 0) return { error: '金额为负或无效' }
    return { category: body.category, amount: +amount.toFixed(2), note: (body.note || '').trim(), expenseDate: body.expenseDate || new Date().toISOString().slice(0, 10) }
  }
  const expListMatch = path.match(/\/api\/trip\/(\d+)\/expenses$/)
  if (expListMatch) {
    const t = trips.get(Number(expListMatch[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    if (method === 'GET') return delayer(() => ensureExpenses(t))
    if (method === 'POST') {
      const v = validExpBody(data)
      if (v.error) return delayer(() => { throw { code: 400, message: v.error } })
      return delayer(() => {
        const list = ensureExpenses(t)
        list.unshift({ id: t.expNextId++, tripId: t.id, ...v, createdAt: now() })
        return list
      })
    }
  }
  const expSumMatch = path.match(/\/api\/trip\/(\d+)\/expenses\/summary$/)
  if (expSumMatch && method === 'GET') {
    const t = trips.get(Number(expSumMatch[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    return delayer(() => sumExpenses(t))
  }
  const expItemMatch = path.match(/\/api\/trip\/(\d+)\/expenses\/(\d+)$/)
  if (expItemMatch) {
    const t = trips.get(Number(expItemMatch[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    return delayer(() => {
      const list = ensureExpenses(t)
      const item = list.find(e => e.id === Number(expItemMatch[2]))
      if (!item) throw { code: 404, message: '记录不存在' }
      if (method === 'PUT') {
        const v = validExpBody(data)
        if (v.error) throw { code: 400, message: v.error }
        Object.assign(item, v)
      } else if (method === 'DELETE') {
        t.expenses = list.filter(e => e.id !== item.id)
        return t.expenses
      }
      return list
    })
  }

  // 从当前位置出发重排（最近邻演示：直线距离×1.3 近似步行路线距离）
  if (/\/api\/trip\/(\d+)\/reorder-from$/.test(path) && method === 'POST') {
    const t = trips.get(Number(path.match(/\/api\/trip\/(\d+)\/reorder-from$/)[1]))
    if (!t) return delayer(() => { throw { code: 404, message: '行程不存在' } })
    const lat = data && data.lat
    const lng = data && data.lng
    const di = (data && data.dayIndex) || 0
    return delayer(() => {
      if (!isFinite(lat) || !isFinite(lng)) throw { code: 400, message: '缺少当前坐标' }
      const day = (((t.detail || {}).result || {}).days || [])[di]
      if (!day || !Array.isArray(day.spots)) throw { code: 400, message: '天数索引越界' }
      const left = day.spots.filter(s => isFinite(s.lat) && isFinite(s.lng))
      const route = []
      let cur = { lat, lng }
      while (left.length) {
        let bi = 0
        let bd = Infinity
        left.forEach((s, i) => {
          const d = Math.hypot((s.lng - cur.lng) * 97, (s.lat - cur.lat) * 111) * 1000   // 粗略米数
          if (d < bd) { bd = d; bi = i }
        })
        const s = left.splice(bi, 1)[0]
        route.push({ name: s.name, lat: s.lat, lng: s.lng, distance: Math.round(bd * 1.3) })
        cur = { lat: s.lat, lng: s.lng }
      }
      return { dayIndex: di, route }
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
            const s = steps[i++]
            if (handlers.onStep) handlers.onStep(s)
            // 搜索类步骤演出一条 search 事件（对齐 2026-09-25 协议：{ source, content }）
            if (/搜索/.test(s) && handlers.onSearch) {
              handlers.onSearch({ source: '联网搜索', content: s.replace('正在搜索：', '') + '等资料已取回' })
            }
            // 演出 knowledge / agent 事件（对齐协议新增类型；本地知识库→首批、规划→Agent）
            if (/搜索/.test(s) && handlers.onKnowledge) {
              handlers.onKnowledge({ source: '知识库检索', content: '命中本地攻略与景点词条 3 篇' })
            }
            if (/规划/.test(s) && handlers.onAgent) {
              handlers.onAgent({ source: 'Agent 调用', content: '路线规划 Agent 已完成排程' })
            }
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

// ---------- 增长运营 mock（7.7）：签到/等级/流水/邀请/兑换（后端未实现） ----------
// 等级由成长值（累计正积分）决定，5 级；阈值/称号为演示数据，后端上线后以其为准
const LEVELS = [
  { min: 0, level: 1, title: '旅行新手', benefits: ['历史行程容量 +3'] },
  { min: 100, level: 2, title: '出行达人', benefits: ['历史行程容量 +10', '专属称号「出行达人」'] },
  { min: 300, level: 3, title: '旅行行家', benefits: ['历史行程容量 +20', '优先体验新功能'] },
  { min: 600, level: 4, title: '旅行大师', benefits: ['历史行程容量 +30', '专属客服通道'] },
  { min: 1000, level: 5, title: '文旅至尊', benefits: ['全部权益', '限量文创礼品'] }
]

// 成就勋章 mock（7.7，2026-09-25 后端新增 /api/growth/achievements）：6 系列覆盖式
// current=已解锁最高档（0=未解锁）；levels 含未解锁档位，前端据 current 高亮
const ACHIEVEMENTS = [
  { id: 'guide', name: '攻略策划', progress: 6, current: 2, title: '行程规划师', levels: [{ count: 1, title: '旅行启蒙' }, { count: 5, title: '行程规划师' }, { count: 15, title: '攻略大师' }, { count: 30, title: '环球策划师' }] },
  { id: 'checkin', name: '足迹打卡', progress: 3, current: 1, title: '初探足迹', levels: [{ count: 1, title: '初探足迹' }, { count: 5, title: '足迹行者' }, { count: 15, title: '城市漫游者' }, { count: 30, title: '旅行收藏家' }] },
  { id: 'streak', name: '坚持不懈', progress: 7, current: 1, title: '七日之约', levels: [{ count: 7, title: '七日之约' }, { count: 30, title: '月度坚守' }, { count: 100, title: '持之以恒' }] },
  { id: 'invite', name: '结伴同行', progress: 0, current: 0, title: '', levels: [{ count: 1, title: '引路人' }, { count: 5, title: '结伴而行' }, { count: 15, title: '旅友召集人' }] },
  { id: 'city', name: '城市猎人', progress: 2, current: 0, title: '', levels: [{ count: 3, title: '三城记' }, { count: 10, title: '十城游记' }, { count: 30, title: '城市猎人' }] },
  { id: 'favorite', name: '收藏家', progress: 5, current: 1, title: '收藏初现', levels: [{ count: 5, title: '收藏初现' }, { count: 20, title: '攻略收藏家' }] }
]

// 意见反馈 mock（2026-10-05）：只活在本次运行内存里，用于页面开发与契约异常演示
const feedbackState = {
  seq: 0,
  list: []   // [{ id, userId, contact, content, images: 'url1,url2', createdAt }]
}

const growthState = {
  points: 105,          // 当前可用积分
  streak: 6,            // 连续签到天数（下一次签到即满 7 天，可演示额外奖励）
  lastSignDate: '',     // YYYY-MM-DD，判断今天是否已签
  invitedCount: 3,
  records: [
    { points: 20, type: 'invite', remark: '邀请好友注册', createdAt: '2026-09-23T10:00:00' },
    { points: 10, type: 'generate', remark: '生成攻略', createdAt: '2026-09-22T09:30:00' },
    { points: 5, type: 'sign_in', remark: '每日签到', createdAt: '2026-09-22T08:00:00' }
  ],
  redeemItems: [
    { itemId: 'pdf_export', name: '导出 PDF 次数 +1', cost: 50 },
    { itemId: 'generate_card', name: '攻略生成次数 +1', cost: 30 },
    { itemId: 'custom_title', name: '自定义称号（7 天）', cost: 100 }
  ]
}

function dayKey(d) {
  const t = d || new Date()
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0')
}

function growthSummary() {
  const lv = [...LEVELS].reverse().find(l => growthState.points >= l.min) || LEVELS[0]
  const next = LEVELS.find(l => l.min > growthState.points)
  return {
    points: growthState.points,
    growth: growthState.points,           // 成长值 = 累计正积分（mock 里与积分同源）
    level: lv.level,
    title: lv.title,
    benefits: lv.benefits,
    nextLevelGrowth: next ? next.min : null,
    signedToday: growthState.lastSignDate === dayKey()   // 2026-09-25 后端新增字段，mock 对齐
  }
}

function mockGrowth(path, method, data) {
  if (path === '/api/growth/summary') return delayer(growthSummary)
  if (path === '/api/growth/points') return delayer(() => growthState.records.slice(0, 20))
  if (path === '/api/growth/invite-info') return delayer(() => ({ invitedCount: growthState.invitedCount, invitePoints: growthState.invitedCount * 20 }))
  // 邀请小程序码 mock 已随功能撤除（2026-10-08）
  if (path === '/api/growth/redeem-items') return delayer(() => growthState.redeemItems)
  if (path === '/api/growth/achievements') return delayer(ACHIEVEMENTS)
  if (path === '/api/growth/sign-in') {
    return delayer(() => {
      const today = dayKey()
      if (growthState.lastSignDate === today) throw { code: 400, message: '今日已签到' }
      // 连续签到：昨天签过则 streak+1，否则重新从 1 计
      const yest = new Date(); yest.setDate(yest.getDate() - 1)
      growthState.streak = growthState.lastSignDate === dayKey(yest) ? growthState.streak + 1 : 1
      growthState.lastSignDate = today
      let gain = 5
      const extra = []
      if (growthState.streak > 0 && growthState.streak % 30 === 0) { gain += 50; extra.push('连续签到 30 天额外 +50') }
      else if (growthState.streak > 0 && growthState.streak % 7 === 0) { gain += 10; extra.push('连续签到 7 天额外 +10') }
      growthState.points += gain
      growthState.records.unshift({ points: gain, type: 'sign_in', remark: extra.length ? `每日签到（${extra[0]}）` : '每日签到', createdAt: now() })
      const s = growthSummary()
      return { ...s, todayPoints: gain, streak: growthState.streak, signedToday: true }
    }, 350)
  }
  if (path === '/api/growth/redeem') {
    return delayer(() => {
      const item = growthState.redeemItems.find(i => i.itemId === (data && data.itemId))
      if (!item) throw { code: 400, message: '兑换项不存在' }
      if (growthState.points < item.cost) throw { code: 400, message: `经验不足（还差 ${item.cost - growthState.points} 点）` }
      growthState.points -= item.cost
      growthState.records.unshift({ points: -item.cost, type: 'redeem', remark: `兑换「${item.name}」`, createdAt: now() })
      return { points: growthState.points, itemId: item.itemId, name: item.name, cost: item.cost }
    }, 350)
  }
  // AI 旅行报告（日度）：对齐真实后端的当日缓存语义，mock 直接按日期生成一份固定文案
  if (path === '/api/growth/report') {
    return delayer(() => ({
      report: `亲爱的旅行者，你已经规划了 ${growthState.records.filter(r => r.type === 'generate').length + 3} 条行程，足迹遍布 3 座城市，收藏了 5 个心动的目的地，连续签到 ${growthState.streak} 天。你的旅行热情正在稳步升温，本期等级 Lv.${growthSummary().level}。小建议：下一次旅行不妨选一座没去过的南方小城，用两天时间慢下来，把街头小吃和老街巷都逛一遍。`,
      date: dayKey()
    }), 800)   // 模拟 DeepSeek 生成耗时
  }
  // 运营数据看板（仅管理员）：mock 不做权限校验，直接给演示数据
  if (path === '/api/admin/stats') {
    return delayer(() => ({
      totalUsers: 128,
      totalTrips: 312,
      totalCheckIns: 87,
      dau: 15,
      topCities: [
        { city: '成都', cnt: 42 },
        { city: '西安', cnt: 33 },
        { city: '杭州', cnt: 28 },
        { city: '重庆', cnt: 21 },
        { city: '北京', cnt: 17 }
      ]
    }))
  }
  // 预热热门景点照片（仅管理员）：演示前调一次，之后 popular 秒回
  if (path === '/api/admin/warm-attractions' && method === 'POST') {
    return delayer(() => '预热已启动', 600)
  }
  // 意见反馈（2026-10-05 契约）：mock 下不落库，只回自增 id，保证页面可开发
  if (path === '/api/feedback' && method === 'POST') {
    return delayer(() => {
      const contact = String((data && data.contact) || '').trim()
      const content = String((data && data.content) || '').trim()
      // 契约异常：400 邮箱为空 / 400 意见为空（与真实后端同形，页面 catch 逻辑可验）
      if (!contact) return Promise.reject({ code: 400, message: '联系邮箱不能为空' })
      if (!content) return Promise.reject({ code: 400, message: '意见内容不能为空' })
      feedbackState.list.unshift({
        id: ++feedbackState.seq,
        userId: 1,
        contact,
        content,
        images: ((data && data.images) || []).join(','),
        createdAt: new Date().toISOString().slice(0, 19)
      })
      return { id: feedbackState.seq }
    }, 500)
  }
  // 所有意见反馈（仅管理员）：mock 不做权限校验
  if (path === '/api/admin/feedbacks' && method === 'GET') {
    return delayer(() => feedbackState.list.slice(), 400)
  }
  // 删除单条意见反馈（2026-10-05 契约）：DELETE /api/admin/feedbacks/{id} → { code: 0 }
  if (path.indexOf('/api/admin/feedbacks/') === 0 && method === 'DELETE') {
    const id = Number(path.slice('/api/admin/feedbacks/'.length))
    return delayer(() => {
      const i = feedbackState.list.findIndex(f => f.id === id)
      if (i < 0) return Promise.reject({ code: 404, message: '意见不存在' })  // 契约 404，页面 catch 可验
      feedbackState.list.splice(i, 1)
      return ''
    }, 300)
  }
  return null
}

export { mockRequest as request, streamGenerate, POIS, NARRATIONS, mockGrowth }
