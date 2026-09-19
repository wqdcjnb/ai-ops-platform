import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial' })

let auditBacktraceUrl = ''

async function openAsAdmin(page: Page, path: string) {
  try {
    await page.goto(path)
  } catch (error) {
    if (!String(error).includes('ERR_ABORTED')) throw error
    await page.waitForTimeout(250)
    await page.goto(path, { waitUntil: 'domcontentloaded' })
  }
  await expect(page).not.toHaveURL(/\/login/)
}

test.describe('管理端关键本地闭环', () => {
  test('添加人员并回溯创建审计', async ({ page }) => {
    const suffix = Date.now().toString(36)
    const displayName = `验收员${suffix.slice(-4)}`

    await openAsAdmin(page, '/people')
    await expect(page.getByRole('heading', { name: '人员与部门' })).toBeVisible()
    await expect(page.getByRole('columnheader', { name: '主要用途' })).toHaveCount(0)
    await expect(page.getByText('允许模型', { exact: true })).toHaveCount(0)
    await page.getByRole('button', { name: '添加人员' }).click()
    const dialog = page.getByRole('dialog', { name: '添加人员' })
    await dialog.getByLabel('姓名').fill(displayName)
    await dialog.getByLabel('所属部门').fill('内容运营')
    await dialog.getByRole('button', { name: '保存人员' }).click()

    await expect(dialog).toContainText(`${displayName} 已添加`)
    await dialog.getByRole('link', { name: /查看 .* 操作审计/ }).click()
    await expect(page).toHaveURL(/\/audit\?eventId=audit-person-.*-create/)
    await expect(page.getByRole('heading', { name: '审计日志' })).toBeVisible()
  })

  test('批量导入人员并完成整批写入', async ({ page }) => {
    const suffix = Date.now().toString(36)
    const displayName = `批量验收${suffix.slice(-4)}`

    await openAsAdmin(page, '/people')
    await page.getByRole('button', { name: '批量导入' }).click()
    const dialog = page.getByRole('dialog', { name: '批量导入人员' })
    await dialog.locator('input[type=file]').setInputFiles({
      name: 'people.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(`displayName,departmentId\n${displayName},content\n`),
    })
    await expect(dialog).toContainText('1 行已预检')
    await expect(dialog.getByText('可导入')).toBeVisible()
    await dialog.getByRole('button', { name: '确认导入' }).click()
    await expect(dialog).toContainText(`已导入 1 名人员`)
    await expect(dialog.getByRole('link', { name: /查看 .* 操作审计/ })).toBeVisible()
  })

  test('创建 Key 并保留一次性凭证展示', async ({ page }) => {
    await openAsAdmin(page, '/keys')
    await expect(page.getByRole('heading', { name: 'Key 管理' })).toBeVisible()
    await page.getByRole('button', { name: '创建 Key' }).click()
    const dialog = page.getByRole('dialog', { name: '创建 Key' })
    await dialog.getByLabel('所属人员').selectOption({ label: '林筱雨' })
    await dialog.getByLabel('业务用途').fill('自动化验收')
    await dialog.getByLabel('绑定模型').selectOption('ecommerce-copy')
    await dialog.getByLabel('设备备注').fill('Playwright 本地验收')
    await dialog.getByRole('button', { name: '生成 Key' }).click()

    await expect(dialog).toContainText('完整 Key 仅展示这一次')
    await expect(dialog.locator('code').first()).toHaveText(/^sk-/)
    await expect(dialog.getByRole('link', { name: /查看 .* 操作审计/ })).toBeVisible()
  })

  test('额度页展示软额度废弃状态', async ({ page }) => {
    await openAsAdmin(page, '/limits')
    await expect(page.getByRole('heading', { name: '额度与限流' })).toBeVisible()
    await expect(page.getByText('软额度已废弃', { exact: true })).toBeVisible()
    await expect(page.getByText('临时额度申请', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '调整月度软目标' })).toHaveCount(0)
  })

  test('处置告警并从结果回溯审计', async ({ page }) => {
    await openAsAdmin(page, '/alerts')
    await expect(page.getByRole('heading', { name: '告警中心' })).toBeVisible()
    const firstEvent = page.locator('.alert-event').filter({ has: page.locator('.alert-state.open') }).first()
    await expect(firstEvent).toBeVisible()
    await firstEvent.getByRole('button', { name: /查看 .* 详情/ }).click()
    await page.getByRole('button', { name: '确认告警' }).click()
    const actionDialog = page.getByRole('dialog', { name: '确认本地模拟告警' })
    await actionDialog.locator('textarea').fill('自动化验收已完成告警复核')
    await actionDialog.locator('input[type=checkbox]').check()
    await actionDialog.getByRole('button', { name: '确认本地告警' }).click()

    const detail = page.getByRole('dialog', { name: '告警事件详情' })
    await expect(detail).toContainText('已确认本地模拟告警')
    await detail.getByRole('link', { name: /查看 .* 操作审计/ }).click()
    auditBacktraceUrl = page.url()
    await expect(page).toHaveURL(/\/audit\?eventId=audit-alert-ack-/)
    await expect(page.getByRole('heading', { name: '审计日志' })).toBeVisible()
  })

  test('审计回溯深链接可再次打开', async ({ page }) => {
    expect(auditBacktraceUrl).toMatch(/\/audit\?eventId=audit-alert-ack-/)
    await openAsAdmin(page, auditBacktraceUrl)
    await expect(page).toHaveURL(/\/audit\?eventId=audit-alert-ack-/)
    await expect(page.getByRole('heading', { name: '审计日志' })).toBeVisible()
  })
})
