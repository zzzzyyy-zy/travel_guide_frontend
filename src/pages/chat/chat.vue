<template>
  <view class="chat-page">
    <!-- 顶部：左 AI 头像 / 右视频通话入口；绑定信息缩在头像下方（2026-10-04 按设计稿重排，
         原来的白卡标题「和小沃聊聊这份攻略」已删）。本页走 REST /api/guide/chat-text（纯文字回答、不出声） -->
    <view class="chat-head">
      <view class="head-row">
        <image class="head-ava" :src="ICO.bot" mode="aspectFill" />
        <view class="head-video" @tap="goVideo"><image class="head-video-ico" :src="ICO.camera" mode="aspectFit" /></view>
      </view>
      <view class="head-trip" v-if="tripLabel">已绑定：{{ tripLabel }}</view>
      <view class="head-trip" v-else>小沃会读这份攻略的行程与账本（只读）</view>
    </view>

    <!-- 中部：对话流（可滚动，自动滚到最新一条） -->
    <scroll-view class="chat-body" :scroll-y="true" :scroll-into-view="scrollAnchor" scroll-with-animation>
      <view class="msg" v-for="(m, i) in messages" :key="i" :class="m.role">
        <text class="msg-text">{{ m.text }}</text>
        <view v-if="m.role === 'a'" class="msg-tts" @tap="speak(m.text)"><image class="tts-ico" :src="ICO.volume" mode="aspectFit" />听</view>
      </view>
      <view class="output" v-if="loading">思考中…</view>
      <!-- 滚动锚点：新消息时滚到这里 -->
      <view id="chat-bottom"></view>
    </scroll-view>

    <!-- 底部：输入条 -->
    <view class="chat-bar">
      <input class="chat-input" v-model="question" maxlength="200"
        placeholder="输入问题，或长按话筒说" :disabled="loading"
        confirm-type="send" @confirm="ask" />
      <!-- 话筒按钮：tap 开关已废（2026-10-05），改微信语音同款「按住说话」——
           按住开始录、松手发、上滑取消。按住期间按钮内文字实时提示 -->
      <view class="mic ptt" :class="{ rec: recording, cancel: pttCancel }"
        @touchstart="pttStart" @touchmove="pttMove" @touchend="pttEnd" @touchcancel="pttEnd">
        <image v-if="!recording" class="mic-ico" :src="ICO.mic" mode="aspectFit" />
        <text v-else>{{ pttCancel ? '松开取消' : '松开发送' }}</text>
      </view>
      <view class="send" @tap="ask" :class="{ disabled: loading || !(question || '').trim() }">发送</view>
    </view>
    <view class="chat-foot">回答由 AI 生成，仅供参考</view>
  </view>
  <AuthMask />
</template>

<script setup>
import { ref, watch, nextTick } from 'vue'
import Taro, { useLoad, useUnload } from '@tarojs/taro'
import api from '../../services/api'
import { requireLogin } from '../../utils/auth'
import { base64ToTempFile } from '../../utils/file'
import AuthMask from '../../components/AuthMask.vue'
import volume from '../../assets/icons/volume-green.png'
import bot from '../../assets/icons/bot-green.png'          // AI 头像（与讲解页入口同一只小沃）
import cameraGreen from '../../assets/icons/camera-green.png' // 右上角「视频通话」入口
import micGreen from '../../assets/icons/mic-green.png'     // 底部「按住说话」话筒图标

const ICO = { volume, bot, camera: cameraGreen, mic: micGreen }

// 页面参数：tripId 必传（后端按它 buildMemory + 取同一份对话历史 guide:call:{userId}:{tripId}）
const tripId = ref('')
const tripLabel = ref('')
const question = ref('')
const messages = ref([])    // [{ role: 'q' | 'a', text }]
const loading = ref(false)
const recording = ref(false)
const scrollAnchor = ref('')  // scroll-into-view 锚点：新消息时指向底部
let audio = null

// 消息/加载态变化时把对话流滚到最底部
watch(() => [messages.value.length, loading.value], () => {
  scrollAnchor.value = ''
  nextTick(() => { scrollAnchor.value = 'chat-bottom' })
})

useLoad(options => {
  const tid = (options && options.tripId) || ''
  if (options && options.label) tripLabel.value = decodeURIComponent(options.label)
  if (!tid) {
    Taro.showToast({ title: '缺少攻略参数，请从讲解页重新进入', icon: 'none' })
    setTimeout(() => Taro.navigateBack({ fail: () => Taro.switchTab({ url: '/pages/guide/guide' }) }), 1200)
    return
  }
  tripId.value = decodeURIComponent(String(tid))
  loadHistory()   // 进页面先回显这份攻略的往轮对话（服务端为准：与语音/视频通话共用同一份历史）
})

// ---------- 对话历史回显（GET /api/guide/chat-history，2026-10-06 后端契约） ----------
// role: user → 我（q）/ assistant → 小沃（a）；有序，早 → 晚，直接铺进消息流。
// 只在「消息流还空着」时铺：用户可能一进页面就发问（回包更慢），此时不回显以免把问题顶到历史后面。
// 失败一律静默（404 = 非成员 / 网络抖动）：历史拉不到不影响提问，不该弹窗打扰。
function loadHistory() {
  if (!tripId.value) return
  requireLogin(() => {
    api.guide.chatHistory(tripId.value).then(list => {
      const arr = Array.isArray(list) ? list : []
      const mapped = arr.map(it => ({
        role: (it && it.role === 'user') ? 'q' : 'a',
        text: String((it && (it.content || it.text)) || '')
      })).filter(m => m.text)
      if (!mapped.length) return
      if (messages.value.length) { console.log('[chat] 历史回显跳过（已有新对话）', mapped.length, '条'); return }
      messages.value = mapped
      console.log('[chat] 历史回显', mapped.length, '条')
    }).catch(e => {
      console.log('[chat] 历史回显失败（忽略，不影响提问）：', (e && e.code) || '', (e && e.message) || '')
    })
  })
}

useUnload(() => {
  if (audio) { audio.stop(); audio.destroy(); audio = null }
  if (recorder) try { recorder.stop() } catch (e) {}
})

// ---------- 右上角视频通话入口：带同一份 tripId/label 跳独立视频页（与讲解页入口同参） ----------
function goVideo() {
  if (!tripId.value) { Taro.showToast({ title: '还没有绑定攻略', icon: 'none' }); return }
  Taro.navigateTo({
    url: '/pages/videocall/videocall?tripId=' + encodeURIComponent(tripId.value) +
         (tripLabel.value ? '&label=' + encodeURIComponent(tripLabel.value) : '')
  })
}

// ---------- 文字提问（REST，纯文字回答；历史与语音/视频通话共用，不需要 sessionId） ----------
function ask() {
  const q = (question.value || '').trim()
  if (!q || loading.value) return
  requireLogin(() => {
    question.value = ''
    startAsk(q)
  })
}

function startAsk(q) {
  if (!tripId.value) { Taro.showToast({ title: '还没有绑定攻略', icon: 'none' }); return }
  loading.value = true
  messages.value.push({ role: 'q', text: q })
  api.guide.chatText(tripId.value, q).then(d => {
    loading.value = false
    messages.value.push({ role: 'a', text: (d && d.answer) || '（空回答）' })
  }).catch(e => {
    loading.value = false
    // 业务异常按后端约定分流：400 问题为空（前端已拦，兜底）· 404 行程不存在（非成员）
    const code = (e && e.code) || ''
    const tip = code === 404
      ? '这份攻略不在了（可能被删除，或你不是它的成员）'
      : (e && e.message) || '问答服务暂时不可用'
    messages.value.push({ role: 'a', text: tip })
  })
}

// ---------- 语音输入：按住说话（2026-10-05 改微信语音同款手势） ----------
// 手势：按住开始录（wav/16000Hz/单声道，联调纪要 9.4）→ 松手停 → 整段 base64 → REST ASR → 直接提问。
// 上滑超过阈值 = 取消：松手后录音整段丢弃，不发 ASR（本页是「整段一发」的 REST ASR，
// 不像通话页逐帧上行有残句回包，所以取消不需要保护期，onStop 里判丢弃标志即可）。
let recorder = null
const pttOn = ref(false)      // 手指正按在话筒上
const pttCancel = ref(false)  // 上滑超过阈值：松手取消（按钮变「松开取消」）
let pttStartY = 0             // 按下时的触点 Y（算上滑距离）
let pttStartAt = 0            // 按下时间戳（过渡用；「太短」判断以 onStart 的 recStartAt 为准）
let recStartAt = 0        // 真正 onStart 的时刻（授权/登录有延迟，按住时长 ≠ 录音时长，判「太短」用它才准）
let discardNext = false   // 丢弃下一次 onStop 的录音（取消 / 按太短）
const PTT_CANCEL_PX = 80  // 上滑多少 px 算「取消」（与通话页 PTT 同值）
const PTT_MIN_MS = 400    // 录音短于这个时长视为误触

function pttStart(e) {
  if (pttOn.value) return   // 已按住：多指/手势重入不再重启录音
  const t = e && e.touches && e.touches[0]
  pttStartY = t ? t.clientY : 0
  pttStartAt = Date.now()
  pttCancel.value = false
  pttOn.value = true
  if (recording.value) return   // 残留录音（异常态）：不再重启，等这次松手收口
  requireLogin(() => {
    // 授权/登录弹窗期间手指可能已松开：松开了就别起录音，否则会一直录到 60s 超时
    if (pttOn.value && !recording.value) startRecord()
  })
}

function pttMove(e) {
  if (!pttOn.value) return
  const t = e && e.touches && e.touches[0]
  if (!t) return
  pttCancel.value = (pttStartY - t.clientY) > PTT_CANCEL_PX
}

function pttEnd() {
  if (!pttOn.value) return
  pttOn.value = false
  if (!recording.value) return   // 录音还没真正起（授权中/登录回调未回）：pttStart 的回调里已按 pttOn 拦住，这里无事可做
  const tooShort = Date.now() - recStartAt < PTT_MIN_MS
  if (pttCancel.value) Taro.showToast({ title: '已取消发送', icon: 'none' })
  else if (tooShort) Taro.showToast({ title: '说话时间太短，按住再说', icon: 'none' })
  if (pttCancel.value || tooShort) discardNext = true
  recorder.stop()   // 统一收口：onStop 里按 discardNext 决定丢弃还是发送
}

function startRecord() {
  if (!recorder) {
    recorder = Taro.getRecorderManager()
    recorder.onStart(() => {
      recording.value = true
      recStartAt = Date.now()
    })
    recorder.onStop(res => {
      recording.value = false
      if (discardNext) { discardNext = false; return }   // 取消/太短：整段丢弃，不发 ASR
      if (!res || !res.tempFilePath) return
      // 录音文件 → base64 → POST /api/voice/asr
      Taro.getFileSystemManager().readFile({
        filePath: res.tempFilePath,
        encoding: 'base64',
        success: r => {
          loading.value = true
          api.voice.asr(r.data).then(d => {
            loading.value = false
            const text = (d && d.text) || ''
            // 识别结果直接作为提问发出，不回填输入框（避免和气泡重复出现）
            if (text) startAsk(text)
            else Taro.showToast({ title: '没听清，再试一次', icon: 'none' })
          }).catch(e => {
            loading.value = false
            Taro.showToast({ title: (e && e.message) || '语音识别失败', icon: 'none' })
          })
        },
        fail: () => Taro.showToast({ title: '录音文件读取失败', icon: 'none' })
      })
    })
    recorder.onError(() => {
      recording.value = false
      Taro.showToast({ title: '录音失败（检查麦克风授权）', icon: 'none' })
    })
  }
  // 16000Hz 单声道 wav —— 与后端百度 ASR 的要求对齐（文档 7.4）
  recorder.start({ format: 'wav', sampleRate: 16000, numberOfChannels: 1, duration: 60000 })
}

// ---------- 回答播报：TTS base64 mp3 → 临时文件 → 播放 ----------
function speak(text) {
  if (!text) return
  api.voice.tts(text).then(d => {
    if (!d || !d.audio) return Taro.showToast({ title: '音频生成失败', icon: 'none' })
    return base64ToTempFile(d.audio, 'mp3').then(fp => {
      if (audio) { audio.stop(); audio.destroy() }
      audio = Taro.createInnerAudioContext()
      audio.src = fp
      audio.play()
    })
  }).catch(e => Taro.showToast({ title: (e && e.message) || '语音合成失败', icon: 'none' }))
}
</script>

<style>
/* 顶部：覆盖 app.css 里 .chat-head 的白卡样式（2026-10-04 重排后不再是标题卡） */
.chat-head { background: transparent; padding: 8rpx 4rpx 16rpx; margin-bottom: 8rpx; }
.head-row { display: flex; align-items: center; }
/* 左：AI 头像（圆形，浅绿底衬托绿色线条图标） */
.head-ava {
  width: 88rpx; height: 88rpx; border-radius: 50%;
  background: #EAF7EF; padding: 14rpx; box-sizing: border-box;
}
/* 右：视频通话圆钮（描边浅底，与底部「语音」胶囊同色系） */
.head-video {
  margin-left: auto; width: 76rpx; height: 76rpx; border-radius: 50%;
  background: #EAF7EF; display: flex; align-items: center; justify-content: center;
}
.head-video-ico { width: 38rpx; height: 38rpx; }
/* 绑定信息：头像下方一行小字 */
.head-trip { margin-top: 10rpx; font-size: 24rpx; color: #8A9490; line-height: 1.5; }

/* 底部话筒按钮：全局 .mic 是「语音」文字胶囊（width:120rpx + padding 18），
   本页改微信语音同款「按住说话」：平时只显话筒图标，按住后按钮内换提示文字 */
.chat-bar .mic {
  width: auto; min-width: 96rpx; height: 72rpx; padding: 0 24rpx;
  display: flex; align-items: center; justify-content: center;
  box-sizing: border-box; border-radius: 999rpx; flex-shrink: 0;
}
.mic-ico { width: 40rpx; height: 40rpx; }
.mic.ptt text { font-size: 26rpx; white-space: nowrap; }
/* 上滑取消：录音红底上再加深，与「松开发送」区分 */
.mic.cancel { background: #b91c1c; }
</style>
