export async function stopBrowser(browser) {
  if (!browser || browser.exitCode !== null || browser.signalCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => browser.kill("SIGKILL"), 2000);
    browser.once("exit", () => { clearTimeout(timer); resolve(); });
    browser.kill();
  });
}
