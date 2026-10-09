// 全局页面注册与窗口/tabBar 配置（对应原生 app.json）
export default {
  pages: [
    // 首屏＝登录页（2026-10-09 用户要求改回）：冷启动先进登录界面，用户可点
    // 「先随便逛逛」以游客身份进首页；生成行程/AI 讲解等功能仍需登录（AuthMask）。
    'pages/login/login',
    'pages/home/home',
    'pages/index/index',
    'pages/itinerary/itinerary',
    'pages/history/history',
    'pages/guide/guide',
    'pages/chat/chat',
    'pages/share/share',
    'pages/footprint/footprint',
    'pages/route/route',
    'pages/expense/expense',
    'pages/memo/memo',
    'pages/packing/packing',
    'pages/nearby/nearby',
    'pages/videocall/videocall',
    'pages/feedback/feedback',
    'pages/badges/badges',
    'pages/profile/profile'
  ],
  window: {
    navigationBarTitleText: '智慧文旅',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f7f7f5',
    backgroundTextStyle: 'light'
  },
  tabBar: {
    custom: true,   // 自定义 tabBar（custom-tab-bar/）：4 tab + 中央凸起「＋」按钮
    color: '#868E96',
    selectedColor: '#22C55E',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      { pagePath: 'pages/home/home', text: '首页', iconPath: 'assets/tabbar/home-off.png', selectedIconPath: 'assets/tabbar/home-on.png' },
      { pagePath: 'pages/history/history', text: '历史', iconPath: 'assets/tabbar/history-off.png', selectedIconPath: 'assets/tabbar/history-on.png' },
      { pagePath: 'pages/guide/guide', text: '讲解', iconPath: 'assets/tabbar/guide-off.png', selectedIconPath: 'assets/tabbar/guide-on.png' },
      { pagePath: 'pages/profile/profile', text: '我的', iconPath: 'assets/tabbar/profile-off.png', selectedIconPath: 'assets/tabbar/profile-on.png' }
    ]
  },
  // 定位权限声明（讲解页真实定位 2026-09-22 启用）：
  // ⚠️ 前提：mp 后台「开发管理→接口设置→获取当前的模糊地理位置」已申请通过，
  // 且《用户隐私保护指引》已勾选「位置信息」。未开通就加这两段 = 真机预览/上传
  // 直接报 -80424 [getFuzzyLocation] is not authorized，整包传不上去（前车之鉴）。
  permission: {
    'scope.userFuzzyLocation': {
      desc: '用于识别你所在的景点并自动播放讲解'
    },
    'scope.userLocation': {
      desc: '用于添加景点时在地图上选择位置'
    }
  },
  // chooseLocation（添加景点地图选点 2026-09-24）必须声明，否则调用直接 fail（toast「未选择位置」）
  requiredPrivateInfos: ['getFuzzyLocation', 'chooseLocation'],
  style: 'v2'
}
