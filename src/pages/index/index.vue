<template>
  <view class="fm-shell">
    <!-- 表单区：放进 scroll-view 独立滚动，底栏不悬浮，内容永远不会滑到底栏下面
         （input 是原生组件层级最高，普通 view 盖不住，只能靠布局隔离）
         pageReady 前 不渲染：新页面 webview 会在转场动画期间就开始首帧渲染，
         重滚动区（原生组件多）渲染慢、轻量底栏先画出来 → 出现「底栏先跳出来」。
         等 onReady（转场结束）再整页一起淡入，保证同步出现。 -->
    <scroll-view class="fm-scroll fm-in" :scroll-y="true" v-if="pageReady && !genVisible">
      <view class="fm-wrap">
    <!-- 卡片1：基本信息 + 人数 -->
    <view class="fm-card">
      <view class="fm-sec">
        <image class="fm-sec-ico" :src="ICO.clock" mode="aspectFit" />
        <view class="fm-sec-title">基本信息</view>
        <text class="fm-req">*</text>
      </view>

      <view class="fm-row">
        <text class="fm-row-label">目的地城市</text>
        <!-- 省市两级选择器（自定义数据，src/utils/region.js）：只有省/市两列，不再出现区一列 -->
        <picker mode="multiSelector" :range="regionRange" :value="regionIdx" @columnchange="onRegionColumn" @change="onRegionChange">
          <view class="fm-row-picker">
            <text :class="form.destinationCity ? 'fm-row-value' : 'fm-row-value placeholder'">{{ form.destinationCity || '请选择城市' }}</text>
            <text class="fm-chev">›</text>
          </view>
        </picker>
      </view>

      <!-- 热门景点推荐：固定展示；输完城市自动拉取，勾选的 AI 优先安排（GET /api/attractions/popular） -->
      <view class="pop-sec">
        <view class="pop-head">
          <view class="pop-title"><image class="pop-flame" :src="ICO.flame" mode="aspectFit" /><text>热门景点推荐</text><text class="pop-city" v-if="popularCity"> · {{ popularCity }}</text></view>
          <text class="pop-hint" v-if="popular.length && pickedPopular.length">已选 {{ pickedPopular.length }}</text>
          <text class="pop-hint" v-else-if="popular.length">勾选后 AI 优先安排</text>
        </view>
        <!-- 拉取中 -->
        <view class="pop-state" v-if="popularLoading">正在获取{{ form.destinationCity.trim() || '目的地' }}的热门景点…</view>
        <!-- 有数据：横向滑动卡片 -->
        <scroll-view class="pop-scroll" v-else-if="popular.length" :scroll-x="true">
          <view class="pop-card" v-for="p in popular" :key="p.name"
            :class="{ on: pickedPopular.indexOf(p.name) >= 0 }" @tap="togglePopular(p)">
            <image class="pop-img" :src="p.imageUrl" mode="aspectFill" />
            <view class="pop-check" v-if="pickedPopular.indexOf(p.name) >= 0"><image class="pop-check-ico" :src="ICO.check" mode="aspectFit" /></view>
            <view class="pop-name">{{ p.name }}</view>
            <view class="pop-desc">{{ p.description }}</view>
          </view>
        </scroll-view>
        <!-- 无数据：引导输入 / 城市未预置 -->
        <view class="pop-state dim" v-else-if="form.destinationCity.trim()">
          {{ popularTried }}「{{ form.destinationCity.trim() }}」暂无预置的热门景点，AI 会自行安排；也可以换一个城市试试
        </view>
        <view class="pop-state dim" v-else>填写目的地城市后，这里会显示该市的热门景点，勾选后 AI 优先安排</view>
      </view>

      <view class="fm-row">
        <text class="fm-row-label">开始日期</text>
        <picker mode="date" :value="form.startDate" :start="today" @change="onStartDate">
          <view class="fm-row-value" :class="{ placeholder: !form.startDate }">
            {{ form.startDate || '请选择' }} <text class="fm-chev">›</text>
          </view>
        </picker>
      </view>

      <view class="fm-row last">
        <text class="fm-row-label">结束日期</text>
        <picker mode="date" :value="form.endDate" :start="form.startDate || today" @change="onEndDate">
          <view class="fm-row-value" :class="{ placeholder: !form.endDate }">
            {{ form.endDate || '请选择' }} <text class="fm-chev">›</text>
          </view>
        </picker>
      </view>

      <view class="fm-sec gap">
        <image class="fm-sec-ico" :src="ICO.users" mode="aspectFit" />
        <view class="fm-sec-title">人数</view>
        <text class="fm-req">*</text>
      </view>
      <view class="fm-row last">
        <text class="fm-row-label">总人数</text>
        <view class="fm-stepper">
          <text class="fm-step-btn" @tap="stepTotal(-1)">−</text>
          <text class="fm-step-num">{{ totalTravelers }}</text>
          <text class="fm-step-btn plus" @tap="stepTotal(1)">＋</text>
        </view>
      </view>
    </view>

    <!-- 卡片2：总预算（填写式，选填） -->
    <view class="fm-card">
      <view class="fm-sec">
        <image class="fm-sec-ico" :src="ICO.wallet" mode="aspectFit" />
        <view class="fm-sec-title">总预算</view>
      </view>
      <view class="fm-budget-input-row">
        <text class="fm-budget-yen">¥</text>
        <input class="fm-budget-input" type="digit" v-model="budgetInput"
          placeholder="请输入总预算（选填）" />
        <text class="fm-budget-unit">元</text>
      </view>
      <view class="fm-budget-tip">含住宿/餐饮/门票/市内交通，不含往返大交通</view>
    </view>

    <!-- 卡片3：偏好设置 -->
    <view class="fm-card">
      <view class="fm-sec">
        <image class="fm-sec-ico" :src="ICO.sliders" mode="aspectFit" />
        <view class="fm-sec-title">偏好设置</view>
      </view>

      <view class="fm-sub">兴趣</view>
      <view class="fm-tags">
        <text class="fm-tag" v-for="p in PREF_OPTIONS" :key="p.value" @tap="togglePref(p.value)"
          :class="{ active: form.preferences.indexOf(p.value) >= 0 }">{{ p.label }}</text>
      </view>

      <view class="fm-sub">体力 <text class="fm-req">*</text></view>
      <view class="fm-tags">
        <text class="fm-tag" v-for="e in ENERGY_OPTIONS" :key="e.value" @tap="form.energyLevel = e.value"
          :class="{ active: form.energyLevel === e.value }">{{ e.label }}</text>
      </view>

      <view class="fm-sub">交通方式 <text class="fm-req">*</text></view>
      <view class="fm-tags">
        <text class="fm-tag" v-for="t in TRANSPORT_OPTIONS" :key="t.value" @tap="toggleTransport(t.value)"
          :class="{ active: form.transportModes.indexOf(t.value) >= 0 }">{{ t.label }}</text>
      </view>
    </view>

    <!-- 卡片4：更多需求 -->
    <view class="fm-card">
      <view class="fm-sec">
        <image class="fm-sec-ico" :src="ICO.pen" mode="aspectFit" />
        <view class="fm-sec-title">更多需求</view>
      </view>
      <textarea class="fm-textarea tall" v-model="form.extraRequirements" maxlength="1000"
        placeholder="请写下您的更多需求" />
      <view class="fm-count">{{ (form.extraRequirements || '').length }}/1000</view>
    </view>
      </view>
    </scroll-view>

    <!-- 底部操作栏：重置 + 确定（不悬浮，位于滚动区外；与表单区同帧淡入） -->
    <view class="fm-footer fm-in" v-if="pageReady && !genVisible">
      <view class="fm-footer-btn reset" @tap="reset">重置</view>
      <view class="fm-footer-btn ok" @tap="submit" :class="{ disabled: submitting }">
        {{ submitting ? '创建中…' : '确定' }}
      </view>
    </view>

    <!-- 生成中面板：步骤实时上屏，token 流只用于解析结构化进度（原始 JSON 不上屏） -->
    <view class="gen-mask fm-in" v-if="genVisible">
      <view class="gen-panel">
        <view class="gen-title">AI 正在生成你的攻略</view>
        <view class="gen-step" v-if="genStep">
          <view class="gen-dot"></view>
          <text>{{ genStep }}</text>
        </view>
        <!-- 正文只显示从流里解析出的结构化进度，不暴露原始 JSON（2026-10-01 用户要求） -->
        <view class="gen-stream">
          <!-- 事件状态行（浅绿小字） -->
          <view class="gen-event" v-for="ev in genEvents" :key="ev.type">{{ ev.text }}</view>
          <view class="gen-line" v-for="(line, i) in genDigest" :key="i">{{ line }}</view>
          <!-- 还没解析出字段时：三点呼吸占位，避免正文框空着 -->
          <view class="gen-wait" v-if="!genDigest.length">
            <text class="gen-wait-dot" v-for="n in 3" :key="n" :style="'animation-delay:' + ((n - 1) * 0.18) + 's'"></text>
          </view>
          <text class="gen-cursor" v-if="genDigest.length">▌</text>
        </view>
        <view class="gen-hint">{{ genMode === 'stream' ? '实时生成中，请勿退出…' : '普通模式生成中，约需 1–2 分钟…' }}</view>
      </view>
    </view>

    <AuthMask />
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import Taro, { useReady } from '@tarojs/taro'
import api from '../../services/api'
import clockG from '../../assets/icons/clock-green.png'
import usersG from '../../assets/icons/users-green.png'
import walletG from '../../assets/icons/wallet-green.png'
import slidersG from '../../assets/icons/sliders-green.png'
import penG from '../../assets/icons/pen-line-green.png'
import flameW from '../../assets/icons/flame-warm.png'
import checkW from '../../assets/icons/check-white.png'

const ICO = { clock: clockG, users: usersG, wallet: walletG, sliders: slidersG, pen: penG, flame: flameW, check: checkW }
import CONFIG from '../../utils/config'
import { REGION } from '../../utils/region'
import { requireLogin } from '../../utils/auth'
import { requestTripSubscribe } from '../../utils/subscribe'
import AuthMask from '../../components/AuthMask.vue'

// ---------- 转场防闪 ----------
// navigateTo 转场期间新页面就开始首帧渲染：重内容区（原生组件多）慢、
// 轻量底栏先上屏 → 用户看到「底栏先跳出来，整页再进来」。
// 等 onReady（路由转场完成）后再渲染内容，整页同帧淡入。
const pageReady = ref(false)
useReady(() => { pageReady.value = true })

const PREF_OPTIONS = [
  { value: 'nature', label: '自然' }, { value: 'culture', label: '人文' },
  { value: 'food', label: '美食' }, { value: 'photography', label: '网红' },
  { value: 'shopping', label: '购物' }, { value: 'family', label: '亲子' },
  { value: 'nightlife', label: '夜游' }, { value: 'relaxation', label: '休闲' },
  { value: 'theme_park', label: '主题乐园' }
]
const ENERGY_OPTIONS = [
  { value: 'easy', label: '轻松' }, { value: 'medium', label: '适中' }, { value: 'hard', label: '充沛' }
]
const TRANSPORT_OPTIONS = [
  { value: 'walking', label: '步行' }, { value: 'transit', label: '公交' },
  { value: 'taxi', label: '打车' }, { value: 'driving', label: '自驾' }, { value: 'cycling', label: '骑行' }
]

const today = new Date().toISOString().slice(0, 10)
const emptyForm = () => ({
  destinationCity: '',
  startDate: '',
  endDate: '',
  travelers: { adults: 2, children: 0, seniors: 0 },
  preferences: [],
  energyLevel: 'medium',
  transportModes: ['transit', 'walking'],
  extraRequirements: ''
})
const form = ref(emptyForm())
const budgetInput = ref('')

// ---------- 城市热门景点（GET /api/attractions/popular，勾选后随生成请求带给 AI）----------
const popular = ref([])
const popularCity = ref('')      // 当前已加载列表对应的城市（与输入框比对，防串城）
const popularLoading = ref(false)
const pickedPopular = ref([])    // 勾选的景点名数组 → payload.selectedAttractions
const popularTried = ref('')     // 最近一次拉取的城市（无数据提示用）

function loadPopular(city) {
  if (!city) { popular.value = []; popularCity.value = ''; popularTried.value = ''; return }
  popularTried.value = city
  popularLoading.value = true
  api.attractions.popular(city).then(list => {
    popular.value = Array.isArray(list) ? list : []
    popularCity.value = city
    pickedPopular.value = []     // 换城后清空勾选，避免把 A 城景点带给 B 城
  }).catch(() => {
    popular.value = []           // 拉不到（后端没数据/非预置城市）静默隐藏，不打扰填表
    popularCity.value = ''
  }).finally(() => { popularLoading.value = false })
}

// 首页「热门景点推荐」/「路线规划」入口：?city=北京 直接预填目的地并拉该城热门景点。
// 🔴 必须放在 loadPopular 与上面那些 ref 之后：函数声明会提升，但 ref 的赋值不会——
//    原先写在 form 旁边（ref 之前）时 city 一带就 `xxx.value = ...` 撞 undefined 直接白屏（2026-10-05 修）。
{
  const raw = Taro.getCurrentInstance().router.params.city
  if (raw) {
    let prefill = raw
    try { prefill = decodeURIComponent(raw) } catch (e) { /* 已是明文（含 % 的怪名字）→ 原样用，绝不因解码抛错白屏 */ }
    form.value.destinationCity = prefill
    loadPopular(prefill.trim())
  }
}
// 省市两级选择器（2026-10-03 由内置 mode="region" 三级改来：不出现区一列）
// 数据在 src/utils/region.js（[省, [市...]]）；选中后仍只存城市，去「市」后缀与全站口径一致（北京市 → 北京），
// 直辖市选项即省名本身（北京市 → 北京），自治州等无「市」后缀的原样保留（大理白族自治州）
const regionProvinces = REGION.map(p => p[0])
const regionIdx = ref([0, 0])
const regionRange = computed(() => {
  const pi = regionIdx.value[0] || 0
  return [regionProvinces, (REGION[pi] && REGION[pi][1]) || []]
})
// 滑动省列时联动换市列（列索引 0=省 1=市），市列复位到第一项
function onRegionColumn(e) {
  if (!e || !e.detail || e.detail.column !== 0) return
  regionIdx.value = [e.detail.value, 0]
}
function onRegionChange(e) {
  const v = (e && e.detail && e.detail.value) || [0, 0]
  regionIdx.value = v
  const prov = regionProvinces[v[0]] || ''
  let city = (REGION[v[0]] && REGION[v[0]][1][v[1]]) || ''
  if (city.endsWith('市')) city = city.slice(0, -1)   // 北京市/杭州市 → 北京/杭州
  if (!city || city === form.value.destinationCity) return
  form.value.destinationCity = city
  loadPopular(city)          // 选完城市立刻拉热门景点
}
function togglePopular(p) {
  const i = pickedPopular.value.indexOf(p.name)
  if (i >= 0) pickedPopular.value.splice(i, 1)
  else pickedPopular.value.push(p.name)
}
const submitting = ref(false)

// ---------- 生成中面板状态 ----------
const genVisible = ref(false)   // 面板开关（同时隐藏表单滚区，防原生 textarea 穿透遮罩）
const genStep = ref('')         // 最近一条 step 事件（进度文案）
const genStream = ref('')       // token 事件累计文本（AI 正在写的攻略）
const genMode = ref('stream')   // stream=流式（逐字上屏） / sync=同步兜底（只有转圈提示）
const genSearch = ref('')       // （保留兼容）search 事件摘要
const genEvents = ref([])       // 流式状态行 [{ type, text }]：search/knowledge/agent/未知事件，同类覆盖

// 同类事件只保留最新一条：面板最多几行，不随事件数量膨胀
function pushGenEvent(type, text) {
  const list = genEvents.value.filter(e => e.type !== type)
  list.push({ type, text })
  genEvents.value = list
}

// 事件 → 状态行文案：data 形如 { source, content } 或纯字符串（全文展示，不截断）
// 已知工具名 → 人话（后端 Agent 会把工具调用原文推过来，如 get_weather：{...}，
// 原样上屏是一坨 JSON，既难看又像出了错 → 翻成一句进度文案）。表外工具退化为「调用 xxx」。
const TOOL_LABELS = {
  get_weather: '查询天气',
  get_attractions: '查询景点',
  search_attractions: '搜索景点',
  get_route: '规划路线',
  search_web: '联网搜索'
}

// 从原始串里抠城市（只认 JSON 的 "city" 字段，抓不到就不带，不硬猜）
function pickCity(raw) {
  const m = /"city"\s*:\s*"([^"]{1,20})"/.exec(raw || '')
  return m ? m[1] : ''
}

// 识别「工具名：{JSON} / [JSON]」形态的原始工具调用报文 → 返回人话文案；不是工具调用返回 null
function toolCallOf(text) {
  const m = /^([A-Za-z][\w-]*)\s*[：:]\s*[\[{]/.exec((text || '').trim())
  if (!m) return null
  const label = TOOL_LABELS[m[1]] || '调用 ' + m[1]
  const city = pickCity(text)
  return city ? `${label} · ${city}` : label
}

function eventLine(type, icon, fallback, val) {
  const src = (val && (val.source || val.title)) || fallback
  let txt = (val && (val.content || val.summary || val.data)) || (typeof val === 'string' ? val : '')
  // ① 工具调用报文（无论 source 还是 content 里带的）→ 直接翻译成人话，不显示 JSON
  const tool = toolCallOf(typeof val === 'string' ? val : (src + '：' + txt))
  if (tool) return tool
  // ② 内容本身是裸 JSON/超长串 → 不倾倒原文，只留标题（截断防状态行被撑爆）
  if (typeof txt === 'string' && /^\s*[\[{]/.test(txt)) txt = ''
  if (typeof txt === 'string' && txt.length > 80) txt = txt.slice(0, 80) + '…'
  return txt ? `${icon} ${src}：${txt}` : `${icon} ${src}`
}

// 正则批量取值（不用 matchAll：老基础库不支持 ES2020，会直接报错白屏）
function grabAll(s, re) {
  const out = []
  let m
  while ((m = re.exec(s)) !== null) {
    out.push(m[1])
    if (m.index === re.lastIndex) re.lastIndex++   // 零宽匹配保护，防死循环
  }
  return out
}

// 生成面板正文：token 流是攻略 JSON，只抽结构化进度上屏，绝不显示原始 JSON。
// 解析到多少显示多少（字段没闭合就不会命中），解析不出任何字段时前端用三点占位。
const genDigest = computed(() => {
  const s = genStream.value
  if (!s) return []
  // sources 段之后的 title 是参考来源标题，不是每日行程标题 → 截掉再解析
  const cut = s.indexOf('"sources"')
  const body = cut > 0 ? s.slice(0, cut) : s

  const out = []
  const city = /"city"\s*:\s*"([^"]*)"/.exec(body)
  if (city && city[1]) out.push(`目的地 · ${city[1]}`)
  const dayCount = grabAll(body, /"day"\s*:\s*\d+/g).length
  if (dayCount) out.push(`已规划 ${dayCount} 天行程`)
  const titles = grabAll(body, /"title"\s*:\s*"([^"]*)"/g)
  if (titles.length) out.push(`第 ${titles.length} 天 · ${titles[titles.length - 1]}`)
  const names = grabAll(body, /"name"\s*:\s*"([^"]*)"/g)
  if (names.length) out.push(`已收录 ${names.length} 个地点 · ${names[names.length - 1]}`)
  return out
})

const totalTravelers = computed(() => {
  const t = form.value.travelers
  return t.adults + t.children + t.seniors
})

// 进页不再弹登录（2026-10-09 微信审核整改）：表单随便填，只有「点生成」时才要登录。
// 见 submit() 里的 requireLogin(doCreate)——功能级拦截，可选「暂不登录」退回表单。

// ---------- 日期工具（手动拼接避免 toISOString 的 UTC 偏移坑） ----------
function parseDate(s) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function diffDays(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000) + 1
}

// ---------- 表单交互 ----------
function onStartDate(e) {
  form.value.startDate = e.detail.value
  // 开始日期晚于结束日期时，结束日期自动顺延对齐
  if (form.value.endDate && form.value.endDate < form.value.startDate) {
    form.value.endDate = form.value.startDate
  }
}
function onEndDate(e) { form.value.endDate = e.detail.value }
function stepTotal(d) {
  const v = totalTravelers.value + d
  if (v >= 1 && v <= 20) form.value.travelers = { adults: v, children: 0, seniors: 0 }
}
function togglePref(v) {
  const arr = form.value.preferences
  const i = arr.indexOf(v)
  i >= 0 ? arr.splice(i, 1) : arr.push(v)
}
function toggleTransport(v) {
  const arr = form.value.transportModes
  const i = arr.indexOf(v)
  i >= 0 ? arr.splice(i, 1) : arr.push(v)
}
function reset() {
  form.value = emptyForm()
  budgetInput.value = ''
  regionIdx.value = [0, 0]   // 省市选择器归位（北京/北京市）
}

// ---------- 目的地预校验 ----------
// 后端会拦「非中国境内城市」并返回 400「目的地仅支持中国境内城市」；
// 本地先按「纯中文城市名 + 不含境外国家/城市关键词」挡一层，避免提交后才失败
const CN_CITY_RE = /^[\u4e00-\u9fa5·\-]{2,15}$/
const OVERSEAS_RE = /(日本|韩国|朝鲜|蒙古|越南|泰国|老挝|柬埔寨|缅甸|马来西亚|新加坡|印度尼西亚|印尼|菲律宾|文莱|印度|巴基斯坦|孟加拉|斯里兰卡|尼泊尔|不丹|马尔代夫|哈萨克|乌兹别克|阿富汗|伊朗|伊拉克|叙利亚|以色列|约旦|沙特|阿联酋|迪拜|卡塔尔|科威特|土耳其|美国|加拿大|墨西哥|古巴|巴西|阿根廷|智利|秘鲁|哥伦比亚|委内瑞拉|英国|爱尔兰|法国|德国|意大利|西班牙|葡萄牙|荷兰|比利时|卢森堡|瑞士|奥地利|希腊|波兰|捷克|匈牙利|罗马尼亚|保加利亚|塞尔维亚|克罗地亚|丹麦|瑞典|挪威|芬兰|冰岛|乌克兰|白俄罗斯|俄罗斯|摩纳哥|梵蒂冈|马耳他|埃及|摩洛哥|突尼斯|阿尔及利亚|肯尼亚|坦桑尼亚|南非|尼日利亚|加纳|澳大利亚|新西兰|斐济|欧洲|亚洲|非洲|美洲|大洋洲|境外|国外|出国)/
const OVERSEAS_CITY_RE = /(东京|大阪|京都|北海道|冲绳|首尔|釜山|济州|曼谷|清迈|普吉|芭堤雅|巴厘|雅加达|马尼拉|河内|胡志明|吉隆坡|槟城|新德里|孟买|莫斯科|圣彼得堡|巴黎|伦敦|罗马|米兰|威尼斯|佛罗伦萨|巴塞罗那|马德里|柏林|慕尼黑|法兰克福|阿姆斯特丹|布鲁塞尔|苏黎世|日内瓦|维也纳|布拉格|布达佩斯|雅典|伊斯坦布尔|开罗|开普敦|纽约|洛杉矶|旧金山|西雅图|波士顿|芝加哥|华盛顿|拉斯维加斯|夏威夷|多伦多|温哥华|悉尼|墨尔本|布里斯班|奥克兰|里约|圣保罗)/
// 港澳台是中国境内，放行（中国香港/中国澳门/中国台湾）
function isCnCity(name) {
  const n = String(name || '').trim()
  if (!CN_CITY_RE.test(n)) return false              // 纯英文/带数字/中英混写等直接挡
  if (OVERSEAS_RE.test(n) || OVERSEAS_CITY_RE.test(n)) return false
  return true
}

// ---------- 校验（口径与后端一致，前端先挡一层） ----------
function validate() {
  const f = form.value
  if (!f.destinationCity.trim()) return '请填写目的地城市'
  if (!isCnCity(f.destinationCity)) return '目的地仅支持中国境内城市'
  if (!f.startDate) return '请选择开始日期'
  if (f.startDate < today) return '开始日期不能早于今天'
  if (!f.endDate) return '请选择结束日期'
  const days = diffDays(f.startDate, f.endDate)
  if (days < 1 || days > 15) return '行程天数须为 1–15 天'
  const total = totalTravelers.value
  if (total < 1 || total > 20) return '人数须为 1–20 人'
  if (!f.transportModes.length) return '至少选择一种交通方式'
  return ''
}

// ---------- 提交：创建异步任务 → 跳生成页（未登录先弹授权） ----------
function submit() {
  const err = validate()
  if (err) { Taro.showToast({ title: err, icon: 'none' }); return }
  if (submitting.value) return
  // 功能级登录拦截（2026-10-09）：游客可以随便填表单、看示例，点「生成」才要登录。
  // 顺序：先登录 → 再订阅 → 再生成。登录成功时 requireLogin 会**同步**回调，
  // 所以订阅授权仍在本次点击手势内触发（微信要求 requestSubscribeMessage 同步调）。
  requireLogin(() => {
    // 订阅授权：必须在点击事件里同步调用（微信限制，异步回调里调会 fail），
    // 且要在调生成接口之前弹 —— 额度是给这次生成的行程在开始当天用的。
    // 不 await、不看结果：accept / reject / 失败都不阻断生成（详见 utils/subscribe.js）
    requestTripSubscribe()
    doCreate()
  }, { tip: '生成行程攻略需要登录（生成结果会保存到你的账号，随时可删）' })
}

function doCreate() {
  submitting.value = true
  // 打开生成面板（替代原来的 showLoading 转圈）：流式 token 逐字上屏
  genStep.value = ''
  genStream.value = ''
  genSearch.value = ''
  genEvents.value = []
  genMode.value = 'stream'
  genVisible.value = true
  const f = form.value
  const days = diffDays(f.startDate, f.endDate)
  // 新契约（攻略模块 2026-09-19）：city/peopleCount/budget(字符串)/transportation
  const payload = {
    city: f.destinationCity.trim(),
    days,
    peopleCount: totalTravelers.value,
    preferences: f.preferences,
    energyLevel: f.energyLevel,
    transportation: f.transportModes
  }
  if (f.startDate) payload.startDate = f.startDate
  // 可选字段不传空值（后端约定：未填写直接省略）；budget 是自由文本字符串
  const budget = parseFloat(budgetInput.value)
  if (budget > 0) payload.budget = String(budget)
  if (f.extraRequirements.trim()) payload.extraRequirements = f.extraRequirements.trim()
  // 勾选的热门景点：AI 优先安排（后端 9-26 预置数据接口的配套约定）
  if (pickedPopular.value.length) payload.selectedAttractions = pickedPopular.value.slice()

  // token 按 80ms 批量刷进缓冲：一个 token 刷一次 setData，几千次会把页面卡死。
  // 缓冲只喂给 genDigest 解析结构化进度，原始 JSON 不再上屏
  let tokenBuf = ''
  let flushTimer = null
  const flush = () => {
    if (flushTimer) { clearTimeout(flushTimer); flushTimer = null }
    if (tokenBuf) { genStream.value += tokenBuf; tokenBuf = '' }
  }
  const finishOk = tripId => { flush(); genVisible.value = false; Taro.setStorageSync('currentTripId', tripId); goItinerary(tripId) }
  // 注：流式 done 只给 tripId，完整攻略由行程详情页再调 GET /api/trip/{id} 取（联调纪要 9.2）
// 失败提示：文案多为后端原样返回（如「目的地仅支持中国境内城市」），
// 超过 10 个字的用弹窗展示，避免 toast 被截断看不全
const finishFail = e => {
  flush()
  genVisible.value = false
  const msg = (e && e.message) || '生成失败，请重试'
  if (msg.length > 10) {
    Taro.showModal({ title: '生成失败', content: msg, showCancel: false, confirmText: '知道了' })
  } else {
    Taro.showToast({ title: msg, icon: 'none' })
  }
}

  // 同步生成兜底：普通模式（转圈提示，无逐字）
  const runSync = () => {
    genMode.value = 'sync'
    genStep.value = ''
    api.trips.generate(payload)
      .then(res => finishOk(res.tripId))
      .catch(finishFail)
      .finally(() => { submitting.value = false })
  }

  // 流式开关关闭（后端断流问题未修复期间）→ 直接同步，省掉 180 秒白等
  if (!CONFIG.STREAM || !CONFIG.STREAM.generate) { runSync(); return }

  // 首选流式接口：step 刷进度行，token 逐字上屏
  let gotStreamEvent = false
  api.trips.generateStream(payload, {
    onStep: t => {
      gotStreamEvent = true
      genMode.value = 'stream'
      // step 文案也可能是「工具名：{JSON}」的原始报文 → 同样翻译成人话
      genStep.value = toolCallOf(t) || (t || '')
    },
    onToken: t => {
      gotStreamEvent = true
      genMode.value = 'stream'
      tokenBuf += t || ''
      if (!flushTimer) flushTimer = setTimeout(flush, 80)
    },
    onSearch: s => {
      gotStreamEvent = true
      pushGenEvent('search', eventLine('search', '', '联网搜索', s))
    },
    // knowledge / agent（2026-09-25 协议新增）：检索知识库 / Agent 调用进度
    onKnowledge: s => {
      gotStreamEvent = true
      pushGenEvent('knowledge', eventLine('knowledge', '', '知识库检索', s))
    },
    onAgent: s => {
      gotStreamEvent = true
      pushGenEvent('agent', eventLine('agent', '', 'Agent 调用', s))
    },
    // 兜底：后端新增的未知事件类型也显示一行（⚙ + 事件名），不认识照样可见
    onEvent: (type, val) => {
      gotStreamEvent = true
      pushGenEvent(type, eventLine(type, '', type, val))
    }
  }).then(res => {
    finishOk(res.tripId)
  }).catch(e => {
    // 三种情况回落同步生成：①一个事件都没收到（接口未上线/环境不支持）
    // ②流中途被掐（NETWORK_ERROR / STREAM_INCOMPLETE，如后端超时断流）→ 重试拿结果
    // 其余（后端明确报的业务错误）直接提示，不重复生成
    const midStreamBreak = e && (e.code === 'NETWORK_ERROR' || e.code === 'STREAM_INCOMPLETE')
    if (gotStreamEvent && !midStreamBreak) { finishFail(e); return }
    console.warn('[index] 流式未完成，回落同步生成', e.code)
    genMode.value = 'sync'
    genStep.value = ''
    api.trips.generate(payload).then(res => finishOk(res.tripId)).catch(finishFail)
  }).finally(() => {
    submitting.value = false
  })
}

// 跳转生成页：整条跳转链期间持锁防连点。
// 失败时不提前解锁（否则再点会和兜底跳转撞车，触发 routeDone webviewId 错乱）：
// 先等 400ms 重试一次 navigateTo，仍失败才用 reLaunch 兜底
let routing = false
function goItinerary(tripId) {
  if (routing) return
  routing = true
  const url = `/pages/itinerary/itinerary?tripId=${tripId}`
  const unlock = () => setTimeout(() => { routing = false }, 600)
  Taro.navigateTo({ url })
    .then(unlock)
    .catch(() => {
      setTimeout(() => {
        Taro.navigateTo({ url })
          .then(unlock)
          .catch(() => {
            Taro.reLaunch({ url })
              .then(unlock)
              .catch(() => {
                unlock()
                Taro.showToast({ title: '跳转失败，请重试', icon: 'none' })
              })
          })
      }, 400)
    })
}
</script>

<style>
/* 转场防闪：内容等 onReady 后整体淡入（表单区/底栏/生成面板共用，同帧出现） */
.fm-in { animation: fmFade 0.22s ease both; }
@keyframes fmFade { from { opacity: 0; } to { opacity: 1; } }

/* 全部类名带 fm- 前缀：小程序样式是全局的，避免和其他页面冲突 */
/* 上下结构：滚动区 + 底栏，避免 input 原生组件穿透悬浮底栏 */
.fm-shell {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: #E7F9EE;
}
/* 小程序 scroll-view 对 flex 支持不完整：必须 height:0 + flex:1 才能被 flex 撑开并获得滚动 */
.fm-scroll { flex: 1; height: 0; }
.fm-wrap {
  background: #E7F9EE;
  padding: 24rpx 24rpx 40rpx;
  box-sizing: border-box;
}
.fm-card {
  background: #ffffff;
  border-radius: 24rpx;
  padding: 28rpx 28rpx 32rpx;
  margin-bottom: 24rpx;
}
/* 分组标题：圆形图标 + 标题 + 红星 */
.fm-sec { display: flex; align-items: center; margin-bottom: 8rpx; }
.fm-sec.gap { margin-top: 32rpx; }
.fm-sec-ico {
  width: 48rpx; height: 48rpx; border-radius: 50%;
  background: #E7F9EE; padding: 12rpx; box-sizing: border-box;
  margin-right: 14rpx; flex-shrink: 0;
}
.fm-sec-title { font-size: 32rpx; font-weight: 600; color: #333333; }
.fm-req { color: #e24b4a; font-size: 30rpx; margin-left: 8rpx; }
/* 信息行：左标签 右值 */
.fm-row {
  display: flex; align-items: center; justify-content: space-between;
  padding: 26rpx 0; border-bottom: 1rpx solid #E8E8E8;
}
.fm-row.last { border-bottom: none; }
.fm-row-label { font-size: 28rpx; color: #333333; }
.fm-row-picker {
  flex: 1; display: flex; align-items: center; justify-content: flex-end; margin-right: 8rpx;
}
.fm-row-picker .fm-chev { margin-left: 4rpx; }
.fm-row-value { font-size: 28rpx; color: #333333; }
.fm-row-value.placeholder { color: #ADB5BD; }
.fm-chev { color: #ADB5BD; font-size: 30rpx; margin-left: 8rpx; }
/* 步进器（总人数） */
.fm-stepper { display: flex; align-items: center; gap: 24rpx; }
.fm-step-btn {
  width: 52rpx; height: 52rpx; line-height: 48rpx; text-align: center;
  border: 1rpx solid #E8E8E8; border-radius: 50%;
  font-size: 32rpx; color: #22C55E; background: #fff;
}
.fm-step-btn.plus { background: #22C55E; color: #fff; border-color: #22C55E; }
.fm-step-num { font-size: 30rpx; color: #333333; min-width: 60rpx; text-align: center; }
/* 预算输入 */
.fm-budget-input-row {
  display: flex; align-items: center; gap: 12rpx; margin-top: 16rpx;
  border: 1rpx solid #E8E8E8; border-radius: 12rpx;
  padding: 18rpx 24rpx; background: #fff;
  overflow: hidden; /* 原生 input 超出部分不可见，防止文字透出框外 */
}
.fm-budget-yen { font-size: 32rpx; color: #15803D; line-height: 1; }
/* 小程序原生 input 有默认高度，必须显式限高，否则文字会溢出容器 */
.fm-budget-input {
  flex: 1; font-size: 28rpx; color: #333333;
  height: 44rpx; min-height: 44rpx; line-height: 44rpx;
}
.fm-budget-unit { font-size: 26rpx; color: #868E96; line-height: 1; }
.fm-budget-tip { font-size: 22rpx; color: #ADB5BD; margin-top: 14rpx; }
/* 标签多选 */
.fm-sub { font-size: 28rpx; color: #333333; margin: 24rpx 0 16rpx; }
.fm-tags { display: flex; flex-wrap: wrap; gap: 16rpx; }
.fm-tag {
  padding: 10rpx 28rpx; border-radius: 10rpx; font-size: 26rpx;
  border: 1rpx solid #E8E8E8; color: #868E96; background: #fff;
}
.fm-tag.active {
  border-color: #22C55E; color: #15803D; background: #E7F9EE;
}
/* 文本域 */
.fm-textarea {
  width: 100%; box-sizing: border-box; min-height: 160rpx; margin-top: 16rpx;
  background: #F7F9F9; border-radius: 16rpx; padding: 20rpx 24rpx;
  font-size: 28rpx; color: #333333;
}
.fm-textarea.tall { min-height: 240rpx; background: transparent; padding: 0; }
.fm-count { text-align: right; font-size: 22rpx; color: #ADB5BD; margin-top: 12rpx; }

/* 热门景点推荐：固定区块（无数据也显示引导文案） */
.pop-sec { margin-top: 24rpx; }
.pop-title .pop-city { font-weight: 400; font-size: 24rpx; color: #22C55E; }
.pop-state { font-size: 24rpx; color: #495057; background: #F8F9FA; border-radius: 16rpx; padding: 24rpx 20rpx; line-height: 1.6; }
.pop-state.dim { color: #868E96; }

/* 城市热门景点：横向滑动卡片，勾选后 AI 优先安排 */
.pop-sec { margin-top: 24rpx; }
.pop-head { display: flex; align-items: baseline; justify-content: space-between; margin-bottom: 14rpx; }
.pop-title { display: flex; align-items: center; font-size: 28rpx; font-weight: 600; color: #333333; }
.pop-flame { width: 30rpx; height: 30rpx; margin-right: 8rpx; }
.pop-hint { font-size: 22rpx; color: #22C55E; }
.pop-scroll { white-space: nowrap; }
.pop-card { position: relative; display: inline-block; vertical-align: top; width: 240rpx; margin-right: 16rpx; border: 2rpx solid transparent; border-radius: 16rpx; background: #F8F9FA; padding-bottom: 12rpx; overflow: hidden; }
.pop-card.on { border-color: #22C55E; background: #E7F9EE; }
.pop-img { width: 100%; height: 140rpx; display: block; }
.pop-check { position: absolute; top: 8rpx; right: 8rpx; width: 36rpx; height: 36rpx; display: flex; align-items: center; justify-content: center; background: rgba(51, 51, 51, 0.35); border-radius: 50%; }
.pop-check-ico { width: 20rpx; height: 20rpx; }
.pop-card.on .pop-check { background: #22C55E; }
.pop-name { font-size: 24rpx; font-weight: 600; color: #333333; padding: 8rpx 12rpx 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.pop-desc { font-size: 20rpx; color: #868E96; padding: 4rpx 12rpx 0; white-space: normal; line-height: 1.5; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
/* 底部操作栏 */
.fm-footer {
  flex-shrink: 0; /* 固定在滚动区下方，普通流式布局，内容不会滑到它下面 */
  display: flex; gap: 24rpx;
  padding: 20rpx 40rpx calc(20rpx + env(safe-area-inset-bottom));
  background: #E7F9EE;
}
.fm-footer-btn {
  flex: 1; text-align: center; padding: 22rpx 0;
  border-radius: 44rpx; font-size: 30rpx;
}
.fm-footer-btn.reset { background: #fff; color: #333333; border: 1rpx solid #E8E8E8; }
.fm-footer-btn.ok { background: #22C55E; color: #fff; }
.fm-footer-btn.ok.disabled { opacity: 0.6; }

/* ---------- 生成中面板（流式进度 + AI 撰写逐字上屏） ---------- */
.gen-mask {
  position: fixed; left: 0; top: 0; right: 0; bottom: 0;
  background: rgba(15, 30, 27, 0.55);
  z-index: 200;
  display: flex; align-items: center; justify-content: center;
}
.gen-panel {
  width: 86%; background: #fff; border-radius: 24rpx;
  padding: 40rpx 36rpx 28rpx; box-sizing: border-box;
}
.gen-title { font-size: 34rpx; font-weight: 700; color: #333333; text-align: center; }
.gen-step {
  margin-top: 20rpx; display: flex; align-items: center;
  justify-content: center; gap: 10rpx;
  font-size: 26rpx; color: #22C55E;
}
.gen-dot {
  width: 12rpx; height: 12rpx; border-radius: 50%;
  background: #22C55E; animation: genPulse 1s ease-in-out infinite;
}
@keyframes genPulse { 0%, 100% { opacity: 0.3; } 50% { opacity: 1; } }
.gen-stream {
  margin-top: 24rpx; min-height: 300rpx;
  background: #f4f7f6; border-radius: 16rpx;
  padding: 20rpx; box-sizing: border-box;
}
/* 事件状态行（在正文框内，浅色小字，不抢正文视觉） */
.gen-event {
  font-size: 22rpx; color: #22C55E; line-height: 1.6;
  padding: 4rpx 0 12rpx; border-bottom: 1rpx solid #E7F9EE;
  margin-bottom: 12rpx;
}
/* 结构化进度行：从 token 流里解析出的字段，原始 JSON 不上屏 */
.gen-line { font-size: 24rpx; color: #5A6B66; line-height: 2; }
/* 还没解析出字段时的三点呼吸占位 */
.gen-wait {
  height: 260rpx;
  display: flex; align-items: center; justify-content: center; gap: 14rpx;
}
.gen-wait-dot {
  width: 14rpx; height: 14rpx; border-radius: 50%; background: #22C55E;
  animation: genWait 1.2s ease-in-out infinite;
}
@keyframes genWait {
  0%, 100% { opacity: 0.25; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-8rpx); }
}
/* 闪烁光标：模拟逐字输入的效果 */
.gen-cursor {
  font-size: 22rpx; color: #22C55E;
  animation: genBlink 0.8s step-end infinite;
}
@keyframes genBlink { 50% { opacity: 0; } }
.gen-hint { margin-top: 18rpx; text-align: center; font-size: 24rpx; color: #868E96; }
</style>
