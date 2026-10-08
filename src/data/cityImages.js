// 城市真实风景照映射（Wikimedia Commons 免费授权图，已中心裁 1:1 压缩到本地，避免线上域名白名单问题）
// 署名（CC BY-SA 要求）：见底部 CREDITS 注释
import beijing from '../assets/home/city-beijing.jpg'
import chongqing from '../assets/home/city-chongqing.jpg'
import jinan from '../assets/home/city-jinan.jpg'
import guangzhou from '../assets/home/city-guangzhou.jpg'
import nanjing from '../assets/home/city-nanjing.jpg'
import shanghai from '../assets/home/city-shanghai.jpg'
import chengdu from '../assets/home/city-chengdu.jpg'
import xian from '../assets/home/city-xian.jpg'
import hangzhou from '../assets/home/city-hangzhou.jpg'

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

// 城市名归一化：去「市」后缀、去空白（「广州市」→「广州」）
function normCityName(city) {
  return String(city || '').trim().replace(/市$/, '')
}

// 有照片返回本地图片路径，没有返回 ''（调用方回退渐变首字块）
export function cityPhoto(city) {
  return CITY_PHOTOS[normCityName(city)] || ''
}

/*
CREDITS（Wikimedia Commons，CC BY-SA，作者见下）：
- 北京  File:Sunset of the Forbidden City 2006.JPG        — kallgan            CC BY-SA 3.0
- 重庆  File:202308 Hongya Cave at night from Qiansimen Bridge.jpg — Jonashtand CC BY-SA 4.0
- 济南  File:Lixia Pavillion, Daming Lake, Jinan in October.jpg    — HMGiovanniV CC BY-SA 4.0
- 广州  File:Canton Tower at night Guangzhou 2024 dllu.jpg        — Daniel Lu (dllu) CC BY-SA 4.0
- 南京  File:Night Confucius Temple in Nanjing, 20170304.jpg      — 蘇一品           CC BY-SA 2.5
- 上海  File:A night at the Bund in Shanghai.jpg                  — David Zhang      CC BY-SA 2.0
- 成都  File:Chengdu Jinli-Straße 09.jpg                          — Zairon           CC BY-SA 4.0
- 西安  File:Wild goose pagoda xian china.jpg                     — Tuxnduke         CC BY-SA 3.0
- 杭州  File:20260424 West Lake and Hangzhou Skyline.jpg          — Windmemories     CC BY-SA 4.0
图片经裁剪/缩放/压缩处理。
*/
