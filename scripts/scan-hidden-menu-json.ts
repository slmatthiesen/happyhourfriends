/**
 * $0 scan: bare-window venues whose menu/HH data is embedded as JSON in the rendered page but
 * MISSING from the text we feed the model (innerText / stripHtml) — the Twelvemonth tabbed-menu /
 * Next.js-RSC class. Renders homepage + /menus + /happy-hour, compares. Run: pnpm tsx scripts/scan-hidden-menu-json.ts
 */
import "dotenv/config";
import postgres from "postgres";
async function main(){
  const sql=postgres(process.env.DATABASE_URL!,{max:1});
  const venues=await sql<{name:string;website_url:string;city:string}[]>`
    SELECT DISTINCT v.name, v.website_url, c.name AS city
    FROM venues v JOIN cities c ON c.id=v.city_id
    WHERE v.status='active' AND v.deleted_at IS NULL AND v.website_url IS NOT NULL
      AND EXISTS (SELECT 1 FROM happy_hours h WHERE h.venue_id=v.id AND h.active=true AND h.deleted_at IS NULL)
      AND NOT EXISTS (SELECT 1 FROM happy_hours h2 JOIN offerings o ON o.happy_hour_id=h2.id AND o.active=true AND o.deleted_at IS NULL
        WHERE h2.venue_id=v.id AND h2.active=true AND h2.deleted_at IS NULL)
    ORDER BY c.name, v.name`;
  await sql.end();
  const { chromium } = await import("playwright");
  const { stripHtml } = await import("@/lib/verification/fetchUrl");
  const b = await chromium.launch({ headless:true });
  const ctx = await b.newContext({ userAgent:"Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124 Safari/537.36" });
  const MENU_JSON = /"items"\s*:\s*\[\s*\{\s*"name"/i;
  const hits:{name:string;city:string;why:string}[]=[];
  let done=0;
  for (const v of venues){
    done++;
    let origin:string; try{ origin=new URL(v.website_url).origin; }catch{ continue; }
    let why="";
    for (const path of ["","/menus","/menu","/happy-hour"]){
      const p = await ctx.newPage();
      try{
        await p.goto(origin+path,{waitUntil:"domcontentloaded",timeout:15000});
        await p.waitForLoadState("networkidle",{timeout:4000}).catch(()=>{});
        const html = await p.content();
        const fed = stripHtml(html,28000); // what we'd feed today (approx; render uses innerText, even less)
        const hhInHtml = /happy\s*hour/i.test(html);
        const hhInFed = /happy\s*hour/i.test(fed);
        const menuJson = MENU_JSON.test(html);
        if (hhInHtml && !hhInFed){ why=`hidden-HH@${path||"/"}`; }
        else if (menuJson && !/\$\s?\d/.test(fed)){ why=why||`menu-json-no-prices@${path||"/"}`; }
      }catch{}finally{ await p.close().catch(()=>{}); }
      if (why.startsWith("hidden-HH")) break;
    }
    if (why){ hits.push({name:v.name,city:v.city,why}); console.log(`  [${done}/${venues.length}] ✓ ${v.name} (${v.city}) — ${why}`); }
    else console.log(`  [${done}/${venues.length}]   ${v.name} (${v.city})`);
  }
  await b.close();
  console.log(`\n══ RESULTS: ${hits.length}/${venues.length} venues with hidden menu JSON ══`);
  hits.forEach(h=>console.log(`  ${h.name} — ${h.city} — ${h.why}`));
}
main();
