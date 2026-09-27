export const groups = [
  {
    text: '最终方案',
    items: [
      ['index', '方案总览'],
      ['product/requirements', '产品需求与边界'],
      ['product/employee-experience', '员工门户与一键接入'],
      ['product/admin-console', '超级管理员控制台']
    ]
  },
  {
    text: '技术设计',
    items: [
      ['technical/architecture', '总体架构'],
      ['technical/catalog', '中转站与终极模型目录'],
      ['technical/gateway', '网关路由与低延迟'],
      ['technical/multimodal', '图片、视频与异步任务'],
      ['technical/connectors', 'Codex 与 WorkBuddy 连接器'],
      ['technical/conversations', '会话连续性与记录'],
      ['technical/api', '统一 API 契约'],
      ['technical/security', '安全、权限与审计']
    ]
  },
  {
    text: '交付与运行',
    items: [
      ['delivery/roadmap', '实施路线图'],
      ['delivery/acceptance', '验收标准'],
      ['operations/runbook', '运行手册']
    ]
  },
  {
    text: '决策记录',
    items: [
      ['records/decisions', '最终决策'],
      ['records/changelog', '文档变更记录']
    ]
  }
]

export const pages = groups.flatMap(group => group.items.map(([path]) => path + '.md'))
