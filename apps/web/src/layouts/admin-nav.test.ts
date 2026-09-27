import { describe, expect, it } from 'vitest'
import { adminNavSections } from './admin-nav'

describe('admin navigation', () => {
  it('keeps the management navigation in the requested order', () => {
    expect(adminNavSections.flatMap((section) => section.items.map((item) => item.label))).toEqual([
      '人员信息管理',
      '第三方账号',
      '模型目录',
      '模型调用分析',
      '对话审计',
      '审计日志',
    ])
  })
})
