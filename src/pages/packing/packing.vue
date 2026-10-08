<template>
  <!-- 行李清单独立页（清新轻扁平风）：从行程页工具条进入，行程上下文靠 tripId query 传递 -->
  <view class="wrap">
    <view class="card" v-if="!tripId">
      <view class="note center">缺少行程参数，请从行程详情页的「行李」入口进入</view>
    </view>

    <template v-else>
      <!-- AI 一键生成：独立按钮（点击触发生成；清单非空时需确认） -->
      <view class="gen-row">
        <view class="ai-btn" :class="{ disabled: genBusy }" @tap="onGen">
          <image class="abt-ico" :src="ICO.wandW" mode="aspectFit" />
          <text>{{ genBusy ? '生成中…' : '一键生成' }}</text>
        </view>
      </view>

      <!-- 打包进度条 -->
      <view class="prog" v-if="packing.length">
        <view class="prog-bar"><view class="prog-in" :style="{ width: progPct + '%' }" /></view>
        <text class="prog-txt">已打包 {{ checkedCount }}/{{ packing.length }}</text>
      </view>

      <!-- 分组清单：点条目勾选，长按删除 -->
      <view class="grp" v-for="g in groups" :key="g.name">
        <view class="grp-head">
          <view class="grp-bar" :style="{ background: g.color }" />
          <text class="grp-name">{{ g.name }}</text>
          <text class="grp-count">{{ g.list.length }} ITEMS</text>
        </view>
        <view class="grp-card">
          <view class="pack-item" v-for="p in g.list" :key="p.id" @tap="togglePacking(p)" @longpress="delPacking(p)">
            <view class="pack-check" :class="{ on: p.checked }"><image v-if="p.checked" class="pc-ico" :src="ICO.check" mode="aspectFit" /></view>
            <text class="pack-name" :class="{ done: p.checked }">{{ p.name }}</text>
            <image class="pack-ico" :src="g.icon" mode="aspectFit" />
          </view>
        </view>
      </view>

      <!-- 空态：还没有任何物品 -->
      <view class="card empty" v-if="!packing.length && !loading">
        <view class="empty-txt">清单还是空的</view>
        <view class="empty-sub">点上方「一键生成」，AI 按行程帮你配好</view>
      </view>

      <!-- 添加新物品（分类由关键词自动归组） -->
      <view class="add-card" v-if="tripId">
        <image class="add-plus" :src="ICO.plus" mode="aspectFit" />
        <input class="add-input" v-model="newItem" maxlength="20"
          placeholder="添加新物品…" placeholder-class="add-ph" confirm-type="done" @confirm="addItem" :disabled="addBusy" />
        <view class="add-btn" :class="{ disabled: addBusy }" @tap="addItem">{{ addBusy ? '…' : 'ADD' }}</view>
      </view>

      <view class="foot-note" v-if="packing.length">
        <text>点条目勾选</text>
        <text>·</text>
        <text>长按删除</text>
        <text v-if="checkedCount">·</text>
        <text v-if="checkedCount" class="foot-reset" :class="{ disabled: resetBusy }" @tap="resetCheck">清除勾选</text>
        <text>·</text>
        <text class="foot-clear" :class="{ disabled: clearBusy }" @tap="clearAll">{{ clearBusy ? '清空中…' : '一键清空' }}</text>
      </view>
    </template>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import Taro, { useRouter, useDidShow } from '@tarojs/taro'
import api from '../../services/api'

import wandW from '../../assets/icons/wand-white.png'
import checkW from '../../assets/icons/check-white.png'
import plusGr from '../../assets/icons/plus-green.png'
import walletGy from '../../assets/icons/wallet-gray.png'
import shoppingGy from '../../assets/icons/shopping-bag-gray.png'
import cameraGy from '../../assets/icons/camera-gray.png'
import flaskGy from '../../assets/icons/flask-gray.png'
import luggageGy from '../../assets/icons/luggage-gray-s.png'

const ICO = { wandW, check: checkW, plus: plusGr }

const router = useRouter()
const tripId = ref(router.params.tripId || '')
// city 走 query 传入（AI 生成在后端按行程算，这里只做展示备用）
const city = ref(router.params.city ? decodeURIComponent(router.params.city) : '')

// ---------- 行李清单（packing 六件套：list / generate / add / update / remove / check-reset）----------
const packing = ref([])
const newItem = ref('')
const genBusy = ref(false)
const addBusy = ref(false)
const resetBusy = ref(false)
const clearBusy = ref(false)
const loading = ref(true)
const checkedCount = computed(() => packing.value.filter(p => p.checked).length)
const progPct = computed(() => packing.value.length ? Math.round(checkedCount.value / packing.value.length * 100) : 0)

function loadPacking() {
  if (!tripId.value) return
  api.trips.packingList(tripId.value).then(list => {
    packing.value = Array.isArray(list) ? list : []
  }).catch(() => {}).finally(() => { loading.value = false })   // 非成员 404 静默，显示空态
}

// ---------- 分组：后端 item 只有 {id,name,checked}，分类由前端关键词自动归组 ----------
const GROUPS = [
  { key: 'doc',   name: '必要证件', color: '#F2B33D', icon: walletGy,   kws: ['身份证', '护照', '签证', '证件', '订单', '行程单', '票', '现金', '银行卡', '信用卡', '卡'] },
  { key: 'digital', name: '数码装备', color: '#F29979', icon: cameraGy, kws: ['充电', '数据线', '耳机', '手机', '相机', '平板', '电脑', '插头', '转换', 'U盘', '电池'] },
  { key: 'wash',  name: '洗护用品', color: '#0EA5A4', icon: flaskGy,  kws: ['洗面奶', '牙膏', '牙刷', '洗发', '沐浴', '护肤', '防晒霜', '防晒喷雾', '化妆品', '化妆', '毛巾', '纸巾', '湿巾', '隐形', '美妆', '梳', '镜子'] },
  { key: 'cloth', name: '衣物搭配', color: '#22C55E', icon: shoppingGy, kws: ['衣', '裤', '鞋', '袜', '帽', '裙', '外套', '毛衣', '围巾', '手套', '伞', '毯', '枕'] }
]
function classify(name) {
  const n = String(name || '')
  for (const g of GROUPS) {
    if (g.kws.some(k => n.includes(k))) return g.key
  }
  return 'other'
}
const groups = computed(() => {
  const map = {}
  packing.value.forEach(p => {
    const k = classify(p.name)
    if (!map[k]) map[k] = []
    map[k].push(p)
  })
  const out = []
  for (const g of GROUPS) {
    if (map[g.key] && map[g.key].length) out.push({ name: g.name, color: g.color, icon: g.icon, list: map[g.key] })
  }
  if (map.other && map.other.length) out.push({ name: '其他物品', color: '#868E96', icon: luggageGy, list: map.other })
  return out
})

// ---------- 生成：空清单直接生成；已有内容先确认（generate 是清空重建） ----------
function onGen() {
  if (genBusy.value) return
  if (!packing.value.length) { doGenerate(); return }
  Taro.showModal({ title: 'AI 重新生成', content: '将清空当前清单并按行程重新生成，确定吗？' }).then(r => {
    if (r.confirm) doGenerate()
  })
}

function doGenerate() {
  genBusy.value = true
  api.trips.packingGenerate(tripId.value).then(list => {
    if (Array.isArray(list)) packing.value = list
    Taro.showToast({ title: '清单已生成', icon: 'success' })
  }).catch(e => {
    Taro.showToast({ title: e.message || '生成失败，稍后再试', icon: 'none' })
  }).finally(() => {
    genBusy.value = false
  })
}

function addItem() {
  const name = newItem.value.trim()
  if (!name) { Taro.showToast({ title: '先填写物品名', icon: 'none' }); return }
  if (addBusy.value) return
  addBusy.value = true
  api.trips.packingAdd(tripId.value, name).then(list => {
    if (Array.isArray(list)) packing.value = list
    newItem.value = ''
  }).catch(e => {
    Taro.showToast({ title: e.message || '添加失败', icon: 'none' })
  }).finally(() => {
    addBusy.value = false
  })
}

// 勾选：乐观更新（点了立刻变），失败回滚；后端返回整份清单则对齐
function togglePacking(p) {
  const target = !p.checked
  p.checked = target
  api.trips.packingUpdate(tripId.value, p.id, p.name, target).then(list => {
    if (Array.isArray(list)) packing.value = list
  }).catch(() => {
    p.checked = !target
    Taro.showToast({ title: '同步失败', icon: 'none' })
  })
}

// 长按删除（右侧图标现在是分类装饰，删除入口改长按 + 确认）
function delPacking(p) {
  Taro.showModal({
    title: '删除物品',
    content: `把「${p.name}」从清单里删掉吗？`,
    confirmText: '删除'
  }).then(r => {
    if (!r.confirm) return
    api.trips.packingRemove(tripId.value, p.id).then(list => {
      packing.value = Array.isArray(list) ? list : packing.value.filter(x => x.id !== p.id)
    }).catch(e => {
      Taro.showToast({ title: e.message || '删除失败', icon: 'none' })
    })
  })
}

// 一键清除所有勾选：接口无 data → 本地乐观清空（失败按原样回滚）
function resetCheck() {
  if (resetBusy.value) return
  Taro.showModal({ title: '清除勾选', content: '把所有物品恢复为未打包状态，确定吗？' }).then(r => {
    if (!r.confirm) return
    const snapshot = packing.value.map(p => p.checked)   // 备份，失败回滚
    packing.value.forEach(p => { p.checked = false })
    resetBusy.value = true
    api.trips.packingCheckReset(tripId.value).then(() => {
      Taro.showToast({ title: '已清除勾选', icon: 'success' })
    }).catch(e => {
      packing.value.forEach((p, i) => { p.checked = snapshot[i] })
      Taro.showToast({ title: e.message || '清除失败', icon: 'none' })
    }).finally(() => {
      resetBusy.value = false
    })
  })
}

// 一键清空：删除清单里所有物品（后端无批量接口，逐条 DELETE；完成后按返回清单兜底刷新）
function clearAll() {
  if (clearBusy.value || !packing.value.length) return
  Taro.showModal({ title: '一键清空', content: '将删除清单里的全部物品，确定吗？', confirmText: '清空' }).then(r => {
    if (!r.confirm) return
    clearBusy.value = true
    const ids = packing.value.map(p => p.id)
    Promise.all(ids.map(id => api.trips.packingRemove(tripId.value, id).catch(e => ({ err: e }))))
      .then(results => {
        const failed = results.filter(x => x && x.err)
        if (failed.length) {
          Taro.showToast({ title: `${failed.length} 项删除失败，已刷新清单`, icon: 'none' })
          loadPacking()
        } else {
          packing.value = []
          Taro.showToast({ title: '已清空', icon: 'success' })
        }
      })
      .finally(() => { clearBusy.value = false })
  })
}

// 从别的页面切回来时刷新：协作者可能在别处改了清单
useDidShow(() => { loadPacking() })
</script>

<style>
.wrap { min-height: 100vh; background: #F6F9F7; padding: 24rpx 24rpx calc(48rpx + env(safe-area-inset-bottom)); box-sizing: border-box; }

/* AI 一键生成按钮行 */
.gen-row { display: flex; padding: 0 8rpx 22rpx; }
.ai-btn {
  display: inline-flex; align-items: center; gap: 8rpx;
  font-size: 26rpx; font-weight: 600; color: #ffffff;
  background: #22C55E; border-radius: 999rpx; padding: 14rpx 34rpx;
  box-shadow: 0 6rpx 16rpx rgba(34, 197, 94, 0.28);
}
.ai-btn.disabled { opacity: 0.6; }
.abt-ico { width: 26rpx; height: 26rpx; }

/* 打包进度 */
.prog { display: flex; align-items: center; gap: 16rpx; padding: 0 8rpx 22rpx; }
.prog-bar { flex: 1; height: 12rpx; background: #E4EDE7; border-radius: 999rpx; overflow: hidden; }
.prog-in { height: 100%; background: linear-gradient(90deg, #4ADE80, #22C55E); border-radius: 999rpx; transition: width 0.3s; }
.prog-txt { font-size: 22rpx; color: #868E96; }

/* 分组 */
.grp { margin-bottom: 26rpx; }
.grp-head { display: flex; align-items: center; padding: 0 8rpx 14rpx; }
.grp-bar { width: 6rpx; height: 28rpx; border-radius: 999rpx; margin-right: 12rpx; }
.grp-name { font-size: 28rpx; font-weight: 600; color: #333333; }
.grp-count { margin-left: auto; font-size: 20rpx; color: #ADB5BD; letter-spacing: 1rpx; }
.grp-card { display: flex; flex-direction: column; gap: 12rpx; }

/* 物品行：白色圆角行 + 圆角方勾选框 + 右侧分类小图标 */
.pack-item {
  display: flex; align-items: center; gap: 18rpx;
  background: #ffffff; border-radius: 20rpx; padding: 24rpx 24rpx;
  box-shadow: 0 2rpx 10rpx rgba(0, 0, 0, 0.03);
}
.pack-check {
  width: 40rpx; height: 40rpx; border-radius: 10rpx; border: 2rpx solid #D6DCD8;
  box-sizing: border-box; display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  background: #ffffff;
}
.pack-check.on { background: #22C55E; border-color: #22C55E; }
.pc-ico { width: 24rpx; height: 24rpx; }
.pack-name { flex: 1; font-size: 28rpx; color: #333; }
.pack-name.done { color: #B4B2A9; text-decoration: line-through; }
.pack-ico { width: 34rpx; height: 34rpx; opacity: 0.8; flex-shrink: 0; }

/* 空态 */
.card { background: #fff; border-radius: 24rpx; padding: 24rpx; margin-bottom: 20rpx; }
.note { font-size: 22rpx; color: #868E96; }
.note.center { text-align: center; }
.empty { text-align: center; padding: 48rpx 24rpx; }
.empty-txt { font-size: 28rpx; color: #333; font-weight: 600; }
.empty-sub { font-size: 24rpx; color: #868E96; margin-top: 10rpx; }

/* 添加新物品 */
.add-card {
  display: flex; align-items: center; gap: 14rpx;
  background: #ffffff; border-radius: 20rpx; padding: 18rpx 24rpx;
  border: 1rpx dashed #C9D6CD;
}
.add-plus { width: 30rpx; height: 30rpx; flex-shrink: 0; }
.add-input { flex: 1; font-size: 26rpx; color: #333; }
.add-ph { color: #ADB5BD; }
.add-btn { font-size: 24rpx; font-weight: 700; color: #22C55E; letter-spacing: 1rpx; padding: 8rpx 4rpx; }
.add-btn.disabled { opacity: 0.6; }

/* 底部提示 */
.foot-note { display: flex; justify-content: center; align-items: center; gap: 12rpx; font-size: 22rpx; color: #868E96; margin-top: 22rpx; }
.foot-reset { color: #22C55E; }
.foot-reset.disabled { opacity: 0.6; }
.foot-clear { color: #22C55E; }
.foot-clear.disabled { opacity: 0.6; }
</style>
