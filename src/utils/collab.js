// 协作行程判定（2026-10-08 用户口径：只要除我之外还有人，就是协作行程）
//
// 背景：
//   GET /api/trip/list 回 { id, title, isFavorite, createdAt, city, days, startDate, isOwner, memberCount }。
//   旧判定只看 isOwner === false（= 别人分享给我的），我创建+别人加入的行程被判成普通行程。
//
// 两路取数（关键：memberCount 只用来「判是不是协作」，不当显示数字）：
//   1) 列表的 memberCount（后端 = 1 + COUNT(trip_collaborator)）→ 判协作够用，但**会算重**：
//      2026-10-08 实测同一人重复计数（2 个人显示 4 个人），直接拿来显示会给用户看到错数字；
//   2) 对外显示的「协作 · N人」只用**核实过的去重人数**：对「看起来是协作」的行程调一次
//      GET /api/trip/{id}/collaborators，按 userId 去重后取长度。只有自己的行程（memberCount < 2）
//      **一次请求都不发** → 绝大多数行程零开销；结果进模块级缓存（TTL 60s）+ 限并发 4 + 单批上限 20。
//      核实到之前徽标只写「协作」不写人数 —— 宁可不显示，也不显示错的。
//   3) 核实失败（网络/权限/空列表）→ 同样不写数字，只显示「协作」。
import api from '../services/api'

const TTL = 60000        // 人数缓存有效期：进页/下拉刷新都会重新核对
const MAX_FETCH = 20     // 单次最多核实多少份，列表再长也不至于打爆后端
const CONCURRENCY = 4    // 并发上限（真机热点下别把队友后端打满）
const COLLAB_MIN = 2     // 人数阈值：≥2 人（我 + 至少一位他人）即协作

const cache = new Map()  // tripId -> { count(已去重), at }

// 成员列表去重：同一 userId 多条（后端重复行 / 子查询行放大）只算一个人
// 没有 userId 的老数据用「昵称+头像」当键兜底
export function dedupeMembers(list) {
  const arr = Array.isArray(list) ? list : []
  const seen = new Set()
  const out = []
  arr.forEach(m => {
    if (!m) return
    const key = m.userId != null
      ? 'id:' + m.userId
      : 'nk:' + (m.nickname || '') + '|' + (m.avatarUrl || '')
    if (seen.has(key)) return
    seen.add(key)
    out.push(m)
  })
  return out
}

// 列表项里直接给出的「总人数」（含创建者）；读不到返回 0。members 数组会先去重
export function serverMemberCount(t) {
  if (!t) return 0
  if (Array.isArray(t.members)) return dedupeMembers(t.members).length
  const n = t.memberCount != null ? t.memberCount : t.collaboratorCount
  return n == null ? 0 : (Number(n) || 0)
}

// 总人数（含创建者）：已核实人数（页面回填的 collabCount，最准）→ 列表字段 → 兜底 1
// isOwner === false 而字段缺失/异常时按 2 算：别人分享给我的，本来就至少两个人
export function memberCountOf(t) {
  if (!t || t.id == null) return 1
  const verified = Number(t.collabCount) || 0
  if (verified) return verified
  const sv = serverMemberCount(t)
  if (t.isOwner === false) return sv > 1 ? sv : 2
  return sv > 0 ? sv : 1
}

// 是不是协作行程：≥2 人即协作，谁创建的都算
export function isCollabTrip(t) {
  return memberCountOf(t) >= COLLAB_MIN
}

// 核实「看起来是协作」的行程的真实人数 → Map<tripId, count>
// **Map 里只放核实成功的去重人数**（不含「只有自己」的行程），调用方写回列表项 collabCount
export function fetchMemberCounts(list) {
  const arr = Array.isArray(list) ? list : []
  const now = Date.now()
  const out = new Map()
  const todo = []
  arr.forEach(t => {
    if (!t || t.id == null) return
    const c = cache.get(t.id)
    if (c && now - c.at < TTL) { out.set(t.id, c.count); return }   // 缓存新鲜，直接复用
    const sv = serverMemberCount(t)
    // 服务端明确说「只有自己」→ 不是协作，不必核实（绝大多数行程走这里，零请求）
    if (sv && sv < COLLAB_MIN && t.isOwner !== false) return
    if (todo.length < MAX_FETCH) todo.push(t.id)
  })
  if (!todo.length) return Promise.resolve(out)

  let i = 0
  const worker = () => {
    if (i >= todo.length) return Promise.resolve()
    const id = todo[i++]
    return api.trips.collaborators(id)
      .then(members => {
        const n = dedupeMembers(members).length
        if (!n) return                                 // 返回空 → 不写数字，避免瞎猜
        cache.set(id, { count: n, at: Date.now() })
        out.set(id, n)
      })
      .catch(() => {})                                 // 404/网络失败静默，徽标只显示「协作」
      .then(worker)
  }
  const runners = []
  for (let k = 0; k < Math.min(CONCURRENCY, todo.length); k++) runners.push(worker())
  return Promise.all(runners).then(() => out)
}

// 退出协作 / 删除行程 / 加入新成员后调用：清掉缓存，避免下次进页读到过期人数
export function clearCollabCache() {
  cache.clear()
}
