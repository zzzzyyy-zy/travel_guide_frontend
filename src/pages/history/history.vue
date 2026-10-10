<template>
  <view class="wrap">
    <!-- 页标题 -->

    <!-- 搜索行：搜索框 + 右侧「加入行程」小图标（原顶部三枚胶囊堆叠 → 2026-10-09 改版） -->
    <view class="search-row">
      <view class="search-bar">
        <image class="search-icon" :src="ICO.search" mode="aspectFit" />
        <input class="search-input" v-model="keyword" :maxlength="30"
          placeholder="搜索过往行程" placeholder-class="search-ph" confirm-type="search" />
        <image class="search-clear" v-if="keyword" :src="ICO.close" mode="aspectFit" @tap="keyword = ''" />
      </view>
      <!-- 加入协作：主人给 16 位口令，好友粘贴即入（后端文档 2026-09-28） -->
      <view class="join-icon" @tap="openJoin">
        <image class="join-ico" :src="ICO.plusGreen" mode="aspectFit" />
      </view>
    </view>

    <!-- 分段控制器：全部行程 / 收藏 / 协作行程（互斥单选，替代原三枚并排胶囊） -->
    <view class="seg">
      <view class="seg-item" :class="{ on: activeTab === 'all' }" @tap="pickTab('all')">全部行程</view>
      <view class="seg-item" :class="{ on: activeTab === 'fav' }" @tap="pickTab('fav')">收藏</view>
      <view class="seg-item" :class="{ on: activeTab === 'collab' }" @tap="pickTab('collab')">协作行程</view>
    </view>

    <!-- 长按提示：删除/退出协作收进了长按菜单；顺带点名右上 ＋ 的用途（无行程时不显示） -->
    <view class="lp-hint" v-if="groups.length && !isGuest">
      <text>长按行程卡片可收藏、删除或退出协作 · 点上方 ＋ 加入协作行程</text>
    </view>

    <!-- 按月分组的卡片列表（月份标签加粗吸顶，滚动时快速定位） -->
    <view v-for="g in groups" :key="g.key" class="month-sec">
      <view class="month-label">
        <text class="month-txt">{{ g.label }}</text>
      </view>
      <!-- 长按卡片弹操作菜单（收藏/删除/退出协作）：删除是低频破坏性操作，不占主视觉（2026-10-09 用户定稿） -->
      <view class="trip-card" v-for="t in g.list" :key="t.id" @tap="openTrip(t)" @longpress="onCardMenu(t)">
        <!-- 收藏星标：悬浮在卡片右上角，不与底部按钮抢视线 -->
        <image class="fav-star" :class="{ on: t.isFavorite }" :src="t.isFavorite ? ICO.starFill : ICO.starLine" mode="aspectFit" @tap.stop="toggleFav(t)" />
        <!-- 封面位：有城市照片用真实风景照，没有用城市/标题首字渐变色块兜底 -->
        <image v-if="coverImg(t)" class="trip-cover" :src="coverImg(t)" mode="aspectFill" />
        <view v-else class="trip-cover" :style="coverStyle(t)">{{ coverChar(t) }}</view>
        <view class="trip-main">
          <view class="trip-head">
            <view class="trip-title-wrap">
              <text class="trip-title">{{ tripTitle(t) }}</text>
              <!-- 协作角标：只要除我之外还有人（我创建的 / 别人分享给我的）都算协作，判定见 utils/collab.js -->
              <text class="collab-badge" v-if="isCollabTrip(t)">{{ collabBadge(t) }}</text>
            </view>
          </view>
          <view class="trip-sub">
            <image class="sub-ico" :src="ICO.calendar" mode="aspectFit" />
            <text>{{ tripSub(t) }}</text>
          </view>
          <view class="trip-foot">
            <text class="trip-status" :class="statusOf(t)">{{ statusText(t) }}</text>
            <view class="detail-link">查看详情<image class="link-ico" :src="ICO.chevron" mode="aspectFit" /></view>
          </view>
        </view>
      </view>
    </view>

    <!-- 搜索/筛选无结果与真空态分开提示；游客态（未登录）单独引导登录 -->
    <view class="card empty" v-if="!groups.length && !loading">
      <image class="big-icon" :src="emptyIcon" mode="aspectFit" />
      <view class="title">{{ emptyTitle }}</view>
      <view class="note">{{ emptyNote }}</view>
      <view class="btn" v-if="isGuest" @tap="onLogin">微信登录查看</view>
      <view class="btn" v-else-if="!favOnly && !collabOnly && !keyword" @tap="goHome">去规划</view>
      <view class="btn ghost" v-else-if="favOnly || collabOnly" @tap="clearFilters">看全部行程</view>
      <view class="btn ghost" v-else @tap="keyword = ''">清空搜索</view>
    </view>

    <view class="note center" v-if="loading">加载中…</view>

    <!-- 输入口令加入协作（POST /api/trip/join，幂等：重复加入/owner 自己加入都不会报错） -->
    <view class="join-mask" v-if="joinVisible" @tap="closeJoin">
      <view class="join-pop" @tap.stop>
        <view class="join-pop-title">加入协作行程</view>
        <!-- 单行文案：内容宽 528rpx / 24rpx 字号≈22 字，本句 19 字放得下（nowrap 兜底防折行） -->
        <view class="join-pop-sub">粘贴同伴分享的 16 位口令，即可一起编辑</view>
        <input class="join-input" v-model="joinToken" :disabled="joining" :maxlength="40"
          placeholder="粘贴分享口令" placeholder-class="join-ph" confirm-type="done" @confirm="doJoin" />
        <view class="join-btns">
          <view class="join-btn ghost" @tap="closeJoin">取消</view>
          <view class="join-btn" :class="{ disabled: joining }" @tap="doJoin">
            {{ joining ? '加入中…' : '加入' }}
          </view>
        </view>
      </view>
    </view>
  </view>

  <!-- 全局登录弹层：游客点「加入行程」「登录后查看」等入口时弹出 -->
  <AuthMask />
</template>

<script setup>
import { computed, ref } from 'vue'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useShare } from '../../utils/share'
// 游客态（2026-10-09 微信审核整改）：未登录也能进本页，只是列表为空 + 引导登录
import { sessionState, requireLogin } from '../../utils/auth'
import AuthMask from '../../components/AuthMask.vue'
import api from '../../services/api'
import { cityThumb } from '../../data/cityImages'
import { setTab, setTabBarHidden } from '../../utils/tabbar'
import { isCollabTrip, fetchMemberCounts, clearCollabCache } from '../../utils/collab'
// 图标资源：Iconify 图标库（Lucide / MDI，MIT）按主色预渲染的 PNG（生成脚本见项目笔记 2026-10-01）
import starFill from '../../assets/icons/star-fill.png'
import starLine from '../../assets/icons/star-line.png'
import starFillBig from '../../assets/icons/star-fill-big.png'
import search from '../../assets/icons/search-gray.png'
import searchGreen from '../../assets/icons/search-green.png'
import close from '../../assets/icons/close-gray.png'
import calendar from '../../assets/icons/calendar-gray.png'
import chevron from '../../assets/icons/chevron-right-gray.png'
import plusGreen from '../../assets/icons/plus-green.png'
import users from '../../assets/icons/users-green.png'
import luggage from '../../assets/icons/luggage-green.png'

const ICO = { starFill, starLine, search, close, calendar, chevron, plusGreen, users }

// 本页开启下拉刷新：配置在同名 history.config.js（definePageConfig 宏在 vue SFC 里不生效，实测）

const allItems = ref([])     // 全量列表（唯一数据源）
const loading = ref(false)
// 分段控制器：all=全部行程 / fav=只看收藏 / collab=只看协作行程（单一状态，替代原来的两个布尔互相纠偏）
const activeTab = ref('all')
const favOnly = computed(() => activeTab.value === 'fav')
const collabOnly = computed(() => activeTab.value === 'collab')
const keyword = ref('')      // 搜索词（标题/城市，本地过滤）

// 游客态：未登录进本页不弹登录框，列表为空 + 空态引导点登录（2026-10-09 微信审核整改）
const isGuest = computed(() => !sessionState.loggedIn)
function onLogin() {
  requireLogin(() => refresh(), { tip: '登录后可查看你的行程、收藏与协作记录' })
}

// 加入协作弹层（输入 16 位分享口令）
const joinVisible = ref(false)
const joinToken = ref('')
const joining = ref(false)

// ---------- 筛选链：收藏 → 协作 → 搜索（全部本地做，所见即所得） ----------
const filtered = computed(() => {
  let arr = favOnly.value ? allItems.value.filter(t => t.isFavorite) : allItems.value
  if (collabOnly.value) arr = arr.filter(t => isCollabTrip(t))
  const k = keyword.value.trim().toLowerCase()
  if (k) {
    arr = arr.filter(t => {
      const hay = `${tripTitle(t)} ${t.city || ''}`.toLowerCase()
      return hay.includes(k)
    })
  }
  return arr
})

// 按月分组（key 形如 2024-10，字符串排序即时间排序，组序倒序=最新月份在上）
const groups = computed(() => {
  const map = {}
  const order = []
  filtered.value.forEach(t => {
    const k = monthKeyOf(t)
    if (!map[k]) { map[k] = []; order.push(k) }
    map[k].push(t)
  })
  order.sort().reverse()
  return order.map(k => ({
    key: k,
    label: `${k.slice(0, 4)}年${parseInt(k.slice(5, 8), 10)}月`,
    list: map[k]
  }))
})

const emptyTitle = computed(() => {
  if (isGuest.value) return '登录后查看我的行程'
  if (favOnly.value) return '还没有收藏'
  if (collabOnly.value) return '还没有协作行程'
  if (keyword.value.trim()) return '没有匹配的行程'
  return '还没有行程'
})
const emptyNote = computed(() => {
  if (isGuest.value) return '行程、收藏与协作记录都保存在账号里，登录后可随时查看'
  if (favOnly.value) return '在行程卡片点亮星标即可收藏'
  if (collabOnly.value) return '把行程口令分享给朋友，或点右上角 ＋ 按钮加入，有人一起就是协作行程'
  if (keyword.value.trim()) return '换个关键词试试，或清空搜索看全部'
  return '去「首页」创建第一份行程吧'
})

// 空态大图标：收藏=金星，协作=双人，搜索无结果=放大镜，真空态=行李箱
const emptyIcon = computed(() => {
  if (favOnly.value) return starFillBig
  if (collabOnly.value) return users
  if (keyword.value.trim()) return searchGreen
  return luggage})

// 每次切到本页都刷新（新建/删除/收藏后保持最新）；同步自定义 tabBar 选中态
// 分享：本页内容依赖登录，对方点开只会看到「自己的空历史」→ 转发一律引导到首页
useShare(() => ({
  title: allItems.value.length
    ? `我在智慧文旅攒了 ${allItems.value.length} 份旅行攻略`
    : '智慧文旅 · 一句话生成专属旅行攻略',
  path: '/pages/home/home'
}))

useDidShow(() => {
  setTab(1)
  setTabBarHidden(false)   // 兜底：弹层期间隐藏过 tabBar，回到本页一定恢复
  refresh()
})

// 下拉刷新：复用同一条加载链路，结束时收起下拉动画
usePullDownRefresh(() => refresh())

function refresh() {
  loading.value = true
  // 永远拉全量：GET /api/trip/list → [{ id, title, isFavorite, createdAt, city, days, startDate, isOwner, memberCount? }]
  // 收藏/协作/搜索过滤全在前端做（与 2026-09-25 收藏过滤修复同一口径，不再依赖后端 ?favorite=）
  api.trips.list().then(res => {
    const list = Array.isArray(res) ? res : []
    allItems.value = list
    // 「≥1 人加入即协作」需要成员数，而 list 的 memberCount 会算重（同一人算多次）→ 只核实「看起来是协作」的行程，
    // 核实结果（去重后人数）写回列表项 collabCount，触发筛选/角标重算；徽标只认这个核实值
    fetchMemberCounts(list).then(map => {
      if (!map.size) return
      allItems.value.forEach(t => {
        const n = map.get(t.id)
        if (n) t.collabCount = n
      })
    })
  }).catch(e => {
    // 游客（本地无 token）不算错误：api 层已拦掉静默重登，这里静默显示空态 + 登录引导
    if (isGuest.value || (e && e.code === 'AUTH_REQUIRED')) {
      allItems.value = []
      return
    }
    Taro.showToast({ title: e.message || '加载失败', icon: 'none' })
  }).finally(() => {
    loading.value = false
    Taro.stopPullDownRefresh()  // 下拉没触发时调用也无副作用
  })
}

// 分段控制器：三个 tab 互斥单选（原来两个 chip 靠互相纠偏，改成单一状态更不易错）
// 注意：不能叫 setTab —— 本页已从 utils/tabbar import setTab（自定义 tabBar 选中态），重名会编译报错
function pickTab(name) { activeTab.value = name }
function clearFilters() {
  activeTab.value = 'all'
  keyword.value = ''
}

// ---------- 日期工具（startDate 优先，缺省回落 createdAt，老数据兜底） ----------
function dateOf(t) {
  return String(t.startDate || t.createdAt || '')
}
function monthKeyOf(t) {
  return dateOf(t).slice(0, 7)      // 2024-10
}
function fmtMD(s) {
  const m = parseInt(String(s).slice(5, 7), 10)
  const d = parseInt(String(s).slice(8, 10), 10)
  return (m && d) ? `${m}月${d}日` : ''
}

// 摘要行：startDate ~ endDate（endDate 列表接口可能不带，缺省用天数补）
function tripSub(t) {
  const s = t.startDate ? fmtMD(t.startDate) : ''
  const e = t.endDate ? fmtMD(t.endDate) : ''
  if (s && e) return `${s} - ${e}`
  if (s) return t.days ? `${s} · ${t.days} 天` : s
  return `创建于 ${(t.createdAt || '').slice(5, 16).replace('T', ' ')}`
}

// 状态：后端有 status 用之；没有按日期推（结束日 < 今天 → 已完成，否则进行中）
function statusOf(t) {
  if (t.status) {
    if (t.status === 'done' || t.status === 'completed') return 'completed'
    if (t.status === 'running' || t.status === 'queued') return 'running'
    return t.status
  }
  const today = new Date().toISOString().slice(0, 10)
  const s = String(t.startDate || '')
  const e = String(t.endDate || '')
  if (s && e) return (today > e) ? 'completed' : 'running'
  return 'completed'
}
function statusText(t) {
  const m = {
    completed: '已完成', running: '进行中', queued: '排队中',
    failed: '生成失败', canceled: '已取消'
  }
  return m[statusOf(t)] || '已完成'
}

// ---------- 封面：优先城市缩略图（cityThumb 映射，21 城 = 4 直辖市 + 主要省会），无图回退首字+渐变 ----------
function coverImg(t) {
  return cityThumb(t.city)
}
const COVER_GRADS = [
  'linear-gradient(135deg, #4ADE80, #16A34A)',
  'linear-gradient(135deg, #6EE7B7, #0EA5A4)',
  'linear-gradient(135deg, #86EFAC, #22C55E)',
  'linear-gradient(135deg, #FCD34D, #F29979)',
  'linear-gradient(135deg, #A5B4FC, #6366F1)'
]
function coverStyle(t) {
  const key = String(t.city || t.title || '')
  let h = 0
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) >>> 0
  return { background: COVER_GRADS[h % COVER_GRADS.length] }
}
function coverChar(t) {
  return String(t.city || tripTitle(t)).trim().charAt(0) || '旅'
}

// 星标收藏 / 取消收藏：乐观更新，失败回滚（收藏视图的显隐由 computed 自动响应，无需手动移除）
function toggleFav(t) {
  const target = !t.isFavorite
  t.isFavorite = target
  const req = target ? api.trips.favoriteOn(t.id) : api.trips.favoriteOff(t.id)
  req.catch(e => {
    t.isFavorite = !target
    Taro.showToast({ title: e.message || '操作失败', icon: 'none' })
  })
}

// 点开行程 → 详情页
function openTrip(t) {
  Taro.setStorageSync('currentTripId', t.id)
  Taro.navigateTo({ url: `/pages/itinerary/itinerary?tripId=${t.id}` })
}

// 标题兜底：库里没有 title 字段，后端未拼时用 city + days 组合
function tripTitle(t) {
  if (t.title) return t.title
  if (t.city) return `${t.city} ${t.days || ''}天游`
  return '未命名行程'
}

// ---------- 加入协作（POST /api/trip/join，凭 16 位分享口令，幂等）----------
// 加入协作要用功能 → 先登录（游客态点这里弹登录框，可暂不登录）
function openJoin() {
  requireLogin(() => {
    joinToken.value = ''
    joinVisible.value = true
    // 自定义 tabBar 挂在页面 root 之外，蒙层盖不住它（会保持高亮通透）→ 弹层期间直接隐藏整条
    setTabBarHidden(true)
  }, { tip: '加入协作行程需要登录（协作记录会关联到你的账号）' })
}

function closeJoin() {
  if (joining.value) return   // 请求中不允许关，避免状态错乱
  joinVisible.value = false
  setTabBarHidden(false)
}

function doJoin() {
  if (joining.value) return
  // 粘贴内容常带空格/换行，先清掉再校验
  const token = String(joinToken.value || '').replace(/\s/g, '')
  if (!token) {
    Taro.showToast({ title: '请先粘贴口令', icon: 'none' })
    return
  }
  if (token.length !== 16) {
    Taro.showToast({ title: '口令应为 16 位，请检查', icon: 'none' })
    return
  }
  joining.value = true
  api.trips.join(token).then(d => {
    const tid = d && d.tripId
    if (!tid) throw { message: '加入失败，稍后再试' }
    joinVisible.value = false
    joinToken.value = ''
    setTabBarHidden(false)   // 跳详情页前先把 tabBar 恢复，避免返回时整条不见
    clearCollabCache()   // 刚加入的行程成员数变了，缓存作废
    Taro.setStorageSync('currentTripId', tid)
    Taro.showToast({ title: '已加入协作', icon: 'success' })
    refresh()   // 刷新列表：后端会把协作行程一起返回
    // 稍等一下再跳，让「已加入」的反馈能看见
    setTimeout(() => {
      Taro.navigateTo({ url: `/pages/itinerary/itinerary?tripId=${tid}` })
    }, 600)
  }).catch(e => {
    // 404 = 分享不存在或已失效；400 = token 为空
    Taro.showToast({ title: (e && e.message) || '口令无效或已失效', icon: 'none' })
  }).finally(() => {
    joining.value = false
  })
}

// 协作角标文案：人数只认**核实过的去重人数**（collabCount）—— 列表的 memberCount 会重复计数，
// 直接显示会「2 个人显示 4 个人」；核实完成前只写「协作」，宁可不写也不写错的
function collabBadge(t) {
  const n = Number(t && t.collabCount) || 0
  return n > 0 ? `协作 · ${n}人` : '协作'
}

function removeTrip(t) {
  Taro.showModal({
    title: '删除行程',
    content: `确定删除「${tripTitle(t)}」吗？删除后不可恢复。`,
    success: res => {
      if (!res.confirm) return
      api.trips.remove(t.id).then(() => {
        clearCollabCache()   // 行程没了，缓存的成员数一起清掉
        allItems.value = allItems.value.filter(x => x.id !== t.id)
        Taro.showToast({ title: '已删除', icon: 'success' })
      }).catch(e => {
        Taro.showToast({ title: e.message || '删除失败', icon: 'none' })
      })
    }
  })
}

// 退出协作（DELETE /api/trip/{id}/collaborator/me）：仅协作行程可见
// 成功后从列表移除（后端也会让该行程从 list 消失，这里先本地剔除避免闪一下）
function exitCollab(t) {
  Taro.showModal({
    title: '退出协作',
    content: `退出「${tripTitle(t)}」？退出后这份行程将从你的列表消失，需要重新用口令加入。`,
    confirmText: '退出'
  }).then(res => {
    if (!res.confirm) return
    api.trips.exitCollaboration(t.id).then(() => {
      clearCollabCache()   // 我退出了，该行程的成员数缓存作废
      allItems.value = allItems.value.filter(x => x.id !== t.id)
      Taro.showToast({ title: '已退出协作', icon: 'success' })
    }).catch(e => {
      // 400=创建者不能退出（应删除行程）/ 不是协作者
      Taro.showToast({ title: e.message || '退出失败', icon: 'none' })
    })
  })
}

function goHome() {
  // 表单页已移出 tabBar，改用 navigateTo（tab 页才需要 switchTab）
  Taro.navigateTo({ url: '/pages/index/index' })
}

// 长按卡片 → 原生操作菜单：收藏 + 删除/退出协作（低频破坏性操作收进这里，不占卡片主视觉）
// 协作行程必给「退出协作」（owner 点了会收到后端「创建者不能退出」的提示）；「删除行程」仅 owner 可见
function onCardMenu(t) {
  if (!t || t.id == null) return
  const items = [t.isFavorite ? '取消收藏' : '收藏']
  const acts = ['fav']                       // actions 与 items 一一同序，避免下标算错
  if (isCollabTrip(t)) { items.push('退出协作'); acts.push('exit') }
  if (t.isOwner !== false) { items.push('删除行程'); acts.push('del') }
  Taro.showActionSheet({
    itemList: items,
    success: res => {
      const act = acts[res.tapIndex]
      if (act === 'fav') toggleFav(t)
      else if (act === 'exit') exitCollab(t)
      else if (act === 'del') removeTrip(t)
    },
    // 点「取消」/点遮罩会走 fail（errMsg: "showActionSheet:fail cancel"）→ 必须兜住，否则是未捕获的 Promise 拒绝
    fail: () => {}
  })
}
</script>

<style>
/* 自定义 tabBar 悬浮底部：给列表和底部按钮留出空间 */
.wrap { padding-bottom: calc(240rpx + env(safe-area-inset-bottom)); }

/* 搜索行：搜索框 + 右侧加入行程小图标 */
.search-row { display: flex; align-items: center; gap: 16rpx; }
.join-icon {
  width: 76rpx; height: 76rpx; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  background: #ffffff; border: 1rpx solid #E8E8E8; border-radius: 20rpx;
}
.join-ico { width: 32rpx; height: 32rpx; }

/* 分段控制器：全部行程 / 收藏 / 协作行程（三等分，激活=白底浮起） */
.seg {
  display: flex; align-items: center;
  background: #EDF2EF; border-radius: 999rpx;
  padding: 6rpx; margin: 20rpx 0 24rpx;
}
.seg-item {
  flex: 1; text-align: center; font-size: 26rpx; color: #8A9490;
  padding: 14rpx 0; border-radius: 999rpx;
}
.seg-item.on { background: #ffffff; color: #1F2937; font-weight: 600; box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.06); }

/* 搜索条 */
.search-bar {
  flex: 1; min-width: 0;
  display: flex; align-items: center;
  background: #ffffff; border-radius: 999rpx;
  padding: 20rpx 28rpx;
  box-shadow: 0 4rpx 20rpx rgba(0, 0, 0, 0.04);
}
.search-icon { width: 32rpx; height: 32rpx; margin-right: 14rpx; flex-shrink: 0; }
.search-input { flex: 1; font-size: 27rpx; color: #333; }
.search-ph { color: #ADB5BD; }
.search-clear { width: 26rpx; height: 26rpx; padding: 8rpx; flex-shrink: 0; }

/* 长按操作提示（删除/退出已收进长按菜单）：弱化小字，可读即可 */
.lp-hint {
  display: flex; align-items: center; gap: 8rpx;
  font-size: 20rpx; color: #9AA5A0;
  background: #F1F6F3; border-radius: 12rpx;
  padding: 8rpx 16rpx; margin-bottom: 20rpx;
}

/* 月份分组标题 */
.month-sec { margin-bottom: 8rpx; }
/* 月份标签：加粗放大 + 吸顶（负边距通栏铺底防卡片透出）；时间轴圆点/延伸线已按用户要求移除 */
.month-label {
  position: sticky; top: 0; z-index: 5;
  display: flex; align-items: center;
  margin: 0 -28rpx; padding: 16rpx 28rpx 16rpx 32rpx;
  background: rgba(247, 249, 249, 0.96);
}
.month-txt { font-size: 34rpx; color: #1F2937; font-weight: 700; }

/* 行程卡片：左封面 + 右内容（设计稿半扁平风）；relative 供收藏星标右上角悬浮 */
.trip-card {
  position: relative;
  display: flex; background: #ffffff; border-radius: 32rpx;
  padding: 20rpx; margin-bottom: 24rpx;
  box-shadow: 0 6rpx 24rpx rgba(0, 0, 0, 0.05);
}
.trip-cover {
  width: 168rpx; height: 168rpx; border-radius: 32rpx; flex-shrink: 0;
  display: flex; align-items: center; justify-content: center;
  color: #ffffff; font-size: 64rpx; font-weight: 700;
}
.trip-main { flex: 1; min-width: 0; margin-left: 22rpx; display: flex; flex-direction: column; }
.trip-head { display: flex; justify-content: space-between; align-items: center; }
.trip-title-wrap { display: flex; align-items: center; gap: 12rpx; flex: 1; min-width: 0; padding-right: 48rpx; }
.trip-title { font-size: 30rpx; font-weight: 700; color: #333; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.collab-badge {
  flex-shrink: 0; font-size: 20rpx; color: #15803D; background: #E7F9EE;
  border-radius: 999rpx; padding: 2rpx 14rpx;
}
/* 收藏星标：卡片右上角悬浮（原在标题行内，改为不与底部按钮抢视线） */
.fav-star { position: absolute; top: 14rpx; right: 16rpx; width: 34rpx; height: 34rpx; z-index: 2; }
.trip-sub { display: flex; align-items: center; font-size: 24rpx; color: #868E96; margin-top: 10rpx; }
.sub-ico { width: 26rpx; height: 26rpx; margin-right: 8rpx; flex-shrink: 0; }
/* 卡片底行：状态徽标左、查看详情右（删除/退出已收进长按菜单） */
.trip-foot { display: flex; justify-content: space-between; align-items: center; margin-top: auto; padding-top: 14rpx; }
.trip-status { font-size: 21rpx; padding: 6rpx 18rpx; border-radius: 999rpx; }
.trip-status.completed { background: #E7F9EE; color: #15803D; }
.trip-status.running, .trip-status.queued { background: #E7F9EE; color: #22C55E; }
.trip-status.failed { background: #fdecea; color: #d9534f; }
.trip-status.canceled { background: #E8E8E8; color: #868E96; }
.detail-link { display: flex; align-items: center; font-size: 24rpx; color: #A0ABA6; }
.link-ico { width: 26rpx; height: 26rpx; margin-left: 2rpx; }

/* 空态 */
.empty { text-align: center; padding: 80rpx 40rpx; }
.big-icon { width: 96rpx; height: 96rpx; margin: 0 auto 20rpx; display: block; }
.btn.ghost { background: #fff; color: #22C55E; border: 1rpx solid #22C55E; }
.note.center { text-align: center; }

/* 加入协作弹层 */
.join-mask {
  position: fixed; left: 0; right: 0; top: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.45); z-index: 200;
  display: flex; align-items: center; justify-content: center;
}
.join-pop { width: 600rpx; background: #fff; border-radius: 24rpx; padding: 40rpx 36rpx; }
.join-pop-title { font-size: 32rpx; font-weight: 700; color: #333; text-align: center; }
.join-pop-sub { font-size: 24rpx; color: #868E96; margin-top: 12rpx; line-height: 1.5; text-align: center; white-space: nowrap; }
.join-input {
  margin-top: 28rpx; height: 88rpx; background: #F5F7F7; border-radius: 12rpx;
  padding: 0 24rpx; font-size: 28rpx; color: #333; letter-spacing: 1rpx;
}
.join-ph { color: #ADB5BD; font-size: 26rpx; letter-spacing: 0; }
.join-btns { display: flex; gap: 20rpx; margin-top: 32rpx; }
.join-btn {
  flex: 1; text-align: center; font-size: 28rpx; font-weight: 600; color: #fff;
  background: #22C55E; border-radius: 999rpx; padding: 20rpx 0;
}
.join-btn.ghost { background: #fff; color: #22C55E; border: 1rpx solid #22C55E; }
.join-btn.disabled { opacity: 0.6; }
</style>
