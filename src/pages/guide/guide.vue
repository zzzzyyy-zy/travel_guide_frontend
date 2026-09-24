<template>
  <view class="wrap">
    <view class="card" v-if="current">
      <view class="title">{{ current.name }}</view>
      <view class="note" v-if="sourceTag">{{ sourceTag }}</view>
      <view class="subtitle" v-if="script">{{ script }}</view>
      <view class="note" v-else>{{ loading ? '正在生成讲解…' : '' }}</view>
      <!-- 有音频才出现：播放中可暂停，暂停/播完可继续或重听 -->
      <view class="btn" v-if="audioFile" @tap="toggleAudio">{{ playing ? '⏸ 暂停讲解' : '▶ 播放讲解' }}</view>
      <view class="btn" @tap="ask">听不懂？追问一句</view>
    </view>
    <view class="card" v-else>
      <view class="note">{{ loading ? '正在生成讲解…' : '点击下方「我到了哪个景点」，自动识别并开始听讲解' }}</view>
    </view>

    <view class="card">
      <view class="title">定位识别</view>
      <view class="note">真实模糊定位（GCJ-02），走到景点附近自动识别并播报讲解</view>
      <view class="btn" @tap="identifyByLocation">📍 我到了哪个景点？</view>
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
import { getPosition } from '../../utils/position'
import AuthMask from '../../components/AuthMask.vue'

const current = ref(null)     // 当前讲解的景点（{ name } 即可，新契约只认 attraction 名）
const script = ref('')        // 讲解词（POST /api/guide/narrate 返回的 script）
const sourceTag = ref('')     // 识别来源展示：定位 / 拍照
const audioFile = ref('')     // TTS base64 转出的本地 mp3 临时文件
const playing = ref(false)    // 音频是否正在出声（暂停/播完 = false）
const loading = ref(false)

let audio = null

useLoad(options => {
  // 行程页等其他入口可带 ?name= 直达讲解
  if (options && options.name) start(options.name, '')
})

useUnload(() => stopAudio())

// ---------- 入口一：定位识别（7.3 identify，定位优先） ----------
function identifyByLocation() {
  if (loading.value) return  // 防连点：上一轮识别还没结束
  requireLogin(() => {
    loading.value = true
    // position.js 全程 GCJ-02（联调纪要 9.5），与后端坐标系一致；
    // force=true：用户主动点击 = 重新定位意图，绕过 5 秒防连点缓存
    getPosition(true).then(pos => {
      return api.guide.identify({ lat: pos.lat, lng: pos.lng })
    }).then(d => {
      // source: location = 定位命中；image = 拍照兜底（当前未接拍照）
      start(d.attraction, d.source === 'image' ? '拍照识别' : '定位识别')
    }).catch(e => {
      loading.value = false
      Taro.showToast({ title: (e && e.message) || '没认出你在哪个景点', icon: 'none' })
    })
  })
}

// 主链路：narrate 拿讲解词 → TTS 转语音 → 自动播放（音频失败降级纯文字，链路不断）
function start(name, tag) {
  stopAudio()
  current.value = { name }
  sourceTag.value = tag
  script.value = ''
  audioFile.value = ''
  loading.value = true
  api.guide.narrate(name).then(g => {
    script.value = g.script
    loading.value = false
    api.event.report([{ type: 'play', payload: { attraction: name } }])
    // 有讲解词后再要音频；TTS 挂了只影响「听」，不影响「看」
    return api.voice.tts(g.script).then(t => {
      if (!t || !t.audio) return
      return base64ToTempFile(t.audio, 'mp3').then(fp => {
        audioFile.value = fp
        playFile()
      })
    }).catch(e => console.warn('[guide] TTS 失败，降级纯字幕', e && e.code))
  }).catch(e => {
    loading.value = false
    Taro.showToast({ title: (e && e.message) || '讲稿加载失败', icon: 'none' })
  })
}

function playFile() {
  stopAudio()
  audio = Taro.createInnerAudioContext()
  audio.src = audioFile.value
  audio.play()
  playing.value = true
  audio.onEnded(() => { playing.value = false })
  audio.onError(() => { playing.value = false })
}

// 播放/暂停切换：暂停保留进度，继续从暂停处播；播完后再点 = 从头重听
function toggleAudio() {
  if (!audioFile.value) return
  // 音频对象被销毁（切景点后）→ 重新起一个从头播
  if (!audio) return playFile()
  if (playing.value) {
    audio.pause()
    playing.value = false
  } else {
    audio.play()
    playing.value = true
  }
}

function stopAudio() {
  if (audio) { audio.stop(); audio.destroy(); audio = null }
  playing.value = false
}

// 追问：高光②入口（带景点名过去，chat 页多轮问答）
function ask() {
  const name = current.value ? current.value.name : ''
  Taro.navigateTo({ url: `/pages/chat/chat?attraction=${encodeURIComponent(name)}` })
}
</script>
