<template>
  <!-- 旅行账单页：从行程页工具条进入，行程上下文靠 tripId query 传递 -->
  <view class="wrap">
    <view class="card" v-if="!tripId">
      <view class="note center">缺少行程参数，请从行程详情页的「记账」入口进入</view>
    </view>

    <template v-else>
      <!-- 总支出卡：大数字 + 预算进度（detail.budget 自由文本解析，无预算则隐藏进度区） -->
      <view class="card sum-card">
        <view class="sum-top">
          <text class="sum-label">总支出（CNY）</text>
          <view class="sum-remain" v-if="budgetNum > 0">
            <text class="sum-remain-label">剩余预算</text>
            <text class="sum-remain-num">¥{{ fmt2(Math.max(budgetNum - totalExp, 0)) }}</text>
          </view>
        </view>
        <view class="sum-total">¥{{ fmt2(totalExp) }}</view>
        <view class="sum-bar" v-if="budgetNum > 0">
          <view class="sum-bar-fill" :style="{ width: barPct + '%' }" />
        </view>
        <view class="sum-meta" v-if="budgetNum > 0">
          <text>预算利用率 {{ ratioPct }}%</text>
          <text>总预算 ¥{{ fmt2(budgetNum) }}</text>
        </view>
      </view>

      <!-- 支出构成：环形占比（conic-gradient）+ 图例 -->
      <view class="sec-head">
        <text class="sec-head-title">支出构成</text>
        <view class="range-pick" @tap="toggleRange">{{ rangeMode === '7d' ? '最近7天' : '全部' }}<view class="range-caret" /></view>
      </view>
      <view class="card chart-card">
        <view class="donut" :style="{ background: donutStyle }">
          <view class="donut-hole">
            <text class="donut-txt">{{ donutTotal > 0 ? '按分类' : '暂无数据' }}</text>
          </view>
        </view>
        <view class="legend">
          <view class="lg-item" v-for="c in donutItems" :key="c.key">
            <view class="lg-dot" :style="{ background: c.color }" />
            <text class="lg-label">{{ c.label }}</text>
          </view>
        </view>
      </view>

      <!-- 账单明细：按日期分组，点条目进编辑弹层 -->
      <view class="sec-head"><text class="sec-head-title">账单明细</text></view>
      <view class="card list-card" v-if="groups.length">
        <template v-for="g in groups" :key="g.date">
          <view class="group-head">
            <text class="group-date">{{ g.label }}</text>
            <text class="group-sum">支出 ¥{{ fmt2(g.sum) }}</text>
          </view>
          <view class="bill-item" v-for="e in g.items" :key="e.id"
            :class="{ picked: editingExp && editingExp.id === e.id }" @tap="startEdit(e)">
            <view class="bi-ico-box" :style="{ background: catOf(e.category).bg }">
              <image class="bi-ico" :src="catOf(e.category).img" mode="aspectFit" />
            </view>
            <view class="bi-mid">
              <text class="bi-name">{{ e.note || catOf(e.category).label }}</text>
              <text class="bi-sub">{{ catOf(e.category).label }}</text>
            </view>
            <text class="bi-amt">-¥{{ fmt2(e.amount) }}</text>
            <image class="bi-del" :src="ICO.close" mode="aspectFit" @tap.stop="delExpense(e)" />
          </view>
        </template>
      </view>
      <view class="card" v-else>
        <view class="note center">{{ loading ? '加载中…' : '还没有记账，点下方「记一笔」开始' }}</view>
      </view>

      <!-- 悬浮记一笔 -->
      <view class="fab-add" @tap="openForm"><text class="fab-plus">＋</text>记一笔</view>

      <!-- 记一笔弹层（纯净极简版：大金额 + 六类格子 + 日期行 + 备注卡 + 保存记录） -->
      <view class="mask" v-if="showForm" @tap="closeForm" />
      <view class="sheet" v-if="showForm">
        <view class="sheet-nav">
          <view class="sheet-back" @tap="closeForm"><view class="sheet-back-ico" /></view>
          <text class="sheet-title">{{ editingExp ? '修改支出' : '新增支出' }}</text>
          <view class="sheet-nav-ph" />
        </view>

        <view class="sec-label">支出金额</view>
        <view class="amt-box">
          <text class="amt-sym">¥</text>
          <input class="amt-input" type="digit" v-model="expAmount" :disabled="!!expBusy"
            maxlength="9" placeholder="0.00" placeholder-class="amt-ph" />
        </view>

        <view class="sec-label">支出类别</view>
        <view class="cat-grid">
          <view class="cat-cell" v-for="c in EXP_CATS" :key="c.key"
            :class="{ on: expCat === c.key }" @tap="expCat = c.key">
            <image class="cat-ico" :src="c.img" mode="aspectFit" />
            <text class="cat-txt">{{ c.label }}</text>
          </view>
        </view>

        <picker mode="date" :value="expDate" @change="e => (expDate = e.detail.value)">
          <view class="row-card">
            <image class="row-ico" :src="calImg" mode="aspectFit" />
            <text class="row-label">日期</text>
            <text class="row-val">{{ expDateCn }}</text>
            <view class="row-arrow" />
          </view>
        </picker>

        <view class="row-card note-card">
          <view class="note-head">
            <image class="row-ico" :src="noteImg" mode="aspectFit" />
            <text class="row-label">备注</text>
          </view>
          <textarea class="note-input" v-model="expNote" :disabled="!!expBusy" maxlength="50"
            placeholder="这一餐在哪吃的？味道如何…" placeholder-class="note-ph" />
        </view>

        <view class="save-btn" :class="{ disabled: expBusy }"
          @tap="expBusy ? null : (editingExp ? saveExpense() : addExpense())">
          <text class="save-check">✓</text>{{ expBusy ? '保存中…' : '保存记录' }}
        </view>
      </view>
    </template>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import Taro, { useRouter, useDidShow } from '@tarojs/taro'
import api from '../../services/api'

import closeGr from '../../assets/icons/close-gray.png'
import catFood from '../../assets/icons/utensils-teal.png'
import catTransport from '../../assets/icons/cat-transport.png'
import catAccom from '../../assets/icons/cat-accommodation.png'
import catShopping from '../../assets/icons/cat-shopping.png'
import catFun from '../../assets/icons/cat-fun.png'
import catOther from '../../assets/icons/cat-other.png'
import calImg from '../../assets/icons/calendar-gray.png'
import noteImg from '../../assets/icons/note-pen-gray.png'

const ICO = { close: closeGr }

const router = useRouter()
const tripId = ref(router.params.tripId || '')

// ---------- 开支记账（expenses 五件套：list / summary / add / update / remove）----------
// UI 六类；⚠️ 后端对 category 做白名单校验（实测报「分类不合法」）只认 food/accommodation/transport/misc
// → 新增三类提交时映射回 misc（server 字段）；读回来的 misc 记录由 catOf 兜底显示为「其他」
const EXP_CATS = [
  { key: 'food',          label: '餐饮', img: catFood,      bg: '#E6F2EF', color: '#4E9C8D', server: 'food' },
  { key: 'transport',     label: '交通', img: catTransport, bg: '#E9F1F3', color: '#6E9FA8', server: 'transport' },
  { key: 'accommodation', label: '住宿', img: catAccom,     bg: '#EDF5F2', color: '#86B7AB', server: 'accommodation' },
  { key: 'shopping',      label: '购物', img: catShopping,  bg: '#F0F4EF', color: '#9DB4A0', server: 'misc' },
  { key: 'fun',           label: '娱乐', img: catFun,       bg: '#F2F7F4', color: '#B7CFC4', server: 'misc' },
  { key: 'other',         label: '其他', img: catOther,     bg: '#F4F9F6', color: '#A9C6BA', server: 'misc' }
]
// 环形图固定用全量四类目配色（与图例一致）
const expenses = ref([])
const expSummary = ref(null)
const expCat = ref('food')
const expAmount = ref('')
const expNote = ref('')
const expDate = ref(new Date().toISOString().slice(0, 10))
const expBusy = ref(false)
const loading = ref(true)
const editingExp = ref(null)   // 编辑中的记录；null = 新增模式
const showForm = ref(false)    // 记一笔弹层
const budgetNum = ref(0)       // detail.budget 自由文本解析出的数字（0=无预算）
const rangeMode = ref('all')   // 支出构成统计范围：all | 7d

function catOf(key) {
  return EXP_CATS.find(c => c.key === key) || EXP_CATS[5]
}
function fmt2(v) {
  return (Number(v) || 0).toFixed(2)
}
// 日期中文展示：2024年5月24日（弹层日期行用）
const expDateCn = computed(() => {
  const m = String(expDate.value || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)
  if (!m) return expDate.value
  return `${m[1]}年${Number(m[2])}月${Number(m[3])}日`
})
const totalExp = computed(() => (expSummary.value && Number(expSummary.value.total)) || 0)
// 日期标签：今天/昨天 · M月D日
function dateLabel(ds) {
  const m = String(ds || '').match(/^(\d{4})-(\d{1,2})-(\d{1,2})/)
  if (!m) return String(ds || '')
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  const today = new Date()
  const one = 24 * 3600 * 1000
  const t0 = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()
  const diff = Math.round((t0 - d.getTime()) / one)
  const md = `${Number(m[2])}月${Number(m[3])}日`
  if (diff === 0) return `今天 · ${md}`
  if (diff === 1) return `昨天 · ${md}`
  return md
}
// 明细按日期倒序分组（同日内按接口原顺序）
const groups = computed(() => {
  const map = []
  for (const e of expenses.value) {
    const date = e.expenseDate || '未知日期'
    let g = map.find(x => x.date === date)
    if (!g) { g = { date, label: dateLabel(date), sum: 0, items: [] }; map.push(g) }
    g.sum += Number(e.amount) || 0
    g.items.push(e)
  }
  return map.sort((a, b) => (a.date < b.date ? 1 : -1))
})
// 支出构成数据源：全部=summary；最近7天=按 expenseDate 前端聚合
const donutItems = computed(() => {
  let cats
  if (rangeMode.value === '7d') {
    const t = new Date()
    const t0 = new Date(t.getFullYear(), t.getMonth(), t.getDate()).getTime()
    const min = new Date(t0 - 6 * 24 * 3600 * 1000).toISOString().slice(0, 10)
    cats = {}
    for (const e of expenses.value) {
      if (e.expenseDate && e.expenseDate >= min) cats[e.category] = (cats[e.category] || 0) + (Number(e.amount) || 0)
    }
  } else {
    cats = (expSummary.value && expSummary.value.categories) || {}
  }
  // misc 是后端白名单值（购物/娱乐/其他 上行都映射成 misc），统计时全部归到「其他」
  return EXP_CATS.map(c => {
    let val = Number(cats[c.key]) || 0
    if (c.key === 'other') val += Number(cats.misc) || 0
    return { key: c.key, label: c.label, color: c.color, val }
  })
})
const donutTotal = computed(() => donutItems.value.reduce((s, c) => s + c.val, 0))
// conic-gradient 环形占比
const donutStyle = computed(() => {
  const items = donutItems.value.filter(c => c.val > 0)
  if (!items.length) return 'conic-gradient(#E3ECE9 0deg, #E3ECE9 360deg)'
  let acc = 0
  const stops = items.map(c => {
    const from = (acc / donutTotal.value) * 360
    acc += c.val
    const to = (acc / donutTotal.value) * 360
    return `${c.color} ${from.toFixed(2)}deg ${to.toFixed(2)}deg`
  })
  return 'conic-gradient(' + stops.join(', ') + ')'
})
function toggleRange() {
  rangeMode.value = rangeMode.value === 'all' ? '7d' : 'all'
}
// 预算进度（detail.budget 是自由文本，解析出数字才参与）
const barPct = computed(() => {
  if (budgetNum.value <= 0) return 0
  return Math.min(100, (totalExp.value / budgetNum.value) * 100)
})
const ratioPct = computed(() => {
  if (budgetNum.value <= 0) return '0.0'
  return ((totalExp.value / budgetNum.value) * 100).toFixed(1)
})

function loadExpenses() {
  if (!tripId.value) return
  api.trips.expensesList(tripId.value).then(list => {
    expenses.value = Array.isArray(list) ? list : []
  }).catch(() => {}).finally(() => { loading.value = false })
  api.trips.expensesSummary(tripId.value).then(s => {
    expSummary.value = s && typeof s === 'object' ? s : null
  }).catch(() => { expSummary.value = null })
  // 预算：详情里 budget 为自由文本，解析出数字才显示进度区
  api.trips.detail(tripId.value).then(d => {
    const n = parseFloat(String((d && d.budget) || '').replace(/[^\d.]/g, ''))
    budgetNum.value = isFinite(n) && n > 0 ? n : 0
  }).catch(() => { budgetNum.value = 0 })
}
// 表单校验 + 组请求体（add / update 共用）
function buildExpenseBody() {
  const amount = Number(expAmount.value)
  if (!isFinite(amount) || amount <= 0) { Taro.showToast({ title: '请输入有效金额', icon: 'none' }); return null }
  // category 上行用后端白名单值：购物/娱乐/其他 → misc（后端只认四类）
  const cat = EXP_CATS.find(c => c.key === expCat.value)
  return { category: (cat && cat.server) || 'misc', amount, note: expNote.value.trim(), expenseDate: expDate.value }
}
function openForm() {
  if (!editingExp.value) { expCat.value = 'food'; expAmount.value = ''; expNote.value = ''; expDate.value = new Date().toISOString().slice(0, 10) }
  showForm.value = true
}
function closeForm() {
  showForm.value = false
  if (editingExp.value) cancelEdit()
}
function afterSave(list) {
  if (Array.isArray(list)) expenses.value = list
  editingExp.value = null
  showForm.value = false
  expAmount.value = ''
  expNote.value = ''
  api.trips.expensesSummary(tripId.value).then(s => { expSummary.value = s || null }).catch(() => {})
}
function addExpense() {
  if (expBusy.value) return
  const body = buildExpenseBody()
  if (!body) return
  expBusy.value = true
  api.trips.expenseAdd(tripId.value, body).then(list => {
    afterSave(list)
    Taro.showToast({ title: '已记一笔', icon: 'success' })
  }).catch(e => {
    Taro.showToast({ title: e.message || '记账失败', icon: 'none' })
  }).finally(() => { expBusy.value = false })
}
function startEdit(e) {
  editingExp.value = e
  expCat.value = e.category
  expAmount.value = String(e.amount)
  expNote.value = e.note || ''
  expDate.value = e.expenseDate || expDate.value
  showForm.value = true
}
function cancelEdit() {
  editingExp.value = null
  expAmount.value = ''
  expNote.value = ''
}
function saveExpense() {
  if (expBusy.value || !editingExp.value) return
  const body = buildExpenseBody()
  if (!body) return
  expBusy.value = true
  api.trips.expenseUpdate(tripId.value, editingExp.value.id, body).then(list => {
    afterSave(list)
    Taro.showToast({ title: '已更新', icon: 'success' })
  }).catch(e => {
    Taro.showToast({ title: e.message || '更新失败', icon: 'none' })
  }).finally(() => { expBusy.value = false })
}
function delExpense(e) {
  api.trips.expenseRemove(tripId.value, e.id).then(list => {
    if (Array.isArray(list)) expenses.value = list
    else expenses.value = expenses.value.filter(x => x.id !== e.id)
    if (editingExp.value && editingExp.value.id === e.id) cancelEdit()
    api.trips.expensesSummary(tripId.value).then(s => { expSummary.value = s || null }).catch(() => {})
    Taro.showToast({ title: '已删除', icon: 'none' })
  }).catch(err => {
    Taro.showToast({ title: err.message || '删除失败', icon: 'none' })
  })
}

// 从别的页面切回来时刷新：协作者可能在别处记了账
useDidShow(() => { loadExpenses() })
</script>

<style>
.wrap { min-height: 100vh; background: #F2F4F3; padding: 24rpx 24rpx calc(220rpx + env(safe-area-inset-bottom)); box-sizing: border-box; }
.card { background: #fff; border-radius: 32rpx; padding: 26rpx; margin-bottom: 8rpx; }
.note { font-size: 24rpx; color: #868E96; }
.note.center { text-align: center; }

/* 总支出卡 */
.sum-card { padding: 30rpx 28rpx; margin-bottom: 24rpx; }
.sum-top { display: flex; align-items: center; justify-content: space-between; }
.sum-label { font-size: 24rpx; color: #868E96; }
.sum-remain { display: flex; flex-direction: column; align-items: flex-end; }
.sum-remain-label { font-size: 20rpx; color: #868E96; }
.sum-remain-num { font-size: 26rpx; font-weight: 600; color: #4E9C8D; margin-top: 2rpx; }
.sum-total { font-size: 64rpx; font-weight: 700; color: #1F2937; margin-top: 10rpx; }
.sum-bar { height: 14rpx; background: #E9EFEC; border-radius: 999rpx; margin-top: 26rpx; overflow: hidden; }
.sum-bar-fill { height: 100%; border-radius: 999rpx; background: #4E9C8D; }
.sum-meta { display: flex; justify-content: space-between; font-size: 22rpx; color: #868E96; margin-top: 16rpx; }

/* 区块标题行 */
.sec-head { display: flex; align-items: center; justify-content: space-between; padding: 16rpx 8rpx 18rpx; }
.sec-head-title { font-size: 30rpx; font-weight: 600; color: #1F2937; }
.range-pick { font-size: 24rpx; color: #868E96; display: flex; align-items: center; gap: 8rpx; }
/* CSS 画的下箭头（字符 ⌄ 基线不齐，会偏离文字中线） */
.range-caret { width: 12rpx; height: 12rpx; border-right: 3rpx solid #ADB5BD; border-bottom: 3rpx solid #ADB5BD; transform: rotate(45deg); margin-top: -6rpx; }

/* 支出构成（环形图 + 图例） */
.chart-card { display: flex; flex-direction: column; align-items: center; padding: 36rpx 26rpx; margin-bottom: 8rpx; }
.donut { width: 320rpx; height: 320rpx; border-radius: 50%; display: flex; align-items: center; justify-content: center; }
.donut-hole { width: 186rpx; height: 186rpx; border-radius: 50%; background: #ffffff; display: flex; align-items: center; justify-content: center; }
.donut-txt { font-size: 26rpx; color: #495057; }
.legend { display: flex; gap: 36rpx; margin-top: 30rpx; }
.lg-item { display: flex; align-items: center; gap: 10rpx; }
.lg-dot { width: 20rpx; height: 20rpx; border-radius: 6rpx; }
.lg-label { font-size: 24rpx; color: #495057; }

/* 账单明细 */
.list-card { margin-bottom: 8rpx; }
.group-head { display: flex; align-items: center; justify-content: space-between; padding: 20rpx 4rpx 14rpx; }
.group-date { font-size: 24rpx; color: #868E96; }
.group-sum { font-size: 24rpx; color: #495057; }
.bill-item { display: flex; align-items: center; gap: 18rpx; background: #FAFBFB; border-radius: 24rpx; padding: 20rpx 22rpx; margin-bottom: 16rpx; }
.bill-item.picked { background: #FFF8F5; }
.bi-ico-box { width: 76rpx; height: 76rpx; border-radius: 20rpx; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.bi-ico { width: 40rpx; height: 40rpx; }
.bi-mid { flex: 1; display: flex; flex-direction: column; min-width: 0; }
.bi-name { font-size: 28rpx; color: #1F2937; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.bi-sub { font-size: 20rpx; color: #ADB5BD; margin-top: 6rpx; }
.bi-amt { font-size: 30rpx; font-weight: 600; color: #1F2937; flex-shrink: 0; }
.bi-del { width: 24rpx; height: 24rpx; padding: 8rpx 4rpx 8rpx 12rpx; box-sizing: content-box; flex-shrink: 0; opacity: 0.5; }

/* 悬浮记一笔按钮 */
.fab-add {
  position: fixed; left: 50%; transform: translateX(-50%);
  bottom: calc(48rpx + env(safe-area-inset-bottom));
  display: flex; align-items: center; gap: 8rpx;
  font-size: 28rpx; font-weight: 600; color: #ffffff;
  background: linear-gradient(135deg, #6FB3A6, #4E9488);
  border-radius: 999rpx; padding: 22rpx 58rpx;
  box-shadow: 0 10rpx 26rpx rgba(78, 148, 136, 0.35);
}
.fab-plus { font-size: 30rpx; }

/* 记一笔弹层（纯净极简版） */
.mask { position: fixed; left: 0; top: 0; right: 0; bottom: 0; background: rgba(0, 0, 0, 0.35); z-index: 30; }
.sheet {
  position: fixed; left: 0; right: 0; bottom: 0; z-index: 31;
  background: #F7F9F8; border-radius: 32rpx 32rpx 0 0;
  padding: 20rpx 32rpx calc(30rpx + env(safe-area-inset-bottom)); box-sizing: border-box;
}
/* 顶部导航行：返回 + 居中标题 */
.sheet-nav { display: flex; align-items: center; justify-content: space-between; margin-bottom: 6rpx; }
.sheet-back { width: 56rpx; height: 56rpx; display: flex; align-items: center; justify-content: center; }
.sheet-back-ico { width: 18rpx; height: 18rpx; border-left: 4rpx solid #495057; border-bottom: 4rpx solid #495057; transform: rotate(45deg); margin-left: 6rpx; }
.sheet-title { font-size: 32rpx; font-weight: 600; color: #1F2937; }
.sheet-nav-ph { width: 56rpx; height: 56rpx; }

.sec-label { font-size: 24rpx; color: #868E96; margin: 26rpx 4rpx 14rpx; }
/* 大金额 */
.amt-box { display: flex; align-items: center; justify-content: center; background: #ffffff; border-radius: 24rpx; padding: 30rpx 24rpx; }
.amt-sym { font-size: 36rpx; color: #868E96; margin-right: 16rpx; }
.amt-input { flex: 1; font-size: 68rpx; font-weight: 700; color: #1F2937; text-align: center; height: 88rpx; line-height: 88rpx; }
.amt-ph { color: #CED4DA; font-weight: 700; }

/* 六类格子（2 行 3 列） */
.cat-grid { display: flex; flex-wrap: wrap; justify-content: space-between; }
.cat-cell {
  width: 31%; box-sizing: border-box; margin-bottom: 18rpx;
  background: #ffffff; border-radius: 24rpx; padding: 30rpx 0 24rpx;
  display: flex; flex-direction: column; align-items: center; gap: 12rpx;
  border: 2rpx solid transparent;
}
.cat-cell.on { background: #DCEBE6; border-color: #BBD8CE; }
.cat-ico { width: 48rpx; height: 48rpx; }
.cat-txt { font-size: 24rpx; color: #495057; }
.cat-cell.on .cat-txt { color: #3E7E72; font-weight: 600; }

/* 日期行 / 备注卡 */
.row-card { background: #ffffff; border-radius: 24rpx; padding: 28rpx 26rpx; margin-bottom: 18rpx; display: flex; align-items: center; gap: 14rpx; }
.row-ico { width: 32rpx; height: 32rpx; flex-shrink: 0; }
.row-label { font-size: 26rpx; color: #495057; }
.row-val { flex: 1; text-align: right; font-size: 26rpx; color: #868E96; }
/* CSS 画的右箭头 */
.row-arrow { width: 14rpx; height: 14rpx; border-top: 3rpx solid #ADB5BD; border-right: 3rpx solid #ADB5BD; transform: rotate(45deg); flex-shrink: 0; }
.note-card { display: block; }
.note-head { display: flex; align-items: center; gap: 14rpx; }
.note-input { width: 100%; box-sizing: border-box; min-height: 90rpx; margin-top: 16rpx; font-size: 26rpx; color: #1F2937; }
.note-ph { color: #CED4DA; }

/* 底部保存按钮 */
.save-btn {
  margin-top: 10rpx; display: flex; align-items: center; justify-content: center; gap: 10rpx;
  font-size: 30rpx; font-weight: 600; color: #ffffff;
  background: #9FC3B9; border-radius: 999rpx; padding: 26rpx 0;
}
.save-btn.disabled { opacity: 0.6; }
.save-check { font-size: 28rpx; }
</style>
