export const PEOPLE_IMPORT_HEADERS = ['displayName', 'departmentId'] as const
export const PEOPLE_IMPORT_HEADERS_ZH = ['姓名', '部门'] as const
const legacyChinesePeopleImportHeaders = ['姓名', '部门编号'] as const
const legacyPeopleImportHeaders = ['username', 'displayName', 'departmentId', 'password'] as const
const legacyPeopleImportHeadersZh = ['登录名', '姓名', '部门编号', '初始密码'] as const
const usernamePattern = /^[a-z][a-z0-9._-]{2,39}$/i

export type PeopleImportDepartment = { id: string; name: string }
export type PeopleImportRow = {
  line: number
  username: string
  displayName: string
  departmentId: string
  password?: string
  departmentName: string
  error: string
}

export type PeopleImportResult = {
  rows: PeopleImportRow[]
  errors: number
  truncated: boolean
}

function parseCsvRecord(line: string) {
  const cells: string[] = []
  let cell = ''
  let quoted = false
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index]
    const next = line[index + 1]
    if (character === '"' && quoted && next === '"') {
      cell += '"'
      index += 1
    } else if (character === '"') {
      quoted = !quoted
    } else if (character === ',' && !quoted) {
      cells.push(cell.trim())
      cell = ''
    } else {
      cell += character
    }
  }
  cells.push(cell.trim())
  return cells
}

export function preflightPeopleImport(csv: string, departments: PeopleImportDepartment[], maxRows = 200): PeopleImportResult {
  const lines = csv.replace(/^\uFEFF/, '').split(/\r?\n/).filter((line) => line.trim().length > 0)
  if (lines.length === 0) return { rows: [], errors: 0, truncated: false }
  const headers = parseCsvRecord(lines[0]).map((header) => header.trim())
  const matchesHeaders = (expected: readonly string[]) => expected.every((header, index) => headers[index] === header) && headers.length === expected.length
  const currentEnglishHeadersMatch = matchesHeaders(PEOPLE_IMPORT_HEADERS)
  const currentChineseHeadersMatch = matchesHeaders(PEOPLE_IMPORT_HEADERS_ZH)
  const legacyChineseHeadersMatch = matchesHeaders(legacyChinesePeopleImportHeaders)
  const legacyEnglishHeadersMatch = matchesHeaders(legacyPeopleImportHeaders)
  const legacyFullChineseHeadersMatch = matchesHeaders(legacyPeopleImportHeadersZh)
  const legacyHeaders = legacyEnglishHeadersMatch || legacyFullChineseHeadersMatch
  const headerError = currentEnglishHeadersMatch || currentChineseHeadersMatch || legacyChineseHeadersMatch || legacyHeaders ? '' : `表头必须为：${PEOPLE_IMPORT_HEADERS_ZH.join('、')}`
  const departmentMap = new Map(departments.map((department) => [department.id, department.name]))
  const departmentIdByName = new Map(departments.map((department) => [department.name, department.id]))
  const seenUsernames = new Set<string>()
  const sourceRows = lines.slice(1, maxRows + 1)
  const rows = sourceRows.map((line, index) => {
    const cells = parseCsvRecord(line)
    const [legacyUsername = '', displayName = '', departmentId = '', password = ''] = legacyHeaders ? cells : ['', cells[0] ?? '', cells[1] ?? '', '']
    const rawDepartment = departmentId.trim()
    const normalizedDepartmentId = departmentMap.has(rawDepartment) ? rawDepartment : departmentIdByName.get(rawDepartment) ?? rawDepartment
    const username = legacyHeaders ? legacyUsername : ''
    const errors: string[] = []
    if (legacyHeaders && !usernamePattern.test(username)) errors.push('登录用户名格式无效')
    if (legacyHeaders && seenUsernames.has(username.toLowerCase())) errors.push('文件内登录用户名重复')
    if (legacyHeaders) seenUsernames.add(username.toLowerCase())
    if (displayName.length < 2 || displayName.length > 40) errors.push('姓名需为 2–40 个字符')
    if (!rawDepartment) errors.push('所属部门不能为空')
    if (legacyHeaders && (password.length < 8 || password.length > 200)) errors.push('初始密码需为 8–200 个字符')
    return { line: index + 2, username, displayName, departmentId: normalizedDepartmentId, ...(legacyHeaders ? { password } : {}), departmentName: departmentMap.get(normalizedDepartmentId) ?? rawDepartment, error: errors.join('；') }
  })
  if (headerError && rows.length === 0) rows.push({ line: 1, username: '', displayName: '', departmentId: '', departmentName: '', error: headerError })
  else if (headerError) rows.unshift({ line: 1, username: '', displayName: '', departmentId: '', departmentName: '', error: headerError })
  return { rows, errors: rows.filter((row) => row.error).length, truncated: lines.length - 1 > maxRows }
}
