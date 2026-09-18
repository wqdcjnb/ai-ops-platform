export const PEOPLE_IMPORT_HEADERS = ['username', 'displayName', 'departmentId', 'password'] as const
const usernamePattern = /^[a-z][a-z0-9._-]{2,39}$/i

export type PeopleImportDepartment = { id: string; name: string }
export type PeopleImportRow = {
  line: number
  username: string
  displayName: string
  departmentId: string
  password: string
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
  const headerError = PEOPLE_IMPORT_HEADERS.every((header, index) => headers[index] === header) && headers.length === PEOPLE_IMPORT_HEADERS.length ? '' : `表头必须为：${PEOPLE_IMPORT_HEADERS.join(',')}`
  const departmentMap = new Map(departments.map((department) => [department.id, department.name]))
  const seenUsernames = new Set<string>()
  const sourceRows = lines.slice(1, maxRows + 1)
  const rows = sourceRows.map((line, index) => {
    const [username = '', displayName = '', departmentId = '', password = ''] = parseCsvRecord(line)
    const errors: string[] = []
    if (!usernamePattern.test(username)) errors.push('登录用户名格式无效')
    if (seenUsernames.has(username.toLowerCase())) errors.push('文件内登录用户名重复')
    seenUsernames.add(username.toLowerCase())
    if (displayName.length < 2 || displayName.length > 40) errors.push('姓名需为 2–40 个字符')
    if (!departmentMap.has(departmentId)) errors.push('所属部门无效')
    if (password.length < 8 || password.length > 200) errors.push('初始密码需为 8–200 个字符')
    return { line: index + 2, username, displayName, departmentId, password, departmentName: departmentMap.get(departmentId) ?? '未识别部门', error: errors.join('；') }
  })
  if (headerError && rows.length === 0) rows.push({ line: 1, username: '', displayName: '', departmentId: '', password: '', departmentName: '', error: headerError })
  else if (headerError) rows.unshift({ line: 1, username: '', displayName: '', departmentId: '', password: '', departmentName: '', error: headerError })
  return { rows, errors: rows.filter((row) => row.error).length, truncated: lines.length - 1 > maxRows }
}

