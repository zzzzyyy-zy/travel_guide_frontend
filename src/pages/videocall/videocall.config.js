export default {
  navigationBarTitleText: '打电话 · 小沃',
  // 禁止下拉刷新：camera 原生组件经不起页面级滚动/刷新折腾
  enablePullDownRefresh: false,
  // 转发：本页靠 query 自渲染（tripId），朋友圈改不了 path 就不开
  enableShareAppMessage: true
}
