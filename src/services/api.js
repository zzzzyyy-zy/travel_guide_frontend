// 接口层：唯一出口。页面只调这里，不直接发请求
// 契约依据：后端《微信小程序接口文档》攻略模块（2026-09-19）+ 登录接口（2026-09-20）
//   登录：POST /api/auth/login（公开，body { code }）
//         → { code: 0, message: 'ok', data: { token, user: { id, openid, nickname, avatarUrl } } }
//         业务异常：401 code 无效/过期 · 502 微信接口调用失败
//   攻略：POST /api/trip/generate · GET /api/trip/{id} · GET /api/trip/list · DELETE /api/trip/{id}
//   统一包装 { code: 0, message, data }，code===0 为成功（HTTP 状态码恒为 200，判成败看 body.code）
//   鉴权：除登录接口外，所有请求带 Authorization: Bearer <token>；token 失效返回 code 401
import Taro from '@tarojs/taro'
import CONFIG from '../utils/config'
import { saveToken, clearToken, getToken } from '../utils/token'
import { createSseParser, decodeUtf8 } from '../utils/stream'
import * as mock from './mock'

// 城市中心点缓存（cityCenter 用，模块级，一次会话内同一城市只请求一次）
const cityCenterCache = {}
const reverseCityCache = {}   // 逆地理缓存：同坐标一次会话只查一次（省 LBS 配额）

// 登录、分享公开访问等接口不带 Authorization：避免过期 token 干扰公开路径
function isPublicPath(path) {
  const p = path || ''
  return p.indexOf('/api/auth/') === 0 || p.indexOf('/api/trip/public/') === 0
}

function baseHeader(extra, path) {
  const h = { 'Content-Type': 'application/json' }
  const token = getToken()
  if (token && !isPublicPath(path)) h.Authorization = `Bearer ${token}`   // 未登录时不带空 header，避免后端误判
  return Object.assign(h, extra || {})
}

// ---------- GET 参数序列化：手工拼 query，绝不把对象交给基础库 ----------
// 2026-10-08 真机 400 复盘：Tomcat 报 `Invalid character found in the request target`，
//   请求行变成 `GET /api/user/notes?{}` —— 根因是 GET 传了 `data: {}`（空对象），
//   基础库/适配层把空对象序列化后拼进 URL。`{` `}` 与空格都不在 RFC 3986 允许字符集里 → 网关直接 400，
//   压根进不到 controller（所以后端日志里什么也看不到）。
// 修复口径：GET 一律**不传 data 字段**（传 undefined 也会被适配层兜成 {}），
//   需要 query 时由这里手工拼、逐个 encodeURIComponent；空对象 → 不拼任何字符（连 `?` 都不出现）。
function buildQuery(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return ''
  const parts = []
  Object.keys(data).forEach(k => {
    const v = data[k]
    if (v === undefined || v === null) return           // 空值跳过，不生成 `k=undefined`
    const sv = typeof v === 'object' ? JSON.stringify(v) : String(v)
    parts.push(encodeURIComponent(k) + '=' + encodeURIComponent(sv))
  })
  return parts.join('&')                                // 无键 → 空串（关键：不再出现 `?{}`）
}

// 拼接 query：path 已带 `?`（如 /api/trip/list?favorite=true）时用 `&` 续接
function withQuery(path, query) {
  if (!query) return path
  return path + (path.indexOf('?') >= 0 ? '&' : '?') + query
}

// ---------- 裸请求：单次发送，不做重试（401 恢复在 request 层） ----------
function rawRequest(path, method, data, opts) {
  opts = opts || {}
  const m = String(method || 'GET').toUpperCase()
  const isGet = m === 'GET'
  return new Promise((resolve, reject) => {
    const options = {
      url: CONFIG.BASE_URL + (isGet ? withQuery(path, buildQuery(data)) : path),
      method: m,
      header: baseHeader(opts.header, path),
      timeout: opts.timeout || CONFIG.TIMEOUT,
      success: res => {
        const body = res.data || {}
        const ok = res.statusCode >= 200 && res.statusCode < 300 && (body.code === 0 || body.code === 'OK')
        if (ok) {
          resolve(body.data)
        } else {
          reject({
            code: body.code || 'HTTP_' + res.statusCode,
            message: body.message || '请求失败',
            statusCode: res.statusCode,
            data: body.data
          })
        }
      },
      fail: err => reject({ code: 'NETWORK_ERROR', message: '网络异常，请检查网络后重试', raw: err })
    }
    // GET 绝不带 data（空对象会被序列化成 `?{}` → 网关 400）；query 已在 url 里手工拼好
    if (!isGet) options.data = data || {}
    Taro.request(options)
  })
}

// 是否属于「登录态失效」：兼容 HTTP 401 与业务码 AUTH_REQUIRED / UNAUTHORIZED
function isAuthError(err) {
  if (!err) return false
  if (err.statusCode === 401) return true
  const c = err.code
  return c === 401 || c === '401' || c === 'AUTH_REQUIRED' || c === 'UNAUTHORIZED'
}

// ---------- 静默重登：401 时自动恢复一次，同名并发只发一次请求 ----------
let reloginTask = null
function relogin() {
  if (reloginTask) return reloginTask
  reloginTask = new Promise((resolve, reject) => {
    Taro.login({
      success: res => {
        if (!res.code) return reject({ code: 'WX_LOGIN_FAIL', message: '微信登录未返回 code' })
        // 走 request 而非 rawRequest：保持 mock 模式下同样可用
        request('/api/auth/login', 'POST', { code: res.code }).then(d => {
          try {
            saveToken(d)
          } catch (e) {
            return reject({ code: 'AUTH_NO_TOKEN', message: e.message })
          }
          resolve(d)
        }).catch(reject)
      },
      fail: err => reject({ code: 'WX_LOGIN_FAIL', message: '微信登录失败，请重试', raw: err })
    })
  })
  const done = () => { reloginTask = null }   // 无论成败都释放，下次可重试
  reloginTask.then(done, done)
  return reloginTask
}

// ---------- 路径 → 模块：用于按模块决定走 mock 还是真实后端 ----------
function moduleOf(path) {
  if (path.indexOf('/api/auth') === 0) return 'auth'
  if (path.indexOf('/api/trip') === 0) return 'trips'
  if (path.indexOf('/api/upload') === 0) return 'trips'   // 图片上传挂 trips 模块共用真实/mock 开关
  if (path.indexOf('/api/attractions') === 0) return 'trips'   // 热门景点预置数据同样挂 trips 模块
  if (path.indexOf('/api/poi') === 0) return 'poi'
  if (path.indexOf('/api/guide') === 0) return 'guide'
  if (path.indexOf('/api/voice') === 0) return 'voice'
  if (path.indexOf('/api/user') === 0) return 'user'
  if (path.indexOf('/api/growth') === 0) return 'growth'
  if (path.indexOf('/api/admin') === 0) return 'growth'   // 运营看板挂在 growth 模块下，共用其 mock 开关
  if (path.indexOf('/api/route') === 0) return 'route'    // 自由路线规划（独立于行程的多点排路）
  if (path.indexOf('/api/nearby') === 0) return 'nearby'  // 周边设施推荐（公厕/民宿/停车场/充电桩）
  if (path.indexOf('/api/feedback') === 0) return 'feedback'  // 意见反馈（2026-10-05 后端契约）
  if (path.indexOf('/api/event') === 0) return 'event'
  return ''
}

// 是否走本地 mock：config.MOCK 里单独配了该模块就用它，没配则回落到全局 USE_MOCK
// 好处是后端「做了一半」时，已实现的模块连真实后端、未实现的继续用假数据，互不影响
function useMock(path) {
  const m = moduleOf(path)
  const flags = CONFIG.MOCK || {}
  if (m && Object.prototype.hasOwnProperty.call(flags, m)) return !!flags[m]
  return !!CONFIG.USE_MOCK
}

// ---------- 普通请求：401 自动重登并重试一次；GET 遇网络抖动也自动补一次 ----------
// 静默重登（401 恢复）与网络重试共用这段恢复逻辑
function recoverAuth(path, method, data, opts) {
  console.warn('[api] 登录态失效，尝试静默重登后重试')
  clearToken()
  return relogin()
    .then(() => rawRequest(path, method, data, opts))
    .catch(e => {
      // 重登成功但原请求仍 401，或重登失败 → 交给页面走手动登录
      if (isAuthError(e)) throw { code: 'AUTH_REQUIRED', message: '登录已过期，请重新登录' }
      throw e
    })
}

function request(path, method, data, opts) {
  opts = opts || {}
  if (useMock(path)) return mock.request(path, method, data)
  const isAuthPath = path.indexOf('/api/auth/') === 0   // 登录接口自身 401 不递归
  const isGet = String(method || 'GET').toUpperCase() === 'GET'   // 只重试幂等的 GET
  return rawRequest(path, method, data, opts).catch(err => {
    // 网络层失败（request:fail timeout / 连接被掐）：cpolar 免费隧道抖动时补发一次。
    // 只对 GET 做——POST 可能已落库，重发会造重复数据。
    if (isGet && err && err.code === 'NETWORK_ERROR') {
      console.warn('[api] 网络抖动，GET 自动重试一次：', path)
      return rawRequest(path, method, data, opts).catch(e2 => {
        if (isAuthPath || !isAuthError(e2)) throw e2
        return recoverAuth(path, method, data, opts)
      })
    }
    if (isAuthPath || !isAuthError(err)) throw err
    return recoverAuth(path, method, data, opts)
  })
}

// ---------- 流式生成（SSE）：POST /api/trip/generate/stream（2026-09-20 协议） ----------
// 事件：step(进度文案) · token(JSON 文本片段) · done({tripId}) · error(错误信息)
// 与普通请求的差异：不能用 statusCode 判错（流中错误以 error 事件送达），
// 鉴权失败发生在流开始前，会以普通 JSON {code:401} 返回 → 在 success 回调里兜底识别
function sseRequest(path, method, data, handlers) {
  return new Promise((resolve, reject) => {
    let finished = false
    const finish = fn => arg => { if (!finished) { finished = true; fn(arg) } }
    const ok = finish(resolve)
    const bad = finish(reject)

    // 兼容两种封装：SSE 标准的 event:/data: 行，或 data 为 {type, data} 的 JSON
    const parser = createSseParser(({ event, data: val }) => {
      let type = event
      if ((type === 'message' || !type) && val && typeof val === 'object' && val.type) {
        type = val.type
        val = val.data
      }
      try {
        if (type === 'step') { if (handlers.onStep) handlers.onStep(String(val)) }
        // search（2026-09-25 协议新增）：{ source, content } 联网搜索摘要
        else if (type === 'search') { if (handlers.onSearch) handlers.onSearch(val || {}) }
        // knowledge / agent（2026-09-25 新增）：{ source, content } 检索知识库 / Agent 调用进度
        else if (type === 'knowledge') { if (handlers.onKnowledge) handlers.onKnowledge(val || {}) }
        else if (type === 'agent') { if (handlers.onAgent) handlers.onAgent(val || {}) }
        // 兜底：后端后续新增的任意事件类型都透传到页面（onEvent），前端不认识也不丢
        else if (type !== 'token' && type !== 'done' && type !== 'error' && handlers.onEvent) { handlers.onEvent(type, val) }
        else if (type === 'token') { if (handlers.onToken) handlers.onToken(typeof val === 'string' ? val : '') }
        else if (type === 'done') ok({ tripId: val && (val.tripId != null ? val.tripId : val.id) })
        else if (type === 'error') bad({ code: 'GENERATE_ERROR', message: typeof val === 'string' ? val : '生成失败，请重试' })
      } catch (e) {
        console.warn('[stream] 事件处理异常', e)
      }
    })

    const task = Taro.request({
      url: CONFIG.BASE_URL + path,
      method: method || 'POST',
      data: data || {},
      header: baseHeader({ Accept: 'text/event-stream' }, path),
      // 必须 ≥ 后端 SseEmitter 寿命（队友已从 180s 提到 600s），否则前端先超时、 symptoms 相同
      timeout: 600000,
      enableChunked: true,           // 分块接收，配合 onChunkReceived
      responseType: 'arraybuffer',   // chunk 进字节层解析器（中文防切断）
      success: res => {
        // 兜底冲刷：协议规定「空行结束」，但连接关闭时末个事件可能只留单个换行，
        // 不补一个空行就会把 done 事件吞掉、误判成 STREAM_INCOMPLETE
        try { parser.push(new Uint8Array([0x0a, 0x0a])) } catch (e) {}
        if (finished) return
        // 流结束但没收到 done 事件：可能是鉴权失败、参数被拦（如 400 目的地仅支持中国境内城市）等以普通 JSON 返回
        if (res.statusCode !== 200) {
          // 后端 4xx/5xx 的 body 里通常带真实文案，先解析出来再兜底，别统一吞成「服务暂不可用」
          let code = 'HTTP_' + res.statusCode
          let message = ''
          try {
            const body = JSON.parse(decodeUtf8(new Uint8Array(res.data)))
            if (body && body.message) message = body.message
            if (body && body.code != null) code = body.code
          } catch (e) { /* 非 JSON 响应（如网关错误页），用兜底文案 */ }
          const err = { code, message: message || '生成服务暂不可用', statusCode: res.statusCode }
          return bad(isAuthError(err) ? { code: 'AUTH_REQUIRED', message: '登录已过期，请重新登录' } : err)
        }
        try {
          const body = JSON.parse(decodeUtf8(new Uint8Array(res.data)))
          if (body && body.code !== 0) {
            const err = { code: body.code, message: body.message || '生成失败', statusCode: res.statusCode }
            return bad(isAuthError(err) ? { code: 'AUTH_REQUIRED', message: '登录已过期，请重新登录' } : err)
          }
        } catch (e) { /* 不是 JSON（如空响应），按流中断处理 */ }
        bad({ code: 'STREAM_INCOMPLETE', message: '生成中断，请重试' })
      },
      fail: err => bad({ code: 'NETWORK_ERROR', message: '网络异常，请检查网络后重试', raw: err })
    })
    if (task && task.onChunkReceived) {
      task.onChunkReceived(res => {
        try { parser.push(res.data) } catch (e) { console.warn('[stream] chunk 解析失败', e) }
      })
      // task 本身是 thenable：流中断/网络错误时它会 reject（如 ERR_INCOMPLETE_CHUNKED_ENCODING），
      // 不接住会出现「Uncaught (in promise) network error」；真实错误已由 fail 回调统一 reject
      if (typeof task.catch === 'function') task.catch(() => {})
    } else {
      bad({ code: 'STREAM_UNSUPPORTED', message: '当前环境不支持流式接收' })
    }
  })
}

// 业务接口
const api = {
  auth: {
    // 登录：wx.login 拿到的 code 换 token（文档 2026-09-20）。code 有效期 5 分钟，须即刻使用
    // inviterId（2026-10-06 后端契约）：**新用户首次登录**时带上，后端 bindInvite 给邀请人加分；
    // 非首次登录后端不重复绑定。没有邀请人时**不传该字段**（保持 body 与原契约一致）
    login: (code, inviterId) => request('/api/auth/login', 'POST',
      inviterId ? { code, inviterId } : { code }),
    relogin
  },

  // 攻略模块（文档 2026-09-19）
  trips: {
    // ---------- 城市中心点（腾讯 LBS 地理编码 /ws/geocoder/v1，key 同 searchPlace） ----------
    // 用途：地图选点时把初始视野定在旅游城市。按城市名缓存，一次会话只查一次省配额
    cityCenter: city => {
      const key = CONFIG.LBS_KEY
      if (!key) return Promise.reject({ code: 'NO_LBS_KEY', message: '未配置地图搜索 Key（config.js 的 LBS_KEY）' })
      if (!city) return Promise.reject({ code: 'NO_CITY', message: '行程没有城市信息' })
      if (cityCenterCache[city]) return Promise.resolve(cityCenterCache[city])
      return new Promise((resolve, reject) => {
        Taro.request({
          url: 'https://apis.map.qq.com/ws/geocoder/v1/',
          method: 'GET',
          data: { address: city, key: key },
          timeout: CONFIG.TIMEOUT,
          success: res => {
            const body = res.data || {}
            if (body.status === 0 && body.result && body.result.location) {
              const c = { lat: body.result.location.lat, lng: body.result.location.lng }
              cityCenterCache[city] = c
              resolve(c)
            } else {
              reject({ code: body.status, message: body.message || '获取城市中心失败' })
            }
          },
          fail: () => reject({ code: 'NETWORK_ERROR', message: '获取城市中心失败，请检查网络' })
        })
      })
    },

    // ---------- 逆地理：坐标 → 城市名（腾讯 LBS /ws/geocoder/v1 的 location 模式，key 同 cityCenter） ----------
    // 用途：首页顶部「当前城市」行。拿到「杭州市」去「市」尾返回「杭州」；失败 reject 由页面兜底显示
    reverseCity: (lat, lng) => {
      const key = CONFIG.LBS_KEY
      if (!key) return Promise.reject({ code: 'NO_LBS_KEY', message: '未配置地图 Key' })
      const ck = `${lat},${lng}`
      if (reverseCityCache[ck]) return Promise.resolve(reverseCityCache[ck])
      return new Promise((resolve, reject) => {
        Taro.request({
          url: 'https://apis.map.qq.com/ws/geocoder/v1/',
          method: 'GET',
          data: { location: ck, key: key, get_poi: 0 },
          timeout: CONFIG.TIMEOUT,
          success: res => {
            const body = res.data || {}
            const city = body.result && body.result.ad_info && body.result.ad_info.city
            if (body.status === 0 && city) {
              const c = String(city).replace(/市$/, '')
              reverseCityCache[ck] = c
              resolve(c)
            } else {
              reject({ code: body.status, message: body.message || '定位城市识别失败' })
            }
          },
          fail: () => reject({ code: 'NETWORK_ERROR', message: '定位城市识别失败' })
        })
      })
    },

    // ---------- 地点搜索（腾讯位置服务 WebService，非后端接口，key 在 config.js 的 LBS_KEY） ----------
    // 按关键字搜 POI → [{ name, address, lat, lng }]
    // 有 city 用 region（全市范围，auto_extend 自动外扩）——添加景点应按行程城市搜，
    // 而不是按设备定位（模拟器定位必失败会落到演示坐标，5km 内搜不到异地景点）；无 city 才用 nearby 5km
    searchPlace: (keyword, opts) => {
      opts = opts || {}
      const key = CONFIG.LBS_KEY
      if (!key) return Promise.reject({ code: 'NO_LBS_KEY', message: '未配置地图搜索 Key（config.js 的 LBS_KEY）' })
      const boundary = opts.city
        ? `region(${opts.city},auto_extend=1)`
        : `nearby(${opts.lat},${opts.lng},5000)`
      return new Promise((resolve, reject) => {
        Taro.request({
          url: 'https://apis.map.qq.com/ws/place/v1/search',
          method: 'GET',
          data: {
            keyword: keyword,
            boundary: boundary,
            orderby: '_distance',
            page_size: 10,
            page_index: 1,
            key: key
          },
          timeout: CONFIG.TIMEOUT,
          success: res => {
            const body = res.data || {}
            // 腾讯 LBS 契约：status===0 成功，data 为 POI 数组（location:{lat,lng}）
            if (body.status === 0) {
              resolve((body.data || [])
                // ad_info.city 是该 POI 所属城市（如「南京市」），页面用它过滤外地结果
                .map(p => ({
                  name: p.title,
                  address: p.address || '',
                  lat: p.location && p.location.lat,
                  lng: p.location && p.location.lng,
                  city: p.ad_info && p.ad_info.city
                }))
                .filter(p => typeof p.lat === 'number' && typeof p.lng === 'number'))
            } else {
              reject({ code: body.status, message: body.message || '地点搜索失败' })
            }
          },
          fail: err => {
            // 把真实失败原因透出：域名校验被拦（url not in domain list）≠ 网络断，提示完全不同
            const msg = (err && err.errMsg) || ''
            let tip = '地点搜索失败，请检查网络'
            if (/domain|not in domain/i.test(msg)) tip = '域名被拦截：开发者工具请勾选「不校验合法域名」（真机需在 mp 后台把 apis.map.qq.com 加入 request 合法域名）'
            else if (/timeout/i.test(msg)) tip = '地点搜索超时，请重试'
            else if (msg) tip = '地点搜索失败：' + msg.slice(0, 80)   // 未知错误直接透出，便于定位
            console.warn('[api] 地点搜索失败', msg)
            reject({ code: 'NETWORK_ERROR', message: tip, raw: err })
          }
        })
      })
    },

    // 生成攻略（同步一次性返回，AI 生成耗时较长 → 超时放大到 5 分钟）
    // payload: { city, startDate?, days, peopleCount?, budget?, preferences?, energyLevel?, transportation, extraRequirements? }
    // 返回 data: { tripId, result }
    generate: payload => request('/api/trip/generate', 'POST', payload, { timeout: 300000 }),
    // 生成攻略（流式）：POST /api/trip/generate/stream → SSE 事件 step/token/done/error
    // handlers: { onStep(text), onToken(text) }；resolve({ tripId })
    // mock 模式走本地假流式；401 时静默重登后整条流重试一次（流不可中途续传，只能重开）
    generateStream: (payload, handlers) => {
      const h = handlers || {}
      if (useMock('/api/trip/generate/stream')) return mock.streamGenerate(payload, h)
      return sseRequest('/api/trip/generate/stream', 'POST', payload, h).catch(err => {
        if (!isAuthError(err)) throw err
        console.warn('[api] 流式生成登录态失效，重登后重试')
        clearToken()
        return relogin().then(() => sseRequest('/api/trip/generate/stream', 'POST', payload, h))
      })
    },
    // 行程详情：GET /api/trip/{id} → data: { id, city, ..., status, result, createdAt }
    detail: tripId => request(`/api/trip/${tripId}`, 'GET'),
    // 对话式行程重排（POST /api/trip/{id}/replan）：一句话指令局部调整，返回调整后的完整攻略对象
    // AI 生成慢，超时同 generate 放宽到 300s；400=指令为空/违规，404=行程不存在
    replan: (tripId, instruction) => request(`/api/trip/${tripId}/replan`, 'POST', { instruction }, { timeout: 300000 }),
    // 历史列表（2026-09-25 契约）：[{ id, title, isFavorite, createdAt }]
    // 2026-09-29 追加 city/days/startDate/isOwner；2026-10-08 后端已下发 memberCount（含创建者的总人数，
    //   TripSummary.memberCount = 1 + COUNT(trip_collaborator)）→ 前端据此判「≥2 人 = 协作行程」，
    //   字段齐全时**不再**补拉 GET /api/trip/{id}/collaborators（保留该兜底以兼容旧版后端）
    // favorite=true 只返回收藏的行程；mock 路由按 path 严格匹配，查询串只拼给真实后端
    list: favorite => {
      if (useMock('/api/trip/list')) {
        return request('/api/trip/list', 'GET').then(arr => {
          const all = Array.isArray(arr) ? arr : []
          return favorite ? all.filter(t => t.isFavorite) : all
        })
      }
      return request('/api/trip/list' + (favorite ? '?favorite=true' : ''), 'GET')
    },
    // 收藏 / 取消收藏（2026-09-25）：data 为 null，只看 code===0
    favoriteOn: tripId => request(`/api/trip/${tripId}/favorite`, 'POST'),
    favoriteOff: tripId => request(`/api/trip/${tripId}/favorite`, 'DELETE'),
    // 删除行程
    remove: tripId => request(`/api/trip/${tripId}`, 'DELETE'),
    // ---------- 分享（后端文档 2026-09-20） ----------
    // 生成攻略小程序码（自动开启分享）→ data: { image: base64 PNG, contentType, token }
    qrcode: tripId => request(`/api/trip/${tripId}/qrcode`, 'GET'),
    // 开启/获取分享 token → data: { token }
    shareOn: tripId => request(`/api/trip/${tripId}/share`, 'POST'),
    // 撤销分享
    shareOff: tripId => request(`/api/trip/${tripId}/share`, 'DELETE'),
    // 凭 token 公开访问（无需登录）→ data: { id, city, days, result }
    publicDetail: token => request(`/api/trip/public/${token}`, 'GET'),
    // ---------- 导出 PDF（后端文档 2026-09-25）：application/pdf 二进制流 ----------
    // downloadFile 拉流（带 token）→ resolve 临时文件路径，页面用 openDocument 打开
    // 注意：业务异常（404/500）时 statusCode 非 200，tempFilePath 里是 JSON 错误体，不能当 PDF 打开
    pdf: tripId => new Promise((resolve, reject) => {
      const path = `/api/trip/${tripId}/pdf`
      Taro.downloadFile({
        url: CONFIG.BASE_URL + path,
        header: baseHeader({}, path),
        timeout: CONFIG.TIMEOUT,
        success: res => {
          if (res.statusCode === 200 && res.tempFilePath) { resolve(res.tempFilePath); return }
          // 非 200：尝试从错误体里读 message（404 行程不存在 / 500 未找到中文字体）
          try {
            const fs = Taro.getFileSystemManager()
            const body = JSON.parse(fs.readFileSync(res.tempFilePath, 'utf8'))
            reject({ code: body.code, message: body.message || `导出失败（${res.statusCode}）` })
          } catch (e) {
            reject({ code: 'PDF_ERROR', message: `导出失败（${res.statusCode}）` })
          }
        },
        fail: err => {
          console.warn('[api] PDF 下载失败', err && err.errMsg)
          reject({ code: 'NETWORK_ERROR', message: 'PDF 下载失败，请检查网络' })
        }
      })
    }),
    // ---------- 行程编辑（后端文档 2026-09-24）：dayIndex/spotIndex 均为数组下标从 0 起 ----------
    // 添加景点（坐标由前端 wx.chooseLocation 选点获得）→ 400 天数越界 · 404 行程不存在
    spotAdd: (tripId, dayIndex, spot) => request(`/api/trip/${tripId}/spot`, 'POST', { dayIndex, spot }),
    // 编辑景点：新 spot 完整覆盖旧 spot → 400 天数/景点越界 · 404
    spotEdit: (tripId, dayIndex, spotIndex, spot) => request(`/api/trip/${tripId}/spot`, 'PUT', { dayIndex, spotIndex, spot }),
    // 删除景点 → 400 索引越界 · 404
    spotRemove: (tripId, dayIndex, spotIndex) => request(`/api/trip/${tripId}/spot`, 'DELETE', { dayIndex, spotIndex }),
    // 移动景点（同天/跨天排序）：from 是移动前位置，to 是移动后插入位置 → 400 越界 · 404
    spotMove: (tripId, fromDay, fromSpot, toDay, toSpot) => request(`/api/trip/${tripId}/spot/move`, 'PUT', { fromDay, fromSpot, toDay, toSpot }),
    // 整体覆盖 result（编辑天标题/注意事项等非景点字段，或多处改动的兜底）→ 404
    putResult: (tripId, result) => request(`/api/trip/${tripId}/result`, 'PUT', { result }),
    // ---------- 协作（后端文档 2026-09-26）----------
    // 加入协作（凭分享 token，幂等：owner/已加入跳过）→ data: { tripId }；404=分享不存在/已失效
    join: token => request('/api/trip/join', 'POST', { token }),
    // 协作成员列表（owner + 协作者，成员可见）→ data: [{ userId, nickname, avatarUrl, isOwner }]
    collaborators: tripId => request(`/api/trip/${tripId}/collaborators`, 'GET'),
    // 移除协作者（仅 owner）→ 400=不能移除创建者 · 404
    removeCollaborator: (tripId, userId) => request(`/api/trip/${tripId}/collaborator/${userId}`, 'DELETE'),
    // 退出协作（协作者自身退出，2026-09-29 文档）→ 退出后行程从列表消失、详情不可见
    // 400=创建者不能退出（应删除行程）/ 不是该行程协作者；404=行程不存在（非成员）
    exitCollaboration: tripId => request(`/api/trip/${tripId}/collaborator/me`, 'DELETE'),
    // ---------- 行李清单（后端文档 2026-09-26，成员可见）----------
    // 清单列表 → data: [{ id, tripId, name, checked, createdAt }]
    packingList: tripId => request(`/api/trip/${tripId}/packing`, 'GET'),
    // AI 按行程生成初始清单（清空重建，10-20 项）→ data 为完整清单；502=DeepSeek 失败
    packingGenerate: tripId => request(`/api/trip/${tripId}/packing/generate`, 'POST', {}, { timeout: 120000 }),
    // 新增物品（name）→ data 为添加后的完整清单
    packingAdd: (tripId, name) => request(`/api/trip/${tripId}/packing`, 'POST', { name }),
    // 修改物品（name 必传，checked 缺省 false）→ data 可能是更新后的清单
    packingUpdate: (tripId, itemId, name, checked) => request(`/api/trip/${tripId}/packing/${itemId}`, 'PUT', { name, checked }),
    // 删除物品
    packingRemove: (tripId, itemId) => request(`/api/trip/${tripId}/packing/${itemId}`, 'DELETE'),
    // 一键清除所有勾选（全部 checked=false，用于旅行结束重新查看/重新打包）→ **无 data**；
    // 前端拿到成功后自己把本地 checked 置 false，不要依赖返回值
    // 404=行程不存在（非成员）
    packingCheckReset: tripId => request(`/api/trip/${tripId}/packing/check/reset`, 'PUT'),
    // ---------- 目的地天气（后端文档 2026-09-26，和风天气，成员可见）----------
    // 当前实况 + 未来 3 天预报；查询失败时 data 仅含 city（降级不报错）
    weather: tripId => request(`/api/trip/${tripId}/weather`, 'GET'),
    // ---------- 开支记账（后端文档 2026-09-26，成员可见）----------
    // 开支列表 → data: [{ id, tripId, category, amount, note, expenseDate, createdAt }]
    expensesList: tripId => request(`/api/trip/${tripId}/expenses`, 'GET'),
    // 汇总（总金额 + 四类目小计）→ data: { total, categories: { accommodation, transport, food, misc } }
    expensesSummary: tripId => request(`/api/trip/${tripId}/expenses/summary`, 'GET'),
    // 新增一笔 → data 为添加后的完整列表；400=分类不合法/金额为负
    expenseAdd: (tripId, body) => request(`/api/trip/${tripId}/expenses`, 'POST', body),
    // 修改一笔（字段同新增）→ data 可能是更新后的列表
    expenseUpdate: (tripId, expenseId, body) => request(`/api/trip/${tripId}/expenses/${expenseId}`, 'PUT', body),
    // 删除一笔 → data 为删除后的完整列表
    expenseRemove: (tripId, expenseId) => request(`/api/trip/${tripId}/expenses/${expenseId}`, 'DELETE'),
    // ---------- 从当前位置出发重排（最近邻，腾讯步行路线距离）----------
    // → data: { dayIndex, route: [{ name, lat, lng, distance }] }；distance=距上一站步行米数（规划失败 null）；400=缺坐标/天越界
    reorderFrom: (tripId, lat, lng, dayIndex) => request(`/api/trip/${tripId}/reorder-from`, 'POST', { lat, lng, dayIndex })
  },
  // ---------- 自由路线规划（与行程无关：地图标记多点 → 最优游玩顺序 + 步行距离）----------
  route: {
    // 固定从第一个标记点出发 → data: { route: [{ name, lat, lng, distance }], totalDistance }
    //   distance：该点到上一站的腾讯步行距离（米）；route[0] 无起点段、规划失败段均为 null
    //   🔴 没有 duration / totalDuration（2026-10-06 契约确认）：前端只展示 distance，不做时长推算
    //   400=未标注景点 / 景点缺坐标
    optimize: (points) => request('/api/route/optimize', 'POST', { points })
  },
  // ---------- 图片上传（base64 → OSS 公网 URL，用于景点图片附件）----------
  upload: {
    // image 可带 data:image/...;base64, 前缀 → data: { url }；400=为空 · 500=上传失败
    image: base64 => request('/api/upload/image', 'POST', { image: base64 }, { timeout: 60000 })
  },
  // ---------- 城市热门景点（预置数据非 AI，生成前给用户勾选）----------
  attractions: {
    // city 必传 → data: [{ name, imageUrl, description }]
    popular: city => request(`/api/attractions/popular?city=${encodeURIComponent(city)}`, 'GET')
  },

  // ---------- 增长运营（后端文档 2026-09-25 · 7.7）：签到/等级/流水/邀请/兑换 ----------
  growth: {
    // 每日签到（连续 7 天额外 +10、30 天额外 +50）→ data: { points, growth, level, title, benefits, nextLevelGrowth, todayPoints, streak }
    // 400 = 今日已签到
    signIn: () => request('/api/growth/sign-in', 'POST'),
    // 积分/等级/权益汇总 → data: { points, growth, level, title, benefits, nextLevelGrowth }
    summary: () => request('/api/growth/summary', 'GET'),
    // 积分流水（最近 20 条）→ data: [{ points, type, remark, createdAt }]
    points: () => request('/api/growth/points', 'GET'),
    // 邀请统计 → data: { invitedCount, invitePoints }
    inviteInfo: () => request('/api/growth/invite-info', 'GET'),
    // 邀请小程序码接口已撤（2026-10-08 用户取消邀请码）：曾用 /api/growth/invite-qrcode
    // 成就勋章（6 系列，覆盖式）→ data: [{ id, name, progress, current, title, levels:[{count,title}] }]
    // current=已解锁最高档（0=未解锁）；levels 含未解锁档位，前端按 current 高亮
    achievements: () => request('/api/growth/achievements', 'GET'),
    // 可兑换清单 → data: [{ itemId, name, cost }]
    redeemItems: () => request('/api/growth/redeem-items', 'GET'),
    // 积分兑换 → data: { points, itemId, name, cost }；400 = 兑换项不存在 / 积分不足
    redeem: itemId => request('/api/growth/redeem', 'POST', { itemId }),
    // AI 旅行报告（日度，DeepSeek 生成 100-200 字 + 一条建议；后端当日缓存，失败降级模板文案）→ data: { report, date }
    // 首次生成可能要等大模型，超时放宽到 60s
    report: () => request('/api/growth/report', 'GET', null, { timeout: 60000 })
  },

  // ---------- 运营数据看板（仅管理员，2026-09-26）：非管理员后端返回 403 无权限 ----------
  admin: {
    // 全局统计 → data: { totalUsers, totalTrips, totalCheckIns, dau, topCities:[{ city, cnt }] }
    stats: () => request('/api/admin/stats', 'GET'),
    // 预热热门景点照片（后台异步拉 6 城 36 景点 → OSS → 缓存，演示前调一次）→ data: "预热已启动"；403=非管理员
    warmAttractions: () => request('/api/admin/warm-attractions', 'POST'),
    // 所有意见反馈（按提交时间倒序）→ data: [{ id, userId, contact, content, images, createdAt }]
    // ⚠️ images 是**逗号分隔字符串**（后端原样回 db 字段），不是数组 → 展示前自己 split(',')
    feedbacks: () => request('/api/admin/feedbacks', 'GET'),
    // 删除单条意见反馈（管理员处理完清理，2026-10-05 契约）→ data 空数组；403=非管理员 / 404=意见不存在
    removeFeedback: id => request(`/api/admin/feedbacks/${id}`, 'DELETE')
  },

  // ---------- 意见反馈（后端契约 2026-10-05）----------
  feedback: {
    // contact 邮箱 + content 意见必传；images 为**图片 URL 数组**（先用 upload.image 换成 OSS URL 再传）
    // → data: { id }；400 = 联系邮箱为空 / 意见内容为空
    submit: (contact, content, images) => request('/api/feedback', 'POST', {
      contact,
      content,
      images: (images && images.length) ? images : undefined
    }, { timeout: 60000 })   // 带图提交（图片已先传 OSS，这里只是提交 URL，放宽以防后端慢）
  },

  // ---------- 以下接口后端还没出，mock 先行保证页面可开发 ----------
  poi: {
    list: () => request('/api/poi/list', 'GET')
  },

  // ---------- 语音导游（后端文档 2026-09-21 · 7.3） ----------
  // AI 生成/百度链路慢，默认 15s 不够，统一放宽超时
  guide: {
    // 识别所在景点（定位优先、拍照兜底）：body { lat?, lng?, image? } 至少传一个
    // → data: { attraction, source: 'location' | 'image' }；400 = 两者都识别失败
    identify: payload => request('/api/guide/identify', 'POST', payload, { timeout: 60000 }),
    // 生成讲解词：body { attraction } → data: { attraction, script }
    narrate: attraction => request('/api/guide/narrate', 'POST', { attraction }, { timeout: 60000 }),
    // 语音问答（多轮）：body { sessionId?, question, attraction? }
    // attraction = identify/narrate 拿到的景点名，让后端把回答锚定在当前景点（联调纪要 9.22）
    // → data: { sessionId, answer }，后续轮次回传拿到的 sessionId
    chat: (question, sessionId, attraction) => request('/api/guide/chat', 'POST',
      { question, sessionId, attraction: attraction || undefined }, { timeout: 60000 }),
    // 搭子文字聊天（独立于通话的 REST 接口，2026-10-04 后端文档）：body { tripId, text }
    // 复用搭子人设 + 攻略记忆 + Agent 工具（查行程/记账/行李/附近/天气），纯文字返回（不 TTS）；
    // 对话历史与视频通话共用（同一 guide:call:{userId}:{tripId}）→ 不需要 sessionId，多轮由服务端记忆承接
    // → data: { answer }；业务异常：400 问题为空 · 404 行程不存在（非成员）
    chatText: (tripId, text) => request('/api/guide/chat-text', 'POST',
      { tripId, text }, { timeout: 60000 }),
    // 搭子对话历史（2026-10-06 后端契约）：GET /api/guide/chat-history?tripId=
    // → data: [{ role: 'user' | 'assistant', content }]（有序，早 → 晚），供文字聊天页进入时回显。
    // 与文字聊天 / 视频通话共用同一份 Redis（guide:call:{userId}:{tripId}，TTL 7 天）；
    // 视频通话 start 绑定行程后也会推一条 history 事件做同样的事。
    // 业务异常：404 行程不存在（非成员）——回显失败不该打扰用户，页面静默处理即可。
    chatHistory: tripId => request('/api/guide/chat-history?tripId=' + encodeURIComponent(tripId), 'GET')
  },

  // ---------- 语音模块（后端文档 2026-09-21 · 7.4） ----------
  voice: {
    // 语音转文字：body { audio: base64, format }（默认 wav，16000Hz 单声道）→ data: { text }；502 = 百度 ASR 失败
    asr: (audio, format) => request('/api/voice/asr', 'POST', { audio, format: format || 'wav' }, { timeout: 30000 }),
    // 文字转语音：body { text } → data: { audio: base64 mp3, contentType }；400 = text 为空 · 502 = 百度 TTS 失败
    tts: text => request('/api/voice/tts', 'POST', { text }, { timeout: 30000 })
  },

  // ---------- 备忘（后端已上线，2026-10-06；契约见 services/memo.js 顶部注释） ----------
  // 两套：行程备忘 = 该行程成员可读可写（协作者能互相看到）；个人备忘 = 仅创建者本人
  // 增删改一律回「最新完整列表」→ 前端省一次 GET；字段 { id, content, images, done, link, createdAt }
  // 业务码：400 内容为空/超长 · 403 非行程成员 · 404 备忘不存在
  notes: {
    // 备忘（后端 2026-10-06 上线）：增删改都返回**最新完整列表**，字段 { id, content, images[], done, link, createdAt }
    //   done 是 boolean；link = {type:'day',day} | {type:'spot',day,name} | null；createdAt 毫秒
    //   A. 行程备忘
    //      GET  = 该行程成员都能看（协作者能看到创建者写的）；
    //      POST = 成员都能写；PUT/DELETE = **只有创建者本人**（别人 → 403）
    //      业务码：400 内容空/超 300 字/图片超 9 张 ｜ 403 无权操作 ｜ 404 行程不存在（非成员）/备忘不存在
    //   B. 个人备忘（不挂行程，仅自己）
    tripList: tripId => request(`/api/trip/${tripId}/notes`, 'GET'),
    tripAdd: (tripId, body) => request(`/api/trip/${tripId}/notes`, 'POST', body),
    tripUpdate: (tripId, noteId, body) => request(`/api/trip/${tripId}/notes/${noteId}`, 'PUT', body),
    tripRemove: (tripId, noteId) => request(`/api/trip/${tripId}/notes/${noteId}`, 'DELETE'),
    // B. 个人备忘（不挂行程）
    mineList: () => request('/api/user/notes', 'GET'),
    mineAdd: body => request('/api/user/notes', 'POST', body),
    mineUpdate: (noteId, body) => request(`/api/user/notes/${noteId}`, 'PUT', body),
    mineRemove: noteId => request(`/api/user/notes/${noteId}`, 'DELETE')
  },

  // ---------- 用户资料（后端文档 2026-09-23） ----------
  user: {
    // 更新昵称/头像（部分更新，传哪个改哪个）：body { nickname?, avatar?(base64，可带 data URL 前缀) }
    // → data: { nickname, avatarUrl }；avatarUrl 是后端转存 OSS 后的地址
    profile: payload => request('/api/user/profile', 'POST', payload, { timeout: 30000 })
  },

  // ---------- 周边设施（后端文档 2026-10-02 · GET /api/nearby/facilities） ----------
  nearby: {
    // query { lat, lng }（GCJ-02，与 position.js 一致）→ data 为四类设施最近一个：
    // { 公厕, 民宿, 停车场, 充电桩 }，每项 { name, distance(米/直线), address, lat, lng } 或 null（1km 内没有）
    // 400 = lat/lng 缺失或为 0 → 调用方必须先拿到真实定位再请求，别拿兜底坐标硬查
    facilities: (lat, lng) => request('/api/nearby/facilities', 'GET', { lat, lng }, { timeout: 20000 })
  },

  event: {
    // 埋点上报：后端待补，静默失败不打扰用户
    report: events =>
      request('/api/event', 'POST', { events }).catch(err =>
        console.warn('[event] 埋点上报失败（不影响功能）', err && err.code)
      )
  }
}

export default api
