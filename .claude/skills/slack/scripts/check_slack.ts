import puppeteer from "puppeteer-core";

async function main() {
  const res = await fetch('http://127.0.0.1:9222/json/version');
  const json = await res.json() as { webSocketDebuggerUrl: string };
  const browser = await puppeteer.connect({ browserWSEndpoint: json.webSocketDebuggerUrl });
  const pages = await browser.pages();
  const page = pages[0];
  
  console.log('URL:', page.url());
  
  // Take screenshot
  await page.screenshot({ path: '/tmp/slack_check.png', fullPage: false });
  console.log('Screenshot saved to /tmp/slack_check.png');
  
  // Check page title and content
  const title = await page.title();
  console.log('Title:', title);
  
  // Check if logged in
  const bodyText = await page.evaluate(() => document.body.innerText.substring(0, 500));
  console.log('Body text:', bodyText);
  
  await browser.disconnect();
}

main().catch(console.error);
