// 自定义 tabBar 组件配置（app.config.js 的 tabBar.custom=true 时启用）
// styleIsolation 必须放开，否则组件 wxss 被样式隔离吞掉 → 图标按原尺寸散架（已踩坑）
export default {
  component: true,
  styleIsolation: 'apply-shared'
}
