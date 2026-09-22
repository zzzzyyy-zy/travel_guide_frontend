<template>
  <view class="wrap">
    <!-- ========== 精选专题（运营位，静态配置） ========== -->
    <view class="sec-head" @tap="onTopic">
      <text class="sec-title">精选专题</text>
      <text class="sec-more">›</text>
    </view>
    <view class="topic-card" @tap="onTopic">
      <view class="topic-cover">
        <image class="topic-img" :src="TOPIC.cover" mode="aspectFill" />
        <view class="topic-tag">{{ TOPIC.tag }}</view>
      </view>
      <view class="topic-body">
        <view class="topic-title">{{ TOPIC.title }}</view>
        <view class="topic-meta">{{ TOPIC.count }}个地点</view>
        <view class="topic-desc">{{ TOPIC.desc }}</view>
      </view>
    </view>

    <!-- ========== 热门旅游城市：点击海报直接带着城市进表单 ========== -->
    <view class="sec-head">
      <text class="sec-title">热门旅游城市</text>
      <text class="sec-more">›</text>
    </view>
    <scroll-view class="city-scroll" scroll-x enhanced :show-scrollbar="false">
      <view class="city-card" v-for="c in CITIES" :key="c.name" @tap="goCity(c.name)">
        <image class="city-img" :src="c.cover" mode="aspectFill" />
        <view class="city-veil"></view>
        <view class="city-name">{{ c.name }}</view>
      </view>
    </scroll-view>

    <!-- ========== 最近行程：取历史列表第一条，mock 附加 startDate/peopleCount，真后端缺省时自动隐藏对应行 ========== -->
    <view class="sec-head">
      <text class="sec-title">最近行程</text>
      <text class="sec-more">›</text>
    </view>
    <view class="trip-card" v-if="recent">
      <view class="trip-top">
        <view class="trip-info">
          <view class="trip-title">{{ recent.title }}</view>
          <view class="trip-meta" v-if="tripMeta">{{ tripMeta }}</view>
        </view>
        <view class="trip-count" v-if="countdownText">{{ countdownText }}</view>
      </view>
      <view class="trip-btn" @tap="goDetail">查看详细行程</view>
    </view>
    <view class="trip-empty" v-else-if="!tripLoading">
      <view class="trip-empty-ico">🗺️</view>
      <view class="trip-empty-txt">还没有行程，点击右下角 ＋ 创建</view>
    </view>

    <!-- 悬浮 + 号：进入表单页创建行程 -->
    <view class="fab" @tap="goCreate">
      <text class="fab-icon">＋</text>
    </view>
  </view>
</template>

<script setup>
import Taro, { useDidShow } from '@tarojs/taro'
import { ref, computed } from 'vue'
import api from '../../services/api'
import topicCover from '../../assets/home/topic-nanjing.jpg'
import beijingCover from '../../assets/home/city-beijing.jpg'
import chongqingCover from '../../assets/home/city-chongqing.jpg'
import jinanCover from '../../assets/home/city-jinan.jpg'

// ---------- 运营位静态配置（无后端接口，改内容直接改这里） ----------
const TOPIC = {
  cover: topicCover,
  tag: '🚶 出门散步',
  title: '在南京，时间是可以摸到的',
  count: 11,
  desc: '从东大礼堂的穹顶到先锋书店的地下，从明城墙到长江大桥。南京的每一层时间都铺在地上，值得慢慢走。'
}
const CITIES = [
  { name: '北京', cover: beijingCover },
  { name: '重庆', cover: chongqingCover },
  { name: '济南', cover: jinanCover }
]

// ---------- 最近行程 ----------
const recent = ref(null)
const tripLoading = ref(true)

// 出发行 + 倒计时：字段来自列表扩展（mock 有、真后端暂无）→ 缺省就不显示
const tripMeta = computed(() => {
  const t = recent.value
  if (!t || !t.startDate) return ''
  const parts = [`${String(t.startDate).slice(5).replace('-', '-')} 出发`]
  if (t.peopleCount) parts.push(`${t.peopleCount} 人`)
  return parts.join(' · ')
})
const countdownText = computed(() => {
  const s = recent.value && recent.value.startDate
  if (!s) return ''
  const start = new Date(`${s}T00:00:00`)
  if (isNaN(start)) return ''
  const diff = Math.ceil((start - new Date(new Date().toDateString())) / 86400000)
  if (diff > 0) return `倒计时${diff}天`
  if (diff === 0) return '今天出发'
  return '进行中'
})

function loadRecent() {
  tripLoading.value = true
  api.trips.list().then(list => {
    recent.value = (list && list.length && list[0]) || null
  }).catch(() => {
    recent.value = null
  }).finally(() => {
    tripLoading.value = false
  })
}

useDidShow(() => {
  loadRecent()
})

// ---------- 跳转（表单页带城市预填 / 行程详情） ----------
// 跳转锁：失败时不提前解锁（否则再点会和兜底跳转撞车，触发 routeDone webviewId 错乱）：
// 先等 400ms 重试一次 navigateTo，仍失败才用 reLaunch 兜底
let routing = false
function safeNav(url) {
  if (routing) return
  routing = true
  Taro.navigateTo({ url })
    .then(() => { routing = false })
    .catch(() => {
      setTimeout(() => {
        Taro.navigateTo({ url })
          .then(() => { routing = false })
          .catch(() => {
            Taro.reLaunch({ url })
              .then(() => { routing = false })
              .catch(() => {
                routing = false
                Taro.showToast({ title: '跳转失败，请重试', icon: 'none' })
              })
          })
      }, 400)
    })
}

function goCity(name) {
  safeNav(`/pages/index/index?city=${encodeURIComponent(name)}`)
}
function goDetail() {
  if (recent.value) safeNav(`/pages/itinerary/itinerary?tripId=${recent.value.id}`)
}
function goCreate() {
  safeNav('/pages/index/index')
}
function onTopic() {
  Taro.showToast({ title: '专题内容建设中', icon: 'none' })
}
</script>

<style>
.wrap {
  min-height: 100vh;
  background: #F7F9F9;
  padding: 24rpx 24rpx 160rpx;
  box-sizing: border-box;
}

/* ---------- 分区标题行 ---------- */
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 28rpx 4rpx 20rpx;
}
.sec-title { font-size: 32rpx; font-weight: 700; color: #333333; }
.sec-more { font-size: 36rpx; color: #ADB5BD; line-height: 1; }

/* ---------- 精选专题卡 ---------- */
.topic-card {
  background: #ffffff;
  border-radius: 24rpx;
  overflow: hidden;
}
.topic-cover { position: relative; height: 400rpx; }
.topic-img { width: 100%; height: 100%; display: block; }
.topic-tag {
  position: absolute; left: 20rpx; bottom: 20rpx;
  font-size: 22rpx; color: #ffffff;
  background: rgba(0, 0, 0, 0.35);
  padding: 6rpx 20rpx; border-radius: 999rpx;
}
.topic-body { padding: 28rpx 28rpx 32rpx; }
.topic-title { font-size: 36rpx; font-weight: 700; color: #333333; }
.topic-meta { font-size: 24rpx; color: #868E96; margin-top: 12rpx; }
.topic-desc {
  font-size: 26rpx; color: #868E96; line-height: 1.7; margin-top: 18rpx;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  overflow: hidden;
}

/* ---------- 热门城市横滑海报 ---------- */
.city-scroll { white-space: nowrap; }
.city-card {
  position: relative;
  display: inline-block;
  width: 220rpx; height: 380rpx;
  border-radius: 16rpx;
  overflow: hidden;
  margin-right: 20rpx;
}
.city-card:last-child { margin-right: 0; }
.city-img { width: 100%; height: 100%; display: block; }
.city-veil {
  position: absolute; left: 0; right: 0; bottom: 0; height: 140rpx;
  background: linear-gradient(180deg, rgba(0, 0, 0, 0) 0%, rgba(0, 0, 0, 0.45) 100%);
}
.city-name {
  position: absolute; left: 16rpx; bottom: 14rpx;
  font-size: 30rpx; font-weight: 700; color: #ffffff;
  letter-spacing: 2rpx;
}

/* ---------- 最近行程卡 ---------- */
.trip-card {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 28rpx;
}
.trip-top { display: flex; align-items: flex-start; gap: 16rpx; }
.trip-info { flex: 1; min-width: 0; }
.trip-title { font-size: 32rpx; font-weight: 700; color: #333333; }
.trip-meta { font-size: 24rpx; color: #868E96; margin-top: 12rpx; }
.trip-count {
  flex-shrink: 0;
  font-size: 22rpx; color: #2E6E63;
  background: #E4F1EF;
  padding: 8rpx 20rpx; border-radius: 999rpx;
}
.trip-btn {
  margin-top: 24rpx;
  text-align: center;
  padding: 20rpx 0;
  background: #48A999;
  color: #ffffff;
  border-radius: 16rpx;
  font-size: 28rpx;
  font-weight: 600;
}
.trip-empty {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 60rpx 0;
  text-align: center;
}
.trip-empty-ico { font-size: 56rpx; margin-bottom: 16rpx; }
.trip-empty-txt { font-size: 26rpx; color: #868E96; }

/* ---------- 悬浮 + 号 ---------- */
.fab {
  position: fixed;
  right: 40rpx;
  bottom: 120rpx;
  width: 108rpx;
  height: 108rpx;
  border-radius: 50%;
  background: #48A999;
  box-shadow: 0 8rpx 24rpx rgba(72, 169, 153, 0.45);
  display: flex;
  align-items: center;
  justify-content: center;
}
.fab-icon { color: #ffffff; font-size: 60rpx; font-weight: 300; line-height: 1; }
</style>
