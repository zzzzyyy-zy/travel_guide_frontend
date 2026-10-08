// 微信分享统一封装（2026-10-02）
//
// ⚠️ 最重要的一条（踩过的坑）：Taro 的 useShareAppMessage / useShareTimeline 只是把回调
//   塞进「页面实例的 $options」，而 @tarojs/runtime 只有在下面任一条件成立时，才会把
//   onShareAppMessage 注册到小程序页面对象上：
//     component.onShareAppMessage || component.enableShareAppMessage || pageConfig.enableShareAppMessage
//   页面是用 hook 写的，component 上什么都没有 —— 所以**页面 config 必须写
//   `enableShareAppMessage: true`（朋友圈再加 enableShareTimeline: true）**，
//   否则 hook 是死代码：右上角菜单里连「转发」都不出现，点了也没反应。
//   历史遗留：itinerary 早就写了 useShareAppMessage，但 config 没开开关 → 一直没生效。
//
// 另一个约束：分享到朋友圈（onShareTimeline）只能返回 { title, query, imageUrl }，**没有 path**，
//   接收方打开的永远是「当前页面 + query」。所以需要 tripId / token 才能渲染的页面
//   （如 pages/itinerary）只开转发、不开朋友圈；朋友圈放在本身就靠 query 活着的
//   pages/share（只读分享页）上。
import Taro, { useShareAppMessage, useShareTimeline } from '@tarojs/taro'
import { onMounted } from 'vue'
import { cityPhoto } from '../data/cityImages'
import { getUser, getUserId } from './token'

const TITLE_MAX = 30   // 卡片标题过长会被截断，统一在源头收口
const DEFAULT_TITLE = '智慧文旅 · 一句话生成专属旅行攻略'
const HOME_PATH = '/pages/home/home'

// ---------- 邀请关系（2026-10-06 后端契约）：所有分享出去的链接都带上分享人的 inviterId ----------
// 好友点开 → 进入参数被 utils/invite.js 接住存本地 → 新用户首次登录时随 /api/auth/login 提交，
// 后端 bindInvite 给分享人加分。没登录（拿不到自己的 userId）时原样返回，不加参数。
// 统一在这里追加 → 各页面 useShare 的回调不用各自操心（转发 path 与朋友圈 query 都覆盖）。
function myInviterParam() {
  // 先从 user 对象取，取不到再回退登录时单独落的 userId 键（saveToken 2026-10-06 起都会落一份）
  const u = getUser()
  const id = (u && (u.id || u.userId)) || getUserId()
  if (!id) {
    console.warn('[share] 本地取不到本人 userId，本次转发不带 inviterId（登录后分享才会带）')
    return ''
  }
  return 'inviterId=' + encodeURIComponent(id)
}
function withInviterPath(path) {
  const p = String(path || HOME_PATH)
  const q = myInviterParam()
  if (!q) return p
  return p + (p.indexOf('?') >= 0 ? '&' : '?') + q
}
function withInviterQuery(query) {
  const s = String(query || '').replace(/^\?/, '')
  const q = myInviterParam()
  if (!q) return s
  return s ? s + '&' + q : q
}

// 5:4 分享封面：优先该城市的真实风景照（本地代码包图片，微信支持）；
// 没有对应城市时返回 '' → 交给微信用「当前页面截图」当封面（一般比空白默认图好看）
export function coverOf(city) {
  return (city && cityPhoto(city)) || ''
}

// 标题清洗 + 兜底 + 截断（分享入口多，统一在这里收口）
export function shareTitle(raw, fallback = DEFAULT_TITLE) {
  const t = String(raw || '').replace(/\s+/g, ' ').trim()
  if (!t) return fallback
  return t.length > TITLE_MAX ? t.slice(0, TITLE_MAX - 1) + '…' : t
}

// 「转发给好友」参数：path 可自定义 → 带 id / token 进只读分享页
// path 自动追加 inviterId（见上）：好友点卡片进来即携带邀请人身份
export function forwardPayload({ title, path = HOME_PATH, city, imageUrl } = {}) {
  return {
    title: shareTitle(title),
    path: withInviterPath(path),
    imageUrl: imageUrl || coverOf(city) || undefined
  }
}

// 「分享到朋友圈」参数：没有 path，只有 query（附加在当前页面路径后）
// query 同样自动追加 inviterId
export function timelinePayload({ title, query = '', city, imageUrl } = {}) {
  return {
    title: shareTitle(title),
    query: withInviterQuery(query),
    imageUrl: imageUrl || coverOf(city) || undefined
  }
}

// 打开右上角菜单里的「转发 / 分享到朋友圈」
// menus 是旧字段、showShareItems 是新字段（基础库 2.11.3+ 改名），两个都传以兼容各版本客户端
// withTimeline=false 时只申请「转发」：**申请了但没定义 onShareTimeline 的菜单项会被系统忽略，
// 更糟的是有些客户端会把它显示出来、点进去用默认行为（当前页面）分享** —— 所以按页面能力精确申请
export function openShareMenu(withTimeline = true) {
  const items = withTimeline ? ['shareAppMessage', 'shareTimeline'] : ['shareAppMessage']
  try {
    const p = Taro.showShareMenu({
      withShareTicket: true,
      menus: items,
      showShareItems: items
    })
    if (p && p.catch) p.catch(() => {})   // 个别客户端不支持 → 静默，不影响页面
  } catch (e) {
    // H5 / 非微信端没有该 API：忽略
  }
}

// 页面一次性接入分享：注册「转发给好友」（可选「分享到朋友圈」）并在挂载时打开菜单项
//
// opts.timeline：是否启用朋友圈。**必须与页面 config 的 enableShareTimeline 一致**：
//   本函数只在 timeline=true 时注册 onShareTimeline（Taro 侧只在 config 开着时才把它
//   挂到页面对象上），菜单里才不会出现一个点进去是「空白当前页」的朋友圈入口。
//
// getOptions(ctx) 每次分享时调用（拿得到最新数据），可返回三种东西：
//   1) 普通参数对象      → { title, path, query, city, imageUrl }
//   2) { pending, promise } → 异步场景（如「转发时才去开通只读分享拿 token」）：
//      pending 是 3 秒内的兜底参数，promise resolve 后用真实参数覆盖（微信官方支持）
//   3) null / undefined  → 全部走默认参数
export function useShare(getOptions, opts = {}) {
  const withTimeline = !!opts.timeline
  const pick = ctx => {
    let o
    try {
      o = getOptions ? getOptions(ctx) : null
    } catch (e) {
      console.warn('[share] 取分享参数异常，已回退默认参数：', (e && e.message) || e)
      o = null
    }
    return o || {}
  }

  useShareAppMessage(res => {
    const o = pick({ from: (res && res.from) || 'menu', target: (res && res.target) || null })
    // 异步分支：先给兜底，promise 3 秒内 resolve 就用真实参数（Taro 的 promise 字段是 weapp 专有）
    if (o.promise && typeof o.promise.then === 'function') {
      return {
        ...forwardPayload(o.pending || {}),
        promise: Promise.resolve(o.promise).then(p => forwardPayload(p || {}))
      }
    }
    const payload = forwardPayload(o)
    console.log('[share] 转发参数：', { title: payload.title, path: payload.path, hasImg: !!payload.imageUrl })
    return payload
  })

  // 静态条件（同一页面固定不变），不会出现「有时注册有时不注册」的半吊子状态
  if (withTimeline) {
    useShareTimeline(() => {
      const o = pick({ from: 'timeline' })
      const payload = timelinePayload(o)
      console.log('[share] 朋友圈参数：', { title: payload.title, query: payload.query, hasImg: !!payload.imageUrl })
      return payload
    })
  }

  onMounted(() => openShareMenu(withTimeline))
}

export default { coverOf, shareTitle, forwardPayload, timelinePayload, openShareMenu, useShare }
