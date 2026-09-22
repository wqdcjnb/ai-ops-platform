import type { AuthUser } from './auth.js'
import type { PlatformDatabase } from './platform-db.js'

export type DataScope =
  | { mode: 'global' }
  | { mode: 'department'; departmentId: string }

export function dataScopeFor(user?: AuthUser): DataScope {
  if (user?.role !== 'department_lead') return { mode: 'global' }
  return user.departmentId ? { mode: 'department', departmentId: user.departmentId } : { mode: 'department', departmentId: '__unassigned__' }
}

export function isDepartmentVisible(scope: DataScope, departmentId: string | null | undefined) {
  return scope.mode === 'global' || departmentId === scope.departmentId
}

export function scopeNotice(scope: DataScope) {
  return scope.mode === 'department' ? '当前身份仅显示本部门的 SQLite 模拟数据。' : ''
}

export function isPersonVisible(database: PlatformDatabase, scope: DataScope, personId: string) {
  return isDepartmentVisible(scope, database.findPersonDepartmentId(personId))
}

export function isKeyVisible(database: PlatformDatabase, scope: DataScope, keyId: string) {
  return isDepartmentVisible(scope, database.findKeyDepartmentId(keyId))
}
