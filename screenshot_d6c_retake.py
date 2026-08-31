from playwright.sync_api import sync_playwright
import time

BASE = "http://localhost:5050"
OUT = "/home/user/workspace/Aktienanalyst"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})

    page.goto(f"{BASE}/#/valuechain", wait_until="networkidle", timeout=30000)
    time.sleep(3)
    ai_button = page.locator('[data-testid="button-valuechain-ai-enrich"]')
    ai_button.click()
    print("Clicked AI button, waiting for enrichment...")
    time.sleep(35)
    # Viewport-only screenshot (top area with badges + aiRole text), no cutoff issues
    page.screenshot(path=f"{OUT}/screenshot_03_valuechain_after_ai_v2.png", full_page=False)
    print("Saved screenshot_03_valuechain_after_ai_v2.png")

    browser.close()
