import { createRouter, createWebHistory, type RouterHistory } from 'vue-router'
import AdminLayout from './layouts/AdminLayout.vue'
import PeopleView from './views/PeopleView.vue'
import ModelsView from './views/ModelsView.vue'
import ExternalProvidersView from './views/ExternalProvidersView.vue'
import UsageView from './views/UsageView.vue'
import AuditView from './views/AuditView.vue'
import ConversationAuditView from './views/ConversationAuditView.vue'
import AuthView from './views/AuthView.vue'
import EmployeePortalView from './views/EmployeePortalView.vue'
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
        path: '/login',
        name: 'login',
        component: AuthView,
        meta: { title: '登录', roles: ['super_admin', 'employee'], public: true },
      },
      {
        path: '/register',
        name: 'register',
        component: AuthView,
        meta: { title: '员工注册', roles: ['super_admin', 'employee'], public: true },
      },
      {
        path: '/employee',
        name: 'employee-portal',
        component: EmployeePortalView,
        meta: { title: '我的账户', roles: ['employee'] },
      },
      {
        path: '/',
        component: AdminLayout,
        meta: { title: '管理控制台', roles: ['super_admin'] },
        children: [
          { path: '', redirect: () => role === 'employee' ? '/employee' : '/people', meta: { title: '人员信息管理', roles: ['super_admin'] } },
          {
            path: 'people',
            name: 'people',
            component: PeopleView,
            meta: { title: '人员信息管理', roles: ['super_admin'], stage: 'P1' },
          },
          {
            path: 'models',
            name: 'models',
            component: ModelsView,
            meta: { title: '模型目录', roles: ['super_admin'], stage: 'P2' },
          },
          {
            path: 'external-providers',
            name: 'external-providers',
            component: ExternalProvidersView,
            meta: { title: '第三方账号', roles: ['super_admin'], stage: 'E1' },
          },
          {
            path: 'usage',
            name: 'usage',
            component: UsageView,
            meta: { title: '模型调用分析', roles: ['super_admin'], stage: 'P2' },
          },
          {
            path: 'audit',
            name: 'audit',
            component: AuditView,
            meta: { title: '审计日志', roles: ['super_admin'], stage: 'P2' },
          },
          {
            path: 'conversation-audit',
            name: 'conversation-audit',
            component: ConversationAuditView,
            meta: { title: '对话审计', roles: ['super_admin'], stage: 'P3' },
          },
        ],
      },
      {
        path: '/:pathMatch(.*)*',
        redirect: () => authenticated && role === 'employee' ? '/employee' : authenticated && role === 'super_admin' ? '/people' : '/login',
        meta: { title: '页面未找到', roles: ['super_admin', 'employee'] },
      },
    ],
  })

  router.beforeEach((to) => {
    if (to.meta.public) return true
    if (!authenticated) return '/login'
    if (to.meta.roles.includes(role)) return true
    return role === 'employee' ? '/employee' : role === 'super_admin' ? '/people' : '/login'
  })

  router.afterEach((to) => {
    if (typeof document !== 'undefined') document.title = `${to.meta.title} · AI OPS`
  })

  return router
}
