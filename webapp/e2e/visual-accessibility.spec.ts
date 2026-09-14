import { expect, test, type Page } from '@playwright/test'

test.describe.configure({ mode: 'serial', timeout: 120_000 })

async function signIntoDemo(page: Page) {
  await page.goto('/ui/app/')
  const demoAccess = page.getByText('Demo access')
  if (await demoAccess.isVisible()) {
    await page.getByRole('button', { name: 'Sign in' }).click()
  }
  await expect(page.locator('aside').first()).toBeVisible()
}

test('reduced motion and primary operator surfaces remain accessible', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await signIntoDemo(page)

  const motionValues = await page.evaluate(() => {
    const probe = document.createElement('div')
    probe.style.animationDuration = '10s'
    probe.style.transitionDuration = '10s'
    document.body.appendChild(probe)
    const computed = getComputedStyle(probe)
    const result = {
      animationDuration: computed.animationDuration,
      transitionDuration: computed.transitionDuration,
      scrollBehavior: computed.scrollBehavior,
    }
    probe.remove()
    return result
  })
  expect(motionValues.animationDuration).toMatch(/0\.01s|1e-05s|0ms/)
  expect(motionValues.transitionDuration).toMatch(/0\.01s|1e-05s|0ms/)
  expect(motionValues.scrollBehavior).toBe('auto')

  for (const route of [
    '/ui/app/#/laundry/dashboard',
    '/ui/app/#/laundry/new-order',
    '/ui/app/#/laundry/orders',
    '/ui/app/#/laundry/finance',
    '/ui/app/#/laundry/finance/statutory',
    '/ui/app/#/laundry/expenses',
    '/ui/app/#/laundry/management',
  ]) {
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    await expect(page.locator('aside').first()).toBeVisible()
    await expect(page.locator('[data-testid="page-loading"]')).toHaveCount(0, { timeout: 30_000 })
    await expect(page.locator('body')).not.toContainText('Application error')
    await expect(page.locator('main')).toBeVisible()
  }

  await page.goto('/ui/app/#/laundry/settings', { waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('tablist', { name: 'Settings workspaces' })).toBeVisible()
  await expect(page.getByRole('tab')).toHaveCount(5)
  for (const area of [
    ['Operations', 'Production station capacity'],
    ['Finance controls', 'Financial normalization'],
    ['Printing', 'Tag template configurator'],
    ['Data safety', 'Recovery rehearsal'],
  ] as const) {
    await page.getByRole('tab', { name: new RegExp(area[0]) }).click()
    await expect(page.getByRole('tabpanel')).toHaveCount(1)
    await expect(page.getByText(area[1], { exact: false }).first()).toBeVisible()
  }
})

test('customer work card traps focus and restores it when dismissed', async ({ page }) => {
  await signIntoDemo(page)
  await page.goto('/ui/app/#/laundry/orders?view=customers', { waitUntil: 'domcontentloaded' })
  const trigger = page.getByRole('button', { name: 'Open profile' }).first()
  await expect(trigger).toBeVisible()
  await trigger.focus()
  await trigger.click()

  const drawer = page.getByRole('dialog').filter({ hasText: 'Customer work card' })
  const close = drawer.getByRole('button', { name: 'Close customer work card' })
  await expect(drawer).toBeVisible()
  await expect(close).toBeFocused()

  // The activity tab contains only the close control and three section tabs;
  // after repeated forward navigation focus must still be in the modal.
  for (let index = 0; index < 8; index += 1) await page.keyboard.press('Tab')
  await expect(drawer.locator(':focus')).toHaveCount(1)

  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('order work card traps focus and restores it when dismissed', async ({ page }) => {
  await signIntoDemo(page)
  await page.goto('/ui/app/#/laundry/orders', { waitUntil: 'domcontentloaded' })
  const trigger = page.getByRole('button', { name: 'View' }).first()
  await expect(trigger).toBeVisible()
  await trigger.focus()
  await trigger.click()

  const drawer = page.getByRole('dialog', { name: 'Order work card' })
  await expect(drawer).toBeVisible()
  await expect(drawer).toBeFocused()
  await page.keyboard.press('Tab')
  await expect(drawer.locator(':focus')).toHaveCount(1)

  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('statutory workspace traps focus and restores it when dismissed', async ({ page }) => {
  await signIntoDemo(page)
  await page.goto('/ui/app/#/laundry/finance/statutory', { waitUntil: 'domcontentloaded' })
  const trigger = page.getByRole('button').filter({ hasText: 'Post TDS' }).first()
  await expect(trigger).toBeVisible()
  await trigger.focus()
  await trigger.click()

  const drawer = page.getByRole('dialog', { name: 'Post TDS liability' })
  const close = drawer.getByRole('button', { name: 'Close panel', exact: true }).last()
  await expect(drawer).toBeVisible()
  await expect(close).toBeFocused()

  for (let index = 0; index < 10; index += 1) await page.keyboard.press('Tab')
  await expect(drawer.locator(':focus')).toHaveCount(1)

  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('print workset traps focus and restores it when dismissed', async ({ page }) => {
  await signIntoDemo(page)
  await page.goto('/ui/app/#/laundry/print-centre', { waitUntil: 'domcontentloaded' })
  await page.getByRole('button', { name: 'All', exact: true }).click()
  const trigger = page.getByRole('button', { name: /INV-\d+-\d+/ }).filter({ hasText: 'Demo Nisha' }).first()
  await expect(trigger).toBeVisible()
  await trigger.focus()
  await trigger.click()

  const drawer = page.getByRole('dialog', { name: 'Live print workset' })
  await expect(drawer).toBeVisible()
  await expect(drawer).toBeFocused()

  for (let index = 0; index < 10; index += 1) await page.keyboard.press('Tab')
  await expect(drawer.locator(':focus')).toHaveCount(1)

  await page.keyboard.press('Escape')
  await expect(drawer).toBeHidden()
  await expect(trigger).toBeFocused()
})

test('expense reason dialog traps focus and restores its action', async ({ page }) => {
  await signIntoDemo(page)
  await page.goto('/ui/app/#/laundry/expenses', { waitUntil: 'domcontentloaded' })
  const trigger = page.getByRole('button', { name: 'Cancel', exact: true }).first()
  await expect(trigger).toBeVisible()
  await trigger.focus()
  await trigger.click()

  const dialog = page.getByRole('dialog', { name: 'Cancel this expense?' })
  await expect(dialog).toBeVisible()
  await expect(dialog.getByRole('textbox', { name: 'Expense action reason' })).toBeFocused()

  for (let index = 0; index < 6; index += 1) await page.keyboard.press('Tab')
  await expect(dialog.locator(':focus')).toHaveCount(1)

  await page.keyboard.press('Escape')
  await expect(dialog).toBeHidden()
  await expect(trigger).toBeFocused()
})
