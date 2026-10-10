<template>
  <!-- 视频通话页（2026-10-03 从 guide 通话层迁出为独立页面）：
       常录 + 全帧上行语音（VAD 默认关闭 = 回退 10-02 下午跑通的方案；storage 存 VAD_ON=1 可重新开启门限）+ 打字提问 + 摄像头 1fps 截帧识别景点。
       独立页面的意义：camera 原生组件不再挂在 guide 的全屏浮层里 —— 之前在浮层里反复进出，
       原生渲染层回收不及时（v-if 卸了 vdom 但原生层还压在页面上），就是截图里那块「灰色大椭圆 + 漂浮摄像头图标」。
       页面级挂载 + onUnload 收尾，生命周期干净。 -->
  <view class="vc-page">
    <!-- 取景框：占屏上半部；识别结果信息带放在 camera **外面**（原生组件同层渲染在低版本基础库不可靠）；
         videoOff = 只留语音：v-show 隐藏画面 + 停掉截帧循环（camera 保持挂载，避免原生组件反复重建） -->
    <view class="cam-box" :class="{ hide: videoOff }">
      <camera class="cam" device-position="back" flash="off" @error="onCamError" />
      <view class="cam-strip">
        <view class="cam-spot" v-if="lastSpot">
          <text class="cam-spot-tag">识别到</text>
          <text class="cam-spot-name">{{ lastSpot }}</text>
        </view>
        <view class="cam-spot" v-else-if="lastDesc">
          <text class="cam-spot-tag">看到</text>
          <text class="cam-spot-name">{{ lastDesc }}</text>
        </view>
        <text class="cam-hint" v-else>把镜头对准想问的东西，小沃看到了就会说</text>
        <view class="cam-ask" v-if="lastSpot" @tap="askNarrate"><image class="cam-ask-ico" :src="ICO.volume" mode="aspectFit" />听听讲解</view>
      </view>
    </view>

    <!-- 状态行：连接状态 + 计时（操作键已下移到底栏，2026-10-05 照「平时打电话」改版） -->
    <view class="meta">
      <view class="call-state"><view class="call-dot" :class="callStatus"></view><text>{{ callStateText }}</text></view>
      <text class="call-timer">{{ callTimeText }}</text>
    </view>
    <view class="trip-pill" v-if="tripLabel"><image class="tp-ico" :src="ICO.mapPinG" mode="aspectFit" />已绑定：{{ tripLabel }}</view>

    <!-- 对话时间线（与语音通话页同一套：识别原话 / 搭子回答 / 打的字） -->
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
      <view class="talk-empty" v-if="!msgs.length">{{ talkEmptyHint }}</view>
      <view class="talk-end" id="talkEnd"></view>
    </scroll-view>

    <!-- 底部：语音状态 + 「打电话式」操作区（左 画面开关 / 正中大号红色挂断 / 右 静音）。
         打字输入框已撤（2026-10-04）：打字去独立页 pages/chat（REST /api/guide/chat-text），本页只留语音 + 摄像头 -->
    <view class="talk-bar">
      <view class="tb-live"><view class="tb-live-dot" :class="{ live: callStatus === 'open' }"></view><text>语音已开启 · 直接说</text></view>
    </view>
    <view class="ctrl-bar">
      <view class="tb-slot">
        <view class="tb-side" :class="videoOff ? 'off' : 'on'" @tap="toggleVideo"><image class="tb-side-ico" :src="videoOff ? ICO.cameraOff : ICO.camera" mode="aspectFit" /></view>
        <text class="tb-label">{{ videoOff ? '开画面' : '关画面' }}</text>
      </view>
      <view class="tb-slot">
        <view class="tb-hang" hover-class="tb-hang-hover" @tap="exitPage"><image class="tb-hang-ico" :src="ICO.phoneOffWhite" mode="aspectFit" /></view>
        <text class="tb-label">挂断</text>
      </view>
      <view class="tb-slot">
        <view class="tb-side" :class="muted ? 'off' : 'on'" @tap="toggleMute"><image class="tb-side-ico" :src="muted ? ICO.micOff : ICO.mic" mode="aspectFit" /></view>
        <text class="tb-label">{{ muted ? '已静音' : '静音' }}</text>
      </view>
    </view>
    <view class="call-note">{{ callNote }}</view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import Taro, { useLoad, useUnload } from '@tarojs/taro'
import { base64ToTempFile, fileToBase64 } from '../../utils/file'
import { getPosition } from '../../utils/position'
import { connectCall, sendAudio, sendFrame, sendNarrate, hangUp as closeCallSocket, isSocketOpen } from '../../services/callSocket'
import chevronRt from '../../assets/icons/chevron-right.png'
import micWt from '../../assets/icons/mic-white.png'
import micOffWhite from '../../assets/icons/mic-off-white.png'      // 白色斜线麦：红底 off 态专用
import cameraOffWhite from '../../assets/icons/camera-off-white.png' // 白色斜线相机：红底「画面已关」专用
import phoneOffWhite from '../../assets/icons/phone-off-white.png'  // 底栏正中大挂断键（红圆 + 白话筒）
import mapPinG from '../../assets/icons/map-pin-green.png'
import volumeGreen from '../../assets/icons/volume-green.png'
import cameraWhite from '../../assets/icons/camera-white.png'  // 「画面开关」：关掉后只留语音通话
import pauseWhite from '../../assets/icons/pause-white.png'    // 暂停键 / 打断键（白暂停符，绿底）
import playWhite from '../../assets/icons/play-white.png'      // 暂停后同一颗键变「播放」（续播）

const ICO = { back: chevronRt, mic: micWt, micOff: micOffWhite, phoneOffWhite, mapPinG, volume: volumeGreen, camera: cameraWhite, cameraOff: cameraOffWhite, pauseW: pauseWhite, playW: playWhite }

// ---------- 对话时间线（与 guide 页同一套逻辑：partial 就地改写、final 锁定、回显吞并） ----------
const msgs = ref([])
// 「小沃正在说的那句」= 时间线上最后一条 AI 消息；打断键跟在这条气泡后面（与 guide 页同款）
const lastAiId = computed(() => {
  for (let i = msgs.value.length - 1; i >= 0; i--) if (msgs.value[i].role === 'ai') return msgs.value[i].id
  return 0
})
const talkInto = ref('')
let msgSeq = 0
let curUserIdx = -1
let curUserDone = true
let talkScrollTimer = null

function nowHM() {
  const d = new Date()
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0')
}
function scrollTalk() {
  talkInto.value = ''
  if (talkScrollTimer) clearTimeout(talkScrollTimer)
  talkScrollTimer = setTimeout(() => { talkInto.value = 'talkEnd' }, 30)
}
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
function lockUserText(text) {
  if (curUserIdx < 0) {
    msgs.value.push({ id: ++msgSeq, role: 'me', text: text || '', t: nowHM() })
    curUserIdx = msgs.value.length - 1
  } else {
    msgs.value[curUserIdx].text = text || ''
  }
  curUserDone = true
  scrollTalk()
  if (looksLikeAsk(text)) revealVision()   // 语音问「这是什么」→ 同打字路径
}
// ⚠️ 原「打字回显去重」（isTypedEcho + echoText/echoAt）已随 WS text 消息一并删除（2026-10-04）：
//    本页不再有打字提问，asr_final 一定是用户真说的，没有需要吞掉的回显句。
function pushAiText(text) {
  if (!text) return
  msgs.value.push({ id: ++msgSeq, role: 'ai', text, t: nowHM() })
  curUserIdx = -1
  curUserDone = true
  scrollTalk()
}

// ---------- 历史回显（2026-10-06 后端契约）：start 绑定行程后后端推一条 history ----------
// 载荷字段名后端未定死 → 宽容取（list / history / data / items / messages 里第一个数组）。
// role: user → 我（me）/ assistant → 小沃（ai）；历史条目没有时间戳，t 留空（模板 v-if="m.t" 自然不显示）。
// 位置：history 总在 ready 之后、用户开口之前到 → 平常时间线是空的，直接铺；
// 万一用户抢先说了话（时间线已有内容），把历史插到最前面而不是覆盖，并只给新条目发新 id（不重排旧 id，避免 key 抖动）。
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
  if (!hist.length) { console.log('[vc] history 事件为空，不回显'); return }
  if (msgs.value.length) {
    msgs.value = hist.map(m => ({ ...m, id: ++msgSeq })).concat(msgs.value)
    console.log('[vc] 历史回显', hist.length, '条（插在已有对话之前）')
  } else {
    msgs.value = hist.map(m => ({ ...m, id: ++msgSeq }))
    console.log('[vc] 历史回显', hist.length, '条')
  }
  curUserIdx = -1
  curUserDone = true
  scrollTalk()
}

// ---------- 通话状态 ----------
const callOn = ref(false)
const callStatus = ref('idle')
const callSeconds = ref(0)
const callNote = ref('')
const muted = ref(false)
const videoOff = ref(false)   // 画面开关：true = 关掉摄像头画面，只留语音通话（截帧循环同步停止）
const speakingOn = ref(false)
const tripLabel = ref('')
const lastSpot = ref('')       // 最近一次识别到的景点/物体名（vision.attraction，可为空）
const lastDesc = ref('')       // 最近一次的画面描述（vision.description）——静默存储，只在用户发问时展示
const CALL_STATE = { idle: '未连接', connecting: '连接中…', open: '通话中', closed: '已结束', error: '连接失败' }
const callStateText = computed(() => CALL_STATE[callStatus.value] || '')
const callTimeText = computed(() => {
  const s = callSeconds.value
  return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0')
})
// 空态引导：按画面开关切换说法（纯语音模式别再叫用户「对准镜头」）
const talkEmptyHint = computed(() => videoOff.value
  ? '直接说话就行（不用按住）；点左下「开画面」，小沃就能看到你眼前的东西'
  : '直接说话就行（不用按住），小沃会一边看画面一边聊；想打字请用讲解页的「文字聊天」')

let timerId = null
let speaking = false      // 音频闸门（普通变量，帧热路径读）；UI 用 speakingOn，唯一写入口 setSpeaking()
let callAudio = null
let currentTripId = ''
let voiceOnly = false     // 入口带 voice=1（讲解页「语音通话」）→ 以「只留语音」进入，不显示取景框

// 用户在问「眼前这是什么」吗？（打字和语音识别共用同一套判据，宽松匹配即可）
function looksLikeAsk(text) {
  const t = String(text || '').replace(/\s/g, '')
  if (!t) return false
  return /(这|它)(是|为)?(什么|啥)|什么(地方|东西|玩意)|这(是)?(哪里|哪儿|哪)|帮我看看|你看到/.test(t)
}
// 把最近一次静默识别的结果作为搭子回复展示出来（只在用户发问时调用，绝不随 vision 事件自动弹）
function revealVision() {
  if (!lastDesc.value) return
  const head = lastSpot.value ? `我看到的是「${lastSpot.value}」。` : '我看到了：'
  pushAiText(head + lastDesc.value)
}

// ---------- 打字提问已撤（2026-10-04）：本页只留语音 + 摄像头，打字走独立页 pages/chat ----------

// 识别到景点后点「听听讲解」：发 WS { type:'narrate' } —— 无字段，后端拿**自己刚下发的那次 vision**
// 当讲解对象（所以前端不回传景点名，识别与讲解天然指向同一个景点）。
// 讲解词照旧从下行 tts 回来（data 是音频、text 是字幕），与本页其他对话走的是同一条分支，不另开链路。
// 这条「讲讲XX」气泡是页内自己补的：narrate 是控制消息、后端不会回 asr_final，加它是为了让对话记录读得通。
function askNarrate() {
  const name = lastSpot.value
  if (!name) return
  if (speaking) interrupt('请它讲解')   // 正在念上一段就先打断：讲解几十秒，叠着放必然听不清
  msgs.value.push({ id: ++msgSeq, role: 'me', text: `讲讲${name}`, t: nowHM() })
  curUserIdx = msgs.value.length - 1
  curUserDone = true
  scrollTalk()
  resetVad(false)   // 半句没说完的话不再上行，免得插进讲解中间
  if (!sendNarrate()) callNote.value = '这条没发出去：连接已断开，请重拨'
  else callNote.value = ''
}

// ---------- 发起通话（tripId 由 query 带入，必传；voice=1 = 只留语音进入） ----------
useLoad(q => {
  const tid = String((q && q.tripId) || '')
  if (!tid) {
    Taro.showToast({ title: '缺少攻略参数，请从讲解页重新进入', icon: 'none' })
    setTimeout(() => goBack(), 1200)
    return
  }
  tripLabel.value = (q && q.label) ? decodeURIComponent(q.label) : ''
  voiceOnly = String((q && q.voice) || '') === '1'
  beginCall(tid)
})

function beginCall(tripId) {
  currentTripId = tripId
  callOn.value = true
  callStatus.value = 'connecting'
  callSeconds.value = 0
  muted.value = false
  // 画面开关：voice=1（讲解页「语音通话」入口）→ 默认只留语音；点左下「开画面」随时开摄像头
  videoOff.value = voiceOnly
  msgs.value = []
  curUserIdx = -1
  curUserDone = true
  talkInto.value = ''
  setSpeaking(false)
  ttsPausedOn.value = false   // 上一通若停在「暂停」态，新通话不能继承
  // 采集策略（2026-10-03 回退到 10-02 下午跑通的方案）：常录 + 每帧都上行，不过 VAD 门限——
  // 真机上 VAD 门限可能因麦克风增益低 / 声音小而一直判不出开口 → 后端 ASR 收不到任何音频 → 永不回复。
  // 如需重新启用「说话才上行」：开发者工具 Storage 存 VAD_ON = 1 后重进本页。
  vadOff = !Taro.getStorageSync('VAD_ON')
  stopTtsWatchdog()
  resetBarge()
  resetVad(true)
  lastSpot.value = ''
  lastDesc.value = ''
  callNote.value = ''
  console.log('[vc] 通话开始（视频页）', { tripId, muted: muted.value, speaking, vadOff })
  // 位置（附近推荐）：start 带一次「当前坐标」，之后的实时位置由通道每 5 秒自动补发 location
  // （callSocket 的 startLocLoop 负责，页面不用自己起定时器）。拿不到真实定位就省略，不发假坐标。
  getPosition(false).then(pos => {
    const real = pos && !pos.isFallback
    connectCall({
      tripId,
      lat: real ? pos.lat : undefined,
      lng: real ? pos.lng : undefined,
      onStatus: s => {
        callStatus.value = s
        if (s === 'open' && !videoOff.value) startCamLoop()   // WS 通了才开始截帧上行（否则帧全被 callSocket 拒收）；用户已关画面则不启
      },
      onEvent: onCallEvent
    })
  }).catch(() => {
    connectCall({ tripId, onStatus: s => {
      callStatus.value = s
      if (s === 'open' && !videoOff.value) startCamLoop()
    }, onEvent: onCallEvent })
  })
  startCallTimer()
  startRecorder()   // 常录：进页面即录、每帧上行（VAD 默认关，VAD_ON=1 才启用门限）
}

function onCallEvent(evt) {
  switch (evt.type) {
    case 'ready': return
    // 历史回显：start 绑定行程后后端推一条 history（同一份 Redis 对话历史）
    case 'history': applyHistory(pickHistory(evt)); return
    case 'asr_partial': updateUserText(evt.text || ''); return
    case 'asr_final': lockUserText(evt.text || ''); return
    case 'vision':
      // 噪声策略（后端约定）：通用识图每 10 秒回一帧结果，**只静默更新**取景框信息带与本地存储，
      // 绝不往对话时间线里插话 —— 用户问「这是什么」时才把最近结果拿出来展示（见 revealVision）。
      {
        const v = parseVisionPayload(evt)
        lastSpot.value = v.attraction
        lastDesc.value = v.description
        console.log('[vc] ← vision 静默更新：', lastSpot.value || '（无景点）', '｜', lastDesc.value)
      }
      return
    case 'attraction':   // 旧协议兼容（后端灰度期两种事件都可能到）
      if (evt.name) { lastSpot.value = evt.name; console.log('[vc] 识别到景点：', evt.name) }
      return
    // 下行 text：搭子的**回答文字**。2026-10-04 后端把文字从 tts 里拆出来，独立成一条、先于音频到达。
    case 'text':
      pushAiText(evt.text || '')
      return
    case 'tts':
      // 文字已由上面的 text 消息负责；tts 只在**主动提醒**时才自带 text（如行程到点提醒），这时补上屏
      if (evt.text) pushAiText(evt.text)
      if (evt.data) {
        // 收到 tts 的**同一时刻**就解闸（不等 onPlay、也不等临时文件写出来）：
        // ① 这段空窗若不拦住麦克风，AI 的开头会被录回去（自问自答）；
        // ② 更要紧的是「号」要现在占：写文件是异步的，若等 then 里才 ++ttsNo，
        //    用户在空窗里说话打断时 interrupt 自增的是旧号，随后新号又生效把音频放出来 —— 打断无效。
        const no = ++ttsNo
        ttsPausedOn.value = false       // 新的一句：上一句的「暂停中」作废（键回到暂停符）
        setSpeaking(true)               // 内部含 resetVad(false)：VAD/打断基线从零开始
        ttsGuardNow = ttsGuardMs(evt.data)
        armTtsWatchdog(ttsGuardNow)     // 现在起计时，覆盖「写文件期间卡死」
        playCallAudio(evt.data, no)
      }
      return
    case 'error':
      console.warn('[vc] 后端 error 原文：', evt.message || '')
      // 域名白名单类提示不上屏（2026-10-05 需求方要求删掉）：联调期靠「不校验合法域名」绕过，
      // 这条对用户是噪音；连接失败仍由顶部状态行红点 + 「连接失败」表达
      if (!/白名单|domain list/i.test(String(evt.message || ''))) {
        callNote.value = friendlyCallError(evt.message)
      }
      return
  }
}

// 防御性解析：后端实测会把 LLM 原文（```json { "attraction":…, "description":… } ```）整段塞进 description ——
// 先剥代码围栏再尝试 JSON.parse，解析得动就取真实字段，解析不动就按原样当纯文本显示（不吞内容）。
function parseVisionPayload(evt) {
  let attraction = String(evt.attraction || '').trim()
  let description = String(evt.description || '').trim()
  const raw = description || attraction
  const m = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const candidate = m ? m[1] : (raw.startsWith('{') && raw.endsWith('}') ? raw : '')
  if (candidate) {
    try {
      const obj = JSON.parse(candidate.trim())
      if (obj && typeof obj === 'object') {
        attraction = String(obj.attraction || '').trim()
        description = String(obj.description || '').trim()
      }
    } catch (e) { /* 非法 JSON：按原样显示 */ }
  }
  return { attraction, description }
}

function friendlyCallError(raw) {
  const m = String(raw || '')
  if (/connection reset|reset by peer|broken pipe|socketexception/i.test(m)) return '与语音服务的连接被上游中断，请挂断后重新拨打'
  if (/timeout|timed out/i.test(m)) return '后端处理超时，请再说一次'
  if (/unauthor|token|forbidden|401|403/i.test(m)) return '通话鉴权失效，请重新登录后再试'
  return '通话出错：' + (m || '未知错误')
}

// ---------- TTS 播放：解闸 + 看门狗（与 guide 页同一套：onStop 也算「不再出声」，防止第二句被吞） ----------
let ttsWatchdog = null
let ttsNo = 0
let ttsGuardNow = 15000   // 当前这段 TTS 的看门狗时长（暂停续播时按它重新起表）
const ttsPausedOn = ref(false)   // 暂停中（气泡旁那颗键切成「播放」）；只被点击/音频回调读 → 单 ref 够用
// 暂停后延迟放行麦克风的时刻：pause() 之后扬声器可能还剩一点缓冲尾音，先丢 300ms 再开听。
let pauseMicAt = 0
function setSpeaking(v) {
  speaking = v
  speakingOn.value = v
  if (v) resetVad(false)
  else resetBarge()
}
function stopTtsWatchdog() {
  if (ttsWatchdog) { clearTimeout(ttsWatchdog); ttsWatchdog = null }
}
function endSpeaking(reason, no) {
  if (no !== undefined && no !== ttsNo) return
  stopTtsWatchdog()
  ttsPausedOn.value = false   // 这句结束了：暂停态一并清掉
  setSpeaking(false)
}
function armTtsWatchdog(ms) {
  stopTtsWatchdog()
  ttsWatchdog = setTimeout(() => {
    ttsWatchdog = null
    if (!speaking) return
    console.warn('[vc] TTS 播放疑似卡死，强制恢复上行')
    setSpeaking(false)
  }, ms)
}
// ---------- 暂停 / 继续小沃的语音（气泡旁边那颗键，与 guide 页同款） ----------
// 打断 = 这句不要了；暂停 = 先按着，等下接着听。🔴 暂停期间**放行麦克风**（2026-10-06 用户要求）：
// 小沃不出声了，不存在「把自己的声音录回去」的回路 → 用户此时说话要能被识别；续播那刻必须收回闸门（pauseMicAt 归零 + resetVad）。
// 🔴 暂停时必须停看门狗（它到点会强制解闸、让暂停键消失，用户就点不到「继续」了）。
function toggleTtsPause() {
  if (!callAudio) {
    if (speaking) callNote.value = '这句话只有文字，没有语音'
    return
  }
  if (ttsPausedOn.value) {
    try { callAudio.play() } catch (e) {}
    ttsPausedOn.value = false
    pauseMicAt = 0                // 重新出声 → 闸门立刻收回（否则续播的半句会被麦克风录回去）
    resetVad(false)               // 出声期重新建立基线（与 setSpeaking(true) 同口径）
    armTtsWatchdog(ttsGuardNow)   // 续播重新起表
    callNote.value = '继续播放'
    console.log('[vc] 继续播放小沃的语音（从暂停处续播，麦克风闸门收回）')
  } else {
    try { callAudio.pause() } catch (e) {}
    ttsPausedOn.value = true
    // 暂停 = 小沃不出声了，此时不存在「把自己的声音录回去」的回路 → 放行麦克风，
    // 用户在暂停期间说的话要能被正常识别（VAD → 上行 → ASR），说完小沃直接接话。
    pauseMicAt = Date.now() + 300   // 但 pause() 后的扬声器尾音仍丢 300ms，免得把尾巴当用户开口
    resetVad(false)                 // 从 idle 重新开听：出声期的 VAD 统计/前导缓存不带到暂停期
    stopTtsWatchdog()
    callNote.value = '已暂停小沃的语音，你可以直接说话；点播放键继续'
    console.log('[vc] 暂停小沃的语音（麦克风已放行，用户可直接说话；点气泡旁的播放键继续）')
  }
}
function interrupt(reason) {
  if (!speaking && !callAudio) return
  console.log('[vc] 打断搭子（', reason, '）')
  ttsNo++
  ttsPausedOn.value = false   // 打断 = 这句不要了，暂停态一并作废
  if (callAudio) {
    try { callAudio.stop() } catch (e) {}
    try { callAudio.destroy() } catch (e) {}
    callAudio = null
  }
  stopTtsWatchdog()
  setSpeaking(false)
  resetVad(false)
  if (reason !== '语音打断') callNote.value = '已打断小沃，接着说或者打字都行'
}
// 看门狗时长 = 估算播放时长 ×2 + 3 秒（留解码/缓冲余量），下限 15 秒
function ttsGuardMs(b64) {
  const kb = Math.round(b64.length * 3 / 4 / 1024)
  return Math.max(15000, Math.round(kb / 4) * 2000 + 3000)
}
// no 由 case 'tts' 占好号传入（收到消息即占）；缺省时才自增，兼容直接调用
function playCallAudio(b64, no) {
  if (!b64) return
  if (no === undefined) no = ++ttsNo
  const kb = Math.round(b64.length * 3 / 4 / 1024)
  base64ToTempFile(b64, 'mp3').then(fp => {
    // 写文件期间可能已被「新一段 tts」或「用户打断」顶掉 → 这段作废，一个字都不放
    if (no !== ttsNo) { console.log('[vc] 该段 TTS 已过期（被新句/打断顶掉），丢弃不播放'); return }
    if (callAudio) { callAudio.stop(); callAudio.destroy() }
    callAudio = Taro.createInnerAudioContext()
    callAudio.src = fp
    resetBarge()   // 播放前一刻重置回声基线（闸门已在收到 tts 时置位，这里只补基线）
    callAudio.onEnded(() => endSpeaking('自然播完', no))
    // 防御：个别机型把 pause() 也报成 onStop → 暂停中忽略它（否则闸门放开、暂停键消失，点不到「继续」）
    callAudio.onStop(() => {
      if (ttsPausedOn.value) { console.log('[vc] onStop 由暂停触发，忽略（等用户点播放键继续）'); return }
      endSpeaking('被停止/打断', no)
    })
    callAudio.onError(e => { endSpeaking('播放失败', no); console.warn('[vc] TTS 播放失败：', (e && e.errMsg) || e) })
    callAudio.play()
    console.log('[vc] TTS 播放开始：mp3 约', kb, 'KB（≈', Math.round(kb / 4), '秒）')
  }).catch(e => {
    if (no === ttsNo) setSpeaking(false)   // 只有仍是当前段才还闸门，否则会把新句的闸门误关
    console.warn('[vc] TTS 临时文件写入失败：', e)
  })
}

function hangUp() {
  callOn.value = false
  resetVad(true)
  stopCamLoop()
  stopRecorder()
  stopCallTimer()
  stopTtsWatchdog()
  setSpeaking(false)
  ttsPausedOn.value = false   // 挂断时若处于暂停态，一并清掉
  if (callAudio) { callAudio.stop(); callAudio.destroy(); callAudio = null }
  closeCallSocket()
  callStatus.value = 'closed'
  callNote.value = ''
  lastSpot.value = ''
  lastDesc.value = ''
}

function goBack() {
  Taro.navigateBack({ fail: () => Taro.switchTab({ url: '/pages/guide/guide' }) })
}
// 页面返回键 = 挂断 + 回上一页（navigateBack 会触发 useUnload，此时 callOn 已 false，不会二次挂断）
function exitPage() {
  if (callOn.value) hangUp()
  goBack()
}
useUnload(() => { if (callOn.value) hangUp() })

// ---------- 录音（常录 + VAD）：完整状态机与 guide 页一致（recActive 权威状态 / 卡死兜底 / 续录） ----------
const FRAME_KB = 2
let recMgr = null
let recRunning = false
let recActive = false
let recStarting = false
let recResumeAfterStop = false
let recStartGuard = null
let recStopping = false
let frameCount = 0
let blockReason = ''
let blockFrames = 0
let blockLoggedAt = 0

function startRecorder() {
  if (!recMgr) {
    recMgr = Taro.getRecorderManager()
    recMgr.onStart(() => { recActive = true; recStarting = false })
    recMgr.onFrameRecorded(res => {
      if (!res || !res.frameBuffer) return
      recActive = true
      recStarting = false
      frameCount++
      if (frameCount === 1) {
        console.log('[vc] 第一帧音频已拿到，大小', res.frameBuffer.byteLength, '字节；闸门', {
          callOn: callOn.value, muted: muted.value, speaking, wsOpen: isSocketOpen()
        })
      }
      if (!callOn.value || muted.value) {
        const reason = !callOn.value ? '已挂断(callOn)' : '已静音(muted)'
        const now = Date.now()
        if (reason !== blockReason || now - blockLoggedAt > 5000) {
          blockReason = reason
          blockLoggedAt = now
          console.log('[vc] 音频帧被拦下（第', frameCount, '帧）：', reason, '｜ wsOpen', isSocketOpen())
        }
        blockFrames++
        return
      }
      // 搭子正在出声：默认不上行（否则把它自己的声音录回去＝自问自答），只做语音打断检测；
      // 🔴 例外＝用户点了暂停（2026-10-06 需求）：小沃不出声了，麦克风放行，用户此时说话要能被识别。
      if (speaking && !(ttsPausedOn.value && Date.now() >= pauseMicAt)) { detectBargeIn(res.frameBuffer); return }
      blockReason = ''
      blockFrames = 0
      pushViaVad(res.frameBuffer)
    })
    recMgr.onStop(() => {
      recRunning = false
      recActive = false
      recStarting = false
      const explicit = recStopping
      recStopping = false
      const deferred = recResumeAfterStop
      recResumeAfterStop = false
      // 本页是常录模式：通话没挂断、没静音就续录（播放 TTS 打断录音后必须接回来）
      const resume = deferred || (!explicit && callOn.value && !muted.value)
      console.log('[vc] 录音已停止：', explicit ? '我们主动停' : '被系统/播放打断', '｜', resume ? '自动续录' : '不续录')
      if (resume) startRecorder()
    })
    recMgr.onError(err => {
      recStarting = false
      recRunning = false
      const msg = (err && err.errMsg) || ''
      if (/is recording/i.test(msg)) {
        recActive = true
        console.warn('[vc] 录音器已在录制（重复 start 被拒）：沿用既有录制')
        return
      }
      recActive = false
      callNote.value = '录音启动失败：检查麦克风授权（mp 后台《隐私保护指引》需勾选麦克风）'
      console.warn('[vc] 录音启动/录制失败：', err)
    })
  }
  if (recRunning || recStarting) return
  if (recActive) {
    recResumeAfterStop = true
    recStopping = true
    try { recMgr.stop() } catch (e) {}
    console.warn('[vc] 录音器仍在录制（状态不同步）→ 先停，等 onStop 后自动重启')
    return
  }
  recRunning = true
  recStarting = true
  resetVad(false)
  recMgr.start({ duration: 600000, sampleRate: 16000, numberOfChannels: 1, format: 'PCM', frameSize: FRAME_KB, encodeBitRate: 24000 })
  clearTimeout(recStartGuard)
  recStartGuard = setTimeout(() => {
    if (recStarting) {
      recStarting = false
      recRunning = false
      console.warn('[vc] 录音 3 秒内未进入录制状态 → 复位')
    }
  }, 3000)
}

function stopRecorder() {
  recResumeAfterStop = false
  clearTimeout(recStartGuard)
  if (recMgr && (recRunning || recActive || recStarting)) {
    recStopping = true
    try { recMgr.stop() } catch (e) {}
  }
  recRunning = false
  recStarting = false
}

function toggleMute() {
  muted.value = !muted.value
  if (muted.value) stopRecorder()
  else if (callOn.value) startRecorder()   // 常录模式：恢复收音立即拉起录音
}

// 画面开关：关 = 停截帧 + 隐藏取景框（语音照常）；开 = WS 在线就立刻恢复截帧。
// 不用 v-if 卸载 camera：原生组件反复重建有幽灵层前科，v-show 保持挂载最稳。
function toggleVideo() {
  videoOff.value = !videoOff.value
  console.log('[vc] 画面开关 →', videoOff.value ? '已关闭（只留语音）' : '已开启')
  if (videoOff.value) {
    stopCamLoop()
  } else if (callOn.value && callStatus.value === 'open') {
    startCamLoop()
  }
}

// ---------- VAD（语音活动检测）：说话才上行，算法与 guide 页一致 ----------
// ⚠️ 本页默认不启用（beginCall 里 vadOff = !storage.VAD_ON）——每帧直接上行，
//    与 10-02 下午首次跑通全链路的采集方式一致；真机 VAD 误吞人声时以此保底。
const VAD_START_FRAMES = 3
const VAD_END_FRAMES = 12
const VAD_PRE_ROLL_MAX = 6
const VAD_GATE_MULT = 2.5
const VAD_MIN_GATE = 400
const VAD_IDLE_WARN = 100
let vadOff = false
let noiseFloor = 300
let vadState = 'idle'
let vadAbove = 0
let vadBelow = 0
let preRoll = []
let vadIdleFrames = 0
let vadWarned = false
let vadSent = 0
let vadSkipped = 0

function resetVad(clearStats) {
  vadState = 'idle'
  vadAbove = 0
  vadBelow = 0
  preRoll = []
  vadIdleFrames = 0
  vadWarned = false
  if (clearStats) { vadSent = 0; vadSkipped = 0; noiseFloor = 300 }
}
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
function pushViaVad(buf) {
  if (vadOff) { vadSent++; sendAudio(abToBase64(buf)); return }
  const rms = frameRms(buf)
  const gate = Math.max(VAD_MIN_GATE, noiseFloor * VAD_GATE_MULT)
  if (rms < gate) noiseFloor = noiseFloor * 0.95 + rms * 0.05
  if (vadState === 'idle') {
    if (rms >= gate) {
      vadAbove++
      preRoll.push(buf)
      if (preRoll.length > VAD_PRE_ROLL_MAX) preRoll.shift()
      if (vadAbove >= VAD_START_FRAMES) {
        vadState = 'speech'
        vadBelow = 0
        vadIdleFrames = 0
        const lead = preRoll.length
        console.log('[vc] VAD 开口 → 上行（回补前导', lead, '帧）｜rms', Math.round(rms), '｜门限', Math.round(gate))
        preRoll.forEach(b => { vadSent++; sendAudio(abToBase64(b)) })
        preRoll = []
        return
      }
    } else {
      vadAbove = 0
      preRoll = []
    }
    vadSkipped++
    vadIdleFrames++
    if (!vadWarned && vadIdleFrames >= VAD_IDLE_WARN) {
      vadWarned = true
      console.warn('[vc] VAD 连续约 8 秒未检测到语音：rms', Math.round(rms), '/ 门限', Math.round(gate))
    }
    return
  }
  vadSent++
  sendAudio(abToBase64(buf))
  if (rms >= gate) {
    vadBelow = 0
  } else {
    vadBelow++
    if (vadBelow >= VAD_END_FRAMES) {
      console.log('[vc] VAD 说完 → 暂停上行｜累计上行', vadSent, '帧 / 静音跳过', vadSkipped, '帧')
      vadState = 'idle'
      vadAbove = 0
      vadBelow = 0
      preRoll = []
      vadIdleFrames = 0
      vadWarned = false
    }
  }
}

// ---------- 语音打断（barge-in）：AI 说话时用户直接开口就插话 ----------
const BARGE_MULT = 1.8
const BARGE_MIN_RMS = 700
const BARGE_FRAMES = 5
const BARGE_PREROLL = 8
let echoBase = 0
let echoSeen = 0
let bargeAbove = 0
let bargeBuf = []
function resetBarge() {
  echoBase = 0
  echoSeen = 0
  bargeAbove = 0
  bargeBuf = []
}
function detectBargeIn(buf) {
  const rms = frameRms(buf)
  echoBase = echoBase ? echoBase * 0.8 + rms * 0.2 : rms
  echoSeen++
  bargeBuf.push(buf)
  if (bargeBuf.length > BARGE_PREROLL) bargeBuf.shift()
  if (echoSeen < 3) return
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
  console.log('[vc] 检测到用户插话 → 打断搭子（补发前导', frames.length, '帧）')
  interrupt('语音打断')
  vadState = 'speech'
  vadBelow = 0
  vadIdleFrames = 0
  vadWarned = false
  vadSent += frames.length
  frames.forEach(b => sendAudio(abToBase64(b)))
}

// ---------- 摄像头 10 秒一帧 → 阶梯压缩 → 体积守卫 → 上行 ----------
// 上限按实测安全线取：服务端文本缓冲（Tomcat maxTextMessageBufferSize 默认 8K 字节≈字符）超限会 1009 断连，
// 实测 6KB 被打回、3.4KB 通过 → 这里控在 ~5.2K 字符（含 JSON 包装仍 <6KB），宁可稍微糊一点也不能把帧丢掉。
const FRAME_MAX_B64 = 5200
const CAM_INTERVAL_MS = 10000   // 10 秒一帧。⚠️ 后端协议文档里 frame 那行写的是「前端 1fps 截帧」，
//   但截帧节奏是产品侧刻意放慢的（1fps 会产生持续的识别噪声与十倍调用量）：2026-10-04 已与需求方确认保持 10 秒，
//   别照文档把这行改成 1000。识别结果本来就静默存储、只在用户发问时才展示（见 revealVision）。
// 阶梯压缩：从高到低逐级试，命中上限即用。原实现只有两级，真机上「两级都超限 → 每帧全丢」
// 正是「识图毫无反应」的前端成因之一（后端一帧都收不到，自然什么都不回）。
const FRAME_LADDER = [[360, 45], [280, 38], [220, 30], [160, 22], [120, 18]]
let camTimer = null
let camBusy = false
let camSkip = 0
let camSkipLogged = false

function startCamLoop() {
  stopCamLoop()
  camSkip = 0
  camSkipLogged = false
  takeFrame()
  camTimer = setInterval(takeFrame, CAM_INTERVAL_MS)
}
function stopCamLoop() {
  if (camTimer) { clearInterval(camTimer); camTimer = null }
  camBusy = false
}
function takeFrame() {
  if (!callOn.value || camBusy) return
  camBusy = true
  const finish = () => { camBusy = false }
  let ctx
  try { ctx = Taro.createCameraContext() } catch (e) { finish(); return }
  ctx.takePhoto({
    quality: 'low',
    success: res => {
      const src = (res && res.tempImagePath) || ''
      if (!src) return finish()
      compressToLimit(src).then(r => sendFrameChecked(r && r.b64, r))
        .catch(e => { console.warn('[vc] 画面帧压缩失败，跳过这一帧：', e) })
        .then(finish)
    },
    fail: e => {
      console.warn('[vc] takePhoto 失败：', (e && e.errMsg) || e)
      finish()
    }
  })
}
// 逐级降档，返回第一个不超限的结果；全部超限则返回体积最小的那次（交给守卫决定丢不丢）
function compressToLimit(src) {
  let i = 0
  let best = null
  const step = () => {
    if (i >= FRAME_LADDER.length) return best
    const [w, q] = FRAME_LADDER[i++]
    return compress(src, w, q).then(b64 => {
      const cur = { b64, w, q }
      if (!best || b64.length < best.b64.length) best = cur
      if (b64.length <= FRAME_MAX_B64) return cur
      return step()
    })
  }
  return Promise.resolve().then(step)
}
function compress(src, width, quality) {
  try {
    return Taro.compressImage({ src, quality, compressedWidth: width })
      .then(r => fileToBase64((r && r.tempFilePath) || src))
      .catch(() => fileToBase64(src))
  } catch (e) {
    return fileToBase64(src)
  }
}
function sendFrameChecked(b64, meta) {
  if (!b64) return
  if (b64.length > FRAME_MAX_B64) {
    camSkip++
    if (!camSkipLogged) {
      camSkipLogged = true
      callNote.value = '画面帧体积超限已跳过：需后端把 WS 文本消息缓冲调大（Tomcat maxTextMessageBufferSize）'
      console.warn('[vc] 画面帧过大被跳过（base64', b64.length, '> 上限', FRAME_MAX_B64,
        '，已降到最低档', meta ? `${meta.w}px q${meta.q}` : '', '）')
    } else if (camSkip % 30 === 0) {
      console.warn('[vc] 画面帧已连续跳过', camSkip, '帧（体积超限）')
    }
    return
  }
  camSkip = 0
  console.log('[vc] 画面帧上行：', b64.length, '字符', meta ? `（${meta.w}px q${meta.q}）` : '')
  sendFrame(b64)
}
function onCamError(e) {
  console.warn('[vc] 摄像头不可用：', (e && e.detail && e.detail.errMsg) || e)
  callNote.value = '摄像头不可用（检查授权），语音对话不受影响'
}

// ---------- 工具 ----------
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
function startCallTimer() {
  stopCallTimer()
  timerId = setInterval(() => { callSeconds.value++ }, 1000)
}
function stopCallTimer() {
  if (timerId) { clearInterval(timerId); timerId = null }
}
</script>

<style>
.vc-page {
  height: 100vh; box-sizing: border-box;
  display: flex; flex-direction: column;
  background: #FFFFFF;
  padding: 24rpx 32rpx calc(28rpx + env(safe-area-inset-bottom));
}
/* 取景框：上半屏，16:10 比例 */
.cam-box {
  position: relative; flex-shrink: 0;
  border-radius: 24rpx; overflow: hidden; background: #101418;
}
.cam { width: 100%; height: 46vh; display: block; }
.cam-box.hide { display: none; }   /* 只留语音模式：整个取景框收起，对话区自动占满 */
.cam-strip {
  position: absolute; left: 0; right: 0; bottom: 0;
  display: flex; align-items: center; gap: 14rpx;
  padding: 14rpx 18rpx;
  background: rgba(16, 20, 24, 0.62);
}
.cam-spot { display: flex; align-items: center; gap: 10rpx; min-width: 0; flex: 1; }
.cam-spot-tag {
  flex-shrink: 0; font-size: 20rpx; color: #22C55E;
  background: rgba(34, 197, 94, 0.16); border-radius: 8rpx; padding: 4rpx 12rpx;
}
.cam-spot-name { font-size: 26rpx; color: #FFFFFF; font-weight: 600; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.cam-hint { flex: 1; font-size: 22rpx; color: rgba(255, 255, 255, 0.72); }
.cam-ask {
  flex-shrink: 0; display: flex; align-items: center; gap: 8rpx;
  background: #22C55E; color: #FFFFFF; font-size: 24rpx; font-weight: 600;
  border-radius: 999rpx; padding: 10rpx 22rpx;
}
.cam-ask-ico { width: 26rpx; height: 26rpx; }
/* 状态行 + 攻略 pill */
.meta { display: flex; align-items: center; margin-top: 20rpx; flex-shrink: 0; }
.call-state { display: flex; align-items: center; gap: 12rpx; font-size: 22rpx; color: #9AA3A0; }
.call-dot { width: 12rpx; height: 12rpx; border-radius: 50%; background: #C6CCC9; }
.call-dot.open { background: #22C55E; }
.call-dot.connecting { background: #E8B04B; }
.call-dot.error { background: #E5484D; }
.call-timer { margin-left: auto; font-size: 22rpx; color: #9AA3A0; font-family: 'DIN Alternate', sans-serif; }
/* 旧头部小圆钮（.act-btn/.ab-ico）已随「操作键下移底栏」整体删除（2026-10-05）：
   现行样式见下方 .tb-side（开=实心绿+投影、关=实心红+白斜线图标，语义不变） */
.trip-pill {
  margin-top: 16rpx; align-self: flex-start;
  display: flex; align-items: center; gap: 8rpx;
  font-size: 22rpx; color: #6B7280; background: #F4F5F7;
  border-radius: 999rpx; padding: 10rpx 20rpx; flex-shrink: 0;
}
.tp-ico { width: 24rpx; height: 24rpx; flex-shrink: 0; }
/* 对话时间线 */
.talk { flex: 1; min-height: 0; margin-top: 8rpx; }
.msg { margin-top: 20rpx; display: flex; flex-direction: column; }
.msg.me { align-items: flex-end; }
.msg.ai { align-items: flex-start; }
.bubble {
  max-width: 76%; padding: 18rpx 24rpx; border-radius: 22rpx;
  font-size: 28rpx; line-height: 1.5; word-break: break-all;
}
.msg.ai .bubble { background: #1A1A1A; color: #FFFFFF; border-top-left-radius: 6rpx; }
.msg.me .bubble { background: #F2F3F5; color: #1A1A1A; border-top-right-radius: 6rpx; }
.msg-time { margin-top: 8rpx; font-size: 20rpx; color: #B9BFB9; }
/* 气泡行：气泡 + 旁边的暂停/播放键（宽度 100% 定宽，气泡的 76% 上限才有确定参照） */
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
/* 手动打断入口已收敛：由气泡旁的暂停/播放键承担（暂停即闭嘴），语音/讲解路径仍走 interrupt() */
.talk-empty { margin-top: 60rpx; text-align: center; font-size: 26rpx; color: #B9BFB9; padding: 0 40rpx; line-height: 1.6; }
.talk-end { height: 4rpx; }
/* 底部状态条（只剩语音状态；打字输入框 2026-10-04 已撤，打字走独立页 pages/chat） */
.talk-bar { display: flex; align-items: center; justify-content: center; gap: 18rpx; flex-shrink: 0; margin-top: 12rpx; }
.tb-live { display: flex; align-items: center; gap: 10rpx; flex-shrink: 0; }
.tb-live-dot { width: 14rpx; height: 14rpx; border-radius: 50%; background: #C6CCC9; }
.tb-live-dot.live { background: #22C55E; }
.tb-live text { font-size: 22rpx; color: #6B7280; }
/* 「打电话式」操作区（2026-10-05）：三格等宽 —— 左 画面开关、正中大号红色挂断、右 静音。
   flex:1 保证正中格卡在屏幕中线；上方是有色实心圆（开=绿 / 关=红 + 白斜线图标，沿用原有语义） */
.ctrl-bar { flex-shrink: 0; margin-top: 18rpx; display: flex; align-items: flex-start; justify-content: center; }
.tb-slot { flex: 1; display: flex; flex-direction: column; align-items: center; gap: 10rpx; }
.tb-label { font-size: 20rpx; color: #9AA3A0; line-height: 1.2; }
.tb-side {
  flex-shrink: 0; width: 108rpx; height: 108rpx; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
}
.tb-side.on { background: #22C55E; box-shadow: 0 4rpx 14rpx rgba(34, 197, 94, 0.35); }
.tb-side.off { background: #E5484D; box-shadow: 0 4rpx 14rpx rgba(229, 72, 77, 0.35); }
.tb-side-ico { width: 44rpx; height: 44rpx; }
/* 正中挂断键：大号红圆（比两侧大一圈，一眼是主操作，位置与手感对齐系统电话） */
.tb-hang {
  flex-shrink: 0; width: 136rpx; height: 136rpx; border-radius: 50%;
  background: #E5484D;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 10rpx 24rpx rgba(229, 72, 77, 0.26);
}
.tb-hang-hover { opacity: 0.82; }
.tb-hang-ico { width: 58rpx; height: 58rpx; }
.call-note { flex-shrink: 0; margin-top: 10rpx; min-height: 30rpx; font-size: 22rpx; color: #9AA3A0; line-height: 1.5; }
</style>
