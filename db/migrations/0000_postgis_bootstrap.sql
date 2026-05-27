-- Custom SQL migration file, put your code below! --
-- Enable PostGIS before any geometry columns are created (PRD §8.2).
-- Must run first; the schema migration depends on the geometry type.
CREATE EXTENSION IF NOT EXISTS postgis;