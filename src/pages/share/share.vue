<template>
  <view class="sh-page">
    <!-- 加载中 -->
    <view v-if="phase === 'loading'" class="sh-center">
      <image class="sh-icon" :src="ICO.loader" mode="aspectFit" />
      <view class="sh-title">正在加载分享的攻略…</view>
    </view>

    <!-- 失效 / 不存在 -->
    <view v-else-if="phase === 'invalid'" class="sh-center">
      <image class="sh-icon" :src="ICO.unlink" mode="aspectFit" />
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
          <!-- 实用信息（practical）：老攻略无该字段自动跳过，空子字段不显示 -->
          <view class="sh-prac" v-if="hasPrac(s)">
            <view class="sh-prac-row" v-if="s.practical.booking"><image class="sp-ico" :src="ICO.ticket" mode="aspectFit" />预约：{{ s.practical.booking }}</view>
            <view class="sh-prac-row" v-if="s.practical.hours"><image class="sp-ico" :src="ICO.clockD" mode="aspectFit" />开放：{{ s.practical.hours }}</view>
            <view class="sh-prac-row" v-if="s.practical.shortcut"><image class="sp-ico" :src="ICO.door" mode="aspectFit" />入口：{{ s.practical.shortcut }}</view>
            <view class="sh-prac-row" v-if="s.practical.crowd"><image class="sp-ico" :src="ICO.usersD" mode="aspectFit" />人流：{{ s.practical.crowd }}</view>
            <view class="sh-prac-row" v-if="s.practical.bring"><image class="sp-ico" :src="ICO.backpack" mode="aspectFit" />必带：{{ s.practical.bring }}</view>
          </view>
        </view>
        <view class="sh-item" v-for="(f, fi) in d.food || []" :key="'f' + fi">
          <view class="sh-item-head">
            <text class="sh-time">美食</text>
            <text class="sh-name">{{ f.name }}</text>
          </view>
          <text class="sh-reason" v-if="f.reason">{{ f.reason }}</text>
        </view>
        <view class="sh-note" v-if="d.note"><image class="sp-ico2" :src="ICO.bulb" mode="aspectFit" /><text>{{ d.note }}</text></view>
      </view>

      <view class="sh-card" v-if="detail.result && detail.result.tips && detail.result.tips.length">
        <view class="sh-day">注意事项</view>
        <view class="sh-reason" v-for="(t, i) in detail.result.tips" :key="i">· {{ t }}</view>
      </view>

      <!-- 两个出口都要登录：加入协作（写数据，必须登录）/ 返回首页（进 App 主体）。
           只读浏览这一段不拦 —— 2026-10-08 用户口径变化，原来进页就弹登录已撤 -->
      <view class="sh-card join-card" v-if="detail.id">
        <view class="sh-join-btn" :class="{ disabled: joining }" @tap="goCollaborate">
          {{ joining ? '加入中…' : '加入协作' }}
        </view>
        <view class="sh-home-btn" @tap="goHome">返回首页</view>
      </view>

      <view class="sh-foot">「小沃伴途」AI 一句话生成旅行攻略</view>
    </view>

    <!-- 全局登录弹层：只在点「加入协作」/「返回首页」且未登录（或缺昵称头像）时出现 -->
    <AuthMask />
  </view>
</template>

<script setup>
// 公开只读页：凭分享 token 查看（GET /api/trip/public/{token}，无需登录）
// 数据只有 { id, city, days, result }，无预算对比等用户态内容
import { ref, computed } from 'vue'
import Taro, { useLoad } from '@tarojs/taro'
import { useShare } from '../../utils/share'
import api from '../../services/api'
import { requireLogin, isLoggedIn, isProfileComplete } from '../../utils/auth'
import { captureInviter } from '../../utils/invite'
import AuthMask from '../../components/AuthMask.vue'
import loaderGr3 from '../../assets/icons/loader-green.png'
import unlinkGr from '../../assets/icons/unlink-gray.png'
import ticketD3 from '../../assets/icons/ticket-dark.png'
import clockD3 from '../../assets/icons/clock-dark.png'
import doorD3 from '../../assets/icons/door-open-dark.png'
import usersD3 from '../../assets/icons/users-dark.png'
import backpackD3 from '../../assets/icons/backpack-dark.png'
import bulbW3 from '../../assets/icons/lightbulb-warm.png'

const ICO = {
  loader: loaderGr3, unlink: unlinkGr, ticket: ticketD3, clockD: clockD3, door: doorD3,
  usersD: usersD3, backpack: backpackD3, bulb: bulbW3
}

const phase = ref('loading') // loading | invalid | done
const detail = ref(null)
const days = computed(() => (detail.value && detail.value.result && detail.value.result.days) || [])
const shareToken = ref('')  // 分享 token：加入协作要用
const joining = ref(false)

// ---------- 「登录/完善资料回来后续做」的痕迹 ----------
// 未登录点「加入协作」或「返回首页」→ 弹层登录；若登录响应里缺昵称/头像，utils/auth.js
// finishLogin 会把人送去登录页完善资料（reLaunch），完善后 takeSetupReturn 再把人送回本页。
// 这时用户先前点的是哪个按钮必须记住，否则他还得再点一遍。reLaunch 不重置 JS 运行时，
// 模块级变量读得到（不用 storage）。超过 TTL 作废，防上次残留把人莫名跳走。
let pendingAct = ''            // '' | 'join' | 'home'
let pendingAt = 0
const PENDING_TTL = 180000     // 3 分钟

// 实用信息（practical）：booking/hours/shortcut/crowd/bring，空值不渲染
function hasPrac(s) {
  const p = s && s.practical
  return !!(p && (p.booking || p.hours || p.shortcut || p.crowd || p.bring))
}

// 分享：本页靠 ?token= 就能渲染，所以转发（带 path）与朋友圈（只能带 query）都自洽 ——
// 接收到的人能继续转给下一个人，token 一路带着走
useShare(() => ({
  title: detail.value && detail.value.city ? `好友分享的${detail.value.city}旅行攻略` : '好友分享的旅行攻略',
  city: (detail.value && detail.value.city) || '',
  path: `/pages/share/share${shareToken.value ? '?token=' + shareToken.value : ''}`,
  query: shareToken.value ? `token=${shareToken.value}` : ''
}), { timeline: true })

useLoad(options => {
  // 页面级采集兜底（2026-10-06）：App 级启动参数万一没接住（热启动/时序），这里再接一次。
  // useLoad 的 options 是平铺的（options.inviterId），parseInviter 两种形状都认。
  captureInviter(options)
  const token = (options && options.token) || ''
  shareToken.value = token
  // 2026-10-08：**只读不拦登录** —— 后端 /api/trip/public/{token} 本就免登录，好友点分享卡片
  // 进来直接看攻略。原来这里进页就弹登录，已撤。只有真要「加入协作」「返回首页」时才强制
  // 登录+完善资料（见 goCollaborate / goHome），这两处会用 skippable:false。
  // 邀请关系不受影响：inviterId 已由上面的 captureInviter 落本地，用户后面真登录时
  // 由 silentLogin 随 /api/auth/login 提交（utils/auth.js）。
  // 登录/完善资料回来时补做先前点的动作（join 需要 shareToken，已就位）
  resumePending()
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

// 加入协作：未登录先走登录流程（**强制**，没有「暂不登录」出口），成功后直接进行程页
// （join 幂等，owner 打开自己的分享也安全）
function goCollaborate() {
  if (joining.value) return
  pendingAct = 'join'
  pendingAt = Date.now()
  requireLogin(doJoin, {
    skippable: false,
    tip: '登录并完善头像昵称后，就能加入协作一起编辑这份攻略（新用户注册还能领新人积分）'
  })
}

function doJoin() {
  pendingAct = ''
  if (joining.value) return
  joining.value = true
  api.trips.join(shareToken.value).then(d => {
    const tripId = d && d.tripId
    if (!tripId) throw { message: '加入失败，稍后再试' }
    Taro.redirectTo({ url: `/pages/itinerary/itinerary?tripId=${tripId}` })
  }).catch(e => {
    Taro.showToast({ title: e.message || '加入失败', icon: 'none' })
  }).finally(() => {
    joining.value = false
  })
}

// 返回首页（只读页的次要出口）：想进 App 主体同样要登录+完善资料，口径与「加入协作」一致。
// 注：微信导航栏左上角那个原生「返回首页」按钮前端拦不住，所以必须自己给这个入口。
function goHome() {
  pendingAct = 'home'
  pendingAt = Date.now()
  requireLogin(() => {
    pendingAct = ''
    Taro.reLaunch({ url: '/pages/home/home' })
  }, {
    skippable: false,
    tip: '登录并完善头像昵称后，就能进入小沃伴途生成自己的专属攻略'
  })
}

// 登录/完善资料回来时（本页被重新加载）补做先前点的动作
function resumePending() {
  if (!pendingAct) return
  if (Date.now() - pendingAt > PENDING_TTL) { pendingAct = ''; return }   // 超时作废
  if (!(isLoggedIn() && isProfileComplete())) return   // 登录/完善还没走完，留着下次
  const act = pendingAct
  pendingAct = ''
  console.log('[share] 登录并完善资料归来，继续执行', act)
  // 延时一拍：本函数在 useLoad 里跑，页面栈还在创建中，立刻 reLaunch/redirect 可能被微信丢弃
  setTimeout(() => {
    if (act === 'home') { Taro.reLaunch({ url: '/pages/home/home' }); return }
    if (act === 'join') doJoin()
  }, 0)
}
</script>

<style>
.sh-page { min-height: 100vh; background: #f7f9f9; padding: 24rpx; box-sizing: border-box; }
.sh-center { text-align: center; padding-top: 240rpx; }
.sh-icon { width: 96rpx; height: 96rpx; margin: 0 auto 20rpx; display: block; }
.sh-title { font-size: 34rpx; font-weight: 700; color: #333333; margin-top: 24rpx; }
.sh-note { display: flex; align-items: flex-start; gap: 8rpx; font-size: 26rpx; color: #868E96; margin-top: 16rpx; }
.sh-card { background: #fff; border-radius: 20rpx; padding: 32rpx; margin-bottom: 24rpx; }
.sh-badge {
  display: inline-block; font-size: 22rpx; color: #15803D;
  background: #E7F9EE; border-radius: 999rpx; padding: 6rpx 20rpx; margin-bottom: 16rpx;
}
.sh-day { font-size: 30rpx; font-weight: 700; color: #333333; margin-bottom: 20rpx; }
.sh-sub { font-size: 26rpx; color: #868E96; margin-top: 12rpx; line-height: 1.6; }
.sh-budget { font-size: 30rpx; font-weight: 700; color: #15803D; margin-top: 20rpx; }
.sh-item { padding: 16rpx 0; border-bottom: 1rpx solid #E8E8E8; }
.sh-item:last-child { border-bottom: none; }
.sh-item-head { display: flex; gap: 16rpx; }
.sh-time { font-size: 24rpx; color: #868E96; flex-shrink: 0; }
.sh-name { font-size: 28rpx; color: #333333; font-weight: 600; }
.sh-reason { display: block; font-size: 24rpx; color: #868E96; margin-top: 8rpx; line-height: 1.5; }
/* 实用信息块：浅绿底，标签与内容同行 */
.sh-prac { margin-top: 10rpx; background: #E7F9EE; border-radius: 10rpx; padding: 10rpx 14rpx; }
.sh-prac-row { display: flex; align-items: flex-start; gap: 8rpx; font-size: 22rpx; color: #333333; line-height: 1.7; }
/* 🔴 铁律 11：<image> 必须显式宽高，否则按默认 320×240 渲染成巨图（2026-10-06 真机复现） */
.sp-ico { width: 24rpx; height: 24rpx; flex-shrink: 0; margin-top: 4rpx; }
.sp-ico2 { width: 26rpx; height: 26rpx; flex-shrink: 0; margin-top: 3rpx; }
.sh-foot { text-align: center; font-size: 22rpx; color: #ADB5BD; padding: 24rpx 0 48rpx; }
/* 加入协作卡：只剩绿色主按钮（标题/握手图与副文案均已删，2026-10-06） */
.sh-join-btn {
  margin-top: 0; text-align: center; font-size: 28rpx; font-weight: 600;
  color: #fff; background: #22C55E; border-radius: 999rpx; padding: 18rpx 0;
}
.sh-join-btn.disabled { opacity: 0.6; }
/* 返回首页（次要出口）：浅灰底描边，与实心绿主按钮拉开层级 */
.sh-home-btn {
  margin-top: 20rpx; text-align: center; font-size: 28rpx; color: #52B788;
  background: #F5F8F6; border: 2rpx solid #D7E5DC; border-radius: 999rpx; padding: 16rpx 0;
}
.sh-home-btn:active { opacity: 0.7; }
</style>
