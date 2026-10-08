// AI 搭子通话意图：首页 / 行程页 → 讲解页（通话界面在讲解页里）
// 为什么不用 query 参数：讲解页是 tabBar 页，跳它只能用 switchTab，而 switchTab 不支持带参数。
// 所以走模块级一次性传递，取用即清空——否则下次正常切到讲解页会莫名其妙自动弹通话。

let intent = null

// v 形如 { tripId, label }：
//   - 行程页带 tripId（已在某份攻略里）→ 讲解页直接进通话，label 只用于顶部「已绑定：xx」显示
//   - 首页不带 → 讲解页弹「选择一份攻略」，用户选了才进通话（start 消息必须带 tripId）
export function setCallIntent(v) {
  intent = v || {}
}

export function takeCallIntent() {
  const v = intent
  intent = null
  return v
}
