import type { Component } from 'vue'
import {
  IconAlertTriangle,
  IconBrain,
  IconBuildingCommunity,
  IconFileAnalytics,
  IconGauge,
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
      { label: '运营总览', icon: IconGauge, to: '/overview' },
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
      { label: '模型与渠道', icon: IconBrain, to: '/models' },
      { label: '上游账号', icon: IconServer2, to: '/upstreams' },
    ],
  },
  {
    label: '运营监控',
    items: [
      { label: '用量与日志', icon: IconFileAnalytics, to: '/usage' },
      { label: '告警中心', icon: IconAlertTriangle, to: '/alerts' },
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
