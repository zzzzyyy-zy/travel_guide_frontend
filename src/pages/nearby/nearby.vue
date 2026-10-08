<template>
  <!-- 周边设施独立页：首页快捷胶囊 + 行程页工具条进入。
       定位是本页的命根子：拿不到真实定位就只提示重试，绝不拿兜底坐标硬查（会查到无关设施被当成 bug） -->
  <view class="wrap">
    <view class="hero">
      <view class="hero-left">
        <view class="hero-city">周边设施</view>
        <view class="hero-sub">
          <image class="hero-ico" :src="ICO.pin" mode="aspectFit" />
          <text>{{ origin ? '基于你当前的位置 · 1km 范围' : '就近找公厕 / 民宿 / 停车场 / 充电桩' }}</text>
        </view>
      </view>
      <view class="hero-refresh" @tap="locate(true)"><image class="rf-ico" :src="ICO.refresh" mode="aspectFit" />刷新</view>
    </view>

    <!-- 定位中 / 定位失败：全页占位，失败给重试（不用演示坐标查，避免假结果） -->
    <view class="card state-card" v-if="locating">
      <image class="state-ico spin" :src="ICO.loader" mode="aspectFit" />
      <view class="state-txt">正在获取你的位置…</view>
      <view class="note">需要定位权限才能找周边设施</view>
    </view>
    <view class="card state-card" v-else-if="locFail">
      <image class="state-ico" :src="ICO.alert" mode="aspectFit" />
      <view class="state-txt">没能拿到你的位置</view>
      <view class="note">{{ locFailMsg || '请在系统设置里允许微信使用定位，然后重试' }}</view>
      <view class="retry-btn" @tap="locate(true)">重新定位</view>
    </view>

    <template v-else-if="origin">
      <!-- 地图：中心 = 用户位置（蓝点由 show-location 画），四类设施各一个彩色标点 -->
      <view class="card map-card">
        <map
          class="nb-map"
          :latitude="origin.lat"
          :longitude="origin.lng"
          :scale="15"
          :markers="markers"
          show-location
          @markertap="onMarkerTap"
        />
      </view>

      <!-- 四类卡片：最近一个（1km 内）；null = 该类附近没有 -->
      <view class="card fac-card" v-for="c in items" :key="c.key">
        <view class="fac-head">
          <view class="fac-chip" :style="{ background: c.tint }">
            <image class="fac-ico" :src="c.icon" mode="aspectFit" />
          </view>
          <text class="fac-key">{{ c.key }}</text>
          <text class="fac-dist" v-if="c.item">直线 {{ fmtDist(c.item.distance) }}</text>
          <text class="fac-dist dim" v-else>1km 内暂未找到</text>
        </view>
        <view class="fac-body" v-if="c.item" @tap="goThere(c)">
          <view class="fac-name">{{ c.item.name }}</view>
          <view class="fac-addr" v-if="c.item.address">{{ c.item.address }}</view>
          <view class="fac-go"><image class="go-ico" :src="ICO.nav" mode="aspectFit" />去这里</view>
        </view>
      </view>

      <view class="note foot-note">距离为直线距离，实际路程请以地图导航为准</view>
    </template>

    <!-- 兜底：既不在定位中、也没失败、又还没有坐标（理论不可达）。留着是为了「任何一帧都有内容渲染」，
         更要紧的是：绝不能在这条分支里读 origin.lat —— 那正是首帧崩溃（null.lat）的来源 -->
    <view class="card state-card" v-else>
      <image class="state-ico spin" :src="ICO.loader" mode="aspectFit" />
      <view class="state-txt">正在准备…</view>
      <view class="note">若长时间停在这里，点右上角「刷新」重试</view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import Taro, { useLoad } from '@tarojs/taro'
import api from '../../services/api'
import { getPosition } from '../../utils/position'
import { useShare } from '../../utils/share'
import pinGreen from '../../assets/icons/map-pin-green.png'
import nearbyGreen from '../../assets/icons/nearby-green.png'
import toiletGreen from '../../assets/icons/toilet-green.png'
import hotelWarm from '../../assets/icons/hotel-warm.png'
import parkingBlue from '../../assets/icons/parking-blue.png'
import chargingAmber from '../../assets/icons/charging-amber.png'
import refreshGreen from '../../assets/icons/refresh-green.png'
import loaderGreen from '../../assets/icons/loader-green.png'
import alertWarm from '../../assets/icons/triangle-alert-warm.png'
import navGreen from '../../assets/icons/search-green.png'

const ICO = { pin: pinGreen, nearby: nearbyGreen, refresh: refreshGreen, loader: loaderGreen, alert: alertWarm, nav: navGreen }

// 四类固定顺序（与后端返回 key 对齐）：每类带图标与标点色；marker 用 color 画的圆点即可区分
const CATS = [
  { key: '公厕',   icon: toiletGreen,    color: '#22C55E', tint: '#E7F9EE' },
  { key: '民宿',   icon: hotelWarm,      color: '#F29979', tint: '#FDF1EC' },
  { key: '停车场', icon: parkingBlue,    color: '#4A90E2', tint: '#EBF3FC' },
  { key: '充电桩', icon: chargingAmber,  color: '#E8B04B', tint: '#FBF4E4' }
]

// 初始即「定位中」：进页面第一件事就是定位；这样首帧渲染走的是 loading 卡片分支，
// 不会掉进读 origin.lat 的分支（origin 此时还是 null → 真机报 null.lat 崩溃）
const locating = ref(true)
const locFail = ref(false)
const locFailMsg = ref('')
const origin = ref(null)      // { lat, lng }（position.js 全程 GCJ-02，与后端一致）
const loading = ref(false)    // 设施查询中
const items = ref([])         // [{ key, icon, color, tint, item | null }]
let busy = false              // 定位请求在途（防重复点击/重复进入；与 locating 解耦，避免初始 true 把首次定位挡掉）
let fromTrip = ''             // 来源行程（仅埋点用，查询本身只认坐标）

useLoad(options => {
  fromTrip = options && options.tripId ? options.tripId : ''
  locate(false)
})

// 分享：本页不依赖任何 id（纯定位工具页），转发回本页即可
useShare(() => ({
  title: '周边设施 · 就近找公厕/停车场/充电桩',
  path: '/pages/nearby/nearby'
}), { timeline: false })

// ---------- 定位：唯一入口。isFallback（演示坐标）视为失败 ----------
function locate(force) {
  if (busy) return              // 在途去重：用 busy，不用 locating（locating 初始就是 true）
  busy = true
  locating.value = true
  locFail.value = false
  getPosition(force === true).then(pos => {
    busy = false
    locating.value = false
    // 模拟器/定位失败会走「景区主入口」兜底坐标：拿它查设施 = 查到无关结果 → 明确拒绝
    if (!pos || pos.isFallback) {
      locFail.value = true
      locFailMsg.value = '当前环境拿不到真实定位（模拟器无 GPS）。请在真机上打开定位后重试'
      return
    }
    origin.value = { lat: pos.lat, lng: pos.lng }
    query()
  }).catch(e => {
    busy = false
    locating.value = false
    locFail.value = true
    locFailMsg.value = (e && e.message) || ''
  })
}

// ---------- 查询四类设施 ----------
function query() {
  if (!origin.value || loading.value) return
  loading.value = true
  api.nearby.facilities(origin.value.lat, origin.value.lng).then(data => {
    loading.value = false
    const d = data || {}
    items.value = CATS.map(c => ({ ...c, item: d[c.key] || null }))
    api.event.report([{ type: 'view', payload: { page: 'nearby', tripId: fromTrip || undefined } }])
  }).catch(e => {
    loading.value = false
    Taro.showToast({ title: (e && e.message) || '周边设施查询失败', icon: 'none' })
  })
}

// 地图标点：每类一个，label 常显类别名；点了直接导航
const markers = computed(() => items.value
  .filter(c => c.item)
  .map((c, i) => ({
    id: i,
    latitude: c.item.lat,
    longitude: c.item.lng,
    iconPath: c.icon,
    width: 30,
    height: 30,
    label: {
      content: c.key,
      color: '#333333',
      bgColor: '#ffffff',
      borderRadius: 8,
      borderWidth: 1,
      borderColor: c.color,
      padding: 5,
      fontSize: 11,
      anchorY: -4
    }
  }))
)

// 点标点 → 唤起地图导航（与卡片「去这里」一致）
function onMarkerTap(e) {
  const id = typeof e === 'object' && e && (e.markerId != null ? e.markerId : (e.detail && e.detail.markerId))
  const c = items.value.filter(x => x.item)[id]
  if (c) goThere(c)
}

// 去这里：交给微信内置地图（路线规划/打车都顺理成章，本页不做导航）
function goThere(c) {
  if (!c.item) return
  Taro.openLocation({
    latitude: c.item.lat,
    longitude: c.item.lng,
    name: c.item.name,
    address: c.item.address || '',
    scale: 17
  })
}

// 距离：<1000m 显示「xxx 米」，否则一位小数公里
function fmtDist(m) {
  const n = Number(m)
  if (!isFinite(n)) return '距离未知'
  return n < 1000 ? `${n} 米` : `${(n / 1000).toFixed(1)} km`
}
</script>

<style>
.wrap { min-height: 100vh; background: #F6F9F7; padding: 24rpx 28rpx calc(40rpx + env(safe-area-inset-bottom)); box-sizing: border-box; }

/* 顶部 hero：与 expense/memo 页同款 */
.hero { display: flex; align-items: center; justify-content: space-between; margin-bottom: 20rpx; }
.hero-city { font-size: 40rpx; font-weight: 700; color: #1F2937; }
.hero-sub { display: flex; align-items: center; gap: 8rpx; margin-top: 8rpx; font-size: 24rpx; color: #868E96; }
.hero-ico { width: 26rpx; height: 26rpx; flex-shrink: 0; }
.hero-refresh { display: flex; align-items: center; gap: 6rpx; font-size: 24rpx; color: #15803D; background: #ffffff; border-radius: 999rpx; padding: 12rpx 24rpx; box-shadow: 0 4rpx 16rpx rgba(21,128,61,0.05); }
.rf-ico { width: 26rpx; height: 26rpx; }

.card { background: #ffffff; border-radius: 24rpx; padding: 28rpx; margin-bottom: 20rpx; box-shadow: 0 4rpx 16rpx rgba(21,128,61,0.05); }

/* 定位中 / 失败态 */
.state-card { display: flex; flex-direction: column; align-items: center; padding: 72rpx 28rpx; }
.state-ico { width: 72rpx; height: 72rpx; margin-bottom: 20rpx; }
.spin { animation: nb-rotate 1s linear infinite; }
@keyframes nb-rotate { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
.state-txt { font-size: 30rpx; font-weight: 600; color: #1F2937; }
.retry-btn { margin-top: 28rpx; background: #22C55E; color: #ffffff; font-size: 28rpx; border-radius: 999rpx; padding: 16rpx 56rpx; }
.retry-btn:active { opacity: 0.8; }

/* 地图卡 */
.map-card { padding: 12rpx; }
.nb-map { width: 100%; height: 420rpx; border-radius: 16rpx; }

/* 设施卡 */
.fac-card { padding: 24rpx 28rpx; }
.fac-head { display: flex; align-items: center; gap: 14rpx; }
.fac-chip { width: 56rpx; height: 56rpx; border-radius: 16rpx; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.fac-ico { width: 34rpx; height: 34rpx; }
.fac-key { font-size: 30rpx; font-weight: 600; color: #1F2937; }
.fac-dist { margin-left: auto; font-size: 24rpx; color: #15803D; font-weight: 600; }
.fac-dist.dim { color: #ADB5BD; font-weight: 400; }
.fac-body { margin-top: 16rpx; padding-top: 16rpx; border-top: 2rpx dashed #E9EFEB; display: flex; align-items: flex-start; gap: 12rpx; }
.fac-name { flex: 1; font-size: 28rpx; color: #333333; line-height: 1.5; }
.fac-addr { flex: 1; font-size: 24rpx; color: #868E96; line-height: 1.5; margin-top: 4rpx; }
.fac-go { display: flex; align-items: center; gap: 6rpx; font-size: 24rpx; color: #15803D; background: #E7F9EE; border-radius: 999rpx; padding: 10rpx 22rpx; flex-shrink: 0; }
.fac-go:active { opacity: 0.7; }
.go-ico { width: 24rpx; height: 24rpx; }

.note { font-size: 24rpx; color: #868E96; line-height: 1.6; }
.note.center { text-align: center; }
.foot-note { text-align: center; margin-top: 8rpx; }
</style>
