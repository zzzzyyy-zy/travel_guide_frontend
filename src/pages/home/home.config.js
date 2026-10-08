// 首页：分享（转发给好友 + 朋友圈）
// ⚠️ enableShareAppMessage / enableShareTimeline 不能省：Taro 的 useShareAppMessage hook
//    只有在这个开关为 true 时才会被注册到页面对象上，否则 hook 无效、菜单里连「转发」都没有
export default {
  enableShareAppMessage: true,
  enableShareTimeline: true
}
