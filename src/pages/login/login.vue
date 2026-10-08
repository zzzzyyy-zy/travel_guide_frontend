<template>
  <view class="lg-page">
    <!-- 上半区：品牌 + 问候（简约风：无插画、无卡片、无渐变，全靠留白） -->
    <view class="lg-top">
      <view class="lg-brand">
        <view class="lg-logo"><image class="lg-logo-ico" :src="ICO.pin" mode="aspectFit" /></view>
        <text class="lg-brand-name">旅行攻略</text>
      </view>

      <view class="lg-hello">
        <text class="lg-hello-txt">{{ setupMode ? '完善微信资料' : '你好，旅行家' }}</text>
        <text class="lg-slogan">{{ setupMode ? '头像和昵称仅用于行程协作展示' : '规划路线 · 管好开销 · 边走边讲' }}</text>
      </view>
    </view>

    <!-- 登录态：一键登录 + 协议（协议勾选是小程序合规必需，保留） -->
    <view class="lg-bottom" v-if="!setupMode">
      <view class="lg-btn-wx" :class="{ disabled: submitting }" @tap="wxLogin">
        <image v-if="ICO.wechat" class="lgw-ico" :src="ICO.wechat" mode="aspectFit" />
        <text>{{ submitting ? '登录中…' : '微信一键登录' }}</text>
      </view>

      <view class="lg-agree" @tap="agreed = !agreed">
        <view class="agree-box" :class="{ on: agreed }">
          <image v-if="agreed" class="agree-ico" :src="ICO.check" mode="aspectFit" />
        </view>
        <text class="agree-txt">已阅读并同意</text>
        <text class="agree-link" @tap.stop="showAgreement('user')">《用户协议》</text>
        <text class="agree-link" @tap.stop="showAgreement('privacy')">《隐私政策》</text>
      </view>
    </view>

    <!-- 资料完善态：内联头像昵称（官方能力，无法静默授权）；同样去卡片化 -->
    <!-- 用独立 v-if 而非 v-else：中间隔着注释，weapp 模板编译里 v-else 的相邻要求容易被打断 -->
    <view class="lg-bottom" v-if="setupMode">
      <view class="st-row">
        <!-- open-type=chooseAvatar：弹微信头像选择，用户确认后回调本地临时文件。
             视觉容器用 view、button 只做透明覆盖层 —— 真机实测 button 自带默认样式会压过
             页面类样式（profile 的 share-cover 同款坑）：直接给 button 套圆头像样式，
             高度不生效 → image height:100% 塌陷 → aspectFill 横向裁切 → 头像扁椭圆（2026-10-08 真机实锤） -->
        <view class="st-avatar-wrap">
          <view class="st-avatar-btn">
            <image v-if="avatarDraft" class="st-avatar-img" :src="avatarDraft" mode="aspectFill" />
            <view v-else class="st-avatar-ph">
              <image class="st-avatar-ico" :src="ICO.camera" mode="aspectFit" />
              <text class="st-avatar-txt">选择头像</text>
            </view>
          </view>
          <button class="st-avatar-cover" open-type="chooseAvatar" @chooseavatar="onWxAvatar"></button>
        </view>
        <!-- type=nickname：键盘上方会出现「微信昵称」快捷填入条 -->
        <input class="st-name" v-model="nameDraft" type="nickname" placeholder="获取微信昵称" maxlength="20" />
      </view>
      <view class="st-btn main" :class="{ disabled: saving }" @tap="saveAndEnter">{{ saving ? '保存中…' : '保存并进入' }}</view>
    </view>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import Taro, { useLoad } from '@tarojs/taro'
import { silentLogin, isLoggedIn, isTokenValid, isProfileComplete, sessionState, takeSetupReturn } from '../../utils/auth'
import { saveUser } from '../../utils/token'
import api from '../../services/api'

import pinWhite from '../../assets/icons/map-pin-white.png'
import checkW from '../../assets/icons/check-white.png'
import cameraGr from '../../assets/icons/camera-green.png'
// wechat 图标由 gen-icons.js 生成（sharp 环境缺失时 ICO.wechat 为空串，按钮自动退化为纯文字）
import wechatW from '../../assets/icons/wechat-white.png'

// 卖点芯片已随「简约风」改版移除，wand/luggage/mic 三个图标不再引入（省得白进产物）
const ICO = { pin: pinWhite, check: checkW, camera: cameraGr, wechat: wechatW }

const submitting = ref(false)

// ---------- 协议勾选（仅拦「主动点按钮登录」；静默重登是 token 续期，不算新授权） ----------
const agreed = ref(false)
const AGREEMENT = {
  user: {
    title: '用户协议（摘要）',
    content: '本小程序提供 AI 行程规划、协作编辑、记账、备忘与语音讲解等服务。使用即表示同意按页面指引操作并对自己的行程数据负责。完整文本由团队另行提供。'
  },
  privacy: {
    title: '隐私政策（摘要）',
    content: '仅在提供服务必需范围内收集：微信昵称与头像（协作展示）、行程/记账/备忘内容、模糊位置（附近推荐）。数据仅用于本应用功能，不对外共享；你可随时删除行程或退出登录。'
  }
}
function showAgreement(key) {
  const a = AGREEMENT[key]
  Taro.showModal({ title: a.title, content: a.content, showCancel: false, confirmText: '我知道了' })
}

// ---------- 资料完善（登录成功后、进首页前的强制引导卡） ----------
// 微信已废弃 getUserProfile（只返回匿名数据），唯一合规途径是「头像昵称填写能力」：
// open-type=chooseAvatar + type=nickname，用户各点一下即可带入真实头像昵称
const setupMode = ref(false)
const saving = ref(false)
const nameDraft = ref('')
const avatarDraft = ref('')   // chooseAvatar 回调的本地临时文件，保存时转 base64 上传

// 登录态检查：资料齐全 → 直接进首页；缺昵称或头像 → 停在本页弹完善卡（口径同 isProfileComplete）
function afterAuthCheck() {
  const u = sessionState.user
  if (isProfileComplete()) {
    enterHome()
  } else {
    nameDraft.value = (u && u.nickname) || ''   // 已有昵称先带入（现在两项都必填，缺头像的用户不必重打昵称）
    setupMode.value = true
  }
}

// 保存完成后进首页；若本次是「在别的页面被全局闸门弹登录 → 来完善资料」，
// 则回到那个页面（takeSetupReturn 由 utils/auth.js 的 finishLogin 记录）。
// reLaunch 能打开 tabBar 页（navigateTo/redirectTo 不能），所以统一用 reLaunch。
function enterHome() {
  const back = takeSetupReturn()
  if (back && back !== '/pages/home/home') {
    Taro.reLaunch({ url: back })
    return
  }
  Taro.reLaunch({ url: '/pages/home/home' })
}

function onWxAvatar(e) {
  const url = e && e.detail && e.detail.avatarUrl
  if (url) avatarDraft.value = url
}

// 把 /api/user/profile 的返回合并进本地登录态（部分更新：非空字段才覆盖）
function applyProfile(d) {
  const u = { ...(sessionState.user || {}) }
  if (d && d.nickname) u.nickname = d.nickname
  if (d && d.avatarUrl) u.avatarUrl = d.avatarUrl
  saveUser(u)
}

// 保存头像/昵称后进首页（2026-10-01 用户要求：删掉「跳过」，必须完善资料才能进入）
// 校验收紧为两项都必填；保存失败也留在本页（弹窗只给「重试」，不再提供进入出口）
function saveAndEnter() {
  if (saving.value) return
  const nickname = (nameDraft.value || '').trim()
  if (!avatarDraft.value || !nickname) {
    Taro.showToast({ title: '请选择头像并填写昵称', icon: 'none' })
    return
  }
  saving.value = true
  Taro.showLoading({ title: '保存中…', mask: true })
  const sendNickname = () => api.user.profile({ nickname })
  const sendAvatar = () => {
    // chooseAvatar 给的是本地临时文件 → base64 → 走同一个 profile 接口
    return new Promise((resolve, reject) => {
      Taro.getFileSystemManager().readFile({
        filePath: avatarDraft.value,
        encoding: 'base64',
        success: r => api.user.profile({ avatar: r.data }).then(resolve).catch(reject),
        fail: () => reject({ message: '头像文件读取失败' })
      })
    })
  }
  Promise.all([sendNickname(), sendAvatar()])
    .then(([nd, ad]) => {
      applyProfile(nd)
      applyProfile(ad)
      // 后端若不回显这两个字段（有的实现只回 code:0），本地会一直判定「资料不全」→
      // 首页闸门再把人弹回来 = 死循环。这里用用户刚输入的值补齐本地登录态兜底。
      const u = { ...(sessionState.user || {}) }
      if (!u.nickname) u.nickname = nickname
      if (!u.avatarUrl) u.avatarUrl = avatarDraft.value
      saveUser(u)
      enterHome()
    })
    .catch(e => {
      saving.value = false
      // 保存失败不放行（否则「必须保存」形同虚设）：提示后留在本页重试
      // 注意：hideLoading 只由下面的 .finally 调一次 —— 这里再调一次会触发
      // 微信「showLoading 与 hideLoading 必须配对使用」告警，还会把 showModal 顶掉
      Taro.showModal({
        title: '资料保存失败',
        content: (e && e.message) || '网络异常，请重试',
        showCancel: false,
        confirmText: '重试'
      })
    })
    .finally(() => Taro.hideLoading())
}

// 是否由闸门送来（登录弹层里刚点过登录 → 全局 finishLogin 带 setup=1 跳过来）：
// 这种时候不能再让用户看一遍登录界面（登录那步已经点过了），直接判资料进不去
function fromGate() {
  try {
    const inst = Taro.getCurrentInstance && Taro.getCurrentInstance()
    const q = (inst && inst.router && inst.router.params) || {}
    return String(q.setup || '') === '1'
  } catch (e) { return false }
}

// 启动判断（顺序按 2026-10-08 用户要求：先登录 → 再完善资料）
// ① 闸门送来 → 直接判资料：齐进首页，不齐进完善卡
// ② 冷启动 token 有效：资料齐 → 直接进首页；资料不齐 → **停在登录界面**，等用户点一次登录
// ③ 有 token 但过期 → 静默重登；资料齐进首页，不齐同样停在登录界面
useLoad(() => {
  if (fromGate()) {
    afterAuthCheck()
    return
  }
  if (isTokenValid()) {
    if (isProfileComplete()) enterHome()
    return
  }
  if (isLoggedIn()) {
    Taro.showLoading({ title: '登录中…', mask: true })
    silentLogin()
      .then(() => { if (isProfileComplete()) enterHome() })   // 资料不全：留在登录界面，等用户点按钮
      .catch(() => { /* 重登失败：留在登录页，等用户点按钮 */ })
      .finally(() => Taro.hideLoading())
  }
})

// 微信一键登录：wx.login 拿 code 换 token，成功后检查资料
function wxLogin() {
  if (submitting.value) return
  if (!agreed.value) {
    Taro.showToast({ title: '请先阅读并同意用户协议与隐私政策', icon: 'none' })
    return
  }
  submitting.value = true
  Taro.showLoading({ title: '登录中…', mask: true })
  silentLogin()
    .then(() => afterAuthCheck())
    .catch(err => {
      // 502 是后端调微信接口失败（服务端问题），其余（401 code 失效等）重试一次通常就好
      const msg = err && err.code === 502 ? '微信服务异常，请稍后重试' : '登录失败，请重试'
      Taro.showToast({ title: msg, icon: 'none' })
    })
    .finally(() => {
      Taro.hideLoading()
      submitting.value = false
    })
}
</script>

<style>
/* 登录页类名带 lg- 前缀，避免全局样式冲突 */
.lg-page {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  padding: 0 56rpx;
  background: #F7F9F8;
  box-sizing: border-box;
}

/* 上半区：品牌 + 问候，靠上起手，中间留大片空白 */
.lg-top { padding-top: 24vh; }

/* 下半区：按钮 + 协议；margin-top:auto 把中间留白全吃掉 → 自然贴底 */
.lg-bottom { margin-top: auto; padding-bottom: calc(48rpx + env(safe-area-inset-bottom)); }

/* 品牌：纯色圆角标，去掉渐变与投影 */
.lg-brand { display: flex; align-items: center; gap: 16rpx; }
.lg-logo {
  width: 56rpx; height: 56rpx; border-radius: 16rpx;
  background: #22C55E;
  display: flex; align-items: center; justify-content: center;
}
.lg-logo-ico { width: 32rpx; height: 32rpx; }
.lg-brand-name { font-size: 28rpx; font-weight: 600; color: #1F2937; letter-spacing: 2rpx; }

/* 问候区：字号收小、去掉粗色块与卖点芯片，只留一行小字副标 */
.lg-hello { margin-top: 48rpx; }
.lg-hello-txt { display: block; font-size: 44rpx; font-weight: 600; color: #111827; line-height: 1.3; }
.lg-slogan { display: block; font-size: 24rpx; color: #94A3B8; margin-top: 14rpx; line-height: 1.6; }

/* 主按钮：纯色实心 + 小圆角，去掉渐变与投影 */
.lg-btn-wx {
  height: 92rpx;
  border-radius: 16rpx;
  background: #22C55E;
  color: #ffffff;
  font-size: 30rpx;
  font-weight: 500;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 12rpx;
}
.lg-btn-wx.disabled { opacity: 0.55; }
.lgw-ico { width: 34rpx; height: 34rpx; }

/* 协议勾选（合规必需：整行可点切换，两条可单独点开看摘要） */
.lg-agree { display: flex; align-items: center; justify-content: center; margin-top: 24rpx; font-size: 22rpx; }
.agree-box {
  width: 28rpx; height: 28rpx; border-radius: 50%;
  border: 2rpx solid #CBD5E1; box-sizing: border-box;
  display: flex; align-items: center; justify-content: center;
  margin-right: 10rpx; flex-shrink: 0;
}
.agree-box.on { background: #22C55E; border-color: #22C55E; }
.agree-ico { width: 16rpx; height: 16rpx; }
.agree-txt { color: #94A3B8; }
.agree-link { color: #16A34A; margin-left: 4rpx; }

/* 资料完善态：同样去卡片化，输入框只留一条底线 */
.st-row { display: flex; align-items: center; }
/* 头像：view 做视觉容器（尺寸完全可控），button 透明覆盖层只负责唤起 chooseAvatar */
.st-avatar-wrap { position: relative; width: 112rpx; height: 112rpx; flex-shrink: 0; }
.st-avatar-btn {
  width: 112rpx; height: 112rpx;
  border-radius: 50%; overflow: hidden;
  background: #EDF3EF;
  display: flex; align-items: center; justify-content: center;
}
.st-avatar-cover {
  position: absolute; left: 0; top: 0; width: 112rpx; height: 112rpx;
  opacity: 0; padding: 0; margin: 0; border: none; border-radius: 50%;
}
.st-avatar-cover::after { border: none; }
.st-avatar-img { width: 112rpx; height: 112rpx; }   /* 写死尺寸，不再依赖 height:100% 随父级塌陷 */
.st-avatar-ph { display: flex; flex-direction: column; align-items: center; gap: 6rpx; }
.st-avatar-ico { width: 34rpx; height: 34rpx; }
.st-avatar-txt { font-size: 20rpx; color: #64748B; }
.st-name {
  flex: 1; margin-left: 32rpx; height: 88rpx;
  border-bottom: 2rpx solid #E2E8F0;
  padding: 0; font-size: 30rpx; color: #111827;
  background: transparent;
  box-sizing: border-box;
}
.st-btn {
  height: 92rpx; border-radius: 16rpx; margin-top: 44rpx;
  display: flex; align-items: center; justify-content: center;
  font-size: 30rpx;
}
.st-btn.main { background: #22C55E; color: #ffffff; font-weight: 500; }
.st-btn.main.disabled { opacity: 0.55; }
</style>
