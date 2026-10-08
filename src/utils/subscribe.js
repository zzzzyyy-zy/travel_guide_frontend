// 订阅消息：生成攻略前申请「旅行行程开始」提醒额度（2026-10-01 后端新增）
// 设计约定（与队友对齐，改动前先看这四条）：
//   1. 不阻断生成：accept / reject / ban / 调用失败，全都只是记日志，生成流程照常往下走。
//      用户拒绝授权 = 旅行当天收不到提醒，仅此而已。
//   2. 每次生成都要重新弹：一次性订阅，授权一次只能发一条消息 → 每次生成重新申请，
//      把额度留给这次生成的行程在开始当天用。
//   3. 必须在「用户点击事件」里同步调用（微信硬限制）。放到 await / 异步回调之后调用
//      会直接 fail（can only be invoked by user TAP gesture），所以调用点写在 submit() 里。
//   4. 前端不缓存授权结果、不调发送接口：发送由后端定时任务（每天 9 点扫当天开始的行程）负责。
import Taro from '@tarojs/taro'
import CONFIG from './config'

/**
 * 申请一次「旅行行程开始」提醒额度（一次性订阅）
 * 永远不 reject、永远不抛错——调用方直接同步调用即可，不要 try/catch、不要 await
 */
export function requestTripSubscribe() {
  const tmplId = CONFIG.SUBSCRIBE_TEMPLATE_ID
  if (!tmplId) {
    // 模板 ID 未配置（要先在 mp 后台「订阅消息」里申请模板，再把 ID 填进 config.js）
    console.warn('[subscribe] SUBSCRIBE_TEMPLATE_ID 未配置，跳过授权（不影响生成）')
    return
  }
  Taro.requestSubscribeMessage({
    tmplIds: [tmplId],
    success: res => {
      // res[tmplId] 取值：accept 同意 / reject 拒绝 / ban 已永久拒绝
      console.log('[subscribe] 旅行开始提醒授权结果:', res[tmplId])
    },
    fail: err => {
      // 常见原因：开发者工具环境不支持、模板 ID 不属于当前 AppID、用户已「总是保持拒绝」
      console.warn('[subscribe] 授权未完成（忽略，不影响生成）:', err)
    }
  })
}
