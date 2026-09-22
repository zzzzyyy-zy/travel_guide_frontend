<template>
  <view class="wrap">
    <!-- ========== 加载中：骨架屏（调研结论：加载态是设计的一部分） ========== -->
    <view v-if="phase === 'loading'">
      <view class="sk-hero">
        <view class="sk-line light" style="width: 30%"></view>
        <view class="sk-line light" style="width: 55%"></view>
      </view>
      <view class="sk-card" v-for="i in 3" :key="i">
        <view class="sk-line" style="width: 35%"></view>
        <view class="sk-line strong" style="width: 60%"></view>
        <view class="sk-line" style="width: 90%"></view>
        <view class="sk-line" style="width: 45%; margin-bottom: 0"></view>
      </view>
      <view class="note sk-tip" v-if="loadingTip">{{ loadingTip }}</view>
    </view>

    <!-- 失败态 -->
    <view v-if="phase === 'failed'">
      <view class="card center-card">
        <view class="big-icon">😵</view>
        <view class="title">加载失败</view>
        <view class="note">{{ errorMsg }}</view>
        <view class="btn" @tap="reload" :class="{ disabled: submitting }">
          {{ submitting ? '加载中…' : '重新加载' }}
        </view>
        <view class="btn ghost" @tap="goHome">返回重新规划</view>
      </view>
    </view>

    <!-- ========== 阶段二：结果展示（结构：接口文档 7.2 result） ========== -->
    <view v-if="phase === 'done' && detail">
      <!-- 行程头卡：目的地 + 元信息 chips + 预估（调研：总览页先给日期/城市/规模，扫一眼即懂） -->
      <view class="hero">
        <view class="share-entry" @tap="openShare">🔗 分享</view>
        <view class="hero-city">{{ detail.city }}</view>
        <view class="hero-chips">
          <text class="chip" v-if="startDateLabel">{{ startDateLabel }}</text>
          <text class="chip">{{ detail.days }} 天</text>
          <text class="chip" v-if="detail.peopleCount">{{ detail.peopleCount }} 人</text>
          <text class="chip" v-for="t in transportLabels" :key="t">{{ t }}</text>
        </view>
        <view class="hero-estimate" v-if="budgetInfo.total != null">
          预估 ¥{{ budgetInfo.total }}
          <text class="budget-tag" v-if="budgetInfo.status !== 'unknown'" :class="budgetInfo.status">
            {{ { within: '预算内', over: '已超支' }[budgetInfo.status] }}
          </text>
        </view>
        <view class="hero-overview" v-if="detail.result.overview">{{ detail.result.overview }}</view>
        <view class="hero-diff" v-if="budgetInfo.input != null">
          较你的预算{{ budgetInfo.diff >= 0 ? '少' : '多' }} ¥{{ Math.abs(budgetInfo.diff) }} · 费用为 AI 估算，不含往返大交通
        </view>
      </view>

      <!-- 日子切换：胶囊按钮 -->
      <view class="day-tabs">
        <!-- 文档字段是 days[].day，缺省时兜底下标+1；key 用下标防重复 -->
        <view class="day-pill" v-for="(d, idx) in detail.result.days" :key="idx"
          :class="{ active: activeDay === idx }" @tap="switchDay(idx)">
          第{{ d.day || idx + 1 }}天
        </view>
      </view>

      <!-- 地图：卡片化圆角，marker = 有坐标的景点，polyline = 按当天顺序连线 -->
      <view class="map-card">
        <map class="map" :latitude="mapCenter.latitude" :longitude="mapCenter.longitude"
          :markers="markers" :polyline="polylines" scale="12" :show-location="false" />
      </view>
      <view class="note warn-note" v-if="dayHasMissingCoord">部分景点缺少坐标，地图仅展示已定位的点位</view>

      <!-- 当天标题行：主题 + 天级费用（扫读锚点） -->
      <view class="day-head" v-if="currentDay">
        <view class="day-head-l">
          <text class="day-head-title">{{ currentDay.title || '当日行程' }}</text>
          <text class="day-theme" v-if="currentDay.theme">{{ currentDay.theme }}</text>
        </view>
        <text class="day-cost" v-if="currentDay.estimatedCostCny != null">预估 ¥{{ currentDay.estimatedCostCny }}</text>
      </view>

      <!-- 时间线：spots + food 合并成一条流；圆点序号与地图 marker 一致（列表↔地图联动） -->
      <view class="timeline" v-if="currentDay">
        <view class="tl-item" v-for="(item, i) in currentItems" :key="i">
          <view class="tl-dot" :class="{ 'is-food': item.kind === 'food' }">{{ item.no || '食' }}</view>
          <view class="tl-card" :class="{ 'is-food': item.kind === 'food' }">
            <view class="tl-time">
              <text class="tl-ico">🗓</text>
              <text>{{ item.duration || (item.kind === 'food' ? '用餐时间' : '游玩时间') }}</text>
              <text class="tl-badge" v-if="item.kind === 'food'">美食</text>
            </view>
            <view class="tl-name">{{ item.icon }} {{ item.name }}</view>
            <view class="tl-reason" v-if="item.reason">{{ item.reason }}</view>
            <view class="tl-cost" v-if="item.estimatedCostCny != null">
              <text class="tl-ico">💰</text>
              <text>预估 ¥{{ item.estimatedCostCny }}</text>
            </view>
            <view class="tl-transport" v-if="item.transport">
              <text class="tl-ico">🚌</text>
              <text>{{ item.transport }}</text>
            </view>
            <view class="tl-tip" v-if="item.tip">避坑：{{ item.tip }}</view>
          </view>
        </view>
      </view>
      <view class="card day-note" v-if="currentDay && currentDay.note">💡 {{ currentDay.note }}</view>

      <!-- 整体提示（文档 7.2 已无 warnings 字段；信息来源按需求移除） -->
      <view class="card tips-card" v-if="detail.result.tips && detail.result.tips.length">
        <view class="tips-head">⚠️ 注意事项</view>
        <view class="tips-item" v-for="(t, i) in detail.result.tips" :key="i">{{ t }}</view>
      </view>
    </view>

    <!-- 分享弹层：小程序码 + 分享口令 + 撤销 -->
    <view class="share-mask" v-if="shareVisible" @tap="shareVisible = false">
      <view class="share-pop" @tap.stop>
        <view class="share-title">分享这份攻略</view>
        <image v-if="shareQr" class="share-qr" :src="shareQr" mode="widthFix" />
        <view v-else class="share-qr-empty">{{ shareLoading ? '生成中…' : '二维码暂不可用' }}</view>
        <view class="share-note" v-if="shareNote">{{ shareNote }}</view>
        <view class="share-token" v-if="shareToken">分享口令 {{ shareToken }}</view>
        <view class="share-btn" v-if="shareQrFile" @tap="saveQr">保存小程序码</view>
        <view class="share-btn" v-if="shareToken" @tap="copyToken">复制口令</view>
        <view class="share-btn ghost" v-if="shareToken" @tap="revokeShare">撤销分享</view>
        <view class="share-btn ghost" @tap="shareVisible = false">关闭</view>
        <view class="share-tip">好友扫码或通过转发进入，可只读查看完整攻略，无需登录</view>
      </view>
    </view>

    <AuthMask />
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import Taro, { useLoad, useShareAppMessage } from '@tarojs/taro'
import api from '../../services/api'
import { base64ToTempFile, saveImageToAlbum } from '../../utils/file'
import AuthMask from '../../components/AuthMask.vue'

const tripId = ref('')
const phase = ref('loading') // loading | done | failed
const submitting = ref(false)
const errorMsg = ref('')

const detail = ref(null)
const activeDay = ref(0)
const markers = ref([])
const polylines = ref([])
const mapCenter = ref({ latitude: 30.25, longitude: 120.15 })

const currentDay = computed(() => {
  const days = (detail.value && detail.value.result && detail.value.result.days) || []
  return days[activeDay.value] || days[0] || null
})
// 文档 7.2：景点在 days[].spots，美食单独在 days[].food
// 时间线把两类合并成一条流：景点编序号（与地图 marker 序号一致，列表↔地图联动），美食不编号
const currentItems = computed(() => {
  const d = currentDay.value
  if (!d) return []
  let no = 0
  const spots = (d.spots || []).map(s => { no += 1; return Object.assign({ kind: 'spot', icon: '🏛️', no }, s) })
  const food = (d.food || []).map(f => Object.assign({ kind: 'food', icon: '🍜' }, f))
  return spots.concat(food)
})

// ---------- 行程元信息 chips（详情体里有但旧 UI 没用上的字段） ----------
// 交通枚举 → 中文（文档 7.2 请求体枚举表）
const TRANSPORT_TEXT = { walking: '🚶 步行', transit: '🚇 公交地铁', taxi: '🚕 打车', driving: '🚗 自驾', cycling: '🚲 骑行' }
const transportLabels = computed(() => {
  const raw = (detail.value && detail.value.transportation) || ''
  return raw.split(',').map(s => s.trim()).filter(Boolean).map(s => TRANSPORT_TEXT[s] || s)
})
// 出发日期展示为「MM-DD 出发」（完整年份在 chips 里太占位）
const startDateLabel = computed(() => {
  const s = (detail.value && detail.value.startDate) || ''
  const m = s.match(/^\d{4}-(\d{2}-\d{2})$/)
  return m ? `${m[1]} 出发` : ''
})

// 文档 7.2 无 budgetSummary：总费用取 result.estimatedTotalCost（全队合计），
// 预算对比在前端算 —— detail.budget 是自由文本，解析出数字才参与比较
const budgetInfo = computed(() => {
  const r = detail.value && detail.value.result
  const total = r && typeof r.estimatedTotalCost === 'number' ? r.estimatedTotalCost : null
  const input = detail.value && detail.value.budget ? parseFloat(detail.value.budget) : NaN
  if (total == null) return { total: null, status: 'unknown', input: null, diff: null }
  if (!isFinite(input) || input <= 0) return { total, status: 'unknown', input: null, diff: null }
  return { total, input, diff: input - total, status: total <= input ? 'within' : 'over' }
})

const dayHasMissingCoord = computed(() =>
  currentDay.value && (currentDay.value.spots || []).some(s => !(typeof s.lat === 'number' && typeof s.lng === 'number'))
)

// ---------- 分享（后端文档 2026-09-20）：qrcode / share 开启撤销 / public 公开访问 ----------
const shareVisible = ref(false)
const shareLoading = ref(false)
const shareQr = ref('')      // 展示用：临时文件路径（转文件失败时兜底 data URL）
const shareQrFile = ref('')  // 保存到相册用：必须是文件路径
const shareToken = ref('')
const shareNote = ref('')

function openShare() {
  shareVisible.value = true
  if (shareToken.value || shareLoading.value) return   // 已开启过，直接展示
  shareLoading.value = true
  api.trips.qrcode(tripId.value).then(d => {
    shareToken.value = d.token || ''
    // 纪要 9.3：base64 图片转临时文件再用（保存到相册只认文件路径）
    return base64ToTempFile(d.image, 'png').then(p => {
      shareQrFile.value = p
      shareQr.value = p
    }).catch(() => {
      shareQr.value = 'data:image/png;base64,' + d.image   // 转文件失败兜底：仍能显示
    })
  }).then(() => {
    shareLoading.value = false
  }).catch(e => {
    // 502 = 小程序码生成失败（常见：小程序未发布版本）→ 降级：仅开启分享 token，可转发给好友
    const degraded = e.code === 502
    api.trips.shareOn(tripId.value).then(d => {
      shareToken.value = d.token || ''
      if (degraded) shareNote.value = '小程序未发布，暂无法生成小程序码，可把攻略直接转发给好友'
    }).catch(e2 => {
      shareNote.value = e2.message || '分享开启失败，请稍后重试'
    }).finally(() => { shareLoading.value = false })
  })
}

function saveQr() {
  if (!shareQrFile.value) return
  saveImageToAlbum(shareQrFile.value).then(() => {
    Taro.showToast({ title: '已保存到相册', icon: 'success' })
  }).catch(() => {})
}

function copyToken() {
  if (!shareToken.value) return
  Taro.setClipboardData({ data: shareToken.value })
}

function revokeShare() {
  Taro.showModal({ title: '撤销分享', content: '撤销后原二维码和口令立即失效，确定撤销吗？' }).then(r => {
    if (!r.confirm) return
    api.trips.shareOff(tripId.value).then(() => {
      shareToken.value = ''
      shareQr.value = ''
      shareNote.value = ''
      shareVisible.value = false
      Taro.showToast({ title: '已撤销', icon: 'success' })
    }).catch(e => Taro.showToast({ title: e.message || '撤销失败', icon: 'none' }))
  })
}

// 右上角菜单转发 / 聊天转发：带 token 进公开只读页
useShareAppMessage(() => ({
  title: detail.value && detail.value.city ? `${detail.value.city}旅行攻略，分享给你` : '我的旅行攻略',
  path: shareToken.value ? `/pages/share/share?token=${shareToken.value}` : '/pages/home/home'
}))

useLoad(options => {
  tripId.value = (options && options.tripId) || Taro.getStorageSync('currentTripId') || ''
  if (!tripId.value) {
    Taro.showToast({ title: '缺少行程，先去规划', icon: 'none' })
    return
  }
  loadDetail()
})

// ---------- 详情：GET /api/trip/{id} ----------
// 已知竞态：流式 done 事件可能先于后端把 result 落库（生成刚结束就查详情），
// 也可能 result 是 TEXT 字段直出的 JSON 字符串 → 都在这里兜住，别直接判失败
const RESULT_RETRY_MAX = 5        // 无结果时最多重试 5 次（2s 间隔 ≈ 10s 窗口）
let resultRetry = 0
const loadingTip = ref('')

function loadDetail(isRetry) {
  phase.value = 'loading'
  if (!isRetry) { resultRetry = 0; loadingTip.value = '' }
  api.trips.detail(tripId.value).then(d => {
    // 排查用：把原始返回打到控制台（真机 vConsole 可见），result 结构对不对一眼看出
    try { console.warn('[itinerary] detail 返回', JSON.stringify(d).slice(0, 600)) } catch (e) {}
    // 后端 result 列是 TEXT 时会直出 JSON 字符串，补一层解析
    if (d && typeof d.result === 'string') {
      try { d.result = JSON.parse(d.result) } catch (e) { /* 不是 JSON 就保持原样走失败态 */ }
    }
    detail.value = d
    // result 可空（生成中/生成失败/落库延迟），先重试再判失败
    if (!d || !d.result || !Array.isArray(d.result.days) || !d.result.days.length) {
      if (resultRetry < RESULT_RETRY_MAX) {
        resultRetry += 1
        loadingTip.value = `生成结果还在写入，第 ${resultRetry}/${RESULT_RETRY_MAX} 次重试…`
        setTimeout(() => loadDetail(true), 2000)
        return
      }
      phase.value = 'failed'
      errorMsg.value = '这份行程还没有生成结果'
      return
    }
    loadingTip.value = ''
    phase.value = 'done'
    renderDay(0)
  }).catch(e => {
    phase.value = 'failed'
    errorMsg.value = e.message || '读取结果失败'
  })
}

function reload() {
  if (submitting.value) return
  submitting.value = true
  loadDetail()
  submitting.value = false
}

function renderDay(idx) {
  activeDay.value = idx
  const days = (detail.value && detail.value.result && detail.value.result.days) || []
  const day = days[idx]
  if (!day) return
  // 新结构无 routeSegments：marker 取有坐标的景点，polyline 按当天顺序直线连点
  const located = (day.spots || []).filter(s => typeof s.lat === 'number' && typeof s.lng === 'number')
  markers.value = located.map((s, i) => ({
    id: i,
    latitude: s.lat,
    longitude: s.lng,
    width: 26, height: 26,
    callout: { content: `${i + 1} ${s.name}`, padding: 6, borderRadius: 6, display: 'ALWAYS' }
  }))
  polylines.value = located.length >= 2
    ? [{
        points: located.map(s => ({ latitude: s.lat, longitude: s.lng })),
        color: '#48A999', width: 4, arrowLine: true
      }]
    : []
  if (markers.value.length) {
    mapCenter.value = { latitude: markers.value[0].latitude, longitude: markers.value[0].longitude }
  }
}

function switchDay(idx) { renderDay(Number(idx)) }

function goHome() {
  // 表单页已移出 tabBar，改用 navigateTo（tab 页才需要 switchTab）
  Taro.navigateTo({ url: '/pages/index/index' })
}
</script>

<style>
/* ========== 配色规范（2026-09-22 定稿）：主色浅湖绿 #48A999 · 暖浅橙 #F29979 · 卡片 #FFF · 底 #F7F9F9 · 正文 #333 · 次要 #868E96 ========== */
.wrap { background: #F7F9F9; min-height: 100vh; }
.center-card { text-align: center; padding: 60rpx 40rpx; }
.big-icon { font-size: 88rpx; margin-bottom: 16rpx; }
.btn.ghost { background: #fff; color: #48A999; border: 1rpx solid #48A999; }
.warn-note { color: #F29979; }

/* ---------- 日子胶囊切换 ---------- */
.day-tabs { display: flex; gap: 20rpx; margin-bottom: 24rpx; }
.day-pill {
  padding: 12rpx 40rpx; border-radius: 999rpx;
  font-size: 26rpx; color: #868E96;
  background: #fff; border: 1rpx solid #E8E8E8;
}
.day-pill.active {
  background: #48A999; color: #fff;
  border-color: #48A999; font-weight: 600;
}

/* ---------- 行程头卡（渐变 hero：目的地 + 元信息 + 预算） ---------- */
.hero {
  position: relative;
  background: linear-gradient(135deg, #48A999 0%, #3A8A7C 78%, #2E6E63 100%);
  border-radius: 24rpx;
  padding: 36rpx 32rpx;
  color: #fff;
  overflow: hidden;
}
.hero-city { font-size: 44rpx; font-weight: 700; letter-spacing: 2rpx; padding-right: 130rpx; }
.hero-chips { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 18rpx; padding-right: 110rpx; }
.chip {
  font-size: 22rpx; color: #eafff6;
  background: rgba(255, 255, 255, 0.16);
  border-radius: 999rpx; padding: 6rpx 20rpx;
}
.hero-estimate { display: flex; align-items: center; gap: 14rpx; margin-top: 22rpx; font-size: 38rpx; font-weight: 700; }
.hero-overview { font-size: 26rpx; line-height: 1.7; color: rgba(255, 255, 255, 0.88); margin-top: 18rpx; }
.hero-diff { font-size: 22rpx; color: rgba(255, 255, 255, 0.66); margin-top: 10rpx; }
.budget-tag { font-size: 22rpx; font-weight: 400; padding: 4rpx 16rpx; border-radius: 20rpx; }
.budget-tag.within { background: #ffffff; color: #2E6E63; }
.budget-tag.over { background: #ffffff; color: #F29979; }

/* ---------- 地图卡片化 ---------- */
.map-card { border-radius: 20rpx; overflow: hidden; margin-bottom: 16rpx; }
.map-card .map { width: 100%; height: 380rpx; display: block; }

/* ---------- 当天标题行 ---------- */
.day-head { display: flex; align-items: center; gap: 16rpx; margin: 8rpx 0 20rpx; }
.day-head-l { flex: 1; display: flex; align-items: center; gap: 12rpx; min-width: 0; }
.day-head-title { font-size: 30rpx; font-weight: 600; color: #333333; }
.day-theme {
  font-size: 20rpx; color: #2E6E63;
  background: #E4F1EF; border-radius: 8rpx; padding: 4rpx 14rpx;
}
.day-cost { font-size: 26rpx; font-weight: 600; color: #48A999; }

/* ---------- 骨架屏 ---------- */
.sk-hero {
  background: linear-gradient(135deg, #48A999 0%, #3A8A7C 100%);
  border-radius: 24rpx; padding: 36rpx 32rpx; margin-bottom: 24rpx;
}
.sk-card { background: #fff; border-radius: 20rpx; padding: 28rpx; margin-bottom: 24rpx; }
.sk-line {
  height: 26rpx; border-radius: 8rpx; margin-bottom: 18rpx;
  background: linear-gradient(90deg, #eef1f0 25%, #f8fbfa 45%, #eef1f0 65%);
  background-size: 200% 100%;
  animation: sk-shine 1.2s infinite;
}
.sk-line.strong { height: 32rpx; }
.sk-line.light { background: rgba(255, 255, 255, 0.25); background-size: 200% 100%; }
.sk-tip { text-align: center; }
@keyframes sk-shine {
  0% { background-position: 200% 0; }
  100% { background-position: -200% 0; }
}

/* ---------- 时间线（左侧竖线 + 圆点 + 卡片） ---------- */
.timeline { position: relative; padding-left: 36rpx; margin-bottom: 8rpx; }
/* 竖线贯穿整个时间轴 */
.timeline::before {
  content: ''; position: absolute; left: 8rpx; top: 16rpx; bottom: 16rpx;
  width: 4rpx; border-radius: 2rpx; background: #C9E4E0;
}
.tl-item { position: relative; margin-bottom: 24rpx; }
/* 轴点：数字圆点，与地图 marker 序号一致；美食项用暖色「食」 */
.tl-dot {
  position: absolute; left: -44rpx; top: 24rpx;
  width: 36rpx; height: 36rpx; border-radius: 50%;
  background: #48A999; border: 4rpx solid #DDF0ED;
  color: #fff; font-size: 20rpx; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  box-sizing: border-box;
}
.tl-dot.is-food { background: #F29979; }
.tl-card {
  background: #fff; border-radius: 20rpx; padding: 28rpx;
}
/* 美食卡：暖色浅底 + 左侧暖色描边，与景点区分（调研：不同类型的卡片要有差异化） */
.tl-card.is-food { background: #FEF6F2; border-left: 6rpx solid #F29979; }
.tl-time { display: flex; align-items: center; gap: 10rpx; font-size: 28rpx; font-weight: 600; color: #333333; }
.tl-ico { font-size: 26rpx; }
.tl-badge {
  font-size: 20rpx; font-weight: 400; color: #F29979;
  background: #FEF6F2; border-radius: 8rpx; padding: 2rpx 12rpx;
}
.tl-name { font-size: 30rpx; font-weight: 600; color: #333333; margin-top: 14rpx; }
.tl-reason { font-size: 26rpx; color: #868E96; line-height: 1.7; margin-top: 10rpx; }
.tl-cost { display: flex; align-items: center; gap: 10rpx; font-size: 26rpx; color: #333333; margin-top: 12rpx; }
.tl-transport { display: flex; align-items: center; gap: 10rpx; font-size: 24rpx; color: #48A999; margin-top: 10rpx; }
/* 避坑提示：暖浅橙重点文字（规范：次要强调色用于提示） */
.tl-tip {
  margin-top: 14rpx; font-size: 24rpx; color: #F29979; line-height: 1.6;
  background: #FEF6F2; border-radius: 10rpx; padding: 12rpx 16rpx;
}

/* ---------- 当天备注 / 注意事项 ---------- */
.day-note { font-size: 26rpx; color: #868E96; line-height: 1.7; }
.tips-card .tips-head { font-size: 30rpx; font-weight: 600; color: #F29979; margin-bottom: 14rpx; }
.tips-item {
  position: relative; padding-left: 28rpx;
  font-size: 26rpx; color: #868E96; line-height: 1.7; margin-bottom: 10rpx;
}
.tips-item::before {
  content: ''; position: absolute; left: 6rpx; top: 18rpx;
  width: 8rpx; height: 8rpx; border-radius: 50%; background: #F29979;
}

/* ---------- 分享 ---------- */
/* 分享徽标挂在渐变 hero 上 → 白色描边样式 */
.share-entry {
  position: absolute; top: 24rpx; right: 24rpx;
  font-size: 24rpx; color: #fff;
  padding: 8rpx 20rpx; border: 1rpx solid rgba(255, 255, 255, 0.6); border-radius: 999rpx;
  background: rgba(255, 255, 255, 0.12);
}
.share-mask {
  position: fixed; inset: 0; z-index: 99;
  background: rgba(0, 0, 0, 0.5);
  display: flex; align-items: center; justify-content: center;
}
.share-pop {
  width: 580rpx; box-sizing: border-box;
  background: #fff; border-radius: 24rpx; padding: 40rpx 36rpx;
  display: flex; flex-direction: column; align-items: center;
}
.share-title { font-size: 32rpx; font-weight: 700; color: #333333; margin-bottom: 24rpx; }
.share-qr { width: 360rpx; height: 360rpx; border-radius: 12rpx; }
.share-qr-empty {
  width: 360rpx; height: 360rpx; border-radius: 12rpx;
  background: #F7F9F9; color: #868E96; font-size: 26rpx;
  display: flex; align-items: center; justify-content: center;
}
.share-note { font-size: 24rpx; color: #F29979; margin: 16rpx 0 0; text-align: center; }
.share-token { font-size: 26rpx; color: #333333; margin: 20rpx 0 4rpx; letter-spacing: 2rpx; }
.share-btn {
  width: 100%; margin-top: 20rpx; text-align: center; padding: 18rpx 0;
  background: #48A999; color: #fff; border-radius: 16rpx; font-size: 28rpx;
}
.share-btn.ghost { background: #fff; color: #868E96; border: 1rpx solid #E8E8E8; }
.share-tip { font-size: 22rpx; color: #868E96; margin-top: 20rpx; text-align: center; }
</style>
