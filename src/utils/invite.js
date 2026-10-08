// 邀请人（inviterId）采集与传递（2026-10-06 后端契约）
//
// 后端：新用户**首次登录**时，/api/auth/login 请求体带 inviterId（邀请人的 userId），
//       后端 bindInvite 给邀请人加分。非首次登录后端不重复绑定。
//
// 三种载体都要能带过来（前端只负责「接住」，具体参数由载体写在进入链接/码里）：
//   ① 小程序码：getUnlimitedQRCode 的 scene 参数 —— 形如 "inviterId=123"（可能被 URL 编码）
//   ② 好友转发：path = '/pages/xxx?inviterId=123'（utils/share.js 已自动追加）
//   ③ 朋友圈：没有 path，只能加 query = 'inviterId=123'（同上自动追加）
//
// 前端三步：进入时存(storage) → 首次登录随 body 带上 → 登录成功后清掉。
// 🔴 已登录用户点别人的邀请链接不该被记（后端只认首次登录，本地也没必要留脏数据）。
import Taro from '@tarojs/taro'
import { getToken } from './token'

const KEY = 'inviterId'

// 从进入参数里解析邀请人 ID。⚠️ 两种参数形状都要吃（踩过）：
//   ① App 级生命周期 onLaunch/onShow(options) / getLaunchOptionsSync()：query 是**对象**
//      → 邀请人在 options.query.inviterId；小程序码的 scene 串在 options.query.scene；
//      顶层的 options.scene 是**数字场景值**（1011/1047 那种），不是 scene 参数，别拿它当串用。
//   ② Page 级 onLoad(options)：参数是**平铺**的（options.inviterId / options.scene）。
// scene 本身是「一个字符串」不是 query 对象，微信还会 URL 编码 → 先 decode 再按 k=v 抓。
export function parseInviter(options) {
  if (!options) return ''
  const q = (options.query && typeof options.query === 'object') ? options.query : {}
  let v = options.inviterId || q.inviterId || ''
  if (!v) {
    // 只在「是字符串」时才当 scene 参数用（数字 = 场景值，跳过）
    const raw = (typeof options.scene === 'string' && options.scene) || q.scene || ''
    if (raw) {
      let scene = ''
      try { scene = decodeURIComponent(String(raw)) } catch (e) { scene = String(raw) }
      scene = scene.trim()
      const m = /(?:^|&|\?)inviterId=([^&]+)/.exec(scene)
      if (m) v = m[1]
      // 兜底：整串就是纯数字 → 直接当邀请人 ID（后端若把 scene 生成成 "123" 这种短码也能吃）
      else if (/^\d{1,20}$/.test(scene)) v = scene
    }
  }
  if (!v) return ''
  try { v = decodeURIComponent(String(v)) } catch (e) { v = String(v) }
  return String(v).trim()
}

// 入口捕获：命中就存。后到的覆盖先到的（用户最后点开的那张邀请链接＝他的来源）。
// ⚠️ 不在这里判断「是否新用户」—— 那要后端说了算；这里只保证「带到了」。
export function captureInviter(options) {
  const id = parseInviter(options)
  if (!id) return ''
  if (getToken()) {
    console.log('[invite] 已登录，忽略本次邀请参数 inviterId =', id)
    return ''
  }
  Taro.setStorageSync(KEY, id)
  console.log('[invite] 记下邀请人 inviterId =', id, '（首次登录时随 /api/auth/login 带上）')
  return id
}

// 待绑定的邀请人（登录时用）。可能为空字符串（正常：从首页直接进来的用户没有邀请人）
export function pendingInviter() {
  return Taro.getStorageSync(KEY) || ''
}

// 登录成功后清掉：邀请关系只绑一次，之后的静默重登 / 换号登录不该再带
export function clearInviter() {
  const had = Taro.getStorageSync(KEY)
  Taro.removeStorageSync(KEY)
  if (had) console.log('[invite] 已随本次登录提交，清掉本地 inviterId')
}

// 系统入口兜底：App 生命周期不一定被调到（Taro Vue3 下 createApp 的 App options 支持度看端），
// 这里直接读一次启动参数与本次进入参数，双保险。
export function captureInviterFromSystem() {
  let opts = null
  try { opts = Taro.getLaunchOptionsSync && Taro.getLaunchOptionsSync() } catch (e) {}
  // 诊断日志（2026-10-06 排查「登录没带 inviterId」加的）：启动时把进入参数打出来，
  // 一眼能看出「分享卡片的 path 里到底有没有 inviterId」——没有就查分享端，有就查采集端。
  if (opts) console.log('[invite] 启动参数：path =', opts.path, 'query =', JSON.stringify(opts.query || {}))
  let id = ''
  try { id = captureInviter(opts) } catch (e) {}
  if (id) return id
  try { id = captureInviter(Taro.getEnterOptionsSync && Taro.getEnterOptionsSync()) } catch (e) {}
  return id
}
