// 城市图片映射（Wikimedia Commons 免费授权图，已中心裁方 + 压缩到本地打包，
// 避免线上域名白名单 / 图床可用性问题）
//
// 两套图，用途不同：
//   cityPhoto(city) → 大图，首页「灵感推荐」卡片 + 分享卡片封面用（9 个热门城市，480~560px）
//   cityThumb(city) → 240×240 小缩略图，历史行程列表封面用（21 个城市 = 4 直辖市 + 主要省会）
//
// 都不在表里的城市返回 ''，调用方回退「城市首字 + 渐变块」。
// 署名（CC BY-SA 要求）：见底部 CREDITS 注释。

// ---------- 大图（首页 / 分享） ----------
import beijing from '../assets/home/city-beijing.jpg'
import chongqing from '../assets/home/city-chongqing.jpg'
import jinan from '../assets/home/city-jinan.jpg'
import guangzhou from '../assets/home/city-guangzhou.jpg'
import nanjing from '../assets/home/city-nanjing.jpg'
import shanghai from '../assets/home/city-shanghai.jpg'
import chengdu from '../assets/home/city-chengdu.jpg'
import xian from '../assets/home/city-xian.jpg'
import hangzhou from '../assets/home/city-hangzhou.jpg'

// ---------- 列表缩略图（历史页封面） ----------
import thumbBeijing from '../assets/city-thumb/thumb-beijing.jpg'
import thumbShanghai from '../assets/city-thumb/thumb-shanghai.jpg'
import thumbTianjin from '../assets/city-thumb/thumb-tianjin.jpg'
import thumbChongqing from '../assets/city-thumb/thumb-chongqing.jpg'
import thumbGuangzhou from '../assets/city-thumb/thumb-guangzhou.jpg'
import thumbNanjing from '../assets/city-thumb/thumb-nanjing.jpg'
import thumbHangzhou from '../assets/city-thumb/thumb-hangzhou.jpg'
import thumbChengdu from '../assets/city-thumb/thumb-chengdu.jpg'
import thumbXian from '../assets/city-thumb/thumb-xian.jpg'
import thumbJinan from '../assets/city-thumb/thumb-jinan.jpg'
import thumbWuhan from '../assets/city-thumb/thumb-wuhan.jpg'
import thumbChangsha from '../assets/city-thumb/thumb-changsha.jpg'
import thumbZhengzhou from '../assets/city-thumb/thumb-zhengzhou.jpg'
import thumbShijiazhuang from '../assets/city-thumb/thumb-shijiazhuang.jpg'
import thumbShenyang from '../assets/city-thumb/thumb-shenyang.jpg'
import thumbHaerbin from '../assets/city-thumb/thumb-haerbin.jpg'
import thumbKunming from '../assets/city-thumb/thumb-kunming.jpg'
import thumbFuzhou from '../assets/city-thumb/thumb-fuzhou.jpg'
import thumbHefei from '../assets/city-thumb/thumb-hefei.jpg'
import thumbNanchang from '../assets/city-thumb/thumb-nanchang.jpg'
import thumbGuiyang from '../assets/city-thumb/thumb-guiyang.jpg'

const CITY_PHOTOS = {
  北京: beijing,
  重庆: chongqing,
  济南: jinan,
  广州: guangzhou,
  南京: nanjing,
  上海: shanghai,
  成都: chengdu,
  西安: xian,
  杭州: hangzhou
}

const CITY_THUMBS = {
  // 直辖市
  北京: thumbBeijing,
  上海: thumbShanghai,
  天津: thumbTianjin,
  重庆: thumbChongqing,
  // 主要省会 / 一线
  广州: thumbGuangzhou,
  南京: thumbNanjing,
  杭州: thumbHangzhou,
  成都: thumbChengdu,
  西安: thumbXian,
  济南: thumbJinan,
  武汉: thumbWuhan,
  长沙: thumbChangsha,
  郑州: thumbZhengzhou,
  石家庄: thumbShijiazhuang,
  沈阳: thumbShenyang,
  哈尔滨: thumbHaerbin,
  昆明: thumbKunming,
  福州: thumbFuzhou,
  合肥: thumbHefei,
  南昌: thumbNanchang,
  贵阳: thumbGuiyang
}

// 城市名归一化：去「市」后缀、去空白（「广州市」→「广州」）
function normCityName(city) {
  return String(city || '').trim().replace(/市$/, '')
}

// 大图：有照片返回本地图片路径，没有返回 ''（调用方回退渐变首字块）
export function cityPhoto(city) {
  return CITY_PHOTOS[normCityName(city)] || ''
}

// 列表缩略图：同上
export function cityThumb(city) {
  return CITY_THUMBS[normCityName(city)] || ''
}

// 供校验 / 调试：当前缩略图覆盖的城市名
export const THUMB_CITIES = Object.keys(CITY_THUMBS)

/*
CREDITS（来源均为 Wikimedia Commons / 维基百科条目首图，作者与许可见各文件页）：

【列表缩略图 thumb-*.jpg 的原始文件】
- 北京    File:Skyline of Beijing CBD with B-5906 approaching (20211016171955) (1).jpg
- 上海    File:Pudong Shanghai November 2017 panorama.jpg
- 天津    File:Tianjin Eye and Tianjin.jpg
- 重庆    File:Chongqing Nightscape.jpg
- 广州    File:Canton Tower 20241027.jpg
- 南京    File:Qinhuai River along Fuzimiao 2008.jpg
- 杭州    File:Sunset at West Lake (Xi Hu), Hangzhou (2790877585).jpg
- 成都    File:雪山下的成都市天际线 Chengdu skyline with snow capped mountains.jpg
- 西安    File:西安钟楼2020 (1).jpg
- 济南    File:China Jinan 5196975.jpg
- 武汉    File:CN - Hubei - Wuhan - Kranichpagode.jpg
- 长沙    File:爱晚亭（秋-侧面）.jpg
- 郑州    File:Zhengzhou CBDcity.jpg
- 石家庄  File:Liberation Square, Shijiazhuang.jpg
- 沈阳    File:沈阳浑河大桥天际线.jpg
- 哈尔滨  File:Saint Sophia Cathedral, Harbin 8.jpg
- 昆明    File:五华区与盘龙区天际线 - 航拍 - 2025-05-16 03.jpg
- 福州    File:Fuzhou Taixi CBD.jpg
- 合肥    File:天鹅湖.jpg
- 南昌    File:滕王阁 2024-08-05 04.jpg
- 贵阳    File:Jiaxiu Pavilion, Guiyang.jpg

【首页大图 city-*.jpg 的原始文件】（首页灵感卡用，420×420）：
- 北京 File:Sunset of the Forbidden City 2006.JPG — kallgan CC BY-SA 3.0
- 重庆 File:202308 Hongya Cave at night from Qiansimen Bridge.jpg — Jonashtand CC BY-SA 4.0
- 济南 File:Lixia Pavillion, Daming Lake, Jinan in October.jpg — HMGiovanniV CC BY-SA 4.0
- 广州 File:Canton Tower at night Guangzhou 2024 dllu.jpg — Daniel Lu (dllu) CC BY-SA 4.0
- 南京 File:Night Confucius Temple in Nanjing, 20170304.jpg — 蘇一品 CC BY-SA 2.5
- 上海 File:A night at the Bund in Shanghai.jpg — David Zhang CC BY-SA 2.0
- 成都 File:Chengdu Jinli-Straße 09.jpg — Zairon CC BY-SA 4.0
- 西安 File:Wild goose pagoda xian china.jpg — Tuxnduke CC BY-SA 3.0
- 杭州 File:20260424 West Lake and Hangzhou Skyline.jpg — Windmemories CC BY-SA 4.0

所有图片均经中心裁方 / 缩放 / 压缩处理（列表缩略图统一 240×240、JPEG q66；首页大图统一 420×420、JPEG q65）。
如本项目转为公开发布，请到对应文件页核对作者署名与最新许可条款。
*/
