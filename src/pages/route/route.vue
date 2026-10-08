<template>
  <view class="wrap">
    <!-- 地图：标记点 + （计算后）最优顺序折线 -->
    <map
      id="routeMap"
      class="map"
      :markers="markers"
      :polyline="polyline"
      :show-location="true"
      :latitude="center.lat"
      :longitude="center.lng"
      :scale="12"
    ></map>

    <view class="panel">
      <!-- 已标记地点列表（后端已移除 origin 参数，路线固定从第一个标记点出发） -->
      <view class="pt-item" v-for="(p, i) in points" :key="i">
        <view class="pt-no">{{ i + 1 }}</view>
        <view class="pt-mid">
          <view class="pt-name">{{ p.name }}</view>
          <view class="pt-sub">{{ p.lat.toFixed(4) }}, {{ p.lng.toFixed(4) }}</view>
        </view>
        <image class="pt-del" :src="icoClose" mode="aspectFit" @tap="removePoint(i)" />
      </view>
      <view class="pt-empty" v-if="!points.length">还没有标记地点，点下面按钮去地图选点</view>

      <view class="btn ghost" @tap="addPoint">＋ 添加地点</view>
      <view class="btn" :class="{ disabled: busy || points.length < 2 }" @tap="compute">
        {{ busy ? '规划中…' : '计算最优路线' }}
      </view>

      <!-- 结果：最优顺序 + 站间步行距离（只展示距离，不做时长推算；规划失败的站显示「距离未知」） -->
      <view class="result" v-if="result">
        <view class="result-total">
          全程 {{ fmtDist(result.totalDistance) }}
        </view>
        <view class="rt-item" v-for="(s, k) in result.route" :key="k">
          <view class="rt-no">{{ k + 1 }}</view>
          <view class="rt-mid">
            <view class="rt-name">{{ s.name }}</view>
            <view class="rt-dist">
              <template v-if="k === 0">出发点</template>
              <template v-else>距上一站步行 {{ fmtDist(s.distance) }}</template>
            </view>
          </view>
        </view>
        <view class="result-note" v-if="result.route.some(s => s.distance == null)">带「距离未知」的路段是路线规划失败，仅供参考顺序</view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, reactive } from 'vue'
import Taro from '@tarojs/taro'
import api from '../../services/api'
import closeGr2 from '../../assets/icons/close-gray.png'
const icoClose = closeGr2

// 图钉用包内绝对路径（config copy 拷贝），不 import——避免被内联成 base64，真机 marker 不显示
const pinIcon = '/assets/map-pin.png'

// 地图中心：跟据已标记点动态跟随（无点时默认杭州西湖一带）
const center = reactive({ lat: 30.24, lng: 120.15 })

const points = ref([])        // 用户标记的地点 [{ name, lat, lng }]
const result = ref(null)      // 接口返回 { route, totalDistance }（只展示距离）
const busy = ref(false)

const markers = ref([])
const polyline = ref([])

// ---------- 添加/删除标记点 ----------
function addPoint() {
  Taro.chooseLocation({
    success: res => {
      if (!res || !isFinite(res.latitude) || !isFinite(res.longitude)) return
      points.value.push({ name: res.name || res.address || '未命名地点', lat: res.latitude, lng: res.longitude })
      const p = points.value[points.value.length - 1]
      center.lat = p.lat
      center.lng = p.lng
      result.value = null      // 点变了，旧结果作废
      polyline.value = []
      renderMarkers()
    },
    fail: err => {
      if (err && /cancel/i.test(err.errMsg || '')) return
      Taro.showToast({ title: '打开地图选点失败', icon: 'none' })
    }
  })
}
function removePoint(i) {
  points.value.splice(i, 1)
  result.value = null
  polyline.value = []
  renderMarkers()
}

// ---------- 计算：最近邻最优顺序（后端已移除 origin，固定从第一个标记点出发） ----------
function compute() {
  if (busy.value || points.value.length < 2) {
    if (points.value.length < 2) Taro.showToast({ title: '至少标记两个地点', icon: 'none' })
    return
  }
  busy.value = true
  api.route.optimize(points.value.map(p => ({ name: p.name, lat: p.lat, lng: p.lng })))
    .then(d => {
      // 后端契约（2026-10-06 确认）：route[] 只有 {name,lat,lng,distance} + totalDistance（distance 单位米），
      // 没有 duration → 只展示距离，不推算时长
      result.value = d || { route: [], totalDistance: null }
      drawPolyline()
      renderMarkers(true)
      Taro.showToast({ title: '路线已生成', icon: 'success' })
    })
    .catch(e => {
      Taro.showToast({ title: (e && e.message) || '路线计算失败', icon: 'none' })
    })
    .finally(() => { busy.value = false })
}

// 地图折线：按最优顺序连接各点（第一站即出发点），直线连接
// ⚠️ 不要加 arrowLine —— 安卓真机不支持该属性，会导致整条 polyline 渲染不出来（iOS/开发者工具正常）
function drawPolyline() {
  const route = result.value && result.value.route
  if (!Array.isArray(route) || route.length < 2) { polyline.value = []; return }
  polyline.value = [{
    points: route.map(s => ({ latitude: s.lat, longitude: s.lng })),
    color: '#22C55ECC',
    width: 4
  }]
}

// 标记点：计算后用 label 标出游玩顺序号（按坐标匹配，避免同名地点互相顶号）
function renderMarkers(numbered) {
  const list = []
  points.value.forEach((p, i) => {
    const m = {
      id: i, latitude: p.lat, longitude: p.lng,
      iconPath: pinIcon, width: 28, height: 35,
      callout: { content: p.name, display: 'BYCLICK', color: '#15803D', bgColor: '#FFFFFF', borderRadius: 8, padding: 6, fontSize: 12 }
    }
    if (numbered && result.value) {
      const order = result.value.route.findIndex(r =>
        Math.abs(Number(r.lat) - p.lat) < 1e-6 && Math.abs(Number(r.lng) - p.lng) < 1e-6
      )
      if (order >= 0) {
        m.label = { content: String(order + 1), color: '#FFFFFF', bgColor: '#22C55E', borderRadius: 9, padding: 4, fontSize: 11, anchorX: -9, anchorY: -40 }
      }
    }
    list.push(m)
  })
  markers.value = list
  // 视野自适应：把所有点装进地图
  if (list.length >= 2) {
    const ctx = Taro.createMapContext('routeMap')
    ctx.includePoints({ points: list.map(m => ({ latitude: m.latitude, longitude: m.longitude })), padding: [50, 50, 50, 50] })
  }
}

// ---------- 格式化（与行程页 reorder-from 同一套兜底：null → 距离未知）----------
function fmtDist(m) {
  if (m == null || !isFinite(m)) return '距离未知'
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`
}
// 只展示距离：后端 route[] 只有 { name, lat, lng, distance }（米）+ totalDistance，没有时长字段。
// 前端不再做任何时长推算（曾用 1.2 m/s 步速算过一版，2026-10-06 按用户要求整体下线）。
</script>

<style lang="scss">
.wrap { background: #F7F9F9; min-height: 100vh; padding-bottom: 60rpx; }
.map { width: 100%; height: 46vh; }
.panel { padding: 24rpx 30rpx; }

.pt-item { display: flex; align-items: center; background: #fff; border-radius: 16rpx; padding: 20rpx 24rpx; margin-bottom: 14rpx; }
.pt-no { width: 44rpx; height: 44rpx; border-radius: 50%; background: #E7F9EE; color: #15803D; font-size: 24rpx; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.pt-mid { flex: 1; min-width: 0; margin-left: 18rpx; }
.pt-name { font-size: 27rpx; color: #1B2B2A; }
.pt-sub { font-size: 21rpx; color: #A8B3B2; margin-top: 4rpx; }
/* 🔴 pt-del 是 <image> 不是文字：必须给显式宽高，否则按默认 320×240 渲染，
   把 .pt-mid 挤成一列竖排字（2026-10-06 真机截图实锤「排版出错」的真凶） */
.pt-del { width: 40rpx; height: 40rpx; flex-shrink: 0; margin-left: 20rpx; padding: 10rpx; }
.pt-empty { font-size: 24rpx; color: #868E96; text-align: center; padding: 30rpx 0; }

.btn { margin-top: 22rpx; height: 88rpx; border-radius: 44rpx; background: #22C55E; color: #fff; font-size: 30rpx; font-weight: 600; display: flex; align-items: center; justify-content: center; }
.btn.ghost { background: #fff; color: #15803D; border: 2rpx solid #22C55E55; margin-top: 0; }
.btn.disabled { opacity: 0.5; }

.result { margin-top: 34rpx; background: #fff; border-radius: 20rpx; padding: 26rpx 26rpx; }
.result-total { font-size: 27rpx; color: #15803D; font-weight: 600; padding-bottom: 18rpx; border-bottom: 2rpx solid #E7F9EE; }
.rt-item { display: flex; align-items: flex-start; padding: 20rpx 0 0; }
.rt-no { width: 44rpx; height: 44rpx; border-radius: 50%; background: #22C55E; color: #fff; font-size: 24rpx; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.rt-mid { flex: 1; min-width: 0; margin-left: 18rpx; }
.rt-name { font-size: 28rpx; color: #1B2B2A; }
.rt-dist { font-size: 22rpx; color: #868E96; margin-top: 4rpx; }
.result-note { font-size: 21rpx; color: #A8B3B2; margin-top: 20rpx; }
</style>
