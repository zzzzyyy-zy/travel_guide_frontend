<template>
  <view class="sh-page">
    <!-- 加载中 -->
    <view v-if="phase === 'loading'" class="sh-center">
      <view class="sh-icon">⏳</view>
      <view class="sh-title">正在加载分享的攻略…</view>
    </view>

    <!-- 失效 / 不存在 -->
    <view v-else-if="phase === 'invalid'" class="sh-center">
      <view class="sh-icon">🔗</view>
      <view class="sh-title">分享已失效</view>
      <view class="sh-note">这条分享可能已被作者撤销，或链接不正确</view>
    </view>

    <!-- 只读攻略（结构：接口文档 7.2 result） -->
    <view v-else-if="detail">
      <view class="sh-card">
        <view class="sh-badge">好友分享</view>
        <view class="sh-title">{{ detail.city }} · {{ detail.days }} 天攻略</view>
        <view class="sh-sub" v-if="detail.result && detail.result.overview">{{ detail.result.overview }}</view>
        <view class="sh-budget" v-if="detail.result && typeof detail.result.estimatedTotalCost === 'number'">
          预估 ¥{{ detail.result.estimatedTotalCost }}
        </view>
      </view>

      <view class="sh-card" v-for="(d, di) in days" :key="di">
        <!-- 文档字段是 days[].day，缺省时兜底下标+1，与行程详情页口径一致 -->
        <view class="sh-day">第 {{ d.day || di + 1 }} 天 · {{ d.title }}</view>
        <view class="sh-item" v-for="(s, si) in d.spots || []" :key="'s' + si">
          <view class="sh-item-head">
            <text class="sh-time">{{ s.duration || '景点' }}</text>
            <text class="sh-name">{{ s.name }}</text>
          </view>
          <text class="sh-reason" v-if="s.reason">{{ s.reason }}</text>
          <text class="sh-reason" v-if="s.tip">避坑：{{ s.tip }}</text>
        </view>
        <view class="sh-item" v-for="(f, fi) in d.food || []" :key="'f' + fi">
          <view class="sh-item-head">
            <text class="sh-time">美食</text>
            <text class="sh-name">{{ f.name }}</text>
          </view>
          <text class="sh-reason" v-if="f.reason">{{ f.reason }}</text>
        </view>
        <view class="sh-note" v-if="d.note">💡 {{ d.note }}</view>
      </view>

      <view class="sh-card" v-if="detail.result && detail.result.tips && detail.result.tips.length">
        <view class="sh-day">注意事项</view>
        <view class="sh-reason" v-for="(t, i) in detail.result.tips" :key="i">· {{ t }}</view>
      </view>

      <view class="sh-foot">「小沃伴途」AI 一句话生成旅行攻略</view>
    </view>
  </view>
</template>

<script setup>
// 公开只读页：凭分享 token 查看（GET /api/trip/public/{token}，无需登录）
// 数据只有 { id, city, days, result }，无预算对比等用户态内容
import { ref, computed } from 'vue'
import Taro, { useLoad } from '@tarojs/taro'
import api from '../../services/api'

const phase = ref('loading') // loading | invalid | done
const detail = ref(null)
const days = computed(() => (detail.value && detail.value.result && detail.value.result.days) || [])

useLoad(options => {
  const token = (options && options.token) || ''
  if (!token) {
    phase.value = 'invalid'
    return
  }
  api.trips.publicDetail(token).then(d => {
    // result 可能为空（作者还没生成完）
    if (!d || !d.result || !Array.isArray(d.result.days)) {
      phase.value = 'invalid'
      return
    }
    detail.value = d
    phase.value = 'done'
  }).catch(() => {
    // 404 分享不存在或已撤销
    phase.value = 'invalid'
  })
})
</script>

<style>
.sh-page { min-height: 100vh; background: #f7f9f9; padding: 24rpx; box-sizing: border-box; }
.sh-center { text-align: center; padding-top: 240rpx; }
.sh-icon { font-size: 80rpx; }
.sh-title { font-size: 34rpx; font-weight: 700; color: #333333; margin-top: 24rpx; }
.sh-note { font-size: 26rpx; color: #868E96; margin-top: 16rpx; }
.sh-card { background: #fff; border-radius: 20rpx; padding: 32rpx; margin-bottom: 24rpx; }
.sh-badge {
  display: inline-block; font-size: 22rpx; color: #2E6E63;
  background: #E4F1EF; border-radius: 999rpx; padding: 6rpx 20rpx; margin-bottom: 16rpx;
}
.sh-day { font-size: 30rpx; font-weight: 700; color: #333333; margin-bottom: 20rpx; }
.sh-sub { font-size: 26rpx; color: #868E96; margin-top: 12rpx; line-height: 1.6; }
.sh-budget { font-size: 30rpx; font-weight: 700; color: #2E6E63; margin-top: 20rpx; }
.sh-item { padding: 16rpx 0; border-bottom: 1rpx solid #E8E8E8; }
.sh-item:last-child { border-bottom: none; }
.sh-item-head { display: flex; gap: 16rpx; }
.sh-time { font-size: 24rpx; color: #868E96; flex-shrink: 0; }
.sh-name { font-size: 28rpx; color: #333333; font-weight: 600; }
.sh-reason { display: block; font-size: 24rpx; color: #868E96; margin-top: 8rpx; line-height: 1.5; }
.sh-foot { text-align: center; font-size: 22rpx; color: #ADB5BD; padding: 24rpx 0 48rpx; }
</style>
