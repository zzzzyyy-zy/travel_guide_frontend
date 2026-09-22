// base64 → 本地临时文件（联调纪要 9.3）
// 为什么不能直接用 data URL：
//   ① 超长 base64 在真机上渲染性能差、极端情况不显示
//   ② 保存到相册（saveImageToPhotosAlbum）、音频播放等能力只认文件路径
// 约定：后端返回的 base64 一律走这里转成临时文件再使用
import Taro from '@tarojs/taro'

// base64（可带 data: 前缀）→ 临时文件路径；ext 如 'png' / 'mp3'
export function base64ToTempFile(base64, ext) {
  const clean = String(base64 || '').replace(/^data:[^;]+;base64,/, '')
  if (!clean) return Promise.reject(new Error('base64 内容为空'))
  const extName = ext || 'png'
  return new Promise((resolve, reject) => {
    let buffer
    try {
      buffer = Taro.base64ToArrayBuffer(clean)
    } catch (e) {
      return reject(e)
    }
    // 写入用户目录（writeFile 只允许 USER_DATA_PATH 与临时目录）
    const filePath = `${Taro.env.USER_DATA_PATH}/st_${Date.now()}.${extName}`
    Taro.getFileSystemManager().writeFile({
      filePath,
      data: buffer,
      encoding: 'binary',
      success: () => resolve(filePath),
      fail: err => reject(err)
    })
  })
}

// 保存图片到相册（带授权引导：用户拒绝过授权时引导去设置页打开）
export function saveImageToAlbum(filePath) {
  return Taro.saveImageToPhotosAlbum({ filePath }).catch(err => {
    const msg = (err && (err.errMsg || err.message)) || ''
    if (msg.indexOf('auth deny') > -1 || msg.indexOf('authorize') > -1) {
      Taro.showModal({
        title: '需要相册权限',
        content: '请在设置里允许「保存到相册」后再试',
        confirmText: '去设置'
      }).then(r => { if (r.confirm) Taro.openSetting() })
      throw err
    }
    throw err
  })
}
