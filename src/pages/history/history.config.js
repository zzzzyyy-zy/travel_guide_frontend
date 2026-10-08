export default {
  navigationBarTitleText: '历史行程',
  enablePullDownRefresh: true,
  // 只开「转发给好友」：本页是 tabBar 页 + 内容依赖登录，朋友圈无法改 path
  // （对方点开只会看到自己的空历史），所以转发时 path 统一指向首页
  enableShareAppMessage: true
}
