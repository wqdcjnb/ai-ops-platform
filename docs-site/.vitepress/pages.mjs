export const groups = [
  { text: '开始阅读', items: [['index', '项目概览'], ['portal', '常用入口']] },
  { text: '需求文档', items: [['requirements/overview', '完整需求'], ['requirements/core', '核心功能'], ['requirements/phases', '实施范围'], ['requirements/acceptance', '验收标准']] },
  { text: '技术方案', items: [['technical/architecture', '架构与职责'], ['technical/dependency-baseline', '依赖基线'], ['technical/compatibility', '客户端兼容性'], ['technical/security', '安全方案']] },
  { text: '部署与使用', items: [['guides/cpa', 'CPA 使用说明'], ['guides/maintenance', '文档站使用与维护']] },
  { text: '分步执行手册', items: [
    ['implementation/index', '执行顺序'],
    ['implementation/00-preflight', '00 执行前检查'],
    ['implementation/01-cpa-connection', '01 CPA 真实接入'],
    ['implementation/02-cpa-oauth', '02 CPA OAuth'],
    ['implementation/03-new-api-channel', '03 New API 渠道'],
    ['implementation/04-people-sync', '04 人员同步'],
    ['implementation/05-new-api-key', '05 员工 Key'],
    ['implementation/06-lifecycle', '06 生命周期'],
    ['implementation/07-audit', '07 正文审计'],
    ['implementation/08-cleanup-release', '08 清理发布'],
    ['implementation/09-daily-runbook', '09 日常操作']
  ] },
  { text: '项目记录', items: [['records/decisions', '方案决策'], ['records/todo', '项目待办'], ['records/changelog', '更新记录']] }
]
export const pages = groups.flatMap(g => g.items.map(([path]) => path + '.md'))
