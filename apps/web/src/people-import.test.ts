import { describe, expect, it } from 'vitest'
import { preflightPeopleImport } from './people-import'

const departments = [{ id: 'content', name: '内容运营' }, { id: 'ads', name: '广告投放' }]

describe('people CSV import preflight', () => {
  it('accepts the template shape and keeps password only in memory', () => {
    const result = preflightPeopleImport('username,displayName,departmentId,password\nnew.user,王小明,content,local-pass-1', departments)
    expect(result.errors).toBe(0)
    expect(result.rows[0]).toMatchObject({ line: 2, username: 'new.user', displayName: '王小明', departmentName: '内容运营' })
    expect(result.rows[0].password).toBe('local-pass-1')
  })

  it('reports invalid departments, duplicate usernames and malformed headers', () => {
    const result = preflightPeopleImport('username,displayName,departmentId,password\nnew.user,王小明,missing,local-pass-1\nNEW.USER,李小红,content,short', departments)
    expect(result.errors).toBe(2)
    expect(result.rows[0].error).toContain('所属部门无效')
    expect(result.rows[1].error).toContain('文件内登录用户名重复')
    expect(result.rows[1].error).toContain('初始密码需为 8–200 个字符')
    expect(preflightPeopleImport('name,department', departments).rows[0].error).toContain('表头必须为')
  })

  it('caps rows and marks truncated files', () => {
    const result = preflightPeopleImport('username,displayName,departmentId,password\n' + Array.from({ length: 3 }, (_, index) => `user${index},人员${index},content,password-${index}`).join('\n'), departments, 2)
    expect(result.rows).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })
})
