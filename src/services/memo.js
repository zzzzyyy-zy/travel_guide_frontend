import Taro from '@tarojs/taro'
import api from './api'

// 备忘录数据层（远端在线 + 本地缓存兜底，2026-10-06 后端 notes 接口上线后接上）
//
// 【后端契约】两套四件套（接口壳在 api.js 的 api.notes）：
//  A. 行程备忘（挂 trip，协作成员都能看 —— 创建者写的，加入协作的人在 TA 手机上也能看到）
//     GET    /api/trip/{tripId}/notes                      → data: [{ id, content, images, done, link, createdAt }]
//     POST   /api/trip/{tripId}/notes   { content, images, link }   → data: 最新完整列表
//     PUT    /api/trip/{tripId}/notes/{noteId}  { content?, images?, done?, link? } → data: 最新完整列表
//     DELETE /api/trip/{tripId}/notes/{noteId}             → data: 最新完整列表
//  B. 个人备忘（不挂 trip，仅创建者可见）
//     GET/POST /api/user/notes ；PUT/DELETE /api/user/notes/{noteId}   请求/响应同 A
//
//  字段：content 1~300 字（必填）；images = 图片 URL 数组（先走 POST /api/upload/image 换 OSS URL，最多 9 张）；
//        done = 0/1（勾选完成）；
//        link（关联，可为 null）= { type:'day', day:1 } 整天备忘 | { type:'spot', day:1, name:'外滩' } 挂在某景点下
//          day 取 days[].day（后端字段缺省时前端按下标+1 兜底）；name 取 days[].spots[].name（同名景点按名字匹配）
//  列表约定：返回全量（备忘量小，不做分页）；前端本地按「未完成在前 + createdAt 倒序」再排一次
//  权限（2026-10-06 后端契约确认）：
//    · GET  = 该行程成员都能看（这就是「协作者能看到创建者备忘」的依据）
//    · POST = 成员都能写
//    · PUT/DELETE = **只有创建者本人**能改（别人操作 → 403 无权操作）
//  业务码：400 内容为空/超 300 字/图片超 9 张 | 403 无权操作（非创建者）| 404 行程不存在（非成员）或备忘不存在
//    ⚠️ 缺口：GET 返回的 note 里**没有创建者标识**（只有 id/content/images/done/link/createdAt），
//       所以前端无法预先判断「这条能不能改」。当前策略：先放行，收到 403 再提示「只有创建者能修改」。
//
//  ⚠️ 缓存策略：storage 仍是唯一「同步读」数据源（行程时间线 / 个人中心角标要即时渲染，不能等 Promise）。
//     任何一次远端拉取成功都会把结果写回缓存；拉取失败则退回缓存（离线还能看，但看不到别人的新备忘）。
//     缓存 key：memo_trip_{tripId} / memo_mine（与旧版本地数据兼容，可直接被新列表覆盖）。
const REMOTE_READY = true

const KEY_TRIP = id => `memo_trip_${id}`
const KEY_MINE = 'memo_mine'

function keyOf(scope, tripId) {
  return scope === 'mine' ? KEY_MINE : KEY_TRIP(tripId)
}

// ---------- 本地缓存 ----------
function readList(key) {
  try {
    const v = Taro.getStorageSync(key)
    return Array.isArray(v) ? v : []
  } catch (e) {
    return []
  }
}

function writeList(key, list) {
  try { Taro.setStorageSync(key, list) } catch (e) {}
}

// ---------- 归一化：后端字段宽容处理（曾踩过：images 回逗号字符串、时间戳秒/毫秒混用） ----------
function normImages(v) {
  if (!v) return []
  if (Array.isArray(v)) return v.filter(Boolean)
  if (typeof v === 'string') return v.split(',').map(s => s.trim()).filter(Boolean)
  return []
}

function normLink(v) {
  if (!v) return null
  let o = v
  if (typeof v === 'string') {
    try { o = JSON.parse(v) } catch (e) { return null }
  }
  if (!o || typeof o !== 'object' || !o.type) return null
  const day = Number(o.day) || 0
  return o.type === 'spot' ? { type: 'spot', day, name: o.name || '' } : { type: 'day', day, name: '' }
}

function normTime(v) {
  if (v == null) return Date.now()
  if (typeof v === 'number') return v < 1e11 ? v * 1000 : v   // 秒 → 毫秒（后端有的接口回秒）
  const t = Date.parse(v)
  return isNaN(t) ? Date.now() : t
}

function normNote(n) {
  if (!n || typeof n !== 'object') return null
  const id = n.id != null ? n.id : (n.noteId != null ? n.noteId : '')
  if (id === '') return null
  return {
    id,
    content: String(n.content || ''),
    images: normImages(n.images),
    link: normLink(n.link),
    done: (n.done === true || n.done === 1 || n.done === '1') ? 1 : 0,
    createdAt: normTime(n.createdAt)
  }
}

function normList(d) {
  const arr = Array.isArray(d)
    ? d
    : (d && Array.isArray(d.list) ? d.list : (d && Array.isArray(d.notes) ? d.notes : []))
  return arr.map(normNote).filter(Boolean)
}

// 响应形状是否真的是「列表」（空的也算）——用于区分「服务端确实没数据」和「字段/结构对不上」
function isListShape(d) {
  return Array.isArray(d) || !!(d && (Array.isArray(d.list) || Array.isArray(d.notes)))
}

// 排序：未完成在前、同组按创建时间倒序（与旧版本地排序保持一致）
function sortList(list) {
  return list.slice().sort((a, b) => (a.done ? 1 : 0) - (b.done ? 1 : 0) || (b.createdAt || 0) - (a.createdAt || 0))
}

// ---------- 远端调用：scope → 对应那套接口 ----------
const REMOTE = {
  trip: {
    list: tripId => api.notes.tripList(tripId),
    add: (tripId, body) => api.notes.tripAdd(tripId, body),
    update: (tripId, noteId, body) => api.notes.tripUpdate(tripId, noteId, body),
    remove: (tripId, noteId) => api.notes.tripRemove(tripId, noteId)
  },
  mine: {
    list: () => api.notes.mineList(),
    add: (tripId, body) => api.notes.mineAdd(body),
    update: (tripId, noteId, body) => api.notes.mineUpdate(noteId, body),
    remove: (tripId, noteId) => api.notes.mineRemove(noteId)
  }
}
function apiOf(scope) {
  return scope === 'mine' ? REMOTE.mine : REMOTE.trip
}

// ---------- 旧数据一次性补传（2026-10-06）----------
// 背景：note 接口上线前，备忘全写在本地 storage。切服务端后，那些旧备忘只在这台手机上，
//      协作者（别的手机）永远看不到 → 只要「服务端为空 + 本机有旧数据 + 没补传过」，就补传一次。
// 只做一次（打 storage 标记），失败也不重试，避免每次进页面反复发请求。
const KEY_UP = key => `memo_upped_${key}`
function needUpload(key) {
  try { if (Taro.getStorageSync(KEY_UP(key))) return false } catch (e) {}
  try { Taro.setStorageSync(KEY_UP(key), 1) } catch (e) {}
  return readList(key).length > 0
}

function pushLocalUp(scope, tripId) {
  const key = keyOf(scope, tripId)
  const local = readList(key)
  const a = apiOf(scope)
  console.log(`[memo] 服务端为空、本机有 ${local.length} 条旧备忘 → 一次性补传到服务端`)
  let chain = Promise.resolve()
  local.forEach(m => {
    chain = chain.then(() => a.add(tripId, { content: m.content, images: m.images || [], link: m.link || null })
      .catch(err => console.warn('[memo] 补传失败（跳过这条）', err && (err.code || err.message))))
  })
  return chain.then(() => a.list(tripId))
    .then(d2 => {
      const list = normList(d2)
      if (list.length) writeList(key, list)
      console.log(`[memo] 补传完成，服务端现有 ${list.length} 条`)
      return list.length ? sortList(list) : sortList(local)
    })
    .catch(() => sortList(local))
}

// ---------- 读 ----------
// 同步读：只读缓存（时间线/角标用；要先调一次 refreshMemos 把远端写进缓存）
export function listMemosSync(scope, tripId) {
  return sortList(readList(keyOf(scope, tripId)))
}

// 最近一次远端拉取的失败信息（页面用它渲染常驻提示条；成功时清空）
// 为什么要它：toast 3 秒就没了，联调时协作者截图举证常常错过 → 页面顶部挂一条更好取证
let LAST_ERR = null
export function getLastMemoError() {
  return LAST_ERR
}

// 拉远端 → 写缓存 → 返回排序后的列表；失败退回缓存（不 reject，页面不会因此白屏）
export function refreshMemos(scope, tripId) {
  if (!REMOTE_READY) return Promise.resolve(listMemosSync(scope, tripId))
  if (scope === 'trip' && !tripId) return Promise.resolve([])
  return apiOf(scope).list(tripId).then(d => {
    LAST_ERR = null                      // 拉通了 → 清掉常驻错误条
    const list = normList(d)
    if (!list.length && isListShape(d) && needUpload(keyOf(scope, tripId))) {
      // 服务端确实为空、但本机还有旧版（REMOTE_READY=false 时期）存的备忘 → 一次性补传
      return pushLocalUp(scope, tripId)
    }
    writeList(keyOf(scope, tripId), list)
    // 日志带上 tripId：两手机会议时可以直接对比「是不是同一条行程」（2026-10-06 排查协作者看不到备忘）
    console.log(`[memo] ${scope}${tripId ? '#' + tripId : ''} 拉取成功 ${list.length} 条（响应形状${isListShape(d) ? '正常' : '异常，字段可能对不上'}）`, d)
    return sortList(list)
  }).catch(err => {
    const code = (err && (err.code || err.statusCode)) || '未知'
    console.warn('[memo] 远端拉取失败，退回本地缓存', code, err)
    LAST_ERR = { code, message: (err && err.message) || '' }
    // 网络断了不打扰用户；但后端明确拒绝（401/403/404/500）值得冒个泡，否则协作者只看到空列表、
    // 分不清「本来就没数据」还是「没权限/还不是成员」。404 是契约里「行程不存在（非成员）」的码，
    // 协作者看到它就说明 join 没把 TA 真正加进这条行程（或两边 tripId 不同）——2026-10-06 排查用。
    if (code !== 'NETWORK_ERROR') {
      const hint = code === 404
        ? '你还不在这个行程里，看不到它的备忘'
        : (code === 401 ? '登录已过期，请重新进入小程序' : `备忘同步失败：${code}`)
      Taro.showToast({ title: String((err && err.message) || hint).slice(0, 30), icon: 'none', duration: 3000 })
    }
    return listMemosSync(scope, tripId)
  })
}

// 把「常驻错误条」的文案交给页面：有 code 时给一句人话
export function memoErrText() {
  if (!LAST_ERR) return ''
  const { code, message } = LAST_ERR
  if (code === 404) return '你还不在这个行程里（或行程已删除），看到的可能不是最新备忘'
  if (code === 403) return '你没有权限查看这个行程的备忘'
  if (code === 401) return '登录已过期，请重新进入小程序'
  return `备忘同步失败（${code}${message ? ' ' + message : ''}），下拉可重试`
}

// 页面通用入口：远端优先，失败兜底缓存
export function listMemos(scope, tripId) {
  return refreshMemos(scope, tripId)
}

// ---------- 写（远端为准，成功后用返回的最新列表刷缓存） ----------
// 后端约定「增删改都回最新完整列表」；万一回的是 true/空对象，就退回本地增量，保证 UI 立刻正确
function cacheAfterWrite(scope, tripId, d, localPatch) {
  const key = keyOf(scope, tripId)
  const list = normList(d)
  if (list.length || (Array.isArray(d) && d.length === 0)) {
    writeList(key, list)
    return list
  }
  const merged = localPatch(readList(key))
  writeList(key, merged)
  return merged
}

export function addMemo(scope, tripId, payload) {
  const body = {
    content: String(payload.content || '').trim(),
    images: payload.images || [],
    // 关联：{ type:'day', day:1 } 整天备忘 | { type:'spot', day:1, name:'外滩' } 挂在某景点下 | null 不关联
    link: payload.link || null
  }
  return apiOf(scope).add(tripId, body).then(d => {
    cacheAfterWrite(scope, tripId, d, list => list.concat([{
      id: `tmp_${Date.now()}`,
      content: body.content,
      images: body.images,
      link: body.link,
      done: 0,
      createdAt: Date.now()
    }]))
    console.log('[memo] 已新增', scope, body.content)
    return true
  }).catch(err => {
    console.warn('[memo] 新增失败', err && (err.code || err.message), err)
    throw err
  })
}

export function updateMemo(scope, tripId, id, patch) {
  const body = {}
  if (patch.content != null) body.content = String(patch.content).trim()
  if (patch.images != null) body.images = patch.images
  if (patch.link !== undefined) body.link = patch.link
  // 🔴 契约里 done 是 boolean（缓存内部用 0/1 方便模板判断）→ 上行必须转真布尔
  if (patch.done != null) body.done = !!patch.done
  return apiOf(scope).update(tripId, id, body).then(d => {
    cacheAfterWrite(scope, tripId, d, list => list.map(m => (m.id === id ? Object.assign({}, m, patch) : m)))
    console.log('[memo] 已更新', scope, id)
    return true
  }).catch(err => {
    console.warn('[memo] 更新失败', err && (err.code || err.message), err)
    throw err
  })
}

export function removeMemo(scope, tripId, id) {
  return apiOf(scope).remove(tripId, id).then(d => {
    cacheAfterWrite(scope, tripId, d, list => list.filter(m => m.id !== id))
    console.log('[memo] 已删除', scope, id)
    return true
  }).catch(err => {
    console.warn('[memo] 删除失败', err && (err.code || err.message), err)
    throw err
  })
}

// 勾选完成：后端支持局部更新（只传 done，且必须传真布尔）
export function toggleMemoDone(scope, tripId, id) {
  const cur = readList(keyOf(scope, tripId)).find(m => m.id === id)
  const next = cur ? (cur.done ? 0 : 1) : 1
  return apiOf(scope).update(tripId, id, { done: !!next }).then(d => {
    cacheAfterWrite(scope, tripId, d, list => list.map(m => (m.id === id ? Object.assign({}, m, { done: next }) : m)))
    return next
  }).catch(err => {
    console.warn('[memo] 勾选失败', err && (err.code || err.message), err)
    throw err
  })
}

// 工具条/个人中心的条数角标：同步读缓存，不发请求（进页面时会先 refresh 一次）
export function countMemos(scope, tripId) {
  return readList(keyOf(scope, tripId)).length
}

export { REMOTE_READY }
