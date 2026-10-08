// 只读分享页：好友点开后的落地页，它本身也能继续转发（token 走 query）
// 朋友圈必须开在这个页面上：onShareTimeline 只能带 query、不能改 path，
// 而本页靠 ?token= 就能渲染，天然自洽（itinerary 那种需要 tripId 的页面就不适合）
export default {
  enableShareAppMessage: true,
  enableShareTimeline: true
}
