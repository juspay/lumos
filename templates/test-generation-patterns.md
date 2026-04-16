# Test Generation Patterns

> Copy this file to your project's memory-bank directory and customize it for
> your repository's test conventions. Lumos reads it at runtime to generate
> tests that match your project's exact patterns.

## Architecture: Thin Spec + Thick Handler

### Spec File (`tests/e2e/<feature>.spec.ts`)

- Import `test` from `'../base-fixtures'` (NEVER from `'@playwright/test'`)
- Import handler functions from `'../routes/<feature>/<handlerFile>'`
- Wrap in `test.describe('<Feature Name>', () => { ... })`
- Each test calls a handler: `test('description', async ({ page }) => { await handlerFn(page); })`
- Optionally add `test.describe.configure({ mode: 'parallel' })` for parallel execution

### Handler File (`tests/routes/<feature>/<handlerFile>.ts`)

- Import `expect` and `type Page` from `'@playwright/test'`
- Import `setupBetaInterception` from `'../../../src/mocks/mockNetworkHandlers'`
- Import `getAPPUrl` from `'../../utils/helpers'`
- Export async functions with signature: `async function name(page: Page): Promise<void>`
- Each function is self-contained (navigates to the page, does not assume prior state)
- ALWAYS call `setupBetaInterception(page)` at the start of each handler

### Base Fixtures (`tests/base-fixtures.ts`)

The base-fixtures file extends Playwright's `test` with per-test mock state isolation:

- Calls `resetMockState()` (Playwright route layer) before each test
- Calls `resetHandlerState()` (MSW handler layer) before each test
- Calls `setupBetaInterception(page)` to register page.route() interception
- Spec files MUST import `test` from `'../base-fixtures'`, never `'@playwright/test'`

## Selector System (CRITICAL)

### How selectors work in this project

The Playwright config sets `testIdAttribute: 'data-pw'`. This means:

- `page.getByTestId('xxx')` looks for elements with `data-pw="xxx"` (NOT data-testid)
- `page.locator('[data-pw="xxx"]')` targets the same attribute directly
- Both approaches target the SAME `data-pw` attribute -- they are interchangeable

Components apply `data-pw` via the Svelte action `use:testAttributes={'selector-name'}`,
defined in `src/lib/utils/client/actions/test-attributes.ts`. This action sets both
`data-pw` (for Playwright) and `testID` (for Appium native testing).

### Selector priority

Use selectors in this priority order. Check what the component actually uses.

1. **`page.getByTestId('xxx')`** -- MOST COMMON (2300+ usages). Uses the `data-pw`
   attribute via `testIdAttribute: 'data-pw'` config.
   Example: `page.getByTestId('offer-configuration-header')`
2. **`page.locator('[data-pw="xxx"]')`** -- SECOND MOST COMMON (~600 usages). Same
   attribute, direct locator syntax. Use when chaining or scoping.
   Example: `page.locator('[data-pw="ai-chat-message-assistant"]')`
3. **`page.getByRole('button', { name: '...' })`** -- For buttons and interactive elements
   where data-pw is not available. Example: `page.getByRole('button', { name: 'Quick Install' })`
4. **`page.getByText('...')`** -- For visible text labels, headings. Last resort.

### How to find selectors in source

Search component source for:

- `use:testAttributes={'selector-name'}` -- Svelte action, most common
- `data-pw="selector-name"` -- Direct HTML attribute
- `data-testid="selector-name"` -- Equivalent to data-pw due to config

**CRITICAL RULE**: Before writing ANY selector, you MUST read the component source file and
verify which selector attributes actually exist. NEVER fabricate a selector.

## Mocking Infrastructure

### setupBetaInterception

- ALWAYS call `setupBetaInterception(page)` explicitly at the start of each handler function.
  Even though base-fixtures also calls it, 163 existing handlers call it explicitly for reliability.
- Import: `import { setupBetaInterception } from '../../../src/mocks/mockNetworkHandlers'`
- Must be called BEFORE `page.goto()` for route interception to register

### Mock data locations

- Mock route handlers: `src/mocks/handlers.ts` (3200+ lines, MSW-based)
- Network interception: `src/mocks/mockNetworkHandlers.ts` (2600+ lines, page.route()-based)
- Mock data JSON files: `src/mocks/routes/<route>/` (33 directories, 122 JSON files)
- For custom API mocking beyond the defaults, use `page.route()` inline (21 existing usages)

### isMockingEnabled() branching

The function `isMockingEnabled()` returns true when `PUBLIC_MOCKING_ENABLED=true`.
Use it for environment-aware assertions:

```typescript
import { isMockingEnabled } from '../../utils/helpers';

if (isMockingEnabled()) {
  // Mock: tight assertions against known mock data
  await expect(page.getByTestId('metric-value')).toHaveText('78.4%');
} else {
  // Non-mock: loose assertions (data is live, values vary)
  await expect(page.getByTestId('metric-value')).toBeVisible();
}
```

Common patterns:

- **Tight vs. loose assertions**: Exact values in mock mode, existence checks in non-mock
- **Feature availability**: Some features only testable in mock mode (e.g., delete operations)
- **Complete function bypass**: `if (isMockingEnabled()) return;` for setup functions not needed in mock mode

## Test Utility Functions

### Core helpers (`tests/utils/helpers.ts`)

- `getAPPUrl()` -- Returns base URL from `PUBLIC_APP_URL` or defaults to `http://localhost:4173`
- `isMockingEnabled()` -- Checks `PUBLIC_MOCKING_ENABLED` env var
- `stabilizeForPixelMatch(page, waitMs?)` -- For visual regression stability

### AI test helpers (`tests/utils/aiTestHelpers.ts`)

For features involving AI chat or LLM responses:

- `sendQuery(page, query)` -- Sends text to the AI chat input (`data-testid="ask-follow-up-questions"`)
- `waitForCompleteResponse(responseElement)` -- Polls response text for stability (250ms intervals, 5 consecutive stable checks)
- `validateResponse(text, expectedKeywords[], testDescription)` -- Asserts response validity
- `testLLMQueryWithFollowUp(page, query, followUp, keywords, desc)` -- Full conversation flow

### Chart wait helpers (`tests/utils/chartWaitHelpers.ts`)

For features involving charts/graphs:

- `waitForChartReady(page, config)` -- Generic: container visible -> SVG visible -> data elements
- `waitForHighchartsReady(page, selector)` -- Highcharts-specific (SVG path/rect rendering)
- `waitForLineChartReady(page)` -- Targets `#line-chart-id`
- `waitForStatsCardsAnimated(page)` -- Waits for counter animations (500ms buffer)

### Sidebar navigation (`tests/utils/sidebarNavigation.ts`)

- `navigateToRoute(page, tabTestId)` -- Handles setupBetaInterception + goto + shop selection + tab navigation
- Uses a TAB_URL_MAP to map test IDs to URL paths

### Environment config (`tests/utils/environmentConfig.ts`)

- `getInfraStack()` -- Returns 'aws' or 'gcp' based on `TEST_INFRA` env var
- `getEnvironmentInfo()` -- Returns environment, URL, mocking state, infra stack
- `getEnvironmentConfig()` -- Multi-tier config resolution (LOCAL/BETA/PROD x AWS/GCP)

## Real Handler Example (from offersNavigation.ts)

This is an ACTUAL handler from the codebase. Match this style exactly.

```typescript
import type { Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { getAPPUrl } from '../../utils/helpers';
import { setupBetaInterception } from '../../../src/mocks/mockNetworkHandlers';

async function navigateToOffersPage(page: Page) {
  const baseUrl = getAPPUrl();
  await page.goto(`${baseUrl}/shop/offers`);
  await page.waitForURL(/.*\/shop\/offers/);
  await expect(page.getByTestId('offer-configuration-header')).toBeVisible();
}

export async function testOffersNavigation(page: Page) {
  await setupBetaInterception(page);
  const lighthouseUrl = getAPPUrl();
  await page.goto(lighthouseUrl);

  await navigateToOffersPage(page);

  const header = page.getByTestId('offer-configuration-header');
  await expect(header).toBeVisible();
  await expect(header).toHaveText('Offer Configuration');

  // Verify UI elements
  await expect(page.getByTestId('auto-applied-offer-type')).toBeVisible();
  await expect(page.getByTestId('manually-applied-offer-type')).toBeVisible();

  // Test navigation
  await page.getByTestId('auto-applied-offer-type').click();
  await page.waitForURL(/.*\/shop\/offers\/create\/?\?type=auto_applied/);
  await expect(page.getByTestId('offer-name-input')).toBeVisible();
}
```

Key patterns to notice:

- `type Page` imported separately from `expect`
- Helper functions (like `navigateToOffersPage`) are private, not exported
- Uses `getByTestId` for most selectors (which targets `data-pw` due to config)
- Uses `waitForURL` with regex for navigation verification
- Calls `setupBetaInterception(page)` BEFORE `page.goto()`
- Uses `getAPPUrl()` for base URL construction

## Real Spec Example (from offers.spec.ts)

```typescript
import { test } from '../base-fixtures';
import {
  testOffersNavigation,
  testManuallyAppliedOfferForm,
  testIndividualOfferPauseModalShowsAndCancels,
} from '../routes/offers/offersNavigation';

test.describe.configure({ mode: 'parallel' });

test.describe('Offers - Navigation and Offer Type Selection', () => {
  test('navigation and offer type cards', async ({ page }) => {
    await testOffersNavigation(page);
  });
  test('manually applied offer form', async ({ page }) => {
    await testManuallyAppliedOfferForm(page);
  });
  test('pause modal shows and cancels', async ({ page }) => {
    await testIndividualOfferPauseModalShowsAndCancels(page);
  });
});
```

## File Naming

- Spec: `tests/e2e/<kebab-case-feature>.spec.ts`
- Handler dir: `tests/routes/<camelCaseFeature>/`
- Handler file: descriptive name like `featureNameFunctionality.ts` or `featureNameUi.ts`

## Route Mapping

- SvelteKit routes: `src/routes/(app)/<feature>/+page.svelte`
- Components: `src/lib/components/<ComponentName>/<ComponentName>.svelte`
- Services: `src/lib/services/client/<service>.ts`
- Stores: `src/lib/stores/<store>.ts`
- Properties/types: `src/lib/components/<ComponentName>/properties.ts`

## Common Patterns in Handlers

### Wait for page readiness

```typescript
await page.waitForTimeout(2000); // CI under load needs time
await expect(page.getByTestId('please-wait'))
  .toBeHidden()
  .catch(() => {});
```

### Check optional elements gracefully

```typescript
const isVisible = await element.isVisible().catch(() => false);
if (isVisible) {
  /* interact */
}
```

### Error handling in complex flows

```typescript
try {
  await element.click();
  await page.waitForTimeout(500);
} catch (error) {
  const msg = error instanceof Error ? error.message : String(error);
  if (msg.includes('Target page, context or browser has been closed')) {
    return; // graceful exit
  }
  throw error;
}
```

### Promise.race for multi-outcome operations

Use `Promise.race` when an action can lead to multiple possible outcomes (success/error
toasts, empty state/data grid, different UI states):

```typescript
const successToast = page.getByTestId('del-success-toast');
const failToast = page.getByTestId('del-fail-toast');

await Promise.race([
  successToast.waitFor({ state: 'visible', timeout: 5000 }),
  failToast.waitFor({ state: 'visible', timeout: 5000 }),
]).catch(() => {});

const isSuccess = await successToast.isVisible().catch(() => false);
if (isSuccess) {
  // handle success path
}
```

Also used for branching on data availability:

```typescript
const noDataHeading = page.locator('h2:has-text("No Data Available")');
const dataGrid = page.getByTestId('data-grid-header');

await Promise.race([
  noDataHeading.waitFor({ state: 'visible', timeout: 30000 }),
  dataGrid.waitFor({ state: 'visible', timeout: 30000 }),
]).catch(() => {});
```

### Dropdown selection with retry

Dropdowns can be flaky due to document-level close handlers. Retry pattern:

```typescript
for (let attempt = 0; attempt < 3; attempt++) {
  await dropdown.click();
  await page.waitForTimeout(300);
  const option = page.getByTestId('option-value');
  if (await option.isVisible().catch(() => false)) {
    await option.click();
    break;
  }
}
```

## Common Interaction Patterns

### Form submission flow

```typescript
// Fill form fields
await page.getByTestId('name-input').fill('Test Name');
await page.getByTestId('email-input').fill('test@example.com');

// Submit
await page.getByTestId('submit-button').click();

// Wait for outcome (success toast OR error toast)
const successToast = page.getByTestId('success-toast');
const errorToast = page.getByTestId('error-toast');

await Promise.race([
  successToast.waitFor({ state: 'visible', timeout: 10000 }),
  errorToast.waitFor({ state: 'visible', timeout: 10000 }),
]).catch(() => {});

await expect(successToast).toBeVisible();
```

### Table/grid with data loading

```typescript
// Wait for data grid to load (handle empty state)
const noDataMessage = page.getByTestId('no-data-message');
const gridRow = page.getByTestId('grid-row').first();

await Promise.race([
  noDataMessage.waitFor({ state: 'visible', timeout: 30000 }),
  gridRow.waitFor({ state: 'visible', timeout: 30000 }),
]).catch(() => {});

const hasData = await gridRow.isVisible().catch(() => false);
if (hasData) {
  // Interact with data rows
  await gridRow.click();
  await page.waitForTimeout(500);
}
```

### Modal open/interact/close

```typescript
// Open modal
await page.getByTestId('open-modal-button').click();
await expect(page.getByTestId('modal-header')).toBeVisible();

// Interact inside modal
await page.getByTestId('modal-input').fill('value');
await page.getByTestId('modal-confirm').click();

// Wait for modal to close
await expect(page.getByTestId('modal-header')).toBeHidden();

// Verify state change after modal closes
await expect(page.getByTestId('updated-value')).toHaveText('value');
```

### API response wait

```typescript
// When you need to wait for a specific API response
const responsePromise = page.waitForResponse(
  (resp) => resp.url().includes('/api/endpoint') && resp.status() === 200
);
await page.getByTestId('trigger-button').click();
await responsePromise;

// Now verify the UI updated with the response data
await expect(page.getByTestId('result-display')).toBeVisible();
```

## Known Failure Patterns and Solutions

When generating tests, avoid these known pitfalls:

| Pattern                       | Cause                                         | Solution                                                               |
| ----------------------------- | --------------------------------------------- | ---------------------------------------------------------------------- |
| Strict mode violation         | Multiple elements match locator               | Use `.first()`, `.nth()`, or more specific selectors                   |
| Modal overlay blocking clicks | Modal persists after selection                | Use `page.reload()` or wait for overlay hidden                         |
| Sidebar toggle not visible    | Sidebar requires `$session.user` truthy       | Wait for visibility with timeout, call `setupBetaInterception()` first |
| Toast race condition          | Success/error toasts appear unpredictably     | Use `Promise.race` + `.catch(() => {})`, then check which appeared     |
| Vibe switch timing            | Page navigates after toggle, hydration varies | Wait for page-specific signals, not fixed timeouts                     |
| Chart rendering flaky         | SVG elements render asynchronously            | Use chartWaitHelpers, check element count not just visibility          |

## Playwright Config Reference

Key settings that affect test behavior:

```
testIdAttribute: 'data-pw'     -- getByTestId targets data-pw attributes
viewport: { width: 1500, height: 1000 }
timeout: 360000                -- 6 minutes per test
expect.timeout: 30000          -- 30s for expect assertions
actionTimeout: 30000           -- 30s for actions (click, fill, etc.)
navigationTimeout: 30000       -- 30s for goto/waitForURL
colorScheme: 'dark'            -- dark mode by default
screenshot: 'only-on-failure'
video: 'retain-on-failure'
```

## Type Safety and Linting

Generated tests must pass the same type checking and linting as production code:

- `strict: true` in tsconfig.json -- no implicit any, strict null checks
- ESLint enforces `no-explicit-any` on test files
- Use `type Page` import (not `Page` value import) from `'@playwright/test'`
- All handler functions must have explicit return types: `Promise<void>`
- Avoid `as any` casts; use proper typing for all variables
