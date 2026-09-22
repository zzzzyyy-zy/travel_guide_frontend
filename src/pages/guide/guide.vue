<template>
  <view class="wrap">
    <view class="card" v-if="current">
      <view class="title">{{ current.name }}</view>
      <view class="note" v-if="sourceTag">{{ sourceTag }}</view>
      <view class="subtitle" v-if="script">{{ script }}</view>
      <view class="note" v-else>{{ loading ? '正在生成讲解…' : '' }}</view>
      <view class="btn" v-if="audioFile" @tap="replay">{{ playing ? '♪ 播放中…（点击重播）' : '▶ 再听一遍' }}</view>
      <view class="btn" @tap="ask">听不懂？追问一句</view>
    </view>
    <view class="card" v-else>
      <view class="note">{{ loading ? '正在生成讲解…' : '点下方景点或用定位识别，开始听讲解' }}</view>
    </view>

    <view class="card">
      <view class="title">定位识别</view>
      <view class="note">走 POST /api/guide/identify（演示模式回放预设坐标，不依赖定位权限）</view>
      <view class="btn" @tap="identifyByLocation">📍 我到了哪个景点？</view>
    </view>

    <view class="card">
      <view class="title">模拟到达（现场演示用）</view>
      <view class="note">完全不依赖定位信号，直接按景点生成讲解</view>
      <view class="list-item" v-for="item in pois" :key="item.poiId" @tap="play(item.name)">
        <view class="name">{{ item.name }}</view>
        <view class="sub">{{ item.stayMinutes }} 分钟 · 体力强度 {{ item.intensity }}</view>
        <text class="tag" v-for="t in item.tags" :key="t">{{ t }}</text>
      </view>
    </view>
    <AuthMask />
  </view>
</template>

<script setup>
import { ref } from 'vue'
import Taro, { useLoad, useDidShow, useUnload } from '@tarojs/taro'
import api from '../../services/api'
import { requireLogin } from '../../utils/auth'
import { base64ToTempFile } from '../../utils/file'
import { getPosition } from '../../utils/position'
import AuthMask from '../../components/AuthMask.vue'

const pois = ref([])
const current = ref(null)     // 当前讲解的景点（{ name } 即可，新契约只认 attraction 名）
const script = ref('')        // 讲解词（POST /api/guide/narrate 返回的 script）
const sourceTag = ref('')     // 识别来源展示：定位 / 拍照（模拟到达不显示）
const audioFile = ref('')     // TTS base64 转出的本地 mp3 临时文件
const playing = ref(false)
const loading = ref(false)

// 非响应式实例：音频对象
let audio = null

useLoad(options => {
  api.poi.list().then(list => {
    pois.value = list
    const pending = Taro.getStorageSync('pendingPoiId')
    if (options && options.name) start(options.name, '')
    else if (pending) { Taro.removeStorageSync('pendingPoiId'); const p = list.find(x => x.poiId === pending); if (p) start(p.name, '') }
  })
})

// tab 再次切入时检查行程页带过来的点位（switchTab 不触发 onLoad，只触发 onShow）
useDidShow(() => {
  if (!pois.value.length) return
  const pending = Taro.getStorageSync('pendingPoiId')
  if (pending) {
    Taro.removeStorageSync('pendingPoiId')
    const p = pois.value.find(x => x.poiId === pending)
    if (p) start(p.name, '')
  }
})

useUnload(() => stopAudio())

// ---------- 入口一：定位识别（7.3 identify，定位优先） ----------
function identifyByLocation() {
  requireLogin(() => {
    loading.value = true
    // position.js 全程 GCJ-02（联调纪要 9.5），与后端坐标系一致
    getPosition().then(pos => {
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

// ---------- 入口二：模拟到达（列表直接点） ----------
function play(name) {
  requireLogin(() => start(name, ''))
}

// 主链路：narrate 拿讲解词 → TTS 转语音 → 播放（音频失败降级纯文字，链路不断）
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

function replay() {
  if (!audioFile.value) return
  playFile()
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
