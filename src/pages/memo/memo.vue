<template>
  <!-- 备忘录：两个视角（本行程 / 我的），数据层见 services/memo.js（走服务端，行程备忘成员共享） -->
  <view class="wrap">
    <!-- 视角切换：从我的页进来时没有 tripId，只显示「我的备忘」 -->
    <view class="tabs">
      <view class="tab" v-if="tripId" :class="{ on: scope === 'trip' }" @tap="switchScope('trip')">
        本行程{{ city ? ' · ' + city : '' }}
      </view>
      <view class="tab" :class="{ on: scope === 'mine' }" @tap="switchScope('mine')">我的备忘</view>
    </view>

    <view class="hint" v-if="scope === 'trip'">挂在这次行程下，协作成员都能看到</view>
    <view class="hint" v-else>只有你自己可见，跟行程无关</view>

    <!-- 同步失败常驻提示（toast 会消失、截图取证常错过；这里一直挂着直到下次拉通） -->
    <view class="sync-err" v-if="syncErr" @tap="load">
      <text class="se-txt">{{ syncErr }}</text>
      <text class="se-retry">重试</text>
    </view>

    <view class="new-btn" hover-class="new-hover" @tap="openNew">
      <image class="new-ico" :src="ICO.plusWhite" mode="aspectFit" />
      <text>新建备忘</text>
    </view>

    <view class="card memo-item" v-for="m in list" :key="m.id">
      <view class="mi-check" :class="{ on: m.done }" @tap="toggle(m)">
        <image v-if="m.done" class="mi-check-ico" :src="ICO.checkWhite" mode="aspectFit" />
      </view>
      <view class="mi-mid" @tap="openEdit(m)">
        <text class="mi-text" :class="{ done: m.done }">{{ m.content }}</text>
        <view class="mi-link" v-if="m.link">
          <image class="ml-ico" :src="m.link.type === 'spot' ? ICO.pin : ICO.cal" mode="aspectFit" />
          <text>{{ linkLabel(m.link) }}</text>
        </view>
        <view class="mi-imgs" v-if="m.images && m.images.length">
          <image v-for="(u, k) in m.images" :key="k" class="mi-img" :src="u" mode="aspectFill"
            @tap.stop="preview(m.images, k)" />
        </view>
        <text class="mi-meta">{{ fmtTime(m.createdAt) }} · {{ scope === 'mine' ? '仅自己可见' : '成员可见' }}</text>
      </view>
      <image class="mi-del" :src="ICO.close" mode="aspectFit" @tap.stop="del(m)" />
    </view>

    <!-- 缓存为空 + 正在拉远端：显示载入中（否则一闪而过的「还没有备忘」会让人以为真的没数据） -->
    <view class="empty" v-if="!list.length && syncing">
      <text class="empty-txt">载入中…</text>
    </view>
    <view class="empty" v-else-if="!list.length">
      <image class="empty-ico" :src="ICO.notebook" mode="aspectFit" />
      <text class="empty-txt">{{ scope === 'mine' ? '还没有个人备忘' : '这次行程还没有备忘' }}</text>
      <text class="empty-sub">订票号、民宿地址、忌口、随身清单…随手记一条</text>
    </view>

    <!-- 新建 / 编辑弹层 -->
    <view class="mask" v-if="editorVisible" @tap="closeEditor">
      <view class="sheet" @tap.stop>
        <view class="sheet-title">{{ editing ? '编辑备忘' : '新建备忘' }}</view>
        <textarea class="sheet-input" v-model="form.content" :maxlength="300" :adjust-position="true"
          placeholder="记点什么？例如：民宿 3 点后入住，前台电话 138xxxx" placeholder-class="ph" />
        <view class="sheet-count">{{ form.content.length }}/300</view>

        <!-- 关联（仅本行程视角）：挂到某一天或某个景点，行程时间线上会同步显示 -->
        <view class="sheet-link" v-if="scope === 'trip'" @tap="openLinkPicker">
          <image class="sl-ico" :src="ICO.pin" mode="aspectFit" />
          <text class="sl-label">关联</text>
          <text class="sl-val" :class="{ none: !form.link }">{{ linkText }}</text>
          <text class="sl-arrow">›</text>
        </view>

        <view class="sheet-imgs">
          <view class="img-box" v-for="(u, k) in form.images" :key="k">
            <image class="img-thumb" :src="u" mode="aspectFill" @tap="preview(form.images, k)" />
            <image class="img-del" :src="ICO.close" mode="aspectFit" @tap.stop="removeImg(k)" />
          </view>
          <view class="img-add" v-if="form.images.length < 9" @tap="pickImages">
            <image class="img-add-ico" :src="ICO.plusGreen" mode="aspectFit" />
            <text class="img-add-txt">{{ uploading ? '上传中' : '加图' }}</text>
          </view>
        </view>
        <view class="sheet-tip">照片、收据、截图都能当备忘（最多 9 张）</view>

        <view class="sheet-btns">
          <view class="sbtn primary" :class="{ disabled: saving }" @tap="saving ? null : save()">{{ saving ? '保存中…' : '保存' }}</view>
          <view class="sbtn" @tap="closeEditor">取消</view>
        </view>
      </view>
    </view>

    <!-- 关联选择器：不关联 / 第N天（整天）/ 第N天 · 景点名（景点来自当前行程详情） -->
    <view class="mask" v-if="linkVisible" @tap="linkVisible = false">
      <view class="sheet" @tap.stop>
        <view class="sheet-title">关联到</view>
        <view class="sheet-sub" v-if="!linkOptions.length">这次行程还没有当天景点，可以先关联到某一天</view>
        <scroll-view class="lk-scroll" :scroll-y="true">
          <view class="lk-item" :class="{ on: !form.link }" @tap="pickLink(null)">
            <text class="lk-label">不关联</text>
            <text class="lk-sub">只当一条独立备忘</text>
          </view>
          <view class="lk-item" v-for="(o, k) in linkOptions" :key="k"
            :class="{ on: isLinkOn(o), spot: o.type === 'spot' }" @tap="pickLink(o)">
            <text class="lk-label">{{ o.label }}</text>
            <text class="lk-sub">{{ o.sub }}</text>
          </view>
        </scroll-view>
        <view class="sheet-btns">
          <view class="sbtn primary" @tap="linkVisible = false">完成</view>
        </view>
      </view>
    </view>
  </view>
</template>

<script setup>
import { ref, reactive, computed } from 'vue'
import Taro, { useRouter, useDidShow, usePullDownRefresh } from '@tarojs/taro'
import api from '../../services/api'
import { listMemos, listMemosSync, addMemo, updateMemo, removeMemo, toggleMemoDone, memoErrText } from '../../services/memo'

import plusWhite from '../../assets/icons/plus-white.png'
import plusGreen from '../../assets/icons/plus-green.png'
import checkWhite from '../../assets/icons/check-white.png'
import closeGr from '../../assets/icons/close-gray.png'
import notebookGr from '../../assets/icons/notebook-pen-green.png'
import pinGr from '../../assets/icons/map-pin-green.png'
import calGr from '../../assets/icons/calendar-green.png'

const ICO = { plusWhite, plusGreen, checkWhite, close: closeGr, notebook: notebookGr, pin: pinGr, cal: calGr }

const router = useRouter()
const tripId = ref(router.params.tripId || '')
const city = ref(router.params.city ? decodeURIComponent(router.params.city) : '')

const scope = ref(router.params.tripId ? 'trip' : 'mine')

const list = ref([])
const syncErr = ref('')      // 非空 = 顶部常驻「同步失败」提示条（见 load()）
const syncing = ref(false)   // 远端拉取中（切换视角时缓存为空 → 显示「载入中」而不是「还没有备忘」）

// ---------- 关联数据源：拉一次行程详情，供「关联到某天 / 某景点」选择器用 ----------
const dayOptions = ref([])   // [{ day:1, spots:['外滩','豫园'] }]
function loadDays() {
  if (!tripId.value) { dayOptions.value = []; return }
  api.trips.detail(tripId.value).then(d => {
    const days = (d && d.result && d.result.days) || []
    dayOptions.value = days.map((x, i) => ({
      day: x.day || i + 1,
      spots: ((x.spots || []).map(s => s && s.name).filter(Boolean))
    }))
  }).catch(() => { dayOptions.value = [] })
}

const linkOptions = computed(() => {
  const out = []
  dayOptions.value.forEach(d => {
    out.push({ type: 'day', day: d.day, name: '', label: `第${d.day}天`, sub: '挂在当天行程下' })
    d.spots.forEach(s => out.push({ type: 'spot', day: d.day, name: s, label: `第${d.day}天 · ${s}`, sub: '挂在这个景点下' }))
  })
  return out
})

function linkLabel(link) {
  if (!link) return ''
  return link.type === 'spot' ? `第${link.day}天 · ${link.name}` : `第${link.day}天`
}
function isLinkOn(o) {
  const l = form.link
  if (!l) return false
  return l.type === o.type && l.day === o.day && (l.name || '') === (o.name || '')
}

function fmtTime(ts) {
  const d = new Date(ts || Date.now())
  const p = n => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}月${d.getDate()}日 ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 列表加载：两段式 —— ①先同步渲染当前视角的本地缓存（瞬间换内容，不留上一份残影）
// ②再拉远端覆盖（远端为准）。用户实锤：以前只等远端返回，切视角后会残留旧内容几秒才变。
// 竞态保护：进函数先把「视角 + tripId」拍成快照，响应回来时若视角已变（用户快速来回切）就丢弃，
// 否则慢的那个请求会把新视角的列表盖回去（表现为「切回来又变回别的内容」）。
function load() {
  const s = scope.value
  const tid = tripId.value
  const stale = () => s !== scope.value || tid !== tripId.value

  list.value = listMemosSync(s, tid)   // ① 同步缓存：切换瞬间就是「这个视角的内容」
  syncErr.value = ''                   // 上一视角的错误条先清掉，别串味
  syncing.value = true

  listMemos(s, tid).then(l => {
    if (stale()) return                 // 过期响应：丢弃
    list.value = l                      // ② 远端覆盖
    syncErr.value = memoErrText()
  }).catch(() => {}).then(() => {
    if (!stale()) syncing.value = false
  })
}

// 视角切换：必须重新 load —— list 是「按当前视角查出来的快照」，
// 只改 scope 不重查会让两个页签显示同一份数据（2026-10-06 用户实锤：
// 在「我的备忘」加完再切回「本行程」，看到的还是我的那份）。
// 顺带收起弹层，避免把「我的」的草稿带到「本行程」（关联字段只在行程视角可用）。
function switchScope(s) {
  if (scope.value === s) return
  scope.value = s
  editorVisible.value = false
  linkVisible.value = false
  load()
}

// 写操作失败提示：403 = 这条备忘不是你建的（后端只允许创建者改，2026-10-06 契约）
// 协作者能看到别人写的备忘，但勾选/删除/编辑都会被拒 —— 不解释清楚会以为是「点了没反应」
function writeErr(err, fallback) {
  const code = err && (err.code || err.statusCode)
  const msg = code === 403 ? '只有创建者能修改这条备忘' : (code === 404 ? '这条备忘已不存在' : fallback)
  Taro.showToast({ title: msg, icon: 'none', duration: 2500 })
}

function toggle(m) {
  toggleMemoDone(scope.value, tripId.value, m.id).then(() => load())
    .catch(err => writeErr(err, '操作失败，请重试'))
}

function del(m) {
  Taro.showModal({ title: '删除这条备忘？', content: '删除后无法恢复', confirmColor: '#E5484D' }).then(r => {
    if (!r.confirm) return
    removeMemo(scope.value, tripId.value, m.id).then(() => {
      load()
      Taro.showToast({ title: '已删除', icon: 'none' })
    }).catch(err => writeErr(err, '删除失败，请重试'))
  })
}

// ---------- 弹层：新建 / 编辑 ----------
const editorVisible = ref(false)
const editing = ref(null)
const saving = ref(false)
const uploading = ref(false)
const form = reactive({ content: '', images: [], link: null })

// 关联选择器
const linkVisible = ref(false)
const linkText = computed(() => (form.link ? linkLabel(form.link) : '不关联，独立备忘'))
function openLinkPicker() {
  if (!dayOptions.value.length) loadDays()
  linkVisible.value = true
}
function pickLink(o) {
  form.link = o ? { type: o.type, day: o.day, name: o.name || '' } : null
  linkVisible.value = false
}

function openNew() {
  editing.value = null
  form.content = ''
  form.images = []
  form.link = null
  editorVisible.value = true
}
function openEdit(m) {
  editing.value = m
  form.content = m.content || ''
  form.images = (m.images || []).slice()
  form.link = m.link ? Object.assign({}, m.link) : null
  editorVisible.value = true
}
function closeEditor() {
  editorVisible.value = false
}
function save() {
  const content = form.content.trim()
  if (!content) { Taro.showToast({ title: '写点什么再保存', icon: 'none' }); return }
  saving.value = true
  // 关联只在本行程视角生效（个人备忘不挂行程）
  const payload = { content, images: form.images.slice(), link: scope.value === 'trip' ? form.link : null }
  const task = editing.value
    ? updateMemo(scope.value, tripId.value, editing.value.id, payload)
    : addMemo(scope.value, tripId.value, payload)
  task.then(() => {
    editorVisible.value = false
    load()
    Taro.showToast({ title: editing.value ? '已保存' : '已添加', icon: 'success' })
  }).catch(err => {
    writeErr(err, '保存失败')
  }).finally(() => { saving.value = false })
}

// ---------- 图片：选图 → base64 → POST /api/upload/image 换 OSS URL（临时路径重启后失效，必须落服务端）----------
function pickImages() {
  const remain = 9 - form.images.length
  if (remain <= 0) return
  Taro.chooseImage({ count: remain, sizeType: ['compressed'], sourceType: ['album', 'camera'] }).then(res => {
    uploading.value = true
    const fsm = Taro.getFileSystemManager()
    Promise.all(res.tempFilePaths.map(p => new Promise((resolve, reject) => {
      fsm.readFile({ filePath: p, encoding: 'base64', success: r => resolve(r.data), fail: reject })
    }))).then(b64s => {
      return Promise.all(b64s.map(b64 => api.upload.image(b64).then(d => {
        if (!d || !d.url) throw { message: '上传返回为空' }
        return d.url
      })))
    }).then(urls => {
      form.images = form.images.concat(urls)
      Taro.showToast({ title: `已上传 ${urls.length} 张`, icon: 'success' })
    }).catch(e => {
      Taro.showToast({ title: (e && e.message) || '图片上传失败', icon: 'none' })
    }).finally(() => { uploading.value = false })
  }).catch(() => {})   // 用户取消选图
}
function removeImg(k) {
  form.images.splice(k, 1)
}
function preview(urls, k) {
  Taro.previewImage({ current: urls[k], urls })
}

useDidShow(() => { load(); loadDays() })

// 下拉刷新：多人协作没有实时推送，靠手动拉最新（协作者新加的备忘这样同步过来）
usePullDownRefresh(() => {
  load()
  Taro.stopPullDownRefresh()
})
</script>

<style>
.wrap { min-height: 100vh; background: #F7F9F9; padding: 24rpx 24rpx calc(48rpx + env(safe-area-inset-bottom)); box-sizing: border-box; }

.tabs { display: flex; gap: 16rpx; margin-bottom: 12rpx; }
.tab { flex: 1; text-align: center; font-size: 26rpx; color: #868E96; background: #fff; padding: 18rpx 0; border-radius: 999rpx; border: 1rpx solid transparent; }
.tab.on { color: #15803D; background: #E7F9EE; border-color: #22C55E; font-weight: 600; }
.hint { font-size: 22rpx; color: #ADB5BD; padding: 4rpx 8rpx 20rpx; }

/* 同步失败提示条：橙底常驻，点一下重试（协作者看不到别人备忘时，先看这里是不是 404/403） */
.sync-err {
  display: flex; align-items: center; gap: 12rpx;
  background: #FFF7E6; border: 2rpx solid #FFD591; border-radius: 16rpx;
  padding: 18rpx 22rpx; margin-bottom: 20rpx;
}
.se-txt { flex: 1; font-size: 22rpx; color: #AD6800; line-height: 1.5; }
.se-retry { font-size: 22rpx; color: #D46B08; font-weight: 600; flex-shrink: 0; }

.new-btn { display: flex; align-items: center; justify-content: center; gap: 10rpx; background: linear-gradient(135deg, #4ADE80, #22C55E); color: #fff; font-size: 30rpx; font-weight: 600; border-radius: 999rpx; padding: 24rpx 0; box-shadow: 0 10rpx 28rpx rgba(34,197,94,0.28); margin-bottom: 24rpx; }
.new-hover { opacity: 0.88; }
.new-ico { width: 32rpx; height: 32rpx; }

.card { background: #fff; border-radius: 24rpx; padding: 24rpx; }
.memo-item { display: flex; align-items: flex-start; gap: 16rpx; margin-bottom: 16rpx; }
.mi-check { width: 40rpx; height: 40rpx; border-radius: 50%; border: 2rpx solid #C9CDD4; display: flex; align-items: center; justify-content: center; flex-shrink: 0; margin-top: 4rpx; }
.mi-check.on { background: #22C55E; border-color: #22C55E; }
.mi-check-ico { width: 24rpx; height: 24rpx; }
.mi-mid { flex: 1; display: flex; flex-direction: column; }
.mi-text { font-size: 28rpx; color: #333333; line-height: 1.55; }
.mi-text.done { color: #ADB5BD; text-decoration: line-through; }
.mi-link { display: flex; align-items: center; align-self: flex-start; gap: 6rpx; font-size: 20rpx; color: #15803D; background: #E7F9EE; border-radius: 999rpx; padding: 6rpx 16rpx; margin-top: 10rpx; }
.ml-ico { width: 22rpx; height: 22rpx; }
.mi-imgs { display: flex; flex-wrap: wrap; gap: 10rpx; margin-top: 12rpx; }
.mi-img { width: 120rpx; height: 120rpx; border-radius: 12rpx; }
.mi-meta { font-size: 20rpx; color: #ADB5BD; margin-top: 12rpx; }
.mi-del { width: 26rpx; height: 26rpx; padding: 8rpx 12rpx; box-sizing: content-box; flex-shrink: 0; }

.empty { display: flex; flex-direction: column; align-items: center; padding: 100rpx 40rpx; }
.empty-ico { width: 96rpx; height: 96rpx; opacity: 0.5; }
.empty-txt { font-size: 28rpx; color: #495057; margin: 20rpx 0 8rpx; }
.empty-sub { font-size: 22rpx; color: #ADB5BD; text-align: center; line-height: 1.6; }

.mask { position: fixed; left: 0; top: 0; right: 0; bottom: 0; background: rgba(0,0,0,0.45); z-index: 100; display: flex; align-items: flex-end; }
.sheet { width: 100%; background: #fff; border-radius: 32rpx 32rpx 0 0; padding: 32rpx 28rpx calc(32rpx + env(safe-area-inset-bottom)); box-sizing: border-box; }
.sheet-title { font-size: 32rpx; font-weight: 700; color: #15803D; margin-bottom: 20rpx; }
.sheet-input { width: 100%; min-height: 200rpx; background: #F7F9F9; border-radius: 16rpx; padding: 20rpx; font-size: 28rpx; box-sizing: border-box; }
.ph { color: #ADB5BD; }
.sheet-count { text-align: right; font-size: 20rpx; color: #ADB5BD; margin: 8rpx 0 16rpx; }

/* 关联入口行 */
.sheet-link { display: flex; align-items: center; gap: 12rpx; background: #F7F9F9; border-radius: 16rpx; padding: 22rpx 20rpx; margin-bottom: 18rpx; }
.sl-ico { width: 30rpx; height: 30rpx; flex-shrink: 0; }
.sl-label { font-size: 26rpx; color: #495057; }
.sl-val { flex: 1; text-align: right; font-size: 26rpx; color: #15803D; }
.sl-val.none { color: #ADB5BD; }
.sl-arrow { color: #C4C7CC; font-size: 32rpx; }

/* 关联选择器 */
.sheet-sub { font-size: 22rpx; color: #ADB5BD; margin: -8rpx 0 16rpx; }
.lk-scroll { max-height: 660rpx; }
.lk-item { display: flex; flex-direction: column; background: #F7F9F9; border-radius: 16rpx; padding: 22rpx 20rpx; margin-bottom: 12rpx; }
.lk-item.spot { padding-left: 40rpx; }
.lk-item.on { background: #E7F9EE; }
.lk-item.on .lk-label { color: #15803D; font-weight: 600; }
.lk-label { font-size: 28rpx; color: #333333; }
.lk-sub { font-size: 20rpx; color: #ADB5BD; margin-top: 4rpx; }
.sheet-imgs { display: flex; flex-wrap: wrap; gap: 14rpx; }
.img-box { position: relative; }
.img-thumb { width: 150rpx; height: 150rpx; border-radius: 16rpx; }
.img-del { position: absolute; right: -6rpx; top: -6rpx; width: 24rpx; height: 24rpx; padding: 6rpx; background: rgba(255,255,255,0.92); border-radius: 50%; box-sizing: content-box; }
.img-add { width: 150rpx; height: 150rpx; border-radius: 16rpx; border: 1rpx dashed #C9CDD4; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6rpx; }
.img-add-ico { width: 40rpx; height: 40rpx; }
.img-add-txt { font-size: 20rpx; color: #868E96; }
.sheet-tip { font-size: 20rpx; color: #ADB5BD; margin-top: 14rpx; }
.sheet-btns { display: flex; gap: 20rpx; margin-top: 28rpx; }
.sbtn { flex: 1; text-align: center; font-size: 28rpx; padding: 22rpx 0; border-radius: 999rpx; background: #F1F3F5; color: #495057; }
.sbtn.primary { background: #22C55E; color: #fff; font-weight: 600; }
.sbtn.disabled { opacity: 0.6; }
</style>
