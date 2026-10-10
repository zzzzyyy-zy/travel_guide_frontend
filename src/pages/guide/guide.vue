<template>
  <view class="wrap">
    <!-- AI 搭子入口页（2026-10-08 照设计稿：小沃 hero + 双入口）。
         2026-10-10 用户定稿：**页内「语音通话浮层」整块删除**（连同录音/PTT/VAD/TTS/WS 那一套），
         语音通话改为「选完攻略 → 直达独立页 pages/videocall?voice=1」（只留语音、默认不开画面）。
         全站只保留独立页这一套通话实现，不再有两份需要同步维护的逻辑。 -->
    <view class="lumi">
      <view class="lumi-figure">
        <image class="lumi-img" :src="ICO.lumi" mode="aspectFit" />
      </view>
      <view class="lumi-title">你好，我是小沃</view>
      <view class="lumi-sub">你的 AI 旅游搭子</view>
      <view class="lumi-note">遇见更有趣的世界，你想如何开始？</view>

      <!-- 双入口并排：文字聊天（独立页 pages/chat）/ 语音通话（选攻略后直达 pages/videocall?voice=1） -->
      <view class="lumi-btns">
        <view class="lb-btn chat" hover-class="lb-hover" @tap="openTextChat">
          <view class="lb-ico-wrap"><image class="lb-ico" :src="ICO.chat" mode="aspectFit" /></view>
          <text class="lb-txt">文字聊天</text>
        </view>
        <view class="lb-btn call" hover-class="lb-hover" @tap="openVoiceCall">
          <view class="lb-ico-wrap call"><image class="lb-ico" :src="ICO.phoneBlue" mode="aspectFit" /></view>
          <text class="lb-txt call">语音通话</text>
        </view>
      </view>
    </view>

    <!-- 进通话前先选攻略：start 消息必须带 tripId，搭子才能 buildMemory 记住这份行程（查「今天去哪」「花了多少」） -->
    <view class="pick-layer" v-if="pickVisible">
      <view class="pick-mask" @tap="closePick"></view>
      <view class="pick-card">
        <view class="pick-head">
          <text class="pick-title">选择一份攻略</text>
          <image class="pick-close" :src="ICO.close" mode="aspectFit" @tap="closePick" />
        </view>
        <view class="pick-note">小沃会读到这份攻略的行程和账本，用来回答「今天去哪」「花了多少」；只读，不会改你的攻略</view>

        <view class="pick-hint" v-if="pickLoading">正在加载攻略…</view>
        <view class="pick-hint" v-else-if="pickError">{{ pickError }}</view>
        <view class="pick-empty" v-else-if="!pickList.length">
          <image class="pe-ico" :src="ICO.mapPinG" mode="aspectFit" />
          <text class="pe-txt">还没有可选的攻略</text>
          <text class="pe-sub">先生成一份攻略，小沃才有行程可查</text>
        </view>
        <scroll-view class="pick-list" :scroll-y="true" v-else>
          <view class="pick-item" v-for="t in pickList" :key="t.id" @tap="pickTrip(t)">
            <view class="pi-cover">{{ (t.city || '旅').charAt(0) }}</view>
            <view class="pi-main">
              <view class="pi-city">{{ tripLabel(t) }}<text class="pi-cur" v-if="isCurrentTrip(t)">上次</text></view>
              <text class="pi-meta">{{ tripMeta(t) }}</text>
            </view>
            <text class="pi-arrow">›</text>
          </view>
        </scroll-view>

        <!-- 没得选时才给出路（不提供「跳过」：start 消息必须带 tripId） -->
        <view class="pick-foot" v-if="!pickLoading && !pickList.length">
          <view class="pf-btn primary" @tap="goCreate">去生成一份攻略</view>
        </view>
      </view>
    </view>
    <AuthMask />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import Taro, { useDidShow } from '@tarojs/taro'
import { useShare } from '../../utils/share'
import api from '../../services/api'
import { requireLogin } from '../../utils/auth'
import { setTab, setTabBarHidden } from '../../utils/tabbar'
import AuthMask from '../../components/AuthMask.vue'
import mapPinG from '../../assets/icons/map-pin-green.png'
import chatGreen from '../../assets/icons/chat-green.png'  // 「文字聊天」入口（跳独立页 pages/chat）
import closeGr from '../../assets/icons/close-gray.png'
import lumiImg from '../../assets/images/xiawo.png'        // 小沃吉祥物 hero 图
import phoneBlue from '../../assets/icons/phone-blue.png' // 「语音通话」按钮蓝电话图标

const ICO = { mapPinG, chat: chatGreen, close: closeGr, lumi: lumiImg, phoneBlue }

// 同步自定义 tabBar 选中态（页面实例每个 tab 独立，onShow 时各自上报）
// 分享：本页不依赖任何 id，转发与朋友圈都指回本页
useShare(() => ({
  title: '小沃 · 边走边聊你的行程',
  path: '/pages/guide/guide'
}), { timeline: true })

useDidShow(() => {
  setTab(2)
})

// ---------- 两个入口按钮：都需要登录（小沃要按账号读行程记忆），选完攻略再跳独立页 ----------
// pickMode 决定 pickTrip 的去向：'chat' = 文字聊天页 | 'voice' = 通话页（只留语音）
let pickMode = ''

// 文字聊天（REST /api/guide/chat-text，纯文字问答、不出声）
function openTextChat() {
  requireLogin(() => {
    pickMode = 'chat'
    openPick()
  })
}

// 语音通话（2026-10-10 改直达独立页）：通话界面只有 pages/videocall 一套，
// voice=1 → 进去默认「只留语音」（不显示取景框、不截帧上行），想视频再点左下「开画面」
function openVoiceCall() {
  requireLogin(() => {
    pickMode = 'voice'
    openPick()
  }, { tip: '语音通话需要登录（小沃要读你的行程和账本才能聊得上）' })
}

// ---------- 选行程（进通话前必过）：start 消息必须带 tripId，搭子据此 buildMemory ----------
const pickVisible = ref(false)
const pickLoading = ref(false)
const pickList = ref([])
const pickError = ref('')
const curTripId = ref('')       // 上次用过的那份（列表里排最前并打「上次」标）

function tripLabel(t) {
  if (!t) return '这份攻略'
  if (t.city) return t.days ? `${t.city} ${t.days} 天` : t.city
  return t.title || '未命名攻略'
}
function tripMeta(t) {
  const d = t.days ? `${t.days} 天` : ''
  const s = t.startDate ? `${t.startDate} 出发` : ''
  return [d, s].filter(Boolean).join(' · ') || '未设置出发日期'
}
function isCurrentTrip(t) { return !!curTripId.value && String(t.id) === String(curTripId.value) }

function openPick() {
  pickVisible.value = true
  setTabBarHidden(true)   // 选攻略弹层压不住 custom-tab-bar（跨容器叠上下文）→ 直接隐藏整条导航栏
  pickLoading.value = true
  pickError.value = ''
  try { curTripId.value = Taro.getStorageSync('currentTripId') || '' } catch (e) { curTripId.value = '' }
  // GET /api/trip/list：拿全部行程（含协作的），上次用过的那份置顶
  api.trips.list().then(list => {
    const arr = Array.isArray(list) ? list : []
    arr.sort((a, b) => (isCurrentTrip(b) ? 1 : 0) - (isCurrentTrip(a) ? 1 : 0))
    pickList.value = arr
  }).catch(e => {
    pickError.value = (e && e.message) || '攻略列表加载失败，请检查网络'
  }).finally(() => { pickLoading.value = false })
}
function closePick() { pickVisible.value = false; pickMode = ''; setTabBarHidden(false) }
function pickTrip(t) {
  if (!t || t.id == null) return
  pickVisible.value = false
  curTripId.value = t.id
  try { Taro.setStorageSync('currentTripId', t.id) } catch (e) {}
  const mode = pickMode
  pickMode = ''
  setTabBarHidden(false)  // 离开本页前恢复 tabBar（本页不再有浮层通话，无隐藏-恢复链）
  const q = 'tripId=' + encodeURIComponent(String(t.id)) + '&label=' + encodeURIComponent(tripLabel(t))
  Taro.navigateTo({
    url: mode === 'chat'
      ? '/pages/chat/chat?' + q
      : '/pages/videocall/videocall?' + q + '&voice=1'   // 语音通话：默认只留语音
  })
}
function goCreate() {
  pickVisible.value = false
  pickMode = ''
  setTabBarHidden(false)  // 跳生成页前恢复 tabBar
  Taro.navigateTo({ url: '/pages/index/index' })
}
</script>

<style>
/* 自定义 tabBar 悬浮底部：底部留白防遮挡（全局 .wrap 只有 64rpx） */
.wrap { padding-bottom: calc(240rpx + env(safe-area-inset-bottom)); }

/* ================= 选攻略弹层（进通话前） ================= */
.pick-layer { position: fixed; left: 0; top: 0; right: 0; bottom: 0; z-index: 3000; display: flex; align-items: flex-end; }
.pick-mask { position: absolute; left: 0; top: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.5); }
.pick-card {
  position: relative; width: 100%; max-height: 84vh;
  background: #fff; border-radius: 32rpx 32rpx 0 0;
  padding: 32rpx 28rpx calc(32rpx + env(safe-area-inset-bottom)); box-sizing: border-box;
  display: flex; flex-direction: column;
}
.pick-head { display: flex; align-items: center; }
.pick-title { flex: 1; font-size: 34rpx; font-weight: 700; color: #15803D; }
.pick-close { width: 30rpx; height: 30rpx; padding: 8rpx; box-sizing: content-box; }
.pick-note { margin-top: 10rpx; font-size: 22rpx; color: #868E96; line-height: 1.55; }
.pick-hint { padding: 60rpx 0; text-align: center; font-size: 26rpx; color: #ADB5BD; }
.pick-empty { display: flex; flex-direction: column; align-items: center; padding: 70rpx 20rpx; }
.pe-ico { width: 80rpx; height: 80rpx; opacity: 0.45; }
.pe-txt { margin: 18rpx 0 8rpx; font-size: 28rpx; color: #495057; }
.pe-sub { font-size: 22rpx; color: #ADB5BD; text-align: center; }
.pick-list { margin-top: 20rpx; max-height: 56vh; }
.pick-item { display: flex; align-items: center; gap: 20rpx; background: #F7F9F9; border-radius: 20rpx; padding: 22rpx 20rpx; margin-bottom: 14rpx; }
.pick-item:active { opacity: 0.75; }
.pi-cover {
  width: 76rpx; height: 76rpx; border-radius: 20rpx; flex-shrink: 0;
  background: linear-gradient(135deg, #4ADE80, #16A34A);
  color: #ffffff; font-size: 32rpx; font-weight: 700;
  display: flex; align-items: center; justify-content: center;
}
.pi-main { flex: 1; display: flex; flex-direction: column; }
.pi-city { display: flex; align-items: center; font-size: 30rpx; font-weight: 600; color: #333333; }
.pi-cur { margin-left: 12rpx; font-size: 18rpx; font-weight: 400; color: #15803D; background: #E7F9EE; border-radius: 999rpx; padding: 2rpx 12rpx; }
.pi-meta { margin-top: 6rpx; font-size: 22rpx; color: #868E96; }
.pi-arrow { color: #C4C7CC; font-size: 36rpx; }
.pick-foot { margin-top: 20rpx; }
.pf-btn { text-align: center; font-size: 28rpx; color: #495057; background: #F1F3F5; border-radius: 999rpx; padding: 22rpx 0; }
.pf-btn.primary { background: #22C55E; color: #ffffff; font-weight: 600; }

/* ================= 入口页（2026-10-08 照设计稿改版：小沃 hero + 双入口按钮） ================= */
.lumi { display: flex; flex-direction: column; align-items: center; padding: 120rpx 40rpx 0; }
/* 吉祥物：透明底 PNG，只定尺寸（image 必须显式宽高，铁律 11）；2026-10-08 晚按用户要求缩小 */
.lumi-figure { width: 380rpx; height: 386rpx; }
.lumi-img { width: 380rpx; height: 386rpx; }
.lumi-title { margin-top: 20rpx; font-size: 46rpx; font-weight: 700; color: #1A1A1A; }
.lumi-sub { margin-top: 18rpx; font-size: 30rpx; font-weight: 500; color: #22A45D; }
.lumi-note { margin-top: 16rpx; font-size: 26rpx; color: #9AA3A0; }
/* 双入口按钮：左「文字聊天」浅绿、右「语音通话」浅蓝紫；圆角大胶囊 + 图标圆底（对齐设计稿） */
.lumi-btns { margin-top: 110rpx; width: 100%; display: flex; gap: 24rpx; }
.lb-btn {
  flex: 1; height: 128rpx; border-radius: 40rpx;
  display: flex; align-items: center; justify-content: center; gap: 16rpx;
  box-sizing: border-box;
}
.lb-hover { opacity: 0.85; }
.lb-btn.chat { background: #F2FAF6; border: 2rpx solid #E2F2E9; }
.lb-btn.call { background: #EAEFFC; }
.lb-ico-wrap {
  width: 72rpx; height: 72rpx; border-radius: 50%; flex-shrink: 0;
  background: #DFF2E7;
  display: flex; align-items: center; justify-content: center;
}
.lb-ico-wrap.call { background: #FFFFFF; }
.lb-ico { width: 40rpx; height: 40rpx; }
.lb-txt { font-size: 30rpx; font-weight: 600; color: #1F2A25; }
.lb-txt.call { color: #4A6CF7; }
</style>
