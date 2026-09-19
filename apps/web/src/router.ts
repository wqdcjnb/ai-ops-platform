import { createRouter, createWebHistory, type RouterHistory } from 'vue-router'
import AdminLayout from './layouts/AdminLayout.vue'
import HomeView from './views/HomeView.vue'
import OverviewView from './views/OverviewView.vue'
import PeopleView from './views/PeopleView.vue'
import PeopleDetailView from './views/PeopleDetailView.vue'
import KeysView from './views/KeysView.vue'
import LimitsView from './views/LimitsView.vue'
import RoutesView from './views/RoutesView.vue'
import ModelsView from './views/ModelsView.vue'
import UpstreamsView from './views/UpstreamsView.vue'
import UsageView from './views/UsageView.vue'
import AlertsView from './views/AlertsView.vue'
import AuditView from './views/AuditView.vue'
import ConversationAuditView from './views/ConversationAuditView.vue'
import SettingsView from './views/SettingsView.vue'
import type { AppRole } from './auth-api'

declare module 'vue-router' {
  interface RouteMeta {
    roles: AppRole[]
    title: string
    stage?: string
    public?: boolean
  }
}

export interface CreateRouterOptions {
  history?: RouterHistory
  role?: AppRole
  authenticated?: boolean
}

export function createAppRouter(options: CreateRouterOptions = {}) {
  const role = options.role ?? 'super_admin'
  const authenticated = options.authenticated ?? true
  const router = createRouter({
    history: options.history ?? createWebHistory(),
    routes: [
      {
        path: '/',
        component: AdminLayout,
        meta: { title: '管理控制台', roles: ['super_admin', 'admin', 'department_lead', 'finance'] },
        children: [
          {
            path: '',
            name: 'home',
            component: HomeView,
            meta: { title: '统一入口', roles: ['super_admin', 'admin', 'department_lead', 'finance'], stage: 'P0' },
          },
          {
            path: 'overview',
            name: 'overview',
            component: OverviewView,
            meta: { title: '运营总览', roles: ['super_admin', 'admin', 'department_lead', 'finance'], stage: 'P0' },
          },
          {
            path: 'people',
            name: 'people',
            component: PeopleView,
            meta: { title: '人员与部门', roles: ['super_admin', 'admin', 'department_lead'], stage: 'P1' },
          },
          {
            path: 'people/:id',
            name: 'person-detail',
            component: PeopleDetailView,
            meta: { title: '人员详情', roles: ['super_admin', 'admin', 'department_lead'], stage: 'P1' },
          },
          {
            path: 'keys',
            name: 'keys',
            component: KeysView,
            meta: { title: 'Key 管理', roles: ['super_admin', 'admin', 'department_lead'], stage: 'P1' },
          },
          {
            path: 'limits',
            name: 'limits',
            component: LimitsView,
            meta: { title: '额度与限流', roles: ['super_admin', 'admin', 'department_lead', 'finance'], stage: 'P3' },
          },
          {
            path: 'routes',
            name: 'routes',
            component: RoutesView,
            meta: { title: '用途与路由', roles: ['super_admin', 'admin'], stage: 'P2' },
          },
          {
            path: 'models',
            name: 'models',
            component: ModelsView,
            meta: { title: '模型与渠道', roles: ['super_admin', 'admin', 'department_lead'], stage: 'P2' },
          },
          {
            path: 'upstreams',
            name: 'upstreams',
            component: UpstreamsView,
            meta: { title: '上游账号', roles: ['super_admin', 'admin'], stage: 'P2' },
          },
          {
            path: 'usage',
            name: 'usage',
            component: UsageView,
            meta: { title: '用量与日志', roles: ['super_admin', 'admin', 'department_lead', 'finance'], stage: 'P1' },
          },
          {
            path: 'alerts',
            name: 'alerts',
            component: AlertsView,
            meta: { title: '告警中心', roles: ['super_admin', 'admin', 'department_lead', 'finance'], stage: 'P2' },
          },
          {
            path: 'audit',
            name: 'audit',
            component: AuditView,
            meta: { title: '审计日志', roles: ['super_admin', 'admin'], stage: 'P2' },
          },
          {
            path: 'conversation-audit',
            name: 'conversation-audit',
            component: ConversationAuditView,
            meta: { title: '对话审计', roles: ['super_admin'], stage: 'P3' },
          },
          {
            path: 'settings',
            name: 'settings',
            component: SettingsView,
            meta: { title: '系统设置', roles: ['super_admin', 'admin'], stage: 'P3' },
          },
        ],
      },
      {
        path: '/:pathMatch(.*)*',
        redirect: '/',
        meta: { title: '页面未找到', roles: ['super_admin', 'admin', 'department_lead', 'finance', 'employee'] },
      },
    ],
  })

  router.beforeEach((to) => {
    if (to.meta.public) return true
    if (!authenticated) return to.path === '/' ? true : '/'
    if (to.meta.roles.includes(role)) return true
    return to.path === '/' ? true : '/'
  })

  router.afterEach((to) => {
    if (typeof document !== 'undefined') document.title = `${to.meta.title} · AI OPS`
  })

  return router
}
