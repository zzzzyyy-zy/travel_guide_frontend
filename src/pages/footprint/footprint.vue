<template>
  <view class="wrap">
    <!-- 统计卡：点亮城市数 / 累计行程 / 热门城市覆盖率 -->
    <view class="card stat-card">
      <view class="stat-row">
        <view class="stat"><text class="num">{{ visitedCount }}</text><text class="label">点亮城市</text></view>
        <view class="stat"><text class="num">{{ trips.length }}</text><text class="label">累计行程</text></view>
        <view class="stat"><text class="num">{{ litPct }}%</text><text class="label">热门覆盖</text></view>
      </view>
      <view class="hint">去过的城市自动点亮 · 每生成一条行程就多一座城</view>
    </view>

    <!-- 足迹地图：Canvas 自绘省界（真机 map 组件 polygons 兼容性差，弃用）；
         已点亮省份铺青色，未点亮浅灰；支持单指拖动 / 双指缩放 -->
    <view class="card map-card">
      <canvas
        id="fpCanvas"
        type="2d"
        class="fp-map"
        disable-scroll
        @touchstart="onTouchStart"
        @touchmove="onTouchMove"
        @touchend="onTouchEnd"
      />
      <view class="legend"><view class="lg lit"><view class="swatch swatch-lit" /><text>已点亮省份</text></view><view class="lg"><view class="swatch" /><text>未点亮</text></view><view class="lg tip">拖动查看 · 双指缩放</view></view>
    </view>

    <!-- 成就打通：优先用后端成就体系里的城市/足迹系列；后端没有时用本地档位兜底 -->
    <view class="card" v-if="achv">
      <view class="ach-head">
        <view class="ach-name"><image class="ach-ico" :src="ICO.medal" mode="aspectFit" />{{ achv.name }}</view>
        <text class="ach-title" :class="{ none: !achv.current }">{{ achv.current ? achv.title : '未解锁' }}</text>
      </view>
      <view class="ach-bar"><view class="ach-fill" :style="{ width: achPct + '%' }"></view></view>
      <view class="ach-note">{{ achNote }}</view>
    </view>

    <!-- 城市清单：已点亮（含行程数）+ 待解锁（点击回首页生成） -->
    <view class="card" v-if="litCities.length">
      <view class="sec-title">已点亮 · {{ litCities.length }} 城</view>
      <view class="chips">
        <text class="chip lit" v-for="c in litCities" :key="c.city">{{ c.city }} ×{{ c.count }}</text>
      </view>
    </view>
    <view class="card">
      <view class="sec-title">待解锁 · {{ lockedCities.length }} 城</view>
      <view class="chips">
        <text class="chip locked" v-for="c in lockedCities" :key="c" @tap="goHome">{{ c }}</text>
      </view>
      <view class="hint" v-if="lockedCities.length">点亮一座新城：回首页生成该城市的行程</view>
    </view>

    <AuthMask />
  </view>
</template>

<script setup>
import { ref, computed, reactive } from 'vue'
import Taro, { useDidShow } from '@tarojs/taro'
import { useShare } from '../../utils/share'
import api from '../../services/api'
import { sessionState, requireLogin } from '../../utils/auth'
import AuthMask from '../../components/AuthMask.vue'
import { CITY_COORDS, normCity } from '../../data/cityCoords'
import { PROVINCE_SHAPES } from '../../data/provinceShapes'
import medal from '../../assets/icons/medal-gold.png'

const ICO = { medal }

const trips = ref([])          // 行程列表（城市从 destinationCity/city 聚合）
const achvFromApi = ref(null)  // 后端成就体系里的城市/足迹系列（可能没有）

// 本地兜底档位：后端暂无「城市探索」成就系列时使用
const LOCAL_TIERS = [
  { count: 1, title: '初来乍到' },
  { count: 3, title: '城市漫步者' },
  { count: 5, title: '旅行玩家' },
  { count: 10, title: '足迹达人' },
  { count: 20, title: '环球旅行家' }
]

// ---------- 足迹聚合：城市 → 行程数（城市名归一化后对坐标表） ----------
const visitedMap = computed(() => {
  const m = new Map()
  trips.value.forEach(t => {
    const c = normCity(t.city || t.destinationCity)
    if (!c) return
    m.set(c, (m.get(c) || 0) + 1)
  })
  return m
})

const visitedCount = computed(() => visitedMap.value.size)

// 在坐标表里的已点亮城市（地图只打表内城市；表外城市仅计入计数）
const litCities = computed(() =>
  [...visitedMap.value]
    .filter(([c]) => CITY_COORDS[c])
    .map(([city, count]) => ({ city, count }))
    .sort((a, b) => b.count - a.count)
)
const lockedCities = computed(() => Object.keys(CITY_COORDS).filter(c => !visitedMap.value.has(c)))
const litPct = computed(() => Math.round((litCities.value.length / Object.keys(CITY_COORDS).length) * 100))

// ---------- Canvas 自绘足迹地图（替代 <map>：零外部依赖，真机/工具表现一致） ----------
// 已点亮省份铺青色；单指拖动、双指缩放；绘制范围含南海诸岛（合规要求）
const PROVINCE_OF = {
  北京: '北京市', 上海: '上海市', 广州: '广东省', 深圳: '广东省', 成都: '四川省',
  重庆: '重庆市', 杭州: '浙江省', 西安: '陕西省', 南京: '江苏省', 苏州: '江苏省',
  武汉: '湖北省', 长沙: '湖南省', 厦门: '福建省', 昆明: '云南省', 贵阳: '贵州省',
  青岛: '山东省', 济南: '山东省', 三亚: '海南省', 哈尔滨: '黑龙江省',
  乌鲁木齐: '新疆维吾尔自治区', 兰州: '甘肃省', 拉萨: '西藏自治区',
  郑州: '河南省', 桂林: '广西壮族自治区'
}

const litProvinces = computed(() => {
  const s = new Set()
  ;[...visitedMap.value.keys()].forEach(c => { const p = PROVINCE_OF[c]; if (p) s.add(p) })
  return s
})

// 全国范围（含南海诸岛， lng 73~135.5 / lat 3~53.8）
const CN = { minLng: 73, maxLng: 135.5, minLat: 3, maxLat: 53.8 }
// 等经纬投影纠偏：纬度 35°（中国地理中心附近）处经度 1° 的实际长度只有纬度 1° 的 cos(35°)≈0.82
// 不乘这个系数整张地图会被横向拉宽 ~22%，看着"扁得不正常"
const LNG_K = Math.cos(35 * Math.PI / 180)

let ctx = null
let cvW = 0
let cvH = 0
const view = reactive({ scale: 1, ox: 0, oy: 0 })

function baseScale() {
  return Math.min(cvW / ((CN.maxLng - CN.minLng) * LNG_K), cvH / (CN.maxLat - CN.minLat))
}
function projX(lng) {
  return (lng - (CN.minLng + CN.maxLng) / 2) * baseScale() * LNG_K * view.scale + cvW / 2 + view.ox
}
function projY(lat) {
  return ((CN.minLat + CN.maxLat) / 2 - lat) * baseScale() * view.scale + cvH / 2 + view.oy
}

function setupCanvas() {
  Taro.createSelectorQuery().select('#fpCanvas').fields({ node: true, size: true }).exec(res => {
    if (!res || !res[0] || !res[0].node) return
    const node = res[0].node
    const dpr = (Taro.getSystemInfoSync().pixelRatio) || 2
    cvW = res[0].width
    cvH = res[0].height
    node.width = cvW * dpr
    node.height = cvH * dpr
    ctx = node.getContext('2d')
    ctx.scale(dpr, dpr)
    draw()
  })
}

function draw() {
  if (!ctx) return
  ctx.clearRect(0, 0, cvW, cvH)
  ctx.fillStyle = '#F2F6F5'                       // 海面/底色
  ctx.fillRect(0, 0, cvW, cvH)
  // 省份多边形：去过 = 青色填充，没去过 = 浅灰
  Object.keys(PROVINCE_SHAPES).forEach(name => {
    const on = litProvinces.value.has(name)
    PROVINCE_SHAPES[name].paths.forEach(ring => {
      ctx.beginPath()
      ring.forEach(([lng, lat], i) => {
        const X = projX(lng), Y = projY(lat)
        i ? ctx.lineTo(X, Y) : ctx.moveTo(X, Y)
      })
      ctx.closePath()
      ctx.fillStyle = on ? 'rgba(34,197,94,0.45)' : 'rgba(134,142,150,0.10)'
      ctx.fill()
      ctx.strokeStyle = on ? '#15803D' : '#C9C7BE'
      ctx.lineWidth = 0.6
      ctx.stroke()
    })
  })
  // 未点亮城市：灰色小点
  lockedCities.value.forEach(c => {
    const p = CITY_COORDS[c]
    if (!p) return
    ctx.beginPath()
    ctx.arc(projX(p.lng), projY(p.lat), 2.5, 0, Math.PI * 2)
    ctx.fillStyle = '#B4B2A9'
    ctx.fill()
  })
  // 已点亮城市：青色圆点 + 城市名·行程数
  ctx.textAlign = 'center'
  litCities.value.forEach(({ city, count }) => {
    const p = CITY_COORDS[city]
    if (!p) return
    const X = projX(p.lng), Y = projY(p.lat)
    ctx.beginPath()
    ctx.arc(X, Y, 4, 0, Math.PI * 2)
    ctx.fillStyle = '#15803D'
    ctx.fill()
    ctx.font = '11px sans-serif'
    ctx.fillText(`${city} · ${count}`, X, Y - 8)
  })
  // 南海诸岛标注（地图合规）
  ctx.font = '10px sans-serif'
  ctx.fillStyle = '#868E96'
  ctx.fillText('南海诸岛', projX(112.5), projY(12))
}

// 手势：单指拖动 / 双指缩放
let lastTouches = []
let pinchBase = 0
let pinchScale = 1

function onTouchStart(e) {
  lastTouches = e.touches
  if (e.touches.length === 2) {
    pinchBase = touchDist(e.touches)
    pinchScale = view.scale
  }
}
function onTouchMove(e) {
  if (e.touches.length === 1 && lastTouches.length === 1) {
    view.ox += e.touches[0].clientX - lastTouches[0].clientX
    view.oy += e.touches[0].clientY - lastTouches[0].clientY
  } else if (e.touches.length === 2 && pinchBase > 0) {
    view.scale = Math.max(0.8, Math.min(10, pinchScale * touchDist(e.touches) / pinchBase))
  }
  lastTouches = e.touches
  draw()
}
function onTouchEnd(e) {
  lastTouches = e.touches
  if (e.touches.length < 2) pinchBase = 0
}
function touchDist(ts) {
  const dx = ts[0].clientX - ts[1].clientX
  const dy = ts[0].clientY - ts[1].clientY
  return Math.hypot(dx, dy)
}

// ---------- 成就打通：后端有「城市/足迹」系列用后端；否则本地档位兜底 ----------
const achv = computed(() => {
  if (achvFromApi.value) return achvFromApi.value
  const n = visitedCount.value
  if (!n) return null
  const cur = LOCAL_TIERS.filter(t => n >= t.count).length
  return {
    name: '足迹探索',
    progress: n,
    current: cur,
    title: cur ? LOCAL_TIERS[cur - 1].title : '',
    levels: LOCAL_TIERS.map(t => ({ count: t.count, title: t.title })),
    local: true
  }
})
const achNext = computed(() => {
  const a = achv.value
  if (!a) return 1
  const ls = a.levels || []
  return (a.current || 0) < ls.length ? ls[a.current].count : ls[ls.length - 1].count
})
const achPct = computed(() => {
  const a = achv.value
  if (!a) return 0
  return Math.min(100, Math.round(((a.progress || 0) / (achNext.value || 1)) * 100))
})
const achNote = computed(() => {
  const a = achv.value
  if (!a) return ''
  if ((a.current || 0) >= (a.levels || []).length) return `已满级 · 点亮 ${a.progress} 城`
  return `进度 ${a.progress}/${achNext.value} 城 · 下一档「${a.levels[a.current].title}」`
})

// 真实后端 GET /api/trip/list 只返回 { id, title, isFavorite, createdAt }，没有 city——
// 逐条拉详情补齐 city/days（本页会话内缓存，重复进页不重复请求）
const detailCache = new Map()

function load() {
  if (!sessionState.loggedIn) return
  Promise.all([
    api.trips.list().then(list => {
      const items = Array.isArray(list) ? list : []
      return Promise.all(items.map(it => {
        if (it.city) return Promise.resolve(it)              // mock/后端补齐过字段时直接用
        if (detailCache.has(it.id)) return Promise.resolve({ ...it, ...detailCache.get(it.id) })
        return api.trips.detail(it.id).then(d => {
          const extra = { city: d.city, days: d.days }
          detailCache.set(it.id, extra)
          return { ...it, ...extra }
        }).catch(() => it)                                    // 单条详情失败不拖垮整页
      }))
    }),
    api.growth.achievements().then(list => {
      const hit = (Array.isArray(list) ? list : []).find(a => /城市|足迹|探索/.test(a.name || ''))
      if (hit) achvFromApi.value = hit
      return null
    }).catch(() => null)
  ]).then(([list]) => {
    trips.value = list
    draw()          // 数据到位后重绘（canvas 可能已先初始化完成）
  }).catch(() => {
    trips.value = []
    Taro.showToast({ title: '足迹加载失败', icon: 'none' })
  })
}

// 分享：足迹地图（转发/朋友圈都指回本页，点开即渲染；未登录会先走登录）
useShare(() => ({
  title: '我的旅行足迹地图，看看走过多少地方',
  path: '/pages/footprint/footprint'
}), { timeline: true })

useDidShow(() => {
  requireLogin(load)
  setupCanvas()   // 每次进页初始化 Canvas（登录前后都能画底图）
})

function goHome() {
  Taro.switchTab({ url: '/pages/home/home' })
}
</script>

<style>
.wrap { padding: 24rpx; }
.card { background: #ffffff; border-radius: 20rpx; padding: 28rpx; margin-bottom: 24rpx; }
.stat-row { display: flex; }
.stat { flex: 1; display: flex; flex-direction: column; align-items: center; }
.num { font-size: 44rpx; font-weight: 700; color: #22C55E; }
.label { font-size: 22rpx; color: #868E96; margin-top: 4rpx; }
.hint { margin-top: 18rpx; font-size: 22rpx; color: #868E96; text-align: center; }
.map-card { padding: 12rpx; }
.fp-map { width: 100%; height: 720rpx; border-radius: 16rpx; }
.legend { display: flex; gap: 24rpx; padding: 14rpx 8rpx 4rpx; }
.lg { display: flex; align-items: center; gap: 8rpx; font-size: 22rpx; color: #868E96; }
.lg.lit { color: #15803D; }
/* 图例色块：替代原 ■ 字符 */
.swatch { width: 18rpx; height: 18rpx; border-radius: 4rpx; background: #DDE5E3; }
.swatch-lit { background: #22C55E; }
.ach-head { display: flex; justify-content: space-between; align-items: center; }
.ach-name { display: flex; align-items: center; gap: 8rpx; font-size: 28rpx; color: #333333; font-weight: 600; }
.ach-ico { width: 30rpx; height: 30rpx; }
.ach-title { font-size: 24rpx; color: #F29979; font-weight: 600; }
.ach-title.none { color: #868E96; }
.ach-bar { height: 14rpx; background: #E7F9EE; border-radius: 7rpx; margin: 18rpx 0 10rpx; overflow: hidden; }
.ach-fill { height: 100%; background: #22C55E; border-radius: 7rpx; transition: width 0.4s; }
.ach-note { font-size: 22rpx; color: #868E96; }
.sec-title { font-size: 28rpx; font-weight: 600; color: #333333; margin-bottom: 18rpx; }
.chips { display: flex; flex-wrap: wrap; gap: 14rpx; }
.chip { font-size: 24rpx; padding: 8rpx 22rpx; border-radius: 999rpx; }
.chip.lit { background: #E7F9EE; color: #15803D; font-weight: 600; }
.chip.locked { background: #F1EFE8; color: #868E96; }
</style>
