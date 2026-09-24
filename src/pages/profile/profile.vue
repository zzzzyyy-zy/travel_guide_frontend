<template>
  <view class="wrap">
    <!-- 用户卡：点头像换头像，点昵称改昵称（POST /api/user/profile 部分更新） -->
    <view class="user-card">
      <view class="avatar-box" @tap="changeAvatar">
        <image v-if="avatarUrl" class="avatar-img" :src="avatarUrl" mode="aspectFill" />
        <view v-else class="avatar">{{ initial }}</view>
        <view class="avatar-edit">✎</view>
      </view>
      <view class="u-info" @tap="editNickname">
        <view class="u-name">{{ nickname }} <text class="name-edit">✎</text></view>
        <view class="u-sub">{{ sessionState.loggedIn ? '已登录 · 点昵称可修改' : '未登录' }}</view>
      </view>
    </view>

    <!-- 微信资料引导卡：昵称/头像任一为空时显示，用官方「头像昵称填写能力」获取 -->
    <view class="card wx-card" v-if="needWxProfile">
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

    <view class="card">
      <view class="cell" @tap="goHistory">
        <text class="c-ico">🧾</text>
        <text class="c-label">我的行程</text>
        <text class="c-arrow">›</text>
      </view>
      <view class="cell" @tap="about">
        <text class="c-ico">ℹ️</text>
        <text class="c-label">关于智慧文旅</text>
        <text class="c-arrow">›</text>
      </view>
    </view>

    <view class="card">
      <view class="cell danger" @tap="confirmLogout">
        <text class="c-ico">🚪</text>
        <text class="c-label">退出登录</text>
        <text class="c-arrow">›</text>
      </view>
    </view>

    <view class="foot">智慧文旅 v1.0 · 课程项目演示版</view>
  </view>
</template>

<script setup>
import { computed, ref } from 'vue'
import Taro from '@tarojs/taro'
import { sessionState, logout, requireLogin } from '../../utils/auth'
import { saveUser } from '../../utils/token'
import api from '../../services/api'

// 从响应式镜像取用户信息（token.js 的 sessionState，经 auth 转出），不直接读 storage
const nickname = computed(() => {
  const u = sessionState.user
  return (u && u.nickname) || '微信用户'
})
const initial = computed(() => nickname.value.charAt(0) || '微')
const avatarUrl = computed(() => (sessionState.user && sessionState.user.avatarUrl) || '')

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

function goHistory() {
  Taro.switchTab({ url: '/pages/history/history' })
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
.wrap { min-height: 100vh; background: #F7F9F9; padding: 24rpx; box-sizing: border-box; }

.user-card {
  display: flex; align-items: center;
  background: linear-gradient(135deg, #56B3A6 0%, #48A999 60%, #3D9184 100%);
  border-radius: 24rpx; padding: 40rpx 32rpx; margin-bottom: 24rpx;
}
.avatar-box { position: relative; width: 108rpx; height: 108rpx; }
.avatar {
  width: 108rpx; height: 108rpx; border-radius: 50%;
  background: rgba(255, 255, 255, 0.25); border: 4rpx solid rgba(255, 255, 255, 0.6);
  color: #FFFFFF; font-size: 44rpx; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
}
.avatar-img {
  width: 108rpx; height: 108rpx; border-radius: 50%;
  border: 4rpx solid rgba(255, 255, 255, 0.6);
}
/* 角标铅笔提示：可点击换头像 */
.avatar-edit {
  position: absolute; right: -6rpx; bottom: -6rpx;
  width: 40rpx; height: 40rpx; border-radius: 50%;
  background: #FFFFFF; color: #48A999; font-size: 24rpx;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 2rpx 8rpx rgba(0, 0, 0, 0.15);
}
.u-info { margin-left: 24rpx; color: #FFFFFF; flex: 1; }
.u-name { font-size: 34rpx; font-weight: 600; }
/* 昵称后的铅笔提示：可点击改昵称 */
.name-edit { font-size: 26rpx; opacity: 0.75; font-weight: 400; margin-left: 8rpx; }
.u-sub { font-size: 24rpx; opacity: 0.85; margin-top: 8rpx; }

.card {
  background: #FFFFFF; border-radius: 20rpx;
  margin-bottom: 24rpx; overflow: hidden;
}
.cell {
  display: flex; align-items: center;
  padding: 30rpx 28rpx;
  border-bottom: 1rpx solid #E8E8E8;
}
.cell:last-child { border-bottom: none; }
.c-ico { font-size: 34rpx; margin-right: 20rpx; }
.c-label { flex: 1; font-size: 30rpx; color: #333333; }
.danger .c-label { color: #E5484D; }
.c-arrow { color: #C4C7CC; font-size: 36rpx; }

.foot { text-align: center; color: #868E96; font-size: 24rpx; margin-top: 40rpx; }

/* 微信资料引导卡 */
.wx-card { padding: 32rpx 28rpx; }
.wx-title { font-size: 32rpx; font-weight: 600; color: #333333; }
.wx-note { font-size: 24rpx; color: #868E96; margin-top: 8rpx; }
.wx-row { display: flex; align-items: center; margin-top: 28rpx; }
/* button 默认样式重置：只当头像选择器用 */
.wx-avatar-btn {
  width: 120rpx; height: 120rpx; padding: 0; margin: 0;
  border-radius: 50%; overflow: hidden;
  background: #E4F1EF; border: 2rpx dashed #48A999;
  display: flex; align-items: center; justify-content: center;
  line-height: 1;
}
.wx-avatar-btn::after { border: none; }
.wx-avatar-preview { width: 120rpx; height: 120rpx; }
.wx-avatar-ph { font-size: 24rpx; color: #48A999; }
.wx-name-input {
  flex: 1; margin-left: 24rpx;
  height: 88rpx; padding: 0 24rpx;
  background: #F7F9F9; border-radius: 16rpx;
  font-size: 30rpx; color: #333333;
}
.wx-save {
  margin-top: 28rpx; height: 84rpx; line-height: 84rpx;
  background: #48A999; color: #FFFFFF;
  border-radius: 16rpx; text-align: center; font-size: 30rpx;
}
</style>
