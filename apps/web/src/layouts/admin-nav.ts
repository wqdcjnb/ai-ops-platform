import type { Component } from 'vue'
import {
  IconBrain,
  IconBuildingCommunity,
  IconFileAnalytics,
  IconKey,
  IconLayoutDashboard,
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
    label: '工作台',
    items: [
      { label: '统一入口', icon: IconLayoutDashboard, to: '/' },
    ],
  },
  {
    label: '人员与访问',
    items: [
      { label: '人员与部门', icon: IconUsers, to: '/people' },
      { label: 'Key 管理', icon: IconKey, to: '/keys' },
    ],
  },
  {
    label: '模型治理',
    items: [
      { label: '模型目录', icon: IconBrain, to: '/models' },
      { label: '上游账号', icon: IconServer2, to: '/upstreams' },
    ],
  },
  {
    label: '运营监控',
    items: [
      { label: '模型调用分析', icon: IconFileAnalytics, to: '/usage' },
    ],
  },
  {
    label: '安全审计',
    items: [
      { label: '审计日志', icon: IconShieldCheck, to: '/audit' },
      { label: '对话审计', icon: IconBuildingCommunity, to: '/conversation-audit' },
    ],
  },
]
