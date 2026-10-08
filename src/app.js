// 应用入口（Taro Vue3）
import Taro from '@tarojs/taro'
import { createApp } from 'vue'
import { TaroElement } from '@tarojs/runtime'
import { captureInviter, captureInviterFromSystem } from './utils/invite'
import './app.css'

// 补丁：Vue 3.5 的 v-model 指令在 beforeUpdate 里会调 el.getRootNode() 并做
// `root instanceof Document / ShadowRoot` 判断，而小程序环境既没有实现 getRootNode、
// 也没有 Document/ShadowRoot 全局构造器（instanceof 直接抛 ReferenceError）。
// 处理：补上两个空壳类 + 让 getRootNode 返回 null —— instanceof 判断均为 false，
// Vue 安全跳过 activeElement 检查，仅正常赋值。
const _g = typeof globalThis !== 'undefined' ? globalThis : wx
if (typeof _g.Document === 'undefined') _g.Document = class Document {}
if (typeof _g.ShadowRoot === 'undefined') _g.ShadowRoot = class ShadowRoot {}
if (TaroElement && !TaroElement.prototype.getRootNode) {
  TaroElement.prototype.getRootNode = function () { return null }
}

// 邀请关系采集（2026-10-06）：从「小程序码 scene / 转发 path / 朋友圈 query」里接住 inviterId，
// 存本地，等首次登录时随 /api/auth/login 提交。模块加载即读一次，再在 App 生命周期里补热启动。
captureInviterFromSystem()

const App = createApp({
  onLaunch(options) { captureInviter(options) },
  onShow(options) { captureInviter(options) }
})

export default App
