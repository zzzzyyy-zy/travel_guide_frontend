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
    'pages/share/share'
  ],
  window: {
    navigationBarTitleText: '智慧文旅',
    navigationBarBackgroundColor: '#ffffff',
    navigationBarTextStyle: 'black',
    backgroundColor: '#f7f7f5',
    backgroundTextStyle: 'light'
  },
  tabBar: {
    color: '#888780',
    selectedColor: '#185FA5',
    backgroundColor: '#ffffff',
    borderStyle: 'black',
    list: [
      { pagePath: 'pages/home/home', text: '首页' },
      { pagePath: 'pages/history/history', text: '历史' },
      { pagePath: 'pages/guide/guide', text: '讲解' }
    ]
  },
  // 定位权限声明（getFuzzyLocation）暂时移除：
  // 该字段属于隐私接口声明，后台未开通「获取模糊的地理位置」权限时，
  // 真机预览/上传会直接报 -80424 [getFuzzyLocation] is not authorized，整包都传不上去。
  // 当前代码没有任何页面调用定位（position.js 未接），讲解页只有「模拟触发」；
  // 等在 mp 后台（开发管理→接口设置）申请通过、并在《用户隐私保护指引》声明位置信息后，
  // 再把下面两段加回来接真实定位：
  // permission: { 'scope.userFuzzyLocation': { desc: '用于展示你附近的景点' } },
  // requiredPrivateInfos: ['getFuzzyLocation'],
  style: 'v2'
}
