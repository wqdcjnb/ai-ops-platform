import type { Component } from 'vue'
import {
  IconBrain,
  IconBuildingCommunity,
  IconChartBar,
  IconServer2,
  IconShieldCheck,
  IconUsers,
} from '@tabler/icons-vue'

export interface AdminNavItem {
  label: string
  icon: Component
  to?: string
  badge?: string
}

export interface AdminNavSection {
  label: string
  items: AdminNavItem[]
}

export const adminNavSections: AdminNavSection[] = [
  {
    label: '人员与访问',
    items: [
      { label: '人员信息管理', icon: IconUsers, to: '/people' },
    ],
  },
  {
    label: '模型治理',
    items: [
      { label: '第三方账号', icon: IconServer2, to: '/external-providers' },
      { label: '模型目录', icon: IconBrain, to: '/models' },
    ],
  },
  {
    label: '运营监控',
    items: [
      { label: '模型调用分析', icon: IconChartBar, to: '/usage' },
    ],
  },
  {
    label: '安全审计',
    items: [
      { label: '对话审计', icon: IconBuildingCommunity, to: '/conversation-audit' },
      { label: '审计日志', icon: IconShieldCheck, to: '/audit' },
    ],
  },
]
