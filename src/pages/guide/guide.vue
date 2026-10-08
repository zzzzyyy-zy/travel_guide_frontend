<template>
  <view class="wrap">
    <!-- 2026-10-02 改版：此页只保留 AI 搭子。
         定位识别 / 拍照识别 / 讲稿朗读（narrate+TTS）/ 追问入口 全部下线，
         识别类能力不再由这个页面承担；页面 = 语音对话 + 打字提问 + 随时打断。 -->
    <!-- 2026-10-08 照设计稿改版：吉祥物 hero + 双入口按钮（文字聊天 / 语音通话）；
         同日晚追加：吉祥物换成小沃白熊、标题同步改「小沃」、状态胶囊按用户要求删除 -->
    <view class="lumi">
      <view class="lumi-figure">
        <image class="lumi-img" :src="ICO.lumi" mode="aspectFit" />
      </view>
      <view class="lumi-title">你好，我是小沃</view>
      <view class="lumi-sub">你的 AI 旅游搭子</view>
      <view class="lumi-note">遇见更有趣的世界，你想如何开始？</view>

      <!-- 双入口并排：文字聊天（独立页 pages/chat，REST chat-text）/ 语音通话（本页浮层，选攻略后拨通） -->
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

    <!-- 通话层：固定全屏，z-index 2000 压过自定义 tabBar（999/1000）与地图 canvas。
         白底对话式布局（2026-10-03 参考 Helpy 设计稿改版）：头部操作钮 + 气泡时间线 + 底部输入条 -->
    <view class="call-layer" v-if="callVisible">
      <!-- 头部两行（2026-10-03 用户指定布局；2026-10-05 操作键下移到底栏）：
           第一行 = 返回（左）；第二行 = 头像 + 名字/状态 + 视频通话 + 打断。
           静音/挂断已移到下方「打电话式」底栏（挂断居正中、大号红圆），头部不再重复放 -->
      <view class="hero">
        <!-- 第一行：退出通话层（先挂断再回首页） -->
        <view class="hero-row">
          <view class="hero-btn back" @tap="exitPage"><image class="hb-ico back-ico" :src="ICO.back" mode="aspectFit" /></view>
          <view class="hero-spring"></view>
        </view>
        <!-- 第二行：头像（说话时绿描边）+ 名字/状态 + 视频通话开关（打断键移到对话里、跟在 AI 那句话后面） -->
        <view class="hero-row">
          <view class="hero-av" :class="{ live: speakingOn }">
            <image class="hero-ico" :src="ICO.bot" mode="aspectFit" />
          </view>
          <view class="hero-main">
            <view class="hero-name">小沃<text class="hero-tag" v-if="callDemo">演示</text></view>
            <view class="hero-sub">{{ heroSub }}</view>
          </view>
          <view class="hero-btn cam" @tap="switchToVideo">
            <image class="hb-ico" :src="ICO.camera" mode="aspectFit" />
          </view>
        </view>
      </view>
      <!-- 细状态行：连接状态圆点 + 通话计时（打断键已移进对话时间线，跟在 AI 那句话后面） -->
      <view class="hero-meta">
        <view class="call-state"><view class="call-dot" :class="callStatus"></view><text>{{ callStateText }}</text></view>
        <text class="call-timer">{{ callTimeText }}</text>
      </view>
      <view class="hero-trip" v-if="callTripLabel"><image class="ct-ico" :src="ICO.mapPinG" mode="aspectFit" />已绑定：{{ callTripLabel }}</view>
      <view class="hero-line"></view>

      <!-- 对话记录：语音识别到的原话、搭子的回答、你打的字，全落在这一条时间线上（可上下回看） -->
      <scroll-view class="talk" :scroll-y="true" :scroll-into-view="talkInto" :scroll-with-animation="true">
        <view class="msg" :class="m.role" v-for="m in msgs" :key="m.id" :id="'msg' + m.id">
          <view class="msg-row">
            <view class="bubble">{{ m.text }}</view>
            <!-- 暂停 / 播放键：贴在小沃正在说的那句气泡旁边（同一颗键切换：暂停 ∥ → 播放 ▶） -->
            <view class="msg-pp" v-if="speakingOn && m.id === lastAiId" hover-class="msg-pp-hover"
              @tap="toggleTtsPause">
              <image class="pp-ico" :src="ttsPausedOn ? ICO.playW : ICO.pauseW" mode="aspectFit" />
            </view>
          </view>
          <view class="msg-time" v-if="m.t">{{ m.t }}</view>
        </view>
        <view class="talk-empty" v-if="!msgs.length">按住下方麦克风说话，松手发送（想打字请用「文字聊天」）</view>
        <view class="talk-end" id="talkEnd"></view>
      </scroll-view>

      <!-- 按住说话提示层：按住麦克风时浮出；上滑超过阈值变红提示取消（微信语音同款手势） -->
      <view class="ptt-mask" v-if="pttOn">
        <view class="ptt-tip" :class="{ cancel: pttCancel }">
          <image class="ptt-ico" :src="ICO.mic" mode="aspectFit" />
          <text>{{ pttCancel ? '松开手指，取消发送' : '松开发送 · 上滑取消' }}</text>
        </view>
      </view>

      <!-- 底部操作区（2026-10-05 照「平时打电话」改版）：左 = 按住说话麦克风、正中 = 大号红色挂断、
           右 = 静音。挂断从头部小圆钮挪到正中大圆（136rpx），单手拇指最容易够到。
           三格等宽（flex:1），正中格永远是屏幕中线，不会因两侧文字宽窄而偏 -->
      <view class="talk-bar">
        <view class="tb-slot">
          <view class="tb-mic" :class="{ hold: pttOn }" @touchstart="pttStart" @touchmove="pttMove" @touchend="pttEnd" @touchcancel="pttEnd"><image class="tb-mic-ico" :src="ICO.mic" mode="aspectFit" /></view>
          <text class="tb-label">{{ pttOn ? (pttCancel ? '松开取消' : '松开发送') : '按住说话' }}</text>
        </view>
        <view class="tb-slot">
          <view class="tb-hang" hover-class="tb-hang-hover" @tap="hangUp"><image class="tb-hang-ico" :src="ICO.phoneOffWhite" mode="aspectFit" /></view>
          <text class="tb-label">挂断</text>
        </view>
        <view class="tb-slot">
          <view class="tb-mute" :class="{ off: muted }" @tap="toggleMute"><image class="tb-mute-ico" :src="muted ? ICO.micOff : ICO.mic" mode="aspectFit" /></view>
          <text class="tb-label">{{ muted ? '已静音' : '静音' }}</text>
        </view>
      </view>
      <view class="call-note">{{ callNote }}</view>
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
import { ref, computed } from 'vue'
import Taro, { useUnload, useDidShow, useDidHide } from '@tarojs/taro'
import { useShare } from '../../utils/share'
import api from '../../services/api'
import { requireLogin } from '../../utils/auth'
import { base64ToTempFile } from '../../utils/file'
import { getPosition } from '../../utils/position'
import { setTab, setTabBarHidden } from '../../utils/tabbar'
import { takeCallIntent } from '../../utils/callIntent'
import { connectCall, sendAudio, hangUp as closeCallSocket, isDemoCall, isSocketOpen } from '../../services/callSocket'
import AuthMask from '../../components/AuthMask.vue'
import mic from '../../assets/icons/mic-white.png'
import micOff from '../../assets/icons/mic-off-red.png'
import mapPinG from '../../assets/icons/map-pin-green.png'
import bot from '../../assets/icons/bot-green.png'
import chatGreen from '../../assets/icons/chat-green.png'  // 「文字聊天」入口（跳独立页 pages/chat）
import phoneOffWhite from '../../assets/icons/phone-off-white.png'   // 底栏正中大挂断键（红圆 + 白话筒）
import closeGr from '../../assets/icons/close-gray.png'
import chevronRt from '../../assets/icons/chevron-right.png'   // 返回键：右箭头图旋转 180° 当左箭头用，免新增图标
import cameraGreen from '../../assets/icons/camera-green.png'  // 通话中「切视频页」摄像头钮
import pauseWhite from '../../assets/icons/pause-white.png'    // 打断键 + 暂停键（白暂停符，绿底）
import playWhite from '../../assets/icons/play-white.png'      // 暂停后同一颗键变「播放」（续播）
import lumiImg from '../../assets/images/xiawo.png'            // 小沃吉祥物 hero 图（2026-10-08 晚改透明底 PNG 并缩小，变量名沿用 lumi 减少改动面）
import phoneBlue from '../../assets/icons/phone-blue.png'     // 「语音通话」按钮蓝电话图标（设计稿 2026-10-08）

const ICO = {
  mic, micOff, mapPinG, bot, phoneOffWhite, close: closeGr, back: chevronRt,
  camera: cameraGreen, chat: chatGreen, pauseW: pauseWhite, playW: playWhite,
  lumi: lumiImg, phoneBlue
}

// ---------- 对话时间线（语音识别） ----------
const msgs = ref([])          // [{ id, role: 'me' | 'ai', text }]，role 决定气泡左右与配色
// 「小沃正在说的那句」= 时间线上最后一条 AI 消息（text 先于音频到达，tts 开始说话时它必然是最后一条 AI）；
// 打断键跟在这条气泡后面。用户再插话也不影响——打断目标始终是「最后那句 AI 的话」。
const lastAiId = computed(() => {
  for (let i = msgs.value.length - 1; i >= 0; i--) if (msgs.value[i].role === 'ai') return msgs.value[i].id
  return 0
})
const talkInto = ref('')      // scroll-view 锚点（滚到底部，见 scrollTalk）
let msgSeq = 0
let curUserIdx = -1           // 正在识别的用户消息下标：asr_partial 就地改写，否则一句话会刷出一串气泡
let curUserDone = true        // 该条是否已 final（true = 下一句要新起一条）
let talkScrollTimer = null

// 气泡时间戳（HH:MM，参考设计稿每条气泡下的小灰字）
function nowHM() {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}

function scrollTalk() {
  // 锚点必须「先清后设」：scroll-into-view 传相同值不会再触发滚动
  talkInto.value = ''
  if (talkScrollTimer) clearTimeout(talkScrollTimer)
  talkScrollTimer = setTimeout(() => { talkInto.value = 'talkEnd' }, 30)
}

// 识别中：同一句就地改写同一条气泡（partial 会连续打好几次）
function updateUserText(text) {
  const t = text || ''
  if (curUserIdx < 0 || curUserDone) {
    msgs.value.push({ id: ++msgSeq, role: 'me', text: t, t: nowHM() })
    curUserIdx = msgs.value.length - 1
    curUserDone = false
  } else {
    msgs.value[curUserIdx].text = t
  }
  scrollTalk()
}

// 识别定格：锁定这条气泡，下一句重新起一条
function lockUserText(text) {
  if (curUserIdx < 0) {
    msgs.value.push({ id: ++msgSeq, role: 'me', text: text || '', t: nowHM() })
    curUserIdx = msgs.value.length - 1
  } else {
    msgs.value[curUserIdx].text = text || ''
  }
  curUserDone = true
  scrollTalk()
}

// 搭子的回答落一条气泡
function pushAiText(text) {
  if (!text) return
  msgs.value.push({ id: ++msgSeq, role: 'ai', text, t: nowHM() })
  curUserIdx = -1
  curUserDone = true
  scrollTalk()
}

// ---------- 历史回显（2026-10-06 后端契约）：通话 start 绑定行程后后端推一条 history ----------
// 载荷字段名后端未定死 → 宽容取（list / history / data / items / messages 里第一个数组）。
// role: user → 我（me）/ assistant → 小沃（ai）；历史条目无时间戳 → t 留空（模板 v-if="m.t" 自然不显示）。
// 平时通话刚开始时间线是空的，直接铺；若用户抢先说了话，历史插到最前面（只给新条目发新 id，不重排旧 id）。
function pickHistory(evt) {
  const cands = [evt && evt.list, evt && evt.history, evt && evt.data, evt && evt.items, evt && evt.messages]
  for (const c of cands) if (Array.isArray(c)) return c
  return []
}
function applyHistory(raw) {
  const list = Array.isArray(raw) ? raw : []
  const hist = list.map(it => ({
    role: (it && (it.role === 'user' || it.role === 'me')) ? 'me' : 'ai',
    text: String((it && (it.content || it.text)) || ''),
    t: ''
  })).filter(m => m.text)
  if (!hist.length) { console.log('[call] history 事件为空，不回显'); return }
  if (msgs.value.length) {
    msgs.value = hist.map(m => ({ ...m, id: ++msgSeq })).concat(msgs.value)
    console.log('[call] 历史回显', hist.length, '条（插在已有对话之前）')
  } else {
    msgs.value = hist.map(m => ({ ...m, id: ++msgSeq }))
    console.log('[call] 历史回显', hist.length, '条')
  }
  curUserIdx = -1
  curUserDone = true
  scrollTalk()
}

// 同步自定义 tabBar 选中态（页面实例每个 tab 独立，onShow 时各自上报）
// 顺带接住「通话意图」：首页/行程页是 switchTab 过来的（带不了参数），走 callIntent 一次性传递
// 分享：本页不依赖任何 id，转发与朋友圈都指回本页
useShare(() => ({
  title: '小沃 · 边走边聊你的行程',
  path: '/pages/guide/guide'
}), { timeline: true })

useDidShow(() => {
  setTab(2)
  const intent = takeCallIntent()
  if (intent) openCall(intent)
})

useUnload(() => {
  if (callVisible.value) hangUp()   // 离开页面必须挂断：否则录音/推流会在后台继续跑
})

// tab 切走（如用户点了首页）同样要挂断，麦克风不能挂在后台
useDidHide(() => { if (callVisible.value) hangUp() })

// ---------- 打字提问已迁出本页（2026-10-04）：通话层只留语音。想去打字 → pages/chat（REST chat-text） ----------

// ================= AI 搭子：实时语音通话（WS /ws/guide/call，后端文档 2026-10-01） =================
const callVisible = ref(false)
const callOn = ref(false)       // 已发起且未挂断（控制 camera 挂载与帧循环）
const callDemo = ref(false)     // 演示模式（本地脚本，后端未就绪也能看完整通话效果）
const callStatus = ref('idle')  // connecting / open / closed / error
const callSeconds = ref(0)
const callNote = ref('')        // 底部提示：模式说明 / 错误文案
const muted = ref(false)        // 静音：停止麦克风上行（搭子仍然能回答你打的字）
// speaking 是「音频闸门」的普通变量（非 ref，帧回调热路径里读），UI 需要的响应式由下面这个 ref 承担，
// 两边只在 setSpeaking() 里同时改 —— 别再出现第二个赋值点，否则闸门炸了界面也看不出来。
const speakingOn = ref(false)

const CALL_STATE = { idle: '未连接', connecting: '连接中…', open: '通话中', closed: '已结束', error: '连接失败' }
const callStateText = computed(() => CALL_STATE[callStatus.value] || '')
const callTimeText = computed(() => {
  const s = callSeconds.value
  const mm = String(Math.floor(s / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return `${mm}:${ss}`
})
// 搭子状态一句话（放在头像右侧）：优先反映"它现在在干嘛"
const heroSub = computed(() => {
  if (callStatus.value !== 'open') return CALL_STATE[callStatus.value] || ''
  if (speakingOn.value) return '小沃正在说话，点「打断」或直接说话插话'
  if (muted.value) return '已静音：点右上角麦克风恢复收音'
  return '按住下方麦克风说话，松开发送；打字也可以'
})

let recMgr = null        // 录音管理器（全局唯一，懒创建）
let recRunning = false   // 「意图」：我们认为自己在录
// 2026-10-03 加：录音器状态不同步的根治（真机日志 `operateRecorder:fail:audio is recording, don't start record again`）
// 背景：微信录音器是**单例**，start/stop 都是异步的，而 recRunning 只是我们的意图标记 ——
//   PTT 快按快放（松手 stop 还没落地又按住 start）会让两者错位：start 被拒 → onError 又把 recRunning 置 false，
//   此时录音器**其实还在录**，于是 stopRecorder 变成空操作 → 麦克风泄漏到挂断之后，
//   残留帧还会走进旧 VAD 路径刷「8 秒未检测到语音」，新通话再按也起不来（真机三连通话 0 帧上行就是这么来的）。
let recActive = false    // 「实际」在录（由 onStart/首帧置真、onStop 置假）—— 停录音要看它，不看意图
let recStarting = false  // start() 已发出、还没进到录制状态（去重 + 卡死兜底）
let recResumeAfterStop = false  // start 时发现实际仍在录 → 先停，等 onStop 到达再重启
let recStartGuard = null // 3 秒兜底定时器：start 后没进录制态就复位，避免永久卡在「启动中」
let recStopping = false  // 本次 stop 是否由我们主动发起（决定 onStop 要不要自动续录）
let timerId = null       // 通话计时
let speaking = false     // 搭子正在说话：此间不把音频上行（否则把扬声器的声音录回去＝自问自答）
// 帧拦截诊断：只打一条会掩盖「同一原因持续拦着」的故障（第二句被永久吞掉就是这么被藏住的），
// 改为「拦下原因变化时打一条 + 同一原因每 5 秒补一条心跳」。
let blockReason = ''     // 上一次被拦的原因（callOn / muted），变化即重新打印
let blockFrames = 0      // 本次连续被拦的帧数（心跳里打出来，一眼看出拦了多久）
let blockLoggedAt = 0    // 上一次打拦截日志的时间戳（毫秒）
let callAudio = null

// intent = { tripId }：行程页入口带过来说明已在某份攻略里 → 直接用；
// 其余入口（首页金刚区 / 讲解页按钮）没有目标攻略 → 先弹「选择一份攻略」，选完才进通话。
function openCall(intent) {
  if (callVisible.value) return
  requireLogin(() => {
    callDemo.value = isDemoCall()
    const preset = (intent && intent.tripId) || ''
    if (preset) { beginCall(String(preset), (intent && intent.label) || ''); return }
    openPick()
  })
}

// 视频通话 = 独立页 pages/videocall：本页不再放它的入口（2026-10-08 入口页照设计稿只留「文字聊天/语音通话」）；
// 视频通话仍可达——行程详情页「视频搭子」按钮走 callIntent（videocall）直达。
// 复用选攻略弹层：pickMode 决定 pickTrip 的去向（语音通话是本页浮层，不在此列）。
let pickMode = ''   // '' = 本页语音通话 | 'video' = 跳视频页 | 'chat' = 跳文字聊天页
// 文字聊天（2026-10-04）：REST /api/guide/chat-text，纯文字问答、不出声；同一份攻略记忆
function openTextChat() {
  requireLogin(() => {
    pickMode = 'chat'
    openPick()
  })
}
// 语音通话（2026-10-08 入口页改版）：走本页通话浮层；不带行程意图 → openCall 内部会先弹「选择一份攻略」
function openVoiceCall() {
  openCall({})
}

// ---------- 选行程（进通话前必过）：start 消息必须带 tripId，搭子据此 buildMemory ----------
const pickVisible = ref(false)
const pickLoading = ref(false)
const pickList = ref([])
const pickError = ref('')
const curTripId = ref('')       // 上次用过的那份（列表里排最前并打「上次」标）
const callTripLabel = ref('')   // 通话层顶部显示的「已绑定」

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
function closePick() { pickVisible.value = false; pickMode = '' }
function pickTrip(t) {
  if (!t || t.id == null) return
  pickVisible.value = false
  curTripId.value = t.id
  try { Taro.setStorageSync('currentTripId', t.id) } catch (e) {}
  // 独立页入口（视频通话 / 文字聊天）：不发起本页通话，带参跳对应页面
  if (pickMode) {
    const mode = pickMode
    pickMode = ''
    const q = 'tripId=' + encodeURIComponent(String(t.id)) + '&label=' + encodeURIComponent(tripLabel(t))
    Taro.navigateTo({ url: (mode === 'video' ? '/pages/videocall/videocall?' : '/pages/chat/chat?') + q })
    return
  }
  beginCall(String(t.id), tripLabel(t))
}
function goCreate() {
  pickVisible.value = false
  pickMode = ''
  Taro.navigateTo({ url: '/pages/index/index' })
}

// 真正发起通话：tripId 进 start 消息（{ type:'start', tripId, lat?, lng? }）
function beginCall(tripId, label) {
  // tripId 必传：搭子要按这份攻略 buildMemory（才能回答「今天去哪」「花了多少」），任何入口都不放行空值
  if (!tripId) {
    Taro.showToast({ title: '请先选择一份攻略', icon: 'none' })
    return
  }
  // 闸门必须先于录音/建连置位（放在 tripId 校验之后：上面的 return 分支不能留下「callOn=true 但没通话」的脏状态）
  callOn.value = true
  callTripLabel.value = label || ''
  callVisible.value = true
  setTabBarHidden(true)   // 通话层盖不住 custom-tab-bar（跨层叠上下文），直接隐藏整条导航栏
  callStatus.value = 'connecting'
  callSeconds.value = 0
  muted.value = false
  msgs.value = []         // 每次通话开一条新时间线（上一通的内容清掉，免得和服务端新会话的上下文对不上）
  curUserIdx = -1
  curUserDone = true
  talkInto.value = ''
  // speaking 是普通变量（非 ref）：上次通话若异常退出（音频没触发 onEnded/onStop）会残留 true，
  // 导致本次通话的 onFrameRecorded 全部被拦、搭子一句都听不到 → 每次起通话统一走 setSpeaking 归零
  setSpeaking(false)
  ttsPausedOn.value = false   // 上一通若停在「暂停」态，新通话不能继承（否则气泡旁的键一开口就是播放符）
  frameCount = 0          // 帧计数重新归零（第一帧日志每次通话都打一条，便于逐通核对）
  blockReason = ''        // 帧拦截诊断重新计数（每次通话独立）
  blockFrames = 0
  blockLoggedAt = 0
  vadOff = !!Taro.getStorageSync('VAD_OFF')   // 运行时 VAD 开关（真机 A/B 对照用，见 VAD_ENABLED 处说明）
  stopTtsWatchdog()       // 上一通遗留的 TTS 看门狗必须清掉，别让它到点把本通的 speaking 强行复位
  resetBarge()            // 语音打断的回声基线/前导缓存归零（否则会拿上一通的环境当基线）
  resetVad(true)          // VAD 状态/统计归零（噪声底也回默认值，别把上一通的环境噪声带进来）
  // 按住说话（PTT）状态归零：麦克风不再常开，只在按住期间录（上一通若按住时挂断，这里兜底收掉）
  pttOn.value = false
  pttCancel.value = false
  pttGuard = false
  currentCallTripId.value = String(tripId)   // 通话中切「视频通话页」要把它带过去
  callNote.value = callDemo.value ? '演示模式：对话是本地脚本，按住麦克风说话仍走真机' : ''
  // 通话起点日志：与 hangUp 的「挂断」日志配对看，即可证明「被拦 callOn:false」只可能出现在挂断之后
  console.log('[call] 通话开始：闸门已重置', { callOn: callOn.value, muted: muted.value, speaking })

  // 位置（供「附近推荐」）：用缓存的模糊定位，不强制重定位；拿不到或走了兜底坐标就省略（不发假坐标）。
  // start 只带「通话开始那一刻」的坐标；通话中的实时位置由通道每 5 秒自动补发 location
  // （callSocket 的 startLocLoop，2026-10-04 按后端协议恢复，页面不用自己起定时器）。
  getPosition(false).then(pos => {
    const real = pos && !pos.isFallback
    connectCall({
      tripId,
      lat: real ? pos.lat : undefined,
      lng: real ? pos.lng : undefined,
      onStatus: s => { callStatus.value = s },
      onEvent: onCallEvent
    })
  }).catch(() => {
    connectCall({ tripId, onStatus: s => { callStatus.value = s }, onEvent: onCallEvent })
  })

  startCallTimer()
  // 麦克风默认不在这里启动：按住说话模式里，录音只跟着「按住」走（pttStart → startRecorder）
}

function onCallEvent(evt) {
  switch (evt.type) {
    case 'ready': return
    // 历史回显：通话 start 绑定行程后后端推一条 history（同一份 Redis 对话历史）
    case 'history': applyHistory(pickHistory(evt)); return
    case 'asr_partial':
    case 'asr_final':
      // 上滑取消/按太短的保护期：后端 ASR 可能对已丢弃的残句超时出 final，吞掉别让它上屏
      if (pttGuardActive()) { console.log('[call] 已取消语音的回包，吞掉：', evt.type); return }
      if (evt.type === 'asr_partial') updateUserText(evt.text || '')
      else lockUserText(evt.text || '')
      return
    // attraction（视频页接管）：本页不再收识图结果
    // 下行 text：搭子的**回答文字**。2026-10-04 后端把「文字」从 tts 里拆了出来，独立成一条、先于音频到达。
    case 'text':
      // 取消保护期：后端为已丢弃的残句出的答案，文字也要一起吞掉。
      // ⚠️ 这里**故意不清 pttGuard** —— 紧随其后的 tts 音频还得靠它吞；清了保护期就会把用户已经取消掉的答案放出声。
      if (pttGuardActive()) { console.log('[call] 已取消语音的 text，吞掉'); return }
      pushAiText(evt.text || '')
      return
    case 'tts':
      // 取消保护期内的 tts = 后端对残句出的答案，一并吞掉（吞一条即清保护期，不影响后续正常问答）
      if (pttGuardActive()) { pttGuard = false; console.log('[call] 已取消语音的 tts，吞掉'); return }
      // 文字已由上面的 text 消息负责；tts 只在**主动提醒**时才自带 text（如行程到点提醒），这时补上屏
      if (evt.text) pushAiText(evt.text)
      // 有音频就「立刻」解闸 + 立刻占号：从收到 tts 到音频文件写出来之间有几百毫秒空窗，
      // ① 空窗若不拦住麦克风，AI 的开头几句会被录回去（自问自答的典型成因）；
      // ② 号必须在这里占：写文件是异步的，若等 then 里才 ++ttsNo，用户在这段空窗里
      //    开口打断时 interrupt 自增的是旧号，新号随后照样生效把音频放出来 —— 打断形同虚设。
      // 恢复 false 仍只走 onEnded/onStop（+ 看门狗兜底），onPlay 不参与闸门。
      if (evt.data) {
        const no = ++ttsNo
        ttsPausedOn.value = false          // 新的一句：上一句的「暂停中」状态作废（键回到暂停符）
        setSpeaking(true)
        ttsGuardNow = ttsGuardMs(evt.data) // 记下本段看门狗时长，暂停续播时按它重新起表
        armTtsWatchdog(ttsGuardNow)
        playCallAudio(evt.data, no)
      }
      return
    case 'error':
      // 后端会把 Java 异常原文直接丢过来（实测收到过「Connection reset by peer」），
      // 原样显示给用户等于什么都没说 → 翻成人话，原文留在控制台给队友定位。
      // 域名白名单类提示不上屏（2026-10-05 需求方要求删掉）：联调期靠「不校验合法域名」绕过，
      // 对用户是噪音；连接失败仍由状态行红点 + 「连接失败」表达
      console.warn('[call] 后端 error 原文：', evt.message || '')
      if (!/白名单|domain list/i.test(String(evt.message || ''))) {
        callNote.value = friendlyCallError(evt.message)
      }
      return
  }
}

// 后端错误原文 → 人话。后端（及其上游语音服务）的异常会原样透传过来，
// 直接显示给用户没有意义；新增一类就往这里加一条。
function friendlyCallError(raw) {
  const m = String(raw || '')
  if (/connection reset|reset by peer|broken pipe|socketexception/i.test(m)) {
    return '与语音服务的连接被上游中断，本次识别已失效，请挂断后重新拨打'
  }
  if (/timeout|timed out/i.test(m)) return '后端处理超时，请再说一次'
  if (/unauthor|token|forbidden|401|403/i.test(m)) return '通话鉴权失效，请重新登录后再试'
  return '通话出错：' + (m || '未知错误')
}

// ---------- TTS 播放：解闸 + 看门狗 ----------
// 🔴 这里原是「第二句不识别」的真凶现场：播放 TTS 会抢占音频通道 → 录音 onStop → 本页自动续录
// （见 startRecorder 的 onStop）→ 「重启录音」又反过来打断播放 → callAudio.onEnded 永不触发
// （onEnded 只在**自然播完**时触发，被打断走的是 onStop / onInterruptionBegin）。
// 结果 speaking 卡在 true，此后每一帧都在闸门处被吃掉 → 用户第二句怎么说都不识别。
// 因此：① 把 onStop 也算作「不再出声」；② 再兜一条看门狗，到点强制还麦克风。
let ttsWatchdog = null   // TTS 播放看门狗定时器句柄
let ttsNo = 0            // 播放序号：只认最新一段 tts 的回调，防上一段的迟到回调把闸门提前解开
let ttsGuardNow = 15000  // 当前这段 TTS 的看门狗时长（暂停续播时要按它重新起表）
// 暂停中（气泡旁那颗键切成「播放」）。只被用户点击 / 音频回调读，不参与帧热路径 → 单个 ref 够用。
const ttsPausedOn = ref(false)
// 暂停后延迟放行麦克风的时刻：pause() 之后扬声器可能还剩一点缓冲尾音，先丢 300ms 再开听。
let pauseMicAt = 0

// 闸门的唯一写入口：音频闸门（普通变量，帧热路径读）与界面状态（ref）必然同步，
// 不许再有第二个地方直接写 speaking —— 闸门和界面不同步是最难查的一类 bug。
function setSpeaking(v) {
  speaking = v
  speakingOn.value = v
  // 搭子开始出声：VAD 状态清干净（扬声器里的声音会回采进麦克风，不清会被当成「用户开口」，
  // 说完后就把一堆它自己的回声补发上去了）
  if (v) resetVad(false)
  else resetBarge()   // 不再出声 → 语音打断的回声基线/前导缓存一并清掉
}

function stopTtsWatchdog() {
  if (ttsWatchdog) { clearTimeout(ttsWatchdog); ttsWatchdog = null }
}

// 统一解闸（幂等）：无论自然播完 / 被停 / 报错，都从这里恢复上行
function endSpeaking(reason, no) {
  if (no !== undefined && no !== ttsNo) {
    console.log('[call] 忽略过期 TTS 回调（第', no, '段，当前第', ttsNo, '段）：', reason)
    return
  }
  stopTtsWatchdog()
  ttsPausedOn.value = false   // 这一句结束了：暂停态跟着清掉（键随 speakingOn 一起消失）
  if (speaking) console.log('[call] TTS 播放结束（', reason, '），恢复上行')
  setSpeaking(false)
}

function armTtsWatchdog(ms) {
  stopTtsWatchdog()
  ttsWatchdog = setTimeout(() => {
    ttsWatchdog = null
    if (!speaking) return
    console.warn('[call] TTS 播放疑似卡死：', Math.round(ms / 1000),
      '秒内没等到 onEnded/onStop，强制恢复上行（不兜这一层，用户第二句会被永久吞掉）')
    setSpeaking(false)
  }, ms)
}

// ---------- 暂停 / 继续小沃的语音（气泡旁边那颗键） ----------
// 与「打断」的分工：打断 = 这句不要了（关闸门 + 丢弃剩余）；暂停 = 先按着，等下接着听。
// 🔴 暂停期间**放行麦克风**（2026-10-06 用户要求）：小沃不出声了，不存在「把它的声音录回去」的回路，
//    用户此时说话要能被识别（VAD/PTT → 上行 → ASR），说完小沃直接接话；
//    续播那一刻必须把闸门收回（pauseMicAt 归零 + resetVad），否则续播的半句会被麦克风录回去。
// 🔴 暂停时必须停看门狗：它到点会强制解闸，连带 speakingOn=false 让暂停键消失 —— 用户就再也点不到「继续」。
// 实现用 InnerAudioContext 原生的 pause()/play()（play 从暂停处续播），不需要重播整段。
function toggleTtsPause() {
  if (!callAudio) {
    // 这段 tts 没有音频（后端 data 为空 = 只有字幕），或音频文件还没写出来 → 没东西可暂停
    if (speaking) callNote.value = '这句话只有文字，没有语音'
    return
  }
  if (ttsPausedOn.value) {
    try { callAudio.play() } catch (e) { /* 已结束 */ }
    ttsPausedOn.value = false
    armTtsWatchdog(ttsGuardNow)   // 暂停时把表停了，续播要重新起表（否则这一段永远没有兜底）
    pauseMicAt = 0                // 重新出声 → 闸门立刻收回（续播的半句不能被录回去）
    resetVad(false)               // 出声期重新建立基线（与 setSpeaking(true) 同口径）
    callNote.value = '继续播放'
    console.log('[call] 继续播放小沃的语音（从暂停处续播，麦克风闸门收回）')
  } else {
    try { callAudio.pause() } catch (e) { /* 已结束 */ }
    ttsPausedOn.value = true
    // 暂停 = 小沃不出声了：不存在「把它自己的声音录回去」的回路 → 放行麦克风，用户这时说话要能被识别。
    pauseMicAt = Date.now() + 300   // 但 pause() 后的扬声器尾音仍丢 300ms，免得把尾巴当用户开口
    resetVad(false)                 // 从 idle 重新开听：出声期的 VAD 统计/前导缓存不带到暂停期
    stopTtsWatchdog()
    callNote.value = '已暂停小沃的语音，你可以直接说话；点播放键继续'
    console.log('[call] 暂停小沃的语音（麦克风已放行，用户可直接说话；点气泡旁的播放键继续）')
  }
}

// ---------- 打断搭子（手动按钮 / 打字 / 语音插话 三条路都汇到这里） ----------
// 打断 = 立刻停掉它的语音 + 把麦克风闸门还回来。ttsNo 先自增：当前这段 TTS 的 onStop/onEnded
// 迟到回调会因号不匹配被忽略，不会再来动 speaking（否则刚放开又被它设回 true）。
function interrupt(reason) {
  if (!speaking && !callAudio) return
  console.log('[call] 打断搭子（', reason, '）')
  ttsNo++
  ttsPausedOn.value = false   // 打断 = 这句不要了，暂停态一并作废
  if (callAudio) {
    try { callAudio.stop() } catch (e) { /* 已结束 */ }
    try { callAudio.destroy() } catch (e) { /* 已销毁 */ }
    callAudio = null
  }
  stopTtsWatchdog()
  setSpeaking(false)
  resetVad(false)   // 这半句被放弃了：VAD 从 idle 重新开始听
  if (reason !== '语音打断') callNote.value = '已打断小沃，接着说就行'
}

// 看门狗时长 = 估算时长 ×2 + 3 秒（留解码/缓冲余量），下限 15 秒
function ttsGuardMs(b64) {
  const kb = Math.round(b64.length * 3 / 4 / 1024)
  return Math.max(15000, Math.round(kb / 4) * 2000 + 3000)
}

// AI 回答的语音：base64 mp3 → 临时文件 → 播放；没有音频（如 mock）就纯字幕降级
// no 由 case 'tts' 收到消息时占好传入；缺省时才自增（兼容直接调用）
function playCallAudio(b64, no) {
  if (!b64) return
  if (no === undefined) no = ++ttsNo
  // mp3 体积换算：base64 长度 ×3/4 得到字节数；32kbps 约 4KB/秒 → 秒数 ≈ KB/4（粗估，仅用于日志）
  const kb = Math.round(b64.length * 3 / 4 / 1024)
  base64ToTempFile(b64, 'mp3').then(fp => {
    // 写文件期间可能已被「新一段 tts」或「用户打断」顶掉 → 这段作废，一个字都不放
    if (no !== ttsNo) { console.log('[call] 该段 TTS 已过期（被新句/打断顶掉），丢弃不播放'); return }
    if (callAudio) { callAudio.stop(); callAudio.destroy() }
    callAudio = Taro.createInnerAudioContext()
    callAudio.src = fp
    resetBarge()   // 播放前一刻重置回声基线（闸门已在收到 tts 时置位，这里只补基线）
    // 这四条构成「搭子到底有没有出声」的完整证据链：只有打「播放结束」才算真的从扬声器放完了
    // （只打「开始」可能被设备静音/音量 0 骗过）。onStop 不能省——被录音打断时它才是唯一信号。
    callAudio.onEnded(() => endSpeaking('自然播完', no))
    // 防御：个别机型把 pause() 也报成 onStop → 若此时在暂停中，别当「播放结束」处理（否则闸门放开、
    // 暂停键消失，用户就点不到「继续」了）；真正的 stop（打断/挂断）已在调用处先清掉暂停态。
    callAudio.onStop(() => {
      if (ttsPausedOn.value) { console.log('[call] onStop 由暂停触发，忽略（等用户点播放键继续）'); return }
      endSpeaking('被停止/打断', no)
    })
    callAudio.onError(e => { endSpeaking('播放失败', no); console.warn('[call] TTS 播放失败：', (e && e.errMsg) || e) })
    callAudio.play()
    console.log('[call] TTS 播放开始：mp3 约', kb, 'KB（≈', Math.round(kb / 4), '秒）｜看门狗',
      Math.round(ttsGuardMs(b64) / 1000), '秒')
  }).catch(e => {
    if (no === ttsNo) setSpeaking(false)   // 只有仍是当前段才还闸门，否则会把新句的闸门误关
    console.warn('[call] TTS 临时文件写入失败：', e)
  })
}

function hangUp() {
  callOn.value = false        // 先置位：录音 onStop 里的「自动续录」据此判断，避免挂断后又自己录起来
  console.log('[call] 挂断：callOn → false（此后的迟到帧被「拦下」属正常，不是故障）')
  // VAD 统计：一眼看出这通有多少帧真的上行了。占比低是正常的（大部分时间是没人说话，
  // 也正是 VAD 的价值所在——这些帧以前会白发给后端 ASR）。
  {
    const total = vadSent + vadSkipped
    console.log('[call] VAD 统计：上行', vadSent, '帧 ｜ 静音跳过', vadSkipped, '帧',
      total ? `（上行占比 ${Math.round((vadSent / total) * 100)}%）` : '')
  }
  resetVad(true)
  setTabBarHidden(false)      // 恢复底部导航栏（通话期间被隐藏）
  pttOn.value = false         // 按住中挂断（极端时序）：提示层收掉，保护期作废
  pttCancel.value = false
  pttGuard = false
  stopRecorder()
  stopCallTimer()
  stopTtsWatchdog()   // 看门狗一并清掉（否则挂断后它到点还会打一条「TTS 卡死」的误报）
  setSpeaking(false)  // 闸门 + 界面状态一起复位（内部顺带清掉语音打断的状态）
  ttsPausedOn.value = false   // 挂断时若处于暂停态，一并清掉（下次通话从干净状态开始）
  if (callAudio) { callAudio.stop(); callAudio.destroy(); callAudio = null }
  closeCallSocket()
  callVisible.value = false
  callStatus.value = 'closed'
  callNote.value = ''
  callTripLabel.value = ''
}

// 返回首页：通话层是全屏固定层 + 通话期间 tabBar 被隐藏，用户此前没有任何出口。
// 先 hangUp（恢复 tabBar / 停录音 / 关 WS），再 switchTab 回首页。
// switchTab 会触发 useDidHide，但此时 callVisible 已是 false，不会二次挂断。
function exitPage() {
  if (callVisible.value) hangUp()
  Taro.switchTab({ url: '/pages/home/home' })
}

// ---------- 录音：PCM / 16kHz / 单声道，帧回调直接上推（frameSize 单位是 KB） ----------
// 注：队友文档写的 frameSize=3200，但微信官方单位是 KB，3200KB 不可能命中 → 取 FRAME_KB（见下方常量）
// （联调期那个「头 4 字节 PCM 格式探针」已删：帧已被后端 ASR 正常识别，结论明确，留着只会刷屏）
let frameCount = 0       // onFrameRecorded 触发次数（第一帧日志 + 判断录音链路是否真的活了）

// 【帧大小】单条 audio 文本消息的体积 = 帧字节 × 4/3（base64）+ JSON 信封，约 30 字节。
// 2026-10-02 真机实测：frameSize:4 → 每帧 4480 字节 PCM → base64 约 5976 字符 → 单条消息约 6KB，
// 连接建立、start 与音频帧均发出后，**服务端立刻以 1009 关闭**：
//   "The decoded text message was too big for the output buffer and the endpoint does not support partial messages"
// 这是 Java（Tomcat）WebSocket 的原文，含义是「这条文本消息超过了服务端配置的文本消息缓冲上限」。
// 根治在后端把 maxTextMessageBufferSize 调大（Tomcat 默认 8KB，实测被拒说明后端配得比 6KB 更小）；
// 前端这里先把帧减半（每帧约 2.2KB PCM → 单条消息约 3KB）作为兼容兜底。
// 后端缓冲调到 1MB 之后，可以把这个值改回 4（帧大一些、消息更少，上行更省）。
const FRAME_KB = 2

// ---------- VAD（语音活动检测）：只在用户真正说话时上行音频帧 ----------
// 为什么要做（2026-10-02）：
//   之前「每帧都发」= 用户不说话时也在持续上行静音，后端 ASR 一直在工作（空转），
//   既费流量，又容易撞上上游语音服务「长时间无有效语音」的空闲超时
//   （真机日志里 `← error Connection reset by peer` 正发生在 AI 长 TTS 之后）。
//   现在：本地逐帧算能量，静音帧**不上行**；只有语音段（含尾部静音）才发。
// 算法（纯 JS；每帧 1280 采样 ≈ 80ms，12.5 帧/秒，开销可忽略）：
//   1) 算帧 RMS 能量，与**自适应门限**比较（门限 = 噪声底 × VAD_GATE_MULT，且不低于 VAD_MIN_GATE）；
//   2) 「连续 VAD_START_FRAMES 帧超门限」才判定开口；「连续 VAD_END_FRAMES 帧低于门限」才判定说完；
//      连续计数是为了不被单个爆音/咔嗒声触发，也不被字间停顿提前截断；
//   3) 开口前缓存 VAD_PRE_ROLL_MAX 帧前导，判定开口时一并补发 —— 否则「喂」字的起音会被切掉；
//   4) 说完后那 VAD_END_FRAMES 帧静音**照常发出**：后端 ASR 靠尾点静音才能出 asr_final，别省这 1 秒；
//   5) 之后转为空闲：帧连 base64 都不做，直接丢弃（省 CPU 也省 WS 流量）。
// 注意：AI 说话期间（speaking）不走这里，而是走下面的 detectBargeIn（语音打断）；
// 用户插话成功时 VAD 会被直接置成 speech，接着把这一句听完，中间不会有缝。
const VAD_ENABLED = true       // false = 退回旧行为（每帧都发）；编译期硬关，改这里要重新构建
// 【采集策略（2026-10-03 起本页只有一种）】按住说话（PTT）：麦克风只在按住期间开。
// 「常录 + VAD + 语音打断」的免按住模式已整体迁到独立页 pages/videocall（与摄像头一起），
// 本页帧回调里的「非按住期间收到帧 = 上一次 stop 没落地的残留」判断因此简化为硬规则。
// 运行时开关（真机免重建做 A/B 对照）：真机调试面板执行 wx.setStorageSync('VAD_OFF', 1) 后重进通话
// 即退化为「每帧都发」，wx.removeStorageSync('VAD_OFF') 恢复。
// ⚠️ 注意：闸门（callOn/muted）在 VAD **之前**，所以这个对照能排除「门限/状态机」因素，
// 但排除不了「闸门卡死」——那种情况下关掉 VAD 第二句照样不识别。
let vadOff = false             // beginCall 时从 storage 读一次（见 beginCall）
const VAD_START_FRAMES = 3     // 连续 3 帧 ≈ 240ms 超门限 → 判定开口
const VAD_END_FRAMES = 12      // 连续 12 帧 ≈ 1 秒低于门限 → 判定说完（这 1 秒静音就是给后端的尾点）
const VAD_PRE_ROLL_MAX = 6     // 最多回补 6 帧 ≈ 480ms 前导
const VAD_GATE_MULT = 2.5      // 门限 = 噪声底 × 2.5（约 +8dB）
const VAD_MIN_GATE = 400       // 门限绝对下限（PCM 16bit 幅度 RMS）：环境极静时别被呼吸/衣料摩擦触发
const VAD_IDLE_WARN = 100      // 连续 100 帧 ≈ 8 秒没开口 → 打一条自证日志（防「VAD 把话全吃了」）
let noiseFloor = 300           // 噪声底估计（只在静音帧上慢速跟随环境）
let vadState = 'idle'          // 'idle' 未说话（暂不上行） | 'speech' 说话中（语音 + 尾静音持续上行）
let vadAbove = 0               // 连续超门限帧数
let vadBelow = 0               // 连续低于门限帧数
let preRoll = []               // 开口前的前导帧缓存（ArrayBuffer，未发送）
let vadIdleFrames = 0          // 连续空闲帧数（只有用于「一直不开口」的自证日志）
let vadWarned = false
let vadSent = 0                // 本通已上行音频帧数（挂断时打统计）
let vadSkipped = 0             // 本通因静音跳过的帧数

function resetVad(clearStats) {
  vadState = 'idle'
  vadAbove = 0
  vadBelow = 0
  preRoll = []
  vadIdleFrames = 0
  vadWarned = false
  if (clearStats) { vadSent = 0; vadSkipped = 0; noiseFloor = 300 }
}

// 一帧的 RMS 能量（PCM 16bit 小端）。只读不改；长度非偶数时按采样数截断。
function frameRms(buf) {
  const n = buf.byteLength >> 1
  if (!n) return 0
  const d = new DataView(buf)
  let sum = 0
  for (let i = 0; i < n; i++) {
    const v = d.getInt16(i << 1, true)
    sum += v * v
  }
  return Math.sqrt(sum / n)
}

// ---------- 语音打断（barge-in）：搭子正在说话时，用户直接开口就把它打断 ----------
// 难点：麦克风必然收到扬声器里搭子的声音（回声），固定门限没用——你一开口，"回声"也跟着变大。
// 做法：在本段 TTS 播放期间先估一个「回声基线」（逐帧 EMA），只有当前帧能量**明显高于基线**
// （×BARGE_MULT 且过绝对下限）且连续 BARGE_FRAMES 帧都超时，才认定为「人在插话」。
// 判定成立后：① 停掉 TTS（见 interrupt）；② 把这期间缓存的前导帧补发给后端 ASR；
// ③ 把 VAD 置成 speech 继续上行 —— 插话的起音不会丢，后端能听全这一句。
const BARGE_MULT = 1.8       // 当前帧能量 > 回声基线 ×1.8 才算「有人在说话」（约 +5dB）
const BARGE_MIN_RMS = 700    // 绝对下限：回声很小、环境很静时，别被呼吸声/衣料摩擦触发
const BARGE_FRAMES = 5       // 连续 5 帧 ≈ 400ms 超基线 → 判定插话（单次爆音、敲屏幕都不算）
const BARGE_PREROLL = 8      // 补发给后端的前导帧上限（≈640ms，把插话的起音一起带上）
let echoBase = 0             // 回声能量基线（本段 TTS 期间的 EMA）
let echoSeen = 0             // 基线已估过多少帧（头几帧只用来起步，避免拿第一帧当基线）
let bargeAbove = 0           // 连续超基线帧数
let bargeBuf = []            // 最近几帧原声（尚未上行），判定插话后补发

function resetBarge() {
  echoBase = 0
  echoSeen = 0
  bargeAbove = 0
  bargeBuf = []
}

function detectBargeIn(buf) {
  const rms = frameRms(buf)
  echoBase = echoBase ? echoBase * 0.8 + rms * 0.2 : rms   // 慢速跟随：人插话那几帧改不动它
  echoSeen++
  bargeBuf.push(buf)
  if (bargeBuf.length > BARGE_PREROLL) bargeBuf.shift()
  if (echoSeen < 3) return            // 头 3 帧只用来把基线立起来（此时搭子刚开口）
  const gate = Math.max(BARGE_MIN_RMS, echoBase * BARGE_MULT)
  if (rms >= gate) {
    bargeAbove++
    if (bargeAbove >= BARGE_FRAMES) interruptByVoice()
  } else {
    bargeAbove = 0
  }
}

function interruptByVoice() {
  const frames = bargeBuf.slice()
  console.log('[call] 检测到用户插话 → 打断搭子（补发前导', frames.length, '帧）｜回声基线', Math.round(echoBase))
  interrupt('语音打断')
  // 打断后这几帧已经录进来了：先补发，再从 speech 状态接着上行（后端 ASR 才能听全这一句）
  vadState = 'speech'
  vadBelow = 0
  vadIdleFrames = 0
  vadWarned = false
  vadSent += frames.length
  frames.forEach(b => sendAudio(abToBase64(b)))
}

// VAD 主逻辑：入参是一帧原始 PCM
function pushViaVad(buf) {
  if (!VAD_ENABLED || vadOff) { vadSent++; sendAudio(abToBase64(buf)); return }
  const rms = frameRms(buf)
  const gate = Math.max(VAD_MIN_GATE, noiseFloor * VAD_GATE_MULT)

  // 噪声底只在「安静帧」上慢速跟随：门限于是能适应空调声/地铁声，而不会被说话声带跑
  if (rms < gate) noiseFloor = noiseFloor * 0.95 + rms * 0.05

  if (vadState === 'idle') {
    if (rms >= gate) {
      vadAbove++
      preRoll.push(buf)
      if (preRoll.length > VAD_PRE_ROLL_MAX) preRoll.shift()
      if (vadAbove >= VAD_START_FRAMES) {
        // 开口：先把前导补上（含当前帧），再进入 speech
        vadState = 'speech'
        vadBelow = 0
        vadIdleFrames = 0
        const lead = preRoll.length
        console.log('[call] VAD 开口 → 开始上行（回补前导', lead, '帧）｜rms', Math.round(rms),
          '｜门限', Math.round(gate), '｜噪声底', Math.round(noiseFloor))
        preRoll.forEach(b => { vadSent++; sendAudio(abToBase64(b)) })
        preRoll = []
        return   // 当前帧已随前导发出，别重复发
      }
    } else {
      vadAbove = 0
      preRoll = []   // 静音期间不留前导（否则可能把几秒前的杂音当成句首补发）
    }
    // 仍在等开口：这帧不上行
    vadSkipped++
    vadIdleFrames++
    if (!vadWarned && vadIdleFrames >= VAD_IDLE_WARN) {
      vadWarned = true
      console.warn('[call] VAD 连续约 8 秒未检测到语音，音频帧未上行：最近 rms', Math.round(rms),
        '/ 门限', Math.round(gate), '——若你确实在说话，说明门限偏高或麦克风增益低（调 VAD_MIN_GATE）')
    }
    return
  }

  // speech：语音帧与尾部静音都发（尾静音是给后端 ASR 做尾点检测用的，别省）
  vadSent++
  sendAudio(abToBase64(buf))
  if (rms >= gate) {
    vadBelow = 0
  } else {
    vadBelow++
    if (vadBelow >= VAD_END_FRAMES) {
      console.log('[call] VAD 说完 → 暂停上行（已发尾部静音', VAD_END_FRAMES, '帧）｜累计上行', vadSent,
        '帧 / 静音跳过', vadSkipped, '帧')
      vadState = 'idle'
      vadAbove = 0
      vadBelow = 0
      preRoll = []
      vadIdleFrames = 0
      vadWarned = false
    }
  }
}

function startRecorder() {
  if (!recMgr) {
    recMgr = Taro.getRecorderManager()
    // onStart = 录音器真的开始录了（比「首帧」更早一点的权威信号，用来消掉「启动中」态）
    recMgr.onStart(() => { recActive = true; recStarting = false })
    recMgr.onFrameRecorded(res => {
      if (!res || !res.frameBuffer) return
      recActive = true      // 有帧 = 录音器确实在录：这是最可信的「实际状态」信号
      recStarting = false
      frameCount++
      // 【第一帧日志】这条一打，就证明「麦克风 + 录音链路」是通的（与 WS 无关）。
      // 整通电话一条都不打 → 回①查麦克风授权 / mp 后台《隐私保护指引》，不用怀疑后端。
      if (frameCount === 1) {
        console.log('[call] 第一帧音频已拿到，大小', res.frameBuffer.byteLength, '字节；闸门', {
          callOn: callOn.value, muted: muted.value, speaking, wsOpen: isSocketOpen()
        })
      }
      if (!callOn.value || muted.value) {
        // 诊断：帧确实录到了，但被闸门拦下不发送。
        // 打点策略＝「原因变化时打一条 + 同一原因每 5 秒补一条心跳」：
        // 原因持续不变却在刷屏，就是持续性故障（例如闸门卡死导致麦克风等于关闭）。
        const reason = !callOn.value ? '已挂断(callOn)' : '已静音(muted)'
        const now = Date.now()
        if (reason !== blockReason || now - blockLoggedAt > 5000) {
          blockReason = reason
          blockLoggedAt = now
          console.log('[call] 音频帧被拦下，未上推（第', frameCount, '帧）：', reason,
            '｜本次已连续拦截', blockFrames, '帧 ｜ wsOpen', isSocketOpen())
        }
        blockFrames++
        return
      }
      // PTT：麦克风只在按住期间工作。松手后还收到帧 = 上一次 stop 尚未落地（残留帧）
      // → 直接丢弃（否则会刷「8 秒未检测到语音」，更糟的是把扬声器里小沃的声音当用户说话录回去）。
      if (!pttOn.value) return
      if (speaking && !(ttsPausedOn.value && Date.now() >= pauseMicAt)) {
        // 搭子正在说话：默认不上行（否则把扬声器里它的声音录回去＝自问自答），
        // 但要「听」用户有没有插话——命中就当场把它打断（见 detectBargeIn）。
        // 🔴 例外＝用户点了暂停（2026-10-06 需求）：小沃不出声了，麦克风放行，用户说话要能被识别。
        detectBargeIn(res.frameBuffer)
        return
      }
      // 闸门放行：清掉拦截状态，下次再被拦会重新打一条（含最新原因）
      blockReason = ''
      blockFrames = 0
      // 按住说话（PTT）：按住期间的帧全部上行——用户明确在说话，不需要 VAD 门限判音量
      if (pttOn.value) { sendAudio(abToBase64(res.frameBuffer)); return }
      // 旧「常录 + VAD」路径保留：PTT 模式下录音只在按住期间开，这条正常到不了（防御性保留）
      pushViaVad(res.frameBuffer)
    })
    // duration 上限 10 分钟，到点会自动 stop → 通话没结束就续录（长通话必需）
    // recStopping 用来区分「自动到点停」和「我们主动停」：主动停（挂断 / 静音）不续录，
    // 否则 stop() 后 onStop 稍后才到，会把刚重新启动的录音再启一次（重复 start）
    recMgr.onStop(() => {
      recRunning = false
      recActive = false
      recStarting = false
      const explicit = recStopping
      recStopping = false
      // 等 onStop 再重启（start 时发现录音器还在录而挂起的重启）：优先级最高，
      // 它代表「用户已经按住麦克风在等」，不能被下面的续录判断吃掉。
      const deferred = recResumeAfterStop
      recResumeAfterStop = false
      // 续录条件：PTT 下只有「还按着」才值得续录（松手后系统又补一个 onStop 的话，
      // 续录等于把麦克风偷偷打开）
      const resume = deferred || (!explicit && callOn.value && !muted.value && pttOn.value)
      // 【中断可见化】录音中途被停过一次，是「通话里有音频缺口」的唯一线索：
      // 最典型的成因是**播放 TTS 与录音抢音频通道**（微信里放音频会打断录音），
      // stop 到重新 start 之间那几百毫秒的音频接不回来 —— 用户会感觉「搭子漏听了半句」。
      // 主动停（挂断 / 静音）不续录，其余情况自动续录。
      console.log('[call] 录音已停止：', explicit ? '我们主动停' : '被系统/播放打断',
        '｜', resume ? (deferred ? '按需重启（上一次 start 被挂起）' : '自动续录') : '不续录')
      if (resume) startRecorder()
    })
    recMgr.onError(err => {
      recStarting = false
      recRunning = false
      const msg = (err && err.errMsg) || ''
      if (/is recording/i.test(msg)) {
        // 「已在录制」= 录音器实际还在跑，只是我们以为它停了。
        // 关键：把 recActive 置真，让后续 stopRecorder 能真的停掉它 —— 否则麦克风泄漏到挂断之后。
        recActive = true
        console.warn('[call] 录音器已在录制（重复 start 被拒）：沿用既有录制，稍后 stop 会真正停掉它')
        return
      }
      recActive = false
      callNote.value = '录音启动失败：检查麦克风授权（mp 后台《隐私保护指引》需勾选麦克风）'
      console.warn('[call] 录音启动/录制失败：', err)
    })
  }
  if (recRunning || recStarting) return
  if (recActive) {
    // 状态错位：录音器实际在录，但我们的意图标记是「没在录」（上一次 stop 还没落地 / 上次 start 被拒）。
    // 直接再 start 一定被拒（audio is recording）→ 先停，等 onStop 到达后自动重启。
    recResumeAfterStop = true
    recStopping = true
    try { recMgr.stop() } catch (e) { /* 未在录制 */ }
    console.warn('[call] 录音器仍在录制（状态不同步）→ 先停，等 onStop 后自动重启')
    return
  }
  recRunning = true
  recStarting = true
  resetVad(false)   // 每次真正启动录音都从干净状态开始（静音键关了再开、长通话续录同理）
  console.log('[call] recMgr.start() 录音启动：16k/单声道/PCM/', FRAME_KB, 'KB 帧')
  recMgr.start({ duration: 600000, sampleRate: 16000, numberOfChannels: 1, format: 'PCM', frameSize: FRAME_KB, encodeBitRate: 24000 })
  // 兜底：start 后 3 秒既没 onStart/首帧、也没 onError（录音器被别的 App 占用时会静默不响应）
  // → 复位「启动中」，否则 recStarting 会永久为真，之后所有 start 都被去重挡掉（麦克风从此哑掉）
  clearTimeout(recStartGuard)
  recStartGuard = setTimeout(() => {
    if (recStarting) {
      recStarting = false
      recRunning = false
      console.warn('[call] 录音 3 秒内未进入录制状态（onStart/首帧/onError 都没来）→ 复位，可重按麦克风重试')
    }
  }, 3000)
}

function stopRecorder() {
  recResumeAfterStop = false
  clearTimeout(recStartGuard)
  // 停的条件用「实际在录 || 意图在录 || 正在启动」三者取或：只看意图就会出现
  // 「意图 false、实际在录」时停不掉（=麦克风泄漏，真机踩过）
  if (recMgr && (recRunning || recActive || recStarting)) {
    recStopping = true          // 标记为主动停：onStop 里据此跳过自动续录
    try { recMgr.stop() } catch (e) { /* 未在录制 */ }
  }
  recRunning = false
  recStarting = false
}

function toggleMute() {
  muted.value = !muted.value
  if (muted.value) stopRecorder()   // 静音：立即停录（若正按着说话，pttEnd 松手时也会再兜一层）
  // 取消静音不立刻开录：按住说话模式里，麦克风只在按住期间工作（下次 pttStart 启动）
}

// ---------- 按住说话（PTT，2026-10-03）：长按录、松手发、上滑取消（微信语音同款手势） ----------
// 与旧「常录 + VAD」的差异：录音只在按住期间开（省电，也从根上避开播放 TTS 抢音频通道的问题）；
// 松手补发一小段静音尾帧，让后端 ASR 立刻出尾点（否则要等它自己的静音超时，慢 1 秒以上）。
const pttOn = ref(false)       // 正在按住麦克风
const pttCancel = ref(false)   // 手指上滑超过阈值：松手取消
let pttStartY = 0              // 按下时的触点 Y（算上滑距离）
let pttStartAt = 0             // 按下时间戳（按太短 = 误触，直接丢弃）
let pttGuard = false           // 取消保护期：吞掉后端对残句的 asr/tts 回包
let pttGuardAt = 0
const PTT_CANCEL_PX = 80       // 上滑多少 px 算「取消」
const PTT_MIN_MS = 400         // 按住短于这个时长视为误触

function pttStart(e) {
  if (pttOn.value) return     // 已按住：重复的 touchstart（多指/手势重入）不再重启录音，避免白造一次音频缺口
  if (!callOn.value) { Taro.showToast({ title: '通话已结束，重新发起再聊', icon: 'none' }); return }
  if (muted.value) { Taro.showToast({ title: '已静音：点右上角麦克风恢复收音', icon: 'none' }); return }  const t = e && e.touches && e.touches[0]
  pttStartY = t ? t.clientY : 0
  pttStartAt = Date.now()
  pttCancel.value = false
  pttGuard = false          // 新的一按开始，上一句的取消保护期作废
  pttOn.value = true
  if (speaking) interrupt('按住说话')   // 按下即插话：停掉 TTS、把麦克风还回来
  callNote.value = ''
  startRecorder()
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
  stopRecorder()
  // 取消 / 按太短：丢掉这半句。录音已停、尾帧不发，后端拿不到「说完」信号一般不会出 final；
  // 但部分 ASR 会对残句超时出 final → 开保护期把回包吞掉，避免「取消了却有回答」。
  if (pttCancel.value || Date.now() - pttStartAt < PTT_MIN_MS) {
    armPttGuard()
    callNote.value = pttCancel.value ? '已取消发送' : '说话时间太短，按住再说'
    return
  }
  flushAsr()
}

function armPttGuard() {
  pttGuard = true
  pttGuardAt = Date.now()
}

// 保护期是否生效（超过 6 秒自动失效：之后来的同文案是用户真又说了一遍）
function pttGuardActive() {
  if (!pttGuard) return false
  if (Date.now() - pttGuardAt > 6000) { pttGuard = false; return false }
  return true
}

// 静音尾帧：0.5 秒全零 PCM（8 帧 × FRAME_KB），冒充「用户说完闭嘴」促后端 ASR 出尾点
function flushAsr() {
  for (let i = 0; i < 8; i++) sendAudio(abToBase64(new ArrayBuffer(FRAME_KB * 1024)))
  console.log('[call] 松手发送：补发 8 帧静音尾帧，促后端 ASR 出尾点')
}

// ---------- 视频通话：独立页 pages/videocall（2026-10-03 从本页浮层迁出） ----------
// 迁出原因：camera 原生组件挂在全屏浮层里反复进出，原生渲染层回收不及时，
// 会留下「灰色大椭圆 + 漂浮摄像头图标」的幽灵层（真机/工具截图实锤，v-if 卸载 vdom 救不了原生层）。
// 本页从此不挂摄像头：入口卡「视频通话」= 选攻略后跳独立页；通话中点摄像头钮 = 挂断当前语音通话再跳。
const currentCallTripId = ref('')   // 当前通话绑定的攻略（beginCall 写入，切视频页时带过去）

// 通话中切换到视频页：先挂断（释放录音/WS/tabBar），再把 tripId 带过去重新拨
function switchToVideo() {
  const tid = currentCallTripId.value
  if (!tid) { Taro.showToast({ title: '先发起通话，再切到视频', icon: 'none' }); return }
  hangUp()
  Taro.navigateTo({ url: '/pages/videocall/videocall?tripId=' + encodeURIComponent(tid) })
}

// ArrayBuffer → base64：优先用微信原生实现（C++ 层），不可用时手写兜底（音频帧每秒 8 个，够用）
const B64_TABLE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'
function abToBase64(buf) {
  if (typeof wx !== 'undefined' && wx.arrayBufferToBase64) return wx.arrayBufferToBase64(buf)
  const bytes = new Uint8Array(buf)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const b0 = bytes[i]
    const b1 = i + 1 < bytes.length ? bytes[i + 1] : 0
    const b2 = i + 2 < bytes.length ? bytes[i + 2] : 0
    out += B64_TABLE[b0 >> 2] + B64_TABLE[((b0 & 3) << 4) | (b1 >> 4)]
    out += i + 1 < bytes.length ? B64_TABLE[((b1 & 15) << 2) | (b2 >> 6)] : '='
    out += i + 2 < bytes.length ? B64_TABLE[b2 & 63] : '='
  }
  return out
}

// ---------- 通话计时 ----------
function startCallTimer() {
  stopCallTimer()
  timerId = setInterval(() => { callSeconds.value++ }, 1000)
}
function stopCallTimer() {
  if (timerId) { clearInterval(timerId); timerId = null }
}

// ---------- 位置上报：已按后端协议恢复（2026-10-04） ----------
// 分两层：① 通话开始那一刻的坐标随 start 下发（见 beginCall 传入的 lat/lng）；
//        ② 通话中每 5 秒一条 location —— 由 callSocket.startLocLoop() 统一负责，
//           guide / videocall 两页共用同一份实现，页面侧不需要自己起定时器。
// 关掉：storage 置 LOC_OFF=1（真机 A/B 对照、省电），或 connectCall({ trackLocation: false })。
// 历史：2026-10-02 曾整体下线（只在 start 里发一次），2026-10-04 后端协议重新列出 location 后恢复。
</script>

<style>
/* 自定义 tabBar 悬浮底部：底部留白防遮挡（全局 .wrap 只有 64rpx） */
.wrap { padding-bottom: calc(240rpx + env(safe-area-inset-bottom)); }

/* ================= AI 搭子通话层（白底对话式，参考 Helpy 设计稿 2026-10-03） ================= */
/* z-index 2000：压过自定义 tabBar（999/1000）与地图 canvas */
.call-layer {
  position: fixed; left: 0; top: 0; right: 0; bottom: 0;
  z-index: 2000;
  background: #FFFFFF;
  padding: 32rpx 32rpx calc(28rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
  display: flex; flex-direction: column;
}
/* 头部两行（2026-10-03 用户指定）：容器改纵向，每行各自 flex 互不挤压 */
.hero { display: block; }
.hero-row { display: flex; align-items: center; gap: 18rpx; }
.hero-row + .hero-row { margin-top: 22rpx; }
/* 第一行右侧的弹簧：把静音/挂断推到最右 */
.hero-spring { flex: 1; }
.hero-av {
  width: 92rpx; height: 92rpx; border-radius: 28rpx; flex-shrink: 0;
  background: #F4F5F7;
  display: flex; align-items: center; justify-content: center;
}
/* 说话中：一圈静态绿色描边（一眼看出「它在出声」）。
   【2026-10-03】原来是 box-shadow 动画（heroBreath 呼吸光晕）——真机调试的合成器
   把这个动画渲染成了一整块灰色大椭圆盖在头部（截图实锤），box-shadow 动画在小程序真机上
   是重灾区，改成纯静态样式，不再有任何 keyframes */
.hero-av.live { box-shadow: 0 0 0 8rpx rgba(34, 197, 94, 0.22); }
.hero-ico { width: 50rpx; height: 50rpx; }
/* 名字/状态区：可被压缩到 0 的弹性块（右上按钮组固定不缩），锁死溢出 + 单行省略，
   就算将来再加按钮也只会出省略号，不会出现「一字一行竖排」 */
.hero-main { flex: 1; min-width: 0; overflow: hidden; }
.hero-name { font-size: 34rpx; font-weight: 700; color: #1A1A1A; }
/* 演示模式小灰标（名字右侧） */
.hero-tag {
  margin-left: 12rpx; font-size: 20rpx; font-weight: 400; color: #9AA3A0;
  background: #F4F5F7; border-radius: 999rpx; padding: 4rpx 14rpx; vertical-align: 4rpx;
}
.hero-sub { margin-top: 4rpx; font-size: 24rpx; color: #9AA3A0; line-height: 1.45; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
/* 头部圆形操作钮：浅灰底（参考稿）。挂断/静音已下移到底栏，这里只剩返回、摄像头、打断 */
.hero-btn {
  flex-shrink: 0; width: 84rpx; height: 84rpx; border-radius: 50%;
  background: #F4F5F7;
  display: flex; align-items: center; justify-content: center;
}
.hb-ico { width: 36rpx; height: 36rpx; }
/* 返回键：右箭头图标旋转 180° 成左箭头（复用现有图标，不新增资源） */
.back-ico { transform: rotate(180deg); }
/* 打断/暂停键：最终形态 = 气泡旁一颗「暂停/播放」圆键（.msg-pp），下方独立「打断」胶囊已删（2026-10-06） */
/* 细状态行：连接状态圆点 + 计时（左右分布） */
.hero-meta { display: flex; align-items: center; margin-top: 16rpx; }
.call-state { display: flex; align-items: center; gap: 12rpx; font-size: 22rpx; color: #9AA3A0; }
.call-dot { width: 12rpx; height: 12rpx; border-radius: 50%; background: #C6CCC9; }
.call-dot.open { background: #22C55E; animation: callPulse 1.2s ease-in-out infinite; }
.call-dot.connecting { background: #E8B04B; }
.call-dot.error { background: #E5484D; }
@keyframes callPulse { 0%, 100% { opacity: 0.35; } 50% { opacity: 1; } }
.call-timer {
  margin-left: auto; font-size: 22rpx; color: #9AA3A0;
  font-family: 'DIN Alternate', sans-serif;
}
/* 通话层顶部：当前绑定的攻略（让用户知道搭子在读哪一份） */
.hero-trip {
  margin-top: 18rpx; align-self: flex-start;
  display: flex; align-items: center; gap: 8rpx;
  font-size: 22rpx; color: #6B7280;
  background: #F4F5F7;
  border-radius: 999rpx; padding: 10rpx 20rpx;
}
.ct-ico { width: 24rpx; height: 24rpx; flex-shrink: 0; }
/* 头部与对话区之间的分隔线（参考稿有一条浅灰细线） */
.hero-line { margin-top: 24rpx; height: 2rpx; background: #F0F1F3; }

/* 对话记录：吃掉中间的全部剩余高度 */
.talk { flex: 1; min-height: 0; margin-top: 28rpx; }
/* 每条消息 = 气泡 + 下方时间戳，整列靠左（AI）或靠右（我） */
.msg { display: flex; flex-direction: column; margin-bottom: 26rpx; }
.msg.me { align-items: flex-end; }
.msg.ai { align-items: flex-start; }
.bubble {
  max-width: 76%; font-size: 28rpx; line-height: 1.65;
  border-radius: 28rpx; padding: 22rpx 28rpx; word-break: break-all;
  box-sizing: border-box;
}
/* 我发的：浅灰气泡深色字（右）；搭子的：黑气泡白字（左）——配色对齐参考稿 */
.msg.me .bubble { background: #F2F3F5; color: #262B2E; border-top-right-radius: 8rpx; }
.msg.ai .bubble { background: #1A1A1A; color: #FFFFFF; border-top-left-radius: 8rpx; }
/* 气泡行：气泡 + 旁边的暂停/播放键。宽度 100% 定宽，气泡的 76% 上限才有确定参照（否则收缩成 auto） */
.msg-row { display: flex; align-items: flex-end; width: 100%; }
.msg.ai .msg-row { justify-content: flex-start; }
.msg.me .msg-row { justify-content: flex-end; }
/* 暂停 / 播放键：贴在气泡右侧的小圆钮（暂停后同一颗键切成播放符） */
.msg-pp {
  flex-shrink: 0; margin-left: 14rpx; width: 60rpx; height: 60rpx; border-radius: 50%;
  background: #22C55E;
  display: flex; align-items: center; justify-content: center;
}
.pp-ico { width: 26rpx; height: 26rpx; }
.msg-pp-hover { opacity: 0.82; }
.msg-time { margin-top: 8rpx; font-size: 20rpx; color: #B3BAB6; }
/* 手动打断入口已收敛：由气泡旁的暂停/播放键承担（暂停即闭嘴），语音/插话路径仍走 interrupt() */
.talk-empty { padding: 40rpx 0; text-align: center; font-size: 26rpx; color: #B3BAB6; }
.talk-end { height: 2rpx; }

/* 底部操作区（2026-10-05 照「平时打电话」改版）：三格等宽 —— 左「按住说话」、正中大号红色挂断、右「静音」。
   flex:1 保证正中格始终卡在屏幕中线；align-items:flex-start 让三方胶囊顶对齐，按钮大小不同也不歪 */
.talk-bar { margin-top: 20rpx; display: flex; align-items: flex-start; justify-content: center; }
.tb-slot { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 10rpx; }
.tb-label { font-size: 20rpx; color: #9AA3A0; line-height: 1.2; }
.tb-mic {
  flex-shrink: 0; width: 112rpx; height: 112rpx; border-radius: 36rpx;
  background: #1A1A1A;
  display: flex; align-items: center; justify-content: center;
}
/* 按住说话中：变绿（明确「正在录音」） */
.tb-mic.hold { background: #22C55E; }
.tb-mic-ico { width: 42rpx; height: 42rpx; }
/* 正中挂断键：大号红圆（比两侧按钮大一圈，一眼是主操作，位置与手感都对齐系统电话） */
.tb-hang {
  flex-shrink: 0; width: 136rpx; height: 136rpx; border-radius: 50%;
  background: #E5484D;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 10rpx 24rpx rgba(229, 72, 77, 0.26);
}
.tb-hang-hover { opacity: 0.82; }
.tb-hang-ico { width: 58rpx; height: 58rpx; }
/* 静音（原头部小圆钮下移）：浅灰圆；已静音时淡红底 + 红话筒 */
.tb-mute {
  flex-shrink: 0; width: 96rpx; height: 96rpx; border-radius: 50%;
  background: #F4F5F7;
  display: flex; align-items: center; justify-content: center;
}
.tb-mute.off { background: #FDECEC; }
.tb-mute-ico { width: 40rpx; height: 40rpx; }

/* 按住说话提示层：盖住通话层（按住期间屏蔽其他点击），中央一块黑胶提示；上滑变红 = 取消 */
.ptt-mask {
  position: absolute; left: 0; top: 0; right: 0; bottom: 0;
  z-index: 30;
  display: flex; align-items: center; justify-content: center;
  background: rgba(255, 255, 255, 0.72);
}
.ptt-tip {
  display: flex; flex-direction: column; align-items: center; gap: 20rpx;
  background: #1A1A1A; border-radius: 28rpx; padding: 48rpx 72rpx;
  color: #FFFFFF; font-size: 30rpx; font-weight: 500;
}
.ptt-tip.cancel { background: #E5484D; }
.ptt-ico { width: 64rpx; height: 64rpx; }

.call-note {
  margin-top: 16rpx; min-height: 36rpx;
  font-size: 22rpx; color: #B3BAB6; text-align: center; line-height: 1.5;
}
/* 选行程弹层（进通话前）：z-index 要高于通话层 2000，否则会被压在下面 */
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
