// 自定义 tabBar 选中态：微信每个 tab 页持独立组件实例，必须用共享 store 同步，
// 否则出现「高亮错位 / 要点两次才对」的已知坑
import { reactive } from 'vue'

export const tabStore = reactive({
  selected: 0,
  hidden: false   // 全屏浮层（如 AI 搭子通话层）盖住页面时置 true，隐藏整个 tabBar（含中央 +）
})

export function setTab(i) {
  tabStore.selected = i
}

// 隐藏/恢复自定义 tabBar：call-layer z-index 再高也压不住 custom-tab-bar
// （它挂在页面 root 之外、自己的层叠上下文里，跨容器比 z-index 不可靠）→ 用共享开关直接不渲染
export function setTabBarHidden(v) {
  tabStore.hidden = !!v
}
