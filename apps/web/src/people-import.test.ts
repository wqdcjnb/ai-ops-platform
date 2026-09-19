import { describe, expect, it } from 'vitest'
import { preflightPeopleImport } from './people-import'

const departments = [{ id: 'content', name: '内容运营' }, { id: 'ads', name: '广告投放' }]

describe('people CSV import preflight', () => {
  it('accepts the template shape and keeps password only in memory', () => {
    const result = preflightPeopleImport('displayName,departmentId\n王小明,content', departments)
    expect(result.errors).toBe(0)
    expect(result.rows[0]).toMatchObject({ line: 2, displayName: '王小明', departmentName: '内容运营' })
    expect(result.rows[0].username).toBe('')
    expect(result.rows[0].password).toBeUndefined()
  })

  it('accepts a new department name and reports malformed headers', () => {
    const result = preflightPeopleImport('displayName,departmentId\n王小明,missing\n李,content', departments)
    expect(result.errors).toBe(1)
    expect(result.rows[0]).toMatchObject({ departmentId: 'missing', departmentName: 'missing', error: '' })
    expect(result.rows[1].error).toContain('姓名需为 2–40 个字符')
    expect(preflightPeopleImport('name,department', departments).rows[0].error).toContain('表头必须为')
  })

  it('accepts the Chinese template headers and department names', () => {
    const result = preflightPeopleImport('姓名,部门\n王小明,内容运营', departments)
    expect(result.errors).toBe(0)
    expect(result.rows[0]).toMatchObject({ departmentId: 'content', departmentName: '内容运营' })
    expect(result.rows[0].username).toBe('')
  })

  it('keeps accepting the previous Chinese department header', () => {
    const result = preflightPeopleImport('姓名,部门编号\n王小明,内容运营', departments)
    expect(result.errors).toBe(0)
    expect(result.rows[0]).toMatchObject({ departmentId: 'content', departmentName: '内容运营' })
  })

  it('keeps accepting legacy templates with an explicit login name', () => {
    const result = preflightPeopleImport('登录名,姓名,部门编号,初始密码\nnew.user,王小明,内容运营,local-pass-1\nNEW.USER,李小红,content,local-pass-1', departments)
    expect(result.errors).toBe(1)
    expect(result.rows[0]).toMatchObject({ username: 'new.user', departmentId: 'content' })
    expect(result.rows[1].error).toContain('文件内登录用户名重复')
  })

  it('caps rows and marks truncated files', () => {
    const result = preflightPeopleImport('displayName,departmentId\n' + Array.from({ length: 3 }, (_, index) => `人员${index},content`).join('\n'), departments, 2)
    expect(result.rows).toHaveLength(2)
    expect(result.truncated).toBe(true)
  })
})
