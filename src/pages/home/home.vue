<template>
  <view class="wrap">
    <!-- ========== 顶部城市行：纯展示实时定位城市（2026-10-08 用户要求：不加城市切换/示例行程入口） ========== -->
    <view class="city-row">
      <image class="city-ico" :src="ICO.pin" mode="aspectFit" />
      <text class="city-name">{{ cityName }}</text>
    </view>

    <!-- ========== 最近行程 hero 卡：渐变色背景（2026-10-06 用户要求改渐变、不用实拍图），白字信息浮层 ========== -->
    <view class="trip-hero" hover-class="card-hover" v-if="recent" @tap="goDetail">
      <view class="trip-hero-body">
        <view class="hero-top">
          <view class="hero-chip">{{ statusChip || '最近行程' }}</view>
          <view class="hero-count" v-if="countdown">
            <view class="hero-count-label">{{ countdown.label }}</view>
            <view class="hero-count-num">{{ countdown.num }}</view>
          </view>
        </view>
        <view class="hero-title">{{ recent.title }}</view>
        <view class="hero-date" v-if="heroDate">
          <image class="hero-date-ico" :src="ICO.calWhite" mode="aspectFit" />
          <text>{{ heroDate }}</text>
          <text v-if="heroNights"> · {{ heroNights }}</text>
        </view>
      </view>
    </view>
    <view class="trip-empty" v-else-if="!tripLoading">
      <image class="trip-empty-ico" :src="ICO.map" mode="aspectFit" />
      <view class="trip-empty-txt">还没有行程，点底部中央 ＋ 创建</view>
    </view>

    <!-- ========== 两枚功能卡：路线规划 / 历史足迹 ========== -->
    <view class="feat-row">
      <view class="feat-card" hover-class="card-hover" @tap="goRoute">
        <view class="feat-ico-wrap"><image class="feat-ico" :src="ICO.route" mode="aspectFit" /></view>
        <view class="feat-name">路线规划</view>
        <view class="feat-sub">定制专属行程</view>
      </view>
      <!-- 历史足迹 = 城市足迹页（footprint，非 tabBar 页 → navigateTo；未登录由页内自己拉起登录） -->
      <view class="feat-card" hover-class="card-hover" @tap="goFootprint">
        <view class="feat-ico-wrap"><image class="feat-ico" :src="ICO.history" mode="aspectFit" /></view>
        <view class="feat-name">历史足迹</view>
        <view class="feat-sub">记录每份美好</view>
      </view>
    </view>

    <!-- ========== 周边设施四小钮：白方块只装图标，文字在卡片外（参考样式 2026-10-05） ========== -->
    <view class="mini-row">
      <view class="mini-item" v-for="m in MINIS" :key="m.name" hover-class="pill-hover" @tap="goNearby">
        <view class="mini-tile"><image class="mini-ico" :src="m.icon" mode="aspectFit" /></view>
        <view class="mini-name">{{ m.name }}</view>
      </view>
    </view>

    <!-- ========== 热门景点推荐：双列瀑布流（左列偶数、右列奇数，卡高错开）；点击带城市跳行程规划 ========== -->
    <view class="sec-head">
      <text class="sec-title">热门景点推荐</text>
      <text class="sec-link" @tap="moreInsp">探索更多 ›</text>
    </view>
    <view class="insp-row">
      <view class="insp-col">
        <view class="insp-card" v-for="c in inspLeft" :key="c.title" hover-class="card-hover" @tap="goCity(c.city)">
          <view class="insp-img-wrap">
            <image class="insp-img" :src="c.img" :style="{ height: c.h }" mode="aspectFill" />
            <view class="insp-tag">{{ c.tag }}</view>
          </view>
          <view class="insp-title">{{ c.title }}</view>
          <view class="insp-meta">
            <text class="insp-info">{{ c.info }}</text>
          </view>
        </view>
      </view>
      <view class="insp-col">
        <view class="insp-card" v-for="c in inspRight" :key="c.title" hover-class="card-hover" @tap="goCity(c.city)">
          <view class="insp-img-wrap">
            <image class="insp-img" :src="c.img" :style="{ height: c.h }" mode="aspectFill" />
            <view class="insp-tag">{{ c.tag }}</view>
          </view>
          <view class="insp-title">{{ c.title }}</view>
          <view class="insp-meta">
            <text class="insp-info">{{ c.info }}</text>
          </view>
        </view>
      </view>
    </view>

    <!-- 全局授权弹层：游客浏览时不再自动弹（2026-10-09 微信审核整改）；
         只有点了需要登录的功能（AI 搭子入口、个别入口）才会由 requireLogin 唤起 -->
    <AuthMask />
  </view>
</template>

<script setup>
import Taro, { useDidShow } from '@tarojs/taro'
import { useShare } from '../../utils/share'
// 功能级登录拦截：游客可浏览首页，点「路线规划 / 周边设施」这类要服务端数据的功能才弹登录
import { requireLogin } from '../../utils/auth'
import { captureInviter } from '../../utils/invite'
// AuthMask 仍挂在页面上（游客浏览后，首页内若有入口触发 requireLogin 也能正常弹）
import AuthMask from '../../components/AuthMask.vue'
import { ref, computed } from 'vue'
import api from '../../services/api'
import { HOT_TRIPS } from '../../data/hotTrips'
import { cityPhoto } from '../../data/cityImages'
import { getPosition } from '../../utils/position'
import { setTab, setTabBarHidden } from '../../utils/tabbar'
import mapGreen from '../../assets/icons/map-green.png'
import pinGreen from '../../assets/icons/map-pin-green.png'
import calWhite from '../../assets/icons/calendar-white.png'
import routeGreen from '../../assets/icons/route-green.png'
import historyGreen from '../../assets/icons/history-green.png'
import toiletGreen from '../../assets/icons/toilet-green.png'
import hotelWarm from '../../assets/icons/hotel-warm.png'
import chargingAmber from '../../assets/icons/charging-amber.png'
import parkingBlue from '../../assets/icons/parking-blue.png'
// 热门景点推荐配图：本地城市实拍图（assets/home/city-*.jpg，与 hero 城市封面同源）
import cityBeijing from '../../assets/home/city-beijing.jpg'
import cityShanghai from '../../assets/home/city-shanghai.jpg'
import cityHangzhou from '../../assets/home/city-hangzhou.jpg'
import cityChengdu from '../../assets/home/city-chengdu.jpg'
import cityXian from '../../assets/home/city-xian.jpg'
import cityChongqing from '../../assets/home/city-chongqing.jpg'
import cityGuangzhou from '../../assets/home/city-guangzhou.jpg'
import cityNanjing from '../../assets/home/city-nanjing.jpg'
import cityJinan from '../../assets/home/city-jinan.jpg'

const ICO = {
  map: mapGreen, pin: pinGreen, calWhite,
  route: routeGreen, history: historyGreen
}

// ========== 周边设施四小钮（点哪个都进 nearby 页，页内一次查齐四类） ==========
const MINIS = [
  { name: '找厕所', icon: toiletGreen },
  { name: '民宿', icon: hotelWarm },
  { name: '充电桩', icon: chargingAmber },
  { name: '停车场', icon: parkingBlue }
]

// ========== 热门景点推荐（本地内容位：城市实拍图 + 代表景点；点击进该城已规划好的示例行程详情） ==========
// h 是卡片图高（rpx）：相邻卡高矮错开才像瀑布流（图片用 aspectFill 裁切，不依赖原图比例）
const HOT_SPOTS = [
  { tag: '#北京', title: '北京 3天经典路线', info: '故宫 · 长城 · 颐和园', city: '北京', img: cityBeijing, h: '340rpx' },
  { tag: '#上海', title: '上海 2天城市漫步', info: '外滩 · 武康路 · 豫园', city: '上海', img: cityShanghai, h: '420rpx' },
  { tag: '#杭州', title: '杭州 2天西湖线', info: '西湖 · 灵隐寺 · 龙井村', city: '杭州', img: cityHangzhou, h: '420rpx' },
  { tag: '#成都', title: '成都 3天慢生活', info: '宽窄巷子 · 熊猫基地 · 都江堰', city: '成都', img: cityChengdu, h: '340rpx' },
  { tag: '#西安', title: '西安 3天古都线', info: '兵马俑 · 城墙 · 回民街', city: '西安', img: cityXian, h: '340rpx' },
  { tag: '#重庆', title: '重庆 3天山城线', info: '洪崖洞 · 磁器口 · 长江索道', city: '重庆', img: cityChongqing, h: '420rpx' },
  { tag: '#广州', title: '广州 2天早茶线', info: '沙面 · 陈家祠 · 珠江夜游', city: '广州', img: cityGuangzhou, h: '420rpx' },
  { tag: '#南京', title: '南京 2天人文线', info: '中山陵 · 夫子庙 · 先锋书店', city: '南京', img: cityNanjing, h: '340rpx' },
  { tag: '#济南', title: '济南 2天泉城线', info: '趵突泉 · 大明湖 · 千佛山', city: '济南', img: cityJinan, h: '340rpx' }
]
// 双列瀑布流：奇偶拆列（模板里不允许内联 filter 箭头函数，先在 JS 切好）
const inspLeft = HOT_SPOTS.filter((_, i) => i % 2 === 0)
const inspRight = HOT_SPOTS.filter((_, i) => i % 2 === 1)

// ---------- 顶部城市行：优先真机定位反查城市；失败回退最近行程城市，再回退「杭州」 ----------
const cityName = ref('')
function loadCity() {
  getPosition(false).then(pos => {
    if (!pos || pos.isFallback) { cityFallback(); return }
    api.trips.reverseCity(pos.lat, pos.lng)
      .then(c => { cityName.value = c })
      .catch(() => cityFallback())
  }).catch(() => cityFallback())
}
function cityFallback() {
  if (cityName.value) return   // 已有定位城市：定位偶发失败不闪回兜底值
  cityName.value = (recent.value && recent.value.city) || '杭州'
}
// 城市行只是展示实时定位城市：不做城市切换、不跳示例行程（2026-10-08 用户明确要求，
// 旧版 pickCity 弹 ActionSheet 选热门城市→goCity 进写死攻略的入口已删）。

// ---------- 最近行程 ----------
const recent = ref(null)
const tripLoading = ref(true)

// 当天 0 点（本地时区）
// ⚠️ 不要写 new Date(new Date().toDateString())：toDateString() 得到 "Tue Oct 06 2026"
// 这种非 ISO 格式，iOS 的 Date 解析不了 → Invalid Date，倒计时/剩余天数全变 NaN，
// 微信开发者工具也会告警「new Date(...) 在部分 iOS 下无法正常使用」。用年月日构造最稳。
function today0() {
  const n = new Date()
  return new Date(n.getFullYear(), n.getMonth(), n.getDate())
}

// 出发日期差（天）：>0 未开始 / 0 今天出发 / <0 进行中；无日期字段则全部隐藏
const startDiff = computed(() => {
  const s = recent.value && recent.value.startDate
  if (!s) return null
  const start = new Date(`${s}T00:00:00`)
  if (isNaN(start)) return null
  return Math.ceil((start - today0()) / 86400000)
})
// 行程是否已结束：endDate 优先，否则 startDate + days 推结束日（与右侧倒计时同一口径，避免徽标/倒计时矛盾）
const tripEnded = computed(() => {
  const t = recent.value
  if (!t) return false
  const today = today0()
  const e = String(t.endDate || '')
  if (e) {
    const end = new Date(`${e}T00:00:00`)
    if (!isNaN(end)) return today > end
  }
  const s = String(t.startDate || '')
  if (!s) return false
  const parts = s.split('-').map(Number)
  if (parts.length < 3 || parts.some(isNaN)) return false
  const days = Number(t.days)
  const end = new Date(parts[0], parts[1] - 1, parts[2] + (days ? days - 1 : 0))
  return today > end
})
const statusChip = computed(() => {
  const d = startDiff.value
  if (d == null) return ''
  if (d > 0) return '未开始'
  if (d === 0) return '今天出发'
  return tripEnded.value ? '已结束' : '进行中'
})
const countdown = computed(() => {
  const d = startDiff.value
  const t = recent.value
  if (d == null) return null
  if (d > 0) return { label: '距离出发', num: `${d}天` }       // 未开始：距出发（设计稿文案）
  if (d === 0) return { label: '距离出发', num: '今天' }        // 今天出发
  // 进行中/已结束：有 days 时按行程结束日算剩余天数，否则退回「第 N 天」
  const days = Number(t && t.days)
  if (days && days >= 2 && t.startDate) {
    const p = String(t.startDate).split('-').map(Number)
    const end = new Date(p[0], p[1] - 1, p[2] + days - 1)
    const left = Math.ceil((end - today0()) / 86400000)
    if (left > 0) return { label: '剩余', num: `${left}天` }
    return { label: '行程', num: '已结束' }
  }
  if (tripEnded.value) return { label: '行程', num: '已结束' }
  return { label: '进行中', num: `第${-d + 1}天` }
})

// hero 日期行：短格式「11.24 - 11.28 · 4天3夜之旅」（设计稿样式，非列表页的长中文日期）
const heroDate = computed(() => {
  const t = recent.value
  if (!t || !t.startDate) return ''
  const parts = String(t.startDate).split('-').map(Number)
  if (parts.length < 3 || parts.some(isNaN)) return ''
  const [y, m, d] = parts
  const days = Number(t.days)
  if (!days || days < 2) return `${m}.${d} 出发`
  const end = new Date(y, m - 1, d + days - 1)
  return `${m}.${d} - ${end.getMonth() + 1}.${end.getDate()}`
})
const heroNights = computed(() => {
  const days = Number(recent.value && recent.value.days)
  return days >= 2 ? `${days}天${days - 1}夜之旅` : ''
})

function loadRecent() {
  tripLoading.value = true
  api.trips.list().then(list => {
    const arr = Array.isArray(list) ? list : []
    recent.value = arr[0] || null
  }).catch(() => {
    recent.value = null
  }).finally(() => {
    tripLoading.value = false
    cityFallback()   // 列表回来后再兜底一次：无定位时优先显示行程城市
  })
}

// 分享：首页是小程序的门面，转发/朋友圈都指回首页；封面用杭州（灵隐寺灵感图同城市）
useShare(() => ({
  title: '智慧文旅 · 一句话生成专属旅行攻略',
  path: '/pages/home/home',
  city: '杭州'
}), { timeline: true })

useDidShow(() => {
  // 页面级采集兜底（2026-10-06）：App 级启动参数万一没接住（热启动/时序），这里再接一次。
  // 当前页参数在 getCurrentInstance().router.params（对象），包成 {query} 喂给 parseInviter。
  try {
    const inst = Taro.getCurrentInstance && Taro.getCurrentInstance()
    if (inst && inst.router) captureInviter({ query: inst.router.params })
  } catch (e) {}
  // 游客浏览（2026-10-09 用户要求 + 微信审核整改）：
  // 微信审核明确「一进入就要求授权手机号/头像/昵称」不合规 —— 首页不再做任何登录拦截，
  // 未登录用户直接浏览（热门景点/示例行程都能看），只有「用功能」（生成攻略、AI 讲解、
  // 记账、加入协作等）时才在对应入口弹登录框（requireLogin，可暂不登录）。
  // 昵称头像的完善也移到「用户主动登录之后」，冷启动不再甩完善卡（见 login.vue 的跳过入口）。
  enterHome()
})

// 登录成功后的去向由 utils/auth.js 的 finishLogin 统一把关（2026-10-08 用户要求：
// 所有新登录都必须先完善资料）——资料不全时它不会执行本回调，而是跳登录页完善卡。

// 登录通过后（或本来已登录）才真正加载首页数据
function enterHome() {
  setTabBarHidden(false)
  setTab(0)
  loadRecent()
  loadCity()
}

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
  // 配了写死行程的热门城市：直接进详情页展示现成攻略（不走 AI 生成、不落库）
  const hot = HOT_TRIPS[name]
  if (hot) {
    Taro.setStorageSync('hotTripDetail', {
      id: 'hot-' + name, city: name, title: hot.title, days: hot.result.days.length,
      status: 'done', result: hot.result
    })
    safeNav('/pages/itinerary/itinerary?hot=1')
    return
  }
  safeNav(`/pages/index/index?city=${encodeURIComponent(name)}`)
}
function goDetail() {
  if (recent.value) safeNav(`/pages/itinerary/itinerary?tripId=${recent.value.id}`)
}
function goRoute() {
  // 路线规划要调 /api/route/optimize（需登录）→ 点的时候才拦（游客仍可浏览首页）
  requireLogin(() => safeNav('/pages/route/route'), { tip: '路线规划需要登录后使用' })
}
// 历史足迹 = 城市足迹页（footprint 页记录去过的城市/省份，比 tabBar 行程列表更贴「足迹」语义）
function goFootprint() {
  safeNav('/pages/footprint/footprint')
}
// 周边设施独立页：按当前定位查 1km 内最近的公厕/民宿/停车场/充电桩
function goNearby() {
  // 周边设施查询也要登录（/api/nearby/facilities 未登返回 401）→ 点的时候才拦
  requireLogin(() => safeNav('/pages/nearby/nearby'), { tip: '附近设施查询需要登录后使用' })
}
// 「探索更多」：热门景点列表页未排期，先给个轻提示（不挡主流程）
function moreInsp() {
  Taro.showToast({ title: '更多热门景点整理中', icon: 'none' })
}
// 热门景点卡 → 直接看已规划好的示例行程（goCity：写死攻略进详情页，不走 AI 生成、不落库）
// 九座城市在 data/hotTrips.js 里都有完整 2~3 天行程；万一某城缺数据，goCity 会自动退回
// 行程规划表单（index?city=）预填城市，不会点了没反应。
</script>

<style>
.wrap {
  min-height: 100vh;
  background: #F7F9F9;
  /* 底部留白须覆盖：tab栏(24+112rpx) + 凸起加号(56rpx) + 安全区 */
  padding: 24rpx 24rpx calc(240rpx + env(safe-area-inset-bottom));
  box-sizing: border-box;
}

.pill-hover { opacity: 0.7; }
.card-hover { opacity: 0.85; }

/* ---------- 顶部城市行（纯展示，无点击态） ---------- */
.city-row { display: flex; align-items: center; gap: 10rpx; padding: 8rpx 4rpx 0; }
.city-ico { width: 36rpx; height: 36rpx; }
.city-name { font-size: 32rpx; font-weight: 600; color: #2F3A33; }

/* ---------- 分区标题行 ---------- */
.sec-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin: 36rpx 4rpx 22rpx;
}
.sec-title { font-size: 32rpx; font-weight: 700; color: #2F3A33; }
.sec-link { font-size: 24rpx; color: #8A9490; }

/* ---------- 最近行程 hero 卡（圆角 60rpx，设计稿最大圆角层级） ---------- */
.trip-hero {
  position: relative;
  border-radius: 60rpx;
  overflow: hidden;
  margin-top: 24rpx;
  min-height: 300rpx;
  padding: 30rpx;
  box-sizing: border-box;
  display: flex;
  /* 渐变色卡片背景（2026-10-06 二改：清新绿，白字直接压在渐变上） */
  background: linear-gradient(135deg, #52B788, #2D6A4F);
}
.trip-hero-body { position: relative; z-index: 1; flex: 1; display: flex; flex-direction: column; }
.hero-top { display: flex; align-items: flex-start; justify-content: space-between; }
.hero-chip {
  font-size: 22rpx; color: #ffffff;
  background: rgba(255, 255, 255, 0.22);
  border: 1rpx solid rgba(255, 255, 255, 0.35);
  padding: 8rpx 22rpx; border-radius: 999rpx;
}
.hero-count { text-align: right; }
.hero-count-label { font-size: 22rpx; color: rgba(255, 255, 255, 0.85); }
.hero-count-num {
  font-size: 56rpx; font-weight: 700; color: #ffffff;
  line-height: 1.15;
  font-family: 'DIN Alternate', sans-serif;
}
.hero-title { margin-top: auto; font-size: 46rpx; font-weight: 700; color: #ffffff; }
.hero-date {
  display: flex; align-items: center; gap: 10rpx;
  margin-top: 16rpx;
  font-size: 26rpx; color: rgba(255, 255, 255, 0.92);
}
.hero-date-ico { width: 26rpx; height: 26rpx; }

.trip-empty {
  background: #ffffff;
  border-radius: 48rpx;
  padding: 60rpx 0;
  text-align: center;
  margin-top: 24rpx;
}
.trip-empty-ico { width: 72rpx; height: 72rpx; margin: 0 auto 16rpx; display: block; }
.trip-empty-txt { font-size: 26rpx; color: #868E96; }

/* ---------- 两枚功能卡（圆角 48rpx）：图标浅绿块 + 标题 + 副标题，全部左对齐 ---------- */
/* 渐变层次链（2026-10-08 用户要求三行卡片从上往下渐变）：hero 深绿 → 本行中浅绿 → mini 行近白 */
.feat-row { display: flex; gap: 24rpx; margin-top: 24rpx; }
.feat-card {
  flex: 1;
  background: linear-gradient(180deg, #CDEBDC 0%, #EAF7F0 100%); /* 比原版深半档，承接 hero 的绿 */
  border-radius: 48rpx;
  padding: 36rpx 34rpx;
  box-shadow: 0 6rpx 18rpx rgba(31, 45, 37, 0.05);
}
.feat-ico-wrap {
  width: 88rpx; height: 88rpx; border-radius: 28rpx;
  background: #ffffff; /* 卡片变绿后图标块反白，保住层次 */
  display: flex; align-items: center; justify-content: center;
}
.feat-ico { width: 44rpx; height: 44rpx; }
.feat-name { font-size: 32rpx; font-weight: 700; color: #2F3A33; margin-top: 22rpx; }
.feat-sub { font-size: 24rpx; color: #8A9490; margin-top: 6rpx; }

/* ---------- 周边设施四小钮：白方块只装图标，文字在卡片外 ---------- */
.mini-row { display: flex; gap: 20rpx; margin-top: 24rpx; }
.mini-item {
  flex: 1;
  display: flex; flex-direction: column; align-items: center; gap: 14rpx;
}
.mini-tile {
  width: 100%; height: 118rpx;
  background: linear-gradient(180deg, #EFF8F3 0%, #FFFFFF 100%); /* 渐变链最浅一档：承接功能卡收尾到白 */
  border-radius: 32rpx;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 4rpx 14rpx rgba(31, 45, 37, 0.04);
}
.mini-ico { width: 44rpx; height: 44rpx; }
.mini-name { font-size: 24rpx; color: #5B6B62; }

/* ---------- 热门景点推荐双列瀑布流（卡片圆角 40rpx；图片由卡片数据给高度，aspectFill 裁切 → 高矮错开） ---------- */
.insp-row { display: flex; gap: 24rpx; }
.insp-col { flex: 1; display: flex; flex-direction: column; gap: 24rpx; min-width: 0; }
.insp-card {
  background: #ffffff;
  border-radius: 40rpx;
  overflow: hidden;
  box-shadow: 0 6rpx 18rpx rgba(31, 45, 37, 0.05);
}
.insp-img-wrap { position: relative; }
.insp-img { width: 100%; display: block; }
.insp-tag {
  position: absolute; left: 16rpx; top: 16rpx;
  font-size: 20rpx; color: #ffffff;
  background: rgba(20, 30, 25, 0.35);
  padding: 6rpx 16rpx; border-radius: 999rpx;
}
.insp-title {
  font-size: 28rpx; font-weight: 600; color: #2F3A33; line-height: 1.5;
  padding: 18rpx 20rpx 0;
}
/* meta 行：景点组合（「看行程」行动点已删，整卡可点进示例行程详情） */
.insp-meta { display: flex; align-items: center; padding: 14rpx 20rpx 22rpx; }
.insp-info { font-size: 20rpx; color: #8A9490; }
</style>
