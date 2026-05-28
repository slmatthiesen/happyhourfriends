/**
 * Persist a venue's hero photo locally so we serve our own copy and never re-hit the
 * Google Place Photos API per render (operator decision 2026-05). Re-encodes through
 * sharp to a bounded JPEG (normalizes format, drops EXIF/metadata). Returns the public
 * path to store in venues.hero_image_url, or null.
 *
 * Storage mirrors lib/submit/evidenceStore: ./public/uploads/venues, served at
 * /uploads/venues/<file>. Override dir/base with VENUE_IMG_DIR / VENUE_IMG_PUBLIC_BASE
 * (point at a mounted volume or swap for object storage at scale).
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import sharp from "sharp";

const PUBLIC_BASE = process.env.VENUE_IMG_PUBLIC_BASE ?? "/uploads/venues";

function imgDir(): string {
  return (
    process.env.VENUE_IMG_DIR ??
    join(/* turbopackIgnore: true */ process.cwd(), "public", "uploads", "venues")
  );
}

/**
 * @param venueId  used as the stable filename (one hero per venue; re-runs overwrite).
 * @returns public path like /uploads/venues/<id>.jpg, or null on failure.
 */
export async function saveVenuePhoto(
  venueId: string,
  bytes: Buffer,
): Promise<string | null> {
  try {
    const jpeg = await sharp(bytes, { failOn: "error" })
      .rotate()
      .resize(1200, 800, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 80, mozjpeg: true })
      .toBuffer();
    const name = `${venueId}.jpg`;
    const dir = imgDir();
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, name), jpeg);
    return `${PUBLIC_BASE}/${name}`;
  } catch {
    return null;
  }
}
