"""
Sprint D6c: Screenshots via Playwright (headless Chromium) — Fallback, weil der
Cloud-Browser-Harness in dieser Sandbox-Session nicht erreichbar war
("harness relay stream closed"). Direktes Playwright Python funktioniert.
"""
from playwright.sync_api import sync_playwright
import time

BASE = "http://localhost:5050"
OUT = "/home/user/workspace/Aktienanalyst"

with sync_playwright() as p:
    browser = p.chromium.launch()
    page = browser.new_page(viewport={"width": 1440, "height": 900})

    # 1) Startseite: Top-Bar mit neuem Value-Chain-Button
    page.goto(f"{BASE}/", wait_until="networkidle", timeout=30000)
    time.sleep(1.5)
    page.screenshot(path=f"{OUT}/screenshot_01_dashboard_topbar.png")
    print("Saved screenshot_01_dashboard_topbar.png")

    # 2) Value-Chain-Seite: Vor KI-Klick (Zurueck-Button + KI-Button sichtbar)
    page.goto(f"{BASE}/#/valuechain", wait_until="networkidle", timeout=30000)
    time.sleep(3)
    page.screenshot(path=f"{OUT}/screenshot_02_valuechain_before_ai.png")
    print("Saved screenshot_02_valuechain_before_ai.png")

    # 3) KI-Button klicken, warten auf Ergebnis
    ai_button = page.locator('[data-testid="button-valuechain-ai-enrich"]')
    ai_button.click()
    print("Clicked AI button, waiting for enrichment...")
    time.sleep(35)
    page.screenshot(path=f"{OUT}/screenshot_03_valuechain_after_ai.png", full_page=True)
    print("Saved screenshot_03_valuechain_after_ai.png")

    browser.close()
