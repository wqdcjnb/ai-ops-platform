import { expect, test, type Page } from '@playwright/test'
import { readFile } from 'node:fs/promises'

test.describe.configure({ mode: 'serial' })

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
  test('添加人员', async ({ page }) => {
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
  })

  test('创建并通过三点菜单操作 Key', async ({ page }) => {
    await openAsAdmin(page, '/keys')
    await expect(page.getByRole('heading', { name: 'Key 管理' })).toBeVisible()
    await page.getByRole('button', { name: '创建 Key' }).click()
    const dialog = page.getByRole('dialog', { name: '创建 Key' })
    await dialog.getByRole('combobox', { name: '搜索所属人员' }).click()
    await dialog.getByRole('option', { name: /林筱雨/ }).click()
    await dialog.getByLabel('用途').fill('自动化验收')
    await dialog.getByRole('combobox', { name: '搜索绑定模型' }).click()
    await dialog.getByRole('option', { name: 'ecommerce-copy' }).click()
    await dialog.getByLabel('设备备注').fill('Playwright 本地验收')
    await dialog.getByRole('button', { name: '生成 Key' }).click()

    await expect(dialog).toContainText('Key 已创建')
    await expect(dialog.locator('code').first()).toHaveText(/^sk-/)
    const completeKey = await dialog.locator('code').first().innerText()
    await dialog.getByRole('button', { name: '完成' }).click()

    const row = page.getByRole('row').filter({ hasText: '自动化验收' }).first()
    await expect(row).toBeVisible()
    const menuButton = row.getByRole('button', { name: /操作$/ })
    await menuButton.click()
    const menu = page.getByRole('menu')
    await expect(menu.getByRole('menuitem', { name: '禁用' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '下载 WorkBuddy 配置' })).toBeVisible()
    await expect(menu.getByRole('menuitem', { name: '删除' })).toBeVisible()

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      menu.getByRole('menuitem', { name: '下载 WorkBuddy 配置' }).click(),
    ])
    await expect(download.suggestedFilename()).toBe('models.json')
    const downloadedPath = await download.path()
    expect(downloadedPath).not.toBeNull()
    const workBuddyConfig = JSON.parse(await readFile(downloadedPath!, 'utf8')) as { models: Array<{ apiKey: string }> }
    expect(workBuddyConfig.models[0]?.apiKey).toBe(completeKey)
    await expect(page.getByText('文件内 apiKey 已写入完整 Key', { exact: false })).toBeVisible()

    await menuButton.click()
    await page.getByRole('menu').getByRole('menuitem', { name: '禁用' }).click()
    const disableDialog = page.getByRole('dialog', { name: '确认禁用 Key' })
    await disableDialog.getByRole('button', { name: '确认禁用' }).click()
    await expect(disableDialog).toBeHidden()
    await expect(row.getByText('停用', { exact: true })).toBeVisible()

    await row.getByRole('button', { name: /操作$/ }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: '启用' }).click()
    await expect(row.getByText('启用', { exact: true })).toBeVisible()

    await row.getByRole('button', { name: /操作$/ }).click()
    await page.getByRole('menu').getByRole('menuitem', { name: '删除' }).click()
    const deleteDialog = page.getByRole('dialog', { name: '确认删除 Key' })
    const deleteButton = deleteDialog.getByRole('button', { name: /确认删除/ })
    await expect(deleteButton).toBeDisabled()
    await expect(deleteButton).toBeEnabled({ timeout: 7_000 })
    await deleteButton.click()
    await expect(deleteDialog).toBeHidden()
    await expect(row).toBeHidden()
  })

  test('额度页展示软额度废弃状态', async ({ page }) => {
    await openAsAdmin(page, '/limits')
    await expect(page.getByRole('heading', { name: '额度与限流' })).toBeVisible()
    await expect(page.getByText('软额度已废弃', { exact: true })).toBeVisible()
    await expect(page.getByText('临时额度申请', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: '调整月度软目标' })).toHaveCount(0)
  })

})
