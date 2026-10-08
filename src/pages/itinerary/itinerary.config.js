export default {
  navigationBarTitleText: '我的行程',
  // 多人协作无实时推送，改动靠手动同步：开下拉刷新让协作者拉到最新详情/成员
  enablePullDownRefresh: true,
  // ⚠️ 这个开关是 2026-10-02 补的：页面里早就写了 useShareAppMessage，
  //    但少了它 Taro 不会把 onShareAppMessage 注册到页面对象上 → 右上角菜单里
  //    根本没有「转发」，那段 hook 一直是死代码。
  //    朋友圈不开：onShareTimeline 改不了 path，而本页必须带 tripId 才能渲染。
  enableShareAppMessage: true
}
