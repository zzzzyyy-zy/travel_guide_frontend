// 登录工具：微信一键授权的底层实现
// 流程（对齐后端登录接口文档 2026-09-20）：
//   1. Taro.login() 拿临时 code（5 分钟有效，拿到即刻使用）
//   2. POST /api/auth/login（公开接口）用 code 换 token + user
//   3. token 存本地 storage，后续请求由 services/api.js 统一带 Authorization: Bearer <token>
// 失败语义：401 = code 无效或过期（重新 Taro.login 拿新 code 一般就能成功）
//          502 = 后端调微信接口失败（服务端问题，重试未必有用）
// token 过期后业务接口返回 code 401，api 层已内置静默重登一次；重登失败才要求用户手动登录
import { reactive } from 'vue'
import Taro from '@tarojs/taro'
import api from '../services/api'
import { saveToken, clearToken, getToken, getTokenExpiresAt, getUser, syncSession, sessionState } from './token'
import { pendingInviter, clearInviter } from './invite'
import { tabStore, setTabBarHidden } from './tabbar'

// 页面统一从 auth 引登录态（sessionState 为响应式，登录/退出后自动更新）
export { sessionState }

// ---------- 全局授权弹层状态（所有页面共用同一份） ----------
export const authState = reactive({
  visible: false,     // 弹层是否显示
  pending: null,      // 登录成功后要继续执行的操作（requireLogin 传入）
  tip: '',            // 自定义副文案（不传则用默认两句）
  skippable: true     // 是否给「暂不登录」出口（分享落地页那种「先弹登录」可关掉）
})

// 功能级登录拦截：需要登录态才能继续的操作，先弹授权框，登录成功后自动继续 onOk
// opts.tip 自定义副文案；opts.skippable=false 时不给「暂不登录」出口（强制登录）
// 2026-10-08：**资料不全也走弹层**——新用户的登录流程是「点登录 → 完善头像昵称」两步，
// 只判 token 会让资料不全的用户直接放行（绕过完善步骤），或反过来一进来就甩完善卡、
// 用户压根没见到登录界面。所以这里把「资料不全」等同于「登录流程没走完」：统一先弹登录界面。
// 弹层期间「自定义 tabBar」的隐藏状态（弹层关闭后原样恢复）
let tabHiddenBefore = false

export function requireLogin(onOk, opts) {
  if (isLoggedIn() && isProfileComplete()) { onOk && onOk(); return }
  const o = opts || {}
  authState.pending = onOk || null
  authState.tip = o.tip || ''
  authState.skippable = o.skippable !== false
  // custom-tab-bar 挂在页面 root 之外、自己的层叠上下文里（跨容器比 z-index 不可靠）→
  // 弹层期间直接不渲染它，否则 tab 页上会盖住蒙层底部与弹卡
  if (!authState.visible) tabHiddenBefore = tabStore.hidden
  setTabBarHidden(true)
  authState.visible = true
}

function resetAuthState() {
  authState.visible = false
  authState.pending = null
  authState.tip = ''
  authState.skippable = true
  setTabBarHidden(tabHiddenBefore)
}

// 登录成功：资料齐全 → 关弹层并继续刚才被拦截的操作；
// 资料不全（缺昵称/头像）→ 先去「完善微信资料」（登录页 setupMode），完成后再回原页面。
// 这是所有 AuthMask 登录的唯一出口（AuthMask.doLogin 调它），所以闸门加在这里 =
// 全项目 10 处 requireLogin 调用点一次性覆盖，不用逐个改。口径与登录页 afterAuthCheck 一致。
export function finishLogin() {
  const cb = authState.pending
  resetAuthState()
  if (!isProfileComplete()) {
    setupReturn = captureSetupReturn()
    console.log('[auth] 登录成功但资料不全，先去完善资料', setupReturn)
    // 待执行的 cb 主动丢弃：它闭包着原页面实例状态，reLaunch 后那个实例已销毁，回调会打到空气上
    // setup=1：告诉登录页「这是刚登录完被送来的」→ 直接进完善卡（用户已在弹层点过登录，
    // 登录界面这步已经走过，不能再让他在登录页重复点一次）
    Taro.reLaunch({ url: '/pages/login/login?setup=1' })
    return
  }
  cb && cb()
}

// 资料是否齐全（昵称 + 头像都要有）；后端 user 为空也判为不全
export function isProfileComplete() {
  const u = sessionState.user
  return !!(u && u.nickname && u.avatarUrl)
}

// 完善资料后要回到的页面（完整 url 含参数），由 finishLogin 记录、登录页保存后取走
let setupReturn = ''

function captureSetupReturn() {
  try {
    const pages = Taro.getCurrentPages()
    const cur = pages && pages[pages.length - 1]
    if (!cur || !cur.route) return ''
    const path = String(cur.route).replace(/^\//, '')
    if (path === 'pages/login/login') return ''   // 本来就在登录页，无需回
    const opts = cur.options || {}
    const qs = Object.keys(opts)
      .filter(k => opts[k] !== undefined && opts[k] !== null)
      .map(k => k + '=' + encodeURIComponent(String(opts[k])))
      .join('&')
    return '/' + path + (qs ? '?' + qs : '')
  } catch (e) {
    return ''
  }
}

// 登录页保存资料成功后调用：取走「该回哪」。空串 = 没有待返回页面，调用方走首页兜底。
// reLaunch 可打开 tabBar 页（navigateTo/redirectTo 不行），所以这里统一用 reLaunch。
export function takeSetupReturn() {
  const p = setupReturn
  setupReturn = ''
  return p
}

// 用户点「暂不登录」：关弹层，丢弃待执行操作
export function cancelLogin() {
  resetAuthState()
}

// ---------- 页面级登录闸门（首页等 tab 页用） ----------
// 与 requireLogin 的分工：requireLogin 是「点某个功能才拦」（弹层、可跳过）；
// 本函数是「进这个页面就得有登录态」（整页跳登录页）。典型场景：好友把分享链接
// 直接指向 /pages/home/home?inviterId=xxx，未注册用户进来必须先登录 → 首次登录
// 才带得上 inviterId，后端才绑得成邀请关系。
// 返回 true = 已登录、继续；false = 已发起跳转，调用方立刻 return（别再发业务请求）
let redirectingToLogin = false
export function guardPageLogin(url) {
  if (isTokenValid()) return true
  if (redirectingToLogin) return false
  redirectingToLogin = true
  console.log('[auth] 无有效登录态，回登录页')
  const done = () => { setTimeout(() => { redirectingToLogin = false }, 1200) }
  Taro.reLaunch({ url: url || '/pages/login/login' }).then(done).catch(done)
  return false
}

export function isLoggedIn() {
  return !!getToken()
}

export function currentUser() {
  return getUser()
}

// 静默登录：Taro.login 换 code → 后端换 token → 落地本地
// 带 inviterId（2026-10-06 后端契约）：进入时从「小程序码 scene / 转发 path / 朋友圈 query」采集并存本地，
// 首次登录时随请求提交（后端 bindInvite 给邀请人加分）；提交成功后立刻清掉，避免后续重登重复携带。
export function silentLogin() {
  return new Promise((resolve, reject) => {
    Taro.login({
      success: res => {
        if (!res.code) return reject({ code: 'WX_LOGIN_FAIL', message: '微信登录未返回 code' })
        const inviterId = pendingInviter()
        api.auth.login(res.code, inviterId).then(data => {
          try {
            saveToken(data)
          } catch (e) {
            return reject({ code: 'AUTH_NO_TOKEN', message: e.message })
          }
          if (inviterId) clearInviter()   // 只有真的带上去了才清（避免请求失败时把邀请关系丢了）
          resolve(data)
        }).catch(reject)
      },
      fail: err => reject({ code: 'WX_LOGIN_FAIL', message: '微信登录失败，请重试', raw: err })
    })
  })
}

// token 是否仍在有效期内
export function isTokenValid() {
  return isLoggedIn() && getTokenExpiresAt() > Date.now()
}

// 退出登录 / token 失效：清本地登录态（token + user 一起清，并同步响应式镜像）
export function logout() {
  clearToken()
}

// 重新从本地读取登录态到响应式镜像（页面 useDidShow 里调一次即可）
export function refreshSession() {
  return syncSession()
}

// 兜底用：有 token 直接过，没有就静默登录；失败不阻塞主流程（游客模式）
export function ensureLogin() {
  if (isLoggedIn()) return Promise.resolve(currentUser())
  return silentLogin().catch(err => {
    console.warn('[auth] 静默登录失败，进入游客模式', err)
    return null
  })
}
