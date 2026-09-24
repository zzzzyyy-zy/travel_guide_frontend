// 定位统一入口：默认 real（真实模糊定位），失败自动回退 demo 回放
// real   : Taro.getFuzzyLocation —— 个人主体可申请，精度约 1 公里
// manual : 地图选点，需用户在开放范围内
// demo   : 预设坐标回放，演示兜底（不依赖任何定位权限）
import Taro from '@tarojs/taro'

let MODE = 'real'

const DEMO_TRACK = [
  { lng: 113.6, lat: 23.5, name: '景区主入口' },
  { lng: 113.61, lat: 23.5, name: '湖滨栈道' },
  { lng: 113.62, lat: 23.51, name: '古亭' },
  { lng: 113.63, lat: 23.52, name: '康养径出口' }
]

let demoIndex = 0

function demoPosition() {
  const p = DEMO_TRACK[demoIndex % DEMO_TRACK.length]
  demoIndex++
  console.log('[position] demo 回放：', p.name)
  return Promise.resolve(p)
}

// 定位结果缓存：只防「手快连点」撞微信限频（getFuzzyLocation:fail frequency limit）。
// TTL 5 秒：隔几秒再点就是新的一次定位意图，应重新定位；
// force=true（用户主动点「我到了哪个景点」）直接绕过缓存强制重定位
const CACHE_TTL = 5 * 1000
let cache = null
let cacheAt = 0

function getPosition(force) {
  if (MODE === 'real') return realPosition(force)
  if (MODE === 'manual') return manualPosition()
  return demoPosition()
}

// real 模式失败的兜底点：固定回「景区主入口」，不轮换。
// 轮换回放只给 MODE='demo' 演示模式用；真实模式失败若每次换坐标，
// identify 会一会儿认成这个景点、一会儿认成那个，看起来像「定位乱跳」
function fallbackPosition() {
  return Promise.resolve(DEMO_TRACK[0])
}

let warned = false

function realPosition(force) {
  if (!force && cache && Date.now() - cacheAt < CACHE_TTL) {
    console.log('[position] 5 秒内重复调用，复用缓存坐标')
    return Promise.resolve(cache)
  }
  return new Promise((resolve) => {
    Taro.getFuzzyLocation({
      // getFuzzyLocation 只支持 wgs84（传 gcj02 会 fail），拿到后转 gcj02：
      // 微信地图组件、后端腾讯地图 API 统一 GCJ-02（联调纪要 9.5）
      type: 'wgs84',
      success: res => {
        cache = wgs84ToGcj02(res.latitude, res.longitude)
        cacheAt = Date.now()
        resolve(cache)
      },
      fail: err => {
        console.warn('[position] 模糊定位失败，回退兜底坐标', err)
        // 按真实错误分类提示，避免误导（开发者工具模拟器必失败，只提示一次）
        const msg = (err && err.errMsg) || ''
        let tip = '定位失败，正在使用演示坐标'
        if (/auth|denied|permission/i.test(msg)) tip = '未获得定位权限，正在使用演示坐标'
        else if (/freq/i.test(msg)) tip = '定位太频繁，稍后再试'
        if (!warned) {
          Taro.showToast({ title: tip, icon: 'none', duration: 2500 })
          warned = true
        }
        resolve(fallbackPosition())
      }
    })
  })
}

// ---------- wgs84 → gcj02（国测局标准偏移算法） ----------
const PI = Math.PI
const A = 6378245.0
const EE = 0.00669342162296594323

function transformLat(x, y) {
  let ret = -100.0 + 2.0 * x + 3.0 * y + 0.2 * y * y + 0.1 * x * y + 0.2 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(y * PI) + 40.0 * Math.sin(y / 3.0 * PI)) * 2.0 / 3.0
  ret += (160.0 * Math.sin(y / 12.0 * PI) + 320 * Math.sin(y * PI / 30.0)) * 2.0 / 3.0
  return ret
}

function transformLng(x, y) {
  let ret = 300.0 + x + 2.0 * y + 0.1 * x * x + 0.1 * x * y + 0.1 * Math.sqrt(Math.abs(x))
  ret += (20.0 * Math.sin(6.0 * x * PI) + 20.0 * Math.sin(2.0 * x * PI)) * 2.0 / 3.0
  ret += (20.0 * Math.sin(x * PI) + 40.0 * Math.sin(x / 3.0 * PI)) * 2.0 / 3.0
  ret += (150.0 * Math.sin(x / 12.0 * PI) + 300.0 * Math.sin(x / 30.0 * PI)) * 2.0 / 3.0
  return ret
}

function outOfChina(lat, lng) {
  return lng < 72.004 || lng > 137.8347 || lat < 0.8293 || lat > 55.8271
}

function wgs84ToGcj02(lat, lng) {
  if (outOfChina(lat, lng)) return { lat, lng }
  let dLat = transformLat(lng - 105.0, lat - 35.0)
  let dLng = transformLng(lng - 105.0, lat - 35.0)
  const radLat = lat / 180.0 * PI
  let magic = Math.sin(radLat)
  magic = 1 - EE * magic * magic
  const sqrtMagic = Math.sqrt(magic)
  dLat = (dLat * 180.0) / ((A * (1 - EE)) / (magic * sqrtMagic) * PI)
  dLng = (dLng * 180.0) / (A / sqrtMagic * Math.cos(radLat) * PI)
  return { lat: lat + dLat, lng: lng + dLng }
}

function manualPosition() {
  return new Promise((resolve, reject) => {
    Taro.chooseLocation({ success: resolve, fail: reject })
  })
}

function setMode(mode) {
  MODE = mode
}

export { getPosition, setMode }
