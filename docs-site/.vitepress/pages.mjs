export const groups = [
  { text: '开始阅读', items: [['index', '项目概览'], ['portal', '常用入口']] },
  { text: '需求文档', items: [['requirements/overview', '完整需求'], ['requirements/core', '核心功能'], ['requirements/phases', '实施范围'], ['requirements/acceptance', '验收标准']] },
  { text: '技术方案', items: [['technical/architecture', '架构与职责'], ['technical/development-steps', '开发实施步骤'], ['technical/page-plan-v2', '页面规划 V2'], ['technical/page-functional-design', '第一版页面功能设计与完成表'], ['technical/page-functional-design-v2', '第二版页面功能设计（内部测试）'], ['technical/product-and-ui-plan', '产品、技术栈与 UI'], ['technical/dependency-baseline', '依赖基线'], ['technical/ui-options', 'UI 候选方案'], ['technical/compatibility', '客户端兼容性'], ['technical/security', '安全方案']] },
  { text: '部署与使用', items: [['guides/local-testing', '本地内部测试'], ['guides/cpa', 'CPA 使用说明'], ['guides/clients', '客户端接入验证'], ['guides/maintenance', '文档站使用与维护']] },
  { text: '项目记录', items: [['records/decisions', '方案决策'], ['records/todo', '项目待办'], ['records/changelog', '更新记录']] }
]
export const pages = groups.flatMap(g => g.items.map(([path]) => path + '.md'))
