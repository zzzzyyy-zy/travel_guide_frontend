<template>
  <!-- 记账独立页：从行程页工具条进入，行程上下文靠 tripId query 传递 -->
  <view class="wrap">
    <view class="hero">
      <view class="hero-left">
        <view class="hero-city">{{ city || '行程记账' }}</view>
        <view class="hero-sub"><image class="hero-ico" :src="ICO.users" mode="aspectFit" /><text>协作成员可见 · 四类目</text></view>
      </view>
      <view class="hero-refresh" @tap="loadExpenses"><image class="rf-ico" :src="ICO.refresh" mode="aspectFit" />刷新</view>
    </view>

    <view class="card" v-if="!tripId">
      <view class="note center">缺少行程参数，请从行程详情页的「记账」入口进入</view>
    </view>

    <template v-else>
      <!-- 汇总条：总金额 + 四类目小计 -->
      <view class="card">
        <view class="sec-title"><image class="pt-ico" :src="ICO.walletG" mode="aspectFit" />开支汇总</view>
        <view class="exp-sum" v-if="expSummary">
          <view class="exp-total">
            <text class="exp-total-num">¥{{ fmtMoney(expSummary.total) }}</text>
            <text class="exp-total-label">总花费</text>
          </view>
          <view class="exp-cats">
            <view class="exp-cat" v-for="c in EXP_CATS" :key="c.key">
              <view class="exp-cat-label"><image class="ec-ico" :src="c.img" mode="aspectFit" />{{ c.label }}</view>
              <text class="exp-cat-num">¥{{ fmtMoney((expSummary.categories || {})[c.key] || 0) }}</text>
            </view>
          </view>
        </view>
        <view class="note" v-else>还没有汇总数据，记一笔后自动统计</view>
      </view>

      <!-- 记一笔：分类 chips + 金额 + 备注 + 日期 -->
      <view class="card">
        <view class="sec-title">{{ editingExp ? '修改这笔' : '记一笔' }}</view>
        <view class="exp-form-row">
          <view class="exp-chip" v-for="c in EXP_CATS" :key="c.key"
            :class="{ on: expCat === c.key, editing: editingExp && editingExp.category === c.key }"
            @tap="expCat = c.key"><image class="ec-ico" :src="c.img" mode="aspectFit" />{{ c.label }}</view>
        </view>
        <view class="exp-form-row">
          <input class="exp-input amount" type="digit" v-model="expAmount" placeholder="金额"
            :disabled="!!expBusy" maxlength="9" />
          <input class="exp-input" v-model="expNote" placeholder="备注（如 午餐）"
            :disabled="!!expBusy" maxlength="20" />
        </view>
        <view class="exp-form-row">
          <picker mode="date" :value="expDate" @change="e => (expDate = e.detail.value)">
            <view class="exp-date">{{ expDate }}</view>
          </picker>
        </view>
        <view class="exp-form-btns">
          <view class="exp-submit" :class="{ disabled: expBusy }" @tap="expBusy ? null : (editingExp ? saveExpense() : addExpense())">
            {{ expBusy ? '…' : (editingExp ? '保存修改' : '记一笔') }}
          </view>
          <view class="exp-cancel" v-if="editingExp" @tap="cancelEdit">取消编辑</view>
        </view>
      </view>

      <!-- 流水列表：点条目进编辑态，点右侧图标删除 -->
      <view class="card">
        <view class="sec-title">流水 · 共 {{ expenses.length }} 笔</view>
        <view class="exp-list" v-if="expenses.length">
          <view class="exp-item" v-for="e in expenses" :key="e.id"
            :class="{ picked: editingExp && editingExp.id === e.id }" @tap="startEdit(e)">
            <image class="exp-ico" :src="catOf(e.category).img" mode="aspectFit" />
            <view class="exp-mid">
              <text class="exp-note">{{ e.note || catOf(e.category).label }}</text>
              <text class="exp-item-date">{{ e.expenseDate || '' }}</text>
            </view>
            <text class="exp-amt">¥{{ fmtMoney(e.amount) }}</text>
            <image class="exp-del" :src="ICO.close" mode="aspectFit" @tap.stop="delExpense(e)" />
          </view>
        </view>
        <view class="note center" v-else>{{ loading ? '加载中…' : '还没有记账，先记一笔吧' }}</view>
        <view class="note center" v-if="expenses.length">点条目可改金额/备注，点右侧图标删除</view>
      </view>
    </template>
  </view>
</template>

<script setup>
import { ref } from 'vue'
import Taro, { useRouter, useDidShow } from '@tarojs/taro'
import api from '../../services/api'

import walletGrn from '../../assets/icons/wallet-green.png'
import refreshGr from '../../assets/icons/refresh-green.png'
import closeGr from '../../assets/icons/close-gray.png'
import usersGr from '../../assets/icons/users-green.png'
import hotelImg from '../../assets/icons/hotel-green.png'
import trainImg from '../../assets/icons/train-green.png'
import utensilsImg from '../../assets/icons/utensils-green.png'
import bagImg from '../../assets/icons/shopping-bag-green.png'

const ICO = { walletG: walletGrn, refresh: refreshGr, close: closeGr, users: usersGr }

const router = useRouter()
const tripId = ref(router.params.tripId || '')
// city 走 query 传入，页面头部就能显示「广州」，不用再拉一次详情
const city = ref(router.params.city ? decodeURIComponent(router.params.city) : '')

// ---------- 开支记账（expenses 五件套：list / summary / add / update / remove）----------
const EXP_CATS = [
  { key: 'accommodation', label: '住宿', img: hotelImg },
  { key: 'transport', label: '交通', img: trainImg },
  { key: 'food', label: '餐饮', img: utensilsImg },
  { key: 'misc', label: '临时', img: bagImg }
]
const expenses = ref([])
const expSummary = ref(null)
const expCat = ref('food')
const expAmount = ref('')
const expNote = ref('')
const expDate = ref(new Date().toISOString().slice(0, 10))
const expBusy = ref(false)
const loading = ref(true)
const editingExp = ref(null)   // 编辑中的记录；null = 新增模式

function catOf(key) {
  return EXP_CATS.find(c => c.key === key) || EXP_CATS[3]
}
function fmtMoney(v) {
  const n = Number(v) || 0
  return n % 1 === 0 ? String(n) : n.toFixed(2)
}
function loadExpenses() {
  if (!tripId.value) return
  api.trips.expensesList(tripId.value).then(list => {
    expenses.value = Array.isArray(list) ? list : []
  }).catch(() => {}).finally(() => { loading.value = false })
  api.trips.expensesSummary(tripId.value).then(s => {
    expSummary.value = s && typeof s === 'object' ? s : null
  }).catch(() => { expSummary.value = null })
}
// 表单校验 + 组请求体（add / update 共用）
function buildExpenseBody() {
  const amount = Number(expAmount.value)
  if (!isFinite(amount) || amount <= 0) { Taro.showToast({ title: '请输入有效金额', icon: 'none' }); return null }
  return { category: expCat.value, amount, note: expNote.value.trim(), expenseDate: expDate.value }
}
function addExpense() {
  if (expBusy.value) return
  const body = buildExpenseBody()
  if (!body) return
  expBusy.value = true
  api.trips.expenseAdd(tripId.value, body).then(list => {
    if (Array.isArray(list)) expenses.value = list
    expAmount.value = ''
    expNote.value = ''
    api.trips.expensesSummary(tripId.value).then(s => { expSummary.value = s || null }).catch(() => {})
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
    if (Array.isArray(list)) expenses.value = list
    editingExp.value = null
    expAmount.value = ''
    expNote.value = ''
    api.trips.expensesSummary(tripId.value).then(s => { expSummary.value = s || null }).catch(() => {})
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
.wrap { min-height: 100vh; background: #F7F9F9; padding: 24rpx 24rpx calc(48rpx + env(safe-area-inset-bottom)); box-sizing: border-box; }
.hero { display: flex; align-items: center; justify-content: space-between; padding: 8rpx 8rpx 24rpx; }
.hero-city { font-size: 40rpx; font-weight: 700; color: #15803D; }
.hero-sub { display: flex; align-items: center; gap: 8rpx; font-size: 22rpx; color: #868E96; margin-top: 8rpx; }
.hero-ico { width: 26rpx; height: 26rpx; }
.hero-refresh { display: flex; align-items: center; gap: 6rpx; font-size: 24rpx; color: #22C55E; }
.rf-ico { width: 26rpx; height: 26rpx; }
.card { background: #fff; border-radius: 24rpx; padding: 24rpx; margin-bottom: 20rpx; }
.sec-title { display: flex; align-items: center; gap: 8rpx; font-size: 28rpx; font-weight: 600; color: #333333; margin-bottom: 18rpx; }
.pt-ico { width: 30rpx; height: 30rpx; }
.note { font-size: 24rpx; color: #868E96; }
.note.center { text-align: center; }

.exp-sum { display: flex; align-items: center; background: #E7F9EE; border-radius: 16rpx; padding: 18rpx 20rpx; }
.exp-total { display: flex; flex-direction: column; margin-right: 28rpx; }
.exp-total-num { font-size: 40rpx; font-weight: 700; color: #15803D; }
.exp-total-label { font-size: 20rpx; color: #868E96; margin-top: 4rpx; }
.exp-cats { flex: 1; display: flex; flex-wrap: wrap; gap: 10rpx 18rpx; }
.exp-cat { display: flex; justify-content: space-between; width: 44%; font-size: 22rpx; color: #495057; }
.exp-cat-label { display: flex; align-items: center; gap: 6rpx; }
.exp-cat-num { color: #15803D; font-weight: 600; }
.ec-ico { width: 26rpx; height: 26rpx; }

.exp-form-row { display: flex; gap: 12rpx; margin-bottom: 14rpx; align-items: center; flex-wrap: wrap; }
.exp-chip { display: flex; align-items: center; gap: 6rpx; font-size: 24rpx; color: #495057; background: #F1F3F5; padding: 10rpx 20rpx; border-radius: 999rpx; border: 1rpx solid transparent; }
.exp-chip.on { color: #15803D; background: #E7F9EE; border-color: #22C55E; font-weight: 600; }
.exp-chip.editing { border-color: #F29979; }
.exp-input { flex: 1; min-width: 180rpx; border: 1rpx solid #DEE2E6; border-radius: 12rpx; padding: 12rpx 18rpx; font-size: 26rpx; }
.exp-input.amount { max-width: 200rpx; }
.exp-date { font-size: 24rpx; color: #15803D; background: #F1F3F5; padding: 12rpx 20rpx; border-radius: 12rpx; }
.exp-form-btns { display: flex; gap: 20rpx; align-items: center; margin-top: 4rpx; }
.exp-submit { font-size: 26rpx; color: #fff; background: #22C55E; padding: 14rpx 44rpx; border-radius: 999rpx; }
.exp-submit.disabled { opacity: 0.6; }
.exp-cancel { font-size: 24rpx; color: #868E96; padding: 8rpx 12rpx; }

.exp-item { display: flex; align-items: center; gap: 16rpx; padding: 18rpx 0; border-bottom: 1rpx solid #F1F3F5; }
.exp-item.picked { background: #FFF8F5; }
.exp-ico { width: 34rpx; height: 34rpx; }
.exp-mid { flex: 1; display: flex; flex-direction: column; }
.exp-note { font-size: 28rpx; color: #333333; }
.exp-amt { font-size: 28rpx; font-weight: 600; color: #15803D; }
.exp-item-date { font-size: 20rpx; color: #ADB5BD; margin-top: 4rpx; }
.exp-del { width: 26rpx; height: 26rpx; padding: 8rpx 12rpx; box-sizing: content-box; flex-shrink: 0; }
</style>
