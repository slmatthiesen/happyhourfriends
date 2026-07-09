/**
 * Unit check for saveEvidenceFile's upload-dir resolution — the prod bug where an
 * empty EVIDENCE_UPLOAD_DIR ("" from the rendered .env) reached mkdir('') and 500'd
 * every photo submission ("network error" client-side). No network ($0, writes to a
 * temp dir). Run: pnpm tsx scripts/test-evidence-store.ts
 */
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";
import { saveEvidenceFile } from "@/lib/submit/evidenceStore";

let passed = 0;
async function check(name: string, fn: () => Promise<void>) {
  await fn();
  passed++;
  console.log(`  ✓ ${name}`);
}

async function tinyPngDataUrl(): Promise<string> {
  const buf = await sharp({
    create: { width: 4, height: 4, channels: 3, background: { r: 200, g: 50, b: 50 } },
  })
    .png()
    .toBuffer();
  return `data:image/png;base64,${buf.toString("base64")}`;
}

async function main() {
  const dataUrl = await tinyPngDataUrl();

  await check("EVIDENCE_UPLOAD_DIR set → writes the file there", async () => {
    const dir = await mkdtemp(join(tmpdir(), "hhf-ev-"));
    process.env.EVIDENCE_UPLOAD_DIR = dir;
    try {
      const res = await saveEvidenceFile(dataUrl);
      assert.ok(res, "expected a stored evidence result");
      assert.equal((await readdir(dir)).length, 1, "one file written");
    } finally {
      await rm(dir, { recursive: true, force: true });
      delete process.env.EVIDENCE_UPLOAD_DIR;
    }
  });

  await check("EVIDENCE_UPLOAD_DIR='' → falls back to default, no mkdir('') (the prod bug)", async () => {
    const cwd = process.cwd();
    const sandbox = await mkdtemp(join(tmpdir(), "hhf-cwd-"));
    process.chdir(sandbox);
    process.env.EVIDENCE_UPLOAD_DIR = ""; // exactly what prod's rendered .env supplied
    try {
      const res = await saveEvidenceFile(dataUrl);
      assert.ok(res, "expected a stored evidence result (empty env must NOT reach mkdir(''))");
      assert.match(res.url, /^\/uploads\/evidence\//);
      assert.equal((await readdir(join(sandbox, "public", "uploads", "evidence"))).length, 1);
    } finally {
      process.chdir(cwd);
      await rm(sandbox, { recursive: true, force: true });
      delete process.env.EVIDENCE_UPLOAD_DIR;
    }
  });

  console.log(`\nevidence-store: ${passed} checks passed`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
