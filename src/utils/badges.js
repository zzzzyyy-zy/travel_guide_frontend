// 成就徽章共享逻辑：profile 页「我的成就」预览卡 + pages/badges 勋章墙共用
// 后端契约 GET /api/growth/achievements → data 为裸数组（见 services/mock.js ACHIEVEMENTS）：
//   [{ id, name, progress, current, title, levels: [{ count, title }] }]
//   current = 已解锁最高档（0 = 未解锁）；levels 含未解锁档位，前端据 current 高亮
import wandWh from '../assets/icons/wand-white.png'               // 攻略策划 Lv1 旅行启蒙
import pencilWhite from '../assets/icons/pencil-white.png'        // 攻略策划 Lv2 行程规划师
import bookOpenWh from '../assets/icons/book-open-white.png'      // 攻略策划 Lv3 攻略大师
import routeWh from '../assets/icons/route-white.png'             // 攻略策划 Lv4 环球策划师
import mapPinWh from '../assets/icons/map-pin-white.png'          // 足迹打卡 Lv1 初探足迹
import checkWhite from '../assets/icons/check-white.png'          // 足迹打卡 Lv2 足迹行者
import nearbyWh from '../assets/icons/nearby-white.png'           // 足迹打卡 Lv3 城市漫游者
import cameraWh from '../assets/icons/camera-white.png'           // 足迹打卡 Lv4 旅行收藏家
import calendarWhite from '../assets/icons/calendar-white.png'    // 坚持不懈 Lv1 七日之约
import flameWh from '../assets/icons/flame-white.png'             // 坚持不懈 Lv2 月度坚守
import rotateCcwWh from '../assets/icons/rotate-ccw-white.png'    // 坚持不懈 Lv3 持之以恒
import handshakeWh from '../assets/icons/handshake-white.png'     // 结伴同行 Lv1 引路人
import usersWh from '../assets/icons/users-white.png'             // 结伴同行 Lv2 结伴而行
import share2White from '../assets/icons/share2-white.png'        // 结伴同行 Lv3 旅友召集人
import landmarkWh from '../assets/icons/landmark-white.png'       // 城市猎人 Lv1 三城记
import mapWhite from '../assets/icons/map-white.png'              // 城市猎人 Lv2 十城游记
import trophyWh from '../assets/icons/trophy-white.png'           // 城市猎人 Lv3 城市猎人
import heartLineWh from '../assets/icons/heart-line-white.png'    // 收藏家 Lv1 收藏初现
import starFillWh from '../assets/icons/star-fill-white.png'      // 收藏家 Lv2 攻略收藏家

// 系列固定配色 + 19 枚互不重复白线条图标（每个系列按等级递进换图标，超出档位沿用最高档）
export const BADGE_DEFS = {
  guide:    { tone: 'gold',   icons: [wandWh, pencilWhite, bookOpenWh, routeWh] },
  checkin:  { tone: 'green',  icons: [mapPinWh, checkWhite, nearbyWh, cameraWh] },
  streak:   { tone: 'blue',   icons: [calendarWhite, flameWh, rotateCcwWh] },
  invite:   { tone: 'purple', icons: [handshakeWh, usersWh, share2White] },
  city:     { tone: 'warm',   icons: [landmarkWh, mapWhite, trophyWh] },
  favorite: { tone: 'pink',   icons: [heartLineWh, starFillWh] }
}

// 归一化：① 包裹层（裸数组 / {list|achievements|records|items|series}）
//          ② 字段别名（seriesId/cur/unlockedLevel/need/threshold 等）
//          ③ levels 兼容「数字数组」与「对象数组」
// 全猜不中时返回带兜底名的空档系列，至少把徽章画出来而不是整面空白
export function normAchvs(raw) {
  let list = Array.isArray(raw) ? raw : ((raw && (raw.list || raw.achievements || raw.records || raw.items || raw.series)) || [])
  if (!Array.isArray(list)) list = []
  return list.map(a => {
    a = a || {}
    const lvRaw = a.levels || a.levelList || a.tiers || a.stages || []
    const lvArr = Array.isArray(lvRaw) ? lvRaw : Object.keys(lvRaw).sort((x, y) => x - y).map(k => lvRaw[k])
    return {
      id: String(a.id != null ? a.id : (a.seriesId != null ? a.seriesId : (a.key != null ? a.key : (a.code != null ? a.code : (a.type != null ? a.type : a.name || ''))))),
      name: a.name || a.seriesName || a.title || '成就系列',
      title: (a.name && a.title) ? a.title : (a.currentTitle || ''),
      progress: Number(a.progress != null ? a.progress : (a.cur != null ? a.cur : (a.count != null ? a.count : (a.total != null ? a.total : 0)))) || 0,
      current: Number(a.current != null ? a.current : (a.unlockedLevel != null ? a.unlockedLevel : (a.unlocked != null ? a.unlocked : (a.level != null ? a.level : 0)))) || 0,
      levels: lvArr.map(l => typeof l === 'number'
        ? { count: l, title: '' }
        : { count: Number(l && (l.count != null ? l.count : (l.need != null ? l.need : l.threshold))) || 0, title: (l && (l.title || l.name)) || '' })
    }
  })
}

// 系列 → 一枚一枚的徽章（每个档位一枚）；unlocked 由 current 推导，进度条按当前次数/该档门槛
export function buildBadges(achvs) {
  const out = []
  for (const a of (achvs || [])) {
    const cfg = BADGE_DEFS[a.id] || BADGE_DEFS.guide
    const cur = a.progress || 0
    ;(a.levels || []).forEach((l, i) => {
      const need = l.count || 0
      const unlocked = (a.current || 0) >= i + 1
      const remain = Math.max(0, need - cur)
      out.push({
        key: a.id + '-' + i,
        lv: i + 1,
        title: l.title || a.name,
        desc: a.name + ' · 累计 ' + need + ' 次',
        unlocked,
        state: unlocked ? '已达成' : (remain <= 0 ? '即将达成' : '还差 ' + remain + ' 次'),
        count: need,
        progress: cur,
        pct: unlocked ? 100 : Math.min(100, Math.round((cur / (need || 1)) * 100)),
        tone: cfg.tone,
        ico: cfg.icons[Math.min(i, cfg.icons.length - 1)]
      })
    })
  }
  return out
}
