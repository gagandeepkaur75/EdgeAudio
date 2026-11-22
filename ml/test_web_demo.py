import time
import subprocess
import os
import sys
from playwright.sync_api import sync_playwright
from paths import P

def test_web_demo_in_browser():
    print("\n" + "="*60)
    print("TEST 5: Real Headless Browser End-to-End Test")
    print("="*60)

    web_dir = os.path.abspath(P("web"))
    print(f"Starting python http.server in {web_dir} on port 8000...")

    # Start HTTP server
    server_proc = subprocess.Popen(
        [sys.executable, "-m", "http.server", "8000"],
        cwd=web_dir,
        stdout=subprocess.DEVNULL,
        stderr=subprocess.DEVNULL
    )
    time.sleep(1.0)

    console_logs = []
    page_errors = []

    try:
        with sync_playwright() as p:
            print("Launching headless Chromium browser...")
            browser = p.chromium.launch(
                headless=True,
                args=["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"]
            )
            page = browser.new_page()

            page.on("console", lambda msg: console_logs.append(f"[{msg.type}] {msg.text}"))
            page.on("pageerror", lambda err: page_errors.append(str(err)))

            print("Navigating to http://127.0.0.1:8000/ ...")
            page.goto("http://127.0.0.1:8000/", wait_until="networkidle", timeout=15000)

            # Wait for ONNX initialization
            print("Waiting for ONNX model initialization...")
            page.wait_for_function(
                "document.getElementById('backend-val').textContent.includes('WASM')",
                timeout=10000
            )
            print("  ✓ ONNX Runtime WASM backend initialized successfully in browser!")

            # 1. Test Clean Speech Sample
            print("\n1. Testing Clean Speech Sample (clean.wav)...")
            page.select_option("#select-sample", "samples/clean.wav")
            # Wait for audio processing and inferences
            time.sleep(2.0)

            mos_text = page.locator("#mos-number").text_content()
            vad_text = page.locator("#vad-status").text_content()
            print(f"  Clean sample result: MOS = '{mos_text}', VAD Status = '{vad_text}'")
            assert mos_text != "_" and float(mos_text) >= 2.8, f"Clean sample expected MOS >= 2.8, got {mos_text}"
            print("  ✓ Clean Speech Test PASS")

            # 2. Test Noisy Speech Sample
            print("\n2. Testing Noisy Speech Sample (noisy.wav)...")
            page.select_option("#select-sample", "samples/noisy.wav")
            time.sleep(2.0)

            noisy_mos = page.locator("#mos-number").text_content()
            noisy_diag = page.locator("#diag-noise-val").text_content()
            print(f"  Noisy sample result: MOS = '{noisy_mos}', Noise Diag = '{noisy_diag}'")
            assert float(noisy_mos) < float(mos_text), f"Noisy MOS should be lower than clean MOS: {noisy_mos} vs {mos_text}"
            print("  ✓ Noisy Speech Test PASS")

            # 3. Test Room Silence Sample
            print("\n3. Testing Room Silence (silence.wav)...")
            page.select_option("#select-sample", "samples/silence.wav")
            time.sleep(2.0)

            silence_mos = page.locator("#mos-number").text_content()
            silence_vad = page.locator("#vad-status").text_content()
            print(f"  Silence sample result: MOS = '{silence_mos}', VAD Status = '{silence_vad}'")
            assert silence_mos == "_", f"Silence sample MUST show '_', but showed '{silence_mos}'"
            print("  ✓ Silence Underscore Test PASS (Silence never produces a low score!)")

            # 4. Check console errors
            print("\n4. Checking browser console errors...")
            errors = [log for log in console_logs if "[error]" in log.lower()]
            if errors:
                print("Browser console errors:", errors)
            if page_errors:
                print("Page uncaught errors:", page_errors)
            assert len(page_errors) == 0, f"Uncaught page errors found: {page_errors}"
            print("  ✓ Zero uncaught page errors in browser!")

            browser.close()
            print("\n>>> ALL HEADLESS BROWSER DEMO TESTS PASSED! <<<")

    finally:
        server_proc.terminate()
        server_proc.wait()
        print("HTTP server stopped.")

if __name__ == '__main__':
    test_web_demo_in_browser()
