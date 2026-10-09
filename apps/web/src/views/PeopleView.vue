<script setup lang="ts">
import { usePeopleView } from '../composables/usePeopleView'

const { people, search, status, page, pageSize, isLoading, errorMessage, operationError, operationNotice, pending, openMenuId, isOperating, sortDirections, sortPriority, request, statusLabel, total, active, totalPages, formatDate, timestamp, displayedPeople, toggleSort, sortDirection, sortButtonLabel, sortIcon, operationKey, loadPeople, applyFilters, clearFilters, cancelSearch, changePage, openAction, toggleActionMenu, closeActionMenu, actionTitle, actionDescription, confirmAction, IconAlertTriangle, IconDotsVertical, IconKey, IconRefresh, IconTrash, IconUserCheck, IconUserOff, IconUsers } = usePeopleView()
</script>

<template>
  <div class="dashboard people-dashboard">
    <section class="page-heading">
      <div>
        <div class="eyebrow">PEOPLE & PLATFORM KEY</div>
        <h1>人员信息管理</h1>
      </div>
      <div class="heading-actions"><button class="btn btn-white refresh-button" :disabled="isLoading" @click="loadPeople"><IconRefresh :size="17" :class="{ spinning: isLoading }" />刷新</button></div>
    </section>

    <section class="people-summary-grid" aria-label="人员概览">
      <article class="metric-card people-summary-card"><div class="metric-top"><span class="metric-label">全部人员</span><span class="metric-icon tone-teal"><IconUsers :size="19" /></span></div><strong class="metric-value">{{ total }}</strong><div class="metric-foot">员工通过真实姓名和邮箱自助注册</div></article>
      <article class="metric-card people-summary-card"><div class="metric-top"><span class="metric-label">启用人员</span><span class="metric-icon tone-green"><IconUserCheck :size="19" /></span></div><strong class="metric-value">{{ active }}</strong><div class="metric-foot">可登录并使用 AI OPS</div></article>
    </section>

    <section class="panel people-panel-main">
      <form class="people-filters" @submit.prevent="applyFilters">
        <label class="people-search"><input v-model="search" aria-label="搜索人员" type="search" maxlength="60" placeholder="搜索姓名或邮箱" /></label>
        <label><select v-model="status" aria-label="按状态筛选" @change="applyFilters"><option value="all">全部状态</option><option value="active">启用</option><option value="disabled">停用</option></select></label>
        <button class="text-button" type="button" @click="clearFilters">清除筛选</button>
      </form>

      <div v-if="isLoading && !people" class="data-state"><div class="state-icon"><IconRefresh :size="22" class="spinning" /></div><div><strong>正在读取人员信息</strong><p>正在加载平台身份与 Key 掩码…</p></div></div>
      <div v-else-if="errorMessage" class="data-state failed"><div class="state-icon"><IconAlertTriangle :size="22" /></div><div><strong>人员数据加载失败</strong><p>{{ errorMessage }}</p></div><button class="btn btn-white" @click="loadPeople">重试</button></div>
      <template v-else-if="people">
        <div class="source-banner people-source-banner"><span class="local">平台身份库</span><p>{{ people.meta.notice }}</p></div>
        <p v-if="operationNotice" class="person-operation-notice" role="status">{{ operationNotice }}</p>
        <div v-if="people.items.length" class="table-responsive" :class="{ 'has-open-person-menu': openMenuId !== null }">
          <table class="data-table people-table">
            <thead><tr><th>人员</th><th>状态</th><th>API密钥（KEY掩码）</th><th :aria-sort="sortDirection('createdAt')"><button class="people-sort-button" type="button" :aria-label="sortButtonLabel('createdAt')" @click="toggleSort('createdAt')">创建时间 <span aria-hidden="true">{{ sortIcon('createdAt') }}</span></button></th><th :aria-sort="sortDirection('lastUsedAt')"><button class="people-sort-button" type="button" :aria-label="sortButtonLabel('lastUsedAt')" @click="toggleSort('lastUsedAt')">最后使用 <span aria-hidden="true">{{ sortIcon('lastUsedAt') }}</span></button></th><th>操作</th></tr></thead>
            <tbody>
              <tr v-for="person in displayedPeople" :key="person.id">
                <td><div class="person-cell"><span class="person-avatar" :class="`avatar-${person.tone}`">{{ person.name.slice(0, 1) }}</span><span><strong>{{ person.name }}</strong><small>{{ person.username }}</small></span></div></td>
                <td><span class="person-status" :class="`status-${person.status}`"><i />{{ statusLabel[person.status] }}</span></td>
                <td><code class="masked-key">{{ person.apiKeyMasked ?? '未创建' }}</code></td>
                <td class="last-active">{{ formatDate(person.createdAt) }}</td>
                <td class="last-active">{{ formatDate(person.lastUsedAt) }}</td>
                <td class="person-action-cell"><div class="person-action-menu" @click.stop>
                  <button class="person-menu-trigger" type="button" :aria-expanded="openMenuId === person.id" aria-haspopup="menu" :aria-label="`打开 ${person.name} 的操作菜单`" @click="toggleActionMenu(person.id)"><IconDotsVertical :size="19" /></button>
                  <div v-if="openMenuId === person.id" class="person-menu-popover" role="menu" :aria-label="`${person.name} 的操作`">
                    <button type="button" role="menuitem" @click="openAction(person, person.status === 'active' ? 'disable' : 'enable')"><IconUserOff v-if="person.status === 'active'" :size="15" /><IconUserCheck v-else :size="15" />{{ person.status === 'active' ? '停用员工' : '启用员工' }}</button>
                    <button type="button" role="menuitem" @click="openAction(person, 'resetKey')"><IconKey :size="15" />重置 Key</button>
                    <button type="button" role="menuitem" @click="openAction(person, 'resetPassword')"><IconKey :size="15" />重置密码</button>
                    <button class="danger" type="button" role="menuitem" @click="openAction(person, 'delete')"><IconTrash :size="15" />删除员工</button>
                  </div>
                </div></td>
              </tr>
            </tbody>
          </table>
        </div>
        <div v-else class="people-empty"><IconUsers :size="24" /><strong>没有符合条件的员工</strong><span>新员工需要在登录页自行注册。</span></div>
        <AppPagination :page="page" :total-pages="totalPages" :total="people.total" aria-label="人员信息管理分页" @change="changePage" />
      </template>
    </section>

    <div v-if="pending" class="drawer-backdrop" @click.self="!isOperating && (pending = null)">
      <aside class="person-action-dialog" role="dialog" aria-modal="true" :aria-label="actionTitle(pending.action)">
        <header><div><span class="person-action-dialog-icon"><IconKey v-if="pending.action === 'resetKey' || pending.action === 'resetPassword'" :size="17" /><IconTrash v-else-if="pending.action === 'delete'" :size="17" /><IconUserOff v-else :size="17" /></span><h2>{{ actionTitle(pending.action) }}</h2></div><button class="icon-button" :disabled="isOperating" aria-label="关闭" @click="pending = null">×</button></header>
        <section class="person-action-dialog-body"><strong>{{ pending.person.name }}</strong><p>{{ actionDescription(pending) }}</p><p v-if="operationError" class="dialog-error"><IconAlertTriangle :size="15" />{{ operationError }}</p></section>
        <footer><button class="btn btn-white" :disabled="isOperating" @click="pending = null">取消</button><button class="btn create-key" :disabled="isOperating" @click="confirmAction">{{ isOperating ? '处理中…' : '确认' }}</button></footer>
      </aside>
    </div>
  </div>
</template>

<style scoped>
.people-source-banner { align-items: flex-start; margin: 0; padding: 12px 17px; gap: 10px; color: var(--muted); font-size: 12px; line-height: 1.65; }
.people-source-banner > span { flex-shrink: 0; margin-top: 1px; line-height: 1.65; }
.people-source-banner > p { min-width: 0; margin: 0; overflow-wrap: anywhere; }
.people-dashboard { max-width: 1500px; }.people-summary-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 14px; margin-bottom: 16px; }.people-panel-main { padding: 0; overflow: visible; }.people-filters { display: flex; align-items: center; gap: 10px; padding: 15px 17px; border-bottom: 1px solid var(--line); }.people-filters label { display: flex; align-items: center; gap: 7px; min-width: 150px; padding: 0 9px; border: 1px solid var(--line); border-radius: 7px; color: var(--muted); }.people-filters input, .people-filters select { min-width: 0; width: 100%; padding: 8px 0; border: 0; outline: 0; color: var(--navy); background: transparent; font: inherit; font-size: 12px; }.people-search { flex: 1; max-width: 360px; }.people-table { min-width: 860px; }.people-table th { text-transform: none; }.people-sort-button { display: inline-flex; align-items: center; gap: 4px; padding: 0; border: 0; color: inherit; background: transparent; font: inherit; font-weight: inherit; cursor: pointer; }.people-sort-button:hover { color: var(--brand); }.people-sort-button:focus-visible { outline: 2px solid var(--brand); outline-offset: 3px; border-radius: 3px; }.people-sort-button span { color: var(--brand); font-size: 13px; line-height: 1; }.people-table th:last-child { width: 64px; min-width: 64px; padding: 0; text-align: center; }.table-responsive.has-open-person-menu { padding-bottom: 164px; }.person-cell { display: flex; align-items: center; gap: 9px; min-width: 170px; }.person-cell > span:last-child { display: grid; gap: 2px; }.person-cell small { color: var(--muted); font-size: 10px; }.masked-key { color: var(--navy); font-size: 11px; }.person-operation-notice { display: flex; align-items: center; margin: 0 16px 12px; padding: 10px 12px; border: 1px solid #cfe8d6; border-radius: 8px; color: #26754e; background: #f4fbf6; font-size: 12px; }.person-action-cell { position: relative; width: 64px; min-width: 64px; padding: 0 !important; text-align: center; }.person-action-menu { position: relative; display: flex; justify-content: center; }.person-menu-trigger { display: grid; place-items: center; width: 30px; height: 30px; padding: 0; border: 1px solid transparent; border-radius: 7px; color: var(--muted); background: transparent; }.person-menu-trigger:hover, .person-menu-trigger[aria-expanded="true"] { border-color: var(--line); color: var(--navy); background: #f7fafb; }.person-menu-popover { position: absolute; z-index: 20; top: calc(100% + 5px); right: 0; display: grid; width: 158px; padding: 5px; border: 1px solid var(--line); border-radius: 9px; background: var(--surface); box-shadow: 0 14px 30px rgba(24, 36, 51, .16); }.person-menu-popover button { display: flex; align-items: center; gap: 8px; width: 100%; min-height: 32px; padding: 0 9px; border: 0; border-radius: 6px; color: #40515e; background: transparent; font: inherit; font-size: 11px; text-align: left; }.person-menu-popover button:hover, .person-menu-popover button:focus-visible { outline: 0; color: var(--navy); background: #f1f6f7; }.person-menu-popover button.danger { margin-top: 3px; border-top: 1px solid #edf0f3; border-radius: 0 0 6px 6px; color: var(--danger); }.person-action-dialog { width: min(100% - 28px, 480px); border: 1px solid var(--line); border-radius: 12px; background: var(--surface); box-shadow: 0 22px 60px rgba(0, 0, 0, .25); }.person-action-dialog header { display: flex; align-items: center; justify-content: space-between; padding: 18px; border-bottom: 1px solid var(--line); }.person-action-dialog header > div { display: flex; align-items: center; gap: 10px; }.person-action-dialog h2 { margin: 0; color: var(--navy); font-size: 16px; }.person-action-dialog-icon { display: grid; place-items: center; width: 30px; height: 30px; border-radius: 7px; color: var(--brand); background: #e7f2f2; }.person-action-dialog-body { padding: 20px 18px; }.person-action-dialog-body strong { color: var(--navy); }.person-action-dialog-body p { margin: 8px 0 0; color: var(--muted); font-size: 13px; line-height: 1.65; }.dialog-error { display: flex; align-items: flex-start; gap: 6px; color: var(--danger) !important; }.person-action-dialog footer { display: flex; justify-content: flex-end; gap: 8px; padding: 14px 18px; border-top: 1px solid var(--line); }
@media (max-width: 720px) { .people-summary-grid { grid-template-columns: 1fr; }.people-filters { align-items: stretch; flex-direction: column; }.people-filters label, .people-search { width: 100%; max-width: none; } }
</style>
