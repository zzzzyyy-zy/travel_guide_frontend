<template>
  <!-- 内联样式版：微信对 custom-tab-bar 组件的 wxss 注入在部分环境不生效（两次实测散架），
       改为 style 属性写死布局，不依赖任何样式文件 -->
  <!-- 胶囊态玻璃拟态：不铺满底部，左右/下方留边；毛玻璃 + 双层投影（Figma: 圆角24px #F7F9F9） -->
  <view v-if="!tabStore.hidden" style="position: fixed; left: 24rpx; right: 24rpx; bottom: calc(24rpx + min(env(safe-area-inset-bottom), 29px)); height: 112rpx; z-index: 999; display: flex; align-items: center; background: rgba(247,249,249,0.94); -webkit-backdrop-filter: blur(24px) saturate(160%); backdrop-filter: blur(24px) saturate(160%); border-radius: 48rpx; border: 1rpx solid rgba(255,255,255,0.85); box-shadow: 0 10rpx 40rpx rgba(21,128,61,0.10), 0 4rpx 16rpx rgba(0,0,0,0.06); box-sizing: border-box;">
    <!-- 四个普通 tab：与中央 + 号相邻的两项（历史/讲解）留出水平间距，避免图标贴着按钮 -->
    <view
      v-for="item in tabs"
      :key="item.idx"
      :style="'flex: 1; height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center;'
        + (item.idx === 1 ? ' margin-right: 48rpx;' : '')
        + (item.idx === 2 ? ' margin-left: 48rpx;' : '')"
      @tap="switchTab(item)"
    >
      <image
        :src="tabStore.selected === item.idx ? item.iconOn : item.iconOff"
        style="width: 44rpx; height: 44rpx;"
        mode="aspectFit"
      />
      <text
        :style="tabStore.selected === item.idx
          ? 'font-size: 20rpx; color: #22C55E; font-weight: 600; line-height: 1; margin-top: 6rpx;'
          : 'font-size: 20rpx; color: #636E72; line-height: 1; margin-top: 6rpx;'"
      >{{ item.text }}</text>
    </view>

    <!-- 中央凸起 + 号：绿色圆形，一半嵌入胶囊顶部。
         必须用 absolute（相对胶囊条）而非 fixed：父容器 backdrop-filter 会劫持 fixed 的定位基准，
         导致 fixed 表现漂移；absolute 锚定胶囊条，恒定凸出一半 -->
    <view
      :style="fabStyle"
      @touchstart="onFabDown"
      @touchend="onFabUp"
      @touchcancel="onFabUp"
      @tap="goCreate"
    >
      <text style="color: #ffffff; font-size: 52rpx; font-weight: 300; line-height: 1;">＋</text>
    </view>
  </view>
</template>

<script setup>
import Taro from '@tarojs/taro'
import { ref, computed } from 'vue'
import { tabStore } from '../utils/tabbar'
import homeOn from '../assets/tabbar/home-on.png'
import homeOff from '../assets/tabbar/home-off.png'
import historyOn from '../assets/tabbar/history-on.png'
import historyOff from '../assets/tabbar/history-off.png'
import guideOn from '../assets/tabbar/guide-on.png'
import guideOff from '../assets/tabbar/guide-off.png'
import profileOn from '../assets/tabbar/profile-on.png'
import profileOff from '../assets/tabbar/profile-off.png'

// 注意：custom-tab-bar 比 pages 浅一层，相对路径是 ../（不是 ../../）
const tabs = [
  { idx: 0, text: '首页', pagePath: '/pages/home/home', iconOn: homeOn, iconOff: homeOff },
  { idx: 1, text: '历史', pagePath: '/pages/history/history', iconOn: historyOn, iconOff: historyOff },
  { idx: 2, text: '讲解', pagePath: '/pages/guide/guide', iconOn: guideOn, iconOff: guideOff },
  { idx: 3, text: '我的', pagePath: '/pages/profile/profile', iconOn: profileOn, iconOff: profileOff }
]

function switchTab(item) {
  tabStore.selected = item.idx
  Taro.switchTab({ url: item.pagePath })
}

// 中央 + 号：按下加阴影（+ 轻微下沉/缩小反馈），松开恢复原状。
// 只能用 touchstart/touchend 改内联样式：本组件历史坑 = wxss 注入在部分环境不生效，
// 所以不能走 hover-class + 样式类（内联 box-shadow 优先级也压不过类）。
const fabPressed = ref(false)
const FAB_BASE =
  'position: absolute; left: 50%; top: -56rpx; width: 112rpx; height: 112rpx; border-radius: 50%;' +
  'background: linear-gradient(135deg, #22C55E 0%, #16A34A 100%);' +
  'box-sizing: border-box; display: flex; align-items: center; justify-content: center; z-index: 1000;'
const fabStyle = computed(() => {
  const pose = fabPressed.value
    ? // 按下：投影加大加浓（绿光晕更明显）+ 下沉 3rpx、缩到 96%
      'transform: translateX(-50%) translateY(3rpx) scale(0.96);' +
      'box-shadow: 0 16rpx 38rpx rgba(34,197,94,0.55), 0 6rpx 16rpx rgba(22,101,52,0.28);'
    : // 松开：恢复常态投影与位置
      'transform: translateX(-50%) scale(1);' +
      'box-shadow: 0 10rpx 28rpx rgba(34,197,94,0.35);'
  return FAB_BASE + pose
})
function onFabDown() { fabPressed.value = true }
function onFabUp() { fabPressed.value = false }

// 中央 +：非 tab 页，用 navigateTo（带跳转锁防连点撞车）
let routing = false
function goCreate() {
  if (routing) return
  routing = true
  Taro.navigateTo({ url: '/pages/index/index' })
    .then(() => { routing = false })
    .catch(() => {
      routing = false
      Taro.showToast({ title: '跳转失败，请重试', icon: 'none' })
    })
}
</script>

<!-- 布局虽已内联，但微信基础库强制要求组件存在 index.wxss（缺失即 ENOENT 编译错误），
     此处保留非空样式块兜底 + 作为内联失效时的备份 -->
<style>
.ctb-bar { position: fixed; left: 0; right: 0; bottom: 0; }
.ctb-fab-bak {
  position: fixed;
  left: 50%;
  transform: translateX(-50%);
  width: 112rpx;
  height: 112rpx;
  border-radius: 50%;
  background: linear-gradient(135deg, #22C55E 0%, #15803D 100%);
  display: flex;
  align-items: center;
  justify-content: center;
}
</style>
