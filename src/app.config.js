// 全局页面注册与窗口/tabBar 配置（对应原生 app.json）
export default {
  pages: [
    'pages/login/login',
    'pages/home/home',
    'pages/index/index',
    'pages/itinerary/itinerary',
    'pages/history/history',
    'pages/guide/guide',
    'pages/chat/chat',
    'pages/share/share',
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
    color: '#868E96',
    selectedColor: '#48A999',
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
    }
  },
  requiredPrivateInfos: ['getFuzzyLocation'],
  style: 'v2'
}
