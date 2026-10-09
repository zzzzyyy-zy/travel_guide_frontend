<template>
  <view class="wrap">
    <!-- 顶部渐变区（设计稿：头像+昵称+slogan+统计整块，渐变色 #4A6B62） -->
    <view class="hero-zone">
    <!-- 头部：居中大头像 + 昵称 + slogan（点头像换头像、点昵称改昵称，POST /api/user/profile 部分更新） -->
    <view class="hero">
      <view class="avatar-box" @tap="onAvatarTap">
        <image v-if="avatarUrl" class="avatar-img" :src="avatarUrl" mode="aspectFill" />
        <view v-else class="avatar">{{ initial }}</view>
        <!-- 深色相机角标：可点击换头像（设计稿样式） -->
        <view class="avatar-edit"><image class="ae-ico" :src="ICO.cameraW" mode="aspectFit" /></view>
      </view>
      <view class="u-name" @tap="onNameTap">{{ nickname }}</view>
      <view class="u-slogan">“既然目标是地平线，留给世界的只能是背影。”</view>
    </view>

    <!-- 统计卡：足迹城市 / 全部行程 / 收藏清单（GET /api/trip/list 前端聚合，与足迹页同口径） -->
    <view class="stats-card" v-if="sessionState.loggedIn">
      <view class="stat">
        <text class="stat-num">{{ stats.cities }}</text>
        <text class="stat-label">足迹（城市）</text>
      </view>
      <view class="stat-div"></view>
      <view class="stat">
        <text class="stat-num">{{ stats.trips }}</text>
        <text class="stat-label">全部行程</text>
      </view>
      <view class="stat-div"></view>
      <view class="stat">
        <text class="stat-num">{{ stats.favs }}</text>
        <text class="stat-label">收藏清单</text>
      </view>
    </view>
    </view>

    <!-- 探索者等级卡（设计稿「EXPLORER LEVEL」样式）：等级/称号/EXP 进度条 + 签到/明细/成就/报告
         未登录或后端未实现时整卡隐藏；明细/成就/报告三个子面板保留 -->
    <view class="card g-card" v-if="growth.loaded">
      <view class="g-eyebrow">EXPLORER LEVEL</view>
      <view class="g-head2">
        <view class="g-lv-line">
          <text class="g-lv-big">LV.{{ growth.summary.level || 1 }}</text>
          <text class="g-title2">{{ growth.summary.title || '旅行新手' }}</text>
          <text class="g-gold" v-if="(growth.summary.level || 1) >= 5">GOLD MEMBER</text>
        </view>
        <text class="g-exp">{{ growth.summary.growth || 0 }}/{{ expNext }} EXP</text>
      </view>
      <view class="g-progress"><view class="g-bar" :style="{ width: progressPct + '%' }"></view></view>
      <view class="g-next">{{ nextText }}</view>

      <!-- 签到统计周历已删（2026-10-06 用户要求）：后端只存今天签到 + 连续天数，无逐日历史，
           周历的「昨天前天有没有签」全靠推算，展示的是假数据 -->

      <!-- 主操作行：签到在左占主视觉，三个入口靠右成组，间距由 gap 控制（不再挤在一起） -->
      <view class="g-actions">
        <view class="g-sign" :class="{ done: signedToday }" @tap="doSignIn">{{ signedToday ? '✓ 今日已签到' : '签到 +5' }}</view>
        <view class="g-links">
          <view class="g-link" @tap="togglePanel('points')"><image class="gl-ico" :src="ICO.clipboard" mode="aspectFit" />明细</view>
          <view class="g-link" @tap="gotoBadges"><image class="gl-ico" :src="ICO.trophy" mode="aspectFit" />成就</view>
          <view class="g-link" @tap="togglePanel('report')"><image class="gl-ico" :src="ICO.bot" mode="aspectFit" />报告</view>
        </view>
      </view>

      <!-- 权益区：标题 + 胶囊，单独成行（不再夹在进度条和按钮中间） -->
      <view class="g-benefits" v-if="growth.summary.benefits && growth.summary.benefits.length">
        <view class="g-bf-head">等级权益</view>
        <view class="g-bf-list">
          <text class="g-bf" v-for="(b, i) in growth.summary.benefits" :key="i">{{ b }}</text>
        </view>
      </view>
      <!-- 积分流水面板（GET /api/growth/points 最近 20 条） -->
      <view class="g-panel" v-if="panel === 'points'">
        <view class="g-row" v-for="(r, i) in growth.records" :key="i">
          <text class="g-remark">{{ r.remark }}</text>
          <text class="g-date">{{ fmtDate(r.createdAt) }}</text>
          <text class="g-delta" :class="{ neg: r.points < 0 }">{{ r.points > 0 ? '+' : '' }}{{ r.points }}</text>
        </view>
        <view class="g-empty" v-if="!growth.records.length">暂无积分记录</view>
      </view>
      <!-- 兑换功能暂下线（2026-09-25 用户要求：经验仅作展示）；api.js 的 redeemItems/redeem 保留，恢复时加回入口即可 -->
      <!-- 成就徽章墙已迁到独立页 pages/badges（2026-10-06）：内嵌面板在真机上始终渲染不出数据（数据到了却显示 0），
           改为页面级实现（自带加载/失败/空态 + 每次写入日志），此处只保留入口跳转 -->
      <!-- AI 旅行报告面板（GET /api/growth/report：DeepSeek 日度总结，后端当日缓存） -->
      <view class="g-panel" v-if="panel === 'report'">
        <view class="g-rp-date" v-if="growth.report"><image class="gs-ico" :src="ICO.calendar" mode="aspectFit" />{{ growth.report.date }} · 每日零点更新</view>
        <view class="g-rp-text" v-if="growth.report">{{ growth.report.report }}</view>
        <view class="g-empty" v-if="growth.reportLoading">AI 正在生成今日报告，请稍候…</view>
        <view class="g-empty" v-else-if="!growth.report">暂无报告</view>
      </view>
      <view class="g-invite" v-if="growth.invite">
        <image class="gs-ico" :src="ICO.handshake" mode="aspectFit" />
        <text class="g-invite-txt">已邀请 {{ growth.invite.invitedCount }} 位好友，共获 {{ growth.invite.invitePoints }} 经验</text>
      </view>
    </view>

    <!-- 「我的成就」三卡预览区已删（2026-10-06 用户要求）；徽章墙入口保留在成长卡的「成就」→ pages/badges -->

    <!-- 分组标题 + 功能格（彩色圆角图标块，简约高级感） -->
    <view class="sec-label">个人中心</view>
    <view class="menu-card">
      <!-- 城市足迹：去过哪点亮哪（足迹地图页，与成就体系打通） -->
      <view class="cell" @tap="goFootprint">
        <view class="tile tile-warm"><image class="tile-ico" :src="ICO.mapWarm" mode="aspectFit" /></view>
        <text class="c-label">城市足迹</text>
        <text class="c-arrow">›</text>
      </view>
      <view class="cell" @tap="goHistory">
        <view class="tile tile-blue"><image class="tile-ico" :src="ICO.receiptBlue" mode="aspectFit" /></view>
        <text class="c-label">我的行程</text>
        <text class="c-arrow">›</text>
      </view>
      <!-- 我的备忘：跨行程的个人小本子，旅途中不进行程也能随手记（数据见 services/memo.js） -->
      <view class="cell" @tap="goMemo">
        <view class="tile tile-purple"><image class="tile-ico" :src="ICO.notebookPurple" mode="aspectFit" /></view>
        <text class="c-label">我的备忘</text>
        <text class="c-badge" v-if="memoCount > 0">{{ memoCount }}</text>
        <text class="c-arrow">›</text>
      </view>
      <!-- 「分享给好友」cell 已删（2026-10-08）：它与「邀请有礼」完全同源（同一个 useShare 参数，
           path 同样被 utils/share.js 追加 inviterId），功能重复 → 只留「邀请有礼」。
           邀请有礼的可见行用普通 .cell（和其他行像素级同源），上面盖一层透明 button(open-type=share) 接管点击。
           为什么不直接给 button 套 .cell：真机实测 button 自带的 width/居中默认样式会压过页面类样式
           （截图实锤：整行内容缩成一团居中），透明覆盖层彻底绕开这场默认样式之争。
           依赖 profile.config.js 的 enableShareAppMessage（没这个开关按钮点了没反应） -->
      <view class="cell share-cell">
        <view class="tile tile-gold"><image class="tile-ico" :src="ICO.handshake" mode="aspectFit" /></view>
        <text class="c-label">邀请有礼</text>
        <text class="c-arrow">›</text>
        <button class="share-cover" open-type="share" hover-class="none"></button>
      </view>
      <!-- 运营看板：仅管理员可见（登录响应 data.user.isAdmin，驼峰）；403 兜底仍保留双保险 -->
      <view class="cell" v-if="isAdmin" @tap="toggleAdmin">
        <view class="tile tile-green"><image class="tile-ico" :src="ICO.chart" mode="aspectFit" /></view>
        <text class="c-label">运营看板</text>
        <text class="c-arrow">›</text>
      </view>
      <!-- 意见反馈：联系邮箱 + 意见 + 可选截图（POST /api/feedback，后端契约 2026-10-05） -->
      <view class="cell" @tap="goFeedback">
        <view class="tile tile-green"><image class="tile-ico" :src="ICO.mail" mode="aspectFit" /></view>
        <text class="c-label">意见反馈</text>
        <text class="c-arrow">›</text>
      </view>
      <view class="cell" @tap="about">
        <view class="tile tile-blue2"><image class="tile-ico" :src="ICO.infoBlue" mode="aspectFit" /></view>
        <text class="c-label">关于智慧文旅</text>
        <text class="c-arrow">›</text>
      </view>
    </view>

    <!-- 微信资料引导卡：仅"已登录且资料不全"才显示 —— 不加 loggedIn 的话，退出瞬间 user 清空会闪出此卡 -->
    <view class="card wx-card" v-if="sessionState.loggedIn && needWxProfile">
      <view class="wx-title">完善微信资料</view>
      <view class="wx-note">一键带入你的微信头像和昵称</view>
      <view class="wx-row">
        <!-- open-type=chooseAvatar：弹微信头像选择（官方能力，用户确认后回调临时文件） -->
        <button class="wx-avatar-btn" open-type="chooseAvatar" @chooseavatar="onWxAvatar">
          <image v-if="wxAvatarDraft" class="wx-avatar-preview" :src="wxAvatarDraft" mode="aspectFill" />
          <text v-else class="wx-avatar-ph">头像</text>
        </button>
        <!-- type=nickname：键盘上方会出现微信昵称快捷填入 -->
        <input class="wx-name-input" v-model="wxNameDraft" type="nickname" placeholder="获取微信昵称" maxlength="20" />
      </view>
      <view class="btn wx-save" @tap="saveWxProfile">保存资料</view>
    </view>

    <!-- 运营数据看板（GET /api/admin/stats，仅管理员）：展开后才请求，403 时收起并提示 -->
    <view class="card adm-card" v-if="admin.open">
      <view class="adm-title"><image class="gs-ico" :src="ICO.chart" mode="aspectFit" />运营数据看板</view>
      <view class="g-empty" v-if="admin.loading">加载中…</view>
      <block v-else-if="admin.stats">
        <view class="adm-grid">
          <view class="adm-item"><text class="adm-num">{{ admin.stats.totalUsers }}</text><text class="adm-label">总用户</text></view>
          <view class="adm-item"><text class="adm-num">{{ admin.stats.totalTrips }}</text><text class="adm-label">总攻略</text></view>
          <view class="adm-item"><text class="adm-num">{{ admin.stats.totalCheckIns }}</text><text class="adm-label">总打卡</text></view>
          <view class="adm-item"><text class="adm-num">{{ admin.stats.dau }}</text><text class="adm-label">今日日活</text></view>
        </view>
        <view class="adm-sub"><image class="gs-ico" :src="ICO.flameWarm" mode="aspectFit" />最热城市 Top5（按攻略数）</view>
        <view class="adm-city" v-for="(c, i) in admin.stats.topCities" :key="i">
          <text class="adm-rank" :class="{ top: i < 3 }">{{ i + 1 }}</text>
          <text class="adm-city-name">{{ c.city }}</text>
          <text class="adm-cnt">{{ c.cnt }} 条</text>
        </view>
        <!-- 预热热门景点照片：后台异步转存 OSS，演示前调一次 popular 秒回 -->
        <view class="adm-warm" :class="{ disabled: admin.warming }" @tap="warmAttractions">
          {{ admin.warming ? '预热已启动，后台处理中…' : '预热景点图（演示前点一次）' }}
        </view>
        <!-- 意见反馈（GET /api/admin/feedbacks，仅管理员）：展开看最新 20 条 -->
        <view class="adm-warm" :class="{ disabled: admin.fbLoading }" @tap="loadFeedbacks">
          {{ admin.fbLoading ? '反馈加载中…' : (admin.feedbacks.length ? '刷新意见反馈' : '查看意见反馈') }}
        </view>
        <block v-if="admin.feedbacks.length">
          <view class="adm-fb" v-for="f in admin.feedbacks" :key="f.id">
            <view class="adm-fb-head">
              <text class="adm-fb-contact">{{ f.contact }}</text>
              <text class="adm-fb-time">{{ fmtDate(f.createdAt) }}</text>
              <!-- 删除（DELETE /api/admin/feedbacks/{id}）：二次确认后本地摘除，403/404 单独提示 -->
              <text class="adm-fb-del" @tap.stop="delFeedback(f)">删除</text>
            </view>
            <view class="adm-fb-content">{{ f.content }}</view>
            <!-- images 后端回的是逗号分隔字符串（db 原样），不是数组 → fbImgs() 拆好再渲染。
                 ⚠️ 别把 split/filter 箭头函数内联回模板：属性里的 => 会被配平器当标签结束符 -->
            <view class="adm-fb-imgs" v-if="fbImgs(f).length">
              <image
                v-for="(u, k) in fbImgs(f)" :key="k"
                class="adm-fb-img" :src="u" mode="aspectFill"
                @tap="previewImg(fbImgs(f), u)" />
            </view>
          </view>
        </block>
        <view class="g-empty" v-else-if="!admin.fbLoading">还没有收到反馈</view>
      </block>
    </view>

    <!-- 邀请小程序码浮层已撤（2026-10-08 用户要求取消邀请码）；邀请关系仍由转发 path / 朋友圈 query 承载 -->

    <!-- 退出登录：设计稿为独立白底红字胶囊（confirmLogout 有二次确认）；游客态无登录可言 → 不显示 -->
    <view class="logout-btn" v-if="!isGuest" @tap="confirmLogout">退出登录</view>

    <view class="foot">智慧文旅 v1.0 · 课程项目演示版</view>
  </view>

  <!-- 全局登录弹层：游客点「点击登录」/头像/昵称或需登录的菜单入口时弹出 -->
  <AuthMask />
</template>

<script setup>
import { computed, reactive, ref } from 'vue'
import Taro, { useDidShow, usePullDownRefresh } from '@tarojs/taro'
import { useShare } from '../../utils/share'
import { sessionState, logout, requireLogin } from '../../utils/auth'
import AuthMask from '../../components/AuthMask.vue'
import { saveUser } from '../../utils/token'
import api from '../../services/api'
import { countMemos, refreshMemos } from '../../services/memo'
import { setTab } from '../../utils/tabbar'
import { normCity } from '../../data/cityCoords'
import cameraWh from '../../assets/icons/camera-white.png'
import flameGd from '../../assets/icons/flame-gold.png'
import flameWm from '../../assets/icons/flame-warm.png'
import clipboardGr from '../../assets/icons/clipboard-list-green.png'
import trophyGr from '../../assets/icons/trophy-green.png'
import botGr from '../../assets/icons/bot-green.png'
import medalGd from '../../assets/icons/medal-gold.png'
import calendarGr2 from '../../assets/icons/calendar-green.png'
import handshakeGr2 from '../../assets/icons/handshake-green.png'
import barChartGr from '../../assets/icons/bar-chart-green.png'
import mapWm from '../../assets/icons/map-warm.png'
import receiptBl from '../../assets/icons/receipt-blue.png'
import notebookPu from '../../assets/icons/notebook-pen-purple.png'
import infoBl from '../../assets/icons/info-blue.png'
import mailGr from '../../assets/icons/mail-green.png'  // 意见反馈（2026-10-05 新入口）
// 徽章图标与网格逻辑已挪到 utils/badges.js（pages/badges 勋章墙共用），本页只做入口跳转
import { normAchvs } from '../../utils/badges'

const ICO = {
  cameraW: cameraWh, flameGold: flameGd, flameWarm: flameWm,
  clipboard: clipboardGr, trophy: trophyGr, bot: botGr, medal: medalGd,
  calendar: calendarGr2, handshake: handshakeGr2, chart: barChartGr,
  mapWarm: mapWm, receiptBlue: receiptBl, notebookPurple: notebookPu, infoBlue: infoBl, mail: mailGr
}

// 从响应式镜像取用户信息（token.js 的 sessionState，经 auth 转出），不直接读 storage
// 游客态（2026-10-09 微信审核整改）：未登录不显示「微信用户」这种假身份，改为「点击登录」引导
const isGuest = computed(() => !sessionState.loggedIn)
const nickname = computed(() => {
  if (isGuest.value) return '点击登录'
  const u = sessionState.user
  return (u && u.nickname) || '微信用户'
})
const initial = computed(() => (isGuest.value ? '旅' : (nickname.value.charAt(0) || '微')))
const avatarUrl = computed(() => (sessionState.user && sessionState.user.avatarUrl) || '')

// 游客点头像/昵称 → 弹登录框（可暂不登录）；已登录才走改资料流程
function goLogin() {
  requireLogin(null, { tip: '登录后可保存行程历史、记账与收藏，并同步你的旅行偏好' })
}
function onAvatarTap() {
  if (isGuest.value) { goLogin(); return }
  changeAvatar()
}
function onNameTap() {
  if (isGuest.value) { goLogin(); return }
  editNickname()
}

// 管理员标识：登录响应 data.user.isAdmin（驼峰布尔，2026-09-26 后端确认不再返回 null）。
// 注意：只在登录时下发，DB 里改了 is_admin 后要重新登录前端才会更新；403 兜底不受影响
const isAdmin = computed(() => !!(sessionState.user && sessionState.user.isAdmin))

// 把 /api/user/profile 的返回合并进本地登录态（部分更新：非空字段才覆盖）
function applyProfile(d) {
  const u = { ...(sessionState.user || {}) }
  if (d && d.nickname) u.nickname = d.nickname
  if (d && d.avatarUrl) u.avatarUrl = d.avatarUrl
  saveUser(u)
}

// ---------- 微信头像昵称引导卡（官方「头像昵称填写能力」，getUserProfile 已废弃只能拿匿名数据） ----------
const wxNameDraft = ref('')
const wxAvatarDraft = ref('')   // chooseAvatar 回调的本地临时文件路径，先预览、保存时再上传
// 昵称仍是兜底值、或头像为空 → 显示引导卡；资料齐了自动隐藏
const needWxProfile = computed(() => !sessionState.user || !sessionState.user.nickname || !sessionState.user.avatarUrl)

function onWxAvatar(e) {
  const url = e && e.detail && e.detail.avatarUrl
  if (url) wxAvatarDraft.value = url
}

function saveWxProfile() {
  if (!sessionState.loggedIn) {
    Taro.showToast({ title: '请先登录', icon: 'none' })
    return
  }
  const nickname = (wxNameDraft.value || '').trim()
  if (!nickname && !wxAvatarDraft.value) {
    Taro.showToast({ title: '先选头像或填昵称', icon: 'none' })
    return
  }
  const sendAvatar = () => {
    if (!wxAvatarDraft.value) return Promise.resolve(null)
    // chooseAvatar 给的是本地临时文件 → base64 → 走同一个 profile 接口
    return new Promise((resolve, reject) => {
      Taro.getFileSystemManager().readFile({
        filePath: wxAvatarDraft.value,
        encoding: 'base64',
        success: r => api.user.profile({ avatar: r.data }).then(resolve).catch(reject),
        fail: () => reject({ message: '头像文件读取失败' })
      })
    })
  }
  const sendNickname = () =>
    nickname ? api.user.profile({ nickname }) : Promise.resolve(null)

  Taro.showLoading({ title: '保存中…', mask: true })
  Promise.all([sendNickname(), sendAvatar()]).then(([nd, ad]) => {
    Taro.hideLoading()
    applyProfile(nd)
    applyProfile(ad)
    wxAvatarDraft.value = ''
    Taro.showToast({ title: '资料已保存', icon: 'success' })
  }).catch(e => {
    Taro.hideLoading()
    Taro.showToast({ title: (e && e.message) || '保存失败', icon: 'none' })
  })
}

// ---------- 换头像：选图（压缩）→ base64 → POST /api/user/profile ----------
function changeAvatar() {
  requireLogin(() => {
    Taro.chooseImage({
      count: 1,
      sizeType: ['compressed'],
      success: res => {
        const fp = res.tempFilePaths && res.tempFilePaths[0]
        if (!fp) return
        Taro.showLoading({ title: '上传中…', mask: true })
        Taro.getFileSystemManager().readFile({
          filePath: fp,
          encoding: 'base64',
          success: r => {
            // 后端接受裸 base64 或带 data URL 前缀，这里发裸 base64
            api.user.profile({ avatar: r.data }).then(d => {
              Taro.hideLoading()
              applyProfile(d)
              Taro.showToast({ title: '头像已更新', icon: 'success' })
            }).catch(e => {
              Taro.hideLoading()
              Taro.showToast({ title: (e && e.message) || '头像上传失败', icon: 'none' })
            })
          },
          fail: () => {
            Taro.hideLoading()
            Taro.showToast({ title: '图片读取失败', icon: 'none' })
          }
        })
      }
    })
  })
}

// ---------- 改昵称：editable 弹窗 → POST /api/user/profile ----------
function editNickname() {
  requireLogin(() => {
    Taro.showModal({
      title: '修改昵称',
      editable: true,
      placeholderText: '输入新昵称（最多 20 字）',
      success: r => {
        const name = (r.content || '').trim()
        if (!r.confirm || !name) return
        api.user.profile({ nickname: name }).then(d => {
          applyProfile(d)
          Taro.showToast({ title: '昵称已更新', icon: 'success' })
        }).catch(e => {
          Taro.showToast({ title: (e && e.message) || '昵称修改失败', icon: 'none' })
        })
      }
    })
  })
}

// ---------- 统计卡：足迹城市 / 全部行程 / 收藏清单（与足迹页同口径的本地聚合） ----------
const stats = reactive({ cities: 0, trips: 0, favs: 0 })
function loadStats() {
  if (!sessionState.loggedIn) return
  api.trips.list().then(list => {
    const arr = Array.isArray(list) ? list : []
    const set = new Set()
    arr.forEach(t => {
      const c = normCity(t.city || t.destinationCity)
      if (c) set.add(c)
    })
    stats.cities = set.size
    stats.trips = arr.length
    stats.favs = arr.filter(t => t.isFavorite).length
  }).catch(() => {})   // 静默：统计卡是装饰性数据，失败就保持旧值/0，不弹错误
}

// ---------- 成长运营（7.7）：签到/等级/流水/邀请/兑换 ----------
// 今日是否已签直接读后端 summary 的 signedToday（2026-09-25 后端新增，替代旧本地记账方案）
const growth = reactive({ loaded: false, summary: {}, streak: 0, records: [], items: [], achvs: [], achvsErr: false, invite: null, report: null, reportLoading: false })
const panel = ref('')   // '' | 'points' | 'achv' | 'report'：展开的子面板
// 运营看板（GET /api/admin/stats）：展开后才请求，非管理员 403 自动收起
const admin = reactive({ open: false, loading: false, stats: null, warming: false, feedbacks: [], fbLoading: false, fbDeleting: false })

const signedToday = computed(() => !!(growth.summary && growth.summary.signedToday))

// 签到统计周历已删（2026-10-06）：后端只有 streak + signedToday、无逐日打卡历史，
// 周历「昨天有没有签」是推算出来的假数据，不可信 → 连「已连续签到 N 天」也一并下掉

// EXP 进度（设计稿「1250/2000 EXP」形态）：分母取下一级阈值——
// 兼容 nextLevelGrowth 两种语义（阈值 / 剩余），与 progressPct 同一套换算
const expNext = computed(() => {
  const s = growth.summary || {}
  const g = s.growth || 0
  if (!s.nextLevelGrowth || s.nextLevelGrowth <= 0) return g || 0
  return s.nextLevelGrowth > g ? s.nextLevelGrowth : g + s.nextLevelGrowth
})

// 等级阈值表（1~5 级）：仅用于进度条估算当前级的起点；后端契约变化时只改这里
const LEVEL_MIN = [0, 100, 300, 600, 1000]

// 成长值进度：兼容两种 nextLevelGrowth 语义——
// ①阈值（文档原义）：值本身 > 当前经验 → 百分比 = growth / 阈值
// ②剩余（后端实测）：值 ≤ 当前经验 → 下一级阈值 = growth + 剩余，起点取 LEVEL_MIN 中 ≤ growth 的最大档
const progressPct = computed(() => {
  const s = growth.summary || {}
  const g = s.growth || 0
  if (!s.nextLevelGrowth || s.nextLevelGrowth <= 0) return 100
  const nextMin = s.nextLevelGrowth > g ? s.nextLevelGrowth : g + s.nextLevelGrowth
  const curMin = LEVEL_MIN.filter(t => t <= g).pop() || 0
  const span = (nextMin - curMin) || 1
  return Math.min(100, Math.max(0, Math.round(((g - curMin) / span) * 100)))
})
const nextText = computed(() => {
  const s = growth.summary || {}
  const n = s.nextLevelGrowth
  if (!n || n <= 0) return '已达最高等级'
  const g = s.growth || 0
  return `再获 ${n > g ? n - g : n} 经验升级`   // 阈值语义换算成剩余；剩余语义直接用
})

function applySummary(s) {
  if (s) growth.summary = s
}
// 成就系列归一化挪到 utils/badges.js（与勋章墙页共用一份，别再在本页重写）

// 成就系列写入唯一入口：**空结果不覆盖非空旧数据**。背景：loadGrowth（每次 didShow 都跑）里的
// 成就请求带 catch(() => []) 兜底，隧道瞬断一次就会用 [] 把刚拉到的真数据冲掉 →
// 「Console 有成功日志、无报错、UI 却是 0」的灵异现象（2026-10-06 实测）。每次写入都打日志便于定位。
function setAchvs(normed, from) {
  console.log('[achv] 写入成就系列（' + from + '）：', normed.length, '个系列')
  if (normed.length || !growth.achvs.length) growth.achvs = normed
}

function loadGrowth() {
  if (!sessionState.loggedIn) { growth.loaded = false; return }
  Promise.all([
    api.growth.summary(),
    api.growth.inviteInfo().catch(() => null),
    // 成就系列：除「成就」面板外，页面上的「我的成就」三卡区也吃这份数据，进页就拉
    api.growth.achievements().catch(err => {
      console.warn('[achv] loadGrowth 拉取失败：', err && (err.code || err.message))
      return []
    })
  ]).then(([s, inv, ach]) => {
    growth.loaded = true
    applySummary(s)
    growth.invite = inv
    setAchvs(normAchvs(ach), 'loadGrowth')
  }).catch(() => { growth.loaded = false })   // 后端没实现/未登录：不显示卡，不烦人
}

// 「我的成就」三卡预览区已删（2026-10-06）；growth.achvs 仅作日志/调试用途

// ---------- 成就徽章墙迁到独立页（2026-10-06）----------
// 徽章网格/详情浮层的实现整体搬到 pages/badges/badges.vue（共享逻辑在 utils/badges.js）：
// 内嵌面板在真机上「数据到了、无报错、UI 却是 0」，页面级实现自带加载/失败/空态与写入日志，好排查也好维护。
// 本页只保留成长卡「成就」一处入口跳转。
function gotoBadges() {
  goAuthed('/pages/badges/badges', '登录后可查看你的成就与成长值')
}
// 需要登录的菜单入口（2026-10-09 微信审核整改）：游客点了先弹登录框（可暂不登录）
function goAuthed(url, tip) {
  requireLogin(() => {
    Taro.navigateTo({ url }).catch(() => Taro.showToast({ title: '跳转失败，请重试', icon: 'none' }))
  }, { tip: tip || '登录后可查看你的数据' })
}

function togglePanel(name) {
  if (panel.value === name) { panel.value = ''; return }
  panel.value = name
  if (name === 'points') api.growth.points().then(list => { growth.records = Array.isArray(list) ? list : [] }).catch(() => {})
  if (name === 'report') loadReport()
}

// ---------- 邀请小程序码（2026-10-08 撤除，邀请功能本身不变）----------
// 曾接 GET /api/growth/invite-qrcode（scene=inviterId=<我的 userId>）走「扫码」这条邀请载体。
// 用户 2026-10-08 决定只要二维码撤掉 → 浮层 + 该接口调用一并删除；
// 邀请入口保留，改为「邀请有礼」cell 的转发按钮（open-type=share），
// 转发 path 由 utils/share.js 自动带 inviterId，扫码那条载体不再使用（首页的 scene 解析保留，不影响）。
// 邀请统计（已邀请 N 位）保留：成长卡的 growth.invite 行仍在，数据来自 api.growth.inviteInfo()。
// 邀请统计（已邀请 N 位）保留：成长卡的 growth.invite 行仍在，数据来自 api.growth.inviteInfo()。

// 本地日期串（YYYY-MM-DD，跟后端 date 字段同格式）；注意用本地时区而非 toISOString 的 UTC
function todayStr() {
  const d = new Date()
  const p = n => (n < 10 ? '0' + n : '' + n)
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate())
}

// AI 旅行报告：后端当日缓存，前端当天拿过就不再请求（避免每次展开都等 DeepSeek）
function loadReport() {
  if (growth.report && growth.report.date === todayStr()) return
  growth.reportLoading = true
  api.growth.report().then(d => {
    growth.report = d
    growth.reportLoading = false
  }).catch(e => {
    growth.reportLoading = false
    Taro.showToast({ title: (e && e.message) || '报告生成失败', icon: 'none' })
  })
}

// ---------- 运营看板 ----------
function toggleAdmin() {
  if (admin.open) { admin.open = false; return }
  admin.open = true
  loadAdmin()
}
function loadAdmin() {
  admin.loading = true
  api.admin.stats().then(d => {
    admin.stats = d
    admin.loading = false
  }).catch(e => {
    // 403 = 非管理员：收起面板并提示，不留一张空卡
    admin.open = false
    admin.loading = false
    Taro.showToast({ title: (e && e.message) || '需要管理员权限', icon: 'none' })
  })
}

// 意见反馈列表（GET /api/admin/feedbacks，仅管理员）：点一次拉一次（新反馈要看最新的）
function loadFeedbacks() {
  if (admin.fbLoading) return
  admin.fbLoading = true
  api.admin.feedbacks().then(list => {
    admin.feedbacks = Array.isArray(list) ? list : []
    admin.fbLoading = false
  }).catch(e => {
    admin.fbLoading = false
    Taro.showToast({ title: (e && e.message) || '需要管理员权限', icon: 'none' })
  })
}

// 删除单条反馈（DELETE /api/admin/feedbacks/{id}，2026-10-05 契约）：二次确认 → 成功本地摘除
// ⚠️ 该接口「无 data」→ 乐观更新 + 失败回滚：先摘掉再请求，失败把原项按原下标插回
function delFeedback(f) {
  if (!f || f.id == null || admin.fbDeleting) return
  Taro.showModal({
    title: '删除这条反馈？',
    content: '删除后不可恢复',
    confirmText: '删除',
    confirmColor: '#E5484D'
  }).then(r => {
    if (!r.confirm) return
    admin.fbDeleting = true
    const i = admin.feedbacks.findIndex(x => x.id === f.id)
    admin.feedbacks.splice(i, 1)                                  // 乐观摘除
    api.admin.removeFeedback(f.id).then(() => {
      Taro.showToast({ title: '已删除', icon: 'success' })
    }).catch(e => {
      if (i >= 0) admin.feedbacks.splice(i, 0, f)                 // 回滚到原位置
      const code = e && e.code
      Taro.showToast({
        title: code === 404 ? '意见不存在，已刷新' : (code === 403 ? '无权限（非管理员）' : ((e && e.message) || '删除失败')),
        icon: 'none'
      })
    }).finally(() => { admin.fbDeleting = false })
  }).catch(() => {})
}

// 意见反馈提交页（POST /api/feedback）
function goFeedback() {
  Taro.navigateTo({ url: '/pages/feedback/feedback' })
}

// images 后端回逗号分隔字符串 → 拆成 URL 数组（模板里不写箭头函数，见上）
function fbImgs(f) {
  return String((f && f.images) || '').split(',').map(s => s.trim()).filter(Boolean)
}
function previewImg(urls, current) {
  Taro.previewImage({ urls, current }).catch(() => {})
}

// 预热热门景点照片：后台异步（拉图→转存 OSS→缓存），演示前调一次，之后 popular 秒回
function warmAttractions() {
  if (admin.warming) return
  admin.warming = true
  api.admin.warmAttractions().then(msg => {
    Taro.showToast({ title: typeof msg === 'string' ? msg : '预热已启动', icon: 'success', duration: 2000 })
  }).catch(e => {
    Taro.showToast({ title: (e && e.message) || '预热启动失败', icon: 'none' })
  }).finally(() => { admin.warming = false })
}

// ---------- 成就勋章展示辅助 ----------
function doSignIn() {
  if (!sessionState.loggedIn) { Taro.showToast({ title: '请先登录', icon: 'none' }); return }
  if (signedToday.value) { Taro.showToast({ title: '今日已签到', icon: 'none' }); return }
  api.growth.signIn().then(s => {
    applySummary({ ...(growth.summary), ...(s || {}), signedToday: true })   // 签到成功：本地立即置位（合并旧 summary，响应缺 streak 时不清零）；等下次进页 summary 校准
    growth.streak = s.streak || growth.streak || 0
    const bonus = (s.todayPoints || 5) > 5 ? `（含连续奖励）` : ''
    Taro.showToast({ title: `+${s.todayPoints || 5} 经验${bonus}`, icon: 'success' })
    if (panel.value === 'points') api.growth.points().then(list => { growth.records = Array.isArray(list) ? list : [] }).catch(() => {})
  }).catch(e => {
    if (e && e.code === 400) {
      // 后端说今日已签 → 拉一次 summary 同步 signedToday，按钮态自动对齐
      api.growth.summary().then(applySummary).catch(() => {})
      Taro.showToast({ title: e.message || '今日已签到', icon: 'none' })
    } else {
      Taro.showToast({ title: (e && e.message) || '签到失败', icon: 'none' })
    }
  })
}

// 兑换功能暂下线（2026-09-25：经验仅作展示）；恢复时把模板里兑换面板和本函数加回

function fmtDate(iso) {
  return iso ? String(iso).slice(5, 16).replace('T', ' ') : ''
}

// 每次切到本页刷新成长数据（签到后回来保持最新）；同步自定义 tabBar 选中态
// 分享：页内「分享给好友」cell（原生 open-type="share"）与右上角菜单共用这套参数。
// 本页是个人页，带对方进来也没内容 → 统一引导到首页
useShare(() => ({
  title: '智慧文旅 · 一句话生成专属旅行攻略',
  path: '/pages/home/home'
}))

useDidShow(() => {
  setTab(3)
  loadGrowth()
  loadStats()
  refreshMemoCount()
})

// 下拉刷新：重拉成长摘要/邀请信息；当前展开的明细/成就/报告面板与运营看板一并刷新
usePullDownRefresh(() => {
  const tasks = [
    loadGrowth(),
    loadStats(),
    panel.value === 'points'
      ? api.growth.points().then(list => { growth.records = Array.isArray(list) ? list : [] }).catch(() => {})
      : Promise.resolve(),
    panel.value === 'achv'
      ? api.growth.achievements().then(list => { setAchvs(normAchvs(list), 'pullRefresh') }).catch(() => {})
      : Promise.resolve(),
    panel.value === 'report'
      ? api.growth.report().then(d => { growth.report = d }).catch(() => {})
      : Promise.resolve(),
    admin.open ? loadAdmin() : Promise.resolve()
  ]
  Promise.all(tasks).finally(() => Taro.stopPullDownRefresh())
})

function goHistory() {
  Taro.switchTab({ url: '/pages/history/history' })
}

function goFootprint() {
  Taro.navigateTo({ url: '/pages/footprint/footprint' })
}

// 个人备忘：不带 tripId 进备忘录页 → 默认落在「我的备忘」视角；回来时 useDidShow 刷条数
const memoCount = ref(0)
function refreshMemoCount() {
  // 缓存先出数（同步），再拉服务端校正 —— 个人备忘现在存在服务端
  try { memoCount.value = countMemos('mine', '') } catch (e) { memoCount.value = 0 }
  // 游客（未登录）不拉：/api/user/notes 需登录，拉了只会在页面上挂一条错误提示
  if (!sessionState.loggedIn) return
  refreshMemos('mine', '').then(l => { memoCount.value = l.length }).catch(() => {})
}
function goMemo() {
  // 个人备忘存在服务端 → 游客先登录（可暂不登录）
  goAuthed('/pages/memo/memo', '登录后可记录与同步你的备忘')
}

function about() {
  Taro.showModal({
    title: '关于智慧文旅',
    content: 'AI 行程规划 + 语音导游小程序。输入目的地一键生成行程，走到景点附近自动识别并播放讲解，随时追问。',
    showCancel: false,
    confirmText: '知道了'
  })
}

function confirmLogout() {
  if (!sessionState.loggedIn) {
    Taro.showToast({ title: '当前未登录', icon: 'none' })
    return
  }
  Taro.showModal({
    title: '退出登录',
    content: '退出后需要重新登录才能使用完整功能，确定退出吗？',
    confirmText: '退出',
    confirmColor: '#E5484D',
    success: r => {
      if (!r.confirm) return
      logout()  // clearToken + 同步响应式镜像
      Taro.showToast({ title: '已退出登录', icon: 'none' })
      setTimeout(() => Taro.reLaunch({ url: '/pages/login/login' }), 600)
    }
  })
}
</script>

<style>
/* 页面底色：极浅冷灰，顶部带一点极淡的冷绿晕（简约高级感） */
.wrap {
  min-height: 100vh; box-sizing: border-box;
  background: linear-gradient(180deg, #EFF6F1 0%, #F5F7F8 26%, #F5F7F8 100%);
  padding: 60rpx 32rpx calc(240rpx + env(safe-area-inset-bottom));
}

/* ---------- 头部：居中头像 + 昵称 + slogan ---------- */
/* 顶部渐变区：设计稿整块渐变色 #C9D3D0——浅灰绿，自上而下渐隐到页面底色（全幅出血：负 margin 抵消 wrap 内边距） */
.hero-zone {
  margin: -60rpx -32rpx 0;
  padding: 60rpx 32rpx 40rpx;
  background: linear-gradient(180deg, rgba(201, 211, 208, 0.55) 0%, rgba(201, 211, 208, 0.30) 55%, rgba(201, 211, 208, 0) 100%);
}
.hero { display: flex; flex-direction: column; align-items: center; padding: 24rpx 0 8rpx; }
.avatar-box { position: relative; width: 160rpx; height: 160rpx; }
.avatar {
  width: 160rpx; height: 160rpx; border-radius: 50%;
  background: #E7F0EA; border: 6rpx solid #FFFFFF;
  color: #7A8B80; font-size: 60rpx; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8rpx 24rpx rgba(31, 45, 37, 0.10);
}
.avatar-img {
  width: 160rpx; height: 160rpx; border-radius: 50%;
  border: 6rpx solid #FFFFFF;
  box-shadow: 0 8rpx 24rpx rgba(31, 45, 37, 0.10);
}
/* 深色相机角标（设计稿）：右下小圆，白相机 */
.avatar-edit {
  position: absolute; right: 2rpx; bottom: 2rpx;
  width: 48rpx; height: 48rpx; border-radius: 50%;
  background: #39423C; border: 4rpx solid #FFFFFF;
  display: flex; align-items: center; justify-content: center;
}
.ae-ico { width: 24rpx; height: 24rpx; }
.u-name { margin-top: 28rpx; font-size: 40rpx; font-weight: 600; color: #2B312D; }
.u-slogan { margin-top: 14rpx; font-size: 24rpx; color: #9AA3A0; text-align: center; line-height: 1.7; padding: 0 60rpx; }

/* ---------- 统计卡：三栏 + 细分隔线 ---------- */
.stats-card {
  display: flex; align-items: center;
  background: transparent;   /* 卡片背景透明，融入页面底色 */
  padding: 36rpx 0; margin-top: 40rpx;
}
.stat { flex: 1; display: flex; flex-direction: column; align-items: center; }
.stat-num { font-size: 44rpx; font-weight: 700; color: #2B312D; line-height: 1.1; }
.stat-label { font-size: 22rpx; color: #9AA3A0; margin-top: 10rpx; }
.stat-div { width: 2rpx; height: 60rpx; background: #D7DDDA; }   /* 参考图样式：透明卡上要能看见的中灰竖线 */

/* ---------- 分组标题 ---------- */
.sec-label { font-size: 24rpx; color: #9AA3A0; margin: 40rpx 8rpx 20rpx; }

/* ---------- 功能格卡片：彩色圆角图标块 ---------- */
.menu-card {
  background: #FFFFFF; border-radius: 64rpx; overflow: hidden;   /* 设计稿 32px（375 稿）= 64rpx */
  box-shadow: 0 6rpx 24rpx rgba(31, 45, 37, 0.04);
}
.cell { display: flex; align-items: center; padding: 30rpx 28rpx; border-bottom: 1rpx solid #F2F4F3; }
.cell:last-child { border-bottom: none; }
.tile { width: 68rpx; height: 68rpx; border-radius: 18rpx; margin-right: 24rpx; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.tile-ico { width: 34rpx; height: 34rpx; }
.tile-warm { background: #FDEFE7; }    /* 橙 */
.tile-blue { background: #EAF1FE; }    /* 蓝 */
.tile-blue2 { background: #EAF1FE; }
.tile-purple { background: #F1EBFE; }  /* 紫 */
.tile-green { background: #E7F9EE; }   /* 绿 */
.tile-gold { background: #FBF4E4; }    /* 浅琥珀（邀请） */
/* 「分享给好友」：可见行 = 普通 .cell（与上面几行完全同源）；透明 button 覆盖层只负责接管点击、
   唤起微信转发面板（open-type=share）。真机实测给 button 套 .cell 的重置方案会输给 button
   自带样式的 width/居中（截图实锤整行缩成居中一团）→ 覆盖层用四向 inset 定位强制铺满
   （不依赖 width），opacity:0 彻底隐形，hover-class="none" 关掉按下灰底。 */
.share-cell { position: relative; }
.share-cover { position: absolute; left: 0; top: 0; right: 0; bottom: 0; width: 100%; height: 100%; opacity: 0; background: transparent; border: none; border-radius: 0; margin: 0; padding: 0; line-height: normal; }
.share-cover::after { border: none; }
.c-label { flex: 1; font-size: 30rpx; color: #2B312D; }
.c-arrow { color: #C6CCC8; font-size: 34rpx; }
.c-badge { font-size: 20rpx; color: #15803D; background: #E7F9EE; border-radius: 999rpx; padding: 4rpx 14rpx; margin-right: 12rpx; }

/* ---------- 探索者等级卡（设计稿「EXPLORER LEVEL」样式） ---------- */
/* 双类选择器提优先级：否则后面的共享 .card（28rpx）会把它盖掉（上次没生效就是这个原因） */
.card.g-card { padding: 28rpx; border-radius: 64rpx; }   /* 设计稿 32px（375 稿）= 64rpx */
.g-eyebrow { font-size: 20rpx; letter-spacing: 4rpx; color: #B0B7B3; font-weight: 600; }
.g-head2 { display: flex; align-items: center; justify-content: space-between; margin-top: 10rpx; }
.g-lv-line { display: flex; align-items: center; gap: 14rpx; min-width: 0; }
.g-lv-big { font-size: 40rpx; font-weight: 700; color: #2B312D; }
.g-title2 { font-size: 28rpx; color: #6B7280; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.g-gold { flex-shrink: 0; font-size: 18rpx; color: #B45309; background: #FDF0D5; border-radius: 999rpx; padding: 4rpx 14rpx; font-weight: 600; letter-spacing: 1rpx; }
.g-exp { flex-shrink: 0; font-size: 22rpx; color: #9AA3A0; font-family: 'DIN Alternate', sans-serif; }
.g-next { font-size: 22rpx; color: #9AA3A0; margin-top: 10rpx; }

/* 签到统计周历样式已删（2026-10-06，随模板一起下掉） */

/* ---------- 通用白卡（成长 / 微信资料 / 运营看板） ---------- */
.card {
  background: #FFFFFF; border-radius: 28rpx;
  margin-top: 24rpx; overflow: hidden;
  box-shadow: 0 6rpx 24rpx rgba(31, 45, 37, 0.04);
}

/* ---------- 退出登录：白底红字胶囊（设计稿） ---------- */
.logout-btn {
  margin-top: 32rpx; height: 96rpx; line-height: 96rpx;
  background: #FFFFFF; border-radius: 999rpx;
  text-align: center; font-size: 30rpx; color: #E5484D;
  box-shadow: 0 6rpx 24rpx rgba(31, 45, 37, 0.04);
}

.foot { text-align: center; color: #B0B7B3; font-size: 22rpx; margin-top: 44rpx; }

/* 微信资料引导卡 */
.wx-card { padding: 32rpx 28rpx; }
.wx-title { font-size: 32rpx; font-weight: 600; color: #2B312D; }
.wx-note { font-size: 24rpx; color: #9AA3A0; margin-top: 8rpx; }
.wx-row { display: flex; align-items: center; margin-top: 28rpx; }
/* button 默认样式重置：只当头像选择器用 */
.wx-avatar-btn {
  width: 120rpx; height: 120rpx; padding: 0; margin: 0;
  border-radius: 50%; overflow: hidden;
  background: #E7F9EE; border: 2rpx dashed #22C55E;
  display: flex; align-items: center; justify-content: center;
  line-height: 1;
}
.wx-avatar-btn::after { border: none; }
.wx-avatar-preview { width: 120rpx; height: 120rpx; }
.wx-avatar-ph { font-size: 24rpx; color: #22C55E; }
.wx-name-input {
  flex: 1; margin-left: 24rpx;
  height: 88rpx; padding: 0 24rpx;
  background: #F5F7F8; border-radius: 16rpx;
  font-size: 30rpx; color: #2B312D;
}
.wx-save {
  margin-top: 28rpx; height: 84rpx; line-height: 84rpx;
  background: #22C55E; color: #FFFFFF;
  border-radius: 999rpx; text-align: center; font-size: 30rpx;
}

/* ---------- 成长卡（7.7 增长运营）：头部样式见上方「探索者等级卡」，此处仅留进度条 ---------- */
.g-progress { height: 12rpx; background: #EEF2F1; border-radius: 999rpx; margin-top: 16rpx; overflow: hidden; }
.g-bar { height: 100%; background: linear-gradient(90deg, #4ADE80, #22C55E); border-radius: 999rpx; transition: width 0.4s; }

/* 主操作行：签到居左，明细/成就/报告靠右成组 */
.g-actions {
  display: flex; align-items: center; justify-content: space-between;
  margin-top: 28rpx; padding-top: 24rpx; border-top: 1rpx solid #F2F4F3;
}
.g-sign {
  padding: 14rpx 36rpx; border-radius: 999rpx;
  background: #22C55E; color: #FFFFFF; font-size: 28rpx; font-weight: 600;
}
.g-sign.done { background: #E7F9EE; color: #9AA3A0; font-weight: 400; }
.g-links { display: flex; align-items: center; gap: 32rpx; }
.g-link { display: inline-flex; align-items: center; gap: 6rpx; font-size: 26rpx; color: #22C55E; }
.g-link:active { opacity: 0.7; }

/* 权益区：小标题 + 胶囊列表，独立成节 */
.g-benefits { margin-top: 24rpx; padding-top: 22rpx; border-top: 1rpx solid #F2F4F3; }
.g-bf-head { font-size: 22rpx; color: #9AA3A0; margin-bottom: 14rpx; }
.g-bf-list { display: flex; flex-wrap: wrap; gap: 12rpx; }
.g-bf { font-size: 22rpx; color: #15803D; background: #E7F9EE; border-radius: 999rpx; padding: 6rpx 18rpx; }
.g-panel { margin-top: 24rpx; border-top: 1rpx solid #F2F4F3; padding-top: 8rpx; }
.g-row { display: flex; align-items: center; padding: 18rpx 0; border-bottom: 1rpx solid #F5F7F6; }
.g-row:last-of-type { border-bottom: none; }
.g-remark { flex: 1; font-size: 26rpx; color: #2B312D; }
.g-date { font-size: 22rpx; color: #9AA3A0; margin-right: 20rpx; }
.g-delta { font-size: 28rpx; font-weight: 600; color: #22C55E; min-width: 70rpx; text-align: right; }
.g-delta.neg { color: #E5484D; }
.g-empty { text-align: center; color: #9AA3A0; font-size: 24rpx; padding: 24rpx 0; }
.g-empty-act { color: #22C55E; }  /* 加载失败可点重试：绿色示意可点 */
.g-invite { justify-content: center; margin-top: 24rpx; padding-top: 20rpx; border-top: 1rpx solid #F2F4F3; }
/* 邀请行文字单独包一层：允许换行（之前整行 nowrap 溢出屏幕被截断） */
.g-invite-txt { flex: 1; font-size: 22rpx; color: #9AA3A0; line-height: 1.6; }

/* 邀请小程序码浮层样式已随功能撤除（2026-10-08） */

/* AI 旅行报告面板 */
.g-rp-date { font-size: 22rpx; color: #22C55E; padding: 16rpx 0 8rpx; }
.g-rp-text { font-size: 26rpx; color: #2B312D; line-height: 1.8; padding: 8rpx 0 16rpx; }

/* 运营数据看板卡（仅管理员） */
.adm-warm { margin-top: 20rpx; text-align: center; font-size: 24rpx; color: #15803D; background: #E7F9EE; border-radius: 999rpx; padding: 16rpx 0; }
.adm-warm.disabled { opacity: 0.6; }
/* 意见反馈列表（运营看板内） */
.adm-fb { padding: 20rpx 0; border-bottom: 1rpx solid #F5F7F6; }
.adm-fb:last-of-type { border-bottom: none; }
.adm-fb-head { display: flex; align-items: center; }
.adm-fb-contact { flex: 1; font-size: 24rpx; font-weight: 600; color: #2B312D; }
.adm-fb-time { font-size: 20rpx; color: #9AA3A0; }
/* 删除钮：贴在时间右侧（点击区域放大些，防误触） */
.adm-fb-del { margin-left: 20rpx; padding: 4rpx 10rpx; font-size: 22rpx; color: #E5484D; }
.adm-fb-content { font-size: 24rpx; color: #4B534E; line-height: 1.6; margin-top: 8rpx; }
.adm-fb-imgs { display: flex; flex-wrap: wrap; gap: 12rpx; margin-top: 12rpx; }
.adm-fb-img { width: 120rpx; height: 120rpx; border-radius: 12rpx; }
.adm-title { font-size: 30rpx; font-weight: 600; color: #15803D; margin-bottom: 20rpx; }
.adm-grid { display: flex; flex-wrap: wrap; }
.adm-item { width: 50%; display: flex; flex-direction: column; align-items: center; padding: 20rpx 0; }
.adm-num { font-size: 40rpx; font-weight: 700; color: #22C55E; }
.adm-label { font-size: 22rpx; color: #9AA3A0; margin-top: 6rpx; }
.adm-sub { font-size: 26rpx; font-weight: 600; color: #2B312D; margin: 16rpx 0 8rpx; }
.adm-city { display: flex; align-items: center; padding: 16rpx 0; border-bottom: 1rpx solid #F5F7F6; }
.adm-city:last-of-type { border-bottom: none; }
.adm-rank { width: 44rpx; height: 44rpx; line-height: 44rpx; text-align: center; border-radius: 50%; background: #E7F9EE; color: #22C55E; font-size: 24rpx; font-weight: 600; margin-right: 20rpx; }
.adm-rank.top { background: #F29979; color: #FFFFFF; }   /* 前三名橙色高亮 */
.adm-city-name { flex: 1; font-size: 28rpx; color: #2B312D; }
.adm-cnt { font-size: 24rpx; color: #9AA3A0; }

/* 图标尺寸（profile） */
.gs-ico { width: 26rpx; height: 26rpx; margin-right: 4rpx; vertical-align: -4rpx; }
.g-link, .g-rp-date, .g-invite, .adm-title, .adm-sub { display: flex; align-items: center; }
.gl-ico { width: 26rpx; height: 26rpx; margin-right: 6rpx; }
</style>
