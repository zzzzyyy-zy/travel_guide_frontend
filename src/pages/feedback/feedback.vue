<template>
  <view class="fb-page">
    <!-- 联系邮箱（必传，后端 400 兜底） -->
    <view class="fb-label">联系邮箱</view>
    <input class="fb-input" v-model="contact" type="text" maxlength="60"
      placeholder="方便我们回复你，例如 you@qq.com" placeholder-class="fb-ph" />

    <!-- 具体意见（必传） -->
    <view class="fb-label">意见或建议</view>
    <view class="fb-textarea-box">
      <textarea class="fb-textarea" v-model="content" maxlength="500" :disabled="submitting"
        placeholder="说说哪里好用、哪里别扭，或者你希望加什么功能（500 字以内）"
        placeholder-class="fb-ph" />
      <view class="fb-count">{{ (content || '').length }}/500</view>
    </view>

    <!-- 图片（可选，最多 3 张）：选图 → base64 → /api/upload/image 换 OSS URL → 提交 URL 数组 -->
    <view class="fb-label">截图 / 照片（可选，最多 3 张）</view>
    <view class="fb-imgs">
      <view class="fb-img" v-for="(u, k) in images" :key="k">
        <image class="fb-img-pic" :src="u" mode="aspectFill" @tap="previewImg(k)" />
        <view class="fb-img-del" @tap="removeImg(k)">×</view>
      </view>
      <view class="fb-img-add" v-if="images.length < 3" :class="{ dim: uploading }" @tap="pickImages">
        <text class="fb-add-plus">+</text>
        <text class="fb-add-txt">{{ uploading ? '上传中…' : '添加图片' }}</text>
      </view>
    </view>

    <view class="fb-submit" :class="{ disabled: !canSubmit }" @tap="submit">
      {{ submitting ? '提交中…' : '提交反馈' }}
    </view>
    <view class="fb-foot">你的反馈会直达开发团队，感谢每一个建议</view>
  </view>
</template>

<script setup>
import { ref, computed } from 'vue'
import Taro from '@tarojs/taro'
import api from '../../services/api'
import { requireLogin } from '../../utils/auth'

const contact = ref('')
const content = ref('')
const images = ref([])        // 已上传成功的 OSS URL（展示与提交都用它）
const uploading = ref(false)
const submitting = ref(false)

// 提交按钮可点条件：两项必传 + 不在上传/提交中（后端 400 只做兜底，前端先拦）
const canSubmit = computed(() =>
  !!(contact.value || '').trim() && !!(content.value || '').trim() && !uploading.value && !submitting.value
)

// ---------- 选图 → 上传换 URL（复用 memo/itinerary 同一套链路） ----------
function pickImages() {
  const remain = 3 - images.value.length
  if (remain <= 0 || uploading.value) return
  Taro.chooseImage({ count: remain, sizeType: ['compressed'], sourceType: ['album', 'camera'] }).then(res => {
    uploading.value = true
    const fsm = Taro.getFileSystemManager()
    Promise.all(res.tempFilePaths.map(p => new Promise((resolve, reject) => {
      fsm.readFile({ filePath: p, encoding: 'base64', success: r => resolve(r.data), fail: reject })
    }))).then(b64s => {
      // 逐张换 URL：一张失败不让其它白传（Promise.all 整体失败也行，但逐张能把已成功的留下）
      return Promise.all(b64s.map(b64 => api.upload.image(b64).then(d => {
        if (!d || !d.url) throw { message: '上传返回为空' }
        return d.url
      })))
    }).then(urls => {
      images.value = images.value.concat(urls)
    }).catch(e => {
      Taro.showToast({ title: (e && e.message) || '图片上传失败', icon: 'none' })
    }).finally(() => { uploading.value = false })
  }).catch(() => {})   // 用户取消选图不算错误
}

function removeImg(k) { images.value.splice(k, 1) }

function previewImg(k) {
  Taro.previewImage({ urls: images.value, current: images.value[k] }).catch(() => {})
}

// ---------- 提交（POST /api/feedback；400 契约异常按后端 message 提示） ----------
function submit() {
  const mail = (contact.value || '').trim()
  const text = (content.value || '').trim()
  if (!mail) return Taro.showToast({ title: '先填联系邮箱', icon: 'none' })
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(mail)) return Taro.showToast({ title: '邮箱格式不对，检查一下', icon: 'none' })
  if (!text) return Taro.showToast({ title: '说说你的意见吧', icon: 'none' })
  if (submitting.value || uploading.value) return
  requireLogin(() => {
    submitting.value = true
    api.feedback.submit(mail, text, images.value).then(() => {
      Taro.showToast({ title: '反馈已收到，谢谢！', icon: 'success' })
      setTimeout(() => Taro.navigateBack({ fail: () => Taro.switchTab({ url: '/pages/profile/profile' }) }), 1200)
    }).catch(e => {
      const code = (e && e.code) || ''
      const msg = (e && e.message) || ''
      // 400 契约异常按后端语义提示；其余给通用文案
      Taro.showToast({ title: code === 400 && msg ? msg : (msg || '提交失败，稍后再试'), icon: 'none' })
    }).finally(() => { submitting.value = false })
  })
}
</script>

<style>
.fb-page { min-height: 100vh; background: #F7F9F9; padding: 28rpx 28rpx calc(60rpx + env(safe-area-inset-bottom)); box-sizing: border-box; }
.fb-label { font-size: 26rpx; font-weight: 600; color: #2B312D; margin: 26rpx 4rpx 14rpx; }
.fb-ph { color: #B3BAB6; }

.fb-input {
  background: #FFFFFF; border-radius: 20rpx; height: 92rpx; padding: 0 28rpx;
  font-size: 28rpx; color: #262B2E;
  box-shadow: 0 4rpx 16rpx rgba(31, 45, 37, 0.04);
}

.fb-textarea-box {
  background: #FFFFFF; border-radius: 20rpx; padding: 24rpx 28rpx;
  box-shadow: 0 4rpx 16rpx rgba(31, 45, 37, 0.04);
}
.fb-textarea { width: 100%; min-height: 240rpx; font-size: 28rpx; color: #262B2E; line-height: 1.6; }
.fb-count { text-align: right; font-size: 22rpx; color: #B3BAB6; margin-top: 8rpx; }

.fb-imgs { display: flex; flex-wrap: wrap; gap: 18rpx; }
.fb-img { position: relative; width: 180rpx; height: 180rpx; }
.fb-img-pic { width: 100%; height: 100%; border-radius: 16rpx; }
.fb-img-del {
  position: absolute; top: -12rpx; right: -12rpx; width: 40rpx; height: 40rpx; border-radius: 50%;
  background: rgba(0, 0, 0, 0.55); color: #fff; font-size: 28rpx; line-height: 38rpx; text-align: center;
}
.fb-img-add {
  width: 180rpx; height: 180rpx; border-radius: 16rpx;
  border: 2rpx dashed #C6CCC9; background: #FFFFFF;
  display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 6rpx;
}
.fb-img-add.dim { opacity: 0.5; }
.fb-add-plus { font-size: 48rpx; color: #22C55E; line-height: 1; }
.fb-add-txt { font-size: 22rpx; color: #9AA3A0; }

.fb-submit {
  margin-top: 48rpx; height: 96rpx; border-radius: 999rpx;
  background: #22C55E; color: #fff; font-size: 30rpx; font-weight: 600;
  display: flex; align-items: center; justify-content: center;
  box-shadow: 0 8rpx 24rpx rgba(34, 197, 94, 0.28);
}
.fb-submit.disabled { opacity: 0.45; }
.fb-foot { text-align: center; font-size: 22rpx; color: #ADB5BD; margin-top: 20rpx; }
</style>
