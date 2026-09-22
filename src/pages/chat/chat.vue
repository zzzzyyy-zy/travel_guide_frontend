<template>
  <view class="wrap">
    <view class="card">
      <view class="title">就着「{{ attraction || '当前景点' }}」随便问</view>
      <view class="sub">多轮语音问答，服务端按 sessionId 记住上下文</view>

      <!-- 历史对话 -->
      <view class="msg" v-for="(m, i) in messages" :key="i" :class="m.role">
        <text class="msg-text">{{ m.text }}</text>
        <view v-if="m.role === 'a'" class="msg-tts" @tap="speak(m.text)">🔊 听</view>
      </view>

      <view class="output" v-if="loading">思考中…</view>

      <textarea class="input" v-model="question" maxlength="200" placeholder="输入问题，或点话筒说" />
      <view class="row">
        <view class="mic" :class="{ rec: recording }" @tap="toggleMic">{{ recording ? '⏹ 停止' : '🎤 说' }}</view>
        <view class="btn grow" @tap="ask" :class="{ disabled: loading }">{{ loading ? '思考中…' : '问一句' }}</view>
      </view>
    </view>

    <view class="card" v-if="messages.length">
      <view class="note">回答由 AI 生成，仅供参考</view>
    </view>
    <AuthMask />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import Taro, { useLoad, useUnload } from '@tarojs/taro'
import api from '../../services/api'
import { requireLogin } from '../../utils/auth'
import { base64ToTempFile } from '../../utils/file'
import AuthMask from '../../components/AuthMask.vue'

const attraction = ref('')
const question = ref('')
const messages = ref([])    // [{ role: 'q' | 'a', text }]
const sessionId = ref('')   // 首轮为空，服务端返回后回传实现多轮
const loading = ref(false)
const recording = ref(false)
let audio = null

useLoad(options => {
  if (options && options.attraction) attraction.value = decodeURIComponent(options.attraction)
})

useUnload(() => {
  if (audio) { audio.stop(); audio.destroy(); audio = null }
  if (recorder) try { recorder.stop() } catch (e) {}
})

// ---------- 文字提问 ----------
function ask() {
  const q = (question.value || '').trim()
  if (!q || loading.value) return
  requireLogin(() => {
    question.value = ''
    startAsk(q)
  })
}

function startAsk(q) {
  loading.value = true
  messages.value.push({ role: 'q', text: q })
  // 多轮契约：首轮不传 sessionId，之后原样回传服务端给的
  api.guide.chat(q, sessionId.value || undefined).then(d => {
    loading.value = false
    if (d && d.sessionId) sessionId.value = d.sessionId
    messages.value.push({ role: 'a', text: (d && d.answer) || '（空回答）' })
  }).catch(e => {
    loading.value = false
    messages.value.push({ role: 'a', text: (e && e.message) || '问答服务暂时不可用' })
  })
}

// ---------- 语音输入：录音（wav/16000Hz/单声道，联调纪要 9.4）→ base64 → ASR ----------
let recorder = null
function toggleMic() {
  if (recording.value) {
    recorder.stop()
    return
  }
  requireLogin(() => startRecord())
}

function startRecord() {
  if (!recorder) {
    recorder = Taro.getRecorderManager()
    recorder.onStart(() => { recording.value = true })
    recorder.onStop(res => {
      recording.value = false
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
            if (text) { question.value = text; startAsk(text) }
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
