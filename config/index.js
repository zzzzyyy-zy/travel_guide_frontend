// Taro 编译配置（Vue3 + webpack5）
const config = {
  projectName: 'travel_guide_frontend',
  date: '2026-09-16',
  designWidth: 750,
  deviceRatio: {
    640: 2.34 / 2,
    750: 1,
    828: 1.81 / 2,
    375: 2
  },
  sourceRoot: 'src',
  outputRoot: 'dist',
  plugins: [],
  defineConstants: {},
  copy: {
    patterns: [
      // 地图 marker 图钉：小图会被 url-loader 内联成 base64，真机 <map> 对 base64 iconPath
      // 兼容性差 → 用 copy 原样拷进 dist，页面里直接写包内绝对路径（不用 import）
      { from: 'src/assets/map-pin.png', to: 'dist/assets/map-pin.png' }
    ],
    options: {}
  },
  framework: 'vue3',
  compiler: 'webpack5',
  mini: {
    optimizeMainPackage: {
      enable: false
    },
    postcss: {
      pxtransform: {
        enable: true,
        config: {}
      },
      cssModules: {
        enable: false
      }
    }
  },
  h5: {}
}

module.exports = function (merge) {
  if (process.env.NODE_ENV === 'development') {
    return merge({}, config, require('./dev'))
  }
  return merge({}, config, require('./prod'))
}
