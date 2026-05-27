import { customType, timestamp } from "drizzle-orm/pg-core";

/**
 * Shared column groups. Per PRD §3, every table carries created_at + updated_at;
 * user-impacting tables additionally carry a soft-delete column.
 */
export const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
};

export const softDelete = {
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
};

/**
 * PostGIS geometry columns. Drizzle's built-in geometry type only models points,
 * so we declare exact PostGIS types via customType. Values are read/written as WKT
 * (e.g. ST_AsText / ST_GeomFromText) through the raw-SQL escape hatch in import jobs.
 */
export const multiPolygon4326 = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geometry(MultiPolygon,4326)";
  },
});

export const polygon4326 = customType<{ data: string; driverData: string }>({
  dataType() {
    return "geometry(Polygon,4326)";
  },
});
