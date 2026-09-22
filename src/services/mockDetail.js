// 模拟 TripDetail 生成器：严格按后端接口文档 7.2 章 result 结构输出
// result = { city, overview, estimatedTotalCost, days[{ day,title,theme,spots[],food[],note,estimatedCostCny }], tips, sources[{title,url,site}] }
// 费用口径：全部为「全队合计」（元，整数），与用户填的总预算可比

const DAY_TEMPLATES = [
  {
    title: '西湖经典人文线',
    theme: '城市地标',
    note: '午后预留休息时间；节假日可缩短湖边步行路段。',
    spots: [
      { name: '西湖风景名胜区', reason: '代表性景观，适合以较缓节奏游览湖滨区域。', tip: '节假日客流较大，建议避开断桥最拥挤时段。', duration: '2.5小时', transport: '公交/地铁', estimatedCostCny: 0, lat: 30.24537, lng: 120.14751 },
      { name: '中国茶叶博物馆', reason: '室内场馆，午后避晒，适合慢节奏参观。', tip: '周一闭馆，出行前确认开放时间。', duration: '2小时', transport: '公交', estimatedCostCny: 0, lat: 30.22692, lng: 120.12493 }
    ],
    food: [
      { name: '湖滨商圈本地菜午餐', reason: '靠近上午行程，减少往返距离。', estimatedCostCny: 320 }
    ]
  },
  {
    title: '灵隐与运河慢游线',
    theme: '寺院与人文',
    note: '灵隐入口排队较长，预留安检时间；下午保留机动时间。',
    spots: [
      { name: '灵隐寺景区', reason: '代表性人文景点，上午游览体感较舒适。', tip: '节假日入口排队时间较长，预留安检和步行时间。', duration: '2小时', transport: '公交/打车', estimatedCostCny: 300, lat: 30.24062, lng: 120.10284 },
      { name: '京杭大运河杭州段', reason: '了解城市发展与运河文化，游览强度低。', tip: '沿河步道较长，可根据体力缩短步行范围。', duration: '2小时', transport: '公交', estimatedCostCny: 0, lat: 30.31964, lng: 120.14192 }
    ],
    food: [
      { name: '桥西历史街区午餐', reason: '与下午行程相邻，减少交通消耗。', estimatedCostCny: 360 }
    ]
  }
]

const SOURCES = [
  { title: '西湖风景名胜区游览信息', url: 'https://example.com/hangzhou-west-lake', site: '示例官方文旅站' },
  { title: '西湖公共交通提示', url: 'https://example.com/hangzhou-transport', site: '示例交通信息站' },
  { title: '湖滨餐饮区域信息', url: 'https://example.com/hubin-food', site: '示例公开内容站' },
  { title: '中国茶叶博物馆开放信息', url: 'https://example.com/tea-museum', site: '示例官方文旅站' },
  { title: '灵隐寺景区游览信息', url: 'https://example.com/lingyin', site: '示例官方文旅站' },
  { title: '京杭大运河杭州段公共信息', url: 'https://example.com/hangzhou-grand-canal', site: '示例官方文旅站' }
]

export function buildMockDetail(request) {
  const days = []
  // 预算：mock 内部统一为数字（budgetCny，来自自由文本 budget 的提取）
  const hasBudget = typeof request.budgetCny === 'number' && request.budgetCny > 0

  // 第一遍：按模板原价累计总费用
  let rawTotal = 0
  for (let i = 0; i < request.days; i++) {
    const tpl = DAY_TEMPLATES[i % DAY_TEMPLATES.length]
    rawTotal += tpl.spots.reduce((s, it) => s + it.estimatedCostCny, 0)
      + tpl.food.reduce((s, it) => s + it.estimatedCostCny, 0)
  }
  // 用户给了预算且原价超支：按比例压缩各项费用（免费项保持 0），让方案贴合预算
  const factor = hasBudget && rawTotal > request.budgetCny ? request.budgetCny / rawTotal : 1

  let totalCost = 0
  for (let i = 0; i < request.days; i++) {
    const tpl = DAY_TEMPLATES[i % DAY_TEMPLATES.length]
    const spots = tpl.spots.map(it => ({
      name: it.name,
      reason: it.reason,
      tip: it.tip,
      duration: it.duration,
      transport: it.transport,
      estimatedCostCny: Math.round(it.estimatedCostCny * factor),
      lat: it.lat,
      lng: it.lng
    }))
    const food = tpl.food.map(it => ({
      name: it.name,
      reason: it.reason,
      estimatedCostCny: Math.round(it.estimatedCostCny * factor)
    }))

    const dayCost = spots.reduce((s, it) => s + it.estimatedCostCny, 0)
      + food.reduce((s, it) => s + it.estimatedCostCny, 0)
    totalCost += dayCost
    days.push({
      day: i + 1,
      title: tpl.title,
      theme: tpl.theme,
      spots,
      food,
      note: tpl.note,
      estimatedCostCny: dayCost
    })
  }

  return {
    city: request.destinationCity,
    overview: `为你安排了 ${request.destinationCity} ${request.days} 天行程，已按「${request.energyLevel}」体力档位控制每日节奏。` +
      (hasBudget && factor < 1 ? `已按预算 ${request.budgetCny} 元压缩各项开支。` : ''),
    estimatedTotalCost: totalCost,
    days,
    tips: ['节假日优先使用公共交通。', '出发前请通过官方渠道复核开放时间与票价。'],
    sources: SOURCES
  }
}
