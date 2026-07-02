import { chromium } from "playwright";

const url = process.argv[2];
if (!url) throw new Error("usage: tsx scripts/tmp-reddit-fetch.ts <reddit-thread-url>");

async function main() {
const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  userAgent:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36",
  viewport: { width: 1280, height: 2000 },
  locale: "en-US",
});
const page = await ctx.newPage();
await page.goto(url, { waitUntil: "domcontentloaded", timeout: 30_000 });
await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});
// Reddit lazy-loads comments on scroll; nudge a few times.
for (let i = 0; i < 6; i++) {
  await page.evaluate(() => window.scrollBy(0, document.body.scrollHeight));
  await page.waitForTimeout(1200);
}

const data = await page.evaluate(() => {
  const title = document.querySelector("h1")?.textContent?.trim() ?? "";
  const postBody =
    (document.querySelector("[slot='text-body'], [property='schema:text'], shreddit-post") as HTMLElement | null)
      ?.innerText?.trim() ?? "";
  const comments = Array.from(document.querySelectorAll("shreddit-comment"))
    .map((c) => {
      const author = c.getAttribute("author") ?? "";
      const score = c.getAttribute("score") ?? "";
      const body =
        (c.querySelector("[slot='comment'], .md, [id$='-comment-rtjson-content']") as HTMLElement | null)
          ?.innerText?.trim() ??
        (c as HTMLElement).innerText?.trim() ??
        "";
      const depth = c.getAttribute("depth") ?? "0";
      return { author, score, depth, body };
    })
    .filter((c) => c.body && c.body.length > 1);
  return { title, postBody, commentCount: comments.length, comments };
});

console.log(JSON.stringify(data, null, 2));
await browser.close();
}

main();
