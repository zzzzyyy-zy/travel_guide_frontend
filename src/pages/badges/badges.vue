<template>
  <view class="wrap">
    <!-- 概览卡：已获得 N 种勋章 + 总进度 -->
    <view class="card hd-card">
      <view class="hd-main">
        <view class="hd-left">
          <text class="hd-num">{{ unlockedCount }}</text>
          <text class="hd-unit">种勋章</text>
        </view>
        <view class="hd-hex" :class="topTone">
          <image class="hd-ico" :src="topIco" mode="aspectFit" />
        </view>
      </view>
      <view class="hd-bar"><view class="hd-fill" :style="{ width: pct + '%' }"></view></view>
      <view class="hd-hint">已解锁 {{ unlockedCount }} / {{ badges.length }} 枚 · {{ pct }}%</view>
    </view>

    <!-- 页签：已解锁 / 全部 -->
    <view class="tabs">
      <view class="tab" :class="{ on: tab === 'unlocked' }" @tap="tab = 'unlocked'">已解锁勋章</view>
      <view class="tab" :class="{ on: tab === 'all' }" @tap="tab = 'all'">全部勋章</view>
    </view>

    <!-- 徽章墙：每个档位一枚（六边形 + Lv 角标 + 名称/条件/状态） -->
    <view class="grid" v-if="list.length">
      <view class="cell" v-for="b in list" :key="b.key" @tap="open(b)">
        <view class="hexwrap" :class="{ off: !b.unlocked }">
          <view class="hex" :class="b.tone"><image class="hex-ico" :src="b.ico" mode="aspectFit" /></view>
          <text class="lv">Lv{{ b.lv }}</text>
        </view>
        <view class="info">
          <text class="name">{{ b.title }}</text>
          <text class="desc">{{ b.desc }}</text>
          <text class="state" :class="{ done: b.unlocked }">{{ b.state }}</text>
        </view>
      </view>
    </view>

    <!-- 空态：区分「加载失败」与「后端确实没数据」 -->
    <view class="empty-error" v-if="!list.length && err" @tap="load">勋章数据加载失败，点此重试</view>
    <view class="empty" v-else-if="!list.length && !loading">还没有勋章数据（后端未返回成就系列）</view>
    <view class="empty" v-if="!list.length && loading">正在加载勋章…</view>

    <!-- 详情浮层：点任意一枚（后端无详情接口 → 用列表数据自渲染，不伪造） -->
    <view class="mask" v-if="detail" @tap="detail = null">
      <view class="pop" @tap.stop>
        <view class="hex hex-lg" :class="detail.tone"><image class="hex-ico-lg" :src="detail.ico" mode="aspectFit" /></view>
        <text class="pop-lv">Lv{{ detail.lv }}</text>
        <text class="pop-name">{{ detail.title }}</text>
        <text class="pop-desc">{{ detail.desc }}</text>
        <view class="pop-bar"><view class="pop-fill" :style="{ width: detail.pct + '%' }"></view></view>
        <text class="pop-state" :class="{ done: detail.unlocked }">
          {{ detail.unlocked ? '已达成 · 累计 ' + detail.count + ' 次' : '进度 ' + detail.progress + '/' + detail.count + ' 次 · ' + detail.state }}
        </text>
        <view class="pop-btn" @tap="detail = null">知道了</view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import Taro, { useLoad, usePullDownRefresh } from '@tarojs/taro'
import api from '../../services/api'
import { normAchvs, buildBadges } from '../../utils/badges'

const achvs = ref([])        // 归一化后的系列数组
const loading = ref(true)
const err = ref(false)
const tab = ref('unlocked')
const detail = ref(null)

const badges = computed(() => buildBadges(achvs.value))
const unlockedBadges = computed(() => badges.value.filter(b => b.unlocked))
const unlockedCount = computed(() => unlockedBadges.value.length)
const list = computed(() => (tab.value === 'unlocked' ? unlockedBadges.value : badges.value))
const pct = computed(() => (badges.value.length ? Math.round((unlockedCount.value / badges.value.length) * 100) : 0))
const topIco = computed(() => (unlockedBadges.value[0] || badges.value[0] || {}).ico || '')
const topTone = computed(() => (unlockedBadges.value[0] || badges.value[0] || {}).tone || 'gold')

function open(b) { detail.value = b }

function load() {
  loading.value = true
  // 写入即打日志：出现「有数据却显示 0」时靠这几行定位（结构 / 失败原因 / 写入条数）
  api.growth.achievements().then(raw => {
    console.log('[badges] 原始返回：', JSON.stringify(raw))
    achvs.value = normAchvs(raw)
    console.log('[badges] 归一化后系列数：', achvs.value.length, '徽章数：', buildBadges(achvs.value).length)
    err.value = false
    // 兜底：一枚都没解锁时自动切到「全部」，避免用户看到空白页以为坏了
    if (!unlockedBadges.value.length && badges.value.length) tab.value = 'all'
  }).catch(e => {
    console.warn('[badges] 请求失败：', e && (e.code || e.message))
    if (!achvs.value.length) err.value = true
  }).finally(() => { loading.value = false })
}

useLoad(() => load())
usePullDownRefresh(() => { load(); Taro.stopPullDownRefresh() })
</script>

<style>
/* 页面底色与卡片：与「我的」页同一套视觉 */
.wrap { min-height: 100vh; padding: 24rpx 24rpx 60rpx; background: #f7f7f5; box-sizing: border-box; }
.card { background: #ffffff; border-radius: 28rpx; padding: 28rpx; box-shadow: 0 6rpx 20rpx rgba(15, 30, 20, 0.04); }

/* 概览卡 */
.hd-main { display: flex; align-items: center; justify-content: space-between; }
.hd-left { display: flex; align-items: baseline; gap: 10rpx; }
.hd-num { font-size: 74rpx; font-weight: 800; color: #F2994A; line-height: 1; }
.hd-unit { font-size: 26rpx; color: #6B7370; }
.hd-hex {
  width: 96rpx; height: 108rpx; display: flex; align-items: center; justify-content: center;
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
}
.hd-hex.gold   { background: linear-gradient(160deg, #FFB65C, #F2794A); }
.hd-hex.green  { background: linear-gradient(160deg, #4ADE80, #16A34A); }
.hd-hex.blue   { background: linear-gradient(160deg, #60A5FA, #2563EB); }
.hd-hex.purple { background: linear-gradient(160deg, #C084FC, #7C3AED); }
.hd-hex.warm   { background: linear-gradient(160deg, #F2B279, #D97706); }
.hd-hex.pink   { background: linear-gradient(160deg, #F472B6, #DB2777); }
.hd-ico { width: 44rpx; height: 44rpx; }
.hd-bar { height: 14rpx; background: #EEF2F1; border-radius: 999rpx; margin-top: 24rpx; overflow: hidden; }
.hd-fill { height: 100%; background: linear-gradient(90deg, #F2B279, #F29979); border-radius: 999rpx; }
.hd-hint { margin-top: 12rpx; font-size: 22rpx; color: #9AA3A0; }

/* 页签 */
.tabs { display: flex; gap: 16rpx; padding: 26rpx 4rpx 18rpx; }
.tab { font-size: 26rpx; color: #6B7370; background: #ffffff; border-radius: 999rpx; padding: 12rpx 30rpx; }
.tab.on { color: #ffffff; background: linear-gradient(135deg, #F2994A, #F2794A); font-weight: 600; }

/* 徽章网格：双列 */
.grid { display: flex; flex-wrap: wrap; justify-content: space-between; }
.cell {
  width: 336rpx; padding: 24rpx; margin-bottom: 20rpx; box-sizing: border-box;
  display: flex; align-items: center; gap: 18rpx;
  background: #ffffff; border-radius: 24rpx; box-shadow: 0 6rpx 18rpx rgba(15, 30, 20, 0.04);
}
.cell:active { opacity: 0.9; }
.hexwrap { position: relative; width: 104rpx; height: 116rpx; flex-shrink: 0; }
.hexwrap.off { opacity: 0.55; }
.hex {
  width: 104rpx; height: 116rpx; display: flex; align-items: center; justify-content: center;
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
}
.hex.gold   { background: linear-gradient(160deg, #FFB65C, #F2794A); }
.hex.green  { background: linear-gradient(160deg, #4ADE80, #16A34A); }
.hex.blue   { background: linear-gradient(160deg, #60A5FA, #2563EB); }
.hex.purple { background: linear-gradient(160deg, #C084FC, #7C3AED); }
.hex.warm   { background: linear-gradient(160deg, #F2B279, #D97706); }
.hex.pink   { background: linear-gradient(160deg, #F472B6, #DB2777); }
.hex-ico { width: 52rpx; height: 52rpx; }
.lv {
  position: absolute; right: -6rpx; bottom: -6rpx;
  font-size: 20rpx; color: #ffffff; background: #2B312D;
  border-radius: 999rpx; padding: 2rpx 12rpx;
}
.info { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 6rpx; }
.name { font-size: 26rpx; font-weight: 600; color: #2B312D; }
.desc { font-size: 20rpx; color: #9AA3A0; }
.state { font-size: 20rpx; color: #9AA3A0; }
.state.done { color: #15803D; font-weight: 600; }

/* 空态 */
.empty { text-align: center; color: #9AA3A0; font-size: 24rpx; padding: 60rpx 0; }
.empty-error { text-align: center; color: #15803D; font-size: 26rpx; padding: 60rpx 0; }

/* 详情浮层（z-index 100：高于自定义 tabBar 与页面内容） */
.mask {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0; z-index: 100;
  background: rgba(15, 30, 20, 0.45);
  display: flex; align-items: center; justify-content: center;
}
.pop {
  width: 560rpx; background: #ffffff; border-radius: 32rpx; padding: 44rpx 36rpx 36rpx;
  display: flex; flex-direction: column; align-items: center;
}
.hex-lg {
  width: 176rpx; height: 196rpx;
  display: flex; align-items: center; justify-content: center;
  clip-path: polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%);
}
.hex-lg .hex-ico { width: 88rpx; height: 88rpx; }
.hex-ico-lg { width: 88rpx; height: 88rpx; }
.pop-lv {
  margin-top: 20rpx; font-size: 22rpx; color: #ffffff; background: #2B312D;
  border-radius: 999rpx; padding: 4rpx 18rpx;
}
.pop-name { margin-top: 16rpx; font-size: 34rpx; font-weight: 700; color: #2B312D; }
.pop-desc { margin-top: 10rpx; font-size: 24rpx; color: #9AA3A0; }
.pop-bar { width: 100%; height: 12rpx; background: #EEF2F1; border-radius: 999rpx; margin-top: 26rpx; overflow: hidden; }
.pop-fill { height: 100%; background: linear-gradient(90deg, #F2B279, #F29979); border-radius: 999rpx; }
.pop-state { margin-top: 14rpx; font-size: 24rpx; color: #9AA3A0; }
.pop-state.done { color: #15803D; font-weight: 600; }
.pop-btn {
  margin-top: 32rpx; width: 100%; height: 84rpx; line-height: 84rpx; text-align: center;
  color: #ffffff; font-size: 28rpx; font-weight: 600; border-radius: 999rpx;
  background: linear-gradient(135deg, #22C55E, #16A34A);
}
.pop-btn:active { opacity: 0.85; }
</style>
