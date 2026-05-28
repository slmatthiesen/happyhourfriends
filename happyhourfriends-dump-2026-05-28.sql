--
-- PostgreSQL database dump
--

-- Dumped from database version 16.4 (Debian 16.4-1.pgdg110+2)
-- Dumped by pg_dump version 16.4 (Debian 16.4-1.pgdg110+2)

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: drizzle; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA drizzle;


--
-- Name: pgboss; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA pgboss;


--
-- Name: tiger; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA tiger;


--
-- Name: tiger_data; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA tiger_data;


--
-- Name: topology; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA topology;


--
-- Name: SCHEMA topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA topology IS 'PostGIS Topology schema';


--
-- Name: fuzzystrmatch; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS fuzzystrmatch WITH SCHEMA public;


--
-- Name: EXTENSION fuzzystrmatch; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION fuzzystrmatch IS 'determine similarities and distance between strings';


--
-- Name: postgis; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis WITH SCHEMA public;


--
-- Name: EXTENSION postgis; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis IS 'PostGIS geometry and geography spatial types and functions';


--
-- Name: postgis_tiger_geocoder; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder WITH SCHEMA tiger;


--
-- Name: EXTENSION postgis_tiger_geocoder; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_tiger_geocoder IS 'PostGIS tiger geocoder and reverse geocoder';


--
-- Name: postgis_topology; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS postgis_topology WITH SCHEMA topology;


--
-- Name: EXTENSION postgis_topology; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON EXTENSION postgis_topology IS 'PostGIS topology spatial types and functions';


--
-- Name: job_state; Type: TYPE; Schema: pgboss; Owner: -
--

CREATE TYPE pgboss.job_state AS ENUM (
    'created',
    'retry',
    'active',
    'completed',
    'cancelled',
    'failed'
);


--
-- Name: ai_risk_level; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ai_risk_level AS ENUM (
    'low',
    'medium',
    'high',
    'critical'
);


--
-- Name: ai_stage; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ai_stage AS ENUM (
    'classify',
    'verify',
    'reverify_cron',
    'seed',
    'interpret'
);


--
-- Name: ai_verdict; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.ai_verdict AS ENUM (
    'auto_apply',
    'verify',
    'queue_outreach',
    'queue_admin',
    'reject'
);


--
-- Name: city_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.city_status AS ENUM (
    'discovery',
    'enriching',
    'live',
    'paused'
);


--
-- Name: data_completeness; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.data_completeness AS ENUM (
    'stub',
    'partial',
    'complete',
    'verified'
);


--
-- Name: edit_target_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.edit_target_type AS ENUM (
    'venue',
    'happy_hour',
    'offering',
    'new_venue',
    'intent',
    'new_offering'
);


--
-- Name: flag_resolution; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.flag_resolution AS ENUM (
    'confirmed',
    'rejected',
    'expired'
);


--
-- Name: flag_target_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.flag_target_type AS ENUM (
    'venue',
    'happy_hour'
);


--
-- Name: flag_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.flag_type AS ENUM (
    'discontinued',
    'price_increase',
    'hours_changed',
    'closed',
    'other'
);


--
-- Name: hh_exception_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.hh_exception_type AS ENUM (
    'closed',
    'modified'
);


--
-- Name: location_within_venue; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.location_within_venue AS ENUM (
    'bar',
    'patio',
    'dining',
    'all'
);


--
-- Name: offering_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.offering_category AS ENUM (
    'beer',
    'wine',
    'cocktail',
    'spirit',
    'appetizer',
    'entree',
    'dessert',
    'other'
);


--
-- Name: offering_kind; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.offering_kind AS ENUM (
    'food',
    'drink',
    'other'
);


--
-- Name: promotion_tier; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.promotion_tier AS ENUM (
    'none',
    'highlight',
    'pin',
    'banner'
);


--
-- Name: seed_outcome; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.seed_outcome AS ENUM (
    'confirmed_hh',
    'no_hh_found',
    'no_hh_explicit',
    'error'
);


--
-- Name: submission_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.submission_status AS ENUM (
    'pending',
    'classifying',
    'verifying',
    'auto_applied',
    'queued_outreach',
    'queued_admin',
    'applied',
    'rejected',
    'reverted',
    'budget_exhausted',
    'interpreting',
    'interpreted'
);


--
-- Name: tag_category; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.tag_category AS ENUM (
    'vibe',
    'amenity',
    'cuisine',
    'other'
);


--
-- Name: venue_status; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.venue_status AS ENUM (
    'active',
    'closed',
    'paused',
    'no_happy_hour'
);


--
-- Name: venue_type; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.venue_type AS ENUM (
    'restaurant',
    'bar',
    'sports_bar',
    'pub',
    'dive_bar',
    'wine_bar',
    'brewery',
    'tasting_room',
    'cocktail_lounge',
    'gastropub',
    'club',
    'cafe',
    'hotel_bar',
    'pizzeria',
    'other'
);


--
-- Name: verification_source; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.verification_source AS ENUM (
    'website',
    'facebook',
    'instagram',
    'google',
    'yelp',
    'other'
);


--
-- Name: vote_value; Type: TYPE; Schema: public; Owner: -
--

CREATE TYPE public.vote_value AS ENUM (
    'confirm',
    'deny'
);


--
-- Name: create_queue(text, jsonb); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.create_queue(queue_name text, options jsonb) RETURNS void
    LANGUAGE plpgsql
    AS $_$
    DECLARE
      tablename varchar := CASE WHEN options->>'partition' = 'true'
                            THEN 'j' || encode(sha224(queue_name::bytea), 'hex')
                            ELSE 'job_common'
                            END;
      queue_created_on timestamptz;
    BEGIN

      WITH q as (
        INSERT INTO pgboss.queue (
          name,
          policy,
          retry_limit,
          retry_delay,
          retry_backoff,
          retry_delay_max,
          expire_seconds,
          retention_seconds,
          deletion_seconds,
          warning_queued,
          dead_letter,
          partition,
          table_name,
          heartbeat_seconds
        )
        VALUES (
          queue_name,
          options->>'policy',
          COALESCE((options->>'retryLimit')::int, 2),
          COALESCE((options->>'retryDelay')::int, 0),
          COALESCE((options->>'retryBackoff')::bool, false),
          (options->>'retryDelayMax')::int,
          COALESCE((options->>'expireInSeconds')::int, 900),
          COALESCE((options->>'retentionSeconds')::int, 1209600),
          COALESCE((options->>'deleteAfterSeconds')::int, 604800),
          COALESCE((options->>'warningQueueSize')::int, 0),
          options->>'deadLetter',
          COALESCE((options->>'partition')::bool, false),
          tablename,
          (options->>'heartbeatSeconds')::int
        )
        ON CONFLICT DO NOTHING
        RETURNING created_on
      )
      SELECT created_on into queue_created_on from q;

      IF queue_created_on IS NULL OR options->>'partition' IS DISTINCT FROM 'true' THEN
        RETURN;
      END IF;

      EXECUTE format('CREATE TABLE pgboss.%I (LIKE pgboss.job INCLUDING DEFAULTS)', tablename);

      EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD PRIMARY KEY (name, id)$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue (name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED$cmd$, tablename);

      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i5 ON pgboss.job (name, start_after) INCLUDE (priority, created_on, id) WHERE state < 'active'$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i4 ON pgboss.job (name, singleton_on, COALESCE(singleton_key, '')) WHERE state <> 'cancelled' AND singleton_on IS NOT NULL$cmd$, tablename);
      EXECUTE pgboss.job_table_format($cmd$CREATE INDEX job_i7 ON pgboss.job (name, group_id) WHERE state = 'active' AND group_id IS NOT NULL$cmd$, tablename);

      IF options->>'policy' = 'short' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i1 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'created' AND policy = 'short'$cmd$, tablename);
      ELSIF options->>'policy' = 'singleton' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i2 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state = 'active' AND policy = 'singleton'$cmd$, tablename);
      ELSIF options->>'policy' = 'stately' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i3 ON pgboss.job (name, state, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'stately'$cmd$, tablename);
      ELSIF options->>'policy' = 'exclusive' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i6 ON pgboss.job (name, COALESCE(singleton_key, '')) WHERE state <= 'active' AND policy = 'exclusive'$cmd$, tablename);
      ELSIF options->>'policy' = 'key_strict_fifo' THEN
        EXECUTE pgboss.job_table_format($cmd$CREATE UNIQUE INDEX job_i8 ON pgboss.job (name, singleton_key) WHERE state IN ('active', 'retry', 'failed') AND policy = 'key_strict_fifo'$cmd$, tablename);
        EXECUTE pgboss.job_table_format($cmd$ALTER TABLE pgboss.job ADD CONSTRAINT job_key_strict_fifo_singleton_key_check CHECK (NOT (policy = 'key_strict_fifo' AND singleton_key IS NULL))$cmd$, tablename);
      END IF;

      EXECUTE format('ALTER TABLE pgboss.%I ADD CONSTRAINT cjc CHECK (name=%L)', tablename, queue_name);
      EXECUTE format('ALTER TABLE pgboss.job ATTACH PARTITION pgboss.%I FOR VALUES IN (%L)', tablename, queue_name);
    END;
    $_$;


--
-- Name: delete_queue(text); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.delete_queue(queue_name text) RETURNS void
    LANGUAGE plpgsql
    AS $$
    DECLARE
      v_table varchar;
      v_partition bool;
    BEGIN
      SELECT table_name, partition
      FROM pgboss.queue
      WHERE name = queue_name
      INTO v_table, v_partition;

      IF v_partition THEN
        EXECUTE format('DROP TABLE IF EXISTS pgboss.%I', v_table);
      ELSE
        EXECUTE format('DELETE FROM pgboss.%I WHERE name = %L', v_table, queue_name);
      END IF;

      DELETE FROM pgboss.queue WHERE name = queue_name;
    END;
    $$;


--
-- Name: job_table_format(text, text); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.job_table_format(command text, table_name text) RETURNS text
    LANGUAGE sql IMMUTABLE
    AS $_$
      SELECT format(
        replace(
          replace(command, '.job', '.%1$I'),
          'job_i', '%1$s_i'
        ),
        table_name
      );
    $_$;


--
-- Name: job_table_run(text, text, text); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.job_table_run(command text, tbl_name text DEFAULT NULL::text, queue_name text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
    DECLARE
      tbl RECORD;
    BEGIN
      IF queue_name IS NOT NULL THEN
        SELECT table_name INTO tbl_name FROM pgboss.queue WHERE name = queue_name;
      END IF;

      IF tbl_name IS NOT NULL THEN
        EXECUTE pgboss.job_table_format(command, tbl_name);
        RETURN;
      END IF;

      EXECUTE pgboss.job_table_format(command, 'job_common');

      FOR tbl IN SELECT table_name FROM pgboss.queue WHERE partition = true
      LOOP
        EXECUTE pgboss.job_table_format(command, tbl.table_name);
      END LOOP;
    END;
    $$;


--
-- Name: job_table_run_async(text, integer, text, text, text); Type: FUNCTION; Schema: pgboss; Owner: -
--

CREATE FUNCTION pgboss.job_table_run_async(command_name text, version integer, command text, tbl_name text DEFAULT NULL::text, queue_name text DEFAULT NULL::text) RETURNS void
    LANGUAGE plpgsql
    AS $$
    BEGIN
      IF queue_name IS NOT NULL THEN
        SELECT table_name INTO tbl_name FROM pgboss.queue WHERE name = queue_name;
      END IF;

      IF tbl_name IS NOT NULL THEN
        INSERT INTO pgboss.bam (name, version, status, queue, table_name, command)
        VALUES (
          command_name,
          version,
          'pending',
          queue_name,
          tbl_name,
          pgboss.job_table_format(command, tbl_name)
        );
        RETURN;
      END IF;

      INSERT INTO pgboss.bam (name, version, status, queue, table_name, command)
      SELECT
        command_name,
        version,
        'pending',
        NULL,
        'job_common',
        pgboss.job_table_format(command, 'job_common')
      UNION ALL
      SELECT
        command_name,
        version,
        'pending',
        queue.name,
        queue.table_name,
        pgboss.job_table_format(command, queue.table_name)
      FROM pgboss.queue
      WHERE partition = true;
    END;
    $$;


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: __drizzle_migrations; Type: TABLE; Schema: drizzle; Owner: -
--

CREATE TABLE drizzle.__drizzle_migrations (
    id integer NOT NULL,
    hash text NOT NULL,
    created_at bigint
);


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE; Schema: drizzle; Owner: -
--

CREATE SEQUENCE drizzle.__drizzle_migrations_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE OWNED BY; Schema: drizzle; Owner: -
--

ALTER SEQUENCE drizzle.__drizzle_migrations_id_seq OWNED BY drizzle.__drizzle_migrations.id;


--
-- Name: bam; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.bam (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    version integer NOT NULL,
    status text DEFAULT 'pending'::text NOT NULL,
    queue text,
    table_name text NOT NULL,
    command text NOT NULL,
    error text,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    completed_on timestamp with time zone
);


--
-- Name: job; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.job (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    retry_delay_max integer,
    expire_seconds integer DEFAULT 900 NOT NULL,
    deletion_seconds integer DEFAULT 604800 NOT NULL,
    singleton_key text,
    singleton_on timestamp without time zone,
    group_id text,
    group_tier text,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '336:00:00'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    heartbeat_on timestamp with time zone,
    heartbeat_seconds integer
)
PARTITION BY LIST (name);


--
-- Name: job_common; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.job_common (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    priority integer DEFAULT 0 NOT NULL,
    data jsonb,
    state pgboss.job_state DEFAULT 'created'::pgboss.job_state NOT NULL,
    retry_limit integer DEFAULT 2 NOT NULL,
    retry_count integer DEFAULT 0 NOT NULL,
    retry_delay integer DEFAULT 0 NOT NULL,
    retry_backoff boolean DEFAULT false NOT NULL,
    retry_delay_max integer,
    expire_seconds integer DEFAULT 900 NOT NULL,
    deletion_seconds integer DEFAULT 604800 NOT NULL,
    singleton_key text,
    singleton_on timestamp without time zone,
    group_id text,
    group_tier text,
    start_after timestamp with time zone DEFAULT now() NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    started_on timestamp with time zone,
    completed_on timestamp with time zone,
    keep_until timestamp with time zone DEFAULT (now() + '336:00:00'::interval) NOT NULL,
    output jsonb,
    dead_letter text,
    policy text,
    heartbeat_on timestamp with time zone,
    heartbeat_seconds integer,
    CONSTRAINT job_key_strict_fifo_singleton_key_check CHECK ((NOT ((policy = 'key_strict_fifo'::text) AND (singleton_key IS NULL))))
);


--
-- Name: queue; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.queue (
    name text NOT NULL,
    policy text NOT NULL,
    retry_limit integer NOT NULL,
    retry_delay integer NOT NULL,
    retry_backoff boolean NOT NULL,
    retry_delay_max integer,
    expire_seconds integer NOT NULL,
    retention_seconds integer NOT NULL,
    deletion_seconds integer NOT NULL,
    dead_letter text,
    partition boolean NOT NULL,
    table_name text NOT NULL,
    deferred_count integer DEFAULT 0 NOT NULL,
    queued_count integer DEFAULT 0 NOT NULL,
    warning_queued integer DEFAULT 0 NOT NULL,
    active_count integer DEFAULT 0 NOT NULL,
    total_count integer DEFAULT 0 NOT NULL,
    heartbeat_seconds integer,
    singletons_active text[],
    monitor_on timestamp with time zone,
    maintain_on timestamp with time zone,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    updated_on timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT queue_check CHECK ((dead_letter IS DISTINCT FROM name))
);


--
-- Name: schedule; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.schedule (
    name text NOT NULL,
    key text DEFAULT ''::text NOT NULL,
    cron text NOT NULL,
    timezone text,
    data jsonb,
    options jsonb,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    updated_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: subscription; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.subscription (
    event text NOT NULL,
    name text NOT NULL,
    created_on timestamp with time zone DEFAULT now() NOT NULL,
    updated_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: version; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.version (
    version integer NOT NULL,
    cron_on timestamp with time zone,
    bam_on timestamp with time zone
);


--
-- Name: warning; Type: TABLE; Schema: pgboss; Owner: -
--

CREATE TABLE pgboss.warning (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    type text NOT NULL,
    message text NOT NULL,
    data jsonb,
    created_on timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: ai_usage_ledger; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.ai_usage_ledger (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    month date NOT NULL,
    model text NOT NULL,
    input_tokens integer DEFAULT 0 NOT NULL,
    output_tokens integer DEFAULT 0 NOT NULL,
    cost_cents integer DEFAULT 0 NOT NULL,
    stage public.ai_stage NOT NULL,
    submission_id uuid,
    city_id uuid,
    prompt_hash text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: audit_log; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.audit_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    table_name text NOT NULL,
    row_id uuid NOT NULL,
    before_jsonb jsonb,
    after_jsonb jsonb,
    actor text NOT NULL,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: chains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.chains (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    logo_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: cities; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.cities (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    name text NOT NULL,
    state text,
    country character(2) NOT NULL,
    default_timezone text NOT NULL,
    currency_code character(3) NOT NULL,
    center_lat numeric(10,7),
    center_lng numeric(10,7),
    bbox public.geometry(Polygon,4326),
    status public.city_status DEFAULT 'discovery'::public.city_status NOT NULL,
    seed_config jsonb,
    launched_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: community_flags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.community_flags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_type public.flag_target_type NOT NULL,
    target_id uuid NOT NULL,
    flag_type public.flag_type NOT NULL,
    vote_value public.vote_value NOT NULL,
    submitter_fingerprint text,
    submitter_ip inet,
    reason text,
    resolved_at timestamp with time zone,
    resolution public.flag_resolution,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: edit_submissions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.edit_submissions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    target_type public.edit_target_type NOT NULL,
    target_id uuid,
    diff_jsonb jsonb NOT NULL,
    submitter_fingerprint text,
    submitter_ip inet,
    submitter_email text,
    ai_risk_score smallint,
    ai_risk_level public.ai_risk_level,
    ai_verdict public.ai_verdict,
    ai_classifier_reasoning text,
    ai_evidence_jsonb jsonb,
    status public.submission_status DEFAULT 'pending'::public.submission_status NOT NULL,
    applied_by text,
    decided_at timestamp with time zone,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    parent_submission_id uuid
);


--
-- Name: happy_hour_exceptions; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.happy_hour_exceptions (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    happy_hour_id uuid NOT NULL,
    exception_date date NOT NULL,
    type public.hh_exception_type NOT NULL,
    override_start_time time without time zone,
    override_end_time time without time zone,
    reason text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: happy_hours; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.happy_hours (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    venue_id uuid NOT NULL,
    start_time time without time zone NOT NULL,
    end_time time without time zone,
    crosses_midnight boolean GENERATED ALWAYS AS ((end_time < start_time)) STORED,
    location_within_venue public.location_within_venue DEFAULT 'all'::public.location_within_venue NOT NULL,
    valid_from date,
    valid_until date,
    notes text,
    active boolean DEFAULT true NOT NULL,
    source_url text,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    days_of_week smallint[] NOT NULL,
    CONSTRAINT happy_hours_dow_iso CHECK (((array_length(days_of_week, 1) >= 1) AND (1 <= ALL (days_of_week)) AND (7 >= ALL (days_of_week))))
);


--
-- Name: neighborhoods; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.neighborhoods (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    city_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    polygon public.geometry(MultiPolygon,4326),
    source text,
    source_url text,
    parent_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: offerings; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.offerings (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    happy_hour_id uuid NOT NULL,
    kind public.offering_kind NOT NULL,
    category public.offering_category NOT NULL,
    name text,
    price_cents integer,
    original_price_cents integer,
    discount_cents integer,
    currency_code character(3),
    description text,
    conditions text,
    location_restriction public.location_within_venue,
    source_url text,
    active boolean DEFAULT true NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone
);


--
-- Name: seed_candidates; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.seed_candidates (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    city_id uuid NOT NULL,
    name text NOT NULL,
    google_place_id text,
    address text,
    lat numeric(10,7),
    lng numeric(10,7),
    source_url text,
    processed_at timestamp with time zone,
    outcome public.seed_outcome,
    resulting_venue_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: submitter_trust; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.submitter_trust (
    fingerprint text NOT NULL,
    ip_hashes text[],
    submission_count integer DEFAULT 0 NOT NULL,
    accuracy_count integer DEFAULT 0 NOT NULL,
    inaccuracy_count integer DEFAULT 0 NOT NULL,
    trust_score integer DEFAULT 0 NOT NULL,
    first_seen timestamp with time zone DEFAULT now() NOT NULL,
    last_seen timestamp with time zone DEFAULT now() NOT NULL,
    banned boolean DEFAULT false NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.tags (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    slug text NOT NULL,
    label text NOT NULL,
    category public.tag_category NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: venue_tags; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venue_tags (
    venue_id uuid NOT NULL,
    tag_id uuid NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: venues; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.venues (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    city_id uuid NOT NULL,
    name text NOT NULL,
    slug text NOT NULL,
    address text,
    lat numeric(10,7),
    lng numeric(10,7),
    timezone text,
    neighborhood_id uuid,
    type public.venue_type,
    chain_id uuid,
    website_url text,
    other_url text,
    google_place_id text,
    phone text,
    status public.venue_status DEFAULT 'active'::public.venue_status NOT NULL,
    flagged_at timestamp with time zone,
    flag_reason text,
    flag_vote_count integer DEFAULT 0 NOT NULL,
    promotion_tier public.promotion_tier DEFAULT 'none'::public.promotion_tier NOT NULL,
    promotion_starts_at timestamp with time zone,
    promotion_ends_at timestamp with time zone,
    data_completeness public.data_completeness DEFAULT 'stub'::public.data_completeness NOT NULL,
    last_verified_at timestamp with time zone,
    claimed_by_user_id uuid,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL,
    deleted_at timestamp with time zone,
    price_level smallint,
    hero_image_url text
);


--
-- Name: verification_attempts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.verification_attempts (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    submission_id uuid NOT NULL,
    source public.verification_source NOT NULL,
    url text,
    fetched_at timestamp with time zone,
    ai_summary text,
    supports_change boolean,
    confidence numeric(3,2),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: job_common; Type: TABLE ATTACH; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job ATTACH PARTITION pgboss.job_common DEFAULT;


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Data for Name: __drizzle_migrations; Type: TABLE DATA; Schema: drizzle; Owner: -
--

COPY drizzle.__drizzle_migrations (id, hash, created_at) FROM stdin;
1	cbc3d43ec9e30d145526c4567f8fe2cec0a0328ba93d0728e51be4478261d725	1779852913385
2	d1f1b90a6dee3fb2f0d5836d076aacf438c67ba0ff9e9723d65608019d92e8ca	1779852938357
3	d1edaa072ea04717771cb6aedf087e0e676d582eee0d7339b12abfe10b5c8fc2	1779926590181
4	42a5c0bbdee3b60ee8337c0fa62888935b210847187cea4b1fa78f29059b97b9	1779929963610
5	4ef7c1425b48394d87648d93c7805ffb56343af5fd47ffcf38c6941242cff883	1779933685354
6	0665936b684074247a1d131d8fb861b05c400372e8b9108178429d0361574948	1779933706823
\.


--
-- Data for Name: bam; Type: TABLE DATA; Schema: pgboss; Owner: -
--

COPY pgboss.bam (id, name, version, status, queue, table_name, command, error, created_on, started_on, completed_on) FROM stdin;
\.


--
-- Data for Name: job_common; Type: TABLE DATA; Schema: pgboss; Owner: -
--

COPY pgboss.job_common (id, name, priority, data, state, retry_limit, retry_count, retry_delay, retry_backoff, retry_delay_max, expire_seconds, deletion_seconds, singleton_key, singleton_on, group_id, group_tier, start_after, created_on, started_on, completed_on, keep_until, output, dead_letter, policy, heartbeat_on, heartbeat_seconds) FROM stdin;
450f7a4e-da7c-48d2-8b29-ae8ee2e6d974	classify-submission	0	{"submissionId": "280794ff-ff79-4ff1-a218-8dbb8e93511d"}	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-27 19:18:15.79433+00	2026-05-27 19:18:15.79433+00	2026-05-27 19:18:16.531145+00	2026-05-27 19:18:18.682844+00	2026-06-10 19:18:15.79433+00	\N	\N	standard	2026-05-27 19:18:16.531145+00	\N
520ab189-ed30-46ed-a877-8a7d55840e71	classify-submission	0	{"submissionId": "fc9e23be-145f-4314-804d-c11b49a7b865"}	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-28 01:17:32.898078+00	2026-05-28 01:17:32.898078+00	2026-05-28 01:17:33.56509+00	2026-05-28 01:17:33.572715+00	2026-06-11 01:17:32.898078+00	\N	\N	standard	2026-05-28 01:17:33.56509+00	\N
96d8c6a3-4d1f-40ca-8556-dc5daf06002f	classify-submission	0	{"submissionId": "ca2a111e-198f-4a8c-b31c-2a84a25f2d0f"}	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-28 01:17:32.904464+00	2026-05-28 01:17:32.904464+00	2026-05-28 01:17:35.57443+00	2026-05-28 01:17:37.058603+00	2026-06-11 01:17:32.904464+00	\N	\N	standard	2026-05-28 01:17:35.57443+00	\N
87e74f26-3126-4092-acd3-d6b28a1702f1	classify-submission	0	{"submissionId": "856c1c10-c02b-42f5-909d-68f2178e970e"}	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-28 01:17:32.907785+00	2026-05-28 01:17:32.907785+00	2026-05-28 01:17:37.586432+00	2026-05-28 01:17:39.458654+00	2026-06-11 01:17:32.907785+00	\N	\N	standard	2026-05-28 01:17:37.586432+00	\N
27ffe3d2-3178-469f-80ac-344237f8bd87	classify-submission	0	{"submissionId": "e658106f-ef65-4dc0-824c-83642050401d"}	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-28 01:17:32.91155+00	2026-05-28 01:17:32.91155+00	2026-05-28 01:17:39.588558+00	2026-05-28 01:17:40.893222+00	2026-06-11 01:17:32.91155+00	\N	\N	standard	2026-05-28 01:17:39.588558+00	\N
d3f83e70-7243-44fe-8d35-35963e331683	classify-submission	0	{"submissionId": "b091e2f0-82f2-4b5a-a98e-fee49f182856"}	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-28 01:17:32.915128+00	2026-05-28 01:17:32.915128+00	2026-05-28 01:17:41.595032+00	2026-05-28 01:17:43.051323+00	2026-06-11 01:17:32.915128+00	\N	\N	standard	2026-05-28 01:17:41.595032+00	\N
febf8bc0-5624-42c1-ab3b-86910d5cdd06	verify-submission	0	{"submissionId": "fc9e23be-145f-4314-804d-c11b49a7b865"}	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-28 01:17:34.444388+00	2026-05-28 01:17:34.444388+00	2026-05-28 01:17:35.51106+00	2026-05-28 01:17:46.313424+00	2026-06-11 01:17:34.444388+00	\N	\N	standard	2026-05-28 01:17:35.51106+00	\N
098ef9b7-c7a7-4a69-942f-18490b933c7d	verify-submission	0	{"submissionId": "ca2a111e-198f-4a8c-b31c-2a84a25f2d0f"}	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-28 01:17:37.056294+00	2026-05-28 01:17:37.056294+00	2026-05-28 01:17:46.314577+00	2026-05-28 01:17:56.050241+00	2026-06-11 01:17:37.056294+00	\N	\N	standard	2026-05-28 01:17:46.314577+00	\N
38f27a43-e827-4fd2-8972-e6ca8c67b9cf	verify-submission	0	{"submissionId": "856c1c10-c02b-42f5-909d-68f2178e970e"}	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-28 01:17:39.457178+00	2026-05-28 01:17:39.457178+00	2026-05-28 01:17:56.051458+00	2026-05-28 01:18:07.420386+00	2026-06-11 01:17:39.457178+00	\N	\N	standard	2026-05-28 01:17:56.051458+00	\N
21682e6f-2567-4e98-b66d-5caa09297224	verify-submission	0	{"submissionId": "e658106f-ef65-4dc0-824c-83642050401d"}	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-28 01:17:40.891513+00	2026-05-28 01:17:40.891513+00	2026-05-28 01:18:07.421569+00	2026-05-28 01:18:17.43563+00	2026-06-11 01:17:40.891513+00	\N	\N	standard	2026-05-28 01:18:07.421569+00	\N
a9a7b99a-1ee0-47ba-a050-71cd99b17133	verify-submission	0	{"submissionId": "b091e2f0-82f2-4b5a-a98e-fee49f182856"}	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-28 01:17:43.049934+00	2026-05-28 01:17:43.049934+00	2026-05-28 01:18:17.436917+00	2026-05-28 01:18:27.825463+00	2026-06-11 01:17:43.049934+00	\N	\N	standard	2026-05-28 01:18:17.436917+00	\N
794d23ee-2345-4908-9838-9ea16890fc9f	classify-submission	0	{"submissionId": "ed5d1545-5bad-4729-b23c-978d7b0ee1a7"}	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-28 01:18:30.329747+00	2026-05-28 01:18:30.329747+00	2026-05-28 01:18:31.778217+00	2026-05-28 01:18:31.78122+00	2026-06-11 01:18:30.329747+00	\N	\N	standard	2026-05-28 01:18:31.778217+00	\N
e47e2447-31a4-4140-b8cc-0fad411f88c5	classify-submission	0	{"submissionId": "97d4b020-72f9-47c5-aa72-732b9701a108"}	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-28 02:32:13.63411+00	2026-05-28 02:32:13.63411+00	2026-05-28 02:32:15.40509+00	2026-05-28 02:32:15.408445+00	2026-06-11 02:32:13.63411+00	\N	\N	standard	2026-05-28 02:32:15.40509+00	\N
b583b052-3f0c-4e80-ab7e-c79ceb27f334	verify-submission	0	{"submissionId": "97d4b020-72f9-47c5-aa72-732b9701a108"}	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-28 02:32:15.005591+00	2026-05-28 02:32:15.005591+00	2026-05-28 02:32:15.231287+00	2026-05-28 02:32:24.450296+00	2026-06-11 02:32:15.005591+00	\N	\N	standard	2026-05-28 02:32:15.231287+00	\N
95f312f7-4886-44a8-8542-a821370a0821	__pgboss__send-it	0	{"data": null, "name": "reverify-venues", "options": {}}	completed	2	0	0	f	\N	900	604800	reverify-venues__	2026-05-28 07:00:00	\N	\N	2026-05-28 07:00:14.970848+00	2026-05-28 07:00:14.970848+00	2026-05-28 07:00:17.207746+00	2026-05-28 07:00:17.2115+00	2026-06-11 07:00:14.970848+00	\N	\N	standard	2026-05-28 07:00:17.207746+00	\N
9b2bb0a2-2d84-4a44-bbb0-d1738671f018	reverify-venues	0	\N	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-28 07:00:17.209773+00	2026-05-28 07:00:17.209773+00	2026-05-28 07:00:18.414932+00	2026-05-28 07:02:51.903346+00	2026-06-11 07:00:17.209773+00	\N	\N	standard	2026-05-28 07:00:18.414932+00	\N
251d005f-9a8c-44fe-9971-fcd9fd6b53d6	__pgboss__send-it	0	{"data": null, "name": "resolve-flags", "options": {}}	completed	2	0	0	f	\N	900	604800	resolve-flags__	2026-05-28 08:00:00	\N	\N	2026-05-28 08:00:15.865771+00	2026-05-28 08:00:15.865771+00	2026-05-28 08:00:17.683701+00	2026-05-28 08:00:17.68733+00	2026-06-11 08:00:15.865771+00	\N	\N	standard	2026-05-28 08:00:17.683701+00	\N
5088807a-36ca-40ee-9d3d-c5a4550c88c3	resolve-flags	0	\N	completed	2	0	0	f	\N	900	604800	\N	\N	\N	\N	2026-05-28 08:00:17.685728+00	2026-05-28 08:00:17.685728+00	2026-05-28 08:00:19.366442+00	2026-05-28 08:00:19.390115+00	2026-06-11 08:00:17.685728+00	\N	\N	standard	2026-05-28 08:00:19.366442+00	\N
\.


--
-- Data for Name: queue; Type: TABLE DATA; Schema: pgboss; Owner: -
--

COPY pgboss.queue (name, policy, retry_limit, retry_delay, retry_backoff, retry_delay_max, expire_seconds, retention_seconds, deletion_seconds, dead_letter, partition, table_name, deferred_count, queued_count, warning_queued, active_count, total_count, heartbeat_seconds, singletons_active, monitor_on, maintain_on, created_on, updated_on) FROM stdin;
__pgboss__send-it	standard	2	0	f	\N	900	1209600	604800	\N	f	job_common	0	0	0	0	2	\N	\N	2026-05-28 14:44:45.934176+00	2026-05-27 19:13:48.747982+00	2026-05-27 19:12:48.736647+00	2026-05-27 19:12:48.736647+00
classify-submission	standard	2	0	f	\N	900	1209600	604800	\N	f	job_common	0	0	0	0	8	\N	\N	2026-05-28 14:44:45.934176+00	2026-05-27 19:13:48.747982+00	2026-05-27 19:12:48.75348+00	2026-05-27 19:12:48.75348+00
verify-submission	standard	2	0	f	\N	900	1209600	604800	\N	f	job_common	0	0	0	0	6	\N	\N	2026-05-28 14:44:45.934176+00	2026-05-27 19:13:48.747982+00	2026-05-27 19:12:48.758498+00	2026-05-27 19:12:48.758498+00
resolve-flags	standard	2	0	f	\N	900	1209600	604800	\N	f	job_common	0	0	0	0	1	\N	\N	2026-05-28 14:44:45.934176+00	2026-05-27 19:13:48.747982+00	2026-05-27 19:12:48.75981+00	2026-05-27 19:12:48.75981+00
detect-anomalies	standard	2	0	f	\N	900	1209600	604800	\N	f	job_common	0	0	0	0	0	\N	\N	2026-05-28 14:44:45.934176+00	2026-05-27 19:13:48.747982+00	2026-05-27 19:12:48.809358+00	2026-05-27 19:12:48.809358+00
reverify-venues	standard	2	0	f	\N	900	1209600	604800	\N	f	job_common	0	0	0	0	1	\N	\N	2026-05-28 14:44:45.934176+00	2026-05-27 19:13:48.747982+00	2026-05-27 19:12:48.81269+00	2026-05-27 19:12:48.81269+00
interpret-submission	standard	2	0	f	\N	900	1209600	604800	\N	f	job_common	0	0	0	0	0	\N	\N	\N	\N	2026-05-28 16:26:54.644916+00	2026-05-28 16:26:54.644916+00
\.


--
-- Data for Name: schedule; Type: TABLE DATA; Schema: pgboss; Owner: -
--

COPY pgboss.schedule (name, key, cron, timezone, data, options, created_on, updated_on) FROM stdin;
resolve-flags		0 8 * * *	UTC	\N	{}	2026-05-27 19:12:48.805924+00	2026-05-28 16:26:54.69077+00
detect-anomalies		0 9 * * 1	UTC	\N	{}	2026-05-27 19:12:48.811443+00	2026-05-28 16:26:54.693589+00
reverify-venues		0 7 * * *	UTC	\N	{}	2026-05-27 19:12:48.814734+00	2026-05-28 16:26:54.695612+00
\.


--
-- Data for Name: subscription; Type: TABLE DATA; Schema: pgboss; Owner: -
--

COPY pgboss.subscription (event, name, created_on, updated_on) FROM stdin;
\.


--
-- Data for Name: version; Type: TABLE DATA; Schema: pgboss; Owner: -
--

COPY pgboss.version (version, cron_on, bam_on) FROM stdin;
30	2026-05-28 16:27:24.649587+00	2026-05-28 16:26:54.646522+00
\.


--
-- Data for Name: warning; Type: TABLE DATA; Schema: pgboss; Owner: -
--

COPY pgboss.warning (id, type, message, data, created_on) FROM stdin;
\.


--
-- Data for Name: ai_usage_ledger; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.ai_usage_ledger (id, month, model, input_tokens, output_tokens, cost_cents, stage, submission_id, city_id, prompt_hash, created_at, updated_at) FROM stdin;
37eccebd-d732-497b-9d67-77bde0b36884	2026-05-01	claude-haiku-4-5	506	109	1	classify	280794ff-ff79-4ff1-a218-8dbb8e93511d	\N	76a83c9e6fef8cc4	2026-05-27 19:18:18.676026+00	2026-05-27 19:18:18.676026+00
078a3796-dee2-4266-8f15-50ade39c4392	2026-05-01	claude-sonnet-4-6	27944	862	10	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	286d8565743750d1	2026-05-27 21:46:30.577877+00	2026-05-27 21:46:30.577877+00
af68e4ca-d6ae-4538-a440-e8cc39ea3c81	2026-05-01	claude-sonnet-4-6	15362	954	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-27 21:46:30.582174+00	2026-05-27 21:46:30.582174+00
fcf721c1-0cc7-4224-aa04-c0f6f465c9b5	2026-05-01	claude-sonnet-4-6	5439	553	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-27 21:46:43.279728+00	2026-05-27 21:46:43.279728+00
abb16e95-2844-41a5-82f8-3ff29b2e1c3d	2026-05-01	claude-sonnet-4-6	15570	680	6	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	286d8565743750d1	2026-05-27 21:47:23.214352+00	2026-05-27 21:47:23.214352+00
a12b23c2-9e5c-4e24-8035-ec1ae7da25dc	2026-05-01	claude-sonnet-4-6	10536	942	5	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-27 21:47:23.216055+00	2026-05-27 21:47:23.216055+00
6eae13ef-c83f-4a55-9dbc-4a6b1075a48c	2026-05-01	claude-sonnet-4-6	21400	4666	14	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	286d8565743750d1	2026-05-27 21:48:54.145619+00	2026-05-27 21:48:54.145619+00
e152dc19-7482-4fa2-8cf2-81221dc07f02	2026-05-01	claude-sonnet-4-6	13384	1171	6	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-27 21:48:54.147514+00	2026-05-27 21:48:54.147514+00
265dc86e-4d07-4cff-8d64-919facab3413	2026-05-01	claude-sonnet-4-6	13301	1085	6	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-27 21:49:17.808657+00	2026-05-27 21:49:17.808657+00
f75ccd05-ab88-4ca7-96f0-8d49bd27d3a2	2026-05-01	claude-sonnet-4-6	404208	4926	129	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	9d4a1407c57ff73b	2026-05-27 22:29:20.127648+00	2026-05-27 22:29:20.127648+00
6b1ebe51-75a9-46fd-a72e-764255a35ace	2026-05-01	claude-sonnet-4-6	7788	794	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-27 22:29:20.132871+00	2026-05-27 22:29:20.132871+00
29a4b6ea-b694-427c-bc81-d353239c7f98	2026-05-01	claude-sonnet-4-6	15485	992	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-27 22:46:16.542349+00	2026-05-27 22:46:16.542349+00
e7fe6744-ac2c-4293-8f14-19fb61ca1498	2026-05-01	claude-sonnet-4-6	10852	881	5	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-27 22:47:33.797047+00	2026-05-27 22:47:33.797047+00
5b509d57-6f4b-40ac-9099-59353e9fbeef	2026-05-01	claude-sonnet-4-6	5447	397	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-27 22:47:45.359093+00	2026-05-27 22:47:45.359093+00
af2eee46-2668-41a7-a928-7dba747139ff	2026-05-01	claude-haiku-4-5	14668	452	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	9d4a1407c57ff73b	2026-05-27 22:48:57.083954+00	2026-05-27 22:48:57.083954+00
0ef4333c-e1ef-43ee-8534-f6920237a6bc	2026-05-01	claude-sonnet-4-6	10016	850	5	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-27 22:48:57.088286+00	2026-05-27 22:48:57.088286+00
5e9d8712-6296-448b-a20f-f61d8bb17e59	2026-05-01	claude-haiku-4-5	37056	606	5	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:08:59.864553+00	2026-05-28 00:08:59.864553+00
6135cd52-25fe-4409-9308-9b4bf6b75adf	2026-05-01	claude-haiku-4-5	18250	483	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:09:10.593001+00	2026-05-28 00:09:10.593001+00
08d5b52c-41ce-4a82-9fff-9a2dc59dcbef	2026-05-01	claude-haiku-4-5	8822	387	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:09:34.641098+00	2026-05-28 00:09:34.641098+00
fd7b3cbd-4629-40bf-bf0d-a9cd0700d694	2026-05-01	claude-haiku-4-5	38535	730	5	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:37:18.547163+00	2026-05-28 00:37:18.547163+00
f853f84f-5f63-4040-9379-35625773f2d7	2026-05-01	claude-haiku-4-5	12633	374	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:37:24.750168+00	2026-05-28 00:37:24.750168+00
f49b371e-dfd0-471b-b8e2-bce73d364238	2026-05-01	claude-haiku-4-5	11225	921	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:37:34.290275+00	2026-05-28 00:37:34.290275+00
8ba3227d-d6e4-4cd6-b770-f7cd1549be3f	2026-05-01	claude-haiku-4-5	9796	424	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:37:40.97925+00	2026-05-28 00:37:40.97925+00
5af1b44c-6fdd-40d7-a93b-3a016be77fca	2026-05-01	claude-haiku-4-5	22503	375	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:37:47.981947+00	2026-05-28 00:37:47.981947+00
5b448254-5250-4fea-bae1-402ca07e8422	2026-05-01	claude-haiku-4-5	15783	370	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:38:11.597882+00	2026-05-28 00:38:11.597882+00
3c5122e0-9deb-498a-8074-a98d37b62942	2026-05-01	claude-haiku-4-5	11955	396	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:38:27.29115+00	2026-05-28 00:38:27.29115+00
9e624c5c-8984-4034-b425-41d23c553447	2026-05-01	claude-haiku-4-5	40474	469	5	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:38:49.006526+00	2026-05-28 00:38:49.006526+00
488c80f9-3e0e-45d6-a729-53b2310b1567	2026-05-01	claude-haiku-4-5	12010	460	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:39:30.59313+00	2026-05-28 00:39:30.59313+00
cffb922e-4f80-4491-8848-27a20ce33dad	2026-05-01	claude-haiku-4-5	18427	357	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:39:47.606339+00	2026-05-28 00:39:47.606339+00
16ee0738-13fd-4519-8d8a-8504886aef5d	2026-05-01	claude-haiku-4-5	27014	607	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:40:13.03827+00	2026-05-28 00:40:13.03827+00
41bb1745-aca8-43d0-8736-f6b974f1b8b0	2026-05-01	claude-haiku-4-5	33053	487	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:40:44.746149+00	2026-05-28 00:40:44.746149+00
450d565e-e862-40d7-b2cf-eb012bd1d65f	2026-05-01	claude-haiku-4-5	20669	363	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:41:27.031656+00	2026-05-28 00:41:27.031656+00
8b48e2ac-1046-48fe-b11a-ec9edb0854f6	2026-05-01	claude-haiku-4-5	18258	365	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:41:46.722399+00	2026-05-28 00:41:46.722399+00
e4f52b2d-91f6-458b-9519-9729f52544fd	2026-05-01	claude-haiku-4-5	13387	536	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:42:08.351699+00	2026-05-28 00:42:08.351699+00
ca7d135c-cada-481f-9311-3f375551cc36	2026-05-01	claude-haiku-4-5	38135	679	5	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:42:27.693157+00	2026-05-28 00:42:27.693157+00
d31080c4-47ef-4503-96e7-e7d2f8200b4d	2026-05-01	claude-haiku-4-5	9199	379	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:43:09.969033+00	2026-05-28 00:43:09.969033+00
2f8c4e46-4522-4b4e-b3b9-2e1b0944a067	2026-05-01	claude-haiku-4-5	11394	432	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:43:20.197315+00	2026-05-28 00:43:20.197315+00
c2060b05-1874-4e27-ad6b-acd1519985c3	2026-05-01	claude-haiku-4-5	19304	554	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:43:36.598687+00	2026-05-28 00:43:36.598687+00
0edc3a4d-2ff8-410e-aac3-0a05d2963d08	2026-05-01	claude-haiku-4-5	8973	448	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:43:55.723079+00	2026-05-28 00:43:55.723079+00
89e21d52-c49e-42ec-90bd-c05e1b7a8cbb	2026-05-01	claude-haiku-4-5	11289	372	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:44:07.117089+00	2026-05-28 00:44:07.117089+00
18da1ff3-6f30-47e2-9030-e47c39a2aeb9	2026-05-01	claude-haiku-4-5	19810	390	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:44:23.224171+00	2026-05-28 00:44:23.224171+00
5352614a-502b-4c3b-928e-8aeb6f4b65c4	2026-05-01	claude-haiku-4-5	15205	586	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:44:58.958412+00	2026-05-28 00:44:58.958412+00
f8256c35-c7f4-4aa1-a69f-5dd4a1e9ab4f	2026-05-01	claude-haiku-4-5	8790	355	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:45:21.945271+00	2026-05-28 00:45:21.945271+00
cf6efb9d-5b04-47a9-9e17-ac256ec82ad8	2026-05-01	claude-haiku-4-5	13589	520	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:45:33.243774+00	2026-05-28 00:45:33.243774+00
2aa0326e-7844-4191-bef2-4842e5e93163	2026-05-01	claude-haiku-4-5	11610	375	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:45:40.071103+00	2026-05-28 00:45:40.071103+00
354bf075-42bf-4696-a5f3-e51aaae2beea	2026-05-01	claude-haiku-4-5	26685	559	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:45:50.878196+00	2026-05-28 00:45:50.878196+00
2ecde8c3-24ad-48c9-9f45-729f05f6a777	2026-05-01	claude-haiku-4-5	29412	492	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:46:19.067957+00	2026-05-28 00:46:19.067957+00
ef31d740-511b-483d-b082-64dbc43db9dc	2026-05-01	claude-haiku-4-5	15477	399	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:46:51.222963+00	2026-05-28 00:46:51.222963+00
562e21a3-0afa-4755-b718-5f514b00d5c5	2026-05-01	claude-haiku-4-5	44189	2023	6	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:47:24.949458+00	2026-05-28 00:47:24.949458+00
1dc8b584-7efe-4f34-a5ce-ad1bf3c3f954	2026-05-01	claude-haiku-4-5	34633	490	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:48:07.174144+00	2026-05-28 00:48:07.174144+00
ee091cb8-912e-477a-9abe-02054e570b95	2026-05-01	claude-haiku-4-5	33099	724	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:48:47.891969+00	2026-05-28 00:48:47.891969+00
507f53e1-2f53-4e8e-abb6-c8a947c55a10	2026-05-01	claude-haiku-4-5	12118	438	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:49:27.499578+00	2026-05-28 00:49:27.499578+00
0c9cf944-e257-47f4-8a35-61d78c83564b	2026-05-01	claude-haiku-4-5	12700	401	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:49:39.205641+00	2026-05-28 00:49:39.205641+00
6beb5b1e-2a27-477c-9210-b2be96b3ef5d	2026-05-01	claude-haiku-4-5	25867	382	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:49:56.142321+00	2026-05-28 00:49:56.142321+00
14457bc0-17c1-4695-abc4-55a9d0b1d8f7	2026-05-01	claude-haiku-4-5	18550	463	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:50:28.139382+00	2026-05-28 00:50:28.139382+00
29e12089-c12f-462a-8400-c8399c8efad9	2026-05-01	claude-haiku-4-5	17733	516	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:50:49.548344+00	2026-05-28 00:50:49.548344+00
4c9181f2-9863-42b9-b4cd-5d6ce546437d	2026-05-01	claude-haiku-4-5	12981	410	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:51:09.479067+00	2026-05-28 00:51:09.479067+00
ffc6325b-07a5-45ac-94a1-52f767bbf657	2026-05-01	claude-haiku-4-5	30212	1582	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:51:40.855551+00	2026-05-28 00:51:40.855551+00
b0c82144-4c0f-4870-8bbd-abe1876f5bb4	2026-05-01	claude-haiku-4-5	36314	501	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:52:00.445264+00	2026-05-28 00:52:00.445264+00
50734830-f974-41d9-aa19-d8e808066f1c	2026-05-01	claude-haiku-4-5	12005	414	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:52:43.21877+00	2026-05-28 00:52:43.21877+00
b611a203-d6b5-45c0-99e2-9c2b404f4de8	2026-05-01	claude-haiku-4-5	11961	513	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:52:58.743793+00	2026-05-28 00:52:58.743793+00
0a90112c-71bc-42ea-9d19-3c7aa9628253	2026-05-01	claude-haiku-4-5	26145	487	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:53:22.789107+00	2026-05-28 00:53:22.789107+00
9414ea39-e0fd-4eeb-9d42-0e84d903bc00	2026-05-01	claude-haiku-4-5	31346	491	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:53:46.243902+00	2026-05-28 00:53:46.243902+00
644d0afb-894c-4f6e-9b56-eb979f710c37	2026-05-01	claude-haiku-4-5	8845	376	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:54:40.378905+00	2026-05-28 00:54:40.378905+00
b2ad9473-64e3-4f39-99a5-aff39511ebe6	2026-05-01	claude-haiku-4-5	13841	347	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:54:46.373397+00	2026-05-28 00:54:46.373397+00
a66084cc-6f3a-4b9b-82fd-bda37eb1fe0f	2026-05-01	claude-haiku-4-5	14562	424	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:54:54.749102+00	2026-05-28 00:54:54.749102+00
16b62c32-1701-4115-865a-60da20219640	2026-05-01	claude-haiku-4-5	23154	557	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:55:08.842932+00	2026-05-28 00:55:08.842932+00
4f990625-2a74-47d3-9ac0-41bcd871a980	2026-05-01	claude-haiku-4-5	21755	1672	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:55:52.544983+00	2026-05-28 00:55:52.544983+00
da738c23-3eeb-40d2-9b8e-2682f835b294	2026-05-01	claude-haiku-4-5	37309	1221	5	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:56:06.446985+00	2026-05-28 00:56:06.446985+00
a392b838-97df-4b29-a529-14d58bc20aaa	2026-05-01	claude-haiku-4-5	11034	380	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:56:47.242403+00	2026-05-28 00:56:47.242403+00
2363c889-f672-4791-9e78-1680f574b1e5	2026-05-01	claude-haiku-4-5	19957	1266	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:57:10.269865+00	2026-05-28 00:57:10.269865+00
3e4659b8-e096-44d7-a630-9f845f2eb497	2026-05-01	claude-haiku-4-5	26757	788	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:57:25.965793+00	2026-05-28 00:57:25.965793+00
a9b77100-bef5-4f83-a7ad-b29bd42a5d85	2026-05-01	claude-haiku-4-5	12243	396	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:57:55.055024+00	2026-05-28 00:57:55.055024+00
0324dfa1-3a80-4f6d-a66f-74a704a763a7	2026-05-01	claude-haiku-4-5	15833	363	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:58:08.122523+00	2026-05-28 00:58:08.122523+00
8ef2446f-317e-4033-ba40-a677a7dc94c6	2026-05-01	claude-haiku-4-5	13516	382	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:58:58.251374+00	2026-05-28 00:58:58.251374+00
2da33880-7bc9-4b9d-a6aa-b53de40e0b78	2026-05-01	claude-haiku-4-5	9000	438	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:59:12.157204+00	2026-05-28 00:59:12.157204+00
bd7db7ad-d311-4abc-bb7e-f780041ba72b	2026-05-01	claude-haiku-4-5	20051	2669	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:59:37.398224+00	2026-05-28 00:59:37.398224+00
2a414177-83bb-46e0-8b19-3ae4b1c360a6	2026-05-01	claude-haiku-4-5	16393	357	2	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	325d8fc9e3082b30	2026-05-28 00:59:48.412259+00	2026-05-28 00:59:48.412259+00
c22d0276-d60b-43e7-9faf-de3fca9a039f	2026-05-01	claude-haiku-4-5	30730	1809	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 01:39:26.200097+00	2026-05-28 01:39:26.200097+00
bc4c0f9e-4086-4b00-9592-4d8e2710918d	2026-05-01	claude-haiku-4-5	177937	1089	19	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 01:39:46.767672+00	2026-05-28 01:39:46.767672+00
1c32c8e1-ebff-4c00-adc5-27302986b871	2026-05-01	claude-haiku-4-5	93689	889	10	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 01:42:52.041115+00	2026-05-28 01:42:52.041115+00
8cbc6a30-6cf0-454f-892e-5a2e2e7e8814	2026-05-01	claude-haiku-4-5	108887	749	12	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 02:46:49.045123+00	2026-05-28 02:46:49.045123+00
b2ded989-0649-4ecd-90f3-3a0abd795c14	2026-05-01	claude-haiku-4-5	48116	1719	6	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 02:48:13.279623+00	2026-05-28 02:48:13.279623+00
819c5057-5f6f-4da7-bdd6-dd99bdf1b85f	2026-05-01	claude-haiku-4-5	60957	1152	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 02:54:34.13702+00	2026-05-28 02:54:34.13702+00
4b00214f-5bbf-4d79-b7eb-94051c5d4805	2026-05-01	claude-haiku-4-5	90813	765	10	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 02:55:04.708662+00	2026-05-28 02:55:04.708662+00
780ac744-a5cf-486a-b81c-28323e4b3bab	2026-05-01	claude-haiku-4-5	135389	895	14	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 02:56:41.548223+00	2026-05-28 02:56:41.548223+00
096f86b6-5680-4ca4-944b-7692cc0bfda1	2026-05-01	claude-haiku-4-5	97234	812	11	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 02:59:28.003866+00	2026-05-28 02:59:28.003866+00
347f56e8-5ae9-4086-ae5f-e1a67b5860f0	2026-05-01	claude-haiku-4-5	30746	2898	5	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:14:01.020282+00	2026-05-28 04:14:01.020282+00
9ab4bc8e-e2c6-4c25-9e79-a9b7ab9b61ed	2026-05-01	claude-haiku-4-5	41448	1989	6	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:14:18.767915+00	2026-05-28 04:14:18.767915+00
c21fe49b-8da0-4495-90eb-eaafd4368295	2026-05-01	claude-haiku-4-5	111267	859	12	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:14:35.060712+00	2026-05-28 04:14:35.060712+00
242f1aac-83f0-4fe2-8040-8eca4a22cb03	2026-05-01	claude-haiku-4-5	95837	1577	11	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:16:50.876945+00	2026-05-28 04:16:50.876945+00
b4df79df-c4c2-40f5-a606-bb1b7c20c2cb	2026-05-01	claude-haiku-4-5	52207	1564	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:18:45.975847+00	2026-05-28 04:18:45.975847+00
788e555c-9fc3-4783-a47f-0182d670ccd2	2026-05-01	claude-haiku-4-5	115742	1403	13	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:19:40.53009+00	2026-05-28 04:19:40.53009+00
6b833218-3f35-453b-af98-cdc6908d1695	2026-05-01	claude-haiku-4-5	63772	695	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:21:56.57701+00	2026-05-28 04:21:56.57701+00
2103cd03-8554-46d0-b92f-151427967c08	2026-05-01	claude-haiku-4-5	67507	1579	8	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:23:15.704724+00	2026-05-28 04:23:15.704724+00
b696d9a4-ecee-40a1-8fcb-b962fea7938d	2026-05-01	claude-haiku-4-5	61556	788	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:24:30.146139+00	2026-05-28 04:24:30.146139+00
eaae70ea-7121-4a11-ba61-16f709b9376e	2026-05-01	claude-haiku-4-5	77975	870	9	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:25:50.121869+00	2026-05-28 04:25:50.121869+00
8ed0290e-c767-4c71-b043-9f159cf83321	2026-05-01	claude-haiku-4-5	58234	756	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:27:28.328894+00	2026-05-28 04:27:28.328894+00
cbeed97a-c0a8-4236-ada3-053c8a7da6ad	2026-05-01	claude-haiku-4-5	121395	703	13	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:28:26.912561+00	2026-05-28 04:28:26.912561+00
fef3e6e0-1202-4149-9c92-7fc6092ba07f	2026-05-01	claude-haiku-4-5	202046	1938	22	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:31:16.469084+00	2026-05-28 04:31:16.469084+00
467b878b-fdac-4455-9259-1e65f1093f25	2026-05-01	claude-haiku-4-5	101280	771	11	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:35:15.513857+00	2026-05-28 04:35:15.513857+00
aa65c26f-2f61-4527-846f-b49863f9b747	2026-05-01	claude-haiku-4-5	85541	831	9	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:37:04.720586+00	2026-05-28 04:37:04.720586+00
dac1e4a7-10c7-4b1e-8f5b-b0c13b113fd0	2026-05-01	claude-haiku-4-5	122060	1815	14	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:38:54.419743+00	2026-05-28 04:38:54.419743+00
6d734d3f-7d16-43e7-a324-4281b797281c	2026-05-01	claude-haiku-4-5	65600	635	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:41:06.337228+00	2026-05-28 04:41:06.337228+00
34422752-05af-4a97-879c-d6d8a2b21964	2026-05-01	claude-haiku-4-5	21403	1409	3	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:42:27.861237+00	2026-05-28 04:42:27.861237+00
5333b523-7886-4b57-bd14-731205b91253	2026-05-01	claude-haiku-4-5	76289	701	8	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:42:52.785675+00	2026-05-28 04:42:52.785675+00
807ea89e-e68f-44bd-94aa-d003f159d21a	2026-05-01	claude-haiku-4-5	72304	856	8	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:44:30.935075+00	2026-05-28 04:44:30.935075+00
6531b324-bf9b-4033-94a7-3e541eaa4665	2026-05-01	claude-haiku-4-5	67672	696	8	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:45:50.94722+00	2026-05-28 04:45:50.94722+00
849cfbda-fc27-4bd4-9b96-69bbb9caf871	2026-05-01	claude-haiku-4-5	73370	758	8	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:47:12.937944+00	2026-05-28 04:47:12.937944+00
3cc4d09d-10af-4723-a326-4d13e0f1f6ae	2026-05-01	claude-haiku-4-5	76739	907	9	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:48:48.428223+00	2026-05-28 04:48:48.428223+00
b4024c40-8eba-4a70-982a-ef80cd5469ab	2026-05-01	claude-haiku-4-5	77609	644	9	seed	\N	117cbe36-eae9-45cf-b54f-df358dbb49c1	48cb9f97e2bfdf3b	2026-05-28 04:50:10.787205+00	2026-05-28 04:50:10.787205+00
381b6c39-0df5-4e0b-8c9c-539f58ac8644	2026-05-01	claude-haiku-4-5	37012	498	4	seed	\N	117cbe36-eae9-45cf-b54f-df358dbb49c1	48cb9f97e2bfdf3b	2026-05-28 04:51:43.213989+00	2026-05-28 04:51:43.213989+00
41901944-c635-4d1e-9843-b2aa4f815c58	2026-05-01	claude-haiku-4-5	48043	984	6	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:52:00.826044+00	2026-05-28 04:52:00.826044+00
39d23fc5-a750-4061-adb8-b2bd0f77e843	2026-05-01	claude-haiku-4-5	65000	764	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:53:26.933818+00	2026-05-28 04:53:26.933818+00
f16c188d-2fd2-491f-a174-a20a3eae6c66	2026-05-01	claude-haiku-4-5	57311	676	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:54:45.157887+00	2026-05-28 04:54:45.157887+00
d0c49963-76dc-481b-becb-5a1fb9122eff	2026-05-01	claude-haiku-4-5	72850	1238	8	seed	\N	117cbe36-eae9-45cf-b54f-df358dbb49c1	48cb9f97e2bfdf3b	2026-05-28 04:55:03.518671+00	2026-05-28 04:55:03.518671+00
b885c2a4-c966-43ae-a715-f922339330f6	2026-05-01	claude-haiku-4-5	88704	1625	10	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 04:57:30.684111+00	2026-05-28 04:57:30.684111+00
3a98496c-1c8e-44e3-b025-c743e695362e	2026-05-01	claude-haiku-4-5	122715	1046	13	seed	\N	117cbe36-eae9-45cf-b54f-df358dbb49c1	48cb9f97e2bfdf3b	2026-05-28 04:57:33.669398+00	2026-05-28 04:57:33.669398+00
6d46b164-2e8b-481a-b710-fba7b097c886	2026-05-01	claude-haiku-4-5	54680	704	6	seed	\N	117cbe36-eae9-45cf-b54f-df358dbb49c1	48cb9f97e2bfdf3b	2026-05-28 05:01:33.515124+00	2026-05-28 05:01:33.515124+00
8bb6ef07-84f0-4345-b212-4647a33d14b8	2026-05-01	claude-haiku-4-5	116124	970	13	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:02:46.953175+00	2026-05-28 05:02:46.953175+00
1b616951-af6d-4d3d-aa4f-177f5ca6e90a	2026-05-01	claude-haiku-4-5	62265	2362	8	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:05:06.066607+00	2026-05-28 05:05:06.066607+00
dcac446e-c1d4-4e04-8c9b-ffe848728bea	2026-05-01	claude-haiku-4-5	112069	1613	13	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:06:20.223101+00	2026-05-28 05:06:20.223101+00
df210e5b-9a15-4157-a5fb-deaa91263e34	2026-05-01	claude-haiku-4-5	84399	1719	10	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:08:42.285293+00	2026-05-28 05:08:42.285293+00
d3486094-a3d2-452b-bc34-980d7f1f671e	2026-05-01	claude-haiku-4-5	90381	1299	10	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:10:20.372617+00	2026-05-28 05:10:20.372617+00
6de5f994-9554-4fe9-b31e-42f2e1d017b4	2026-05-01	claude-haiku-4-5	28465	2156	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:12:01.873086+00	2026-05-28 05:12:01.873086+00
cf45aaa8-525a-4ee0-a39a-a3faeeda437c	2026-05-01	claude-haiku-4-5	73763	731	8	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:12:35.518583+00	2026-05-28 05:12:35.518583+00
01cba361-ab8e-48a2-bd02-0399b793012a	2026-05-01	claude-haiku-4-5	64211	3446	9	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:14:11.052345+00	2026-05-28 05:14:11.052345+00
0c46711f-e4d9-4654-b81a-e6701971f2e7	2026-05-01	claude-haiku-4-5	126517	1125	14	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:15:38.605938+00	2026-05-28 05:15:38.605938+00
9a615530-5773-412a-8ce5-9d4cea3f253c	2026-05-01	claude-haiku-4-5	95727	788	10	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:17:55.16962+00	2026-05-28 05:17:55.16962+00
dc966cff-d336-4aff-9d66-513b6cebd5ec	2026-05-01	claude-haiku-4-5	114575	1091	13	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:19:58.45721+00	2026-05-28 05:19:58.45721+00
6ea2c2ed-ed9e-4f51-9627-03acded739c5	2026-05-01	claude-haiku-4-5	78277	847	9	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:22:10.044285+00	2026-05-28 05:22:10.044285+00
abb04fe5-82a8-458f-a3bf-af0f016ab4a1	2026-05-01	claude-haiku-4-5	37587	1690	5	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:23:45.8742+00	2026-05-28 05:23:45.8742+00
80dd1e4d-48c5-431e-b96d-30c746a52e27	2026-05-01	claude-haiku-4-5	54170	2168	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:24:25.018001+00	2026-05-28 05:24:25.018001+00
d55c931e-aaaa-4052-afd5-e9e4eb6c701a	2026-05-01	claude-haiku-4-5	87298	1643	10	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:25:33.870147+00	2026-05-28 05:25:33.870147+00
d58701e8-d25c-44fc-8f08-62e07212de7c	2026-05-01	claude-haiku-4-5	64868	803	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:27:13.019081+00	2026-05-28 05:27:13.019081+00
c49dcc5e-31e8-455c-9a25-497b6135e90a	2026-05-01	claude-haiku-4-5	75262	722	8	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:28:33.043864+00	2026-05-28 05:28:33.043864+00
52de1909-bd69-4ab5-9e82-dfdefff55dea	2026-05-01	claude-haiku-4-5	78310	757	9	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:30:07.750401+00	2026-05-28 05:30:07.750401+00
fcdc324c-bc92-4331-9713-6d26852b326f	2026-05-01	claude-haiku-4-5	32731	458	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:31:50.144189+00	2026-05-28 05:31:50.144189+00
5ad45ba8-f774-4d4d-a9eb-09cd248fbc78	2026-05-01	claude-haiku-4-5	70422	748	8	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:32:13.739663+00	2026-05-28 05:32:13.739663+00
e3ded3ba-7534-4ce0-b62d-903b0627d4b2	2026-05-01	claude-haiku-4-5	58591	722	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:33:48.884281+00	2026-05-28 05:33:48.884281+00
e649bf4d-a610-4635-afeb-f8fe42dd68e0	2026-05-01	claude-haiku-4-5	61028	3023	8	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:35:08.4113+00	2026-05-28 05:35:08.4113+00
c29c2c4e-32d1-48b6-9d67-d072bb25edc9	2026-05-01	claude-haiku-4-5	132504	772	14	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:36:06.195582+00	2026-05-28 05:36:06.195582+00
ebc6cb1d-cba3-4fd3-9f6d-e48489fd5e20	2026-05-01	claude-haiku-4-5	112744	1449	12	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:38:51.463692+00	2026-05-28 05:38:51.463692+00
6853cdd4-aec2-468f-ae82-1d7d98871215	2026-05-01	claude-haiku-4-5	91576	1414	10	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:41:03.942212+00	2026-05-28 05:41:03.942212+00
0ae152af-f1d3-4999-8547-218804919a24	2026-05-01	claude-haiku-4-5	116396	2231	13	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:42:52.489285+00	2026-05-28 05:42:52.489285+00
c173a7ef-15d5-4702-928c-2fd4f380a2d4	2026-05-01	claude-haiku-4-5	79493	2326	10	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:45:18.115109+00	2026-05-28 05:45:18.115109+00
fa996873-feeb-4d7d-b2b2-d78f2c75eb5d	2026-05-01	claude-haiku-4-5	91389	670	10	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:46:45.107741+00	2026-05-28 05:46:45.107741+00
985f34eb-b1b0-4363-ba3f-e927073862ac	2026-05-01	claude-haiku-4-5	41469	3731	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:48:39.089758+00	2026-05-28 05:48:39.089758+00
d98c2205-c5da-4e50-9d9a-0d06cd4d52a1	2026-05-01	claude-haiku-4-5	93600	987	10	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:49:36.971422+00	2026-05-28 05:49:36.971422+00
83ef8ee7-1f71-4ada-b1d7-9c7cbc3981b8	2026-05-01	claude-haiku-4-5	85313	789	9	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:51:22.215985+00	2026-05-28 05:51:22.215985+00
86b52f81-df62-43b2-ac27-e2a2df758c2f	2026-05-01	claude-haiku-4-5	31025	1459	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:52:53.917719+00	2026-05-28 05:52:53.917719+00
8538b182-7630-48dd-ac50-5c77a1305e98	2026-05-01	claude-haiku-4-5	62259	816	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:53:31.168798+00	2026-05-28 05:53:31.168798+00
8698d729-4e62-4f50-a08c-dc837a1f60f3	2026-05-01	claude-haiku-4-5	83195	1337	9	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:54:49.637658+00	2026-05-28 05:54:49.637658+00
b351290a-2ad2-4fda-80ec-01526475adfe	2026-05-01	claude-haiku-4-5	44093	5629	8	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:56:40.712157+00	2026-05-28 05:56:40.712157+00
9f4049e2-75ad-4956-a67e-853f9df2f478	2026-05-01	claude-haiku-4-5	72250	601	8	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 05:57:15.816008+00	2026-05-28 05:57:15.816008+00
00f6ff02-1216-419f-9b3c-aeef0495a02d	2026-05-01	claude-sonnet-4-6	5149	483	3	reverify_cron	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-28 07:00:29.553009+00	2026-05-28 07:00:29.553009+00
86d90193-316a-4789-abf0-3f53cfb65c50	2026-05-01	claude-sonnet-4-6	9272	724	4	reverify_cron	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-28 07:00:46.49534+00	2026-05-28 07:00:46.49534+00
140ee08d-1e16-4d56-9314-776c9453dcb5	2026-05-01	claude-sonnet-4-6	2749	359	2	reverify_cron	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-28 07:00:55.029141+00	2026-05-28 07:00:55.029141+00
9ae0e91d-d312-4b53-bebf-cb7c699bf1d1	2026-05-01	claude-sonnet-4-6	8491	578	4	reverify_cron	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-28 07:01:12.877757+00	2026-05-28 07:01:12.877757+00
8d6288d5-36e0-487a-aca5-3d3e9e9daff4	2026-05-01	claude-sonnet-4-6	3110	349	2	reverify_cron	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-28 07:01:22.923882+00	2026-05-28 07:01:22.923882+00
302fa44a-349f-414b-a979-a3e27688e8c7	2026-05-01	claude-sonnet-4-6	15505	1000	7	reverify_cron	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-28 07:01:50.549472+00	2026-05-28 07:01:50.549472+00
0ec130cf-cd8a-491a-a5a0-b733ce79e840	2026-05-01	claude-sonnet-4-6	3980	632	3	reverify_cron	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-28 07:02:00.746463+00	2026-05-28 07:02:00.746463+00
88d79469-fac2-460d-9ff8-3355966dd3dd	2026-05-01	claude-sonnet-4-6	4052	321	2	reverify_cron	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-28 07:02:08.483343+00	2026-05-28 07:02:08.483343+00
edd25a12-7d97-45df-b302-a72800df27d2	2026-05-01	claude-sonnet-4-6	11809	832	5	reverify_cron	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-28 07:02:26.873151+00	2026-05-28 07:02:26.873151+00
bc113715-5e59-49ab-875f-49b55ba6ce79	2026-05-01	claude-sonnet-4-6	17670	1101	7	reverify_cron	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	df24a4385175abfa	2026-05-28 07:02:51.899582+00	2026-05-28 07:02:51.899582+00
da50ceef-1372-481c-804f-19019d4a0b53	2026-05-01	claude-haiku-4-5	63899	660	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 16:24:27.053841+00	2026-05-28 16:24:27.053841+00
7e63008a-934b-4e65-8439-7cf3cedaa997	2026-05-01	claude-haiku-4-5	117112	951	13	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 16:24:58.342481+00	2026-05-28 16:24:58.342481+00
aec13663-914a-4e8a-b61c-2ad407e18363	2026-05-01	claude-haiku-4-5	49148	1044	6	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 16:25:14.073477+00	2026-05-28 16:25:14.073477+00
6e60cb12-8b53-46db-826e-2bd35bf34ba7	2026-05-01	claude-haiku-4-5	28232	1654	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 16:25:56.750978+00	2026-05-28 16:25:56.750978+00
59545763-1464-4b8f-b1de-c4093d05e85a	2026-05-01	claude-haiku-4-5	30447	547	4	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 16:26:22.474102+00	2026-05-28 16:26:22.474102+00
26d4e9f2-6469-4525-a9f6-63b185240678	2026-05-01	claude-haiku-4-5	48483	666	6	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 16:27:03.181469+00	2026-05-28 16:27:03.181469+00
0168a2c2-74b1-4984-8d94-2f62c5d2ab5a	2026-05-01	claude-haiku-4-5	54381	547	6	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 16:27:58.648978+00	2026-05-28 16:27:58.648978+00
5b5fc8c9-8198-479c-9cde-3a9fc5a1ffd3	2026-05-01	claude-haiku-4-5	63584	553	7	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 16:29:05.429527+00	2026-05-28 16:29:05.429527+00
4491ddc7-65c4-497e-a7b4-e37c3c2592c3	2026-05-01	claude-haiku-4-5	39925	464	5	seed	\N	6d08439f-6aac-4bd2-bbba-99566b214b69	48cb9f97e2bfdf3b	2026-05-28 16:30:18.840707+00	2026-05-28 16:30:18.840707+00
\.


--
-- Data for Name: audit_log; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.audit_log (id, table_name, row_id, before_jsonb, after_jsonb, actor, reason, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: chains; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.chains (id, name, slug, logo_url, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: cities; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.cities (id, slug, name, state, country, default_timezone, currency_code, center_lat, center_lng, bbox, status, seed_config, launched_at, created_at, updated_at) FROM stdin;
6d08439f-6aac-4bd2-bbba-99566b214b69	tacoma	Tacoma	WA	US	America/Los_Angeles	USD	47.2529000	-122.4443000	\N	discovery	"{\\"radiusKm\\":7,\\"cellMeters\\":3000,\\"serviceLocalities\\":[\\"Tacoma\\",\\"Ruston\\"]}"	\N	2026-05-27 03:58:50.64784+00	2026-05-28 04:47:35.148345+00
117cbe36-eae9-45cf-b54f-df358dbb49c1	phoenix-central	Central Phoenix	AZ	US	America/Phoenix	USD	33.4484000	-112.0740000	\N	discovery	"{\\"radiusKm\\":8,\\"cellMeters\\":3000,\\"serviceLocalities\\":[\\"Phoenix\\"]}"	\N	2026-05-28 04:47:35.151133+00	2026-05-28 04:47:35.151133+00
\.


--
-- Data for Name: community_flags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.community_flags (id, target_type, target_id, flag_type, vote_value, submitter_fingerprint, submitter_ip, reason, resolved_at, resolution, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: edit_submissions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.edit_submissions (id, target_type, target_id, diff_jsonb, submitter_fingerprint, submitter_ip, submitter_email, ai_risk_score, ai_risk_level, ai_verdict, ai_classifier_reasoning, ai_evidence_jsonb, status, applied_by, decided_at, created_at, updated_at, parent_submission_id) FROM stdin;
280794ff-ff79-4ff1-a218-8dbb8e93511d	happy_hour	51c1dcd5-b8de-4f2a-bee3-4bcae7f8d0ac	{"after": {"endTime": ""}, "before": {"endTime": "00:00"}, "summary": "Edit Sun happy hour at Matador", "sourceUrl": "https://www.matadorrestaurants.com/locations/tacoma"}	4b9f5d14-4953-4dd3-973a-6d711f37bf58	::ffff:127.0.0.1	\N	85	critical	queue_admin	Clearing the endTime field effectively removes happy hour availability data. Combined with submitter's zero accuracy history and neutral trust, this appears to be data corruption or malicious removal rather than a legitimate edit.	\N	queued_admin	\N	\N	2026-05-27 19:18:15.762305+00	2026-05-27 19:18:18.68+00	\N
\.


--
-- Data for Name: happy_hour_exceptions; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.happy_hour_exceptions (id, happy_hour_id, exception_date, type, override_start_time, override_end_time, reason, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: happy_hours; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.happy_hours (id, venue_id, start_time, end_time, location_within_venue, valid_from, valid_until, notes, active, source_url, created_at, updated_at, deleted_at, days_of_week) FROM stdin;
300b2409-1a66-422b-a58b-cad8d650c436	f084ea27-3349-4f5e-89d9-76ca3e4d5664	15:00:00	18:00:00	bar	\N	\N	\N	t	https://www.wildfinamericangrill.com/tacoma/	2026-05-28 02:48:13.282363+00	2026-05-28 02:48:13.282363+00	\N	{1,2,3,4,5,6,7}
8ce56e71-73a9-4fd5-8f23-4ffd7b52ad5e	f084ea27-3349-4f5e-89d9-76ca3e4d5664	21:00:00	\N	bar	\N	\N	\N	t	https://www.wildfinamericangrill.com/tacoma/	2026-05-28 02:48:13.288085+00	2026-05-28 02:48:13.288085+00	\N	{5,6}
8f37e3a8-0e67-4835-8b4d-9969dac03f47	64d7e3c1-c875-476a-befe-731f6e3ba12f	00:00:00	\N	all	\N	\N	All night on Wednesday during Open Mic Night	t	https://www.tacomacomedyclub.com/pages/specials	2026-05-28 02:54:34.141711+00	2026-05-28 02:54:34.141711+00	\N	{3}
e636358c-bf9c-4dc5-bd1b-3138835110e5	64d7e3c1-c875-476a-befe-731f6e3ba12f	00:00:00	\N	all	\N	\N	All night on Thursday and Sunday	t	https://www-tacomacomedyclub-com.seatengine.com/pages/specials-menu	2026-05-28 02:54:34.145271+00	2026-05-28 02:54:34.145271+00	\N	{4,7}
ec6de2e4-215b-43d8-9e49-33d907194669	2e8a4ccb-03ae-4f09-80b9-11e31fe2a1e1	16:00:00	18:00:00	all	\N	\N	\N	t	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	2026-05-28 04:14:01.402027+00	2026-05-28 04:14:01.402027+00	\N	{1,2,3,4,5}
ecb8448b-561d-47ca-8c83-dbfa06c099d0	2e8a4ccb-03ae-4f09-80b9-11e31fe2a1e1	22:00:00	00:00:00	all	\N	\N	\N	t	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	2026-05-28 04:14:01.410197+00	2026-05-28 04:14:01.410197+00	\N	{1,2,3,4,5}
57ebfd13-08ea-44a4-996e-e8c2df0d4a4d	2e8a4ccb-03ae-4f09-80b9-11e31fe2a1e1	16:00:00	18:00:00	all	\N	\N	\N	t	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	2026-05-28 04:14:01.415549+00	2026-05-28 04:14:01.415549+00	\N	{6,7}
74a76af2-a984-4db8-964d-550a011c9f06	2e8a4ccb-03ae-4f09-80b9-11e31fe2a1e1	22:00:00	01:00:00	all	\N	\N	\N	t	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	2026-05-28 04:14:01.421387+00	2026-05-28 04:14:01.421387+00	\N	{6,7}
ad52adbf-e61a-4b9e-9965-2dd8a64cd36d	86ae81ad-001f-4e55-ae51-b5cf9aab7bd4	15:00:00	18:00:00	all	\N	\N	\N	t	https://dukesseafood.com/menus/happy-hour-menu/	2026-05-28 04:14:19.258972+00	2026-05-28 04:14:19.258972+00	\N	{1,2,3,4,5,6,7}
1d7741a3-d4f2-4f4c-969f-a3717ed900fc	86ae81ad-001f-4e55-ae51-b5cf9aab7bd4	21:00:00	\N	all	\N	\N	\N	t	https://dukesseafood.com/menus/happy-hour-menu/	2026-05-28 04:14:19.266172+00	2026-05-28 04:14:19.266172+00	\N	{1,2,3,4,5,6,7}
49889492-7652-46d5-b3b2-68763c1a74e3	8dfc3c14-8fe5-4ad2-84d3-c4e2d8fc5766	14:00:00	17:00:00	all	\N	\N	\N	t	https://tidestavern.com/menu/	2026-05-28 04:16:51.568225+00	2026-05-28 04:16:51.568225+00	\N	{1,2,3,4,7}
14f9e403-f461-4c1e-89e4-5a95770d1e40	136d95f4-f4fe-4c68-9756-61e95d616593	15:00:00	18:00:00	bar	\N	\N	\N	t	https://www.moctezumas.com/room/tacoma	2026-05-28 04:19:40.988851+00	2026-05-28 04:19:40.988851+00	\N	{1,2,3,4,7}
0c387fb8-bcc8-4c11-ab1e-45672a05f71b	136d95f4-f4fe-4c68-9756-61e95d616593	21:00:00	\N	bar	\N	\N	\N	t	https://www.moctezumas.com/room/tacoma	2026-05-28 04:19:40.992812+00	2026-05-28 04:19:40.992812+00	\N	{1,2,3,4,7}
5b95eda9-9bb0-41dc-8104-160b6fe9ba7c	47e57312-265e-4750-9fe4-2d4397281da2	16:00:00	18:00:00	bar	\N	\N	\N	t	https://locations.thecheesecakefactory.com/wa/tacoma-199.html?utm_source=Google&utm_medium=Maps&utm_campaign=Google+Places	2026-05-28 04:23:16.105179+00	2026-05-28 04:23:16.105179+00	\N	{1,2,3,4,5}
5eebd5ed-44b9-405c-953f-c4bab095a6db	ab76e992-6499-4593-8954-7963cc7e5d9f	16:00:00	18:00:00	all	\N	\N	\N	t	https://www.airporttavern.com/	2026-05-28 04:25:50.674902+00	2026-05-28 04:25:50.674902+00	\N	{2,3,4,5,6,7}
0aae1d5c-0965-4f4b-81fd-e4afe6488663	67e6dd9a-6128-4644-9524-74d6dc70bf90	11:00:00	14:00:00	all	\N	\N	Lunch happy hour - limited menu all-you-can-eat pricing	t	https://www.postcard.inc/places/woobling-korean-bbq-tacoma-mall-tacoma-G_msqDOHXlO	2026-05-28 04:31:16.855849+00	2026-05-28 04:31:16.855849+00	\N	{1,2,3,4,5,6,7}
ae0c73c4-92b2-4b17-9993-d71438caa956	67e6dd9a-6128-4644-9524-74d6dc70bf90	21:00:00	\N	all	\N	\N	Late-night happy hour starting at 9pm	t	https://www.tiktok.com/discover/woobling-korean-bbq-bellevue	2026-05-28 04:31:16.85845+00	2026-05-28 04:31:16.85845+00	\N	{1,2,3,4,5,6,7}
43179db7-8e90-435a-9177-e3a0a7d56474	c996fb9c-3ce1-4c70-8b49-993a9c2931e0	15:00:00	18:00:00	bar	\N	\N	Available in the Clamdigger Lounge. No substitutions during Happy Hour.	t	https://www.ivars.com/acres-menus	2026-05-28 04:38:54.906033+00	2026-05-28 04:38:54.906033+00	\N	{1,2,3,4,5,6,7}
9537b830-2a91-4adf-af42-88c1d49b0a67	ec8dd737-3038-48a6-8253-398551456eba	11:00:00	17:00:00	all	\N	\N	\N	t	https://coopersfoodanddrink.com/	2026-05-28 04:42:28.27453+00	2026-05-28 04:42:28.27453+00	\N	{1,2,3,4,5}
794876c9-922d-49ed-bf37-502133abb49a	ec8dd737-3038-48a6-8253-398551456eba	11:00:00	17:00:00	all	\N	\N	\N	t	https://coopersfoodanddrink.com/	2026-05-28 04:42:28.280363+00	2026-05-28 04:42:28.280363+00	\N	{6,7}
3f31db00-ef6f-4f23-b487-942d1d5065f7	1eb6d9f2-2cc9-4554-8c85-14262d2b6b4f	11:00:00	17:00:00	all	\N	\N	\N	t	https://www.tiktok.com/discover/mandolin-restaurant-tacoma	2026-05-28 04:48:48.765838+00	2026-05-28 04:48:48.765838+00	\N	{1,2,3,4,5,6,7}
2d44f4e3-7509-4e1e-a55c-80915f6812b0	8b7ad42b-54f1-42a4-86ea-0fa33a7e7cf5	15:00:00	18:00:00	bar	\N	\N	\N	t	https://cloverleafpizza.com/promotions/	2026-05-28 04:52:01.888989+00	2026-05-28 04:52:01.888989+00	\N	{1,2,3,4,5}
743999b1-cea3-49af-a9e6-17e293d2dc0f	f1960a89-c3dc-41f7-8793-f6af6ee2f178	15:00:00	17:00:00	all	\N	\N	Happy hour 3-5pm daily with drink and food specials	t	https://www.foodyas.com/US/Tacoma/101817201495282/Tacoma-Pie	2026-05-28 04:57:31.126405+00	2026-05-28 04:57:31.126405+00	\N	{1,2,3,4,5,6,7}
b1095783-22bd-47ee-8527-e7e2c0c799c7	eb12b6de-509d-4132-a122-663a0f3d87a0	14:30:00	18:00:00	all	\N	\N	Weekdays only. Source from 2019; current status unconfirmed on restaurant website.	t	https://viptaxi.com/arizona-happy-hour-specials/	2026-05-28 04:57:34.10775+00	2026-05-28 04:57:34.10775+00	\N	{1,2,3,4,5}
3da700a6-ff68-4353-abdd-995418618e5c	46c02e15-b0d5-404a-93b9-852c734bf4c1	15:00:00	18:00:00	all	\N	\N	Includes specials on drinks and appetizers/food items	t	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	2026-05-28 05:05:06.669871+00	2026-05-28 05:05:06.669871+00	\N	{1,2,3,4,5,6,7}
2e645268-6c5c-4f09-b73d-60dede2eb389	bc36476a-7f26-4cf2-94d3-d34f6ef2acf4	17:00:00	19:00:00	all	\N	\N	5pm-7pm Wed-Fri happy hour (also on Saturdays per ongoing promos). Not available during concerts and special events.	t	https://www.steelcreekcountry.com/	2026-05-28 05:06:20.730667+00	2026-05-28 05:06:20.730667+00	\N	{3,4,5}
e2630f01-6d8f-4b6b-a3e6-da6ed0d189f1	bc36476a-7f26-4cf2-94d3-d34f6ef2acf4	00:00:00	\N	all	\N	\N	All day Wednesday special: $1 Wings & ½ off all whiskey	t	https://www.steelcreekcountry.com/	2026-05-28 05:06:20.733253+00	2026-05-28 05:06:20.733253+00	\N	{3}
e67415ce-0955-426f-81bc-266f833d7191	bc36476a-7f26-4cf2-94d3-d34f6ef2acf4	21:00:00	23:00:00	all	\N	\N	$2 Well Drinks 9pm-11pm Thursday	t	https://www.steelcreekcountry.com/	2026-05-28 05:06:20.735415+00	2026-05-28 05:06:20.735415+00	\N	{4}
c336b0e9-cf9f-474a-beba-90defd3a4eb7	0195a6b7-2921-4fbe-89a3-9a6124675efd	14:00:00	17:00:00	all	\N	\N	Dine-in only, no takeout	t	https://www.thekoisushi.com/s/KOITHAPPYHOUR6725.pdf	2026-05-28 05:08:42.754867+00	2026-05-28 05:08:42.754867+00	\N	{1,2,3,4,5}
39bdabae-30c5-49e4-b403-4ffe33930481	21cb5a4e-084b-4f9f-aa58-0436c13283f8	14:00:00	17:00:00	bar	\N	\N	Happy hour confirmed for Monday-Friday 2pm-5pm in the bar area	t	https://www.pacificseafood.com/contact-us/retail-locations/tacoma-fish-peddler/	2026-05-28 05:10:20.830144+00	2026-05-28 05:10:20.830144+00	\N	{1,2,3,4,5}
44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	6f03ec34-412e-48c5-bf11-94661f730bc6	15:00:00	17:00:00	bar	\N	\N	Happy Hour available in Bar & Lounge Area Only. Not available during special events or holidays.	t	https://www.stanleyandseaforts.com/menus/	2026-05-28 05:12:02.2431+00	2026-05-28 05:12:02.2431+00	\N	{1,2,3,4}
ceb5db49-2ad0-48f5-804d-4fc4a7cc9661	7578a24e-e856-4423-828c-85e50e752295	16:00:00	18:00:00	all	\N	\N	\N	t	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	2026-05-28 05:14:11.620394+00	2026-05-28 05:14:11.620394+00	\N	{1,2,3,4,5,6,7}
331c35ff-70c0-45a1-8e63-57c5c11dcb4a	7578a24e-e856-4423-828c-85e50e752295	22:00:00	\N	all	\N	\N	one beverage minimum (alcohol or N/A), dine in only	t	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	2026-05-28 05:14:11.6299+00	2026-05-28 05:14:11.6299+00	\N	{1,2,3,4,5,6,7}
661c734c-6f0a-4db7-90a6-a790a74422c6	47269131-e41b-4e1f-8309-fa42377fb3ee	15:00:00	18:00:00	bar	\N	\N	21+ only	t	https://www.lobstershop.com/wp-content/uploads/Spring-Bar-HH-Menu-4-7.pdf	2026-05-28 05:23:46.35329+00	2026-05-28 05:23:46.35329+00	\N	{1,2,3,4,5}
811f9829-e8c2-4cc9-b6f5-2feeb021d3ff	ba69f35b-87d6-43ad-86b3-676405154f18	15:00:00	17:00:00	all	\N	\N	\N	t	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	2026-05-28 05:24:25.438188+00	2026-05-28 05:24:25.438188+00	\N	{1,2,3,4,5}
79bc4f2b-5dd3-4bd5-a0d5-90c404a8c38d	ba69f35b-87d6-43ad-86b3-676405154f18	14:00:00	17:00:00	all	\N	\N	\N	t	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	2026-05-28 05:24:25.44539+00	2026-05-28 05:24:25.44539+00	\N	{6,7}
2f84a5d1-35f4-468d-9f7f-35ac0ea8e15d	edd135a1-86db-4245-ac88-9a462399e420	14:00:00	17:00:00	bar	\N	\N	\N	t	https://www.cactusrestaurants.com/menus/happy-hour	2026-05-28 05:25:34.297701+00	2026-05-28 05:25:34.297701+00	\N	{1,2,3,4,5}
11ea0146-a82c-403c-93a8-0dd941118e76	c2f25fe4-8378-42d0-b404-312d71156b57	15:00:00	18:00:00	all	\N	\N	\N	t	https://www.kentstation.com/promotions/ramrestaurantandbrewery	2026-05-28 05:35:08.869928+00	2026-05-28 05:35:08.869928+00	\N	{1,2,3,4,5}
d2102c18-b0fb-4612-8d46-ccf5acbbb573	c2f25fe4-8378-42d0-b404-312d71156b57	00:00:00	\N	all	\N	\N	All day happy hour, served open to close. Dine-in only.	t	https://www.kentstation.com/promotions/ramrestaurantandbrewery	2026-05-28 05:35:08.876565+00	2026-05-28 05:35:08.876565+00	\N	{2}
c0eccd9f-dc10-4703-b598-7d869286c221	c2f25fe4-8378-42d0-b404-312d71156b57	21:00:00	\N	all	\N	\N	\N	t	https://www.kentstation.com/promotions/ramrestaurantandbrewery	2026-05-28 05:35:08.882935+00	2026-05-28 05:35:08.882935+00	\N	{6,7}
3264861f-05d3-4985-adc8-5c6f8066ec8d	2ed6e99b-59dd-47a7-8513-42e238c95e57	14:00:00	18:00:00	all	\N	\N	\N	t	https://eatwoven.com/	2026-05-28 05:36:06.858976+00	2026-05-28 05:36:06.858976+00	\N	{1,2,3,4,5}
137920fb-ae06-473b-8b59-d9186c60280c	206b4cb8-9441-4ad1-95af-59d1bd3a043a	16:00:00	18:00:00	all	\N	\N	\N	t	https://www.visitpiercecounty.com/listing/katie-downs-waterfront-tavern-+-eatery/60/	2026-05-28 05:38:52.504763+00	2026-05-28 05:38:52.504763+00	\N	{1,2,3,4,5}
2705b7a8-b307-4406-b49d-1017a7201e67	206b4cb8-9441-4ad1-95af-59d1bd3a043a	21:00:00	\N	all	\N	\N	\N	t	https://www.visitpiercecounty.com/listing/katie-downs-waterfront-tavern-+-eatery/60/	2026-05-28 05:38:52.506598+00	2026-05-28 05:38:52.506598+00	\N	{1,2,7}
7a54a0c4-b935-4f2e-b292-026d27e8583c	7c9c5219-668d-4842-b458-92ed04599bd8	08:00:00	11:00:00	all	\N	\N	\N	t	https://img1.wsimg.com/blobby/go/a3685e18-30e3-44f2-aa9e-95ffd15c58f4/EB%20for%20Website.pdf	2026-05-28 05:41:04.591666+00	2026-05-28 05:41:04.591666+00	\N	{1,2,3,4,5}
a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	14cba4a7-3820-4823-8f52-97208ce749ed	15:00:00	18:00:00	bar	\N	\N	\N	t	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	2026-05-28 05:42:52.89848+00	2026-05-28 05:42:52.89848+00	\N	{1,2,3,4,5,6,7}
2d54e31d-2115-4d03-803e-ea31d304c01b	342962f3-148e-4a1b-95c6-19e04f062cc4	11:00:00	19:00:00	all	\N	\N	\N	t	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	2026-05-28 05:45:18.981316+00	2026-05-28 05:45:18.981316+00	\N	{1}
67248c9c-fd08-4292-a89c-688bdfad5a0e	342962f3-148e-4a1b-95c6-19e04f062cc4	11:00:00	19:00:00	all	\N	\N	\N	t	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	2026-05-28 05:45:18.983798+00	2026-05-28 05:45:18.983798+00	\N	{2}
19d08220-a38b-4203-9e0f-a730757a3763	342962f3-148e-4a1b-95c6-19e04f062cc4	11:00:00	19:00:00	all	\N	\N	\N	t	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	2026-05-28 05:45:18.986681+00	2026-05-28 05:45:18.986681+00	\N	{3}
e3c0107c-272c-49ce-83b0-7641d6a42498	342962f3-148e-4a1b-95c6-19e04f062cc4	11:00:00	19:00:00	all	\N	\N	\N	t	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	2026-05-28 05:45:18.990107+00	2026-05-28 05:45:18.990107+00	\N	{4}
79aaed20-154d-45b4-a0a2-0d42fbf937e7	342962f3-148e-4a1b-95c6-19e04f062cc4	18:00:00	23:00:00	all	\N	\N	\N	t	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	2026-05-28 05:45:18.993206+00	2026-05-28 05:45:18.993206+00	\N	{5,6,7}
c7667137-5082-4945-8140-cb618b22c549	a011b25c-cf48-4f38-9a99-1c3ebe21b351	14:00:00	17:00:00	all	\N	\N	\N	t	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	2026-05-28 05:48:39.555009+00	2026-05-28 05:48:39.555009+00	\N	{1,2,3,4,5}
c583dea3-f027-44e9-8390-9b6cef143c11	a011b25c-cf48-4f38-9a99-1c3ebe21b351	14:00:00	17:00:00	all	\N	\N	\N	t	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	2026-05-28 05:48:39.56959+00	2026-05-28 05:48:39.56959+00	\N	{1}
dedfdc26-599e-460f-9383-4c13bf04045b	a011b25c-cf48-4f38-9a99-1c3ebe21b351	14:00:00	17:00:00	all	\N	\N	\N	t	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	2026-05-28 05:48:39.571029+00	2026-05-28 05:48:39.571029+00	\N	{2}
304d234c-c8c2-4aa6-b16f-57f94738d434	a011b25c-cf48-4f38-9a99-1c3ebe21b351	14:00:00	17:00:00	all	\N	\N	\N	t	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	2026-05-28 05:48:39.573128+00	2026-05-28 05:48:39.573128+00	\N	{3}
92c6b444-a6a1-48f4-a69e-0298115e6e38	a011b25c-cf48-4f38-9a99-1c3ebe21b351	21:00:00	\N	all	\N	\N	\N	t	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	2026-05-28 05:48:39.574542+00	2026-05-28 05:48:39.574542+00	\N	{1,2,3,4}
925e6c8f-62fa-4ba2-8e72-e11347c711f6	7835dabe-de73-428b-98a7-bdab39639b8d	15:00:00	18:00:00	bar	\N	\N	Martini Lounge only. No menu modifications or substitutions. Not available for takeout.	t	https://img1.wsimg.com/blobby/go/3a0c4d5c-8832-4f1b-b7b6-84e0203c0e9b/Cliff%20House%20Happy%20Hour%20January%202026-0f3b16d.pdf	2026-05-28 05:52:54.351542+00	2026-05-28 05:52:54.351542+00	\N	{1,2,3,4,5,6,7}
4eca0ce1-daa9-4d5a-b360-36dea25ca386	a26ed922-1345-47f3-9ceb-2b2cf9cb0b94	15:00:00	18:00:00	all	\N	\N	\N	t	https://www.facebook.com/boranroyalthaicuisine/posts/happy-hour-at-point-ruston-3-6-pm-everyday-/660036596539849/	2026-05-28 05:54:50.115119+00	2026-05-28 05:54:50.115119+00	\N	{1,2,3,4,5,6,7}
d1c28b9d-fed2-4117-90a4-f74fc8ab9bf5	36fccf79-e2a8-4d10-bba9-853a6fb993c5	14:00:00	22:00:00	all	\N	\N	\N	t	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	2026-05-28 05:56:41.128051+00	2026-05-28 05:56:41.128051+00	\N	{1}
50959e25-9c01-4ee9-a7ff-69b44a727f5a	36fccf79-e2a8-4d10-bba9-853a6fb993c5	14:00:00	23:00:00	all	\N	\N	\N	t	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	2026-05-28 05:56:41.135729+00	2026-05-28 05:56:41.135729+00	\N	{2}
9b4b9a43-83ff-4d05-89a7-4fbb47a6f6ca	36fccf79-e2a8-4d10-bba9-853a6fb993c5	14:00:00	23:00:00	all	\N	\N	\N	t	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	2026-05-28 05:56:41.143523+00	2026-05-28 05:56:41.143523+00	\N	{3}
a286fdd8-a9aa-462f-8106-585d054c56fd	36fccf79-e2a8-4d10-bba9-853a6fb993c5	14:00:00	23:00:00	all	\N	\N	\N	t	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	2026-05-28 05:56:41.150362+00	2026-05-28 05:56:41.150362+00	\N	{4,5}
c637f35a-6b93-4ac5-b430-320743447805	36fccf79-e2a8-4d10-bba9-853a6fb993c5	12:00:00	23:00:00	all	\N	\N	\N	t	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	2026-05-28 05:56:41.156521+00	2026-05-28 05:56:41.156521+00	\N	{6}
8d86a994-369a-4b64-9f4e-1cca6e2365d2	36fccf79-e2a8-4d10-bba9-853a6fb993c5	12:00:00	22:00:00	all	\N	\N	\N	t	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	2026-05-28 05:56:41.162226+00	2026-05-28 05:56:41.162226+00	\N	{7}
fe295bd0-0438-4cdd-b11d-56f0722e68f3	32cced2d-aa82-4c84-810f-79defafcab80	16:00:00	17:30:00	all	\N	\N	\N	t	https://cheerhop.com/tacoma/wooden-city-tacoma	2026-05-28 16:25:14.499412+00	2026-05-28 16:25:14.499412+00	\N	{1,2,3,4,7}
734f8734-deeb-4eea-a3a0-9d0aba18bb08	32cced2d-aa82-4c84-810f-79defafcab80	20:30:00	\N	bar	\N	\N	Late night menu at the bar	t	https://cheerhop.com/tacoma/wooden-city-tacoma	2026-05-28 16:25:14.503862+00	2026-05-28 16:25:14.503862+00	\N	{1,2,3,4,7}
a32598a8-41b1-4a2b-a5cc-4f197376391f	45482768-dcac-40a6-a125-ae5260737790	15:00:00	17:00:00	all	\N	\N	\N	t	https://laperladelmarvip.com/happy-hour/	2026-05-28 16:25:57.763883+00	2026-05-28 16:25:57.763883+00	\N	{1,2,3,4}
8de11ac1-3449-46b9-93b3-790fe0dc2f3e	45482768-dcac-40a6-a125-ae5260737790	20:00:00	\N	all	\N	\N	\N	t	https://laperladelmarvip.com/happy-hour/	2026-05-28 16:25:57.77069+00	2026-05-28 16:25:57.77069+00	\N	{1,2,3,4}
\.


--
-- Data for Name: neighborhoods; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.neighborhoods (id, city_id, name, slug, polygon, source, source_url, parent_id, created_at, updated_at) FROM stdin;
68ca57a8-7330-4be6-86e0-59d4ce8e5189	6d08439f-6aac-4bd2-bbba-99566b214b69	West End	west-end	0106000020E6100000010000000103000000010000000B0100005557A3E351A05EC0EFA7D4E9179F4740CD69908D54A05EC05D5354D8179F47403E7A70A002A15EC07FFF805C139F474070B3EE0FABA15EC0C0C12936119F47409AEEA26BABA15EC0E96EDDCA0D9F47406AAEA8F7B1A15EC0B84590340C9F4740BC80B61CB3A15EC01270A5E50D9F474022DC5440E8A15EC0CAF5169F0D9F47400CF0ECD8EEA15EC0B2F442960D9F474001EBC99105A25EC00995C1770D9F4740B2E95D8C07A25EC0CD8017750D9F47409F33A78908A25EC00F63C2730D9F47409C3178CB11A25EC04F2D4A670D9F4740C529A0C015A25EC00C68F2610D9F47405766CABE1EA25EC0B7AC81560D9F4740472349BF1EA25EC0824A7FE00D9F4740714200592FA25EC043864CC90D9F47400E43945331A25EC03ABC9CC60D9F47408809D90133A25EC087DE2DC50D9F4740137808FE32A25EC01173AEBA039F4740A0086D1C49A25EC0640AFB9F039F47407ADEB32E49A25EC07B602F1D0D9F4740929743685BA25EC0D937A2040D9F4740B21E77E65BA25EC0DAA29EB70C9F474065B6D6255CA25EC07AEF345F0C9F4740D80FC0255CA25EC00D9AD1E60B9F4740EB462F245CA25EC0CD35EE88039F47402E290D165DA25EC0020BC487039F47403A7173165DA25EC0DCBF91D3FD9E47407980B7115FA25EC02234C3D3FD9E47403271C7758DA25EC039BE7BEDFD9E474008BFF49F8DA25EC0938FCB35E29E47400C4D67A1ADA25EC04909EC30E29E4740F0AF88B5ADA25EC0C70DBE95F29E4740A702BBABA8A25EC0281A9393F29E4740390DC4ECA8A25EC09A903A7D0D9F47400921A2A2DFA25EC0C5AF20740D9F47401D03CB97E3A25EC0BFE070730D9F47409FCF9CE800A35EC057C9346E0D9F474093313B0B01A35EC078B72274D09E4740F4087376F8A25EC0E0EFCEA8D09E4740A33E567DF8A25EC0BC6341D5C19E474059BB95470DA35EC0DEBB9A55C19E47407A23A94E0DA35EC07DEF74E2BD9E474083C367FD10A35EC0827E0E0CBE9E4740505FD7EF22A35EC04B3EB8D6BE9E474013197AC322A35EC09C88F9AA0D9F4740C9B9426336A35EC0F16EFCE30D9F474010A1E8F33EA35EC072975DF90D9F474074D287DB4CA35EC0C672541A0E9F4740E52B3F164DA35EC000B2A7F8EB9E4740FEB998EE42A35EC085FC95E0EB9E4740F65C5E0343A35EC0830BB83BCC9E474052FF3B0B43A35EC0A3B01041C09E47402D30B15464A35EC0B7A570B8C19E4740122A9FA064A35EC08D33E228309E474028FCF3BE59A35EC0FA699CD32F9E47405BD915C759A35EC047310F48209E47401DBBBAA864A35EC0BDF5549D209E47407C9CD1A864A35EC0322E456F209E474086439C6F83A35EC092156833219E47407988E76289A35EC0CE0F4C59219E4740DF636B7AAEA35EC01E7A5C45229E4740457C36B4ADA35EC0E65E5C931F9E47402E53E278BCA35EC0F194EEEE1F9E4740D5C7F96EBCA35EC09D2BF99D229E474022CCF9F4BBA35EC0B186BC69439E4740057A6DC0DFA35EC062A5BD31449E4740B86520CFDFA35EC006AED73C409E47401CAF7D57F1A35EC0E7E9BF8D409E474008263D58E4A35EC0D9B89201619E4740FA9CCDF7D7A35EC07413C2056F9E4740C444E0DBD7A35EC065C7ABB6719E47406E6EA93CD4A35EC0C80F059D759E4740CAAEFA42D5A35EC0F0848117859E4740D64BEA6AD1A35EC07F45B4F88E9E47400A068349BAA35EC047B20050B69E474086BC0691B1A35EC04E3DEA24C59E4740703388C49EA35EC068FDB44AC49E47409CB92EEC75A35EC0390CB47EC29E4740AEB687D275A35EC0BE258F58EC9E47408A854D996BA35EC0BEA17040EC9E4740F952579C6BA35EC07C14844FE79E4740E9A985A468A35EC00A048348E79E47408BC7E7A568A35EC07F808809E59E4740ED2F8D6461A35EC0D55E65F8E49E474093DC976061A35EC03AF56264EB9E4740C4FDED2159A35EC08147E650EB9E4740701DB61F59A35EC04248CBE8EE9E47405B60640C59A35EC0055A2F370E9F4740C8D0C3436FA35EC04F59AA6B0E9F474073DE710DB7A35EC00ABD50170F9F47401B9550B1B9A35EC06A7B9A1D0F9F474037C5AC56B9A35EC0C98BBF67109F4740143F21F5B8A35EC0147FC6CA119F4740A31DD1EAD1A35EC0A426248A129F47402EFA4A19DAA35EC0B699CBC8129F4740076A3908DDA35EC0E1F241DF129F47402A98F2A9DAA35EC0411151D05D9F47400EAFBDD3B8A35EC0AD391A0A5C9F47400627640DA9A35EC0ECA462835B9F474097CF52C298A35EC03B33CF886A9F4740003949FE90A35EC0F56E96B1719F47400F65C6198CA35EC086B84234769F474032AF05498BA35EC0D7BED89E7B9F4740C08D6AF589A35EC0E3A4906E849F4740AD3B63A488A35EC09D3D182D8D9F47401BB0918F87A35EC070BCBD5B949F4740C15D103987A35EC0CC24529A969F4740B9918DE286A35EC0F196E6D8989F47405B51AE7A85A35EC001E2232FA29F47406BE7286E82A35EC0AFA0336FB69F47408C9228947DA35EC07E830FA8D69F4740A2A4236F7AA35EC062587C8AEB9F4740C3F2EE8F75A35EC0020263E50BA04740EF0D1B9964A35EC05F66668C7CA04740C56977B263A35EC00B6CE08782A04740D9D6E12D2BA35EC09BF113B010A147404A2A495D17A35EC0209F588542A14740425EF309FEA25EC0D089523582A14740B7A669E2EBA25EC0AB4BE4DBAFA147407BEBEA3AE9A25EC0521E7988B6A14740EC264283E5A25EC06B897E52BFA147403FAE8DE5E0A25EC084AB653CCAA14740B2B46444E0A25EC0AF076DB9CBA1474014F85391DFA25EC06221C860CDA14740F556FAEADAA25EC046F2125FD8A147402FAF3722CDA25EC0F5CFB0F5F8A14740F6AA1460CCA25EC09E4DA6C0FAA14740A0BE7C9BCBA25EC05F8A6C91FCA147408A82216ECBA25EC07296A6FCFCA147404CA9F64FC8A25EC01B63995B04A247409FF087B28CA25EC03DD7602678A2474053ED97B361A25EC0C14276A6CBA24740FA82A0C952A25EC0517D34B9E8A2474069E694204AA25EC0EB0F1C4000A34740EA501E1C47A25EC0D6E9927208A347407A69D45445A25EC066CAD4DA0DA34740576A41613CA25EC00D20011229A34740764D9C6D33A25EC09649294944A347407EFB61A82EA25EC09EE1E7C952A3474094D6EB792AA25EC01BA63B805FA34740A37C06F226A25EC048331F3C6AA347409030320C1DA25EC044FBF05288A347402A804D1814A25EC0A9D8018AA3A34740BA2F55AA06A25EC0EC90925CCCA34740BB82002B02A25EC005B73308DAA34740E69D8686F3A15EC0F5BBCF8906A447404DC5B193ECA15EC0565DA89E4FA447403F76BE6FE1A15EC00F27BCC6C4A4474011F9805ADEA15EC0F1D1F031E5A44740D7FC1E29DBA15EC08F289E633BA54740F7D97124DBA15EC0642C46CA3BA547401E25D2DDD9A15EC0BA54E9C657A5474084DD45F5D8A15EC0C997D9B36BA547409E2A1350DEA15EC06FAA3D897BA547406B2D3DC2EFA15EC026BEDA1EAFA5474001650413F1A15EC0DE119F02B3A54740C15CE01A05A25EC05F1B5B3BEEA54740605B5E5F15A25EC02F0FE7C226A647403CC243AE38A25EC0D9AF8471A1A6474060C866DF34A25EC0981CFD8AA1A64740CFE689B930A25EC0F54F009DA0A64740E1D7A24440A25EC058BBDA3DC0A64740392827C25BA25EC02CAFB5ED12A74740F32303ED5CA25EC08A94C3B315A74740C1589C7F5DA25EC09AC41D1017A747404294710F9AA25EC07BDB63F4A6A74740CA4F80E6D5A25EC06953541008A8474065274082E7A25EC0D919A79227A847409C3073C8F9A25EC0E7D8077A50A84740CFE6774B06A35EC0DF83BD3F64A847404F79B8EE0AA35EC0A722BFDB72A84740A8C23CF00AA35EC0720CB6107BA847405720F8110EA35EC0B6091DF886A8474050557D040CA35EC036B9C6F7A2A847402B40C49C00A35EC0DCCDC850B1A84740D4041710F3A25EC0CE3553F2B7A84740CDF2961AD9A25EC05270C185CAA847409259E4D5C1A25EC0C6963A7BCFA8474089E83D21B9A25EC0FF00DE42CFA84740F8E295F099A25EC0DBC28484CEA84740949470607FA25EC0B8F5F064BFA84740D3B2602F61A25EC082E1B7E7B4A847402CB71ADA44A25EC0D1D4AE0EABA84740D335BEA33AA25EC0C0632561A4A847403C2688BE24A25EC050D1C00F96A84740BCB4896C13A25EC0989AE08E7AA84740B60B43A80EA25EC04CDA1CFD72A847401F3E00D7FAA15EC0E6CD439F5DA84740724244AFF0A15EC06659CA814AA8474073D80C0FBCA15EC0E9F099AB04A84740240C61BBADA15EC0211A12A8F1A74740F0306A98ABA15EC06B452AD2EEA74740255774F4A9A15EC056767B49E3A74740489080C894A15EC0D41FFE4BC5A747404E99D40564A15EC02B39D4468EA74740D1DFE42F58A15EC0B6589EEA80A747407CAA12F33DA15EC050FF0E9660A74740CAEE678F2DA15EC000CCF3D954A74740712D7FA423A15EC004EB133A6EA747405A058640F1A05EC053A6803647A747406CD56083CFA05EC0FA7B155658A74740D9B36ABECAA05EC0C9B3B9C15AA747405E965A22A9A05EC0798C10D06BA7474074CE855C5FA05EC01DF11C2DF3A64740F1B4E6E151A05EC039D0DF21DDA6474010F0804761A05EC0414CBEC2CFA64740EA0FD14B61A05EC0CC5800BFCFA64740217B174198A05EC06D35870FA0A6474039F7A8D9FFA05EC006B5123AA1A6474037C5AED9FFA05EC0F7148E36A1A64740AB64607C00A15EC02D426A0939A6474058A5D25201A15EC0330D5DB4AFA547403E26B04A01A15EC0284639B4AFA547405CE3B04A01A15EC015D27DB3AFA5474067085968F6A05EC0F4992D83AFA54740EC59310754A05EC099D0AEA3ACA5474057471FF353A05EC0652631479CA64740198DAA7351A05EC0C5A07CA698A64740903800A425A05EC010722E1A5BA647407DF1CFAA25A05EC055631F0F5BA647401BFC57D12FA05EC0E699087D4FA64740025D1201ED9F5EC022105F7CF1A547400219F9F9BA9F5EC09D351117ABA547407D0FF18AB89F5EC0D9DD51AAA7A54740A0B333DBAD9F5EC0BB0573A098A5474081F789F2B19F5EC07F6B477491A54740307FA41BAF9F5EC09D31AB4A8EA5474066976960AF9F5EC0B0F0D2D38DA54740937DE879AD9F5EC074B97D248BA54740A6281365AA9F5EC059C302CA86A5474041C08891A79F5EC09763C9CB82A54740EFEBDA34A59F5EC071F979757FA54740AF27F6FAA29F5EC0E2BD4F507CA547406EB0ADAFA09F5EC06C5C921279A5474037D7FB899F9F5EC09CA6A17377A5474016D065649E9F5EC0408AD6D475A547403B741E199C9F5EC0A16A189772A547407DA6D7CD999F5EC0F5EB59596FA5474095669182979F5EC03B0E9B1B6CA5474084B44B37959F5EC065D1DBDD68A54740A19906EC929F5EC0D9231EA065A547403C03C2A0909F5EC0DB285E6262A54740F3FA7D558E9F5EC0DDCE9D245FA5474081803A0A8C9F5EC0B515DDE65BA54740F89CF7BE899F5EC0E5EB1DA958A54740323EB573879F5EC0B0745C6B55A54740FC4A2731859F5EC04C6084F450A54740CBD22EB8839F5EC01366BEC14CA547402F3C383F829F5EC08A35F88E48A54740A73B3FC6809F5EC0C805305C44A54740F699494D7F9F5EC0EA6F6B2940A547409F8E51D47D9F5EC0E2DAA4F63BA5474079C3EA7D7C9F5EC03FC0622638A547408BCC8D7D7C9F5EC0B25D592538A547404DB309CBC99F5EC081EF72DE33A54740455772DAD29F5EC0BE7F968B34A54740E02562243FA05EC094E5031937A5474080AF16223FA05EC0051A865335A547408CD513B453A05EC02AE1176035A54740E5090F3B54A05EC044BA5C0FB0A047403CA5FC3A54A05EC0D8C40CD9AFA047407570423A54A05EC06307FCD8AFA0474094FE2E9B51A05EC041472D8A479F47402F132F6C4AA05EC021305C68189F47405557A3E351A05EC0EFA7D4E9179F4740	City of Tacoma Open Data — Neighborhood Council Districts	https://hub.arcgis.com/datasets/tacoma::neighborhood-council-districts-tacoma-1/about	\N	2026-05-27 04:27:10.419367+00	2026-05-27 04:27:10.419367+00
4c233d94-3543-4d4f-8a50-30ae8c2f1030	6d08439f-6aac-4bd2-bbba-99566b214b69	New Tacoma	new-tacoma	0106000020E6100000010000000103000000010000006B000000B99EE9C6DB975EC0DA9B1207679F47406126E00B2B985EC05ED506EB679F474025D861F52A985EC0955164E6779F4740FAD7A52D34985EC0FE3DF6FA779F47407791CEE834985EC0DE5570FC779F4740C3DE437B5F985EC0FF28C143789F4740B4DD28435F985EC014FDA59F889F474012505C205E985EC0103BB59C889F4740741E5A0F5E985EC07A255F10979F4740285473ED5E985EC080A67B11979F47409BFB4AE15E985EC056FA621C999F4740A0ACA2DD5F985EC0ED5A241F999F4740A78A0B6CAA985EC07F09BBC5999F4740FF877B9FAA985EC0415AE4518C9F47405A8B72AEAA985EC031A304D67A9F474019876CADAA985EC09B2C7C794D9F4740113AFE79AB985EC009B6A47C4D9F47404DE8674EB2985EC06C3387894D9F47400F5AB3E2E3985EC044821F904E9F4740FD9E05033D995EC0BE7059F74E9F4740BE10CBD23C995EC0E78089705C9F4740774194D55F995EC0503264BA5C9F47400297A2CF66995EC023A4ACD35C9F4740989127ED66995EC0F212C24F4F9F474005524ED07C995EC0E3F7DC794F9F47403BAB44B97C995EC0CB7F9C1C579F47405679219792995EC0746D9C46579F47409FA52C3393995EC00B515F8C219F474063FE5D5693995EC03BA6448C159F4740AFFD327B93995EC053CE9FF4DC9E47404230FA30A0995EC0B9B130FFD29E4740D6D656C0BE995EC038C68582BA9E47401216065CCA995EC035386DD9B29E4740168CF4B3D0995EC0C5B2DDACAF9E4740FA0B115BDD995EC027CF1B20AB9E4740356D895FEA995EC0833D598AA89E4740BFF7C90B469A5EC02876DFEC9B9E4740ED392230AA9A5EC0B4752E4C879E47409C405C98C19A5EC0B42E3FF87F9E4740AF9D4C89CE9A5EC0B07CCA74799E4740EC420426DD9A5EC0461E1850709E47401C9A6424F19A5EC094CC0BAC609E4740EC4011635C9B5EC09F9CEA01039E47408094A018699B5EC0FB3E2439F99D4740964D7219729B5EC0F04B698AF39D4740E88240A97D9B5EC061872FD6EC9D4740CE3CA441899B5EC0F819EC00E89D4740434DCB97909B5EC0B333452FE59D4740CC2FB73A969B5EC06EB4C55BE39D4740A14B60B6A29B5EC062C13922E09D474071948D8BC89B5EC0D55C3355D89D474080A093E9D79B5EC0CC378CE3D49D47400CCFD137EA9B5EC04D40343CCF9D47403EFBB1A3FE9B5EC02BC11E7DC49D4740917B30A1379C5EC0338B90C7A29D47400DDA621E2F9C5EC063089ECDE09D474012DB56BB2C9C5EC04DD58671E79D47404D8D42642B9C5EC070D76A99ED9D4740663CF932309C5EC0B6D2379E1C9E47405AE89838459C5EC002F4BC7CD59E47407875EAEC529C5EC03375BAD14C9F47409328FD6FB29C5EC052CF1DE5389F4740CE8A68A1E19C5EC0A732BADB2E9F4740FE35172BED9C5EC00CB6BA04949F474048D387B5F89C5EC0AD28A844F99F4740BAD9FF8DFC9C5EC0DDB99FED1AA047403F784F40049D5EC0D4A584845EA04740C74959F20B9D5EC038496204A2A04740530403CB0F9D5EC0C16250ADC3A0474037485BAD139D5EC0F6067B4FE5A047405B225E0C1F9D5EC0A89BAB794AA147407311F6FF1E9D5EC0129671784AA14740F7576822FB9C5EC0A838B1A3B0A14740AF450DF4289D5EC033E2F257CDA14740D3140643DA9C5EC012B3F19BA9A24740B43C0D2FC39C5EC02905BD8390A24740D72336F9C09C5EC043AC6F1C8EA247406D98B464BE9C5EC0996A304E8BA24740523629A0BA9C5EC0C807523587A24740D3924C11B29C5EC018CDE3E67DA247409A87E678849C5EC0F0D5387843A247407244BF1B7B9C5EC00D63F87737A247403C234B6D669C5EC0B33DC12218A24740D40E077F559C5EC0D9C50019EFA14740747DFB574D9C5EC0E11D0B56DBA14740D7FB70AD469C5EC0464C17D5CFA14740871FF9A1239C5EC03714585A93A147404BCC7F2A1A9C5EC0476D6B78A1A14740F4BDEEFC099C5EC0287E6098B9A14740D3CEDB38DE9B5EC049CAD7DAFAA147408673CC3BD39B5EC005E8213D0BA24740CB8E3F94C69B5EC0723E301B1EA247408F723D1A969B5EC0DD40B36066A247409A415561939B5EC035E29F6F6AA2474034DD074C889B5EC06B5DD8E07FA24740C2B705805B9B5EC06223B83D98A24740E233E544F89A5EC0AC04A632CEA24740F2960833F39A5EC059F10E10DCA2474027957921E59A5EC0BBD0508902A347403B78CBF8A29A5EC03FC2E26FB7A34740601F1FFBA29A5EC0CBB65A55B7A34740DB99BE8E7F9A5EC09C054D4C9FA34740E3FDE291DE975EC0BE17F1227CA047408D745405E0975EC02E38942C889F4740F836A1C2DB975EC02A5F8F23889F4740D29F08C7DB975EC089C38311679F4740B99EE9C6DB975EC0DA9B1207679F4740	City of Tacoma Open Data — Neighborhood Council Districts	https://hub.arcgis.com/datasets/tacoma::neighborhood-council-districts-tacoma-1/about	\N	2026-05-27 04:27:10.455749+00	2026-05-27 04:27:10.455749+00
ac564746-6f07-46a4-a661-3ef8b593e238	6d08439f-6aac-4bd2-bbba-99566b214b69	North East	north-east	0106000020E610000001000000010300000001000000F30000009A1F443701975EC0F38D52E4869F47408D745405E0975EC02E38942C889F4740E3FDE291DE975EC0BE17F1227CA04740CD2049E229985EC0931A2E14D6A04740B279D504ED985EC0FADA400BBFA14740DB99BE8E7F9A5EC09C054D4C9FA34740601F1FFBA29A5EC0CBB65A55B7A347403B78CBF8A29A5EC03FC2E26FB7A34740D230F1B3949A5EC0BAD69772DEA34740633AB0C8949A5EC0F8964D0FA5A4474063A6BBE5739A5EC00DB39296D5A44740D07F15786B9A5EC0664A2F06E2A44740E117478E889A5EC004F8CF0E6DA54740886D306CAE9A5EC034B6FAA59BA547408DF18DFDDD9A5EC006FC492BD6A547401B87C103DE9A5EC0871F100AE3A54740E32E6204DE9A5EC0E4D60B5CE4A547401333850ADE9A5EC0E986067CF1A5474094DDF50BDE9A5EC009B50590F4A547403C5AC50FDE9A5EC012251CD7FCA54740853030D7DE9A5EC0CA42332AFDA547403AB7CCF8FC9A5EC0BED2608D02A64740912CB3440F9B5EC0561936770AA6474007A785E3109B5EC0CB69C4D00DA64740F8D53FFD139B5EC0B4506A390CA647400946A711229B5EC046D8CDB214A64740D451119F239B5EC0CE4A10CB13A64740F522E2D6289B5EC00DF7790717A647402E46602F2A9B5EC0C3F804171CA647408FAE2CE72C9B5EC0FD17AB681FA64740A140A63A379B5EC084222E8624A64740580AD63A379B5EC07B7036D123A64740BA1534E9399B5EC0B2C8D5F124A64740B0CEE865579B5EC0029C232627A64740A9D3C806649B5EC0A3C0A31C20A64740AD45C30B819B5EC09F6E7AE30FA6474051D3103D8F9B5EC0322F9CD609A647404DA6E1B09E9B5EC0191D581504A647408A90C1C6A99B5EC0328D44B106A64740D847E06DA99B5EC0DE83DFF218A64740B609CB48AA9B5EC02FFF96A219A64740EBA2FF7FAA9B5EC04809CDE512A64740BDEBE5ABAA9B5EC07CC633E706A647400E3240EAAF9B5EC091D5272308A6474076F53ADEAF9B5EC0094ED6310AA647408863A168AF9B5EC00BDC54521EA6474065D63F58AF9B5EC071DDC45720A64740B4878145AF9B5EC04F6E7E3720A647405EF89C44AF9B5EC0D81FAD9220A64740D50F0371B09B5EC0E4A0933B22A64740E82C4CA9B19B5EC087B5B55524A64740CCD3E901B39B5EC0C6928BA726A6474067175819B49B5EC06A750E8928A64740D929E24AB49B5EC08DC66BDE28A6474091049AA7B49B5EC0390F317E29A6474082147AE4B49B5EC060A518E729A6474038739361B19B5EC0B24D8F982CA647405686DE4BB19B5EC0334EE4A42CA6474000610A41B19B5EC02DBB0AAB2CA6474084419F21B19B5EC0A31B54C12CA647404C569503B19B5EC006E338DB2CA647409ABB37E7B09B5EC00C8C61F82CA647400ACDC0CCB09B5EC08A9586182DA64740EF614FB4B09B5EC03CB7913B2DA647401BEB0D9EB09B5EC046CC79612DA64740BE94228AB09B5EC0079CE6892DA64740ACA6AB78B09B5EC090C053B42DA64740CA1FC569B09B5EC097D15BE02DA64740612ED15DB09B5EC0001DCE0C2EA6474093AE8354B09B5EC05FAA663A2EA64740406AE54DB09B5EC0A56BE5682EA64740528A064AB09B5EC09E8819982EA6474007F1ED48B09B5EC0ACF6A7C72EA647405AEF964AB09B5EC0AE752AF72EA6474066B8F84EB09B5EC06EA342262FA64740534A1256B09B5EC0E37FB8542FA64740E2F3D25FB09B5EC0A6B350822FA64740E32C2F6CB09B5EC0B8BFB2AE2FA647400318177BB09B5EC0B36C82D92FA64740797B758CB09B5EC0A514750230A6474097214A25B69B5EC08B3E9F763DA6474091AEE6A1B69B5EC09B7C84D23EA6474028024B09B79B5EC0FF6E4D3B40A64740A862C45AB79B5EC046F48FAE41A647409072B081B79B5EC02531A5A842A647400951CA95B79B5EC0C52FCD2943A647409473FAB9B79B5EC074557BAA44A64740814E17C7B79B5EC0906F0D2E46A64740C9DB0ABDB79B5EC0DEC1E5B147A64740A1C4E99BB79B5EC043EF6A3349A647409B81F063B79B5EC0952306B04AA64740D8853836B79B5EC03347DC964BA64740E9B31800B79B5EC0DAAC3F7A4CA64740E43A6095B69B5EC01E2FF2E24DA64740D965BC89B69B5EC0F197490A4EA64740D1E2E271B69B5EC0FCEDAA494EA6474089389044B69B5EC046D4DACC4EA64740C3613E11B69B5EC02675814A4FA6474035764CF9B59B5EC0CD5D238A4FA647400B845AE8B59B5EC058649DAE4FA64740A9241DD1B59B5EC0B68F83E74FA6474062BDF54FB59B5EC0E5AEACF650A6474037D42DBDB49B5EC091FCC60052A647408F10411DB49B5EC0BF0E01FC52A647403B230271B39B5EC030B23BE753A647404E4883E6B29B5EC06627708954A6474018B910F3AB9B5EC084E079AD5CA647402883F9D1AA9B5EC013331CFD5DA647401BC5FF87AA9B5EC01526E6615EA6474026AF6A31A99B5EC02EA2AC3460A64740AF819DB5A79B5EC0C1EDCA9962A647402740B79FA69B5EC040C705B064A647406DEA6C9FA59B5EC044A015E266A647403C53A4BBA49B5EC020137A2F69A64740FBAD68C1A39B5EC0E1AA193F6CA64740CDD190B8A39B5EC0CA93944A6FA647409F63BBFDA39B5EC0DE5345B28BA647401B43F735BA9B5EC0DAFD13C88BA647408931E0BEBA9B5EC0D96597C88BA64740CAAAFEB4BA9B5EC01EF34D029BA647403EDC98F0BB9B5EC0F696DF049BA647400DD39BF6BB9B5EC0B9D9400FA8A64740E048D1CDCF9B5EC0D333D857A8A64740AF19D0CDCF9B5EC0C4A68F0FAAA647400560F455A79B5EC0E1E1F587A9A6474099C0DC83A69B5EC06B34C835A2A64740B40369518F9B5EC0A0F7E229A2A64740DF6DC9AA909B5EC03C48373B02A74740DA5E74888F9B5EC0D4B7A1B833A747408ADC5635959B5EC0C318B2303EA74740A5B3F12F969B5EC0AF288FFD3FA74740B2AB4F7D969B5EC0A844758B40A7474000BDE827A09B5EC075A653214FA74740D8929F9EA89B5EC0E6906ABA63A74740CB57AD56A89B5EC07F5B0F8D6DA747404F021035A39B5EC0498E13677CA747400230A448A39B5EC03584FB667CA7474003D987E0A19B5EC0E0F3170B80A74740DC7F1D8BA09B5EC0F7A205A483A747409C947E7E9F9B5EC0E290F03C87A747403A6593A29E9B5EC09DAC62D68AA747402CDD07F59D9B5EC0B58024708EA74740BE6C87739D9B5EC0B2C4320A92A7474009EB6E1C9D9B5EC0615682A495A74740C46CDA039D9B5EC049E23A1098A747402FBD17899C9B5EC0DC0B9384A0A74740CEC9AAED9B9B5EC09238FA45ACA747408E58142E9B9B5EC0DF1DF6B2BAA7474023FE9EF09A9B5EC08154F0B8BCA747401C936308999B5EC001B4CBCFCCA747409C9C6881989B5EC08377ACF2D0A74740070050AF979B5EC0AE5014C5D7A747404A80C95B8B9B5EC0074CE2F1D7A747407320F9A68A9B5EC075E665B7F1A7474059A71AF45E9B5EC0E0CBCC5DF1A747407773AE1A5F9B5EC0F333FE9A5AA8474077B87F0C4C9B5EC06AC9378F5AA84740AE2F40F24B9B5EC0D248C71B45A84740BBF9EEF6499B5EC0FA827B1445A84740F1D0BCF0499B5EC0052904503FA8474013D2285D349B5EC01F7DC64D3FA847403AC0EF4D349B5EC07B328DAB31A84740AA0E0A12349B5EC00F7CDC10F1A74740F1E4862EDD9A5EC01A5CC23EF1A747409498A423C79A5EC0C0DE69B0F1A74740BCEF912AC79A5EC0F38F4F142DA8474071DF513CB19A5EC0870F350B2DA84740FD2F3F4AB19A5EC0F6F74B0344A8474068FB49AFAA9A5EC053A462DB43A8474051FE0AC5AA9A5EC0EF1389CC67A847400261FBBC859A5EC0ABDC90EC66A8474025BDAC02859A5EC004B49D04F3A747400EC643CF2C9A5EC0273189EDF3A74740903868382D9A5EC069DD7D0F7AA747409CA1040D2D9A5EC0F5FCDB2D01A74740DE540590ED995EC07F29004B00A74740554E1C007C995EC08EC59387FEA64740F45A985047995EC010EB0EB900A74740BAAE4831F3985EC010DC845287A64740AF9157F9CB985EC03E5CB81E52A647404C62DE4675985EC03638D66FDCA54740FD9B0B1C43985EC04F5ADC5298A54740EC6E88C21D985EC06286E49D65A547400D0E1AC71D985EC0996A74B463A5474099B9A566EE975EC06E97A14C23A54740C0659F92C4975EC0DD20C4ABE8A447405920A831AF975EC0006D4E6CCBA447404AF8275496975EC09DE04E67A9A44740EB77F09F81975EC0D8E9B94C8CA44740CE76D1A96E975EC01B383B5872A4474009978E7B6A975EC089F52B9F6CA447408C1DA75458975EC05370E07E53A447406CDFBD193F975EC08FCCC38A30A44740E71E1AC0E8965EC0654D3636B7A347400FC722FBC2965EC0FF47734B83A347401BF95C89C3965EC0C869ADA93EA3474092D644E0C3965EC047F87B9E20A3474027601C3BC4965EC0FCD4193701A34740E11367D0C4965EC05A79DF48C6A24740541BA3EDA7965EC0EAF84913C6A2474016D8668E8F965EC06FD28524C6A24740D57A5E667F965EC01E47011AC6A24740A3CF6FA280965EC0BCC907169AA247408935417271965EC0A54E73059AA24740744157C870965EC07212E11C9AA247404EC4012371965EC007A4D97B8DA24740ADC020429A965EC080D9B6F78CA24740F7B58B4B9B965EC08619363F55A24740774F6BDFC5965EC04F825BBE53A2474001A223FEC5965EC028D732FEDDA1474074C4435BC8965EC02494E1296BA14740C82EA7E6A3965EC09B1C91C66AA1474080F3B2F0A3965EC0734E968C8FA14740B4E93FCD6B965EC0E56810C58FA147401B5C62046C965EC0A91B602B6AA14740382D09D85E965EC0B6ABF2026AA14740B0B8CA0C60965EC0A1DB65D42DA1474027928DA260965EC09BC7C3AF10A14740989C66C64B965EC0731EB35210A14740B56E39704C965EC0D0A669DBF1A04740D8B37D8DC7965EC0C5AA9795F3A047406FD5D0FCD2965EC03D2046DDF3A04740B2309054D3965EC076076549D4A047407F46DEE9FC965EC036BB61A1D4A04740B69CF6E4E2965EC0BFADF696B6A04740A08F19FCE2965EC0F5A3FB40AEA04740F95EA71E15975EC0648341EB93A047406C3F3F6E15975EC0F7B6282A77A047400038BA7215975EC0C7D5BC6A75A047409AFCFF0A00975EC0B626F1B775A047408FF0B08C00975EC0B574B5783BA04740B8BB36C604975EC0EEEAFF933BA047402B53972C05975EC0859A95991CA04740CA6204DE03975EC0AF3623C11CA04740C1FA220A04975EC080F13CD60FA04740C96E95B602975EC01F9B909804A04740B412BC7C02975EC0BD2C46AE02A0474000F7A48502975EC01728C01200A047404DE2FA8C00975EC021BA211200A047406778108F00975EC0C910FC29FE9F47402CE33EB800975EC0D8F23DF6E09F474047DB8E2F01975EC0E6668C5B8C9F47409A1F443701975EC0F38D52E4869F4740	City of Tacoma Open Data — Neighborhood Council Districts	https://hub.arcgis.com/datasets/tacoma::neighborhood-council-districts-tacoma-1/about	\N	2026-05-27 04:27:10.448163+00	2026-05-27 04:27:10.448163+00
aef20968-e193-4ba8-97cb-96762bc4379b	6d08439f-6aac-4bd2-bbba-99566b214b69	North End	north-end	0106000020E610000001000000010300000001000000F700000079C3EA7D7C9F5EC03FC0622638A547408BCC8D7D7C9F5EC0B25D592538A54740B4CF5C5B7C9F5EC0F202DEC337A5474064618DE07A9F5EC0FC2DD38B33A54740B6E3E36D799F5EC0238CFF6A2FA54740CD9A08FD779F5EC024324F4F2BA5474085B92D8C769F5EC0BBC19C3327A547402BE7511B759F5EC01F24EC1723A547402FF177AA739F5EC0F3513BFC1EA54740E56B9E39729F5EC0C2578AE01AA5474079ECC3C8709F5EC0EA41D9C416A547402349EB576F9F5EC0A0F727A912A547404197FECB6D9F5EC0A54B40400EA54740E07E08116C9F5EC013F1365109A54740C572C191699F5EC03F0CCB3606A5474024208512679F5EC01EF6691C03A54740786A4993649F5EC02D5E0A0200A5474087281114629F5EC0952BACE7FCA44740787AD9945F9F5EC0D5884DCDF9A447405F69A2155D9F5EC07164F0B2F6A4474044576D965A9F5EC079C39298F3A44740A96D3717589F5EC0F2BE347EF0A4474053830398559F5EC0D83DD663EDA447409A2CD018539F5EC0B44C7749EAA44740096A9D99509F5EC077EB172FE7A447408AAF6C1A4E9F5EC00CFCB914E4A4474049AF2EF34B9F5EC02B6CA867E1A44740E7E216D3499F5EC044CE77C3DEA447407C0C80CE489F5EC04A529D7FDDA44740479BD812489F5EC00ABE6596DCA44740F6AA2FB9479F5EC0988DF726DCA44740129E52A1459F5EC0C4B4FF8CD9A4474073834790429F5EC0D3A359BDD5A447401B5294A23F9F5EC00D549D19D2A4474069EA594C3E9F5EC07C654970D0A447400AE505DC3B9F5EC018A45B68CDA447400676B26B399F5EC01E666F60CAA44740F38A5FFB369F5EC0EECE8058C7A447409E2C0D8B349F5EC0D0CC9150C4A44740915BBB1A329F5EC0C45FA248C1A44740FED63D712F9F5EC0A0F9A5F9BDA44740DB896F382D9F5EC07EFBAF36BBA447406705DEC72A9F5EC0CA63702EB8A44740E3044D57289F5EC0C3722E26B5A44740C6FCBDE6259F5EC0380AEC1DB2A4474090162E76239F5EC03A43A915AFA44740B5C69E05219F5EC08AFF670DACA447402E6611951E9F5EC00C562405A9A44740472783241C9F5EC00E4EE0FCA5A44740A9AEDD301A9F5EC04DA6DB8FA3A447400BA92C9F179F5EC090EEC96D9FA447408D1CFB9D159F5EC024B95BCB9BA44740F398CB9C139F5EC0400AF12898A447403EB7999B119F5EC0F94D828694A447408B496B9A0F9F5EC0DC0B17E490A447400FE03B990D9F5EC089C1A5418DA447409B910E980B9F5EC07CDA3B9F89A44740E8D2DE96099F5EC04E09CAFC85A447405B9AB295079F5EC0078F5F5A82A44740F35C8594059F5EC0261EEDB77EA447404D3A5A93039F5EC0971082157BA44740ADA72C92019F5EC0E8180F7377A44740359B0291FF9E5EC02078A3D073A447407C1ED68FFD9E5EC02AED2F2E70A447400893AE8EFB9E5EC0AEACC38B6CA4474053451C5FFB9E5EC049AE83356CA44740BDC89788F99E5EC0A12B34EA68A44740E15E3F88F79E5EC01819374765A447402E89E787F59E5EC082AB3BA461A4474068A99187F39E5EC0FFE73F015EA44740BC7C763EF19E5EC0842309DA59A44740F0D7FC08EE9E5EC07A474A0554A447400A37DE8DDA9E5EC07E74849F43A44740D599EFAEBE9E5EC0C6D98E292CA44740A7A39F4DBB9E5EC05E30235129A447404E608B7CB89E5EC0FF9822F226A44740C42776ABB59E5EC05D921F9324A4474028DA62DAB29E5EC014F21B3422A447406DA04E09B09E5EC0D2D017D51FA44740A1513C38AD9E5EC0E71513761DA44740FD162967AA9E5EC020DA0D171BA4474001C71796A79E5EC0A30408B818A44740E68A05C5A49E5EC048AE015916A447409CCEF3F3A19E5EC096CAFAF913A44740B5FCE3229F9E5EC02E4DF39A11A447403B3FD3519C9E5EC0E94EEB3B0FA447400601C380999E5EC04DC3E2DC0CA4474079ADB4AF969E5EC0089ED97D0AA44740146EA5DE939E5EC0E6F7CF1E08A447405719980D919E5EC00FB8C5BF05A44740C2D8893C8E9E5EC04CF7BA6003A44740B8177C6B8B9E5EC04EA9AF0101A4474059C83C0A889E5EC0638B3D29FEA3474051F3A2DE849E5EC03E2CF47DFBA347400935325E829E5EC0D10A8EDAF8A34740138FA0CC7F9E5EC020761825F6A34740D7122E317D9E5EC08F553565F3A34740A48AB3907A9E5EC04EF300A0F0A34740659F39F0779E5EC034F2CFDAEDA34740E535C04F759E5EC057879C15EBA34740476047AF729E5EC0668F6A50E8A34740CA77D00E709E5EC04521368BE5A34740EA225A6E6D9E5EC0022603C6E2A347402059E4CD6A9E5EC053AFCF00E0A347404945FD8C659E5EC031256976DAA347403CC87A84639E5EC0FD01F563D8A34740022589EC629E5EC0882A36B1D7A34740FA5C184C609E5EC052AD00ECD4A3474070BDA6AB5D9E5EC066AFCC26D2A34740B7A8350B5B9E5EC00E369861CFA347403EADB4E9579E5EC01EAA4414CCA3474067A43777559E5EC02E47837FC9A347408D462884549E5EC02240447FC8A34740B2F56DB1529E5EC0DA30E892C6A34740BFF74915509E5EC09F5238D2C3A34740886229794D9E5EC01DD08911C1A34740E2EE635F4C9E5EC0E5D7F2E7BFA34740747E11DD4A9E5EC01B3AC750BEA34740D5B7E940489E5EC07D922590BBA34740F922C5A4459E5EC09CB079CFB8A34740683DA508439E5EC0A964C70EB6A3474059EA856C409E5EC03A8D164EB3A34740E81F67D03D9E5EC0F83B658DB0A3474092094C773B9E5EC0BA616013AEA34740D5D548343B9E5EC07D82B1CCADA3474054B22998389E5EC0D749FF0BABA3474060830CFC359E5EC0FE8A4C4BA8A347403FD4EF5F339E5EC0ED63978AA5A347403B89417F319E5EC08D81948FA3A34740051A929E2F9E5EC07C6C9194A1A34740EEE8E2BD2D9E5EC0062A8C999FA347406D3AE8472A9E5EC09F3507F39BA34740EFBCBCAE259E5EC0C844A9329AA34740442927CE249E5EC052D41DDD99A34740367CE219239E5EC0C167F03699A34740EA7EAB93209E5EC06101CD4098A34740E2427E201E9E5EC0BD73EA5197A34740F97BF0B51B9E5EC0615C4E6696A3474059476758199E5EC03A16A67F95A3474042043A07179E5EC053B1B59D94A347402E12EFC1149E5EC0624D49C093A3474054470788129E5EC077F434E792A347405023EE390F9E5EC07908E9A491A3474030C1B8EB0B9E5EC061AA936290A347409608749C089E5EC01CC6D41F8FA3474021C02C4D059E5EC0564A13DD8DA347400C412BDA019E5EC0BDE6B68C8CA3474065214B8FFE9D5EC07231A14B8BA347405196E708FC9D5EC05EB265558AA3474051FAD6B5FA9D5EC0DEF23BD489A3474083041F63F99D5EC073D9315389A3474068DD89FEF59D5EC0938E4F0888A347406949D7B2F29D5EC09B62E7C686A347409BE32767EF9D5EC0194C808585A34740CE377A1BEC9D5EC0F868184484A34740FB66CBCFE89D5EC09FE3AD0283A34740F6581E84E59D5EC00D8044C181A3474000A375E7DE9D5EC0AF68693C7FA347407A8A3A9BDB9D5EC051B7C6FA7DA3474078CAFF4ED89D5EC0D33325B97CA347408126C802D59D5EC0D6E880777BA34740E44592B6D19D5EC067BFDD357AA34740A0285E6ACE9D5EC087B73BF478A347405C6BE811CB9D5EC05222EBAD77A3474010273A74C49D5EC0381D9D1074A3474024EA34B0C29D5EC0D72D0A0773A347408CC88414C19D5EC09ECA291572A347407F0C1FCEBD9D5EC03AA9962870A34740D8C42E7FBA9D5EC027B9FA366EA347400C754030B79D5EC054D761456CA34740A4307CE1B39D5EC066FADD536AA34740CAAB8D92B09D5EC0FDDA036268A34740C7CBA043AD9D5EC0B2B2687066A34740148286F4A99D5EC05D49B37E64A3474006D6329BA69D5EC0A8FE308762A347400AECE241A39D5EC077B6778F60A34740B406A9E89F9D5EC02573CA975EA3474037ED733B9F9D5EC0A66A90365EA347402D5FC8A1989D5EC05C1633515AA34740820DB1FD859D5EC0B4F4225D4FA3474015F5D65A819D5EC012EDB8A34CA347408998A9DE6C9D5EC092FD62D73CA34740EAEF2892679D5EC06C3AB28B37A347400D63DDBC569D5EC0C7E4E0B826A347408C2F8E6B4D9D5EC01D0ADF681DA347409A0C5258479D5EC0FE3C8EC619A34740A7BE1F64429D5EC0ECB9EDCF16A34740B3EBE8AA419D5EC05B90226116A3474063162289419D5EC07456EE4C16A347408CC898082B9D5EC0E592E5D608A3474006B05C6E299D5EC03E8DD03D07A347400B401A93269D5EC0FD369D6404A34740FB69EF37269D5EC0A1FFB20904A347409A2C5A58239D5EC0C7852C2C01A34740229DA9AF1E9D5EC00A39D086FCA24740DA030D0A1C9D5EC04DF114E3F9A24740522F1071199D5EC0A93CF14BF7A2474033E343D5169D5EC05460FFB1F4A247408FB26946149D5EC0A16DF524F2A2474036B59693119D5EC0FFCA0874EFA24740691609F1109D5EC08B65EDD1EEA247404162C3180F9D5EC05624C75FECA247405A5130CB0C9D5EC0BEA71752E9A247409A71266B0A9D5EC0F0A5EC2BE6A247407DDDB511089D5EC001C77F0EE3A24740C9CEE5AC059D5EC0BD95FDE1DFA24740E5BF64DF029D5EC022DCAA2ADCA2474077F36B4CF39C5EC07B636684C7A24740F3374C0CE89C5EC04CBB7499B8A247407081750BDC9C5EC06104408CABA24740D3140643DA9C5EC012B3F19BA9A24740096CA945DA9C5EC09C7F8E94A9A24740AF450DF4289D5EC033E2F257CDA14740F7576822FB9C5EC0A838B1A3B0A147407311F6FF1E9D5EC0129671784AA147405B225E0C1F9D5EC0A89BAB794AA1474037485BAD139D5EC0F6067B4FE5A047402E4D9983A09D5EC0D2552DB0C7A0474044D4E3F1B49D5EC04E825A0BB3A047409365CAA2D29D5EC043D18AA8B2A04740B663A793E59D5EC0C2C8EEA4B2A04740E3C2960BF99D5EC045C6A29CB2A047408666F294059E5EC0764B8E74B2A04740B0DCF630189E5EC07111915CB2A047404D4DA2AB2A9E5EC01A01A05CB2A04740A4BD4D263D9E5EC02C5C975CB2A0474042769F524C9E5EC0A2E14606B2A04740287083A44F9E5EC048A8D024B1A04740FAB90A0C599E5EC0D0E5F646ADA047403C9E9D1F639E5EC040780093ACA04740D4C126377B9E5EC05877B0BDACA04740A7D92F6F939E5EC0AFD615A2ACA047402CB9BA86AB9E5EC0E87B73CCACA0474017E9D79DC39E5EC0504EABDFACA047401FADD7C5DB9E5EC0F01C27F2ACA04740089F1DEBF49E5EC011CACDFBACA04740664B5B734B9F5EC068C34085ADA04740AE536159779F5EC092602C14AEA04740DA9A2AD23EA05EC0A9963F8EAFA04740D085FD3A54A05EC026C1EFD8AFA04740E5090F3B54A05EC044BA5C0FB0A047408CD513B453A05EC02AE1176035A5474005FB1E313FA05EC0F205905335A5474069CB97333FA05EC021B36B1037A54740455772DAD29F5EC0BE7F968B34A547406C4190CEC99F5EC0C9F11AE333A5474079C3EA7D7C9F5EC03FC0622638A54740	City of Tacoma Open Data — Neighborhood Council Districts	https://hub.arcgis.com/datasets/tacoma::neighborhood-council-districts-tacoma-1/about	\N	2026-05-27 04:27:10.450082+00	2026-05-27 04:27:10.450082+00
7df08048-e317-46b6-bfc6-39453d925e4c	6d08439f-6aac-4bd2-bbba-99566b214b69	Central	central	0106000020E6100000010000000103000000010000008B0000002F132F6C4AA05EC021305C68189F474094FE2E9B51A05EC041472D8A479F47407570423A54A05EC06307FCD8AFA04740DA9A2AD23EA05EC0A9963F8EAFA04740AE536159779F5EC092602C14AEA04740664B5B734B9F5EC068C34085ADA04740089F1DEBF49E5EC011CACDFBACA047401FADD7C5DB9E5EC0F01C27F2ACA0474017E9D79DC39E5EC0504EABDFACA047402CB9BA86AB9E5EC0E87B73CCACA04740A7D92F6F939E5EC0AFD615A2ACA04740D4C126377B9E5EC05877B0BDACA047403C9E9D1F639E5EC040780093ACA04740FAB90A0C599E5EC0D0E5F646ADA04740287083A44F9E5EC048A8D024B1A0474042769F524C9E5EC0A2E14606B2A04740A4BD4D263D9E5EC02C5C975CB2A047404D4DA2AB2A9E5EC01A01A05CB2A04740B0DCF630189E5EC07111915CB2A047408666F294059E5EC0764B8E74B2A04740E3C2960BF99D5EC045C6A29CB2A04740B663A793E59D5EC0C2C8EEA4B2A047409365CAA2D29D5EC043D18AA8B2A0474044D4E3F1B49D5EC04E825A0BB3A047402E4D9983A09D5EC0D2552DB0C7A0474037485BAD139D5EC0F6067B4FE5A04740530403CB0F9D5EC0C16250ADC3A04740C74959F20B9D5EC038496204A2A047403F784F40049D5EC0D4A584845EA04740BAD9FF8DFC9C5EC0DDB99FED1AA0474048D387B5F89C5EC0AD28A844F99F4740FE35172BED9C5EC00CB6BA04949F4740CE8A68A1E19C5EC0A732BADB2E9F47409328FD6FB29C5EC052CF1DE5389F47407875EAEC529C5EC03375BAD14C9F47405AE89838459C5EC002F4BC7CD59E4740663CF932309C5EC0B6D2379E1C9E4740920F1048369C5EC0DC099B08169E474045CC829A3B9C5EC0210CFFFF0F9E4740C92E13FF409C5EC0D74FD5330A9E474076FD9EBD469C5EC0500C4893059E47401AC8602A4B9C5EC095511331029E474075A3833A4E9C5EC08A3DA41C009E47400A524879559C5EC0CB7623D3FB9D47400EA4B29B5C9C5EC098BBA9B5F89D47400E6276F67B9C5EC07FD44A2AEB9D474012B073E58F9C5EC0E263DDC0EB9D474034CF85CED49C5EC0E0C46AD6ED9D47402AD90009F39C5EC0F443B09DEE9D47406918C567FC9C5EC03D1DCDBFEE9D4740CE074ADD0F9D5EC034A0BCA1EE9D47404C52EC68219D5EC024241C7DEE9D4740B714863B2D9D5EC05BD8F441EF9D474003F19FB0409D5EC02FD6A40CEF9D47401AE605D14D9D5EC09E8E0AF7EE9D474085375412629D5EC0E8C0A916EF9D4740ECC80F09B89D5EC058D98D9DEE9D47401682B438BD9D5EC0AD349129F99D47409E845C70C09D5EC0B8C6AEA8FD9D4740A2EF9036C69D5EC0861692BA059E47407F54D68CCE9D5EC0515D24F60D9E4740E49206D6CF9D5EC0BA09353B0F9E474062B4BD69D49D5EC0BD1C29E7119E47403EB9DD56DC9D5EC06DDA9287169E4740DD6FCBB5EB9D5EC0FFD903EC1A9E47408C7604E6099E5EC00783DD41189E4740F6A5F004329E5EC098C264D9139E4740B7CB6173689E5EC0D4694C3A129E4740450FD341B39E5EC0D6F576B6109E474040B14A43DE9E5EC094C6D0D60F9E47403024BE66389F5EC041441C450E9E4740625BC9BA489F5EC0DBD688ED0D9E4740AB1EA7B54F9F5EC0376F13C80D9E4740A1CF1B84769F5EC095F795F70C9E4740C9B69BA8979F5EC0E31B9A230C9E474090D4D0ACB49F5EC0B52F74550C9E47402140E9E4B69F5EC0F391A6BB0C9E47401ACC3765B99F5EC099F196380D9E474098B84F09BB9F5EC0517F70970D9E474042361FACBC9F5EC0252242000E9E47405BF2864DBE9F5EC05D3405730E9E47402E8767EDBF9F5EC0A233AFEF0E9E4740AE589D8BC19F5EC090B137760F9E4740EB620A28C39F5EC01A319206109E4740F9DE8DC2C49F5EC0F22AB6A0109E4740585E085BC69F5EC0872E9744119E474058FE58F1C79F5EC0B0E926F2119E474096BB6185C99F5EC099DF58A9129E474000480017CB9F5EC087CA1E6A139E4740E3F817A6CC9F5EC098446834149E4740BFEA8732CE9F5EC096FB2608159E4740E17233BCCF9F5EC0C9894AE5159E4740A39BF942D19F5EC06BC0C0CB169E47409945BCC6D29F5EC0E65777BB179E4740F8C45E47D49F5EC068EA5DB4189E4740117DC1C4D59F5EC045605EB6199E4740794EC63ED79F5EC0EB7166C11A9E474031DC51B5D89F5EC02FE25FD51B9E47409F924428DA9F5EC0BF8736F21C9E4740CF768497DB9F5EC09E2AD2171E9E4740E0F4F102DD9F5EC095A11E461F9E4740DF11736ADE9F5EC0C6B4037D209E4740B888E9CDDF9F5EC05B6367BC219E4740BD5E3B2DE19F5EC085753104239E47407DC24B88E29F5EC075CC4954249E4740E2A600DFE39F5EC0825394AC259E47403C9C3E31E59F5EC046F1F60C279E47401809ED7EE69F5EC0D7725775289E47405D6BF0C7E79F5EC003E297E5299E474022B52E0CE99F5EC05A2A9C5D2B9E4740B2CF8D4BEA9F5EC0134946DD2C9E474019EDF785EB9F5EC030047A642E9E47404AED52BBEC9F5EC0856A17F32F9E4740942386EBED9F5EC0E96C0089319E474050457A16EF9F5EC01E011526339E47400E69193CF09F5EC03E2233CA349E47408D77495CF19F5EC071CD3C75369E4740A8F1F576F29F5EC056F10F27389E4740C2EE088CF39F5EC0CE888ADF399E4740887B6C9BF49F5EC08DA0889E3B9E4740B9220CA5F59F5EC07A15EA633D9E474049F1D1A8F69F5EC020F48A2F3F9E474051C1AAA6F79F5EC0D6414501419E47408FA8809EF89F5EC07FF9F6D8429E4740DD5F4390F99F5EC0B9F57BB6449E4740534CDE7BFA9F5EC0D659AC99469E474054B23F61FB9F5EC0981E6282489E4740937D5440FC9F5EC0D0257B704A9E4740E14A0C19FD9F5EC0DE7ECD634C9E474030C956EBFD9F5EC0FB15335C4E9E47405A3C22B7FE9F5EC0B2E38559509E4740BEAB5F7CFF9F5EC0CDEA9B5B529E474052C6FE3A00A05EC069174F62549E47407593F0F200A05EC0426C756D569E474001F928A401A05EC067C1E67C589E47404F669B9205A05EC0D7990750639E4740DF5E35EA09A05EC05B1F1C926F9E47406C32086512A05EC0D0DCDC25869E47402F132F6C4AA05EC021305C68189F4740	City of Tacoma Open Data — Neighborhood Council Districts	https://hub.arcgis.com/datasets/tacoma::neighborhood-council-districts-tacoma-1/about	\N	2026-05-27 04:27:10.45148+00	2026-05-27 04:27:10.45148+00
eb67d99c-2255-4bc4-8f00-9ca845d4895b	6d08439f-6aac-4bd2-bbba-99566b214b69	South Tacoma	south-tacoma	0106000020E610000002000000010300000001000000290100002F132F6C4AA05EC021305C68189F47406C32086512A05EC0D0DCDC25869E4740DF5E35EA09A05EC05B1F1C926F9E47404F669B9205A05EC0D7990750639E474001F928A401A05EC067C1E67C589E47407593F0F200A05EC0426C756D569E474052C6FE3A00A05EC069174F62549E4740BEAB5F7CFF9F5EC0CDEA9B5B529E47405A3C22B7FE9F5EC0B2E38559509E474030C956EBFD9F5EC0FB15335C4E9E4740E14A0C19FD9F5EC0DE7ECD634C9E4740937D5440FC9F5EC0D0257B704A9E474054B23F61FB9F5EC0981E6282489E4740534CDE7BFA9F5EC0D659AC99469E4740DD5F4390F99F5EC0B9F57BB6449E47408FA8809EF89F5EC07FF9F6D8429E474051C1AAA6F79F5EC0D6414501419E474049F1D1A8F69F5EC020F48A2F3F9E4740B9220CA5F59F5EC07A15EA633D9E4740887B6C9BF49F5EC08DA0889E3B9E4740C2EE088CF39F5EC0CE888ADF399E4740A8F1F576F29F5EC056F10F27389E47408D77495CF19F5EC071CD3C75369E47400E69193CF09F5EC03E2233CA349E474050457A16EF9F5EC01E011526339E4740942386EBED9F5EC0E96C0089319E47404AED52BBEC9F5EC0856A17F32F9E474019EDF785EB9F5EC030047A642E9E4740B2CF8D4BEA9F5EC0134946DD2C9E474022B52E0CE99F5EC05A2A9C5D2B9E47405D6BF0C7E79F5EC003E297E5299E47401809ED7EE69F5EC0D7725775289E47403C9C3E31E59F5EC046F1F60C279E4740E2A600DFE39F5EC0825394AC259E47407DC24B88E29F5EC075CC4954249E4740BD5E3B2DE19F5EC085753104239E4740B888E9CDDF9F5EC05B6367BC219E4740DF11736ADE9F5EC0C6B4037D209E4740E0F4F102DD9F5EC095A11E461F9E4740CF768497DB9F5EC09E2AD2171E9E47409F924428DA9F5EC0BF8736F21C9E474031DC51B5D89F5EC02FE25FD51B9E4740794EC63ED79F5EC0EB7166C11A9E4740117DC1C4D59F5EC045605EB6199E4740F8C45E47D49F5EC068EA5DB4189E47409945BCC6D29F5EC0E65777BB179E4740A39BF942D19F5EC06BC0C0CB169E4740E17233BCCF9F5EC0C9894AE5159E4740BFEA8732CE9F5EC096FB2608159E4740E3F817A6CC9F5EC098446834149E474000480017CB9F5EC087CA1E6A139E474096BB6185C99F5EC099DF58A9129E474058FE58F1C79F5EC0B0E926F2119E4740585E085BC69F5EC0872E9744119E4740F9DE8DC2C49F5EC0F22AB6A0109E4740EB620A28C39F5EC01A319206109E4740AE589D8BC19F5EC090B137760F9E47402E8767EDBF9F5EC0A233AFEF0E9E47405BF2864DBE9F5EC05D3405730E9E474042361FACBC9F5EC0252242000E9E474098B84F09BB9F5EC0517F70970D9E47401ACC3765B99F5EC099F196380D9E47402140E9E4B69F5EC0F391A6BB0C9E474090D4D0ACB49F5EC0B52F74550C9E4740C9B69BA8979F5EC0E31B9A230C9E4740A1CF1B84769F5EC095F795F70C9E4740AB1EA7B54F9F5EC0376F13C80D9E47404561C1934F9F5EC0DCADC9C80D9E4740C8682CBC479F5EC00AAADEF20D9E47403024BE66389F5EC041441C450E9E474028240045DE9E5EC08E856CCC0F9E4740450FD341B39E5EC0D6F576B6109E47406B90766C689E5EC08AD5794C129E4740D2A9A506329E5EC0B98D2CE2139E4740208D3CDD099E5EC050B7564E189E4740D5188BB2EB9D5EC0A3160AF31A9E4740BA3B9E4FDC9D5EC090528C87169E474062B4BD69D49D5EC0BD1C29E7119E47407CC030D7CF9D5EC0474A74390F9E47407F54D68CCE9D5EC0515D24F60D9E47401022E02AC69D5EC02EB3DFC1059E47409E845C70C09D5EC0B8C6AEA8FD9D47408917683ABD9D5EC0C990AF1EF99D474038769DBEB99D5EC0607FB112F29D4740ECC80F09B89D5EC058D98D9DEE9D474085375412629D5EC0E8C0A916EF9D47401AE605D14D9D5EC09E8E0AF7EE9D474003F19FB0409D5EC02FD6A40CEF9D4740B714863B2D9D5EC05BD8F441EF9D47404C52EC68219D5EC024241C7DEE9D4740CE074ADD0F9D5EC034A0BCA1EE9D47406918C567FC9C5EC03D1DCDBFEE9D47402AD90009F39C5EC0F443B09DEE9D474034CF85CED49C5EC0E0C46AD6ED9D474012B073E58F9C5EC0E263DDC0EB9D47400E6276F67B9C5EC07FD44A2AEB9D47400EA4B29B5C9C5EC098BBA9B5F89D47400A524879559C5EC0CB7623D3FB9D474075A3833A4E9C5EC08A3DA41C009E47401AC8602A4B9C5EC095511331029E474076FD9EBD469C5EC0500C4893059E47406230B204419C5EC04055B42B0A9E474009CE17953B9C5EC0DEA3BB03109E4740920F1048369C5EC0DC099B08169E4740663CF932309C5EC0B6D2379E1C9E47404D8D42642B9C5EC070D76A99ED9D474012DB56BB2C9C5EC04DD58671E79D47400DDA621E2F9C5EC063089ECDE09D4740917B30A1379C5EC0338B90C7A29D474041C279825C9C5EC05ECA80248D9D4740AF16DC10719C5EC0FB164874849D47400819E9BE839C5EC09E7B37CE7D9D47407C1E05659C9C5EC0440FC9EE789D4740838DCD7CBD9C5EC05AFEADBA779D4740247D9E85DB9C5EC09A850C787C9D474093975F383E9D5EC05978E8ED929D474038A4130C4A9D5EC0965CA3F7939D47405E7D9D72599D5EC0BDA92E02929D474059ABDB29699D5EC082BFA1A28B9D4740FDA64E76749D5EC06BF44E69859D4740F008E3887E9D5EC0505A72127D9D4740942BB774859D5EC0FC88EE8E759D474083968705909D5EC03A555FB8679D474047A21D95949D5EC0E2865C01619D4740A5CAE280979D5EC024559BCB5A9D47406AF5F75F9A9D5EC048F3547C559D47404148BCB19C9D5EC09892C3D84E9D474069086F119F9D5EC0602CAC93479D4740AEFF067AA19D5EC05CEB2B993E9D4740A015EE43A39D5EC078BF2FCC379D4740643C6D05A59D5EC049A05D332F9D47409438AE59A69D5EC0428C24E9249D474065CC1C08A79D5EC010E993451B9D474097FB187BA79D5EC0E21EE7C00F9D474050B435C0A79D5EC033905E0AFE9C4740C48ED58AA89D5EC0CD8CB6888A9C47403DAD89F1A89D5EC09DA70D596A9C474012C8A4DAA89D5EC067F5C19F5A9C4740E4559987A89D5EC0F7E8E2A6419C47400D63F692A79D5EC0CF31973A2A9C4740ECE4E95CA39D5EC07F1B4791E29B474075F4B2D79F9D5EC0BE0A4CA7AE9B4740AAB0A9A89A9D5EC0D861F7A4609B474031121E67969D5EC07716D377169B4740336009448B9D5EC08F4B10AE709A4740F5958540869D5EC092200E0C219A47401E001DA4859D5EC0D1440A040E9A47401FCDB0B1869D5EC026DB653BF899474068B759F1929D5EC05BA6BBE2549947409E304963959D5EC0827B3F4026994740825C8272969D5EC02AE5072BFB984740947F6AC0969D5EC0243F0147D99847406232F6AC979D5EC00E1621D47798474037728527989D5EC0CF1305556A984740CA41F5A69A9D5EC0C1CD00724998474011B275E39C9D5EC06F1B4C2037984740BE12775EAC9D5EC0DA3AD9B6C697474044EE740DB19D5EC06182DC7EA3974740616DE61BB99D5EC0F9D5A2AEA397474077FCFD87BB9D5EC064AED6C0A397474019FEE3A9BE9D5EC01442E1D8A397474021C2E95DBF9D5EC0DE8AE3ADA0974740A4DA4959C69D5EC0B73CF8D6A0974740186B1802C69D5EC0BEBBF547A1974740919E9DB1409E5EC0DD669719A4974740C9B14238529E5EC0BB55327DA497474075AB3E3C529E5EC0D3E50A33A7974740CCBE4336549E5EC0CE5FEC3AA7974740BA5DA2AEF49E5EC0DC5DE2C0A59747409486BE1EA39F5EC03DDE1254A59747402B0249404AA05EC00EBFF139A4974740A3E9688E51A05EC0EECC6F2DA4974740E27FB68F51A05EC01963CD28A4974740E341DC1453A05EC0055531B160984740E320CE3E70A05EC0DF79DDE86098474009BC694070A05EC01E91E775609847408A19DF0280A05EC082F21494609847403C7BE70280A05EC0F96915076198474038BD629B8DA05EC0FDA6C820619847409E1CE7A68DA05EC010C9E87C669847403CED43D88DA05EC09D4480E692984740643A17C69EA05EC01496F4F892984740BA991971F1A05EC089B0867A929847408160996602A15EC0039EBCFDA89847404369E4EA04A15EC0E920A57309994740E907836B58A15EC0F20FEB84079947400CEC277159A15EC0CD3F2FBE0A9947402E2DB6255AA15EC0020FE8470D9947407E814B555AA15EC05C02F0F20D9947403A4D377C5AA15EC0E294C3910E9947409098F2285BA15EC0B7F0295F11994740994344B65BA15EC0F5E27F1514994740655B48BE5DA15EC0841BC3DA1F994740FDFAADE85BA15EC0012800EA1F99474044D5AE725CA15EC046CA8A346E994740BF85B03B5EA15EC0B1CE8DAD7099474087B0FF5960A15EC0707D6A2F75994740D37616A95FA15EC0345B5EB4799947400CEBC18D5CA15EC0A70CD7A97F9947403C73038F5CA15EC0E61B57467E99474027F30C9240A15EC0FB2F91917E994740D26E19AB3FA15EC013F8C07478994740489E5A6736A15EC0349D99BD72994740932AFBA032A15EC0D84225AF73994740A31AD9D527A15EC0C9A41FF87A994740D3EE3FEB27A15EC0CBC2A2D37E9947409A87CA3605A15EC0D85E62307F9947408C3BB78990A05EC084BC4F8180994740EB81538955A05EC0BE5FEE238199474043F1A6C455A05EC085738EB2D5994740A4A64C2665A05EC0300B9D8FD59947406870E60865A05EC058E084CDF39947403F4D386187A05EC0032F1A38F3994740D55E78438AA05EC05720313AF3994740D5D5B2288AA05EC00625749CF3994740F19F18058AA05EC0DA13A31DF49947405CC4A2DF89A05EC0FD9F00A4F4994740670BCDB989A05EC019422F2AF59947405059979389A05EC01D2F29B0F599474003288D6E89A05EC094209630F6994740FDAD891188A05EC04135F9AAFA994740522CC6A386A05EC0914BCE48FF9947408FFF15C484A05EC0E179CEA5049A4740E919911C83A05EC08B0043EF089A47400DCBBB1681A05EC0A77133BE0D9A4740253719EE7EA05EC0F7A1B270129A4740E09752AB7CA05EC0C9863D08179A47400A7ECD377AA05EC0CB3815791B9A4740F172428F73A05EC0971C3B9B289A474069E0E3A669A05EC0E3ECFC173C9A47407D6AAE0668A05EC08F7AA5583F9A4740E8E1DA6366A05EC0DAD9D1CC429A4740E91F21D466A05EC022773F6D439A47405CCB5E2163A05EC067E53F6D4C9A474057446E4161A05EC0AE9C8FDB519A4740EA386F905FA05EC07BF96566579A47400CCE480F5EA05EC05970C90A5D9A4740A112C7BE5CA05EC068BBB7C5629A474058D314FC5BA05EC01D06A896669A4740B87CF64E5BA05EC0BD62246F6A9A4740A2006CAC59A05EC004910497729A474068B2AF1059A05EC02957FA40789A474022E2F7A058A05EC0EC7672F27D9A474091487B6358A05EC0C5F0E3F1829A47404C51EC4758A05EC0863B84F3879A47405D9A800559A05EC0FAA9E7F1879A4740B8548E1659A05EC0D3460FA79C9A474061ED2D5158A05EC0B1B3B2A4A29A47405A8A5A5458A05EC046453DCBAB9A47401C3C9A5458A05EC00AA33E83AC9A474098EDD95458A05EC0C100403BAD9A4740D644625858A05EC0270B0E6BB79A4740D07AF75958A05EC0564B4EF8BB9A4740711DCF5A58A05EC06D044765BE9A4740CB3F865B58A05EC0B7FA4176C09A47406D211A5F58A05EC063AAB7C9CA9A4740851A1D6158A05EC09D933393D09A47401F62AD6858A05EC01526A861E69A47400415566958A05EC0BFCDCE4AE89A4740CBFCD46B58A05EC02D1B137AEF9A474042F9057358A05EC0DC361537049B47403030637558A05EC04136F3050B9B4740A91BC78758A05EC0FAF07F0B409B47405275219258A05EC097E4BFCC5D9B474010ABD68D58A05EC08B84D6985F9B47404619728258A05EC0532D74C2679B4740D975D87358A05EC0E7E4DD36729B4740B150095958A05EC07BAAD269859B474090DD275758A05EC0C208DDC2869B4740937C465558A05EC06443EB1B889B47405D13514B58A05EC0949B133D8F9B474078FC893D58A05EC0E944652C999B474073FE1E2E58A05EC0B7AD8626A49B47403D4A0B1E58A05EC044D9E9A8AF9B4740E0C0FAE957A05EC0C89F5BF1D49B4740F95DE79657A05EC0E8928487109C4740EA850F8E57A05EC0EE29AF2D179C47406D8EA94D57A05EC09CF8B31E459C474089754B1C58A05EC001D35B5A4A9C47402ADDAA1759A05EC0B7EE12B8509C47405349BCBF58A05EC08746A34D859C4740AD03E3B658A05EC0851090928A9C47409F59B25958A05EC02FD042C9BF9C47401095385458A05EC0B1E19BF7C29C47404F469B5558A05EC056EEBE6CC69C474095AF9D3A58A05EC0ED77A288FA9C474033B46D3658A05EC043DAB09E029D474078856F1B58A05EC0C69DF3B9369D4740E87E071A58A05EC0F5B6F8DE399D474053D7FECD54A05EC067A035EA399D47400BEC9EDE53A05EC0DDDF66B4B19D474076919B8C53A05EC01FD3213CDB9D4740A13ACB3F53A05EC0F73AD14E029E4740E602D4F152A05EC03B299B88299E4740347676FF51A05EC06DD1DC60FF9E47402098A7E351A05EC03882D4E9179F47402F132F6C4AA05EC021305C68189F4740010300000001000000130000006282697F69A05EC0D8796351FE9C47408BB9014B69A05EC0880911CCC29C47400390F95F97A05EC0CA64B133C29C4740BA44BD13C4A05EC0DC21F997C19C4740753CB304C4A05EC04CD5E416C39C474092894B50C4A05EC07627BC24DB9C474034594D41CCA05EC0DBB85FFBDA9C4740125C2C4ACCA05EC091E0567FDF9C4740EF9B9C90D8A05EC0EE030546DF9C4740BFD0F5DED8A05EC020F80006FD9C4740D3F1C594E0A05EC066C357E2FC9C4740FC53979BE0A05EC00AE56275009D4740279D9B0DE3A05EC0955B6769009D47403690F8BFE3A05EC0674FB831389D4740B449F1939CA05EC03AEB1DFE389D47409147A3539CA05EC03FCAE566169D4740400374D77DA05EC018B6F4AF169D4740FA1C82A37DA05EC07FC45A5FFE9C47406282697F69A05EC0D8796351FE9C4740	City of Tacoma Open Data — Neighborhood Council Districts	https://hub.arcgis.com/datasets/tacoma::neighborhood-council-districts-tacoma-1/about	\N	2026-05-27 04:27:10.452513+00	2026-05-27 04:27:10.452513+00
785da82b-d90d-4138-af97-06a5ef967597	6d08439f-6aac-4bd2-bbba-99566b214b69	South End	south-end	0106000020E61000000100000001030000000100000015010000E6CA8212EE9A5EC012D56987889847408E16A714EE9A5EC05CDE22C0869847404AADC520EE9A5EC0F9D64ABF7998474056A58C24EE9A5EC0745C577F75984740B1DECC7FEE9A5EC06D4734CC6D9847409DC6E688EE9A5EC0A966EC0C65984740A4DFB6ADEE9A5EC0D9D85F283E9847404C95FABAEE9A5EC0CE30E12330984740E41E4042EF9A5EC042B16332A197474067064E0AEF9A5EC01911DF39459747403DF17CCFEE9A5EC07BC7B8F9EB96474034B6F13EE69A5EC096892BF7EB964740706BF93DE69A5EC03D73046DE79647400A12873DE69A5EC005012D17E596474020B69B9ADD9A5EC013D45EFBE49647407500DB97DD9A5EC0489F33F0E2964740FCF2CC91DD9A5EC0DD013A72DE964740CAE56225E89A5EC07181E673DE9647407F5199C6EE9A5EC05D22C576DE964740F9F37EA8EE9A5EC0B158BFB9B0964740A654B9A9EE9A5EC0FB905806AE9647406DCF2AAFEE9A5EC060DC0DA3A2964740BED1D4C5E69A5EC05B5996A1A296474062B461CAE69A5EC0FE945E86999647404794EECEE69A5EC074C1266B9096474026B2F0B7EE9A5EC00C6A596E90964740468E6BC9EE9A5EC0B3C4E7546D964740693E75E0E69A5EC0906857526D9647407A8A57ECE69A5EC0A560F6865596474099AC2B06E79A5EC08E9A4D225096474016B349F9E79A5EC0168BEF2150964740A0472F23E89A5EC055BBBB85339647405F927FE4EE9A5EC0D676AF82339647405F1831F7EE9A5EC0C049DDEAEE9547409E646C0BEF9A5EC044D2D674E1954740653EA5BBEE9A5EC078540CF5D79547400E88E6C2EE9A5EC0D69FB0C2C8954740010952BBEE9A5EC0A7966A57C3954740914E4ED4199B5EC0DB43BD7BC3954740245B7A76339B5EC093DCFE8CC39547401AAAF6663F9B5EC08EEAFA94C39547408D72A7673F9B5EC01BDCFB4FC3954740F08C62B3489B5EC02CCB7057C3954740C8F870B5489B5EC09EFDF2F5C09547405E517BDE6F9B5EC0DB1EFE02C195474035D6CBC77C9B5EC03E5B6C0BC19547400FA6D48B9C9B5EC0E2A8EB1FC1954740554E82869E9B5EC09E96A325C1954740CF05A8FFA89B5EC07A865E43C1954740C67D4B00A99B5EC0E43060E7C0954740074FC14FB29B5EC035CEC701C19547407E5F1550B29B5EC02A31C9EAC095474057BE2D95B79B5EC0CB16B9F9C0954740F837D795B79B5EC0E3E1B9CBC0954740D2015BABC49B5EC08A56C7F0C0954740AAC0CF04C89B5EC0E9E225FAC095474072AE8974C89B5EC0D83CD9F47B954740CD8400F59C9B5EC04B5097417B95474062FFC0169D9B5EC0F65E1AD564954740BDB3EF98C89B5EC0CC96287A659547409CE0F2A2C89B5EC0583C234B5F954740685CC1C8D39B5EC0BF725B7A5F95474000246FA4E19B5EC0D55340BE5F95474095B51E52E19B5EC0B655B234899547403B69D014DE9B5EC05C998B30899547403E7BB80ADE9B5EC05B6B69258F9547406FCDC0E3DD9B5EC09036981EA695474069A46FB5DD9B5EC0C1D93D78C19547406245C067E49B5EC03E71C38CC1954740B9FB4DA0EF9B5EC0CC692DAFC195474000F9DA9FEF9B5EC01663070BC29547409E264034FB9B5EC0B56E9D2BC29547403036F834FB9B5EC091C690CDC1954740BB623BF7FB9B5EC0B265A7CDC1954740F17840F8FB9B5EC06C87F8CEC195474023AD6AF9FB9B5EC080950AD0C1954740F5BDB2FAFB9B5EC0CF24D4D0C1954740B1B00EFCFB9B5EC09CAD51D1C1954740488174FDFB9B5EC0EDB97DD1C1954740C508221E179C5EC0B9266B17C2954740CD43C88C339C5EC0957AE36DC2954740A16536FB3E9C5EC02ED4D28DC2954740E8C9A8FA3E9C5EC02C74D2E9C295474000964900479C5EC07C433700C39547400A1F4A7E499C5EC02A482B07C39547404E3AE780499C5EC05D3E2237C2954740A2D074014C9C5EC06A17B22BC29547409987A6024C9C5EC0900EDB2CC295474047D4F8034C9C5EC0CCA2B52DC29547403EBC61054C9C5EC0C34C3E2EC29547406C3BD7064C9C5EC07C966F2EC29547400A251EC8579C5EC0A30B6B54C29547408394128A5C9C5EC0487AC863C29547405FE28728639C5EC02505D74BC2954740FD7178216E9C5EC0D72534ECC2954740D9C526557B9C5EC06F8A21ADC3954740C9044B547B9C5EC0A429DE48C4954740CA704BDD829C5EC02F37B97EC49547407EDEA9DE829C5EC0842FBC22C49547409C267189839C5EC07B537841C3954740260A6FD4869C5EC0A0772F5BC39547400085CAA1879C5EC0BB3AA547C4954740035B67E98B9C5EC00886F369C49547400A109EE98B9C5EC00D54B458C4954740F9421FFB909C5EC0CDB55981C4954740FE088924919C5EC0637C0082C4954740BBA3F662999C5EC0E72AACA1C49547405901A07B999C5EC097D30AA2C4954740E7E38245A09C5EC095591CBCC49547405E17ED46A09C5EC02EAA055CC49547407C17F790B69C5EC022374FD5C4954740D5795A62C09C5EC0F3ACB00AC5954740E306EE38CB9C5EC0D96ADD45C595474000904EA4D09C5EC08AE87163C595474029C35157D69C5EC0F8A7F381C59547405214A857D69C5EC0EB31436CC5954740FEBE2A44E19C5EC096A33CA9C59547404DFDA17CE79C5EC07B35A2CCC5954740B0B4C643EC9C5EC02E0945E1C5954740CE275044EC9C5EC0363D3BF7C5954740F47A086DF49C5EC0CD34DA22C69547408F4ED318F59C5EC07F896A29C59547402FC1D90CF99C5EC0D5971D25C59547405DD928B2F99C5EC037ED0021C69547401BE9F069FF9C5EC010DEF917C69547406D24AB50049D5EC08D623A10C695474068552695079D5EC04C870E0BC6954740E2E458C00F9D5EC085AB1EFEC595474072714C49169D5EC07F13C3F3C5954740E8EBDAD01C9D5EC0FD1263E9C5954740A778DED01C9D5EC002BB6000C6954740C10DFF1F1F9D5EC032A3BBFCC5954740A28F01C91F9D5EC0CC99CA2CC59547401DDDBD6A259D5EC0CAE550EEC4954740D62C1EA72A9D5EC037FA80E4C4954740C39954D4339D5EC05DD2B4ADC59547408B3BE5D4339D5EC0A885BBADC5954740BF20A122399D5EC0A1B222A6C5954740C39B275F439D5EC06788F094C59547409A2BA85E439D5EC0BD7332AEC5954740F8B0BA5E439D5EC0FD3C0BB0C59547406841045F439D5EC0EC7FD8B1C5954740D045835F439D5EC0FBA090B3C59547401EAA3460439D5EC0153426B5C59547409AA01261439D5EC0F6B091B6C595474011401762439D5EC01BC4C5B7C595474081373E63439D5EC09DB5BEB8C5954740FEDA7E64439D5EC03B2773B9C59547409199D065439D5EC0E385DFB9C59547404C812967439D5EC01E3902BAC595474025A3E1154B9D5EC03D13D2A2C5954740117622135E9D5EC03A13296AC59547408537D6B4779D5EC0AB050441C59547405805C1A5A39D5EC0FDF3C2F9C49547407BCB1BA8A39D5EC04F86E6F9C49547406E8C4E09B39D5EC055638F1AC59547404D048951B59D5EC0A0D1EEEA5A95474056056FABCF9D5EC08468767C5A954740E42ADF20CE9D5EC08943F0F09E95474069E33748CD9D5EC0CC06F1DFC4954740E76A46D7D09D5EC030A06FE4C4954740B73BF024FA9D5EC07CC6B33DC595474033258510FA9D5EC01AFC78D5C89547400E278A64FA9D5EC02E19C82C3C964740FBFD592AF09D5EC01A5226A050964740F66DA294EC9D5EC09996FEDA57964740E9A2DE06E99D5EC0811A90E45E9647407EFAD770E69D5EC0BE0D0FE563964740CCBB57F0E39D5EC00051C0F968964740E8AEB285E19D5EC0AEDFFA216E9647408627434ADF9D5EC0358EBD037396474067D98C22DD9D5EC00632E1F5779647404C228DEDDA9D5EC0D582AF337D9647408A092E81DB9D5EC07309FBA27D964740932C86F8D89D5EC06BBCBE3784964740D414AE73D69D5EC039FEA4228B964740FA327F14D49D5EC0DCEE202692964740FA984938D29D5EC01AEAF00D98964740454BC976D09D5EC0874EE2049E96474025D73CD0CE9D5EC0DDCE140AA49647408BFF9F56CD9D5EC0A5BA41D4A9964740F6C019F9CB9D5EC0B10831ABAF964740E9991AADCA9D5EC0B410BC89B5964740A7377668C99D5EC0FFA3C20CB5964740475DEE41C99D5EC05CEC05C6B596474081336543C99D5EC000FFE1C5B59647403FBCF1E9C69D5EC0D8480078C2964740779843F3C09D5EC044858D05DC9647406FFE1E5BC09D5EC02C1B0415DE964740B482D99BBF9D5EC05B703A0CE09647401DF07CB7BE9D5EC0A55CD0E5E1964740B5F77BB0BD9D5EC0D43DB59CE396474011B3A589BC9D5EC020EB352CE5964740AC532046BB9D5EC077361090E6964740A47863E9B99D5EC04E1E73C4E79647403EF52877B89D5EC0F7A412C6E8964740C73867F3B69D5EC0F6DE2B92E99647407E034262B59D5EC089ED9426EA964740C78C04C8B39D5EC0AF88B381EA964740C8421229B29D5EC0BEE78EA2EA96474094232F2BB29D5EC067FE896EEC964740E26A0E8DA49D5EC0B6C8568CEC9647405D6B9E97A49D5EC0B14A3888F5964740747EB319AF9D5EC03B8A3B71F59647400F4BC51BAF9D5EC0BAB61832F7964740E47293BFC09D5EC07B488BFCF7964740E77380B8BA9D5EC05C1300B523974740A7C87DCDA49D5EC0B18499582397474008ACE163A59D5EC00AC83F3AA397474044EE740DB19D5EC06182DC7EA3974740BE12775EAC9D5EC0DA3AD9B6C697474011B275E39C9D5EC06F1B4C2037984740CA41F5A69A9D5EC0C1CD00724998474037728527989D5EC0CF1305556A9847406232F6AC979D5EC00E1621D477984740947F6AC0969D5EC0243F0147D9984740825C8272969D5EC02AE5072BFB9847409E304963959D5EC0827B3F402699474068B759F1929D5EC05BA6BBE2549947401FCDB0B1869D5EC026DB653BF89947401E001DA4859D5EC0D1440A040E9A4740F5958540869D5EC092200E0C219A4740336009448B9D5EC08F4B10AE709A474031121E67969D5EC07716D377169B4740AAB0A9A89A9D5EC0D861F7A4609B474075F4B2D79F9D5EC0BE0A4CA7AE9B4740ECE4E95CA39D5EC07F1B4791E29B47400D63F692A79D5EC0CF31973A2A9C4740E4559987A89D5EC0F7E8E2A6419C474012C8A4DAA89D5EC067F5C19F5A9C47403DAD89F1A89D5EC09DA70D596A9C4740C48ED58AA89D5EC0CD8CB6888A9C474050B435C0A79D5EC033905E0AFE9C474097FB187BA79D5EC0E21EE7C00F9D474065CC1C08A79D5EC010E993451B9D47409438AE59A69D5EC0428C24E9249D4740643C6D05A59D5EC049A05D332F9D4740A015EE43A39D5EC078BF2FCC379D4740AEFF067AA19D5EC05CEB2B993E9D474069086F119F9D5EC0602CAC93479D47404148BCB19C9D5EC09892C3D84E9D47406AF5F75F9A9D5EC048F3547C559D4740A5CAE280979D5EC024559BCB5A9D474047A21D95949D5EC0E2865C01619D474083968705909D5EC03A555FB8679D4740942BB774859D5EC0FC88EE8E759D4740F008E3887E9D5EC0505A72127D9D4740FDA64E76749D5EC06BF44E69859D474059ABDB29699D5EC082BFA1A28B9D47405E7D9D72599D5EC0BDA92E02929D474038A4130C4A9D5EC0965CA3F7939D474093975F383E9D5EC05978E8ED929D4740247D9E85DB9C5EC09A850C787C9D4740838DCD7CBD9C5EC05AFEADBA779D47407C1E05659C9C5EC0440FC9EE789D47400819E9BE839C5EC09E7B37CE7D9D4740AF16DC10719C5EC0FB164874849D474041C279825C9C5EC05ECA80248D9D4740917B30A1379C5EC0338B90C7A29D474040550AA6FE9B5EC07FA94580C49D474035B39C42EA9B5EC010938C3FCF9D47404FC7E5F4D79B5EC0C9028BE4D49D4740AE6FBA94C89B5EC0E03F4448D89D4740C75CB76EC79B5EC04793CE75C49D47407C8AEB41C79B5EC041CC7213B79D4740298EA537C79B5EC0D141A08D769D4740555E5CB6C79B5EC0C59B03C7329D4740CFC94E9DC79B5EC0E8ED9913C39C4740D52671E7C69B5EC0E2A1B1BEBF9B4740ACA08662C69B5EC0389382BB889A4740FEB9E26BC69B5EC0A8CF5F837D994740DFDE2E70C69B5EC0ADFD4C8F289947401F30F26DC79B5EC0DB666C798E984740D01154FB279B5EC0E171FF2B8F984740830DC19C159B5EC0D155A7148F98474018E0E52EF19A5EC0B55EC6038D984740E6CA8212EE9A5EC012D5698788984740	City of Tacoma Open Data — Neighborhood Council Districts	https://hub.arcgis.com/datasets/tacoma::neighborhood-council-districts-tacoma-1/about	\N	2026-05-27 04:27:10.453788+00	2026-05-27 04:27:10.453788+00
7df56d24-5b3c-4c74-9ed2-45515dc63f0b	6d08439f-6aac-4bd2-bbba-99566b214b69	Eastside	eastside	0106000020E610000001000000010300000001000000700000006B36828993995EC06E42FBF6C69E4740E4CCB68D8D995EC0B6582029C49E47405A2A858584995EC0A48885EDBF9E47409621A49D7C995EC053C64668BA9E4740704CEF6376995EC0B9B3650FB69E4740933AD55B6E995EC0A5322F73B09E4740FF374A7766995EC041631E95A79E4740A4F0028D61995EC0562B0F13A29E4740113FE3275F995EC089BFF9639F9E474046CA0D0F5D995EC06514600A9D9E4740A75C79EF5A995EC087F636559A9E4740905C5B6458995EC00549D8F0969E474027EEEB4354995EC0FDEB5569919E4740548C041F51995EC0CA5C67328D9E4740C51EFFDE49995EC0530D308B839E4740980CEF2742995EC062BE8352799E4740EF4D5F633E995EC0A0C09654749E4740DF65A8AA3B995EC0819785B9709E474083248F953B995EC0A214BD3B249E4740336CCCA23B995EC067DFFA9FB79D4740D70AD1A33B995EC0DC30C8D8AD9D474047A63C033C995EC004EEE3D67B9D4740CB7CDE903C995EC04FD350A2359D474089365BC73C995EC0C8A14EADBE9C47405483F45C3D995EC01DA443F4459C4740AB53A42F3E995EC013A6D309CF9B4740B9D99B9A3F995EC04E27CE13579B47404F6341133F995EC0178E5627DF9A47406C5E49843E995EC0820EA1DF679A474005BE493B40995EC0FAE713DCEF994740A46256023D995EC07F4F503F76994740EF955DBB3D995EC0DC1620D901994740230BBC9C3E995EC0CDF444338B98474056E9FC9C3E995EC076F1E0CD889847401363436E59995EC02945D09E889847400E76777D6B995EC071D5B78C889847401A1D000896995EC0E610EB47889847408310E50497995EC07F895246889847404FE37C1AF8995EC04F8CF15F889847407611641CF8995EC0F78F323388984740D74A54DF029A5EC01AFB4E338898474033563CDE029A5EC031D31D7D879847404DE027280D9A5EC0BB2C1F80879847401BFE56270D9A5EC0928774DB87984740D5F22B94189A5EC09FBC0CDD879847409962C59B189A5EC00777EE134498474072A657A0439A5EC0A4FA93D243984740F27120F2449A5EC0DAF5FECD43984740040C54E6449A5EC057A73CAE529847408A70C322509A5EC04B2C77CA52984740CE6E09DA4F9A5EC0213D82D6879847409CC4F8A1629A5EC0F73D3CD987984740A8D23FA2629A5EC01F2C3EC287984740220B7FBE629A5EC015EA54C187984740F4AD10D7629A5EC0EA9D0F177B98474084CF00F1629A5EC0C77DCFB66D984740837C2EE66C9A5EC07BE2CEA46D984740561BA2CE6C9A5EC0DB5ABF0E7B9847405D1B75BA6C9A5EC050812C8C86984740ACD10AA16F9A5EC08BEEC68F8698474023C58E72709A5EC0F21F44C487984740DFF9DAB3789A5EC0790473C5879847407E78D9B3789A5EC0B2A772DC87984740AB19DD14879A5EC051C777DE87984740118A3B35889A5EC069C9AEDC87984740635A65AFB59A5EC09C262DE287984740B44BAF41B69A5EC0546DB9E487984740493EBC88D09A5EC0C886F1E7879847407C33C25AD49A5EC0F81661A3879847403CFE5FD0D49A5EC091B36D4488984740AC617BDADB9A5EC0C10E4145889847403B357ADADB9A5EC008B2405C889847405A56527ADF9A5EC0ED64AB5C88984740500C507ADF9A5EC0C499AC8A889847408DDA7C12EE9A5EC02F11508C88984740E6CA8212EE9A5EC012D569878898474018E0E52EF19A5EC0B55EC6038D984740830DC19C159B5EC0D155A7148F984740D01154FB279B5EC0E171FF2B8F9847401F30F26DC79B5EC0DB666C798E984740DFDE2E70C69B5EC0ADFD4C8F28994740FEB9E26BC69B5EC0A8CF5F837D994740ACA08662C69B5EC0389382BB889A4740D52671E7C69B5EC0E2A1B1BEBF9B4740CFC94E9DC79B5EC0E8ED9913C39C4740555E5CB6C79B5EC0C59B03C7329D4740298EA537C79B5EC0D141A08D769D47407C8AEB41C79B5EC041CC7213B79D4740C75CB76EC79B5EC04793CE75C49D4740AE6FBA94C89B5EC0E03F4448D89D474073E73CB9A29B5EC03FB34A1BE09D47400B1D3C3F969B5EC05135064FE39D4740E2B52A9B909B5EC06CBB4C1DE59D4740849BED33899B5EC0005EAAF7E79D47407BD109AE7D9B5EC0A84A4CD8EC9D47403451EC1F729B5EC030B1479CF39D47405B38151F699B5EC044E66536F99D47405978DA5D5C9B5EC08F1CBCFB029E474013890B20F19A5EC0F30FF0AE609E474060605126DD9A5EC0CD9A7E43709E474034042B89CE9A5EC0D4440F77799E4740B4C9EF96C19A5EC0B4AC4401809E47402980DF2AAA9A5EC08C3E3F57879E4740E129A00D469A5EC0967968E79B9E4740356D895FEA995EC0833D598AA89E4740FA0B115BDD995EC027CF1B20AB9E4740168CF4B3D0995EC0C5B2DDACAF9E47401216065CCA995EC035386DD9B29E4740D6D656C0BE995EC038C68582BA9E4740CEC9342DA0995EC0D685FF0ED39E4740AFFD327B93995EC053CE9FF4DC9E47406B36828993995EC06E42FBF6C69E4740	City of Tacoma Open Data — Neighborhood Council Districts	https://hub.arcgis.com/datasets/tacoma::neighborhood-council-districts-tacoma-1/about	\N	2026-05-27 04:27:10.454863+00	2026-05-27 04:27:10.454863+00
\.


--
-- Data for Name: offerings; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.offerings (id, happy_hour_id, kind, category, name, price_cents, original_price_cents, discount_cents, currency_code, description, conditions, location_restriction, source_url, active, created_at, updated_at, deleted_at) FROM stdin;
dedc5074-6c0b-4731-a63b-74f684ce3c97	300b2409-1a66-422b-a58b-cad8d650c436	drink	beer	All Draft Beers	600	\N	\N	\N	\N	\N	\N	https://www.wildfinamericangrill.com/s/Bar1025t.pdf	t	2026-05-28 02:48:13.283973+00	2026-05-28 02:48:13.283973+00	\N
622a9991-cb1f-4d86-8645-cc3df43784d9	300b2409-1a66-422b-a58b-cad8d650c436	drink	wine	WildFin Barrel Aged Red Blend, WildFin Oaked Chardonnay	800	\N	\N	\N	\N	\N	\N	https://www.wildfinamericangrill.com/s/Bar1025t.pdf	t	2026-05-28 02:48:13.285437+00	2026-05-28 02:48:13.285437+00	\N
8f338a79-1a35-40a0-b314-490453309b84	300b2409-1a66-422b-a58b-cad8d650c436	drink	cocktail	Huckleberry Collins, Scratch Margarita, Moscow Mule	900	\N	\N	\N	\N	\N	\N	https://www.wildfinamericangrill.com/s/Bar1025t.pdf	t	2026-05-28 02:48:13.286417+00	2026-05-28 02:48:13.286417+00	\N
8db2c5ca-8074-457a-af8a-2219fed358d0	300b2409-1a66-422b-a58b-cad8d650c436	food	appetizer	Happy Hour Appetizers	\N	\N	\N	\N	Selection includes Spicy Ahi Crispy Rice, Garlic Prawns, Simply the Best Calamari, Street Tacos, and Fish and Chips	\N	\N	https://www.wildfinamericangrill.com/s/Bar1025t.pdf	t	2026-05-28 02:48:13.287219+00	2026-05-28 02:48:13.287219+00	\N
4e25970a-81a0-4dd6-bbe9-930f150cf39d	8ce56e71-73a9-4fd5-8f23-4ffd7b52ad5e	drink	beer	All Draft Beers	600	\N	\N	\N	\N	\N	\N	https://www.wildfinamericangrill.com/s/Bar1025t.pdf	t	2026-05-28 02:48:13.289059+00	2026-05-28 02:48:13.289059+00	\N
c1b38677-ff6a-4978-b608-e2087fe23824	8ce56e71-73a9-4fd5-8f23-4ffd7b52ad5e	drink	wine	WildFin Barrel Aged Red Blend, WildFin Oaked Chardonnay	800	\N	\N	\N	\N	\N	\N	https://www.wildfinamericangrill.com/s/Bar1025t.pdf	t	2026-05-28 02:48:13.289794+00	2026-05-28 02:48:13.289794+00	\N
fbfed7f7-0258-498e-af69-4f18a5afd9ca	8ce56e71-73a9-4fd5-8f23-4ffd7b52ad5e	drink	cocktail	Huckleberry Collins, Scratch Margarita, Moscow Mule	900	\N	\N	\N	\N	\N	\N	https://www.wildfinamericangrill.com/s/Bar1025t.pdf	t	2026-05-28 02:48:13.290592+00	2026-05-28 02:48:13.290592+00	\N
c9711132-9a45-4305-bcdd-d4c08832f502	8ce56e71-73a9-4fd5-8f23-4ffd7b52ad5e	food	appetizer	Happy Hour Appetizers	\N	\N	\N	\N	Selection includes Spicy Ahi Crispy Rice, Garlic Prawns, Simply the Best Calamari, Street Tacos, and Fish and Chips	\N	\N	https://www.wildfinamericangrill.com/s/Bar1025t.pdf	t	2026-05-28 02:48:13.291284+00	2026-05-28 02:48:13.291284+00	\N
fbedbf44-9b4b-48a3-87ef-07a943d32912	8f37e3a8-0e67-4835-8b4d-9969dac03f47	drink	other	\N	\N	\N	\N	\N	Happy hour pricing on drinks	\N	\N	https://www.tacomacomedyclub.com/shows/359921	t	2026-05-28 02:54:34.143564+00	2026-05-28 02:54:34.143564+00	\N
ee0064dd-d08e-47ec-a8ba-d31f26c5c3c9	e636358c-bf9c-4dc5-bd1b-3138835110e5	drink	other	\N	\N	\N	\N	\N	Happy hour specials	\N	\N	https://www-tacomacomedyclub-com.seatengine.com/pages/specials-menu	t	2026-05-28 02:54:34.14638+00	2026-05-28 02:54:34.14638+00	\N
d0edb8b7-856f-45d5-9960-944325c15193	ec6de2e4-215b-43d8-9e49-33d907194669	food	appetizer	Romaine Salad, Crispy Brussels Sprouts, Refried Bean Dip	600	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.404671+00	2026-05-28 04:14:01.404671+00	\N
75f4f66b-3049-4d85-a678-d4aa1e63322e	ec6de2e4-215b-43d8-9e49-33d907194669	food	appetizer	Chicken Tortilla Soup	600	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.406392+00	2026-05-28 04:14:01.406392+00	\N
468c7432-b310-4a1c-9d72-d08e9a9317f6	ec6de2e4-215b-43d8-9e49-33d907194669	food	appetizer	Quesadilla (Cheese, Chicken, Carnitas, Chorizo, or Al Pastor)	600	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.407377+00	2026-05-28 04:14:01.407377+00	\N
c25f5faf-2765-4478-8359-a298e904c539	ec6de2e4-215b-43d8-9e49-33d907194669	food	appetizer	Habanero Prawns, Matador Guacamole, Steak/Shrimp Tacos (2), Baja Fish Tacos (2)	700	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.40824+00	2026-05-28 04:14:01.40824+00	\N
eb482d2b-989e-4263-9fa4-c7058379b74c	ec6de2e4-215b-43d8-9e49-33d907194669	food	appetizer	Bacon Wrapped Stuffed Jalapeños, Queso Con Chorizo, Grande Nachos, Street Tacos (3)	700	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.409209+00	2026-05-28 04:14:01.409209+00	\N
c5fd5f64-f4aa-4a52-bc75-2e3a8a7efd9d	ecb8448b-561d-47ca-8c83-dbfa06c099d0	food	appetizer	Romaine Salad, Crispy Brussels Sprouts, Refried Bean Dip	600	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.411273+00	2026-05-28 04:14:01.411273+00	\N
679f6e94-ae6b-4d11-8ee9-a29c72ee819e	ecb8448b-561d-47ca-8c83-dbfa06c099d0	food	appetizer	Chicken Tortilla Soup	600	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.41206+00	2026-05-28 04:14:01.41206+00	\N
3a2e801b-b9f5-4b67-8947-c89f90fb4f81	ecb8448b-561d-47ca-8c83-dbfa06c099d0	food	appetizer	Quesadilla (Cheese, Chicken, Carnitas, Chorizo, or Al Pastor)	600	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.412957+00	2026-05-28 04:14:01.412957+00	\N
d7d59749-744a-46b1-b472-9ee5773ba950	ecb8448b-561d-47ca-8c83-dbfa06c099d0	food	appetizer	Habanero Prawns, Matador Guacamole, Steak/Shrimp Tacos (2), Baja Fish Tacos (2)	700	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.413724+00	2026-05-28 04:14:01.413724+00	\N
ccd1fbe4-b48f-48f8-a04b-b5e56bf51899	ecb8448b-561d-47ca-8c83-dbfa06c099d0	food	appetizer	Bacon Wrapped Stuffed Jalapeños, Queso Con Chorizo, Grande Nachos, Street Tacos (3)	700	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.41454+00	2026-05-28 04:14:01.41454+00	\N
80ff338b-2045-48f3-88a5-995a36e5afe4	57ebfd13-08ea-44a4-996e-e8c2df0d4a4d	food	appetizer	Romaine Salad, Crispy Brussels Sprouts, Refried Bean Dip	600	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.417116+00	2026-05-28 04:14:01.417116+00	\N
c65c3b44-e42f-41d8-aae6-d725c0ab6f5c	57ebfd13-08ea-44a4-996e-e8c2df0d4a4d	food	appetizer	Chicken Tortilla Soup	600	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.418023+00	2026-05-28 04:14:01.418023+00	\N
4687e454-6247-4683-a7fb-d01c34ff5307	57ebfd13-08ea-44a4-996e-e8c2df0d4a4d	food	appetizer	Quesadilla (Cheese, Chicken, Carnitas, Chorizo, or Al Pastor)	600	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.418793+00	2026-05-28 04:14:01.418793+00	\N
0f2bda95-a64a-4a1e-b4e9-0f0515bc1ef4	57ebfd13-08ea-44a4-996e-e8c2df0d4a4d	food	appetizer	Habanero Prawns, Matador Guacamole, Steak/Shrimp Tacos (2), Baja Fish Tacos (2)	700	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.419575+00	2026-05-28 04:14:01.419575+00	\N
168dd915-487d-4ad2-b966-19cc9c413251	57ebfd13-08ea-44a4-996e-e8c2df0d4a4d	food	appetizer	Bacon Wrapped Stuffed Jalapeños, Queso Con Chorizo, Grande Nachos, Street Tacos (3)	700	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.420415+00	2026-05-28 04:14:01.420415+00	\N
7c74c632-19bb-4c72-bc7d-3904153ee22f	74a76af2-a984-4db8-964d-550a011c9f06	food	appetizer	Romaine Salad, Crispy Brussels Sprouts, Refried Bean Dip	600	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.422231+00	2026-05-28 04:14:01.422231+00	\N
9f2a7575-89a7-4b46-bf80-202d4c31208c	74a76af2-a984-4db8-964d-550a011c9f06	food	appetizer	Chicken Tortilla Soup	600	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.423108+00	2026-05-28 04:14:01.423108+00	\N
aed1008d-6201-47ee-b407-611868cf2ab6	74a76af2-a984-4db8-964d-550a011c9f06	food	appetizer	Quesadilla (Cheese, Chicken, Carnitas, Chorizo, or Al Pastor)	600	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.42394+00	2026-05-28 04:14:01.42394+00	\N
0c486104-9dbe-46fb-9550-187a637649b7	74a76af2-a984-4db8-964d-550a011c9f06	food	appetizer	Habanero Prawns, Matador Guacamole, Steak/Shrimp Tacos (2), Baja Fish Tacos (2)	700	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.424814+00	2026-05-28 04:14:01.424814+00	\N
917923a9-074e-4696-bb7f-b331937227e8	74a76af2-a984-4db8-964d-550a011c9f06	food	appetizer	Bacon Wrapped Stuffed Jalapeños, Queso Con Chorizo, Grande Nachos, Street Tacos (3)	700	\N	\N	\N	\N	\N	\N	https://www.matadorrestaurants.com/menus/tacoma/happy-hour	t	2026-05-28 04:14:01.425745+00	2026-05-28 04:14:01.425745+00	\N
2ff20979-7445-4c71-97f7-4432f4125739	ad52adbf-e61a-4b9e-9965-2dd8a64cd36d	drink	cocktail	Most cocktails	\N	\N	300	\N	$3 off cocktails including Inhouse Infusions, Must Have Mules, Marvelous Margs, Bourbon & Brown, Classic Cocktails, Lively Libations, Can't Miss Martinis	\N	\N	https://dukesseafood.com/menus/happy-hour-menu/	t	2026-05-28 04:14:19.260125+00	2026-05-28 04:14:19.260125+00	\N
3be4cfef-10d8-4945-b34c-dded338d9856	ad52adbf-e61a-4b9e-9965-2dd8a64cd36d	drink	wine	Sparkling wines & wine by the glass	\N	\N	\N	\N	$2-$3 off	\N	\N	https://dukesseafood.com/menus/happy-hour-menu/	t	2026-05-28 04:14:19.261039+00	2026-05-28 04:14:19.261039+00	\N
391d05b3-622f-4112-9af1-88e7a430f46b	ad52adbf-e61a-4b9e-9965-2dd8a64cd36d	food	appetizer	Most appetizers	\N	\N	\N	\N	$2-$3 off appetizers and shared plates including Clam Lover's Steamer Clams, Coco Loco Prawns, Dungeness Crab items, Calamari, Lobster Risotto Bites, Salmon Sliders, and more	\N	\N	https://dukesseafood.com/menus/happy-hour-menu/	t	2026-05-28 04:14:19.26208+00	2026-05-28 04:14:19.26208+00	\N
3a3307c7-af10-437d-8a1a-87cd4cc3fcb4	ad52adbf-e61a-4b9e-9965-2dd8a64cd36d	food	appetizer	Award Winning Clam Chowder	\N	\N	300	\N	$3 off	\N	\N	https://dukesseafood.com/menus/happy-hour-menu/	t	2026-05-28 04:14:19.263008+00	2026-05-28 04:14:19.263008+00	\N
a20e4da6-5849-4c08-b830-772be8705640	ad52adbf-e61a-4b9e-9965-2dd8a64cd36d	food	appetizer	All Hail Caesar Salad	\N	\N	300	\N	$3 off	\N	\N	https://dukesseafood.com/menus/happy-hour-menu/	t	2026-05-28 04:14:19.263944+00	2026-05-28 04:14:19.263944+00	\N
b2fd375d-9ead-46e5-b8ee-8a3816b3fea6	ad52adbf-e61a-4b9e-9965-2dd8a64cd36d	food	entree	Grass-fed burgers & sandwiches	\N	\N	500	\N	$5 off (North of California Burger, Duke Cheeseburger, Salmon Sandwich, Chicken Sandwich, Crab Cake Sandwich)	\N	\N	https://dukesseafood.com/menus/happy-hour-menu/	t	2026-05-28 04:14:19.265155+00	2026-05-28 04:14:19.265155+00	\N
1c1fb976-e193-43d5-98d7-b6c6a2da6e8a	1d7741a3-d4f2-4f4c-969f-a3717ed900fc	drink	cocktail	Most cocktails	\N	\N	300	\N	$3 off cocktails including Inhouse Infusions, Must Have Mules, Marvelous Margs, Bourbon & Brown, Classic Cocktails, Lively Libations, Can't Miss Martinis	\N	\N	https://dukesseafood.com/menus/happy-hour-menu/	t	2026-05-28 04:14:19.267225+00	2026-05-28 04:14:19.267225+00	\N
c776339f-c35b-4d89-a079-1d03b000002f	1d7741a3-d4f2-4f4c-969f-a3717ed900fc	drink	wine	Sparkling wines & wine by the glass	\N	\N	\N	\N	$2-$3 off	\N	\N	https://dukesseafood.com/menus/happy-hour-menu/	t	2026-05-28 04:14:19.268435+00	2026-05-28 04:14:19.268435+00	\N
4277ba26-d9b3-46e5-b0f3-58bb69f7e28d	1d7741a3-d4f2-4f4c-969f-a3717ed900fc	food	appetizer	Most appetizers	\N	\N	\N	\N	$2-$3 off appetizers and shared plates including Clam Lover's Steamer Clams, Coco Loco Prawns, Dungeness Crab items, Calamari, Lobster Risotto Bites, Salmon Sliders, and more	\N	\N	https://dukesseafood.com/menus/happy-hour-menu/	t	2026-05-28 04:14:19.269291+00	2026-05-28 04:14:19.269291+00	\N
4a222acd-e492-4ffa-92a7-aaa2252cceeb	1d7741a3-d4f2-4f4c-969f-a3717ed900fc	food	appetizer	Award Winning Clam Chowder	\N	\N	300	\N	$3 off	\N	\N	https://dukesseafood.com/menus/happy-hour-menu/	t	2026-05-28 04:14:19.270098+00	2026-05-28 04:14:19.270098+00	\N
fbe6e1c0-8581-44c4-8fc1-6168ec144b16	1d7741a3-d4f2-4f4c-969f-a3717ed900fc	food	appetizer	All Hail Caesar Salad	\N	\N	300	\N	$3 off	\N	\N	https://dukesseafood.com/menus/happy-hour-menu/	t	2026-05-28 04:14:19.270961+00	2026-05-28 04:14:19.270961+00	\N
54eec082-acf7-4d14-a22d-02c58f075e34	1d7741a3-d4f2-4f4c-969f-a3717ed900fc	food	entree	Grass-fed burgers & sandwiches	\N	\N	500	\N	$5 off (North of California Burger, Duke Cheeseburger, Salmon Sandwich, Chicken Sandwich, Crab Cake Sandwich)	\N	\N	https://dukesseafood.com/menus/happy-hour-menu/	t	2026-05-28 04:14:19.271642+00	2026-05-28 04:14:19.271642+00	\N
c5b77c15-cb0d-4fcd-8020-10fb32308d56	49889492-7652-46d5-b3b2-68763c1a74e3	drink	cocktail	Happy Hour Bloody Mary Oyster Shot	399	499	100	\N	\N	\N	\N	https://tidestavern.com/menu/	t	2026-05-28 04:16:51.569302+00	2026-05-28 04:16:51.569302+00	\N
0f6248d5-336a-4bd8-9d05-5b30283dc0c8	49889492-7652-46d5-b3b2-68763c1a74e3	food	appetizer	Happy Hour Pound of Fries	799	\N	\N	\N	\N	\N	\N	https://tidestavern.com/menu/	t	2026-05-28 04:16:51.570065+00	2026-05-28 04:16:51.570065+00	\N
d0205a83-2d79-4f97-b410-239b68206c00	49889492-7652-46d5-b3b2-68763c1a74e3	food	appetizer	Happy Hour Fried Pickles	799	\N	\N	\N	\N	\N	\N	https://tidestavern.com/menu/	t	2026-05-28 04:16:51.570811+00	2026-05-28 04:16:51.570811+00	\N
9d09c014-8862-46d8-8e0d-0b6f8202c9b1	49889492-7652-46d5-b3b2-68763c1a74e3	food	appetizer	Happy Hour Spam Musubi	599	\N	\N	\N	\N	\N	\N	https://tidestavern.com/menu/	t	2026-05-28 04:16:51.571558+00	2026-05-28 04:16:51.571558+00	\N
05cdeff5-753d-46ea-92c4-f48f24b1d064	49889492-7652-46d5-b3b2-68763c1a74e3	food	appetizer	Happy Hour Bay Shrimp Cocktail	599	\N	\N	\N	\N	\N	\N	https://tidestavern.com/menu/	t	2026-05-28 04:16:51.572391+00	2026-05-28 04:16:51.572391+00	\N
739a23db-0052-40bf-9541-d8f3dc47f34a	49889492-7652-46d5-b3b2-68763c1a74e3	food	entree	Happy Hour Cod and Chips	1199	\N	\N	\N	\N	\N	\N	https://tidestavern.com/menu/	t	2026-05-28 04:16:51.573158+00	2026-05-28 04:16:51.573158+00	\N
626d110d-d3ff-49a0-8d82-dd0c50f49e69	49889492-7652-46d5-b3b2-68763c1a74e3	food	entree	Happy Hour Halibut and Chips	1599	\N	\N	\N	\N	\N	\N	https://tidestavern.com/menu/	t	2026-05-28 04:16:51.573821+00	2026-05-28 04:16:51.573821+00	\N
38c77853-63f1-437b-8e20-3bc24757e783	49889492-7652-46d5-b3b2-68763c1a74e3	food	appetizer	Happy Hour Buffalo Chicken Wings	1399	\N	\N	\N	\N	\N	\N	https://tidestavern.com/menu/	t	2026-05-28 04:16:51.574512+00	2026-05-28 04:16:51.574512+00	\N
e630534e-d3ff-4346-8c77-2746a4912536	49889492-7652-46d5-b3b2-68763c1a74e3	food	appetizer	Happy Hour Nachos	1399	\N	\N	\N	\N	\N	\N	https://tidestavern.com/menu/	t	2026-05-28 04:16:51.575276+00	2026-05-28 04:16:51.575276+00	\N
37143d7c-f7b8-4942-a994-d22a7aa11424	49889492-7652-46d5-b3b2-68763c1a74e3	food	appetizer	Happy Hour Cup of Soup or Clam Chowder	699	\N	\N	\N	\N	\N	\N	https://tidestavern.com/menu/	t	2026-05-28 04:16:51.576075+00	2026-05-28 04:16:51.576075+00	\N
1544aa79-4d06-43a3-85f2-46ea8460d7ff	49889492-7652-46d5-b3b2-68763c1a74e3	food	entree	Happy Hour Steak Sliders	1999	\N	\N	\N	\N	\N	\N	https://tidestavern.com/menu/	t	2026-05-28 04:16:51.576801+00	2026-05-28 04:16:51.576801+00	\N
fad7756a-65ad-4b62-95e1-432d383843b0	14f9e403-f461-4c1e-89e4-5a95770d1e40	drink	cocktail	House Margaritas	\N	\N	100	\N	Discount available on house margaritas	\N	\N	https://www.moctezumas.com/room/tacoma	t	2026-05-28 04:19:40.990821+00	2026-05-28 04:19:40.990821+00	\N
e596cc3e-75af-49f9-955a-5ad806f9843c	14f9e403-f461-4c1e-89e4-5a95770d1e40	food	appetizer	Happy Hour Appetizers	\N	\N	\N	\N	Food and drink specials available during happy hour	\N	\N	https://www.moctezumas.com/room/tacoma	t	2026-05-28 04:19:40.991947+00	2026-05-28 04:19:40.991947+00	\N
0c238938-963f-4e17-bd21-35e779166e4a	0c387fb8-bcc8-4c11-ab1e-45672a05f71b	drink	cocktail	House Margaritas	\N	\N	100	\N	Discount available on house margaritas	\N	\N	https://www.moctezumas.com/room/tacoma	t	2026-05-28 04:19:40.99357+00	2026-05-28 04:19:40.99357+00	\N
d9ee57c2-9ed9-4c48-a643-7c3323cddcbe	0c387fb8-bcc8-4c11-ab1e-45672a05f71b	food	appetizer	Happy Hour Appetizers	\N	\N	\N	\N	Food and drink specials available during happy hour	\N	\N	https://www.moctezumas.com/room/tacoma	t	2026-05-28 04:19:40.994292+00	2026-05-28 04:19:40.994292+00	\N
25b1af8b-7e10-488a-94bf-8541378f7a69	0aae1d5c-0965-4f4b-81fd-e4afe6488663	drink	other	Included beverages	\N	\N	\N	\N	Soda included with AYCE	\N	\N	https://wooblingtacoma.com/faq	t	2026-05-28 04:31:16.856914+00	2026-05-28 04:31:16.856914+00	\N
7bb51d9c-b0e1-4f43-8a5b-55663add9e9f	0aae1d5c-0965-4f4b-81fd-e4afe6488663	food	other	Limited AYCE menu	1999	\N	\N	\N	All-you-can-eat Korean BBQ with limited meat and side selections at happy hour price	\N	\N	https://www.postcard.inc/places/woobling-korean-bbq-tacoma-mall-tacoma-G_msqDOHXlO	t	2026-05-28 04:31:16.857716+00	2026-05-28 04:31:16.857716+00	\N
c93f6358-5527-4933-b464-ed26cef9c89d	ae0c73c4-92b2-4b17-9993-d71438caa956	drink	other	Included beverages	\N	\N	\N	\N	Soda included with AYCE	\N	\N	https://wooblingtacoma.com/faq	t	2026-05-28 04:31:16.859238+00	2026-05-28 04:31:16.859238+00	\N
d4ac5ec9-14c4-4d49-8490-63e7bad9cf37	ae0c73c4-92b2-4b17-9993-d71438caa956	food	other	Limited AYCE menu	1999	\N	\N	\N	All-you-can-eat Korean BBQ at late-night happy hour pricing	\N	\N	https://www.tiktok.com/discover/woobling-korean-bbq-bellevue	t	2026-05-28 04:31:16.859942+00	2026-05-28 04:31:16.859942+00	\N
0412600a-3ef6-4043-810e-2f3653be424f	43179db7-8e90-435a-9177-e3a0a7d56474	drink	beer	Draft Beer	750	\N	100	\N	$1 off draft beers	\N	\N	https://www.ivars.com/acres-menus	t	2026-05-28 04:38:54.907399+00	2026-05-28 04:38:54.907399+00	\N
958fc920-c156-4632-9094-3e15f8e5fa7d	43179db7-8e90-435a-9177-e3a0a7d56474	drink	spirit	Well Drinks	\N	\N	100	\N	$1 off well drinks	\N	\N	https://www.ivars.com/acres-menus	t	2026-05-28 04:38:54.908403+00	2026-05-28 04:38:54.908403+00	\N
6c57556b-49ca-42ef-97d8-4297d0680ad4	43179db7-8e90-435a-9177-e3a0a7d56474	drink	cocktail	Specialty Cocktails	\N	\N	200	\N	$2 off specialty cocktails	\N	\N	https://www.ivars.com/acres-menus	t	2026-05-28 04:38:54.909169+00	2026-05-28 04:38:54.909169+00	\N
91ab9295-f06f-4ae5-a9d2-1534da104460	43179db7-8e90-435a-9177-e3a0a7d56474	drink	wine	Wine by the Glass	\N	\N	200	\N	$2 off wine by-the-glass	\N	\N	https://www.ivars.com/acres-menus	t	2026-05-28 04:38:54.909939+00	2026-05-28 04:38:54.909939+00	\N
5dfea4bf-8b41-4ff1-871f-546dda863eea	43179db7-8e90-435a-9177-e3a0a7d56474	food	appetizer	Oyster Shooters	250	\N	\N	\N	Fresh	\N	\N	https://www.ivars.com/acres-menus	t	2026-05-28 04:38:54.911506+00	2026-05-28 04:38:54.911506+00	\N
2a076068-e0b2-4372-a0c4-070c8a57543e	43179db7-8e90-435a-9177-e3a0a7d56474	food	appetizer	Prawn Shooters	200	\N	\N	\N	Fresh	\N	\N	https://www.ivars.com/acres-menus	t	2026-05-28 04:38:54.912413+00	2026-05-28 04:38:54.912413+00	\N
39fc59d8-1651-4a23-97b6-4d2f00fa6475	43179db7-8e90-435a-9177-e3a0a7d56474	food	appetizer	Cod Tacos	750	\N	\N	\N	Baja-Style or Pan-Seared	\N	\N	https://www.ivars.com/acres-menus	t	2026-05-28 04:38:54.913229+00	2026-05-28 04:38:54.913229+00	\N
92aaf7af-f0ec-44d7-811b-9535586b3c3c	43179db7-8e90-435a-9177-e3a0a7d56474	food	appetizer	Most appetizers and salads	\N	\N	\N	\N	$6-$15, including Basket Chips, Clam Chowder Bowl, Caesar Salad, Wedge Salad, Pretzel Bites, Fried Brussels Sprouts, Crispy Calamari, Fresh Sautéed Manila Clams, Popcorn Shrimp & Fries, Coconut Crusted Shrimp	\N	\N	https://www.ivars.com/acres-menus	t	2026-05-28 04:38:54.914381+00	2026-05-28 04:38:54.914381+00	\N
d902686b-0035-45c7-87a4-1e725a022329	43179db7-8e90-435a-9177-e3a0a7d56474	food	entree	Most entrees and sandwiches	\N	\N	\N	\N	$15-$17, including Cheeseburger, French Dip Sandwich, Original Recipe Fish 'n Chips, Grilled Columbia River Steelhead BLT	\N	\N	https://www.ivars.com/acres-menus	t	2026-05-28 04:38:54.917856+00	2026-05-28 04:38:54.917856+00	\N
d32ae78d-c0a6-447a-98a7-1bd5e36745f9	9537b830-2a91-4adf-af42-88c1d49b0a67	drink	cocktail	Cooper's Mai Tai	1000	\N	\N	\N	\N	\N	\N	https://coopersfoodanddrink.com/	t	2026-05-28 04:42:28.275475+00	2026-05-28 04:42:28.275475+00	\N
5a1b20c8-befd-4854-b98f-cd5c8be3267f	9537b830-2a91-4adf-af42-88c1d49b0a67	drink	spirit	Well Spirits	575	\N	\N	\N	\N	excludes fresh squeezed orange and grapefruit juice mixer	\N	https://coopersfoodanddrink.com/	t	2026-05-28 04:42:28.276216+00	2026-05-28 04:42:28.276216+00	\N
093c218c-e980-4b88-b076-d4b1c235da8f	9537b830-2a91-4adf-af42-88c1d49b0a67	drink	beer	16 oz Draft Beer	\N	\N	100	\N	\N	excludes Coors Light and seasonal cider	\N	https://coopersfoodanddrink.com/	t	2026-05-28 04:42:28.276879+00	2026-05-28 04:42:28.276879+00	\N
f2bf69c1-d08c-4bcf-8844-6dd8a778f0d5	9537b830-2a91-4adf-af42-88c1d49b0a67	drink	wine	House Wine	\N	\N	100	\N	\N	excludes seasonal cider	\N	https://coopersfoodanddrink.com/	t	2026-05-28 04:42:28.277603+00	2026-05-28 04:42:28.277603+00	\N
b3af16ba-493a-4eb5-b21f-5f3fe25e3ebe	9537b830-2a91-4adf-af42-88c1d49b0a67	food	other	Flatbreads	1300	\N	\N	\N	\N	\N	\N	https://coopersfoodanddrink.com/	t	2026-05-28 04:42:28.278299+00	2026-05-28 04:42:28.278299+00	\N
b8c9dca0-9d9a-4729-9317-e3310beeb758	9537b830-2a91-4adf-af42-88c1d49b0a67	food	entree	Classic Burger	1200	\N	\N	\N	\N	\N	\N	https://coopersfoodanddrink.com/	t	2026-05-28 04:42:28.278985+00	2026-05-28 04:42:28.278985+00	\N
d712e5f4-701e-4fba-af1f-2937d8fe4c1a	9537b830-2a91-4adf-af42-88c1d49b0a67	food	appetizer	Appetizers	\N	\N	200	\N	\N	excludes charcuterie plate, sliders, and wings	\N	https://coopersfoodanddrink.com/	t	2026-05-28 04:42:28.279654+00	2026-05-28 04:42:28.279654+00	\N
4dd4dc6e-12c0-4d48-aa57-34f2225d7645	794876c9-922d-49ed-bf37-502133abb49a	drink	cocktail	Cooper's Mai Tai	1000	\N	\N	\N	\N	\N	\N	https://coopersfoodanddrink.com/	t	2026-05-28 04:42:28.281178+00	2026-05-28 04:42:28.281178+00	\N
d285bbfa-ad05-4d70-817a-d4cc15c593d5	794876c9-922d-49ed-bf37-502133abb49a	drink	spirit	Well Spirits	575	\N	\N	\N	\N	excludes fresh squeezed orange and grapefruit juice mixer	\N	https://coopersfoodanddrink.com/	t	2026-05-28 04:42:28.281959+00	2026-05-28 04:42:28.281959+00	\N
e016125d-c197-414f-bb50-ad3bcdf47522	794876c9-922d-49ed-bf37-502133abb49a	drink	beer	16 oz Draft Beer	\N	\N	100	\N	\N	excludes Coors Light and seasonal cider	\N	https://coopersfoodanddrink.com/	t	2026-05-28 04:42:28.282759+00	2026-05-28 04:42:28.282759+00	\N
faddf211-fe31-4804-8be9-f36d64097e33	794876c9-922d-49ed-bf37-502133abb49a	drink	wine	House Wine	\N	\N	100	\N	\N	excludes seasonal cider	\N	https://coopersfoodanddrink.com/	t	2026-05-28 04:42:28.283447+00	2026-05-28 04:42:28.283447+00	\N
7d7658c3-69c5-4f2c-9223-cdce2019dc70	3f31db00-ef6f-4f23-b487-942d1d5065f7	drink	cocktail	Drink specials	\N	\N	\N	\N	Various drink specials available	\N	\N	https://www.tiktok.com/discover/mandolin-restaurant-tacoma	t	2026-05-28 04:48:48.76685+00	2026-05-28 04:48:48.76685+00	\N
2812031d-a34b-444b-84ea-3ae73090f674	3f31db00-ef6f-4f23-b487-942d1d5065f7	food	other	Sushi rolls	\N	\N	\N	\N	All rolls 2 for $22 or 3 for $33	\N	\N	https://www.tiktok.com/discover/mandolin-restaurant-tacoma	t	2026-05-28 04:48:48.767614+00	2026-05-28 04:48:48.767614+00	\N
898faa97-fd78-4885-9d33-4b5000102f58	2d44f4e3-7509-4e1e-a55c-80915f6812b0	drink	wine	Wine	\N	\N	100	\N	$1 off wine	\N	\N	https://cloverleafpizza.com/promotions/	t	2026-05-28 04:52:01.890027+00	2026-05-28 04:52:01.890027+00	\N
b291d247-bad4-4494-ac34-6bf6c1a04ebd	2d44f4e3-7509-4e1e-a55c-80915f6812b0	drink	beer	Micro/Import beers	\N	\N	100	\N	$1 off micro/import beers	\N	\N	https://cloverleafpizza.com/promotions/	t	2026-05-28 04:52:01.890785+00	2026-05-28 04:52:01.890785+00	\N
0c5e0f11-47e4-4339-8a3e-078bf6b32597	2d44f4e3-7509-4e1e-a55c-80915f6812b0	food	appetizer	Appetizers	\N	\N	100	\N	$1 off appetizers	\N	\N	https://cloverleafpizza.com/promotions/	t	2026-05-28 04:52:01.891428+00	2026-05-28 04:52:01.891428+00	\N
aae836a7-039c-451a-b7d9-bac0e4f5e3ac	743999b1-cea3-49af-a9e6-17e293d2dc0f	drink	beer	All draft beer	\N	\N	100	\N	$1 off all draft beer	\N	\N	https://www.foodyas.com/US/Tacoma/101817201495282/Tacoma-Pie	t	2026-05-28 04:57:31.127391+00	2026-05-28 04:57:31.127391+00	\N
2c6b0b40-3702-434b-b446-d20fb04c017e	743999b1-cea3-49af-a9e6-17e293d2dc0f	drink	beer	PBR tall cans	300	\N	\N	\N	$3 tall cans	\N	\N	https://www.foodyas.com/US/Tacoma/101817201495282/Tacoma-Pie	t	2026-05-28 04:57:31.128311+00	2026-05-28 04:57:31.128311+00	\N
cf6348d3-f0f3-49c4-b49e-543b6eaaeba2	743999b1-cea3-49af-a9e6-17e293d2dc0f	drink	wine	All wine	\N	\N	200	\N	$2 off all wine	\N	\N	https://www.foodyas.com/US/Tacoma/101817201495282/Tacoma-Pie	t	2026-05-28 04:57:31.129014+00	2026-05-28 04:57:31.129014+00	\N
59f53566-bb51-4162-9469-d3aa6c80d1fc	743999b1-cea3-49af-a9e6-17e293d2dc0f	drink	cocktail	Margaritas	700	\N	\N	\N	$7 margaritas	\N	\N	https://www.foodyas.com/US/Tacoma/101817201495282/Tacoma-Pie	t	2026-05-28 04:57:31.129759+00	2026-05-28 04:57:31.129759+00	\N
45eb7c1a-c50e-4fd9-94bc-b5c0d08d71e1	743999b1-cea3-49af-a9e6-17e293d2dc0f	food	appetizer	Cheese or pepperoni slice	500	\N	\N	\N	$5 CHZ or RONI slice	\N	\N	https://www.foodyas.com/US/Tacoma/101817201495282/Tacoma-Pie	t	2026-05-28 04:57:31.130509+00	2026-05-28 04:57:31.130509+00	\N
109a9dd2-130b-4920-b5c7-dbd49feb0491	743999b1-cea3-49af-a9e6-17e293d2dc0f	food	appetizer	Veggie or combo slice	600	\N	\N	\N	$6 veggie or combo slice	\N	\N	https://www.foodyas.com/US/Tacoma/101817201495282/Tacoma-Pie	t	2026-05-28 04:57:31.131253+00	2026-05-28 04:57:31.131253+00	\N
126a8e8b-0ec8-4768-aa7f-b64fc12b025b	743999b1-cea3-49af-a9e6-17e293d2dc0f	drink	beer	Canned ciders	\N	\N	100	\N	$1 off all canned ciders	\N	\N	https://www.foodyas.com/US/Tacoma/101817201495282/Tacoma-Pie	t	2026-05-28 04:57:31.132013+00	2026-05-28 04:57:31.132013+00	\N
c03fdc57-affc-4637-b154-f17c239cdeed	b1095783-22bd-47ee-8527-e7e2c0c799c7	drink	cocktail	Happy hour specials	\N	\N	\N	\N	\N	\N	\N	https://viptaxi.com/arizona-happy-hour-specials/	t	2026-05-28 04:57:34.109524+00	2026-05-28 04:57:34.109524+00	\N
cc9b0004-5954-4f39-ba35-dccf107c4b1b	3da700a6-ff68-4353-abdd-995418618e5c	drink	spirit	Well Drinks	500	\N	\N	\N	\N	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.67079+00	2026-05-28 05:05:06.67079+00	\N
35a95e5e-b1ca-41e7-8048-cad7e1a3e703	3da700a6-ff68-4353-abdd-995418618e5c	drink	beer	Draft Beers	\N	\N	200	\N	$2 off draft beers	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.67151+00	2026-05-28 05:05:06.67151+00	\N
d8bb078c-bfac-4ddc-86ff-69ba2e225d41	3da700a6-ff68-4353-abdd-995418618e5c	drink	wine	Wine	500	\N	\N	\N	\N	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.672168+00	2026-05-28 05:05:06.672168+00	\N
d3df3a8c-7ef1-45b8-873c-ba8d7fad8acc	3da700a6-ff68-4353-abdd-995418618e5c	drink	cocktail	Clarakaze	800	\N	\N	\N	\N	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.672857+00	2026-05-28 05:05:06.672857+00	\N
e7dba47d-69e7-4c74-af60-5ea3c57fab7d	3da700a6-ff68-4353-abdd-995418618e5c	drink	cocktail	Scratch Margarita	800	\N	\N	\N	\N	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.673528+00	2026-05-28 05:05:06.673528+00	\N
696b9e2e-7781-43b2-90f8-c07eb8ed6a67	3da700a6-ff68-4353-abdd-995418618e5c	drink	cocktail	Washington Apple	800	\N	\N	\N	\N	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.674164+00	2026-05-28 05:05:06.674164+00	\N
be0d8fe4-9ed3-42b6-a691-0942ee7bbb5d	3da700a6-ff68-4353-abdd-995418618e5c	drink	cocktail	Make It Blue Son!	800	\N	\N	\N	\N	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.674803+00	2026-05-28 05:05:06.674803+00	\N
9b69c485-f162-4182-9526-3fa5fed9c715	3da700a6-ff68-4353-abdd-995418618e5c	drink	beer	Rainier Tallboy + Well Shot	800	\N	\N	\N	\N	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.675453+00	2026-05-28 05:05:06.675453+00	\N
9245a932-0b47-4a04-a784-768519fb6a8b	3da700a6-ff68-4353-abdd-995418618e5c	food	appetizer	Mozzarella Sticks	600	\N	\N	\N	Half-order served with house-made marinara sauce	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.676062+00	2026-05-28 05:05:06.676062+00	\N
823e5224-b4ea-43a8-9d32-dcfa948bacfc	3da700a6-ff68-4353-abdd-995418618e5c	food	appetizer	Fried Brussels	800	\N	\N	\N	Deep fried Brussels sprouts tossed in bacon bits and sweet Thai chili sauce	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.676681+00	2026-05-28 05:05:06.676681+00	\N
acf81ba4-8128-4658-9218-4840870c2e16	3da700a6-ff68-4353-abdd-995418618e5c	food	appetizer	Cheese Cubes	1000	\N	\N	\N	Sharp cheddar cheese cubes, breaded and fried, then drizzled with hot honey. Served with ranch or marinara	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.677324+00	2026-05-28 05:05:06.677324+00	\N
14474403-5f0b-4ea5-abbc-91b0f602f2e9	3da700a6-ff68-4353-abdd-995418618e5c	food	appetizer	Fried Pickles	600	\N	\N	\N	Half-order served with choice of ranch or spicy ranch	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.677942+00	2026-05-28 05:05:06.677942+00	\N
d019bcb7-6703-4f12-b634-f8344e12bcfe	3da700a6-ff68-4353-abdd-995418618e5c	food	appetizer	Pork Belly Bites	900	\N	\N	\N	Bite-sized pieces of crispy fried pork belly tossed in your choice of sweet Thai chili or maple syrup	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.678559+00	2026-05-28 05:05:06.678559+00	\N
71ee8241-b542-4b90-926b-36c60e56494b	3da700a6-ff68-4353-abdd-995418618e5c	food	appetizer	Half Garden Salad	700	\N	\N	\N	\N	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.679247+00	2026-05-28 05:05:06.679247+00	\N
8b609d02-2553-4ab6-bbd1-207688708301	3da700a6-ff68-4353-abdd-995418618e5c	food	appetizer	Fry Basket	400	\N	\N	\N	\N	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.679917+00	2026-05-28 05:05:06.679917+00	\N
230b796b-d91e-49f9-ab12-012f5fe7294c	3da700a6-ff68-4353-abdd-995418618e5c	food	appetizer	All Beef Hot Dog	600	\N	\N	\N	Grilled all beef hot dog on a toasted bun served with your choice of ketchup, mustard, relish, mayo	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.680575+00	2026-05-28 05:05:06.680575+00	\N
c59cd94d-df6d-4209-a8ef-67403e4306bf	3da700a6-ff68-4353-abdd-995418618e5c	food	appetizer	Bacon Egg and Cheese Biscuit	500	\N	\N	\N	\N	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.68122+00	2026-05-28 05:05:06.68122+00	\N
0c25bb37-9d34-44bb-8e62-51df16be9a78	3da700a6-ff68-4353-abdd-995418618e5c	food	appetizer	Toasted PB&J	600	\N	\N	\N	\N	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.68204+00	2026-05-28 05:05:06.68204+00	\N
70248099-e723-4ebf-bd84-c76bf5ddd32c	3da700a6-ff68-4353-abdd-995418618e5c	food	appetizer	Side Door Sliders	1000	\N	\N	\N	2 per order served on Martin's potato rolls - includes Turkey Swiss and Pesto, Cheeseburger, Pulled Pork, or Meatball	\N	\N	https://www.hobnobtacoma.com/s/NEW-HOB-NOB-MENU-2026.pdf	t	2026-05-28 05:05:06.682704+00	2026-05-28 05:05:06.682704+00	\N
6634f645-7c22-449e-b20c-f5c17483fdfb	2e645268-6c5c-4f09-b73d-60dede2eb389	drink	spirit	Well Drinks	\N	\N	\N	\N	Happy hour drink specials available	\N	\N	https://www.steelcreekcountry.com/	t	2026-05-28 05:06:20.731532+00	2026-05-28 05:06:20.731532+00	\N
e0c3d051-d938-4163-abd7-c759a5e4674c	2e645268-6c5c-4f09-b73d-60dede2eb389	food	appetizer	Appetizers	\N	\N	\N	\N	Happy hour appetizer specials	\N	\N	https://www.steelcreekcountry.com/	t	2026-05-28 05:06:20.732477+00	2026-05-28 05:06:20.732477+00	\N
548a0833-29c1-4ee4-9c8d-07b681638bfc	e2630f01-6d8f-4b6b-a3e6-da6ed0d189f1	food	appetizer	Wings	100	\N	\N	\N	$1 Wings	\N	\N	https://www.steelcreekcountry.com/	t	2026-05-28 05:06:20.734046+00	2026-05-28 05:06:20.734046+00	\N
b3de17c3-271e-4f62-84d2-5b77b02baf68	e2630f01-6d8f-4b6b-a3e6-da6ed0d189f1	drink	spirit	Whiskey	\N	\N	\N	\N	½ off all whiskey	\N	\N	https://www.steelcreekcountry.com/	t	2026-05-28 05:06:20.734768+00	2026-05-28 05:06:20.734768+00	\N
889b336d-386c-4d1e-beb8-63858da47837	e67415ce-0955-426f-81bc-266f833d7191	drink	spirit	Well Drinks	200	\N	\N	\N	$2 Well Drinks	\N	\N	https://www.steelcreekcountry.com/	t	2026-05-28 05:06:20.736107+00	2026-05-28 05:06:20.736107+00	\N
d876a0bb-95a4-40bf-86ea-b9fd99db525d	c336b0e9-cf9f-474a-beba-90defd3a4eb7	drink	beer	Draft Beer	700	\N	\N	\N	\N	\N	\N	https://www.thekoisushi.com/s/KOITHAPPYHOUR6725.pdf	t	2026-05-28 05:08:42.755872+00	2026-05-28 05:08:42.755872+00	\N
f1097d6c-2ee3-462d-b47c-b84c53164dbc	c336b0e9-cf9f-474a-beba-90defd3a4eb7	drink	cocktail	Moscow Mule	1000	\N	\N	\N	\N	\N	\N	https://www.thekoisushi.com/s/KOITHAPPYHOUR6725.pdf	t	2026-05-28 05:08:42.756709+00	2026-05-28 05:08:42.756709+00	\N
62ab143b-11cb-4679-9dd6-339946521fae	c336b0e9-cf9f-474a-beba-90defd3a4eb7	drink	cocktail	Mt. Fuji Breeze	1200	\N	\N	\N	\N	\N	\N	https://www.thekoisushi.com/s/KOITHAPPYHOUR6725.pdf	t	2026-05-28 05:08:42.757428+00	2026-05-28 05:08:42.757428+00	\N
a2389839-c82d-4181-a851-504c0ce424d1	c336b0e9-cf9f-474a-beba-90defd3a4eb7	drink	cocktail	Old Fashioned	1100	\N	\N	\N	\N	\N	\N	https://www.thekoisushi.com/s/KOITHAPPYHOUR6725.pdf	t	2026-05-28 05:08:42.758104+00	2026-05-28 05:08:42.758104+00	\N
f5216188-1a1e-4ca2-ad0c-070303fdd0f8	c336b0e9-cf9f-474a-beba-90defd3a4eb7	drink	spirit	Sake Bomb	600	\N	\N	\N	\N	\N	\N	https://www.thekoisushi.com/s/KOITHAPPYHOUR6725.pdf	t	2026-05-28 05:08:42.758827+00	2026-05-28 05:08:42.758827+00	\N
a9074eeb-8950-445f-ab0a-807b7bcf238a	c336b0e9-cf9f-474a-beba-90defd3a4eb7	drink	spirit	House Sake	1000	\N	\N	\N	\N	\N	\N	https://www.thekoisushi.com/s/KOITHAPPYHOUR6725.pdf	t	2026-05-28 05:08:42.759504+00	2026-05-28 05:08:42.759504+00	\N
05588b17-7d99-400b-b183-2cdb9a5a375a	c336b0e9-cf9f-474a-beba-90defd3a4eb7	drink	wine	House Pinot Grigio or House Cabernet Sauvignon	800	\N	\N	\N	\N	\N	\N	https://www.thekoisushi.com/s/KOITHAPPYHOUR6725.pdf	t	2026-05-28 05:08:42.760164+00	2026-05-28 05:08:42.760164+00	\N
82b2a4ef-4212-4e45-808f-5c7b9d5159c3	c336b0e9-cf9f-474a-beba-90defd3a4eb7	food	appetizer	Various appetizers and rolls	\N	\N	\N	\N	California Roll $10, Edamame $7, Spicy Tuna Tacos $13, Takoyaki $8, Agedashi Tofu $7, Shishito Peppers $10, Chicken Karaage $11, Vegetable Tempura $11, Fried Brussel Sprouts $8, Sexy Edamame $8, Gyoza $9	\N	\N	https://www.thekoisushi.com/s/KOITHAPPYHOUR6725.pdf	t	2026-05-28 05:08:42.760911+00	2026-05-28 05:08:42.760911+00	\N
3df786f8-2257-41d8-8e98-fc11f52b3b14	c336b0e9-cf9f-474a-beba-90defd3a4eb7	food	entree	Sushi and rolls	\N	\N	\N	\N	Nigiri Set $20, Sushi Set 1 $21, Sushi Set 2 $27, Shrimp Tempura Roll $12, Spicy Tuna Roll $12, Las Vegas Roll $15, Philadelphia Roll $13, Spider Roll $15, Bad Boy $16, Heaven of Tuna $17	\N	\N	https://www.thekoisushi.com/s/KOITHAPPYHOUR6725.pdf	t	2026-05-28 05:08:42.761741+00	2026-05-28 05:08:42.761741+00	\N
3a603dca-24a4-4ac5-926d-215e45408184	39bdabae-30c5-49e4-b403-4ffe33930481	drink	other	\N	\N	\N	\N	\N	Special deals on drinks during happy hour	\N	\N	https://www.pacificseafood.com/contact-us/retail-locations/tacoma-fish-peddler/	t	2026-05-28 05:10:20.831214+00	2026-05-28 05:10:20.831214+00	\N
54acc885-f6d3-4d32-9630-0fa13fe5fb3d	39bdabae-30c5-49e4-b403-4ffe33930481	food	appetizer	\N	\N	\N	\N	\N	Special deals on select seafood items	\N	\N	https://www.pacificseafood.com/contact-us/retail-locations/tacoma-fish-peddler/	t	2026-05-28 05:10:20.832017+00	2026-05-28 05:10:20.832017+00	\N
4faa4796-0ad6-42c9-b8bb-db3530779f86	44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	food	appetizer	Fried Brussels Sprouts	700	\N	\N	\N	Maple soy glaze, bacon	\N	\N	https://www.stanleyandseaforts.com/menus/	t	2026-05-28 05:12:02.244475+00	2026-05-28 05:12:02.244475+00	\N
63bbfaef-43c6-4221-85da-6fa0a78c8463	44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	food	appetizer	Gorgonzola Fries	700	\N	\N	\N	Creamy Gorgonzola sauce, Gorgonzola crumbles, cracked black pepper	\N	\N	https://www.stanleyandseaforts.com/menus/	t	2026-05-28 05:12:02.245771+00	2026-05-28 05:12:02.245771+00	\N
21502af3-8a23-4d92-9f33-ac32b1435fb1	44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	food	appetizer	Crab & Artichoke Tots	700	\N	\N	\N	Spicy chili aioli, micro greens	\N	\N	https://www.stanleyandseaforts.com/menus/	t	2026-05-28 05:12:02.246516+00	2026-05-28 05:12:02.246516+00	\N
8a9bbbfe-1b04-4da0-b7f2-a7722c7483ac	44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	food	appetizer	Coconut Shrimp	900	\N	\N	\N	Cajun marmalade, green onion, crispy noodles	\N	\N	https://www.stanleyandseaforts.com/menus/	t	2026-05-28 05:12:02.247267+00	2026-05-28 05:12:02.247267+00	\N
3510f928-4cb1-4083-9f77-93decce11267	44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	food	appetizer	Crispy Fried Calamari	900	\N	\N	\N	Artichoke hearts, mustard-garlic aioli, Bloody Mary Cocktail sauce	\N	\N	https://www.stanleyandseaforts.com/menus/	t	2026-05-28 05:12:02.247991+00	2026-05-28 05:12:02.247991+00	\N
a33af224-d22b-47cd-b8a2-e4fcfe5a808c	44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	food	appetizer	Crab Stuffed Grilled Jalapeños	900	\N	\N	\N	Parmesan cheese, bacon, touch of spice	\N	\N	https://www.stanleyandseaforts.com/menus/	t	2026-05-28 05:12:02.248713+00	2026-05-28 05:12:02.248713+00	\N
acca3f9d-43dd-4db7-bb75-e339df3c1e1c	44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	food	appetizer	Hot Crab and Artichoke Dip	1100	\N	\N	\N	Sweet onion, Parmesan, toasted baguette	\N	\N	https://www.stanleyandseaforts.com/menus/	t	2026-05-28 05:12:02.249398+00	2026-05-28 05:12:02.249398+00	\N
e1507776-e00e-4238-9a78-50c758a3510e	44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	drink	beer	Draft Beer - Domestic	500	\N	\N	\N	Coors Light	\N	\N	https://www.stanleyandseaforts.com/menus/	t	2026-05-28 05:12:02.250049+00	2026-05-28 05:12:02.250049+00	\N
b7f3f37a-dd7f-4488-8d54-9ba0825e5e22	44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	drink	beer	Draft Beer - Craft	550	\N	\N	\N	Blue Moon, Fremont Lush IPA, Mac & Jack's Amber, and others	\N	\N	https://www.stanleyandseaforts.com/menus/	t	2026-05-28 05:12:02.250705+00	2026-05-28 05:12:02.250705+00	\N
0a8be0b6-c57d-43b8-890c-11f0ab5a5576	44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	drink	beer	Draft Beer - Premium	675	\N	\N	\N	Elysian Space Dust IPA	\N	\N	https://www.stanleyandseaforts.com/menus/	t	2026-05-28 05:12:02.251337+00	2026-05-28 05:12:02.251337+00	\N
001e226c-403f-40d0-ace1-40656f69e9b8	44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	drink	cocktail	Craft Cocktails	900	\N	\N	\N	Exotic Mojito, Amalfi Stroll, Lime Mule, and others	\N	\N	https://www.stanleyandseaforts.com/menus/	t	2026-05-28 05:12:02.25196+00	2026-05-28 05:12:02.25196+00	\N
332146fe-baed-459a-9a4f-abfa7d757c7f	44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	drink	cocktail	Premium Craft Cocktails	1100	\N	\N	\N	Botanical Berry Mule, Spicy Prickly Pear Margarita, and others	\N	\N	https://www.stanleyandseaforts.com/menus/	t	2026-05-28 05:12:02.252645+00	2026-05-28 05:12:02.252645+00	\N
fa226f6d-3aef-4d9b-98ac-f6cb1f795739	44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	drink	spirit	Premium Spirits	800	\N	\N	\N	New Amsterdam Vodka, New Amsterdam Gin, Don Q Rum, and others	\N	\N	https://www.stanleyandseaforts.com/menus/	t	2026-05-28 05:12:02.25331+00	2026-05-28 05:12:02.25331+00	\N
a90e1095-c75e-4c19-bda7-d7c7a25ea72f	44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	drink	wine	Wine Selection	800	\N	\N	\N	Charles Smith Chardonnay, Zenato Pinot Grigio, and others	\N	\N	https://www.stanleyandseaforts.com/menus/	t	2026-05-28 05:12:02.253982+00	2026-05-28 05:12:02.253982+00	\N
49db0f29-255c-4381-9981-149d7732bf11	44233e38-0be2-4aa0-ba70-22cc5b7ab4eb	drink	wine	Premium Wine Selection	1000	\N	\N	\N	La Luca Prosecco, Villa Maria Sauvignon Blanc, and others	\N	\N	https://www.stanleyandseaforts.com/menus/	t	2026-05-28 05:12:02.254621+00	2026-05-28 05:12:02.254621+00	\N
0a49fb4b-e256-47cf-93ca-47035c3184f3	ceb5db49-2ad0-48f5-804d-4fc4a7cc9661	drink	cocktail	House Margarita	900	\N	\N	\N	\N	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.62154+00	2026-05-28 05:14:11.62154+00	\N
2400e862-4e4a-4d5f-90a2-e0d0f8687783	ceb5db49-2ad0-48f5-804d-4fc4a7cc9661	drink	cocktail	Slushie Margarita	900	\N	\N	\N	flavors: lime, mango, peach, strawberry, raspberry, pomegranate, hibiscus, or passion fruit guava	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.622335+00	2026-05-28 05:14:11.622335+00	\N
8e6837ef-7a42-49e4-9b9a-53650955f5a6	ceb5db49-2ad0-48f5-804d-4fc4a7cc9661	drink	cocktail	Corona-Rita	900	\N	\N	\N	\N	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.623085+00	2026-05-28 05:14:11.623085+00	\N
e196c0f3-e6ea-4994-aa81-7726504c476c	ceb5db49-2ad0-48f5-804d-4fc4a7cc9661	drink	cocktail	Little Devil	500	\N	\N	\N	\N	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.623867+00	2026-05-28 05:14:11.623867+00	\N
76c98595-5077-43c0-94b9-b79baa34deeb	ceb5db49-2ad0-48f5-804d-4fc4a7cc9661	drink	beer	Tecate	400	\N	\N	\N	\N	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.624641+00	2026-05-28 05:14:11.624641+00	\N
cb259d9e-bc72-4ee1-b706-e8cc5f4b7114	ceb5db49-2ad0-48f5-804d-4fc4a7cc9661	drink	beer	Drafts, Wells & Wine	\N	\N	100	\N	$1 off	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.625345+00	2026-05-28 05:14:11.625345+00	\N
55a948b5-3b39-47d8-8c9c-67a68f6d5439	ceb5db49-2ad0-48f5-804d-4fc4a7cc9661	food	appetizer	Chips & Guac & Salsa	900	\N	\N	\N	\N	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.626085+00	2026-05-28 05:14:11.626085+00	\N
d9e44b6a-4fee-4274-8da4-b5e6e0cf074b	ceb5db49-2ad0-48f5-804d-4fc4a7cc9661	food	appetizer	Half Size Nachos	1000	\N	\N	\N	add Sweet Potato Black Bean for $4, add Tequila Chicken/Carne Asada/Carnitas for $5	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.62686+00	2026-05-28 05:14:11.62686+00	\N
bc477717-82d1-4e84-9b1e-b4d14188e52b	ceb5db49-2ad0-48f5-804d-4fc4a7cc9661	food	appetizer	Your Mom's Taco	400	\N	\N	\N	Classic American hardshell with ground beef, cheese, lettuce, pico, black olives, crema	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.627673+00	2026-05-28 05:14:11.627673+00	\N
8a6f612f-5094-4f79-8cf0-b6bfe1d696ef	ceb5db49-2ad0-48f5-804d-4fc4a7cc9661	food	appetizer	Your Dad's Taco	400	\N	\N	\N	A flour tortilla smeared with refried beans and wrapped around your mom's taco	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.62837+00	2026-05-28 05:14:11.62837+00	\N
98ce6d73-5aa4-41e3-b2ce-9f583277795a	79bc4f2b-5dd3-4bd5-a0d5-90c404a8c38d	food	appetizer	Caesar Salad	1300	\N	\N	\N	\N	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.449973+00	2026-05-28 05:24:25.449973+00	\N
83b8f855-ae46-4277-9c69-2a27c7958a02	ceb5db49-2ad0-48f5-804d-4fc4a7cc9661	food	appetizer	Any Two Tacos	800	\N	\N	\N	Tequila Chicken, Carnitas, Buffalo Chicken, Chorizo, Sweet Potato Black Bean, Tofu, Bang Bang Cauliflower	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.629041+00	2026-05-28 05:14:11.629041+00	\N
a9d21436-ea2b-45b6-b058-b5ae34d19dca	331c35ff-70c0-45a1-8e63-57c5c11dcb4a	drink	cocktail	House Margarita	900	\N	\N	\N	\N	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.630779+00	2026-05-28 05:14:11.630779+00	\N
6b3db120-df35-453d-a75d-d323d8f07e8c	331c35ff-70c0-45a1-8e63-57c5c11dcb4a	drink	cocktail	Slushie Margarita	900	\N	\N	\N	flavors: lime, mango, peach, strawberry, raspberry, pomegranate, hibiscus, or passion fruit guava	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.631545+00	2026-05-28 05:14:11.631545+00	\N
f488278b-1bc6-40f1-acaf-63be7c7d93c5	331c35ff-70c0-45a1-8e63-57c5c11dcb4a	drink	cocktail	Corona-Rita	900	\N	\N	\N	\N	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.632238+00	2026-05-28 05:14:11.632238+00	\N
f8ad5687-90c4-43d4-ab2e-398ed3e731f7	331c35ff-70c0-45a1-8e63-57c5c11dcb4a	drink	cocktail	Little Devil	500	\N	\N	\N	\N	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.632939+00	2026-05-28 05:14:11.632939+00	\N
c02308b4-fe2c-46ff-a9db-21fba9ab539a	331c35ff-70c0-45a1-8e63-57c5c11dcb4a	drink	beer	Tecate	400	\N	\N	\N	\N	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.633627+00	2026-05-28 05:14:11.633627+00	\N
55497a70-c8c2-417e-a72b-6d491a0b5002	331c35ff-70c0-45a1-8e63-57c5c11dcb4a	drink	beer	Drafts, Wells & Wine	\N	\N	100	\N	$1 off	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.634388+00	2026-05-28 05:14:11.634388+00	\N
1cbd4c34-c4b0-4e2b-9275-c2ffeed5b4ad	331c35ff-70c0-45a1-8e63-57c5c11dcb4a	food	appetizer	Chips & Guac & Salsa	900	\N	\N	\N	\N	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.63511+00	2026-05-28 05:14:11.63511+00	\N
2bb7da66-e63d-40e2-8ceb-1e08210b739f	331c35ff-70c0-45a1-8e63-57c5c11dcb4a	food	appetizer	Half Size Nachos	1000	\N	\N	\N	add Sweet Potato Black Bean for $4, add Tequila Chicken/Carne Asada/Carnitas for $5	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.635916+00	2026-05-28 05:14:11.635916+00	\N
a1766d49-0a00-46a5-980c-ba3c83751d7f	331c35ff-70c0-45a1-8e63-57c5c11dcb4a	food	appetizer	Your Mom's Taco	400	\N	\N	\N	Classic American hardshell with ground beef, cheese, lettuce, pico, black olives, crema	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.63659+00	2026-05-28 05:14:11.63659+00	\N
4252316b-f000-4d87-a04c-1b51c1fbd202	331c35ff-70c0-45a1-8e63-57c5c11dcb4a	food	appetizer	Your Dad's Taco	400	\N	\N	\N	A flour tortilla smeared with refried beans and wrapped around your mom's taco	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.637302+00	2026-05-28 05:14:11.637302+00	\N
fb8e7473-9214-4948-826d-a219a3f3c721	331c35ff-70c0-45a1-8e63-57c5c11dcb4a	food	appetizer	Any Two Tacos	800	\N	\N	\N	Tequila Chicken, Carnitas, Buffalo Chicken, Chorizo, Sweet Potato Black Bean, Tofu, Bang Bang Cauliflower	\N	\N	https://www.redstartacobar.com/_files/ugd/04ef85_71db8d8b5bbf4b3bbb6c095018cfd625.pdf	t	2026-05-28 05:14:11.638004+00	2026-05-28 05:14:11.638004+00	\N
653f7733-39b2-4887-9b5f-015e137ebf58	661c734c-6f0a-4db7-90a6-a790a74422c6	drink	cocktail	Moscow Mule	1000	\N	\N	\N	\N	\N	\N	https://www.lobstershop.com/wp-content/uploads/Spring-Bar-HH-Menu-4-7.pdf	t	2026-05-28 05:23:46.354577+00	2026-05-28 05:23:46.354577+00	\N
d1470a6f-9463-4d84-b550-b306bf52b51f	661c734c-6f0a-4db7-90a6-a790a74422c6	drink	cocktail	Martini	1000	\N	\N	\N	\N	\N	\N	https://www.lobstershop.com/wp-content/uploads/Spring-Bar-HH-Menu-4-7.pdf	t	2026-05-28 05:23:46.355411+00	2026-05-28 05:23:46.355411+00	\N
1590685e-a6ec-40b1-9223-2f589f55b092	661c734c-6f0a-4db7-90a6-a790a74422c6	drink	cocktail	Apple Blossom	1000	\N	\N	\N	\N	\N	\N	https://www.lobstershop.com/wp-content/uploads/Spring-Bar-HH-Menu-4-7.pdf	t	2026-05-28 05:23:46.356806+00	2026-05-28 05:23:46.356806+00	\N
88522a76-e4a4-44a9-ba30-ebfbcd6231ec	661c734c-6f0a-4db7-90a6-a790a74422c6	drink	cocktail	Margarita	1000	\N	\N	\N	\N	\N	\N	https://www.lobstershop.com/wp-content/uploads/Spring-Bar-HH-Menu-4-7.pdf	t	2026-05-28 05:23:46.357892+00	2026-05-28 05:23:46.357892+00	\N
88ae374c-c44a-460a-a20a-f4dc1ecc26e5	661c734c-6f0a-4db7-90a6-a790a74422c6	drink	cocktail	Manhattan	1000	\N	\N	\N	\N	\N	\N	https://www.lobstershop.com/wp-content/uploads/Spring-Bar-HH-Menu-4-7.pdf	t	2026-05-28 05:23:46.358692+00	2026-05-28 05:23:46.358692+00	\N
78b7ed3f-2526-4cec-a180-01b72229755c	661c734c-6f0a-4db7-90a6-a790a74422c6	drink	wine	Wine by the Glass	900	\N	\N	\N	Vega Medien Brut Cava, Man Family Wines Chenin Blanc, Marqués de Cáceres Garnacha Blend	\N	\N	https://www.lobstershop.com/wp-content/uploads/Spring-Bar-HH-Menu-4-7.pdf	t	2026-05-28 05:23:46.359402+00	2026-05-28 05:23:46.359402+00	\N
4a5b2fe6-7292-4acc-9d3e-51cae5bc33df	661c734c-6f0a-4db7-90a6-a790a74422c6	drink	beer	Draft Beer	700	\N	\N	\N	7 Seas Brewing Heidelberg Lager, Georgetown Bodhizafa IPA	\N	\N	https://www.lobstershop.com/wp-content/uploads/Spring-Bar-HH-Menu-4-7.pdf	t	2026-05-28 05:23:46.36007+00	2026-05-28 05:23:46.36007+00	\N
96da295d-3e43-40e2-8f7b-ca1b471d70e1	661c734c-6f0a-4db7-90a6-a790a74422c6	drink	other	Progressive Oyster Happy Hour	250	\N	\N	\N	Chef's selection, champagne mignonette, cocktail sauce, lemon. At 3:00pm oysters are $2.50 each, then every hour the price increases by $0.50	\N	\N	https://www.lobstershop.com/wp-content/uploads/Spring-Bar-HH-Menu-4-7.pdf	t	2026-05-28 05:23:46.360776+00	2026-05-28 05:23:46.360776+00	\N
e55e12fb-f4d5-4551-84ba-a25ec1f8474c	661c734c-6f0a-4db7-90a6-a790a74422c6	food	appetizer	Shoestring Fries	500	\N	\N	\N	\N	\N	\N	https://www.lobstershop.com/wp-content/uploads/Spring-Bar-HH-Menu-4-7.pdf	t	2026-05-28 05:23:46.361471+00	2026-05-28 05:23:46.361471+00	\N
313afb9d-ee03-458e-a864-b736cd714019	661c734c-6f0a-4db7-90a6-a790a74422c6	food	appetizer	Bar Snacks	\N	\N	\N	\N	Calamari ($9), Sweet & Spicy Shrimp ($9), Hearts of Palm Cakes ($9), Wagyu Beef Skewers ($12), Mini Lobster Roll ($15), Clams ($15)	\N	\N	https://www.lobstershop.com/wp-content/uploads/Spring-Bar-HH-Menu-4-7.pdf	t	2026-05-28 05:23:46.362163+00	2026-05-28 05:23:46.362163+00	\N
2459e898-3aa7-4c5a-8514-0ad804ad7efd	811f9829-e8c2-4cc9-b6f5-2feeb021d3ff	drink	cocktail	Cocktails	1100	\N	\N	\N	Sicily Lemonata, Falling For The Cosmos, Ruston 76, Margarita	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.439313+00	2026-05-28 05:24:25.439313+00	\N
77b9dc17-968d-484e-afa0-cf54fbf49bd1	811f9829-e8c2-4cc9-b6f5-2feeb021d3ff	drink	beer	Draft Beer	800	\N	\N	\N	\N	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.440166+00	2026-05-28 05:24:25.440166+00	\N
229e3383-9c38-4d17-ab73-c2c6b79316e1	811f9829-e8c2-4cc9-b6f5-2feeb021d3ff	drink	wine	House Wine	1000	\N	\N	\N	red, white, prosecco	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.44087+00	2026-05-28 05:24:25.44087+00	\N
c132caef-e959-4f11-b5c2-8e9ebcdfab4f	811f9829-e8c2-4cc9-b6f5-2feeb021d3ff	food	appetizer	Whipped Labneh	1300	\N	\N	\N	\N	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.441578+00	2026-05-28 05:24:25.441578+00	\N
304bfd40-2591-45b3-acdf-556ca743d31a	811f9829-e8c2-4cc9-b6f5-2feeb021d3ff	food	appetizer	Meatballs	1500	\N	\N	\N	\N	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.442311+00	2026-05-28 05:24:25.442311+00	\N
134ece23-9fc1-453b-bf95-baaf8b8a08ab	811f9829-e8c2-4cc9-b6f5-2feeb021d3ff	food	appetizer	Caesar Salad	1300	\N	\N	\N	\N	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.44311+00	2026-05-28 05:24:25.44311+00	\N
482cecbf-378f-4a36-9eb1-85d00623b67b	811f9829-e8c2-4cc9-b6f5-2feeb021d3ff	food	entree	Heirloom BLT	1700	\N	\N	\N	\N	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.443908+00	2026-05-28 05:24:25.443908+00	\N
8de6ecc1-9d9b-4efe-83cd-18d895ea3e0c	811f9829-e8c2-4cc9-b6f5-2feeb021d3ff	food	entree	Classic Burger	2100	\N	\N	\N	\N	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.444705+00	2026-05-28 05:24:25.444705+00	\N
3be48cd7-438b-49b0-ade7-55ef7139e4b0	79bc4f2b-5dd3-4bd5-a0d5-90c404a8c38d	drink	cocktail	Cocktails	1100	\N	\N	\N	Sicily Lemonata, Falling For The Cosmos, Ruston 76, Margarita	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.446313+00	2026-05-28 05:24:25.446313+00	\N
df3f6fc4-bd8f-42b5-a859-788118bf017a	79bc4f2b-5dd3-4bd5-a0d5-90c404a8c38d	drink	beer	Draft Beer	800	\N	\N	\N	\N	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.447024+00	2026-05-28 05:24:25.447024+00	\N
cbd217b8-418f-42d5-9b10-9453ff998b4e	79bc4f2b-5dd3-4bd5-a0d5-90c404a8c38d	drink	wine	House Wine	1000	\N	\N	\N	red, white, prosecco	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.447779+00	2026-05-28 05:24:25.447779+00	\N
b2a48d8f-dc5c-43a6-b371-a16162968187	79bc4f2b-5dd3-4bd5-a0d5-90c404a8c38d	food	appetizer	Whipped Labneh	1300	\N	\N	\N	\N	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.448474+00	2026-05-28 05:24:25.448474+00	\N
6b4d41b8-8fbd-4f46-bca2-35c8d8d32b1a	79bc4f2b-5dd3-4bd5-a0d5-90c404a8c38d	food	appetizer	Meatballs	1500	\N	\N	\N	\N	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.449248+00	2026-05-28 05:24:25.449248+00	\N
7766427d-84bb-44eb-a991-3cc9d05228d3	79bc4f2b-5dd3-4bd5-a0d5-90c404a8c38d	food	entree	Heirloom BLT	1700	\N	\N	\N	\N	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.450719+00	2026-05-28 05:24:25.450719+00	\N
d6aa1416-fd01-4350-9efd-fff7c236a036	79bc4f2b-5dd3-4bd5-a0d5-90c404a8c38d	food	entree	Classic Burger	2100	\N	\N	\N	\N	\N	\N	https://www.copperandsaltnw.com/pdf/copper-and-salt-menu-happy-hour.pdf?may2026	t	2026-05-28 05:24:25.451457+00	2026-05-28 05:24:25.451457+00	\N
c296d734-5174-44b9-a5db-052ed5205ade	2f84a5d1-35f4-468d-9f7f-35ac0ea8e15d	drink	cocktail	Classic Margarita	\N	\N	\N	\N	Pueblo Viejo Blanco Tequila, organic agave nectar, fresh-squeezed lime juice	\N	\N	https://www.cactusrestaurants.com/menus/happy-hour	t	2026-05-28 05:25:34.298619+00	2026-05-28 05:25:34.298619+00	\N
69c4ac66-c3f7-45e7-a666-89d7b6cc5a53	2f84a5d1-35f4-468d-9f7f-35ac0ea8e15d	food	appetizer	Guacamole with Green Chile Queso	\N	\N	\N	\N	Traditional guacamole smothered in green-chile queso, topped with pico de gallo, served with warm chips and Cactus salsa	\N	\N	https://www.cactusrestaurants.com/menus/happy-hour	t	2026-05-28 05:25:34.299602+00	2026-05-28 05:25:34.299602+00	\N
c0e41d58-d655-4a01-aef7-30cf40e512db	2f84a5d1-35f4-468d-9f7f-35ac0ea8e15d	food	appetizer	Bacon Guacamole	\N	\N	\N	\N	Cactus guacamole with smoked bacon, poblano chiles, charred tomato salsa, topped with cotija cheese, served with warm chips and Cactus salsa	\N	\N	https://www.cactusrestaurants.com/menus/happy-hour	t	2026-05-28 05:25:34.300349+00	2026-05-28 05:25:34.300349+00	\N
d79b767a-92bc-4965-bca2-5c46d777583f	2f84a5d1-35f4-468d-9f7f-35ac0ea8e15d	food	appetizer	Diablo Shrimp	\N	\N	\N	\N	Crispy prawns, spicy diablo sauce, coriander-pasilla slaw, mango–pineapple mojo	\N	\N	https://www.cactusrestaurants.com/menus/happy-hour	t	2026-05-28 05:25:34.301055+00	2026-05-28 05:25:34.301055+00	\N
2d1ec983-7958-4107-96cd-533d13bdfc84	2f84a5d1-35f4-468d-9f7f-35ac0ea8e15d	food	appetizer	Green Chile Cheese Dip	\N	\N	\N	\N	Green chile cheese dip, housemade chorizo, red onion, cilantro, tortilla chips	\N	\N	https://www.cactusrestaurants.com/menus/happy-hour	t	2026-05-28 05:25:34.301771+00	2026-05-28 05:25:34.301771+00	\N
cb18c51f-3de1-4f6f-af4a-11f5eaba9b4f	2f84a5d1-35f4-468d-9f7f-35ac0ea8e15d	food	appetizer	Loaded Nachos	\N	\N	\N	\N	Monterey Jack cheese, roasted corn, black olives, jalapeños, pico de gallo, charred tomato salsa, buttermilk crema, guacamole	\N	\N	https://www.cactusrestaurants.com/menus/happy-hour	t	2026-05-28 05:25:34.302434+00	2026-05-28 05:25:34.302434+00	\N
574e05c3-1319-45c6-9666-150c86b829f4	11ea0146-a82c-403c-93a8-0dd941118e76	drink	beer	Ram Beer (12oz)	400	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.870953+00	2026-05-28 05:35:08.870953+00	\N
af805fe2-b71f-4fb6-a363-1a9177e607b7	11ea0146-a82c-403c-93a8-0dd941118e76	drink	beer	Ram Beer (18oz)	600	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.871795+00	2026-05-28 05:35:08.871795+00	\N
ec4c42ae-e672-44b4-bf21-e94524454b85	11ea0146-a82c-403c-93a8-0dd941118e76	drink	spirit	Well Drinks	400	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.872497+00	2026-05-28 05:35:08.872497+00	\N
30e26937-4eb0-4a16-9cb1-1939c3405924	11ea0146-a82c-403c-93a8-0dd941118e76	drink	wine	House Wine (6oz)	600	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.873147+00	2026-05-28 05:35:08.873147+00	\N
42d21a25-38d9-4130-8e77-2f65c56f9bcf	11ea0146-a82c-403c-93a8-0dd941118e76	food	appetizer	Beer Crust Pizza Knots	400	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.873823+00	2026-05-28 05:35:08.873823+00	\N
f7e43ea4-d89f-4640-9ce2-9d1facfd945b	11ea0146-a82c-403c-93a8-0dd941118e76	food	appetizer	Half Order Mozzarella Sticks	400	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.874492+00	2026-05-28 05:35:08.874492+00	\N
e757a832-2495-482f-b61f-76c778a9f902	11ea0146-a82c-403c-93a8-0dd941118e76	food	entree	1/4 lb. Mulligan Burger	500	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.87519+00	2026-05-28 05:35:08.87519+00	\N
3bf68224-6dfd-4254-9658-d58b3eaf23ba	11ea0146-a82c-403c-93a8-0dd941118e76	food	appetizer	Half Order Boneless Wings	600	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.875868+00	2026-05-28 05:35:08.875868+00	\N
307c9732-c43c-4a7b-9f2b-3ffcd1871934	d2102c18-b0fb-4612-8d46-ccf5acbbb573	drink	beer	Ram Beer (12oz)	400	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.877313+00	2026-05-28 05:35:08.877313+00	\N
40c380c7-fa2c-4552-afdf-0ab56c2bb664	d2102c18-b0fb-4612-8d46-ccf5acbbb573	drink	beer	Ram Beer (18oz)	600	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.877952+00	2026-05-28 05:35:08.877952+00	\N
f6d5d2e2-be41-48ab-bd8b-6eb3ee054595	d2102c18-b0fb-4612-8d46-ccf5acbbb573	drink	spirit	Well Drinks	400	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.878637+00	2026-05-28 05:35:08.878637+00	\N
dfa8fe99-f954-4187-b792-16c8db204982	d2102c18-b0fb-4612-8d46-ccf5acbbb573	drink	wine	House Wine (6oz)	600	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.87932+00	2026-05-28 05:35:08.87932+00	\N
7401570e-a82f-4ed4-b497-a0bf605c00e5	d2102c18-b0fb-4612-8d46-ccf5acbbb573	food	appetizer	Beer Crust Pizza Knots	400	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.879998+00	2026-05-28 05:35:08.879998+00	\N
9c016a57-2a66-4ad2-82b1-babb0e0b4c31	d2102c18-b0fb-4612-8d46-ccf5acbbb573	food	appetizer	Half Order Mozzarella Sticks	400	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.880646+00	2026-05-28 05:35:08.880646+00	\N
8bb6bea9-4cca-4455-a59a-ba9d3991f063	d2102c18-b0fb-4612-8d46-ccf5acbbb573	food	entree	1/4 lb. Mulligan Burger	500	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.881413+00	2026-05-28 05:35:08.881413+00	\N
5f748d58-0840-4b4b-ae76-d0958d302b35	d2102c18-b0fb-4612-8d46-ccf5acbbb573	food	appetizer	Half Order Boneless Wings	600	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.882145+00	2026-05-28 05:35:08.882145+00	\N
0dbcc4fb-ce4e-4c54-aee9-89f16da3c1c7	c0eccd9f-dc10-4703-b598-7d869286c221	drink	beer	Ram Beer (12oz)	400	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.883745+00	2026-05-28 05:35:08.883745+00	\N
c9a34c04-6754-439a-96ab-61cdb57eeaeb	c0eccd9f-dc10-4703-b598-7d869286c221	drink	beer	Ram Beer (18oz)	600	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.884506+00	2026-05-28 05:35:08.884506+00	\N
0c1986f5-bd61-45a4-bd89-1ab1e9abc6c0	c0eccd9f-dc10-4703-b598-7d869286c221	drink	spirit	Well Drinks	400	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.885153+00	2026-05-28 05:35:08.885153+00	\N
e0f2863a-2e24-44d3-922b-1af26f5967e2	c0eccd9f-dc10-4703-b598-7d869286c221	drink	wine	House Wine (6oz)	600	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.885816+00	2026-05-28 05:35:08.885816+00	\N
10654c95-a864-4256-b55e-aeb605fe2dc0	c0eccd9f-dc10-4703-b598-7d869286c221	food	appetizer	Beer Crust Pizza Knots	400	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.886396+00	2026-05-28 05:35:08.886396+00	\N
8b76a969-b6ab-4dc8-9a1f-a598ada09a5d	c0eccd9f-dc10-4703-b598-7d869286c221	food	appetizer	Half Order Mozzarella Sticks	400	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.88707+00	2026-05-28 05:35:08.88707+00	\N
501000f9-7864-4bfd-bc09-50a69196a63f	c0eccd9f-dc10-4703-b598-7d869286c221	food	entree	1/4 lb. Mulligan Burger	500	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.887734+00	2026-05-28 05:35:08.887734+00	\N
289bc15b-7d1b-4e66-9b19-4001b90e8076	c0eccd9f-dc10-4703-b598-7d869286c221	food	appetizer	Half Order Boneless Wings	600	\N	\N	\N	\N	\N	\N	http://theram.com/check-out-our-all-new-happy-hour/	t	2026-05-28 05:35:08.888436+00	2026-05-28 05:35:08.888436+00	\N
a9713bfd-8ef9-4551-9e1b-98865e6dbfb3	137920fb-ae06-473b-8b59-d9186c60280c	food	appetizer	Most appetizers	\N	\N	\N	\N	Appetizers at half price	\N	\N	https://www.visitpiercecounty.com/listing/katie-downs-waterfront-tavern-+-eatery/60/	t	2026-05-28 05:38:52.505745+00	2026-05-28 05:38:52.505745+00	\N
1b760e22-d866-46e1-906b-ea1eb871eca3	2705b7a8-b307-4406-b49d-1017a7201e67	food	appetizer	Most appetizers	\N	\N	\N	\N	Appetizers at half price	\N	\N	https://www.visitpiercecounty.com/listing/katie-downs-waterfront-tavern-+-eatery/60/	t	2026-05-28 05:38:52.507521+00	2026-05-28 05:38:52.507521+00	\N
05fb927d-addd-4f9b-a887-db79e981cf89	7a54a0c4-b935-4f2e-b292-026d27e8583c	food	other	Breakfast items	915	\N	\N	\N	Eggs, scrambles, oats, and other breakfast items	\N	\N	https://img1.wsimg.com/blobby/go/a3685e18-30e3-44f2-aa9e-95ffd15c58f4/EB%20for%20Website.pdf	t	2026-05-28 05:41:04.592752+00	2026-05-28 05:41:04.592752+00	\N
46552856-f0ac-48d9-87be-44413bd3daf6	7a54a0c4-b935-4f2e-b292-026d27e8583c	drink	other	Cocktails and mixed drinks	800	\N	\N	\N	Bloody Marys, Granddad's Coffee, Spiked Apple Cider, Strawberries on Alder, Chipotle Mary	\N	\N	https://img1.wsimg.com/blobby/go/a3685e18-30e3-44f2-aa9e-95ffd15c58f4/EB%20for%20Website.pdf	t	2026-05-28 05:41:04.593701+00	2026-05-28 05:41:04.593701+00	\N
55c8f3f0-9a41-4365-a64f-ad3c83a8e2ed	a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	food	appetizer	Oyster Shooter	250	\N	\N	\N	\N	\N	\N	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	t	2026-05-28 05:42:52.899757+00	2026-05-28 05:42:52.899757+00	\N
de97012b-d9c8-409a-8984-9814d2a0f911	a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	food	appetizer	Fish & Chips	950	\N	\N	\N	\N	\N	\N	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	t	2026-05-28 05:42:52.900537+00	2026-05-28 05:42:52.900537+00	\N
78ae6cad-be97-4ffa-bbe1-7366c0a60580	a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	food	appetizer	Baja Chips & Salsa	700	\N	\N	\N	\N	\N	\N	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	t	2026-05-28 05:42:52.901284+00	2026-05-28 05:42:52.901284+00	\N
47dd6a73-0e83-4531-ac29-61f1f708ac59	a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	food	appetizer	Smoked Salmon Dip	1100	\N	\N	\N	\N	\N	\N	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	t	2026-05-28 05:42:52.902019+00	2026-05-28 05:42:52.902019+00	\N
9186cbcb-100d-4a53-a13d-c620534d4ce4	a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	food	appetizer	Popcorn Chicken	1100	\N	\N	\N	\N	\N	\N	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	t	2026-05-28 05:42:52.90278+00	2026-05-28 05:42:52.90278+00	\N
ad6678d4-785b-4042-aa4c-8ce8f47185c4	a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	food	appetizer	Caramelized Brie	1250	\N	\N	\N	\N	\N	\N	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	t	2026-05-28 05:42:52.903519+00	2026-05-28 05:42:52.903519+00	\N
25ca3048-9f10-490b-bda8-58dff294b341	a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	food	appetizer	Cheese Curds	950	\N	\N	\N	\N	\N	\N	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	t	2026-05-28 05:42:52.904191+00	2026-05-28 05:42:52.904191+00	\N
4f358f4e-3b29-412d-9d63-768485f35cf3	a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	food	appetizer	Clam Strips	1100	\N	\N	\N	\N	\N	\N	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	t	2026-05-28 05:42:52.904863+00	2026-05-28 05:42:52.904863+00	\N
3f362777-1520-4b30-81a3-764f5f6a7486	a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	food	appetizer	Crispy Calamari	1250	\N	\N	\N	\N	\N	\N	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	t	2026-05-28 05:42:52.905507+00	2026-05-28 05:42:52.905507+00	\N
306e8c50-07c0-441d-983c-b422a3c60f8a	a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	food	appetizer	N.W. Manila Clams	1500	\N	\N	\N	\N	\N	\N	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	t	2026-05-28 05:42:52.906179+00	2026-05-28 05:42:52.906179+00	\N
84b8ae83-fa23-4516-ab66-a983791add77	a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	food	appetizer	Mini Baked Crab, Shrimp & Artichoke Dip	1250	\N	\N	\N	\N	\N	\N	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	t	2026-05-28 05:42:52.906831+00	2026-05-28 05:42:52.906831+00	\N
f6925e6e-38ea-4e9f-9161-d5ae5c363005	a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	food	appetizer	Bar Burger & Fries	1000	\N	\N	\N	\N	\N	\N	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	t	2026-05-28 05:42:52.907523+00	2026-05-28 05:42:52.907523+00	\N
da610d8c-4291-4213-baaf-8b07cb9e929e	a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	food	appetizer	Classic Caesar	650	\N	\N	\N	\N	\N	\N	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	t	2026-05-28 05:42:52.908196+00	2026-05-28 05:42:52.908196+00	\N
4841ec8e-1f82-42a1-8b00-b86bbad5b54c	a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	food	appetizer	Chicken or Shrimp Caesar	1100	\N	\N	\N	\N	\N	\N	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	t	2026-05-28 05:42:52.908833+00	2026-05-28 05:42:52.908833+00	\N
c7416152-f750-43e6-90f4-425636db5531	a245a7bf-a3f0-4eaa-bd63-9b947eb143d8	food	appetizer	Oregon Coast Shrimp Cocktail	950	\N	\N	\N	\N	\N	\N	https://www.anthonys.com/wp-content/uploads/2026/05/HH_HL-4_30_26-.pdf	t	2026-05-28 05:42:52.909474+00	2026-05-28 05:42:52.909474+00	\N
d32816d8-d9b2-4b9c-827d-a683a2edfde1	2d54e31d-2115-4d03-803e-ea31d304c01b	drink	spirit	Any Moonshine Drink	700	\N	\N	\N	\N	\N	\N	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	t	2026-05-28 05:45:18.982219+00	2026-05-28 05:45:18.982219+00	\N
a783aed6-ae45-45be-8d3e-a08cdbf666d3	2d54e31d-2115-4d03-803e-ea31d304c01b	food	entree	Chicken and Waffles	\N	\N	\N	\N	10% off	\N	\N	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	t	2026-05-28 05:45:18.983061+00	2026-05-28 05:45:18.983061+00	\N
76b2276b-e19b-4bea-8961-f5e0bb83c22e	67248c9c-fd08-4292-a89c-688bdfad5a0e	drink	spirit	Tequila Drinks	500	\N	\N	\N	Well	\N	\N	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	t	2026-05-28 05:45:18.984608+00	2026-05-28 05:45:18.984608+00	\N
926f9daf-524b-4480-839d-1c594f8dbeea	67248c9c-fd08-4292-a89c-688bdfad5a0e	drink	spirit	Tequila Drinks	800	\N	\N	\N	Mid-shelf	\N	\N	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	t	2026-05-28 05:45:18.985274+00	2026-05-28 05:45:18.985274+00	\N
678e05b1-38cb-4ca4-9f4f-c0c7971eadf2	67248c9c-fd08-4292-a89c-688bdfad5a0e	food	entree	Tacos	\N	\N	\N	\N	10% off	\N	\N	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	t	2026-05-28 05:45:18.985967+00	2026-05-28 05:45:18.985967+00	\N
48c23a79-c1f0-4a00-acff-94c53fca7af3	19d08220-a38b-4203-9e0f-a730757a3763	drink	spirit	Whiskey Drinks	500	\N	\N	\N	Well	\N	\N	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	t	2026-05-28 05:45:18.987681+00	2026-05-28 05:45:18.987681+00	\N
6821a53d-38a8-4d44-ba4c-ef870188a3f1	19d08220-a38b-4203-9e0f-a730757a3763	drink	spirit	Whiskey Drinks	800	\N	\N	\N	Mid-shelf	\N	\N	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	t	2026-05-28 05:45:18.988557+00	2026-05-28 05:45:18.988557+00	\N
3e369db3-27cf-4873-96de-82b847b898e9	19d08220-a38b-4203-9e0f-a730757a3763	food	entree	Down and Dirty Burger	\N	\N	\N	\N	10% off	\N	\N	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	t	2026-05-28 05:45:18.989367+00	2026-05-28 05:45:18.989367+00	\N
c61afd3c-6ad7-4a1b-9187-263c40eef26b	e3c0107c-272c-49ce-83b0-7641d6a42498	drink	cocktail	Moscow Mules	500	\N	\N	\N	Well	\N	\N	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	t	2026-05-28 05:45:18.990917+00	2026-05-28 05:45:18.990917+00	\N
6f9570ca-1bea-4b7c-889b-95124918aa7b	e3c0107c-272c-49ce-83b0-7641d6a42498	drink	cocktail	Moscow Mules	800	\N	\N	\N	Mid-shelf	\N	\N	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	t	2026-05-28 05:45:18.99166+00	2026-05-28 05:45:18.99166+00	\N
8ca567ca-ffc0-451f-bd1a-c2c3a7167fa1	e3c0107c-272c-49ce-83b0-7641d6a42498	food	appetizer	Appetizers	\N	\N	\N	\N	10% off	\N	\N	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	t	2026-05-28 05:45:18.992423+00	2026-05-28 05:45:18.992423+00	\N
cbd6fd89-2dc5-492f-b507-441a21586e03	79aaed20-154d-45b4-a0a2-0d42fbf937e7	drink	beer	All Beers & Ciders on Tap	500	\N	\N	\N	\N	\N	\N	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	t	2026-05-28 05:45:18.993999+00	2026-05-28 05:45:18.993999+00	\N
282764af-548f-4883-8dfd-6554eb5c6b78	79aaed20-154d-45b4-a0a2-0d42fbf937e7	food	entree	Entrees	\N	\N	\N	\N	Buy an Entree, Get a Second for 30% off	\N	\N	https://www.dirtyoscarsannex.com/menu/weekday-drink-specials/	t	2026-05-28 05:45:18.994655+00	2026-05-28 05:45:18.994655+00	\N
434deb0e-5097-499d-93c1-a41bec58da5d	c7667137-5082-4945-8140-cb618b22c549	drink	beer	McMenamins Beer	\N	\N	100	\N	pint	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.555994+00	2026-05-28 05:48:39.555994+00	\N
5e487c2d-d2e0-45dc-b32d-3d81265c8f76	c7667137-5082-4945-8140-cb618b22c549	drink	other	Edgefield Hard Cider	\N	\N	100	\N	pint	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.558001+00	2026-05-28 05:48:39.558001+00	\N
310d70fc-33f5-43df-afea-ec842b726690	c7667137-5082-4945-8140-cb618b22c549	drink	wine	Edgefield Wines	\N	\N	100	\N	glass	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.55866+00	2026-05-28 05:48:39.55866+00	\N
f512eb77-95aa-4001-a73c-f8b0122a14f8	c7667137-5082-4945-8140-cb618b22c549	drink	spirit	Well Drinks	\N	\N	100	\N	Old Crow Bourbon, Joe Penney's Gin, Spar Vodka, Spar Citrus Vodka, Lunazul Blanco Tequila, Three Rocks Silver Rum, Lauder's Scotch, High Council Brandy	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.559315+00	2026-05-28 05:48:39.559315+00	\N
4f123221-0d2f-4d08-98a9-fab00d1ae907	c7667137-5082-4945-8140-cb618b22c549	drink	cocktail	Featured Illustrated Cocktails	\N	\N	200	\N	\N	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.559973+00	2026-05-28 05:48:39.559973+00	\N
fa2e823e-0b95-4ac7-bc95-7913893f170f	c7667137-5082-4945-8140-cb618b22c549	drink	wine	Edgefield Wine Flight	\N	\N	200	\N	three samples	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.560646+00	2026-05-28 05:48:39.560646+00	\N
bdd2b6b7-1a7f-4a73-aa86-2b1c7ce47f71	c7667137-5082-4945-8140-cb618b22c549	drink	beer	Brewery Flight	\N	\N	200	\N	six samples	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.561386+00	2026-05-28 05:48:39.561386+00	\N
28b2ff11-8121-4029-9bff-c46a217ebacd	c7667137-5082-4945-8140-cb618b22c549	drink	other	Cider Flight	\N	\N	200	\N	three samples	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.562043+00	2026-05-28 05:48:39.562043+00	\N
e8ed3184-9140-4a46-b895-82f59782fa40	c7667137-5082-4945-8140-cb618b22c549	drink	spirit	Distillery Flight	\N	\N	200	\N	three samples	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.562714+00	2026-05-28 05:48:39.562714+00	\N
049cef71-f659-4d00-a66a-55e30625cd00	c7667137-5082-4945-8140-cb618b22c549	food	appetizer	Hummus	1400	\N	\N	\N	marinated olives, veggies, feta, pita bread	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.563392+00	2026-05-28 05:48:39.563392+00	\N
f85733b7-0890-4446-a117-b1d9acf88d16	c7667137-5082-4945-8140-cb618b22c549	food	entree	Hammerhead Garden Burger à la carte	1300	\N	\N	\N	our Hammerhead garden patty with all the usual suspects	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.564047+00	2026-05-28 05:48:39.564047+00	\N
ac4fb5fc-4dc3-4a09-8be5-ed410ec96fb7	c7667137-5082-4945-8140-cb618b22c549	food	entree	Pepperoni Pizza	1400	\N	\N	\N	\N	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.564762+00	2026-05-28 05:48:39.564762+00	\N
d9f791db-7390-4faa-b806-9d5d02eedc94	c7667137-5082-4945-8140-cb618b22c549	food	entree	Cheese Pizza	1200	\N	\N	\N	\N	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.565396+00	2026-05-28 05:48:39.565396+00	\N
2d2e254f-e529-4ad6-9027-0c2ff4d83044	c7667137-5082-4945-8140-cb618b22c549	food	appetizer	Cheeseburger Slider Trio	1200	\N	\N	\N	Most Awesome French Onion seasoning, American cheese, Mystic 18 sauce, Hawaiian roll	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.566003+00	2026-05-28 05:48:39.566003+00	\N
84812ab2-cfe2-4b46-9153-11b41d909e55	c7667137-5082-4945-8140-cb618b22c549	food	entree	Smash Hit Burger à la carte	1200	\N	\N	\N	Most Awesome French Onion seasoned beef patties, American cheese, lettuce, pickles, secret sauce, bun	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.566602+00	2026-05-28 05:48:39.566602+00	\N
1f8cb495-7e92-4ce3-8449-6aa09022591a	c7667137-5082-4945-8140-cb618b22c549	food	appetizer	McMenamins Fries	1000	\N	\N	\N	Mystic 18 sauce	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.567233+00	2026-05-28 05:48:39.567233+00	\N
f4d6ffbc-fe85-41ac-8bd4-1c7670cc82ca	c7667137-5082-4945-8140-cb618b22c549	food	appetizer	Cajun Tots	1000	\N	\N	\N	peppercorn ranch	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.567865+00	2026-05-28 05:48:39.567865+00	\N
c496721e-38ad-4f0c-86fc-0c7bf6f384cf	c7667137-5082-4945-8140-cb618b22c549	food	dessert	Brownie Bites	1025	\N	\N	\N	caram-ale & chocolate sauces	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.568921+00	2026-05-28 05:48:39.568921+00	\N
d472b8dc-e454-4e6e-ae03-35c72c5cd0a9	c583dea3-f027-44e9-8390-9b6cef143c11	drink	cocktail	Mule Monday	1000	\N	\N	\N	Spar Vodka, fresh-squeezed lime & ginger beer	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.570354+00	2026-05-28 05:48:39.570354+00	\N
72c7484e-2b75-4e0a-87c2-05a92a8fca00	dedfdc26-599e-460f-9383-4c13bf04045b	drink	spirit	Shot of Lunazul Blanco	650	\N	\N	\N	\N	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.571743+00	2026-05-28 05:48:39.571743+00	\N
b1e2ecef-2011-45d7-9209-0e11bbc08f6b	dedfdc26-599e-460f-9383-4c13bf04045b	drink	cocktail	La Paloma	875	\N	\N	\N	Lunazul Blanco Tequila, club soda, fresh-squeezed lime & grapefruit	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.572431+00	2026-05-28 05:48:39.572431+00	\N
932861f5-bf1c-4e5b-b964-d4e36c8043ca	304d234c-c8c2-4aa6-b16f-57f94738d434	drink	cocktail	Old Fashioned	950	\N	\N	\N	Kentucky Straight Bourbon Whiskey, Angostura Aromatic Bitters & a touch of sugar	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.573849+00	2026-05-28 05:48:39.573849+00	\N
de4bd8f0-7cda-45da-903e-68f0f6edfcf1	92c6b444-a6a1-48f4-a69e-0298115e6e38	drink	beer	McMenamins Beer	\N	\N	100	\N	pint	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.575261+00	2026-05-28 05:48:39.575261+00	\N
18b10690-7f1f-42bd-97a8-f8d75d379baf	92c6b444-a6a1-48f4-a69e-0298115e6e38	drink	other	Edgefield Hard Cider	\N	\N	100	\N	pint	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.575982+00	2026-05-28 05:48:39.575982+00	\N
b12f6a0c-bbcb-4976-9c8f-779c4ec653f6	92c6b444-a6a1-48f4-a69e-0298115e6e38	drink	wine	Edgefield Wines	\N	\N	100	\N	glass	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.576671+00	2026-05-28 05:48:39.576671+00	\N
19d7ae0f-a0ac-4e06-8f3e-b81dfecb6482	92c6b444-a6a1-48f4-a69e-0298115e6e38	drink	spirit	Well Drinks	\N	\N	100	\N	Old Crow Bourbon, Joe Penney's Gin, Spar Vodka, Spar Citrus Vodka, Lunazul Blanco Tequila, Three Rocks Silver Rum, Lauder's Scotch, High Council Brandy	\N	\N	https://d2660z551umiy9.cloudfront.net/files/Menus/Elks/EMPhappyhour.pdf	t	2026-05-28 05:48:39.577355+00	2026-05-28 05:48:39.577355+00	\N
7ef1516a-b463-409b-aea3-c2f013d47b3e	925e6c8f-62fa-4ba2-8e72-e11347c711f6	drink	beer	Bottle / Canned Beer	700	\N	100	\N	$1 off all drinks	\N	\N	https://img1.wsimg.com/blobby/go/3a0c4d5c-8832-4f1b-b7b6-84e0203c0e9b/Cliff%20House%20Happy%20Hour%20January%202026-0f3b16d.pdf	t	2026-05-28 05:52:54.352647+00	2026-05-28 05:52:54.352647+00	\N
946fcfa4-3575-450b-81ee-bc6a3918dbb3	925e6c8f-62fa-4ba2-8e72-e11347c711f6	drink	cocktail	Well Drinks	700	\N	100	\N	$1 off all drinks	\N	\N	https://img1.wsimg.com/blobby/go/3a0c4d5c-8832-4f1b-b7b6-84e0203c0e9b/Cliff%20House%20Happy%20Hour%20January%202026-0f3b16d.pdf	t	2026-05-28 05:52:54.353613+00	2026-05-28 05:52:54.353613+00	\N
c3554454-22b5-4626-870b-0b604af0187c	925e6c8f-62fa-4ba2-8e72-e11347c711f6	food	appetizer	Most appetizers & entrees	\N	\N	\N	\N	Wide selection including Wedge Salad ($8), Garlic Parmesan Truffle Fries ($9), Smash Burger ($12-13), Fish Tacos ($15), various flatbreads, seafood items, and more	\N	\N	https://img1.wsimg.com/blobby/go/3a0c4d5c-8832-4f1b-b7b6-84e0203c0e9b/Cliff%20House%20Happy%20Hour%20January%202026-0f3b16d.pdf	t	2026-05-28 05:52:54.354355+00	2026-05-28 05:52:54.354355+00	\N
8ff7653c-877f-4508-a9fc-f5e9d6360ebd	925e6c8f-62fa-4ba2-8e72-e11347c711f6	drink	other	Oyster Shooters	500	\N	\N	\N	\N	\N	\N	https://img1.wsimg.com/blobby/go/3a0c4d5c-8832-4f1b-b7b6-84e0203c0e9b/Cliff%20House%20Happy%20Hour%20January%202026-0f3b16d.pdf	t	2026-05-28 05:52:54.355075+00	2026-05-28 05:52:54.355075+00	\N
d5bfec71-b067-4922-84b2-2cba7782ea9b	925e6c8f-62fa-4ba2-8e72-e11347c711f6	drink	cocktail	Spiked Shooter	800	\N	\N	\N	Served with bloody Mary cocktail sauce and vodka	\N	\N	https://img1.wsimg.com/blobby/go/3a0c4d5c-8832-4f1b-b7b6-84e0203c0e9b/Cliff%20House%20Happy%20Hour%20January%202026-0f3b16d.pdf	t	2026-05-28 05:52:54.355781+00	2026-05-28 05:52:54.355781+00	\N
38545d3c-f0aa-41fd-a49e-6983e27dcf63	4eca0ce1-daa9-4d5a-b360-36dea25ca386	drink	cocktail	\N	\N	\N	\N	\N	\N	\N	\N	https://www.facebook.com/boranroyalthaicuisine/posts/happy-hour-at-point-ruston-3-6-pm-everyday-/660036596539849/	t	2026-05-28 05:54:50.116267+00	2026-05-28 05:54:50.116267+00	\N
2e1af1b6-1ce5-4e3f-bc2d-cc604da7dd6e	4eca0ce1-daa9-4d5a-b360-36dea25ca386	drink	beer	\N	\N	\N	\N	\N	\N	\N	\N	https://www.facebook.com/boranroyalthaicuisine/posts/happy-hour-at-point-ruston-3-6-pm-everyday-/660036596539849/	t	2026-05-28 05:54:50.117301+00	2026-05-28 05:54:50.117301+00	\N
a72b5f2f-87cb-42e1-abf3-c9d0fbf45ef9	4eca0ce1-daa9-4d5a-b360-36dea25ca386	food	appetizer	\N	\N	\N	\N	\N	\N	\N	\N	https://www.facebook.com/boranroyalthaicuisine/posts/happy-hour-at-point-ruston-3-6-pm-everyday-/660036596539849/	t	2026-05-28 05:54:50.118108+00	2026-05-28 05:54:50.118108+00	\N
9def7d3e-ab10-4840-8a67-a6010bfb270d	d1c28b9d-fed2-4117-90a4-f74fc8ab9bf5	drink	beer	Rainier Draft	300	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.129044+00	2026-05-28 05:56:41.129044+00	\N
5c460f8f-146e-412e-a7f0-757f9c014ef6	d1c28b9d-fed2-4117-90a4-f74fc8ab9bf5	drink	cocktail	Mimosa	400	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.129961+00	2026-05-28 05:56:41.129961+00	\N
0182367f-a673-4918-8b3b-cfa5e830acf6	d1c28b9d-fed2-4117-90a4-f74fc8ab9bf5	drink	wine	Wine Spritzer	300	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.13085+00	2026-05-28 05:56:41.13085+00	\N
aa798c46-7285-414f-a43d-a669c2ead336	d1c28b9d-fed2-4117-90a4-f74fc8ab9bf5	drink	wine	House Wine	500	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.131744+00	2026-05-28 05:56:41.131744+00	\N
6548e7a9-f29a-4a02-92b5-c7f7c09eb6f0	d1c28b9d-fed2-4117-90a4-f74fc8ab9bf5	drink	spirit	Well Drinks	600	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.132732+00	2026-05-28 05:56:41.132732+00	\N
06b2d666-19c7-4904-a270-11bf0dc94124	d1c28b9d-fed2-4117-90a4-f74fc8ab9bf5	drink	beer	Spring Cleaning Beers (Coors Original, Fomosa Lager, PB Milk Stout, Blk Butte Porter)	300	\N	\N	\N	While supplies last	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.133508+00	2026-05-28 05:56:41.133508+00	\N
23c1cc77-70dc-4139-abc5-baf7c2bf7f9b	d1c28b9d-fed2-4117-90a4-f74fc8ab9bf5	drink	other	Spring Cleaning Ciders (Golden Delicious, Schillings Local Legend, Angry Orchard)	400	\N	\N	\N	While supplies last	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.134224+00	2026-05-28 05:56:41.134224+00	\N
950be832-2047-4e57-8d6e-c224d0845c73	d1c28b9d-fed2-4117-90a4-f74fc8ab9bf5	food	entree	Homemade Chili	\N	\N	\N	\N	cup, bowl, dog, fries	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.135014+00	2026-05-28 05:56:41.135014+00	\N
09517c75-ed76-41f2-aefd-c989d223d609	50959e25-9c01-4ee9-a7ff-69b44a727f5a	drink	beer	Rainier Draft	300	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.13647+00	2026-05-28 05:56:41.13647+00	\N
d72ba7da-f823-437c-8091-7f3eae41c35a	50959e25-9c01-4ee9-a7ff-69b44a727f5a	drink	cocktail	Mimosa	400	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.137205+00	2026-05-28 05:56:41.137205+00	\N
1151bb04-eea4-4ab3-86d9-b58e5f38f197	50959e25-9c01-4ee9-a7ff-69b44a727f5a	drink	wine	Wine Spritzer	300	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.138031+00	2026-05-28 05:56:41.138031+00	\N
4e69f029-f915-4380-bf52-0c94960a4141	50959e25-9c01-4ee9-a7ff-69b44a727f5a	drink	wine	House Wine	500	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.139107+00	2026-05-28 05:56:41.139107+00	\N
e6b06d69-637e-4573-b1a3-9eb01ff9ae59	50959e25-9c01-4ee9-a7ff-69b44a727f5a	drink	spirit	Well Drinks	600	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.139911+00	2026-05-28 05:56:41.139911+00	\N
53889a83-5c32-4e97-a8bf-cb38ce4cbfc5	50959e25-9c01-4ee9-a7ff-69b44a727f5a	drink	beer	Spring Cleaning Beers (Coors Original, Fomosa Lager, PB Milk Stout, Blk Butte Porter)	300	\N	\N	\N	While supplies last	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.140843+00	2026-05-28 05:56:41.140843+00	\N
07565a75-212e-4a83-8525-fbb7be67b2dd	a32598a8-41b1-4a2b-a5cc-4f197376391f	drink	spirit	Well Drinks	500	\N	\N	\N	Vodka, gin, tequila, rum, whiskey	\N	\N	https://laperladelmarvip.com/wp-content/uploads/2025/08/HAPPYHOUR_C.pdf	t	2026-05-28 16:25:57.765006+00	2026-05-28 16:25:57.765006+00	\N
6b6877c2-6bf6-4b2a-ab23-67767dfe0ba2	50959e25-9c01-4ee9-a7ff-69b44a727f5a	drink	other	Spring Cleaning Ciders (Golden Delicious, Schillings Local Legend, Angry Orchard)	400	\N	\N	\N	While supplies last	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.141742+00	2026-05-28 05:56:41.141742+00	\N
dedbbb45-26d6-49c5-9079-e4dc8cb615c2	50959e25-9c01-4ee9-a7ff-69b44a727f5a	food	entree	Taco Tuesday	\N	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.142751+00	2026-05-28 05:56:41.142751+00	\N
6e537d8b-4dd9-47c3-b893-2c7e0869532a	9b4b9a43-83ff-4d05-89a7-4fbb47a6f6ca	drink	beer	Rainier Draft	300	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.144391+00	2026-05-28 05:56:41.144391+00	\N
f69ff987-03c5-4324-8d04-b6a1a7aec39b	9b4b9a43-83ff-4d05-89a7-4fbb47a6f6ca	drink	cocktail	Mimosa	400	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.145204+00	2026-05-28 05:56:41.145204+00	\N
13229aad-5eb1-4469-9167-41f56128bd0d	9b4b9a43-83ff-4d05-89a7-4fbb47a6f6ca	drink	wine	Wine Spritzer	300	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.146297+00	2026-05-28 05:56:41.146297+00	\N
b6945f9a-b8a2-4220-90ce-1f3b50787d4e	9b4b9a43-83ff-4d05-89a7-4fbb47a6f6ca	drink	wine	House Wine	500	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.147143+00	2026-05-28 05:56:41.147143+00	\N
d4f18cf7-7c33-45bf-9a21-8e8100d3ade5	9b4b9a43-83ff-4d05-89a7-4fbb47a6f6ca	drink	spirit	Well Drinks	600	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.148131+00	2026-05-28 05:56:41.148131+00	\N
fd29baff-4e69-43a1-8686-bc720ce84608	9b4b9a43-83ff-4d05-89a7-4fbb47a6f6ca	drink	beer	Spring Cleaning Beers (Coors Original, Fomosa Lager, PB Milk Stout, Blk Butte Porter)	300	\N	\N	\N	While supplies last	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.148862+00	2026-05-28 05:56:41.148862+00	\N
51e175f4-8853-4d9f-9953-ba32734cbbc3	9b4b9a43-83ff-4d05-89a7-4fbb47a6f6ca	drink	other	Spring Cleaning Ciders (Golden Delicious, Schillings Local Legend, Angry Orchard)	400	\N	\N	\N	While supplies last	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.149635+00	2026-05-28 05:56:41.149635+00	\N
b7f23534-6b9f-4c71-b909-32cf6174262c	a286fdd8-a9aa-462f-8106-585d054c56fd	drink	beer	Rainier Draft	300	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.151318+00	2026-05-28 05:56:41.151318+00	\N
0342c084-5b5b-4876-84d5-89dc61c23034	a286fdd8-a9aa-462f-8106-585d054c56fd	drink	cocktail	Mimosa	400	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.152046+00	2026-05-28 05:56:41.152046+00	\N
ad1fb7b6-8aa1-40b3-80d9-7ad63846743c	a286fdd8-a9aa-462f-8106-585d054c56fd	drink	wine	Wine Spritzer	300	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.152784+00	2026-05-28 05:56:41.152784+00	\N
fb49508d-1e8f-49f8-9eb9-4fd90b368b25	a286fdd8-a9aa-462f-8106-585d054c56fd	drink	wine	House Wine	500	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.153539+00	2026-05-28 05:56:41.153539+00	\N
390afbfb-20d9-4614-a04f-707e38b8bb0b	a286fdd8-a9aa-462f-8106-585d054c56fd	drink	spirit	Well Drinks	600	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.154344+00	2026-05-28 05:56:41.154344+00	\N
50028073-60f1-4a1e-a31d-8c4825bc0af8	a286fdd8-a9aa-462f-8106-585d054c56fd	drink	beer	Spring Cleaning Beers (Coors Original, Fomosa Lager, PB Milk Stout, Blk Butte Porter)	300	\N	\N	\N	While supplies last	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.155091+00	2026-05-28 05:56:41.155091+00	\N
a80df12d-b489-4655-a4d8-97b4672db145	a286fdd8-a9aa-462f-8106-585d054c56fd	drink	other	Spring Cleaning Ciders (Golden Delicious, Schillings Local Legend, Angry Orchard)	400	\N	\N	\N	While supplies last	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.155804+00	2026-05-28 05:56:41.155804+00	\N
ba34c764-c7ae-437b-b5fc-96120c0224a5	c637f35a-6b93-4ac5-b430-320743447805	drink	beer	Rainier Draft	300	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.157316+00	2026-05-28 05:56:41.157316+00	\N
cdfb3fb4-3d43-4fa6-9708-717974995ccb	c637f35a-6b93-4ac5-b430-320743447805	drink	cocktail	Mimosa	400	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.158136+00	2026-05-28 05:56:41.158136+00	\N
64efcff9-9195-464e-a1a7-8f32395f927c	c637f35a-6b93-4ac5-b430-320743447805	drink	wine	Wine Spritzer	300	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.158846+00	2026-05-28 05:56:41.158846+00	\N
03aacea4-813c-4b73-aca8-e44f5365e6c8	c637f35a-6b93-4ac5-b430-320743447805	drink	wine	House Wine	500	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.159509+00	2026-05-28 05:56:41.159509+00	\N
030a111f-386d-424c-9192-746921edc7a5	c637f35a-6b93-4ac5-b430-320743447805	drink	spirit	Well Drinks	600	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.160226+00	2026-05-28 05:56:41.160226+00	\N
8e6b41a2-7499-4d68-8dd7-623c19f37caa	c637f35a-6b93-4ac5-b430-320743447805	drink	beer	Spring Cleaning Beers (Coors Original, Fomosa Lager, PB Milk Stout, Blk Butte Porter)	300	\N	\N	\N	While supplies last	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.160926+00	2026-05-28 05:56:41.160926+00	\N
1fe8f4b0-a985-48ce-8b61-467da4c45740	c637f35a-6b93-4ac5-b430-320743447805	drink	other	Spring Cleaning Ciders (Golden Delicious, Schillings Local Legend, Angry Orchard)	400	\N	\N	\N	While supplies last	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.161561+00	2026-05-28 05:56:41.161561+00	\N
a2604d45-232e-40c0-bae6-3fdce946e115	8d86a994-369a-4b64-9f4e-1cca6e2365d2	drink	beer	Rainier Draft	300	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.162914+00	2026-05-28 05:56:41.162914+00	\N
5c03da86-994d-4484-86d0-5f28c9f5481d	8d86a994-369a-4b64-9f4e-1cca6e2365d2	drink	cocktail	Mimosa	400	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.163653+00	2026-05-28 05:56:41.163653+00	\N
9456abef-71df-4116-ae1b-e6d1898c2a55	8d86a994-369a-4b64-9f4e-1cca6e2365d2	drink	wine	Wine Spritzer	300	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.164323+00	2026-05-28 05:56:41.164323+00	\N
68a4307f-4159-44ca-a45c-04f028fa650a	8d86a994-369a-4b64-9f4e-1cca6e2365d2	drink	wine	House Wine	500	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.16495+00	2026-05-28 05:56:41.16495+00	\N
0ead0457-d52e-491b-a086-eb2399a7f13b	8d86a994-369a-4b64-9f4e-1cca6e2365d2	drink	spirit	Well Drinks	600	\N	\N	\N	\N	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.165609+00	2026-05-28 05:56:41.165609+00	\N
930d3996-5de8-411b-8184-a552d56f0e59	8d86a994-369a-4b64-9f4e-1cca6e2365d2	drink	beer	Spring Cleaning Beers (Coors Original, Fomosa Lager, PB Milk Stout, Blk Butte Porter)	300	\N	\N	\N	While supplies last	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.166245+00	2026-05-28 05:56:41.166245+00	\N
57017980-8d30-4349-8c5c-f014071fbf02	8d86a994-369a-4b64-9f4e-1cca6e2365d2	drink	other	Spring Cleaning Ciders (Golden Delicious, Schillings Local Legend, Angry Orchard)	400	\N	\N	\N	While supplies last	\N	\N	https://twistedfs.com/tacoma-point-ruston-copperline-building-suite-131-twisted-fork-saloon-happy-hours-specials	t	2026-05-28 05:56:41.166887+00	2026-05-28 05:56:41.166887+00	\N
0ad57062-15a5-44d0-95c0-e5119577e78d	fe295bd0-0438-4cdd-b11d-56f0722e68f3	other	other	Happy hour specials	\N	\N	\N	\N	Amazing deals on drinks and appetizers during happy hour	\N	\N	https://cheerhop.com/tacoma/wooden-city-tacoma	t	2026-05-28 16:25:14.501877+00	2026-05-28 16:25:14.501877+00	\N
f8c0758c-8bdd-4707-8c1c-1a955d8ca957	734f8734-deeb-4eea-a3a0-9d0aba18bb08	other	other	Late night menu	\N	\N	\N	\N	Late night menu available at the bar	\N	\N	https://cheerhop.com/tacoma/wooden-city-tacoma	t	2026-05-28 16:25:14.504874+00	2026-05-28 16:25:14.504874+00	\N
16fde666-eb20-4fee-a47d-eed15b7def98	a32598a8-41b1-4a2b-a5cc-4f197376391f	drink	beer	Bottle of Beer	500	\N	\N	\N	\N	\N	\N	https://laperladelmarvip.com/wp-content/uploads/2025/08/HAPPYHOUR_C.pdf	t	2026-05-28 16:25:57.766829+00	2026-05-28 16:25:57.766829+00	\N
db5456b4-57c0-4e06-a21c-743023dce1ea	a32598a8-41b1-4a2b-a5cc-4f197376391f	drink	cocktail	Bomb Squad	800	\N	\N	\N	Jägerbomb, Vegas Bomb, Perla Negra Bomb	\N	\N	https://laperladelmarvip.com/wp-content/uploads/2025/08/HAPPYHOUR_C.pdf	t	2026-05-28 16:25:57.767919+00	2026-05-28 16:25:57.767919+00	\N
292d92a5-c30d-464d-8eb0-fa492121dc2c	a32598a8-41b1-4a2b-a5cc-4f197376391f	drink	cocktail	Dulce Con Chile	800	\N	\N	\N	Pulparindo, Tamarindo selections	\N	\N	https://laperladelmarvip.com/wp-content/uploads/2025/08/HAPPYHOUR_C.pdf	t	2026-05-28 16:25:57.768942+00	2026-05-28 16:25:57.768942+00	\N
3cb39caf-6c85-465d-9b63-5d223be8f37c	a32598a8-41b1-4a2b-a5cc-4f197376391f	food	appetizer	Appetizers	999	\N	\N	\N	Empanadas, 3 tacos, 6 chicken wings, mini nachos, mini aguahiles, malverde oysters, mini ceviche, mix mini platter	\N	\N	https://laperladelmarvip.com/wp-content/uploads/2025/08/HAPPYHOUR_C.pdf	t	2026-05-28 16:25:57.769833+00	2026-05-28 16:25:57.769833+00	\N
014b17d2-c9a1-4770-b018-b84931494ac1	8de11ac1-3449-46b9-93b3-790fe0dc2f3e	drink	spirit	Well Drinks	500	\N	\N	\N	Vodka, gin, tequila, rum, whiskey	\N	\N	https://laperladelmarvip.com/wp-content/uploads/2025/08/HAPPYHOUR_C.pdf	t	2026-05-28 16:25:57.77169+00	2026-05-28 16:25:57.77169+00	\N
66ec6472-5103-46de-9829-2db807834024	8de11ac1-3449-46b9-93b3-790fe0dc2f3e	drink	beer	Bottle of Beer	500	\N	\N	\N	\N	\N	\N	https://laperladelmarvip.com/wp-content/uploads/2025/08/HAPPYHOUR_C.pdf	t	2026-05-28 16:25:57.773004+00	2026-05-28 16:25:57.773004+00	\N
77a49d87-c9cd-4b31-bbef-8b8958e00afd	8de11ac1-3449-46b9-93b3-790fe0dc2f3e	drink	cocktail	Bomb Squad	800	\N	\N	\N	Jägerbomb, Vegas Bomb, Perla Negra Bomb	\N	\N	https://laperladelmarvip.com/wp-content/uploads/2025/08/HAPPYHOUR_C.pdf	t	2026-05-28 16:25:57.774235+00	2026-05-28 16:25:57.774235+00	\N
2fee849c-9044-4895-bed5-604612e01a7b	8de11ac1-3449-46b9-93b3-790fe0dc2f3e	drink	cocktail	Dulce Con Chile	800	\N	\N	\N	Pulparindo, Tamarindo selections	\N	\N	https://laperladelmarvip.com/wp-content/uploads/2025/08/HAPPYHOUR_C.pdf	t	2026-05-28 16:25:57.775417+00	2026-05-28 16:25:57.775417+00	\N
29878245-4858-4185-9579-a6fc9fe82075	8de11ac1-3449-46b9-93b3-790fe0dc2f3e	food	appetizer	Appetizers	999	\N	\N	\N	Empanadas, 3 tacos, 6 chicken wings, mini nachos, mini aguahiles, malverde oysters, mini ceviche, mix mini platter	\N	\N	https://laperladelmarvip.com/wp-content/uploads/2025/08/HAPPYHOUR_C.pdf	t	2026-05-28 16:25:57.77647+00	2026-05-28 16:25:57.77647+00	\N
\.


--
-- Data for Name: seed_candidates; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.seed_candidates (id, city_id, name, google_place_id, address, lat, lng, source_url, processed_at, outcome, resulting_venue_id, created_at, updated_at) FROM stdin;
3026f9ae-7102-4e9e-a5bb-6dd0440f6afd	117cbe36-eae9-45cf-b54f-df358dbb49c1	El Tenampa Bar Nightclub	ChIJAzo19AcRK4cRO7WwxrF4XCY	1707 W Broadway Rd, Phoenix, AZ 85041, USA	33.4064455	-112.0954541	google_places	2026-05-28 04:51:44.740286+00	no_hh_found	7f17585c-3db9-48fc-a95c-ad18fd7303ab	2026-05-28 04:48:11.280134+00	2026-05-28 04:51:44.740286+00
7bd2f51d-74dd-42d2-bb95-36d8b5b587ae	6d08439f-6aac-4bd2-bbba-99566b214b69	Matador Tacoma	ChIJJQLIIKFVkFQRD81XZZfpDzU	721 Pacific Ave, Tacoma, WA 98402, USA	47.2566835	-122.4391313	google_places	2026-05-28 04:14:01.426716+00	confirmed_hh	2e8a4ccb-03ae-4f09-80b9-11e31fe2a1e1	2026-05-27 21:09:48.415153+00	2026-05-28 04:14:01.426716+00
b01d66e7-4978-498e-bae6-3e2b58500a5e	6d08439f-6aac-4bd2-bbba-99566b214b69	Duke's Seafood Tacoma	ChIJh6xeOvVUkFQRJfy6SlzyElQ	3327 Ruston Way, Tacoma, WA 98402, USA	47.2825834	-122.4798449	google_places	2026-05-28 04:14:19.272539+00	confirmed_hh	86ae81ad-001f-4e55-ae51-b5cf9aab7bd4	2026-05-27 21:09:48.416642+00	2026-05-28 04:14:19.272539+00
e1904833-3ab9-4e7e-99c1-1767f8b85b5c	6d08439f-6aac-4bd2-bbba-99566b214b69	Wooden City Tacoma	ChIJ5YkliQhVkFQRwj4AtgUheqs	1102 Broadway Ste 102, Tacoma, WA 98402, USA	47.2529070	-122.4404120	google_places	2026-05-28 16:25:14.505835+00	confirmed_hh	32cced2d-aa82-4c84-810f-79defafcab80	2026-05-27 21:09:48.43054+00	2026-05-28 16:25:14.505835+00
80070df6-c924-4349-9c3f-5828f3fcee86	6d08439f-6aac-4bd2-bbba-99566b214b69	Tides Tavern	ChIJ5c9c3MJSkFQRq1gjFnXdVNU	2925 Harborview Dr, Gig Harbor, WA 98335, USA	47.3292704	-122.5783631	google_places	2026-05-28 04:16:51.577551+00	confirmed_hh	8dfc3c14-8fe5-4ad2-84d3-c4e2d8fc5766	2026-05-27 21:09:48.425644+00	2026-05-28 04:16:51.577551+00
6669f071-46d1-485c-b8f1-a04fe5e69128	6d08439f-6aac-4bd2-bbba-99566b214b69	Moctezuma's Mexican Restaurant & Tequila Bar	ChIJLyuk0gwAkVQRtoAeL9ftbOI	4102 S 56th St, Tacoma, WA 98409, USA	47.2058553	-122.4926243	google_places	2026-05-28 04:19:40.995108+00	confirmed_hh	136d95f4-f4fe-4c68-9756-61e95d616593	2026-05-28 00:35:16.15169+00	2026-05-28 04:19:40.995108+00
08640b03-f8d9-47b8-8b31-aa1655365904	6d08439f-6aac-4bd2-bbba-99566b214b69	WildFin American Grill	ChIJieLjwn5TkFQR8dR325LVbgg	5115 Grand Loop, Tacoma, WA 98407, USA	47.2997269	-122.5048001	google_places	2026-05-28 02:48:13.29214+00	confirmed_hh	f084ea27-3349-4f5e-89d9-76ca3e4d5664	2026-05-27 21:09:48.42724+00	2026-05-28 02:48:13.29214+00
916ab774-1dea-41ee-8bfa-d5fb910a0c58	6d08439f-6aac-4bd2-bbba-99566b214b69	The Cheesecake Factory	ChIJ9RbaA_7_kFQRtldrBPub5ic	4502 S Steele St Space 1300A, Tacoma, WA 98409, USA	47.2154281	-122.4686605	google_places	2026-05-28 04:23:16.106028+00	confirmed_hh	47e57312-265e-4750-9fe4-2d4397281da2	2026-05-28 00:35:16.330057+00	2026-05-28 04:23:16.106028+00
f3a06b7b-6e45-4872-ba1d-483516361bb2	6d08439f-6aac-4bd2-bbba-99566b214b69	Buddy's Chicken & Waffles	ChIJ7VSYlsdVkFQRxiAujHJQ8sc	3709 S G St, Tacoma, WA 98419, USA	47.2242355	-122.4402977	google_places	2026-05-28 04:27:29.586221+00	\N	\N	2026-05-28 00:35:16.512201+00	2026-05-28 04:27:29.586221+00
bcb44438-3916-4758-861b-6c248101b242	6d08439f-6aac-4bd2-bbba-99566b214b69	El Rinconsito | Tacoma	ChIJhw9cntX_kFQR6AxKDU2o-aY	7210 Pacific Ave #7113, Tacoma, WA 98408, USA	47.1914034	-122.4344077	google_places	2026-05-28 02:55:05.33511+00	\N	\N	2026-05-28 00:35:15.954541+00	2026-05-28 02:55:05.33511+00
f814f905-b762-4ab1-bef0-30f539b0c39d	117cbe36-eae9-45cf-b54f-df358dbb49c1	Mariscos El Maviri	ChIJtSVjkw4VK4cRH3u4EUPm9ws	702 W Broadway Rd, Phoenix, AZ 85041, USA	33.4073472	-112.0826149	google_places	2026-05-28 04:51:43.826065+00	no_hh_found	b3bb868e-7be4-43c8-8cb5-4d180bbe156b	2026-05-28 04:48:11.278795+00	2026-05-28 04:51:43.826065+00
9b384161-4fa8-4aea-8fe4-4d52c83f9f9c	117cbe36-eae9-45cf-b54f-df358dbb49c1	Peter Piper Pizza	ChIJYzWWbkgQK4cRbC414oNc97U	6040 S Central Ave, Phoenix, AZ 85040, USA	33.3908690	-112.0746270	google_places	2026-05-28 04:50:11.065036+00	no_hh_found	f1bd428d-77e0-4bd0-916d-71e8e23acd5c	2026-05-28 04:48:11.276737+00	2026-05-28 04:50:11.065036+00
8206a666-6de4-460f-af73-ec7f9a72bcd9	117cbe36-eae9-45cf-b54f-df358dbb49c1	El Humadero	ChIJqfNIdbcRK4cRkfFhmPer60E	1339 W Broadway Rd, Phoenix, AZ 85041, USA	33.4064328	-112.0890960	google_places	2026-05-28 04:51:45.325689+00	\N	\N	2026-05-28 04:48:11.281252+00	2026-05-28 04:51:45.325689+00
67925597-7266-48f3-8e44-ab553dd6317f	117cbe36-eae9-45cf-b54f-df358dbb49c1	Pete's Fish & Chips	ChIJkRWPmbcRK4cR2rFLHGn7Cvc	3920 S Central Ave, Phoenix, AZ 85040, USA	33.4108063	-112.0736330	google_places	2026-05-28 05:01:34.623444+00	\N	\N	2026-05-28 04:48:11.460669+00	2026-05-28 05:01:34.623444+00
9ecf17ef-20ae-4495-af0e-10f87fbef966	6d08439f-6aac-4bd2-bbba-99566b214b69	MSM Deli	ChIJ2zLuYhpVkFQRFbRIZSd6igY	2220 6th Ave, Tacoma, WA 98403, USA	47.2551618	-122.4665727	google_places	2026-05-28 05:06:21.32284+00	\N	\N	2026-05-28 00:35:17.632821+00	2026-05-28 05:06:21.32284+00
7fb01a5c-92b7-45b8-aa6b-f0dfd287ce47	117cbe36-eae9-45cf-b54f-df358dbb49c1	Vaqueros Carne Asada	ChIJH9hUMP8QK4cRMCxSDSMotEg	1821 W Southern Ave, Phoenix, AZ 85041, USA	33.3919575	-112.0973227	google_places	2026-05-28 04:49:29.362536+00	\N	\N	2026-05-28 04:48:11.274828+00	2026-05-28 04:49:29.362536+00
2338ee2d-8cd4-4754-9e4c-23d59f47860c	117cbe36-eae9-45cf-b54f-df358dbb49c1	Sr Ozzy's Tacos Y Mariscos	ChIJ9XOxVP8QK4cRCeMXiWDdleI	1717 W Southern Ave Suite 100, Phoenix, AZ 85041, USA	33.3918578	-112.0959530	google_places	2026-05-28 04:53:18.254117+00	error	\N	2026-05-28 04:48:11.282447+00	2026-05-28 04:53:18.254117+00
414cb2bf-51d1-435b-a0d9-7e3047c7b102	117cbe36-eae9-45cf-b54f-df358dbb49c1	Poncho's Mexican Food and Cantina	ChIJWRmCOEAQK4cRAqbt-JZ4nZM	7202 S Central Ave, Phoenix, AZ 85042, USA	33.3811211	-112.0736456	google_places	2026-05-28 04:55:03.96617+00	no_hh_found	54e0af61-1d8f-491e-8ad7-82bded8cab79	2026-05-28 04:48:11.454479+00	2026-05-28 04:55:03.96617+00
8ce1cc05-4165-48af-a232-1ae293ae035e	117cbe36-eae9-45cf-b54f-df358dbb49c1	Carniceria Mexico	ChIJ9cKjQgYRK4cRTozfPLhh0_Y	4450 S 19th Ave, Phoenix, AZ 85041, USA	33.4052256	-112.0998602	google_places	2026-05-28 04:49:29.269344+00	\N	\N	2026-05-28 04:48:11.271693+00	2026-05-28 04:49:29.269344+00
b2641104-cc6a-4108-875b-a4883bedb657	117cbe36-eae9-45cf-b54f-df358dbb49c1	Hola Cabrito	ChIJ7WxT7dUPK4cRDI12rcsOQB8	4835 S 16th St, Phoenix, AZ 85040, USA	33.4022450	-112.0467977	google_places	2026-05-28 05:01:33.958875+00	no_hh_found	3f9ef141-8a71-4eb2-b538-74abd86bd596	2026-05-28 04:48:11.457848+00	2026-05-28 05:01:33.958875+00
368ea709-1210-47c3-bc6e-0bd92fab686b	117cbe36-eae9-45cf-b54f-df358dbb49c1	El Lorito	ChIJ8Tm0pLERK4cR4Alx1OGL3UU	624 W Broadway Rd, Phoenix, AZ 85041, USA	33.4069404	-112.0811462	google_places	2026-05-28 04:53:18.919381+00	\N	\N	2026-05-28 04:48:11.283628+00	2026-05-28 04:53:18.919381+00
725c4c88-4a1b-4944-a78c-2b7b31daeff0	117cbe36-eae9-45cf-b54f-df358dbb49c1	Cocina Madrigal	ChIJqcv0fSoOK4cRSbR-rnW7jlU	1530 E Wood St, Phoenix, AZ 85040, USA	33.4088003	-112.0474248	google_places	2026-05-28 04:57:34.110791+00	confirmed_hh	eb12b6de-509d-4132-a122-663a0f3d87a0	2026-05-28 04:48:11.456427+00	2026-05-28 04:57:34.110791+00
d495d358-afca-4023-ae31-dcee6b192dde	117cbe36-eae9-45cf-b54f-df358dbb49c1	Chichis cabaret	ChIJOzrz77gRK4cR8tYGMd_gQn4	3420 S Central Ave, Phoenix, AZ 85040, USA	33.4152976	-112.0736883	google_places	2026-05-28 05:01:35.08368+00	no_hh_found	a2abbcb1-1bca-420d-b470-54540603f882	2026-05-28 04:48:11.461459+00	2026-05-28 05:01:35.08368+00
30fa61b0-5573-477c-ba9d-f4cb9dffc3d7	117cbe36-eae9-45cf-b54f-df358dbb49c1	Mariscos El Dorado Sin 2	ChIJhaf7l0kQK4cR8el8HoWtSWQ	5630 S Central Ave, Phoenix, AZ 85040, USA	33.3946190	-112.0736584	google_places	2026-05-28 05:02:32.882626+00	error	\N	2026-05-28 04:48:11.462604+00	2026-05-28 05:02:32.882626+00
c9100ea2-3550-422f-a824-382e31a16807	117cbe36-eae9-45cf-b54f-df358dbb49c1	Mandy's Fish & Chips	ChIJ2SU6g9gPK4cR1aEO3Pthhio	6202 S 16th St, Phoenix, AZ 85042, USA	33.3916575	-112.0495918	google_places	2026-05-28 05:02:33.514741+00	\N	\N	2026-05-28 04:48:11.466752+00	2026-05-28 05:02:33.514741+00
6249cabb-c750-4a85-abd5-ec0aa102ff87	117cbe36-eae9-45cf-b54f-df358dbb49c1	Tacos Rodriguez - Food Truck	ChIJB8vbAggRK4cRHtW2Y-bJvNw	326 E Broadway Rd, Phoenix, AZ 85040, USA	33.4068516	-112.0687938	google_places	2026-05-28 05:02:33.595283+00	\N	\N	2026-05-28 04:48:11.468841+00	2026-05-28 05:02:33.595283+00
4004d388-8474-45fe-b822-8985c3f71411	117cbe36-eae9-45cf-b54f-df358dbb49c1	Tacos Mi Ranchito Mexican Grill	ChIJ6ydaP0cQK4cRxM-_F_ltfhg	6607 S Central Ave, Phoenix, AZ 85042, USA	33.3863786	-112.0730679	google_places	2026-05-28 05:04:54.414107+00	error	\N	2026-05-28 04:48:11.469659+00	2026-05-28 05:04:54.414107+00
00232716-10c5-4f90-8ee3-ef07c9c76110	117cbe36-eae9-45cf-b54f-df358dbb49c1	Chanpen Thai Cuisine	ChIJT_Yf67UPK4cRkofSQTLz4Jg	2727 E Broadway Rd, Phoenix, AZ 85040, USA	33.4067717	-112.0224813	google_places	2026-05-28 05:04:55.058189+00	\N	\N	2026-05-28 04:48:11.668674+00	2026-05-28 05:04:55.058189+00
966cc056-f51c-4537-9aeb-b55453fa2e89	6d08439f-6aac-4bd2-bbba-99566b214b69	THEKOI Sushi & Sake	ChIJc9q2J3RVkFQRgfAOjB5B-yc	1552 Commerce St #100, Tacoma, WA 98402, USA	47.2473240	-122.4383340	google_places	2026-05-28 05:08:42.762474+00	confirmed_hh	0195a6b7-2921-4fbe-89a3-9a6124675efd	2026-05-28 00:35:17.633517+00	2026-05-28 05:08:42.762474+00
f7f1c9ee-915e-4c89-91ab-ebd194e442fb	6d08439f-6aac-4bd2-bbba-99566b214b69	Stanley & Seafort's	ChIJiRNVe4j_kFQRGTdGxMPGF6Y	115 E 34th St, Tacoma, WA 98404, USA	47.2307279	-122.4313898	google_places	2026-05-28 05:12:02.255271+00	confirmed_hh	6f03ec34-412e-48c5-bf11-94661f730bc6	2026-05-28 00:35:17.63497+00	2026-05-28 05:12:02.255271+00
2208e69d-3fc0-4e58-9ac2-c5503b36c3d5	6d08439f-6aac-4bd2-bbba-99566b214b69	Red Star Taco Bar	ChIJ8R8oD6dVkFQRBY-OiPgsFNw	454 St Helens Ave, Tacoma, WA 98402, USA	47.2587530	-122.4435950	google_places	2026-05-28 05:14:11.638773+00	confirmed_hh	7578a24e-e856-4423-828c-85e50e752295	2026-05-28 00:35:17.636351+00	2026-05-28 05:14:11.638773+00
6e45af62-8650-42a5-b8d8-a1a889500146	6d08439f-6aac-4bd2-bbba-99566b214b69	Side Piece Kitchen	ChIJEy4U0GsBkVQRj5skZhmdHjQ	4704 S Oakes St, Tacoma, WA 98409, USA	47.2139038	-122.4731413	google_places	2026-05-28 16:26:22.958161+00	no_hh_found	3fb4a64d-b265-4f51-aa7e-eb41696e739a	2026-05-28 00:35:16.33524+00	2026-05-28 16:26:22.958161+00
a1a0c818-bb02-462c-9597-194de6b2abda	6d08439f-6aac-4bd2-bbba-99566b214b69	Thọ Tường BBQ	ChIJe5MoQPP_kFQRRnf2tcULQBY	715 S 38th St, Tacoma, WA 98418, USA	47.2232167	-122.4414972	google_places	2026-05-28 04:28:27.962454+00	\N	\N	2026-05-28 00:35:16.515342+00	2026-05-28 04:28:27.962454+00
7f1531fd-320a-4a77-abc4-a3e0a6bfc3cb	6d08439f-6aac-4bd2-bbba-99566b214b69	Taqueria El Sabor	ChIJI5tVDtiqkVQRhidSeAD5ans	1636 S Mildred St, Tacoma, WA 98465, USA	47.2453381	-122.5268881	google_places	2026-05-28 04:31:17.432316+00	\N	\N	2026-05-28 00:35:16.809505+00	2026-05-28 04:31:17.432316+00
60162700-fa53-4bc6-8632-7001e2d51824	6d08439f-6aac-4bd2-bbba-99566b214b69	Ivar's Seafood Bar	ChIJ4xTJVNiqkVQRxJ7LXQthzXo	1820 S Mildred St, Tacoma, WA 98465, USA	47.2436714	-122.5269699	google_places	2026-05-28 04:38:54.91897+00	confirmed_hh	c996fb9c-3ce1-4c70-8b49-993a9c2931e0	2026-05-28 00:35:16.812475+00	2026-05-28 04:38:54.91897+00
3f7c291c-0c47-4545-81bf-2e00ced0255a	6d08439f-6aac-4bd2-bbba-99566b214b69	Cooper's Food and Drink	ChIJIbfpv8ZVkFQRpB0X4HwsrRU	5928 N 26th St, Tacoma, WA 98407, USA	47.2708665	-122.5183557	google_places	2026-05-28 04:42:28.284146+00	confirmed_hh	ec8dd737-3038-48a6-8253-398551456eba	2026-05-28 00:35:17.393029+00	2026-05-28 04:42:28.284146+00
ddee5f32-b5f1-4a63-bdce-01ff97b77e4d	6d08439f-6aac-4bd2-bbba-99566b214b69	Taqueria Sinaloa	ChIJsfv_giBXkFQR6ZRaUd5r0I0	5916 29th St NE, Tacoma, WA 98422, USA	47.2824426	-122.3674888	google_places	2026-05-28 03:00:00.875291+00	error	\N	2026-05-28 00:35:18.41847+00	2026-05-28 03:00:00.875291+00
717709bd-4f6a-4712-b693-dae211ca4c82	117cbe36-eae9-45cf-b54f-df358dbb49c1	Tam's	ChIJdfFRKSsOK4cRR_mEIs03Hdg	1714 E Broadway Rd, Phoenix, AZ 85040, USA	33.4071042	-112.0443159	google_places	2026-05-28 05:04:55.272686+00	\N	\N	2026-05-28 04:48:11.672545+00	2026-05-28 05:04:55.272686+00
20dd688c-a147-460d-a309-90f9c0a2c9bc	117cbe36-eae9-45cf-b54f-df358dbb49c1	Taqueria Lucy	ChIJJTcrwt8TK4cRaQ1lPUY4Pls	2712 W Buckeye Rd, Phoenix, AZ 85009, USA	33.4369773	-112.1175121	google_places	2026-05-28 05:06:29.941187+00	\N	\N	2026-05-28 04:48:11.891755+00	2026-05-28 05:06:29.941187+00
6b1fcbfa-889e-443f-a146-278d3741dc35	6d08439f-6aac-4bd2-bbba-99566b214b69	Lobster Shop	ChIJyR-0BolUkFQRvI1rH74SNbU	4015 Ruston Way, Tacoma, WA 98402, USA	47.2877620	-122.4894560	google_places	2026-05-28 05:23:46.362868+00	confirmed_hh	47269131-e41b-4e1f-8309-fa42377fb3ee	2026-05-28 00:35:17.947504+00	2026-05-28 05:23:46.362868+00
1ef99935-407e-4a08-966d-5321477dbc23	6d08439f-6aac-4bd2-bbba-99566b214b69	Cliff House Restaurant	ChIJDXABqBhUkFQRiV_vCb2I37g	6300 Marine View Dr, Tacoma, WA 98422, USA	47.2975361	-122.4321644	google_places	2026-05-28 05:52:54.356558+00	confirmed_hh	7835dabe-de73-428b-98a7-bdab39639b8d	2026-05-28 00:35:18.415588+00	2026-05-28 05:52:54.356558+00
811bfaa2-a27d-43b0-b4bc-78fea1238777	117cbe36-eae9-45cf-b54f-df358dbb49c1	Fili's Bar & Grill	ChIJoflr_zARK4cRkRNS0daJUA4	4740 S 35th Ave, Phoenix, AZ 85041, USA	33.4034271	-112.1341780	google_places	\N	\N	\N	2026-05-28 04:48:11.895949+00	2026-05-28 04:48:11.895949+00
ccdc9468-9834-47b7-9189-a434db55a056	117cbe36-eae9-45cf-b54f-df358dbb49c1	Mexico Lindo Restaurant	ChIJ1b6tDeATK4cR1ko2dsyGou0	821 S 28th Ave, Phoenix, AZ 85009, USA	33.4396566	-112.1190748	google_places	\N	\N	\N	2026-05-28 04:48:11.897403+00	2026-05-28 04:48:11.897403+00
631a2330-4627-4267-ae85-900df9322868	117cbe36-eae9-45cf-b54f-df358dbb49c1	Tacos ️	ChIJy4WDNYQTK4cRfzVhiRDlwug	35th Ave &, W Lincoln St, Phoenix, AZ 85009, USA	33.4422640	-112.1346208	google_places	\N	\N	\N	2026-05-28 04:48:11.898733+00	2026-05-28 04:48:11.898733+00
f34b91b9-aa50-4caa-b1be-e5d147267e70	117cbe36-eae9-45cf-b54f-df358dbb49c1	Let Me Taco Bout It	ChIJtWrwkxwTK4cRy1SAWShwRwU	3158 W Buckeye Rd, Phoenix, AZ 85009, USA	33.4372105	-112.1296025	google_places	\N	\N	\N	2026-05-28 04:48:11.899742+00	2026-05-28 04:48:11.899742+00
750695a3-9f8c-4bc6-b80e-858b7cb27435	117cbe36-eae9-45cf-b54f-df358dbb49c1	THE TAQUERO	ChIJFRkeHQATK4cRafWHU4EPgVA	2501 W Buckeye Rd, Phoenix, AZ 85009, USA	33.4366833	-112.1139349	google_places	\N	\N	\N	2026-05-28 04:48:11.900699+00	2026-05-28 04:48:11.900699+00
9853bb6f-8cd4-4659-980e-6b0f4b2a9b54	117cbe36-eae9-45cf-b54f-df358dbb49c1	Restaurante	ChIJs105rlUTK4cRBj2gCA4zTLc	710 S 35th Ave, Phoenix, AZ 85009, USA	33.4406699	-112.1347250	google_places	\N	\N	\N	2026-05-28 04:48:11.901664+00	2026-05-28 04:48:11.901664+00
1068bf72-5ad6-453d-a3d3-27f68d24b906	117cbe36-eae9-45cf-b54f-df358dbb49c1	Santo Burrito (Inside The Smoked Jalapeno)	ChIJrUA8AIoTK4cRhRuH5WvBGi4	3497 W Lincoln St, Phoenix, AZ 85009, USA	33.4421387	-112.1342053	google_places	\N	\N	\N	2026-05-28 04:48:11.902531+00	2026-05-28 04:48:11.902531+00
d900730d-8e6a-4c92-b60e-6614ea99ce6c	117cbe36-eae9-45cf-b54f-df358dbb49c1	Pancho Vila	ChIJwzz_mT0RK4cRAbxJG2mRS28	2845 W Broadway Rd, Phoenix, AZ 85041, USA	33.4065022	-112.1203019	google_places	\N	\N	\N	2026-05-28 04:48:11.903352+00	2026-05-28 04:48:11.903352+00
0dbe109d-f1af-44d2-ae52-a977222f6401	117cbe36-eae9-45cf-b54f-df358dbb49c1	Villa del mar	ChIJgYulaQARK4cRoBrcZ2Ca0y8	3116 W Mohave St, Phoenix, AZ 85009, USA	33.4316780	-112.1269014	google_places	\N	\N	\N	2026-05-28 04:48:11.90414+00	2026-05-28 04:48:11.90414+00
88f2e595-9dd7-454d-a024-5591f5e72158	117cbe36-eae9-45cf-b54f-df358dbb49c1	El Rincón Casero	ChIJNZpMWAARK4cRDV8NI8XVi18	1433 S 30th Ave, Phoenix, AZ 85009, USA	33.4337246	-112.1235404	google_places	\N	\N	\N	2026-05-28 04:48:11.905176+00	2026-05-28 04:48:11.905176+00
8b6fb884-4713-4ab4-986d-f64d7b57dc3e	117cbe36-eae9-45cf-b54f-df358dbb49c1	BurritoLoco HotSos	ChIJW-19CgATK4cRA_s3kTD_ZHs	2446 W Buckeye Rd, Phoenix, AZ 85009, USA	33.4370864	-112.1127224	google_places	2026-05-28 05:06:29.360518+00	no_hh_found	284f62fe-9820-4784-8ec5-11e52a14929d	2026-05-28 04:48:11.890879+00	2026-05-28 05:06:29.360518+00
a3e76d23-7e31-4d6e-a78d-79cd131cd71b	117cbe36-eae9-45cf-b54f-df358dbb49c1	carniceria los 3 potrillos	ChIJwQd2LVETK4cRylV7ib4qNV4	3202 W Buckeye Rd, Phoenix, AZ 85009, USA	33.4371361	-112.1301479	google_places	2026-05-28 05:06:30.002783+00	\N	\N	2026-05-28 04:48:11.892578+00	2026-05-28 05:06:30.002783+00
d071c0b7-3bf6-4583-92bd-dfa98350d789	6d08439f-6aac-4bd2-bbba-99566b214b69	Taqueria Sinaloa	ChIJjQ1AHA1WkFQR1w9QU8733X8	1941 State Rte 509, Tacoma, WA 98422, USA	47.2715779	-122.3734355	google_places	2026-05-28 05:53:32.94583+00	\N	\N	2026-05-28 00:35:18.417624+00	2026-05-28 05:53:32.94583+00
891ba87e-3aa7-4499-bfa7-de3b5218f9bf	6d08439f-6aac-4bd2-bbba-99566b214b69	What a Catch	ChIJLTqpWn5TkFQR5Xn_WuotGn4	5115 Grand Loop, Tacoma, WA 98407, USA	47.2996882	-122.5048324	google_places	2026-05-28 05:57:16.811788+00	\N	\N	2026-05-28 00:35:18.659455+00	2026-05-28 05:57:16.811788+00
bb2d71ea-bff1-4791-812d-d1a368e843ac	6d08439f-6aac-4bd2-bbba-99566b214b69	Hob Nob Restaurant	ChIJe9yIywlVkFQRxfPPQ1frDZ0	716 6th Ave, Tacoma, WA 98405, USA	47.2575027	-122.4479285	google_places	2026-05-28 05:05:06.683484+00	confirmed_hh	46c02e15-b0d5-404a-93b9-852c734bf4c1	2026-05-28 00:35:17.631358+00	2026-05-28 05:05:06.683484+00
3e4f188b-7093-4bae-bb2b-2da26f95a5eb	117cbe36-eae9-45cf-b54f-df358dbb49c1	Bertha's Restaurant "El sabor de los Mochis"	ChIJQ3az2qgTK4cR2riwd-PbRro	1212 S 28th Ave, Phoenix, AZ 85009, USA	33.4364007	-112.1197542	google_places	2026-05-28 05:06:27.377611+00	error	\N	2026-05-28 04:48:11.887607+00	2026-05-28 05:06:27.377611+00
222b07ab-1d4e-4592-8718-ab7ee6bb2c59	117cbe36-eae9-45cf-b54f-df358dbb49c1	La Frontera #2	ChIJm_5Kb_oTK4cRtyiEm1HKg0A	3501 W Lincoln St, Phoenix, AZ 85009, USA	33.4422332	-112.1350142	google_places	2026-05-28 05:06:28.368991+00	no_hh_found	62ac51f5-97fd-46f7-aa8d-4aa956950ed0	2026-05-28 04:48:11.889068+00	2026-05-28 05:06:28.368991+00
d89fa988-762a-4e88-bb94-d73ecadaed46	117cbe36-eae9-45cf-b54f-df358dbb49c1	Durango Grill	ChIJ56cFXlcRK4cR7V57f648D8s	3341 S 35th Ave & W Durango St, Phoenix, AZ 85009, USA	33.4286418	-112.1319080	google_places	2026-05-28 05:06:28.94195+00	\N	\N	2026-05-28 04:48:11.890033+00	2026-05-28 05:06:28.94195+00
c23071c8-a556-43cd-8106-3c019b191108	117cbe36-eae9-45cf-b54f-df358dbb49c1	Tacos dorados y chimis el cuate	ChIJAXHK10ATK4cRJnL9-QeaaYY	3902 W Buckeye Rd, Phoenix, AZ 85009, USA	33.4373005	-112.1434830	google_places	2026-05-28 05:06:30.087912+00	\N	\N	2026-05-28 04:48:11.893522+00	2026-05-28 05:06:30.087912+00
6f275d9b-c86f-46e3-96fe-7444833d7226	117cbe36-eae9-45cf-b54f-df358dbb49c1	JL Smokehouse BBQ	ChIJqQ-XLCsOK4cR4S46glVtTWY	2010 E Broadway Rd, Phoenix, AZ 85040, USA	33.4070918	-112.0379866	google_places	2026-05-28 05:04:55.34541+00	\N	\N	2026-05-28 04:48:11.673713+00	2026-05-28 05:04:55.34541+00
42ec3780-e891-4e6c-9407-7e406453310c	117cbe36-eae9-45cf-b54f-df358dbb49c1	Tacos El Atoyac	ChIJSSjygCcVK4cRvLfr8OPdBbM	3902 W Buckeye Rd, Phoenix, AZ 85009, USA	33.4373258	-112.1434842	google_places	2026-05-28 05:06:30.151914+00	\N	\N	2026-05-28 04:48:11.894729+00	2026-05-28 05:06:30.151914+00
3ef4d519-ad23-4faa-9a72-9bf51c6ebbd9	6d08439f-6aac-4bd2-bbba-99566b214b69	Memo's Mexican Restaurant	ChIJX67fVgVVkFQRoXfyguUUiPE	1703 6th Ave, Tacoma, WA 98405, USA	47.2563541	-122.4618353	google_places	2026-05-28 05:17:56.262864+00	\N	\N	2026-05-28 00:35:17.638483+00	2026-05-28 05:17:56.262864+00
b210ef62-5264-40ff-bd0a-41add3eb01e1	6d08439f-6aac-4bd2-bbba-99566b214b69	Woobling Korean BBQ - Tacoma Mall	ChIJYTjY82YBkVQRF5Nq9pJtQ00	4502 S Steele St #1510, Tacoma, WA 98409, USA	47.2149433	-122.4671490	google_places	2026-05-28 04:31:16.860694+00	confirmed_hh	67e6dd9a-6128-4644-9524-74d6dc70bf90	2026-05-28 00:35:16.519154+00	2026-05-28 04:31:16.860694+00
e81f8a55-a2c6-4e26-b1ef-3cb52a32c70b	6d08439f-6aac-4bd2-bbba-99566b214b69	Loak Toung Thai	ChIJ71UpqUxVkFQRZHEY9vqCq8E	3807 Center St, Tacoma, WA 98409, USA	47.2316011	-122.4865257	google_places	2026-05-28 16:30:19.777693+00	no_hh_found	980af0d3-6bbc-4426-968d-9af26a33d24a	2026-05-28 00:35:16.810702+00	2026-05-28 16:30:19.777693+00
215c2000-7685-472c-b71b-9858915c717e	6d08439f-6aac-4bd2-bbba-99566b214b69	The Tipsy Tomato Bar & Kitchen	ChIJQZKXWbOqkVQRd8-YlNZnr_U	3878 Center St, Tacoma, WA 98409, USA	47.2310710	-122.4882577	google_places	2026-05-28 04:38:55.831893+00	no_hh_found	05c5e2f7-0a19-41cd-9641-e3eb3a6bdc99	2026-05-28 00:35:16.813313+00	2026-05-28 04:38:55.831893+00
8bb248c2-bbce-4cbb-9369-dea9f66f098a	117cbe36-eae9-45cf-b54f-df358dbb49c1	Las Delicias Restaurant	ChIJewA-LNkTK4cRJi8BJdgmt-8	2446 W Hadley St, Phoenix, AZ 85009, USA	33.4396514	-112.1128880	google_places	\N	\N	\N	2026-05-28 04:48:12.103086+00	2026-05-28 04:48:12.103086+00
c3b389b6-111d-4cba-a81d-c82a6d18e9ee	117cbe36-eae9-45cf-b54f-df358dbb49c1	Super Oscar's Mexican Food	ChIJGZXjcNYHK4cRQMcEYNABCso	2001 S 7th Ave, Phoenix, AZ 85007, USA	33.4298883	-112.0821517	google_places	\N	\N	\N	2026-05-28 04:48:12.105333+00	2026-05-28 04:48:12.105333+00
dde31710-47da-4eb1-941f-1d8327108b30	117cbe36-eae9-45cf-b54f-df358dbb49c1	Reggie's Bar-B-Q	ChIJa7OA0I8TK4cRE4SM4yAXqBY	730 S 15th Ave, Phoenix, AZ 85007, USA	33.4406811	-112.0915731	google_places	\N	\N	\N	2026-05-28 04:48:12.107116+00	2026-05-28 04:48:12.107116+00
be4ae80f-2c0c-4808-99d5-8822fe4eb5e8	117cbe36-eae9-45cf-b54f-df358dbb49c1	Que Suave Taco Shop	ChIJwyTwdxMRK4cRZWfRwbBGsdQ	1855 W Corona Ave #2, Phoenix, AZ 85041, USA	33.4051037	-112.0991199	google_places	\N	\N	\N	2026-05-28 04:48:12.110271+00	2026-05-28 04:48:12.110271+00
0dfd1088-5e5c-4e32-8ffd-370128439a10	117cbe36-eae9-45cf-b54f-df358dbb49c1	Horseshoe Restaurant	ChIJ1b4FQ30RK4cRztohrIBX4JU	2140 W Buckeye Rd, Phoenix, AZ 85009, USA	33.4369359	-112.1060370	google_places	\N	\N	\N	2026-05-28 04:48:12.112333+00	2026-05-28 04:48:12.112333+00
7f4c95e1-4da5-4927-a000-06fdcc21b05d	117cbe36-eae9-45cf-b54f-df358dbb49c1	Mariscos El Profe	ChIJR_SlfwARK4cRDEHDOROYGVw	2301 W Buckeye Rd, Phoenix, AZ 85009, USA	33.4362747	-112.1092028	google_places	\N	\N	\N	2026-05-28 04:48:12.117398+00	2026-05-28 04:48:12.117398+00
4ccd37f1-9e0b-4d47-adc5-189245f05be9	6d08439f-6aac-4bd2-bbba-99566b214b69	Woven Seafood & Chophouse	ChIJ_2IfXABVkFQRwEZBUQpsRBo	3017 Ruston Way, Tacoma, WA 98402, USA	47.2802023	-122.4757995	google_places	2026-05-28 05:36:06.859962+00	confirmed_hh	2ed6e99b-59dd-47a7-8513-42e238c95e57	2026-05-28 00:35:18.110558+00	2026-05-28 05:36:06.859962+00
6e4df82c-c146-4084-ba98-9d5a6df8f6ae	6d08439f-6aac-4bd2-bbba-99566b214b69	Katie Downs Waterfront Tavern	ChIJWamQE_VUkFQRJaV5sgykO2s	3211 Ruston Way, Tacoma, WA 98402, USA	47.2816327	-122.4788388	google_places	2026-05-28 05:38:52.508365+00	confirmed_hh	206b4cb8-9441-4ad1-95af-59d1bd3a043a	2026-05-28 00:35:18.111323+00	2026-05-28 05:38:52.508365+00
46cba7f1-800e-4675-99aa-1ef51fc4e168	6d08439f-6aac-4bd2-bbba-99566b214b69	Cooks Tavern	ChIJ8dnI8vpUkFQRTbY1noWVlU0	3201 N 26th St, Tacoma, WA 98407, USA	47.2711890	-122.4779301	google_places	2026-05-28 05:41:04.594678+00	confirmed_hh	7c9c5219-668d-4842-b458-92ed04599bd8	2026-05-28 00:35:18.112167+00	2026-05-28 05:41:04.594678+00
b25bc569-b54b-4f27-a544-e5406372dfe3	6d08439f-6aac-4bd2-bbba-99566b214b69	Harbor Lights	ChIJbXHrC_ZUkFQRHHhmyDgICok	2761 Ruston Way, Tacoma, WA 98402, USA	47.2792004	-122.4744305	google_places	2026-05-28 05:42:52.910187+00	confirmed_hh	14cba4a7-3820-4823-8f52-97208ce749ed	2026-05-28 00:35:18.116877+00	2026-05-28 05:42:52.910187+00
8209b291-4426-494f-b463-809054eedbc4	117cbe36-eae9-45cf-b54f-df358dbb49c1	Tacos La Cabeza	ChIJ71q2Cv8TK4cR0k9IG3QNyys	220 S 27th Ave, Phoenix, AZ 85009, USA	33.4453160	-112.1176970	google_places	\N	\N	\N	2026-05-28 04:48:12.119037+00	2026-05-28 04:48:12.119037+00
54a763a7-d050-421d-b8af-acabc4c7037b	6d08439f-6aac-4bd2-bbba-99566b214b69	McMenamins Pub at Elks Temple	ChIJG4_tEtNVkFQR8miBHOlsVo0	565 Broadway, Tacoma, WA 98402, USA	47.2579654	-122.4409506	google_places	2026-05-28 05:48:39.578055+00	confirmed_hh	a011b25c-cf48-4f38-9a99-1c3ebe21b351	2026-05-28 00:35:18.279138+00	2026-05-28 05:48:39.578055+00
64e5f82d-a74c-4f07-82ec-c8a21b4f34ad	6d08439f-6aac-4bd2-bbba-99566b214b69	Al Bacha	ChIJvSlS6G1VkFQR1PsAfpr30zM	112 S 9th St, Tacoma, WA 98402, USA	47.2553844	-122.4384563	google_places	2026-05-28 05:49:37.972784+00	\N	\N	2026-05-28 00:35:18.281369+00	2026-05-28 05:49:37.972784+00
949aa2bc-6e50-4825-9a82-4c41b88c8b3d	6d08439f-6aac-4bd2-bbba-99566b214b69	Twisted Fork Saloon	ChIJKYuJksFTkFQR0PwA8geyqwc	5005 Main St, Tacoma, WA 98407, USA	47.2983254	-122.5039835	google_places	2026-05-28 05:56:41.16769+00	confirmed_hh	36fccf79-e2a8-4d10-bba9-853a6fb993c5	2026-05-28 00:35:18.657915+00	2026-05-28 05:56:41.16769+00
4500e9b3-1870-4393-99d8-1c1b9c248d7e	6d08439f-6aac-4bd2-bbba-99566b214b69	Zen ramen & sushi burrito	ChIJN2Up4_irkVQR-WuSjrQsaF8	1812 S Mildred St, Tacoma, WA 98465, USA	47.2442727	-122.5267481	google_places	\N	\N	\N	2026-05-28 00:35:16.811619+00	2026-05-28 16:23:57.110548+00
1ea53227-4745-4062-8de8-d92c10a2fc48	117cbe36-eae9-45cf-b54f-df358dbb49c1	Lo-Lo's Chicken & Waffles	ChIJGQmaBY0RK4cRgzKNdHWS_L0	1220 S Central Ave, Phoenix, AZ 85003, USA	33.4354002	-112.0740454	google_places	\N	\N	\N	2026-05-28 04:48:12.271941+00	2026-05-28 04:48:12.271941+00
5cd327fb-2e89-4716-8dbb-9ec1f13e5848	117cbe36-eae9-45cf-b54f-df358dbb49c1	The Duce	ChIJPbqQ7YoRK4cRJ39Z_C6ie5w	525 S Central Ave, Phoenix, AZ 85004, USA	33.4424659	-112.0735050	google_places	\N	\N	\N	2026-05-28 04:48:12.273206+00	2026-05-28 04:48:12.273206+00
2fe1cf98-e238-4c19-8c24-099e60eb4a79	117cbe36-eae9-45cf-b54f-df358dbb49c1	Saddle Horn Bar	ChIJu25ggGIRK4cRtuoILLkTAdM	2338 W Buckeye Rd, Phoenix, AZ 85009, USA	33.4370440	-112.1101490	google_places	\N	\N	\N	2026-05-28 04:48:12.101384+00	2026-05-28 04:48:12.806123+00
798d6016-d2a6-4676-b224-c5f457b693d4	117cbe36-eae9-45cf-b54f-df358dbb49c1	Wren & Wolf	ChIJLd4xpt0TK4cRqoZk9Xt6KYc	2 N Central Ave #101, Phoenix, AZ 85004, USA	33.4484150	-112.0749091	google_places	\N	\N	\N	2026-05-28 04:48:12.268566+00	2026-05-28 04:48:14.059893+00
46dc5231-67f9-4308-882f-d074de82be7b	117cbe36-eae9-45cf-b54f-df358dbb49c1	The Arrogant Butcher	ChIJ2UT2ryESK4cR1gSXHi3SKeg	2 E Jefferson St #150, Phoenix, AZ 85004, USA	33.4474000	-112.0728342	google_places	\N	\N	\N	2026-05-28 04:48:12.269984+00	2026-05-28 04:48:13.341922+00
32e85d62-4eba-4b5a-9a14-db5e2791534b	117cbe36-eae9-45cf-b54f-df358dbb49c1	Liyuen	ChIJAQtyko8RK4cRyPZgqGQ6SL8	1602 S 7th Ave, Phoenix, AZ 85007, USA	33.4330028	-112.0827538	google_places	\N	\N	\N	2026-05-28 04:48:12.096185+00	2026-05-28 04:48:12.996632+00
2d53d134-e53d-41c1-a3d9-6223c40c4c28	6d08439f-6aac-4bd2-bbba-99566b214b69	Toast Mi Tacoma	ChIJBd7vgFNVkFQRrkKh5-KFkgA	2602 N Proctor St Suite D, Tacoma, WA 98407, USA	47.2713449	-122.4892265	google_places	2026-05-28 05:33:49.912951+00	\N	\N	2026-05-28 00:35:17.96074+00	2026-05-28 05:33:49.912951+00
80ed5e52-3d97-4d4d-a511-67a047f6fa3d	117cbe36-eae9-45cf-b54f-df358dbb49c1	Chico Malo	ChIJgxpSCiESK4cRig4N7YfFxdc	50 W Jefferson St, Phoenix, AZ 85003, USA	33.4473465	-112.0740786	google_places	\N	\N	\N	2026-05-28 04:48:12.27478+00	2026-05-28 04:48:13.165429+00
dc52d22a-471c-4527-a2b3-9f86b70aad0e	6d08439f-6aac-4bd2-bbba-99566b214b69	Ram Restaurant & Brewery	ChIJ4YLV-vVUkFQRMuhYvHycVz0	3001 Ruston Way, Tacoma, WA 98402, USA	47.2797352	-122.4747478	google_places	2026-05-28 05:35:08.889134+00	confirmed_hh	c2f25fe4-8378-42d0-b404-312d71156b57	2026-05-28 00:35:18.108846+00	2026-05-28 05:35:08.889134+00
66320415-d844-4c70-952d-c77a25d981b3	117cbe36-eae9-45cf-b54f-df358dbb49c1	Blanco Cocina + Cantina	ChIJE1d9BRETK4cRvY-17NlyKBo	123 E Washington St, Phoenix, AZ 85004, USA	33.4480876	-112.0714863	google_places	\N	\N	\N	2026-05-28 04:48:12.270991+00	2026-05-28 04:48:13.34394+00
0b5bad41-35f5-4890-bb70-d6942985c976	6d08439f-6aac-4bd2-bbba-99566b214b69	KIMCHI BOX	ChIJOeXzx_OrkVQRX5G-F_0oX7Q	4916 Center St Ste D, Tacoma, WA 98409, USA	47.2338243	-122.5035449	google_places	\N	\N	\N	2026-05-28 00:35:16.814053+00	2026-05-28 16:23:57.110548+00
bdb4572a-1c69-4ff6-8ba8-43fc19298cd9	6d08439f-6aac-4bd2-bbba-99566b214b69	The Red Hot	ChIJkSY-BBlVkFQRtFU0s3zHl90	2914 6th Ave, Tacoma, WA 98406, USA	47.2550877	-122.4745574	google_places	\N	\N	\N	2026-05-28 00:35:18.120072+00	2026-05-28 16:23:57.110548+00
7a1bfa6f-7365-4e45-81a4-18e8d0a6e15e	6d08439f-6aac-4bd2-bbba-99566b214b69	Restaurante Los Amigos	ChIJSRfmR2sAkVQRr4dO-b-xZR4	6402 S Tacoma Way, Tacoma, WA 98409, USA	47.1986278	-122.4846501	google_places	2026-05-28 04:19:41.906774+00	no_hh_found	74c6c578-bcb2-4660-b260-7aa6832d7cae	2026-05-28 00:35:16.152923+00	2026-05-28 04:19:41.906774+00
729fd771-90df-4307-8d90-7a17d30429ef	6d08439f-6aac-4bd2-bbba-99566b214b69	Airport Tavern Music Hall	ChIJ5b2eZA4AkVQRXtrJP_Yb324	5406 S Tacoma Way, Tacoma, WA 98409, USA	47.2077879	-122.4841828	google_places	2026-05-28 04:25:50.675797+00	confirmed_hh	ab76e992-6499-4593-8954-7963cc7e5d9f	2026-05-28 00:35:16.336911+00	2026-05-28 04:25:50.675797+00
f73a7a88-9948-4225-adac-da7f2c34a7ef	117cbe36-eae9-45cf-b54f-df358dbb49c1	Comedor Guadalajara	ChIJx7dFDZMRK4cRrA_lJcXDD30	1830 S Central Ave, Phoenix, AZ 85004, USA	33.4294080	-112.0741893	google_places	\N	\N	\N	2026-05-28 04:48:12.282254+00	2026-05-28 04:48:12.282254+00
b00ee21f-637e-432a-8309-cf297fffbc06	117cbe36-eae9-45cf-b54f-df358dbb49c1	Mancuso's Restaurant	ChIJMW-FmxV0K4cR_Y7wErDIl2g	201 E Washington St Suite 201, Phoenix, AZ 85004, USA	33.4476635	-112.0702981	google_places	\N	\N	\N	2026-05-28 04:48:12.286475+00	2026-05-28 04:48:12.286475+00
bceecf6b-487b-4308-87e8-33e48c475666	117cbe36-eae9-45cf-b54f-df358dbb49c1	Stadium Sports Bar & Lounge	ChIJ35A3g1ETK4cRHOjuOwlZh7A	50 W Jefferson St STE 280, Phoenix, AZ 85003, USA	33.4477227	-112.0746375	google_places	\N	\N	\N	2026-05-28 04:48:12.288499+00	2026-05-28 04:48:12.288499+00
ed6c548e-33f4-4861-bae7-a8831e6763a2	117cbe36-eae9-45cf-b54f-df358dbb49c1	Blue Hound Kitchen & Cocktails	ChIJmxfxryESK4cRgn7Xbv3NaFk	2 E Jefferson St, Phoenix, AZ 85004, USA	33.4475746	-112.0734047	google_places	\N	\N	\N	2026-05-28 04:48:12.290526+00	2026-05-28 04:48:12.290526+00
f539898f-562e-482f-8697-c3b55e726c9a	117cbe36-eae9-45cf-b54f-df358dbb49c1	Bitter & Twisted Cocktail Parlour	ChIJadD9riESK4cRjJc5tJ2FLIQ	1 W Jefferson St, Phoenix, AZ 85003, USA	33.4470247	-112.0739397	google_places	\N	\N	\N	2026-05-28 04:48:12.291635+00	2026-05-28 04:48:12.291635+00
8c061f61-4d67-45b5-88d9-6fc757f7a64a	117cbe36-eae9-45cf-b54f-df358dbb49c1	Crown Public House	ChIJVfgugfsTK4cRiR2QyP3GJJU	333 E Jefferson St, Phoenix, AZ 85004, USA	33.4461085	-112.0690431	google_places	\N	\N	\N	2026-05-28 04:48:12.292595+00	2026-05-28 04:48:12.292595+00
69185464-d3b5-494b-b1e0-9506239796ec	117cbe36-eae9-45cf-b54f-df358dbb49c1	Dog Haus Biergarten	ChIJN37AnPgTK4cRKOEDqgRExyA	1 E Washington St #120, Phoenix, AZ 85004, USA	33.4480155	-112.0737253	google_places	\N	\N	\N	2026-05-28 04:48:12.293638+00	2026-05-28 04:48:12.293638+00
427a18bb-59d7-4f16-8e8d-7163e8200156	117cbe36-eae9-45cf-b54f-df358dbb49c1	Little Rituals	ChIJ31lrTC8TK4cRQTQGXQRCQ2c	132 S Central Ave 4th Floor, Phoenix, AZ 85004, USA	33.4464073	-112.0741383	google_places	\N	\N	\N	2026-05-28 04:48:12.294763+00	2026-05-28 04:48:12.294763+00
ec25c6ff-3094-4eef-8a80-c585cb85cc27	117cbe36-eae9-45cf-b54f-df358dbb49c1	The Original Carolina's Mexican Food	ChIJ6-bJLuQRK4cRA-DNxqT3WSA	1202 E Mohave St, Phoenix, AZ 85034, USA	33.4315051	-112.0560518	google_places	\N	\N	\N	2026-05-28 04:48:12.283616+00	2026-05-28 04:48:12.436259+00
013ca8c4-c2d5-47ac-980d-56fbaa043a5d	117cbe36-eae9-45cf-b54f-df358dbb49c1	Los Cuatro Nietos AZ & Bird Brainz	ChIJKyL14DERK4cRXARghEi62HY	1820 S 7th St, Phoenix, AZ 85034, USA	33.4303802	-112.0661944	google_places	\N	\N	\N	2026-05-28 04:48:12.439491+00	2026-05-28 04:48:12.439491+00
0bb834b9-5f1b-4c84-a0a7-00129a72a128	117cbe36-eae9-45cf-b54f-df358dbb49c1	Wong's Chinese Dining	ChIJf_QdLPsRK4cRFcfM1T9s7Z0	1139 E Buckeye Rd, Phoenix, AZ 85034, USA	33.4366699	-112.0566584	google_places	\N	\N	\N	2026-05-28 04:48:12.440379+00	2026-05-28 04:48:12.440379+00
debb2220-0bc8-476d-8a06-5de974f09470	117cbe36-eae9-45cf-b54f-df358dbb49c1	WtfExp	ChIJbVFnnvoRK4cRVZOZXKLjFRQ	1024 E Buckeye Rd suite 180, Phoenix, AZ 85034, USA	33.4372031	-112.0594087	google_places	\N	\N	\N	2026-05-28 04:48:12.445036+00	2026-05-28 04:48:12.445036+00
683a70c8-d77c-40c4-98f8-3b6a8bbe02ee	117cbe36-eae9-45cf-b54f-df358dbb49c1	El Pollo Correteado	ChIJWd1gHwAOK4cRX5PkapNDYHE	1602 E Jefferson St, Phoenix, AZ 85034, USA	33.4475889	-112.0473780	google_places	\N	\N	\N	2026-05-28 04:48:12.448503+00	2026-05-28 04:48:12.448503+00
ef143a64-9038-4aa7-af37-f2396715cae7	117cbe36-eae9-45cf-b54f-df358dbb49c1	Pitic Restaurant and Lounge	ChIJ-z51BeIRK4cRNDEWrSASYC8	1580 E Pima St, Phoenix, AZ 85034, USA	33.4335130	-112.0486790	google_places	\N	\N	\N	2026-05-28 04:48:12.451086+00	2026-05-28 04:48:12.451086+00
901600d8-6e6e-4fc2-a64b-755101c93fc6	117cbe36-eae9-45cf-b54f-df358dbb49c1	Dora's Kitchen	ChIJzxArYN8RK4cREYtjnGeCiH8	2355 S 16th St, Phoenix, AZ 85034, USA	33.4233856	-112.0474548	google_places	\N	\N	\N	2026-05-28 04:48:12.454608+00	2026-05-28 04:48:12.454608+00
b44773c8-1365-425c-9e76-3abb1c203348	117cbe36-eae9-45cf-b54f-df358dbb49c1	Wildflower	ChIJ21m5F_UOK4cRsjd6RB21yVI	3400 Sky Hbr Blvd, American airlines, 85034 concourse 4 Gate A9, Phoenix, AZ 85034, USA	33.4376823	-111.9992026	google_places	\N	\N	\N	2026-05-28 04:48:12.622932+00	2026-05-28 04:48:12.622932+00
618e0997-cf69-4c79-a882-e0933a0ae4c7	6d08439f-6aac-4bd2-bbba-99566b214b69	Meadow Park Golf Course	ChIJvTINLX0AkVQRiiT7Anbyl-E	7108 Lakewood Dr W, Tacoma, WA 98467, USA	47.1928204	-122.5101230	google_places	2026-05-28 02:46:35.392128+00	\N	\N	2026-05-27 21:09:48.419707+00	2026-05-28 02:46:35.392128+00
56c45466-0442-4570-801f-97187bcf4ada	117cbe36-eae9-45cf-b54f-df358dbb49c1	Xami Sushi	ChIJ51FHagAPK4cRY4hhDF-R8gs	2707 E Broadway Rd, Phoenix, AZ 85040, USA	33.4066785	-112.0236739	google_places	\N	\N	\N	2026-05-28 04:48:12.4535+00	2026-05-28 04:48:12.625815+00
a6e1ad28-1050-40da-ab3a-ffb208dbbe67	117cbe36-eae9-45cf-b54f-df358dbb49c1	ROSSO ITALIAN	ChIJnWkLgm8TK4cRjUWpmCDbIfA	2 E Jefferson St #113, Phoenix, AZ 85004, USA	33.4474586	-112.0728265	google_places	\N	\N	\N	2026-05-28 04:48:12.279157+00	2026-05-28 04:48:13.351321+00
713c7c27-1da2-4902-ad37-91304314a1d0	6d08439f-6aac-4bd2-bbba-99566b214b69	Chuck E. Cheese	ChIJT0lTYf3_kFQRgW-ic8GxBng	4911 Tacoma Mall Blvd, Tacoma, WA 98409, USA	47.2121538	-122.4633284	google_places	2026-05-28 02:56:46.055939+00	\N	\N	2026-05-28 00:35:16.516122+00	2026-05-28 02:56:46.055939+00
f8496d92-44a4-45bb-9e9b-08c0f923bcd7	117cbe36-eae9-45cf-b54f-df358dbb49c1	Ingo’s Tasty Food	ChIJ6S9oOegTK4cRExZ14yvkWJ4	101 E Washington St Suite A, Phoenix, AZ 85004, USA	33.4479645	-112.0723302	google_places	\N	\N	\N	2026-05-28 04:48:12.280536+00	2026-05-28 04:48:13.356027+00
a721b54e-3258-4b42-bdd5-efa23270d0bd	6d08439f-6aac-4bd2-bbba-99566b214b69	Kizuki Ramen & Izakaya (Tacoma Mall)	ChIJZW8KR8X_kFQRYQ4vTYaZae4	4502 S Steele St Suite 501A, Tacoma, WA 98409, USA	47.2165555	-122.4673336	google_places	2026-05-28 16:29:05.812518+00	no_hh_found	b54309be-dfc2-4d0f-8343-211a2e608654	2026-05-28 00:35:16.517687+00	2026-05-28 16:29:05.812518+00
2774d71c-4254-43e3-8225-56bbc31bf14b	117cbe36-eae9-45cf-b54f-df358dbb49c1	Chelsea's Kitchen	ChIJ66w6MfUOK4cRWWeh7OECH9Q	4 Sky Hbr Blvd, Phoenix, AZ 85034, USA	33.4357463	-111.9981740	google_places	\N	\N	\N	2026-05-28 04:48:12.619202+00	2026-05-28 04:48:13.525794+00
81a44f8b-284f-4a66-919f-5c881f9bfe34	117cbe36-eae9-45cf-b54f-df358dbb49c1	Chase Sapphire Lounge by The Club PHX	ChIJf30POckPK4cR88wndLUZuWQ	Phoenix Sky Harbor International Airport, Maricopa County, Terminal 4, Phoenix, AZ 85034, USA	33.4345451	-112.0011541	google_places	\N	\N	\N	2026-05-28 04:48:12.620277+00	2026-05-28 04:48:13.527467+00
b89fc960-1ce8-466d-8a54-c1e3bfe61ce4	117cbe36-eae9-45cf-b54f-df358dbb49c1	Pedal Haus Brewery	ChIJ3wHfhj0PK4cRzA5O5xtRMzc	Terminal 4, 3400 Sky Hbr Blvd Level 3, Phoenix, AZ 85034, USA	33.4346095	-112.0012821	google_places	\N	\N	\N	2026-05-28 04:48:12.621763+00	2026-05-28 04:48:13.531589+00
17435178-70cf-4011-b00a-dcba570e98aa	117cbe36-eae9-45cf-b54f-df358dbb49c1	El Güero Birria de Chivo	ChIJTa1Ts00PK4cRWWxuNICL8hQ	3611 S 16th St, Phoenix, AZ 85040, USA	33.4134328	-112.0467484	google_places	2026-05-28 05:04:55.152651+00	\N	\N	2026-05-28 04:48:11.671501+00	2026-05-28 05:04:55.152651+00
8b9a6de9-10fc-4667-b82f-7500be9e6135	6d08439f-6aac-4bd2-bbba-99566b214b69	The Loose Wheel Bar & Grill - Tacoma	ChIJUXWJviyrkVQRYujEySByMu0	6108 6th Ave, Tacoma, WA 98406, USA	47.2550857	-122.5197791	google_places	\N	\N	\N	2026-05-28 00:35:17.39819+00	2026-05-28 16:23:57.110548+00
dcde4639-6cff-4d45-84a5-b4d5fc0610da	117cbe36-eae9-45cf-b54f-df358dbb49c1	USO Phoenix	ChIJH8EL3fQOK4cRhQSrsiOxEEM	3800 Sky Hbr Blvd, Phoenix, AZ 85034, USA	33.4352284	-111.9978273	google_places	\N	\N	\N	2026-05-28 04:48:12.626864+00	2026-05-28 04:48:12.626864+00
38bc6904-fe34-4b8a-90a0-0a5c8eaa3a36	117cbe36-eae9-45cf-b54f-df358dbb49c1	Olive & Ivy	ChIJJ2vAsYoOK4cRrSK5w2DvLTw	3400 Sky Hbr Blvd, Phoenix, AZ 85034, USA	33.4368878	-111.9992017	google_places	\N	\N	\N	2026-05-28 04:48:12.62794+00	2026-05-28 04:48:12.62794+00
2416d13f-bf61-4d9b-b275-b2e5d001dc40	117cbe36-eae9-45cf-b54f-df358dbb49c1	Wildflower	ChIJI8r4l4oOK4cRM3aSxtZfAck	3400 E. Sky Harbor Blvd., Terminal 4, Concourse N2 Space F-30, Phoenix, AZ 85034, USA	33.4354002	-111.9978269	google_places	\N	\N	\N	2026-05-28 04:48:12.628789+00	2026-05-28 04:48:12.628789+00
4f1581ca-44dc-4704-9e0e-f4de14a32709	117cbe36-eae9-45cf-b54f-df358dbb49c1	Blanco Tacos and Tequilas	ChIJMxrTr4oOK4cRjxwoQmOPxlA	3400 Sky Hbr Blvd, Phoenix, AZ 85034, USA	33.4370872	-111.9992023	google_places	\N	\N	\N	2026-05-28 04:48:12.629635+00	2026-05-28 04:48:12.629635+00
140f9efc-696f-4062-8475-35da177e20da	117cbe36-eae9-45cf-b54f-df358dbb49c1	Asadero El Fogon	ChIJSTswg4YPK4cRUEGIwbxWc8Y	2803 E Broadway Rd, Phoenix, AZ 85040, USA	33.4065551	-112.0208720	google_places	\N	\N	\N	2026-05-28 04:48:12.630789+00	2026-05-28 04:48:12.630789+00
d13ef98b-0822-42bb-a39b-411a673de286	6d08439f-6aac-4bd2-bbba-99566b214b69	Steel Creek Tacoma	ChIJad1RrgpVkFQRylhJpMPGW0w	1114 Broadway, Tacoma, WA 98402, USA	47.2525978	-122.4403127	google_places	2026-05-28 05:06:20.736778+00	confirmed_hh	bc36476a-7f26-4cf2-94d3-d34f6ef2acf4	2026-05-28 00:35:17.632137+00	2026-05-28 05:06:20.736778+00
37bea03b-0f50-4520-a07a-1ab50702232b	6d08439f-6aac-4bd2-bbba-99566b214b69	Dirty Oscar's Annex	ChIJ009IXRpVkFQR4rqVeHBSfyc	2309 6th Ave, Tacoma, WA 98403, USA	47.2557089	-122.4676113	google_places	2026-05-28 05:45:18.995365+00	confirmed_hh	342962f3-148e-4a1b-95c6-19e04f062cc4	2026-05-28 00:35:18.119279+00	2026-05-28 05:45:18.995365+00
d622ccb6-1897-4ac1-b8fb-25181a235a85	6d08439f-6aac-4bd2-bbba-99566b214b69	Boran Royal Thai Cuisine	ChIJa38vI5VTkFQRiTlomtvdPKw	5108 Grand Loop, Ruston, WA 98407, USA	47.2998758	-122.5056451	google_places	2026-05-28 05:54:50.118878+00	confirmed_hh	a26ed922-1345-47f3-9ceb-2b2cf9cb0b94	2026-05-28 00:35:18.657031+00	2026-05-28 05:54:50.118878+00
a63483e2-ad03-459b-a94a-d11c7abea2e4	6d08439f-6aac-4bd2-bbba-99566b214b69	Gyro Bites	ChIJ36wJl-KrkVQR4e_ggvzk2D4	6409 6th Ave, Tacoma, WA 98406, USA	47.2562503	-122.5228914	google_places	\N	\N	\N	2026-05-28 00:35:17.396223+00	2026-05-28 16:23:57.110548+00
00961b35-23b8-4043-a7b6-dba977a4c9a0	6d08439f-6aac-4bd2-bbba-99566b214b69	Fuego Nightclub	ChIJb4P0ibOrkVQRu4h_LJCzqZw	6409 6th Ave, Tacoma, WA 98406, USA	47.2559174	-122.5228969	google_places	\N	\N	\N	2026-05-28 00:35:17.397203+00	2026-05-28 16:23:57.110548+00
b4a6a1dd-ec59-4e4c-ac7d-c8ffc2191ee0	117cbe36-eae9-45cf-b54f-df358dbb49c1	El Pollo Correteado Restaurant	ChIJDUCcnJcTK4cRe6sfl1Z_X2A	2904 W McDowell Rd #2, Phoenix, AZ 85009, USA	33.4660883	-112.1216092	google_places	\N	\N	\N	2026-05-28 04:48:12.795893+00	2026-05-28 04:48:13.900796+00
72ac40e4-48df-4cc6-913e-dd53cb852e51	6d08439f-6aac-4bd2-bbba-99566b214b69	Mandolin Sushi & Japanese steak house	ChIJZydIoiVVkFQRj4U6bguFDhs	3923 S 12th St, Tacoma, WA 98405, USA	47.2503320	-122.4900375	google_places	2026-05-28 04:48:48.76841+00	confirmed_hh	1eb6d9f2-2cc9-4554-8c85-14262d2b6b4f	2026-05-28 00:35:17.399764+00	2026-05-28 04:48:48.76841+00
b278574b-6b0f-4279-b3ad-3056d25a9269	117cbe36-eae9-45cf-b54f-df358dbb49c1	Sushi Sonora	ChIJJ8mt3oUTK4cRtInMCy56U4Q	3555 W McDowell Rd, Phoenix, AZ 85009, USA	33.4656678	-112.1367366	google_places	\N	\N	\N	2026-05-28 04:48:12.796803+00	2026-05-28 04:48:13.71388+00
45a1c002-8746-4abf-8563-d067bfadb5fd	117cbe36-eae9-45cf-b54f-df358dbb49c1	Garcia's Las Avenidas	ChIJ9yRGsoMTK4cRiknDyxEXM50	2212 N 35th Ave, Phoenix, AZ 85009, USA	33.4717365	-112.1348337	google_places	\N	\N	\N	2026-05-28 04:48:12.794675+00	2026-05-28 04:48:13.89306+00
3c2d4457-81ec-4319-a0ef-277bca5cf05b	6d08439f-6aac-4bd2-bbba-99566b214b69	Antojos Mexican Grill Tacoma	ChIJCSy_KcqrkVQRsP221jBd5AQ	6104 6th Ave #2018, Tacoma, WA 98406, USA	47.2551084	-122.5191312	google_places	2026-05-28 04:50:15.37846+00	error	\N	2026-05-28 00:35:17.40057+00	2026-05-28 04:50:15.37846+00
35c628a0-f1cb-4f22-8504-c253bb70509e	6d08439f-6aac-4bd2-bbba-99566b214b69	The Cloverleaf	ChIJeylnSSyrkVQR65IBvWufyUY	6430 6th Ave, Tacoma, WA 98406, USA	47.2550236	-122.5241665	google_places	2026-05-28 04:52:01.892179+00	confirmed_hh	8b7ad42b-54f1-42a4-86ea-0fa33a7e7cf5	2026-05-28 00:35:17.401363+00	2026-05-28 04:52:01.892179+00
ac6f33cf-3c52-4243-970b-756c6dd86ac1	6d08439f-6aac-4bd2-bbba-99566b214b69	Tacoma Pie	ChIJSUvKgH2rkVQRHtpWk28RnNo	4417 6th Ave, Tacoma, WA 98406, USA	47.2554284	-122.4970993	google_places	2026-05-28 04:57:31.132768+00	confirmed_hh	f1960a89-c3dc-41f7-8793-f6af6ee2f178	2026-05-28 00:35:17.404341+00	2026-05-28 04:57:31.132768+00
3b6b0247-41ec-47bf-acad-62f17eea49ed	6d08439f-6aac-4bd2-bbba-99566b214b69	The Fish Peddler Restaurant on Foss Waterway	ChIJHfr1PJ5VkFQRnXzOqNp8L_8	1199 Dock St, Tacoma, WA 98402, USA	47.2498910	-122.4342987	google_places	2026-05-28 05:10:20.832778+00	confirmed_hh	21cb5a4e-084b-4f9f-aa58-0436c13283f8	2026-05-28 00:35:17.634272+00	2026-05-28 05:10:20.832778+00
6b053818-6d18-4d29-bcf1-bf285a6455c7	6d08439f-6aac-4bd2-bbba-99566b214b69	Da Tiki Hut	ChIJpZYk9ydVkFQReiiZPRpLCdk	4427 6th Ave suite 101, Tacoma, WA 98406, USA	47.2556593	-122.4975386	google_places	\N	\N	\N	2026-05-28 00:35:17.399007+00	2026-05-28 16:23:57.110548+00
64a0c4f0-17a7-4e5f-b73b-758eb0eacc0a	6d08439f-6aac-4bd2-bbba-99566b214b69	Doyle's Public House	ChIJBySWiKhVkFQRlFJAVdDfKRc	208 St Helens Ave, Tacoma, WA 98402, USA	47.2618263	-122.4459575	google_places	\N	\N	\N	2026-05-28 00:35:17.635652+00	2026-05-28 16:23:57.110548+00
c994bd4b-6586-4716-a78d-a0ea6320c248	6d08439f-6aac-4bd2-bbba-99566b214b69	El Gaucho Tacoma	ChIJU8xNAHpVkFQRFcVNm69EvCY	2119 Pacific Ave, Tacoma, WA 98402, USA	47.2424350	-122.4356590	google_places	\N	\N	\N	2026-05-28 00:35:17.637031+00	2026-05-28 16:23:57.110548+00
01283971-6f09-4677-8164-00b842e3850c	6d08439f-6aac-4bd2-bbba-99566b214b69	McMenamins Elks Temple	ChIJv1aUIulVkFQRaOajfU4vuC0	565 Broadway, Tacoma, WA 98402, USA	47.2580358	-122.4409048	google_places	2026-05-28 04:13:39.879322+00	\N	\N	2026-05-27 21:09:48.4072+00	2026-05-28 04:13:39.879322+00
db863ca8-a395-4216-af8d-6172e1184f43	6d08439f-6aac-4bd2-bbba-99566b214b69	BJ's Bingo & Gaming	ChIJSzErDVD_kFQRljdR_6IuBkw	4411 Pacific Hwy E, Fife, WA 98424, USA	47.2440600	-122.3700300	google_places	2026-05-28 04:13:39.979254+00	\N	\N	2026-05-27 21:09:48.41344+00	2026-05-28 04:13:39.979254+00
bebd59fd-1fac-43bd-bddc-8b4142a22e3c	6d08439f-6aac-4bd2-bbba-99566b214b69	The Church Cantina	ChIJ8f21Oi4BkVQRj2rT5LGrpfw	5240 S Tacoma Way, Tacoma, WA 98409, USA	47.2083709	-122.4841907	google_places	2026-05-28 16:27:04.011136+00	no_hh_found	efd18f5e-dc1d-4a95-8141-6e4aaf9c5d3b	2026-05-28 00:35:16.337679+00	2026-05-28 16:27:04.011136+00
8b69e726-7fde-412f-b85c-b8ca369f5d69	117cbe36-eae9-45cf-b54f-df358dbb49c1	SIN SON NAY 1	ChIJ-cDNGOoTK4cRfvRRA7L9Q2k	2822 W Van Buren St, Phoenix, AZ 85009, USA	33.4514097	-112.1205843	google_places	\N	\N	\N	2026-05-28 04:48:12.799729+00	2026-05-28 04:48:12.799729+00
f4ce200f-b7c2-4a3a-9320-45e359756951	117cbe36-eae9-45cf-b54f-df358dbb49c1	Cornish Pasty Co	ChIJJzIaNyISK4cR5Gi5dTzyFF8	7 W Monroe St, Phoenix, AZ 85003, USA	33.4502572	-112.0741738	google_places	\N	\N	\N	2026-05-28 04:48:12.980773+00	2026-05-28 04:48:14.064601+00
99db3e68-930b-4f7c-b895-1f530c2495e3	117cbe36-eae9-45cf-b54f-df358dbb49c1	Valley Bar	ChIJD-CCMSISK4cR0rLndAumIXE	130 N Central Ave, Phoenix, AZ 85004, USA	33.4499520	-112.0743465	google_places	\N	\N	\N	2026-05-28 04:48:12.982207+00	2026-05-28 04:48:14.065371+00
a981a584-5578-4fd6-afa5-431f087e7807	117cbe36-eae9-45cf-b54f-df358dbb49c1	Tacos Chava	ChIJO_ut_ukTK4cRK-3pymJjkjs	145 N 28th Ave, Phoenix, AZ 85009, USA	33.4509902	-112.1195246	google_places	\N	\N	\N	2026-05-28 04:48:12.801932+00	2026-05-28 04:48:12.801932+00
cc3e20c6-c98d-437f-bc5d-ad6c286065e6	117cbe36-eae9-45cf-b54f-df358dbb49c1	Sushi Mocorito Lonchera	ChIJ0ziEWPITK4cRaY_nY4tGP-g	4002 W Van Buren St, Phoenix, AZ 85009, USA	33.4519596	-112.1455250	google_places	\N	\N	\N	2026-05-28 04:48:12.80354+00	2026-05-28 04:48:12.80354+00
47bc1a0a-8b98-4d53-ac3f-b2fee65743dc	117cbe36-eae9-45cf-b54f-df358dbb49c1	Rita's Mexican Food & Mariscos	ChIJW88PiIUTK4cRu0C2R5orROk	1402 N 35th Ave, Phoenix, AZ 85009, USA	33.4643506	-112.1348478	google_places	\N	\N	\N	2026-05-28 04:48:12.805133+00	2026-05-28 04:48:12.805133+00
26ef0784-f179-4932-9055-7d35aa829265	117cbe36-eae9-45cf-b54f-df358dbb49c1	Jimmy Jacks Wings & Burgers	ChIJdRVu2-sTK4cR1Xg6uQ2B15k	2933 W Van Buren St, Phoenix, AZ 85009, USA	33.4509985	-112.1234397	google_places	\N	\N	\N	2026-05-28 04:48:12.807712+00	2026-05-28 04:48:12.807712+00
eca643cf-fb51-4d03-98d8-1a1ff43e539f	117cbe36-eae9-45cf-b54f-df358dbb49c1	Ziggys Magic Pizza Shop	ChIJHbB13dQTK4cRauBAXkcFlWM	401 W Van Buren St Suite B, Phoenix, AZ 85003, USA	33.4511428	-112.0797641	google_places	\N	\N	\N	2026-05-28 04:48:12.988804+00	2026-05-28 04:48:12.988804+00
077791e3-4ff3-4c27-8bbb-e1f7556706fd	117cbe36-eae9-45cf-b54f-df358dbb49c1	Centrico	ChIJee8CNiISK4cR7w4DCWmlok8	101 N 1st Ave, Phoenix, AZ 85003, USA	33.4502026	-112.0748866	google_places	\N	\N	\N	2026-05-28 04:48:12.991321+00	2026-05-28 04:48:12.991321+00
5e9a3524-a3f0-46db-bb4a-eda2e334963a	117cbe36-eae9-45cf-b54f-df358dbb49c1	Seamus McCaffrey's Irish Pub	ChIJBduQSiISK4cRSgUajBxuuAg	18 W Monroe St, Phoenix, AZ 85003, USA	33.4506009	-112.0743722	google_places	\N	\N	\N	2026-05-28 04:48:12.992882+00	2026-05-28 04:48:12.992882+00
2c38bf51-8464-4d43-b61a-9447cf7af1e6	117cbe36-eae9-45cf-b54f-df358dbb49c1	El Zaguan Bistro	ChIJx9oqFMwTK4cR49HUxrmpKVE	16 W Adams St, Phoenix, AZ 85003, USA	33.4494710	-112.0742787	google_places	\N	\N	\N	2026-05-28 04:48:12.994157+00	2026-05-28 04:48:12.994157+00
d8aadba5-a093-47e0-b41f-34d0cf33a7b3	117cbe36-eae9-45cf-b54f-df358dbb49c1	Via Della Slice Shop	ChIJc_mv30kTK4cR2MI2RPYDc3M	222 N 5th Ave, Phoenix, AZ 85003, USA	33.4509649	-112.0804250	google_places	\N	\N	\N	2026-05-28 04:48:12.995044+00	2026-05-28 04:48:12.995044+00
a7b37750-cd3c-46ae-91f1-9cea2cf98dff	117cbe36-eae9-45cf-b54f-df358dbb49c1	Gus's World Famous Fried Chicken	ChIJy0Vn7lkTK4cRzZH243yPc98	341 W Van Buren St, Phoenix, AZ 85003, USA	33.4511838	-112.0785091	google_places	\N	\N	\N	2026-05-28 04:48:12.995887+00	2026-05-28 04:48:12.995887+00
67e7b696-e493-481f-bb8f-8078dae9eee5	117cbe36-eae9-45cf-b54f-df358dbb49c1	The Vig	ChIJey8vKxgSK4cR8xVbn8TAc8I	606 N 4th Ave, Phoenix, AZ 85003, USA	33.4550310	-112.0793270	google_places	\N	\N	\N	2026-05-28 04:48:12.983086+00	2026-05-28 04:48:14.066254+00
56a725db-598b-40cd-af82-42ea5e7770d7	117cbe36-eae9-45cf-b54f-df358dbb49c1	Gracie's Tax Bar	ChIJ9SbcaDoSK4cRC6NbLuk48r4	711 N 7th Ave, Phoenix, AZ 85007, USA	33.4563850	-112.0823616	google_places	\N	\N	\N	2026-05-28 04:48:12.984765+00	2026-05-28 04:48:14.07065+00
558671dd-f055-45d7-b7cb-c2fe4ad4c994	117cbe36-eae9-45cf-b54f-df358dbb49c1	Crescent Ballroom	ChIJyxk3cSMSK4cRJmmi4bfRyZw	308 N 2nd Ave, Phoenix, AZ 85003, USA	33.4517982	-112.0768576	google_places	\N	\N	\N	2026-05-28 04:48:12.983943+00	2026-05-28 04:48:14.067193+00
e94c0fc7-a49a-45bf-a342-f0a0fcd1a4e2	117cbe36-eae9-45cf-b54f-df358dbb49c1	First & Last	ChIJ_8zOoEMTK4cRJxYw0cRF8DU	1001 N 3rd Ave #1, Phoenix, AZ 85003, USA	33.4591397	-112.0775832	google_places	\N	\N	\N	2026-05-28 04:48:12.985495+00	2026-05-28 04:48:14.071376+00
0a9d5d88-4b99-4822-ba46-12d727debd57	117cbe36-eae9-45cf-b54f-df358dbb49c1	CIBO	ChIJwWmiGTsSK4cREnWeKx719ho	603 N 5th Ave, Phoenix, AZ 85003, USA	33.4549917	-112.0799198	google_places	\N	\N	\N	2026-05-28 04:48:12.986896+00	2026-05-28 04:48:14.074953+00
7d190ee8-7368-432c-a054-bd78f1c6145b	117cbe36-eae9-45cf-b54f-df358dbb49c1	Walter Where?House	ChIJ7d3gUUQTK4cRO4cRdm1dgG0	702 N 21st Ave, Phoenix, AZ 85009, USA	33.4558840	-112.1048552	google_places	\N	\N	\N	2026-05-28 04:48:12.990141+00	2026-05-28 04:48:13.885408+00
40c77180-4552-4c7c-8f03-730c1a129531	117cbe36-eae9-45cf-b54f-df358dbb49c1	Jaguars Phoenix	ChIJhYEQTLsTK4cRmTfaHy5fexY	1902 N Black Cyn Hwy, Phoenix, AZ 85009, USA	33.4680417	-112.1124910	google_places	\N	\N	\N	2026-05-28 04:48:12.987666+00	2026-05-28 04:48:13.883885+00
903d56df-85fd-43c9-8d3f-13a709898674	117cbe36-eae9-45cf-b54f-df358dbb49c1	Harumi Sushi Bar	ChIJ8Ym-xCMSK4cR0hV_8rzjQ1M	101 N 1st Ave, Phoenix, AZ 85003, USA	33.4496040	-112.0749188	google_places	\N	\N	\N	2026-05-28 04:48:12.979487+00	2026-05-28 04:48:14.061919+00
46e616c7-f994-4c31-9dd7-bbeb157bfd32	6d08439f-6aac-4bd2-bbba-99566b214b69	Copper & Salt Northwest Kitchen	ChIJPbhV5n5TkFQR9NC_bLs4FLg	5125 Grand Loop, Ruston, WA 98407, USA	47.3000786	-122.5055707	google_places	2026-05-28 05:24:25.452655+00	confirmed_hh	ba69f35b-87d6-43ad-86b3-676405154f18	2026-05-28 00:35:17.949209+00	2026-05-28 05:24:25.452655+00
be1b4d80-08e6-454c-87b1-0b5b2c30ad9c	6d08439f-6aac-4bd2-bbba-99566b214b69	Cactus Restaurant Proctor	ChIJ_ZQUeRRVkFQRohTdOmDzA2E	2506 N Proctor St, Tacoma, WA 98406, USA	47.2702982	-122.4890604	google_places	2026-05-28 05:25:34.303237+00	confirmed_hh	edd135a1-86db-4245-ac88-9a462399e420	2026-05-28 00:35:17.949978+00	2026-05-28 05:25:34.303237+00
92046627-912d-4852-8a27-cbdcb80f5030	6d08439f-6aac-4bd2-bbba-99566b214b69	Unicorn Sports Bar	ChIJbYt4lIJUkFQRnF_H8xc3Iek	5302 N 49th St, Ruston, WA 98407, USA	47.2946764	-122.5083741	google_places	\N	\N	\N	2026-05-28 00:35:17.950746+00	2026-05-28 16:23:57.110548+00
b96bdd66-e808-4bb4-9223-a06d67a4593b	6d08439f-6aac-4bd2-bbba-99566b214b69	Waffle Stop	ChIJnX6i5O5UkFQR1solKt8YHKQ	2710 N Proctor St, Tacoma, WA 98407, USA	47.2723285	-122.4890754	google_places	\N	\N	\N	2026-05-28 00:35:17.951477+00	2026-05-28 16:23:57.110548+00
340de143-1be5-4fbe-8b33-0ca75c707e8d	6d08439f-6aac-4bd2-bbba-99566b214b69	Manny's Place	ChIJfzus6SpVkFQRh1y5UVixUPw	3814 N 26th St, Tacoma, WA 98407, USA	47.2709130	-122.4880480	google_places	\N	\N	\N	2026-05-28 00:35:17.959113+00	2026-05-28 16:23:57.110548+00
a2ce6349-877f-400c-b638-b88cae4522d0	6d08439f-6aac-4bd2-bbba-99566b214b69	E9 Firehouse & Gastropub	ChIJT1KKbhlVkFQRSzWQ7_m95vQ	611 N Pine St, Tacoma, WA 98406, USA	47.2559180	-122.4733815	google_places	\N	\N	\N	2026-05-28 00:35:17.639255+00	2026-05-28 16:23:57.110548+00
8910e97b-20f0-4027-a7ba-de0980d7ae64	6d08439f-6aac-4bd2-bbba-99566b214b69	Tacoma Comedy Club	ChIJh0J1hApVkFQRM29mIx-BCZw	933 Market St, Tacoma, WA 98402, USA	47.2540000	-122.4413583	google_places	2026-05-28 02:54:34.147329+00	confirmed_hh	64d7e3c1-c875-476a-befe-731f6e3ba12f	2026-05-27 21:09:48.428291+00	2026-05-28 02:54:34.147329+00
e991191b-b420-46ac-82a9-0a98bb00c7c6	117cbe36-eae9-45cf-b54f-df358dbb49c1	Pizzeria Bianco	ChIJ59-JIBwSK4cRwiT4XVtEJA8	623 E Adams St, Phoenix, AZ 85004, USA	33.4491524	-112.0656407	google_places	\N	\N	\N	2026-05-28 04:48:13.152158+00	2026-05-28 04:48:13.340549+00
7a52229e-8f99-4d15-b3c2-93cd37f36637	117cbe36-eae9-45cf-b54f-df358dbb49c1	Miel De Agave Phoenix	ChIJv6MKWhYTK4cRqPu9jejTrg0	705 N 1st St #110, Phoenix, AZ 85004, USA	33.4559431	-112.0721014	google_places	\N	\N	\N	2026-05-28 04:48:13.156009+00	2026-05-28 04:48:14.062936+00
e3118157-d1d4-4299-867e-a27ee41f747d	117cbe36-eae9-45cf-b54f-df358dbb49c1	The Pemberton	ChIJv6sY1cITK4cRIgA9szaGcXs	1121 N 2nd St, Phoenix, AZ 85004, USA	33.4608407	-112.0708158	google_places	\N	\N	\N	2026-05-28 04:48:13.163018+00	2026-05-28 04:48:14.06912+00
b11c90ef-19ac-444c-a63d-243024791c23	117cbe36-eae9-45cf-b54f-df358dbb49c1	ollie vaughn's	ChIJb7diawoSK4cRguVzUHloIb0	1526 E McDowell Rd, Phoenix, AZ 85006, USA	33.4659617	-112.0487865	google_places	\N	\N	\N	2026-05-28 04:48:13.360702+00	2026-05-28 04:48:14.243674+00
3966125d-4936-4cf7-ad59-34b1ecbe98ae	117cbe36-eae9-45cf-b54f-df358dbb49c1	Taco Boy's	ChIJ89kmkYYTK4cRWYSsxWpeLDE	620 E Roosevelt St, Phoenix, AZ 85004, USA	33.4589647	-112.0654835	google_places	\N	\N	\N	2026-05-28 04:48:13.164677+00	2026-05-28 04:48:14.232296+00
5f34ac56-da15-4b46-b9a7-2a708abc9dfe	117cbe36-eae9-45cf-b54f-df358dbb49c1	Cobra Arcade Bar	ChIJb8kW2xcSK4cR0u060Y2BceY	801 N 2nd St #100, Phoenix, AZ 85004, USA	33.4568805	-112.0709988	google_places	\N	\N	\N	2026-05-28 04:48:13.352401+00	2026-05-28 04:48:14.072188+00
eaee7f0f-272c-445b-9bbe-980900df1047	117cbe36-eae9-45cf-b54f-df358dbb49c1	Hanny's	ChIJ8yJC9CESK4cRG_mMN3Hlmo8	40 N 1st St, Phoenix, AZ 85004, USA	33.4491155	-112.0727187	google_places	\N	\N	\N	2026-05-28 04:48:13.353452+00	2026-05-28 04:48:13.353452+00
d14acf65-3e08-498c-9cd1-ca1cc5337488	117cbe36-eae9-45cf-b54f-df358dbb49c1	Bad Jimmy's	ChIJ4_r_n5QTK4cRVVo5a3L5818	108 E Pierce St, Phoenix, AZ 85004, USA	33.4557075	-112.0720114	google_places	\N	\N	\N	2026-05-28 04:48:13.356951+00	2026-05-28 04:48:13.356951+00
5c3bbb76-090c-42e5-b0fe-d5fdaedb8e67	117cbe36-eae9-45cf-b54f-df358dbb49c1	The Kettle Black Kitchen & Pub	ChIJdQKR5SESK4cRoq6hHbk8PoQ	1 N 1st St # 108, Phoenix, AZ 85004, USA	33.4485836	-112.0721521	google_places	\N	\N	\N	2026-05-28 04:48:13.358081+00	2026-05-28 04:48:13.358081+00
0b7be4d9-163e-4afd-a383-5db064487d91	117cbe36-eae9-45cf-b54f-df358dbb49c1	The Farish House	ChIJ4wfeweETK4cRmYKoxUWlgLM	816 N 3rd St, Phoenix, AZ 85004, USA	33.4571896	-112.0702162	google_places	\N	\N	\N	2026-05-28 04:48:13.35916+00	2026-05-28 04:48:13.35916+00
f6f9ac47-ad47-49c2-99bf-efc00cc9cdfe	117cbe36-eae9-45cf-b54f-df358dbb49c1	Red Devil Italian Restaurant & Pizzeria	ChIJOSbt2sQNK4cRXDhFj2eikP0	3102 E McDowell Rd, Phoenix, AZ 85008, USA	33.4660308	-112.0156639	google_places	\N	\N	\N	2026-05-28 04:48:13.517607+00	2026-05-28 04:48:14.425188+00
893453e2-c8a0-4984-a850-ba1bc7c0580a	117cbe36-eae9-45cf-b54f-df358dbb49c1	Crowne Plaza Phoenix Airport - Phx by IHG	ChIJi3ui5I8OK4cRr6gfLxW75Gs	4300 E Washington St, Phoenix, AZ 85034, USA	33.4488581	-111.9885212	google_places	\N	\N	\N	2026-05-28 04:48:13.516197+00	2026-05-28 04:48:13.516197+00
bf5a603d-8820-4b80-b0f9-9954b49d2ed4	117cbe36-eae9-45cf-b54f-df358dbb49c1	Hilal Grill | Indian, Pakistani and Afghani Restaurant and Catering in Phoenix	ChIJCb-qsC0MK4cRY0Ue8_h8q6g	1638 N 40th St, Phoenix, AZ 85008, USA	33.4669624	-111.9959792	google_places	\N	\N	\N	2026-05-28 04:48:13.519333+00	2026-05-28 04:48:13.519333+00
e03e228e-b29c-4906-822f-42ec10f9273f	117cbe36-eae9-45cf-b54f-df358dbb49c1	Knock Kneed Lobster	ChIJWdkzvXAOK4cRmdpfQU-vIXA	3202 E Washington St, Phoenix, AZ 85034, USA	33.4484332	-112.0127157	google_places	\N	\N	\N	2026-05-28 04:48:13.52088+00	2026-05-28 04:48:13.52088+00
3bbd048c-7957-4af2-875e-92ad0a6b00bd	117cbe36-eae9-45cf-b54f-df358dbb49c1	Rosita's Place	ChIJi9oj8e4NK4cRI1BX-IY3IBY	2310 E McDowell Rd, Phoenix, AZ 85006, USA	33.4660250	-112.0323690	google_places	\N	\N	\N	2026-05-28 04:48:13.524354+00	2026-05-28 04:48:13.524354+00
26294dbf-7ae3-484e-aee1-a26e713ba3bb	117cbe36-eae9-45cf-b54f-df358dbb49c1	Brix Kitchen+Cocktails	ChIJYcZBvoQOK4cRdHRNU_-2tI0	320 N 44th St, Phoenix, AZ 85008, USA	33.4518466	-111.9882994	google_places	\N	\N	\N	2026-05-28 04:48:13.529117+00	2026-05-28 04:48:13.529117+00
d123e3e8-40cf-447b-b14c-073fd4bf91a4	117cbe36-eae9-45cf-b54f-df358dbb49c1	Tortas El Rey	ChIJk8U2q-4NK4cRo85x5cjbo1w	1811 N 24th St C, Phoenix, AZ 85008, USA	33.4678615	-112.0296502	google_places	\N	\N	\N	2026-05-28 04:48:13.532527+00	2026-05-28 04:48:13.532527+00
0ec51e1e-420e-410b-bf99-305f0e4b1c83	117cbe36-eae9-45cf-b54f-df358dbb49c1	THE POST	ChIJuWMR-Y8OK4cRtmjbnfrCFPo	4300 E Washington St, Phoenix, AZ 85034, USA	33.4488634	-111.9884391	google_places	\N	\N	\N	2026-05-28 04:48:13.533607+00	2026-05-28 04:48:13.533607+00
151d84dc-91b2-4afc-a099-7b1694a6851c	117cbe36-eae9-45cf-b54f-df358dbb49c1	La Barquita Restaurant	ChIJg87wwe4NK4cRtGSf3JXEKNU	2334 E McDowell Rd, Phoenix, AZ 85006, USA	33.4660357	-112.0311393	google_places	\N	\N	\N	2026-05-28 04:48:13.534603+00	2026-05-28 04:48:13.534603+00
886360c0-e923-43a2-909f-cb2f460c67c8	117cbe36-eae9-45cf-b54f-df358dbb49c1	El Guerrerense	ChIJQ1X-NOgNK4cRgWrSct04DQ8	1627 N 24th St, Phoenix, AZ 85008, USA	33.4668782	-112.0298772	google_places	\N	\N	\N	2026-05-28 04:48:13.535441+00	2026-05-28 04:48:13.535441+00
88be282f-9fc3-4b14-b56d-76ec10500352	117cbe36-eae9-45cf-b54f-df358dbb49c1	Bacanora PHX	ChIJ61TtPBQTK4cRxlstbcvb7l0	1301 Grand Ave #1, Phoenix, AZ 85007, USA	33.4570058	-112.0895561	google_places	\N	\N	\N	2026-05-28 04:48:12.997419+00	2026-05-28 04:48:13.890989+00
bbe72129-40f1-42bb-937d-00531df4a010	117cbe36-eae9-45cf-b54f-df358dbb49c1	Palma	ChIJFYiJtJITK4cRiU9t0MAeNmk	903 N 2nd St, Phoenix, AZ 85004, USA	33.4579400	-112.0708770	google_places	\N	\N	\N	2026-05-28 04:48:13.154582+00	2026-05-28 04:48:14.060884+00
1effe761-c84e-4453-bf41-7dc05a124316	117cbe36-eae9-45cf-b54f-df358dbb49c1	Arizona Wilderness DTPHX	ChIJDXRsr1wTK4cR5d09wYTkx3Y	201 E Roosevelt St, Phoenix, AZ 85004, USA	33.4584711	-112.0708336	google_places	\N	\N	\N	2026-05-28 04:48:13.157031+00	2026-05-28 04:48:14.06383+00
51f71745-e4f9-40b4-9a37-7973d927bc03	117cbe36-eae9-45cf-b54f-df358dbb49c1	Mariscos Playa Hermosa	ChIJhx5advgNK4cRFNmHrx7DNnU	1605 E Garfield St, Phoenix, AZ 85006, USA	33.4575772	-112.0472984	google_places	\N	\N	\N	2026-05-28 04:48:13.354283+00	2026-05-28 04:48:14.236961+00
c9b9b588-85ed-4da9-9310-c71fe93c481c	117cbe36-eae9-45cf-b54f-df358dbb49c1	Gallo Blanco	ChIJnf1OvBoSK4cRhDuHwuHSeJo	928 E Pierce St, Phoenix, AZ 85006, USA	33.4560206	-112.0608286	google_places	\N	\N	\N	2026-05-28 04:48:13.355132+00	2026-05-28 04:48:14.240151+00
45907bce-e30d-4a18-bd33-c28b8c7fb312	117cbe36-eae9-45cf-b54f-df358dbb49c1	Puerto Rico Latin Bar & Grill	ChIJcZgE5goTK4cRb1wByC-L1BI	2714 W Thomas Rd, Phoenix, AZ 85017, USA	33.4807947	-112.1189704	google_places	\N	\N	\N	2026-05-28 04:48:13.714827+00	2026-05-28 04:48:13.714827+00
b81a51c4-8681-4565-8bf5-853f0c3b8625	117cbe36-eae9-45cf-b54f-df358dbb49c1	El Rey De Los Ostiones	ChIJz_lfhWcTK4cRQm00NB23yes	4141 N 35th Ave, Phoenix, AZ 85017, USA	33.4961155	-112.1333494	google_places	\N	\N	\N	2026-05-28 04:48:13.716951+00	2026-05-28 04:48:13.716951+00
db51416a-8d7a-4b2f-ba78-0e87aedcb0d7	117cbe36-eae9-45cf-b54f-df358dbb49c1	Angie's	ChIJZ1crImATK4cRzYXoHQ5bVU0	53 W Thomas Rd, Phoenix, AZ 85013, USA	33.4800179	-112.0766639	google_places	\N	\N	\N	2026-05-28 04:48:13.88705+00	2026-05-28 04:48:13.88705+00
82bd25c2-c166-4c23-908b-93ebeb5f3c03	117cbe36-eae9-45cf-b54f-df358dbb49c1	Vayal's Indian kitchen (RESTAURANT & CATERING)	ChIJZQL5PxNvK4cRu2TAooeKqgc	507 W Thomas Rd, Phoenix, AZ 85013, USA	33.4799868	-112.0808876	google_places	\N	\N	\N	2026-05-28 04:48:13.892052+00	2026-05-28 04:48:13.892052+00
1616935e-b582-4d91-9a85-3391d82249e6	117cbe36-eae9-45cf-b54f-df358dbb49c1	Walter Studios	ChIJXafebzkTK4cRRU6lFiRRfEg	747 W Roosevelt St, Phoenix, AZ 85007, USA	33.4579849	-112.0829430	google_places	\N	\N	\N	2026-05-28 04:48:13.89424+00	2026-05-28 04:48:13.89424+00
0268e8ca-42c4-478b-beb3-384500b1dad0	117cbe36-eae9-45cf-b54f-df358dbb49c1	Vovomeena	ChIJuZ6RxUcSK4cRMYD-P8etQF8	1515 N 7th Ave UNIT 170, Phoenix, AZ 85007, USA	33.4654140	-112.0821430	google_places	\N	\N	\N	2026-05-28 04:48:13.895907+00	2026-05-28 04:48:13.895907+00
0af63302-5cd4-4a30-a218-2ee22b8b86cb	117cbe36-eae9-45cf-b54f-df358dbb49c1	Mi Patio Mexican Restaurant	ChIJT61Mf_cSK4cRvjwzfWIvi5Q	3347 N 7th Ave, Phoenix, AZ 85013, USA	33.4873205	-112.0828150	google_places	\N	\N	\N	2026-05-28 04:48:13.905841+00	2026-05-28 04:48:14.628423+00
019c6115-9bd6-40f6-9619-caaa11275e70	117cbe36-eae9-45cf-b54f-df358dbb49c1	Earth Plant Based Cuisine	ChIJl5cY27sTK4cR5pNnmGkht08	1325 Grand Ave Suite 7, Phoenix, AZ 85007, USA	33.4572398	-112.0901600	google_places	\N	\N	\N	2026-05-28 04:48:13.899591+00	2026-05-28 04:48:13.899591+00
62f302b5-8d7b-4d7b-884d-402eafc3b84d	117cbe36-eae9-45cf-b54f-df358dbb49c1	El Norteño	ChIJ1djP5DkSK4cRc793OmmXe78	1002 N 7th Ave, Phoenix, AZ 85007, USA	33.4588697	-112.0827683	google_places	\N	\N	\N	2026-05-28 04:48:13.904083+00	2026-05-28 04:48:13.904083+00
4b73127d-5016-4dde-9b35-1f34d0032131	117cbe36-eae9-45cf-b54f-df358dbb49c1	Kobalt	ChIJkRBEr18SK4cR8jynbFt5fPM	3110 N Central Ave #175, Phoenix, AZ 85012, USA	33.4833086	-112.0754149	google_places	\N	\N	\N	2026-05-28 04:48:13.90761+00	2026-05-28 04:48:13.90761+00
cefede14-23a4-4b73-bc41-b9feea1a8543	117cbe36-eae9-45cf-b54f-df358dbb49c1	Dwntwn	ChIJJ17aIT0SK4cRmeaOlM1s_fc	702 N Central Ave, Phoenix, AZ 85004, USA	33.4557452	-112.0742447	google_places	\N	\N	\N	2026-05-28 04:48:14.072917+00	2026-05-28 04:48:14.072917+00
0a888790-3059-4cf2-be7b-a128a0913d3e	117cbe36-eae9-45cf-b54f-df358dbb49c1	Stoop Kid	ChIJU6ovGnoTK4cR4iMjEFnRhXY	901 N 1st St Ste 107, Phoenix, AZ 85004, USA	33.4579629	-112.0723298	google_places	\N	\N	\N	2026-05-28 04:48:14.073723+00	2026-05-28 04:48:14.073723+00
955409eb-eb6f-4196-912c-69c47b1a3237	117cbe36-eae9-45cf-b54f-df358dbb49c1	Thai Recipe Bistro	ChIJdbBIrW4SK4cRup_6tJKJrsw	2234 N 7th St Suite 105, Phoenix, AZ 85006, USA	33.4726474	-112.0655874	google_places	\N	\N	\N	2026-05-28 04:48:14.244833+00	2026-05-28 04:48:14.244833+00
b3302460-edc0-4811-9e21-f3858b43dd81	117cbe36-eae9-45cf-b54f-df358dbb49c1	Ocotillo Restaurant	ChIJA3x1UmASK4cR-Jn7yP2Z4bY	3243 N 3rd St Suite A, Phoenix, AZ 85012, USA	33.4854496	-112.0692217	google_places	\N	\N	\N	2026-05-28 04:48:14.248417+00	2026-05-28 04:48:14.248417+00
a2ce0a7e-8379-4fa6-9713-40e961dcee5b	117cbe36-eae9-45cf-b54f-df358dbb49c1	Tacos Chiwas	ChIJxQaVZ_ENK4cR2A48bV13wLU	1028 E Indian School Rd, Phoenix, AZ 85014, USA	33.4949424	-112.0594206	google_places	\N	\N	\N	2026-05-28 04:48:14.250771+00	2026-05-28 04:48:14.250771+00
cf04190a-d762-4049-aaff-e32044ae6fd6	117cbe36-eae9-45cf-b54f-df358dbb49c1	Green New American Vegetarian	ChIJdUjKcGwSK4cRatWWkGWVSDc	2022 N 7th St, Phoenix, AZ 85006, USA	33.4701393	-112.0654347	google_places	\N	\N	\N	2026-05-28 04:48:14.253998+00	2026-05-28 04:48:14.253998+00
46da76f5-7270-4840-a878-1813c8f4a1bc	117cbe36-eae9-45cf-b54f-df358dbb49c1	Presidio Cocina Mexicana	ChIJFXlwhVkSK4cRAIuchsOOSaA	2024 N 7th St, Phoenix, AZ 85006, USA	33.4703258	-112.0655563	google_places	\N	\N	\N	2026-05-28 04:48:14.254899+00	2026-05-28 04:48:14.254899+00
ec07805f-b0a5-4ada-8a91-42f1ca60e8a6	117cbe36-eae9-45cf-b54f-df358dbb49c1	Casa Corazon Restaurant	ChIJScta_DMNK4cRg3DlsKcuwtM	2637 N 16th St, Phoenix, AZ 85006, USA	33.4769368	-112.0473809	google_places	\N	\N	\N	2026-05-28 04:48:14.233488+00	2026-05-28 04:48:14.95368+00
67ae18e5-5b0e-4c74-b759-e29a941f8738	117cbe36-eae9-45cf-b54f-df358dbb49c1	Taco Guild	ChIJn3P8AWISK4cRn7xsB8hcYQU	546 E Osborn Rd, Phoenix, AZ 85012, USA	33.4877599	-112.0656849	google_places	\N	\N	\N	2026-05-28 04:48:14.238201+00	2026-05-28 04:48:14.95879+00
c1ff7f23-8d2a-435b-be94-36e959b783d5	117cbe36-eae9-45cf-b54f-df358dbb49c1	Taco Viva	ChIJN2JNDkYNK4cRLgU6AfbC8u8	2815 E Indian School Rd, Phoenix, AZ 85016, USA	33.4947889	-112.0206856	google_places	\N	\N	\N	2026-05-28 04:48:14.23918+00	2026-05-28 04:48:14.957478+00
cb929b4a-c607-4570-baa6-3d177bde5c56	117cbe36-eae9-45cf-b54f-df358dbb49c1	Wren House Brewing Company	ChIJ_2fOguwNK4cRJ1SZiMWqB1s	2125 N 24th St, Phoenix, AZ 85008, USA	33.4713059	-112.0299461	google_places	\N	\N	\N	2026-05-28 04:48:14.242654+00	2026-05-28 04:48:14.423584+00
b4bc2983-2cca-46d1-8a93-e0a87a167095	117cbe36-eae9-45cf-b54f-df358dbb49c1	Pizza To The Rescue	ChIJRYGi2fcNK4cRysk0qTKhXgE	2601 E Indian School Rd, Phoenix, AZ 85016, USA	33.4945159	-112.0257465	google_places	\N	\N	\N	2026-05-28 04:48:14.249674+00	2026-05-28 04:48:14.426335+00
b55e3710-46ed-4c4c-9dff-d144b0b7f238	117cbe36-eae9-45cf-b54f-df358dbb49c1	Tacos Veganos	ChIJ67KIcEINK4cRE6myG1z5in0	3301 E Indian School Rd, Phoenix, AZ 85018, USA	33.4949481	-112.0101538	google_places	\N	\N	\N	2026-05-28 04:48:14.427599+00	2026-05-28 04:48:14.427599+00
500a6e15-7420-49e7-ba12-eec894aa8395	117cbe36-eae9-45cf-b54f-df358dbb49c1	Fry Bread House	ChIJ641PXOUSK4cRJmJJUOd6CvQ	4545 N 7th Ave, Phoenix, AZ 85013, USA	33.5036974	-112.0822328	google_places	\N	\N	\N	2026-05-28 04:48:14.609377+00	2026-05-28 04:48:14.78704+00
53d1fb2d-a8ba-431c-989a-be56b3e47dc6	117cbe36-eae9-45cf-b54f-df358dbb49c1	Charlie's Phoenix	ChIJ41Yv19wSK4cRWTvh6MYauBM	727 W Camelback Rd, Phoenix, AZ 85013, USA	33.5090472	-112.0837962	google_places	\N	\N	\N	2026-05-28 04:48:14.610979+00	2026-05-28 04:48:14.788156+00
32922fb6-5fdc-44da-bad6-37193d56e837	117cbe36-eae9-45cf-b54f-df358dbb49c1	China Chili	ChIJa55pRmASK4cRXVO7g6Z9W20	302 E Flower St, Phoenix, AZ 85012, USA	33.4858239	-112.0690989	google_places	\N	\N	\N	2026-05-28 04:48:14.241377+00	2026-05-28 04:48:14.798635+00
2a974529-d860-485b-85d0-847190ce5cc1	117cbe36-eae9-45cf-b54f-df358dbb49c1	Glai Baan	ChIJGY7QxZsNK4cRPi_cnrls0hI	2333 E Osborn Rd, Phoenix, AZ 85016, USA	33.4872925	-112.0308517	google_places	\N	\N	\N	2026-05-28 04:48:14.230523+00	2026-05-28 04:48:14.952726+00
9d00dcbf-e1bd-4dd5-b9b1-a1b04e797ae8	117cbe36-eae9-45cf-b54f-df358dbb49c1	The Rebel Lounge	ChIJ14zBKHYNK4cR70v7C3rd0ag	2303 E Indian School Rd, Phoenix, AZ 85016, USA	33.4945190	-112.0320698	google_places	\N	\N	\N	2026-05-28 04:48:14.235124+00	2026-05-28 04:48:14.956223+00
ae4dab3f-bcf7-4c63-b316-d5fc139418bc	117cbe36-eae9-45cf-b54f-df358dbb49c1	Tambayan Filipino Food	ChIJi-ds7O8TK4cRx0EGZeKCOUw	1534 W Camelback Rd, Phoenix, AZ 85015, USA	33.5097979	-112.0926564	google_places	\N	\N	\N	2026-05-28 04:48:14.614643+00	2026-05-28 04:48:14.614643+00
47acfe6c-d5f4-4cfe-a3b5-8bd9c01a1ade	117cbe36-eae9-45cf-b54f-df358dbb49c1	Thai E-San	ChIJuxJBGfASK4cRMW2fGtKryCY	616 W Indian School Rd, Phoenix, AZ 85013, USA	33.4951905	-112.0821865	google_places	\N	\N	\N	2026-05-28 04:48:14.61688+00	2026-05-28 04:48:14.61688+00
03b0ee0a-72ac-4ffc-8a72-215777b6190f	117cbe36-eae9-45cf-b54f-df358dbb49c1	Phở Thành Restaurant	ChIJcxvWRCcTK4cRk3fuLOJqUlw	1702 W Camelback Rd, Phoenix, AZ 85015, USA	33.5102145	-112.0958231	google_places	\N	\N	\N	2026-05-28 04:48:14.617809+00	2026-05-28 04:48:14.617809+00
5997119c-c1f4-4740-b07b-b76dd6d2befb	117cbe36-eae9-45cf-b54f-df358dbb49c1	Da Vàng Restaurant	ChIJgf-76SETK4cRPk_7NFXeXt8	4538 N 19th Ave, Phoenix, AZ 85015, USA	33.5037680	-112.1004451	google_places	\N	\N	\N	2026-05-28 04:48:14.618746+00	2026-05-28 04:48:14.618746+00
75e2ae86-9836-4476-ba58-a8f7850283fd	117cbe36-eae9-45cf-b54f-df358dbb49c1	Thunderbird Lounge	ChIJky6-AcUTK4cRznngTQDkQlY	710 W Montecito Ave, Phoenix, AZ 85013, USA	33.4996353	-112.0834460	google_places	\N	\N	\N	2026-05-28 04:48:14.619701+00	2026-05-28 04:48:14.619701+00
3340fa8e-b893-47db-ad83-38376f27a685	117cbe36-eae9-45cf-b54f-df358dbb49c1	Culichi Sushi	ChIJVyAlWDgTK4cRe71gToS0W5Q	4807 N 27th Ave, Phoenix, AZ 85017, USA	33.5080415	-112.1164917	google_places	\N	\N	\N	2026-05-28 04:48:14.620974+00	2026-05-28 04:48:14.620974+00
3406b5c1-715c-4b88-95ee-399d2c48c1ff	117cbe36-eae9-45cf-b54f-df358dbb49c1	The Great Alaskan Bush Co	ChIJwWsGUHITK4cR2taDJKpSGI0	2980 Grand Ave, Phoenix, AZ 85017, USA	33.4859897	-112.1229482	google_places	\N	\N	\N	2026-05-28 04:48:13.707292+00	2026-05-28 04:48:14.622291+00
be9975af-f42b-45b0-8de3-f859c2d3fb22	117cbe36-eae9-45cf-b54f-df358dbb49c1	La Piñata Mexican Food Restaurant	ChIJt66k4wMTK4cRh8H4MQHd5UY	5521 N 7th Ave, Phoenix, AZ 85013, USA	33.5174032	-112.0820853	google_places	\N	\N	\N	2026-05-28 04:48:14.623297+00	2026-05-28 04:48:14.623297+00
6380fa61-3cba-4d5e-a77c-37edbeb8ce61	117cbe36-eae9-45cf-b54f-df358dbb49c1	Stacy's at Melrose	ChIJeYCjRO8SK4cR6qcBjf-Ice0	4343 N 7th Ave, Phoenix, AZ 85013, USA	33.4998132	-112.0822470	google_places	\N	\N	\N	2026-05-28 04:48:14.624451+00	2026-05-28 04:48:14.624451+00
12cc1bd5-ff1c-49c9-8b25-707bfd3a5690	117cbe36-eae9-45cf-b54f-df358dbb49c1	Frank's Deli	ChIJcVNxoDoTK4cRYhDEn0btqmk	2301 W Orange Dr, Phoenix, AZ 85015, USA	33.5119859	-112.1085994	google_places	\N	\N	\N	2026-05-28 04:48:14.626027+00	2026-05-28 04:48:14.626027+00
798857b6-d885-4203-b1dd-8ce85b1aac44	117cbe36-eae9-45cf-b54f-df358dbb49c1	Boycott Bar	ChIJKbKSeu8SK4cREKYfTsX2VRs	4301 N 7th Ave, Phoenix, AZ 85013, USA	33.4986923	-112.0827450	google_places	\N	\N	\N	2026-05-28 04:48:14.627463+00	2026-05-28 04:48:14.627463+00
a0057152-d952-493a-9081-baf71d908820	117cbe36-eae9-45cf-b54f-df358dbb49c1	Postino Central	ChIJaeXT08ASK4cRkCGpGgzYpu8	5144 N Central Ave, Phoenix, AZ 85012, USA	33.5126361	-112.0740766	google_places	\N	\N	\N	2026-05-28 04:48:14.792783+00	2026-05-28 04:48:14.792783+00
e3988278-dc41-4daa-85b3-1e5379d20150	117cbe36-eae9-45cf-b54f-df358dbb49c1	Valentine	ChIJEcyPEKQTK4cRsMj44FRFp58	4130 N 7th Ave, Phoenix, AZ 85013, USA	33.4959474	-112.0839291	google_places	\N	\N	\N	2026-05-28 04:48:14.612946+00	2026-05-28 04:48:14.794262+00
c4fc60f4-e66b-4206-ac20-0ee7e404519a	117cbe36-eae9-45cf-b54f-df358dbb49c1	Federal Pizza	ChIJjSBPKccSK4cR5OHCi6zjTV4	5210 N Central Ave #104, Phoenix, AZ 85012, USA	33.5135593	-112.0742168	google_places	\N	\N	\N	2026-05-28 04:48:14.797492+00	2026-05-28 04:48:14.797492+00
92fd863e-5d18-4927-a312-36e50d831dd1	117cbe36-eae9-45cf-b54f-df358dbb49c1	Windsor	ChIJU8mrOscSK4cR0_wJQCbq5J0	5223 N Central Ave, Phoenix, AZ 85012, USA	33.5136761	-112.0733951	google_places	\N	\N	\N	2026-05-28 04:48:14.800138+00	2026-05-28 04:48:14.800138+00
ccf99059-fb8e-4c05-84cd-45270723dbb9	117cbe36-eae9-45cf-b54f-df358dbb49c1	JINYA Ramen Bar - Central Phoenix	ChIJsZ6JoggTK4cRH6WMlzvJLmg	5120 N Central Ave #1, Phoenix, AZ 85012, USA	33.5119526	-112.0742518	google_places	\N	\N	\N	2026-05-28 04:48:14.80148+00	2026-05-28 04:48:14.80148+00
ba159c31-1b02-4d4e-a75c-23a26c5d3993	117cbe36-eae9-45cf-b54f-df358dbb49c1	The Beach House	ChIJ0c009ZUSK4cRvHrGfSaGhhc	501 E Camelback Rd, Phoenix, AZ 85012, USA	33.5089899	-112.0670431	google_places	\N	\N	\N	2026-05-28 04:48:14.804005+00	2026-05-28 04:48:14.804005+00
d983b99e-46d2-4948-897b-d38eecbc424b	117cbe36-eae9-45cf-b54f-df358dbb49c1	Culinary Dropout	ChIJh6g1AroSK4cRnQXX3oghMR0	5632 N 7th St, Phoenix, AZ 85014, USA	33.5195890	-112.0654512	google_places	\N	\N	\N	2026-05-28 04:48:14.785727+00	2026-05-28 04:48:14.949422+00
b086beb9-dfa8-466f-840b-9d8c94ac4675	117cbe36-eae9-45cf-b54f-df358dbb49c1	Pizzeria Bianco	ChIJxeB8kGUNK4cRVFS3I8wjHhw	4743 N 20th St, Phoenix, AZ 85016, USA	33.5073309	-112.0375126	google_places	\N	\N	\N	2026-05-28 04:48:14.951215+00	2026-05-28 04:48:14.951215+00
5a17d5df-4c99-413d-9b95-9a9b37fbde29	117cbe36-eae9-45cf-b54f-df358dbb49c1	PROVISION	ChIJBQgL7UwTK4cRUEckC8ctklo	711 E Missouri Ave Ste 115, Phoenix, AZ 85014, USA	33.5160940	-112.0642215	google_places	\N	\N	\N	2026-05-28 04:48:14.790578+00	2026-05-28 04:48:14.954552+00
0a356282-13c0-4f99-8341-896864fb0d50	117cbe36-eae9-45cf-b54f-df358dbb49c1	Flower Child	ChIJh4cIDcASK4cRd_00wwvindQ	100 E Camelback Rd, Phoenix, AZ 85012, USA	33.5096320	-112.0720690	google_places	\N	\N	\N	2026-05-28 04:48:14.796463+00	2026-05-28 04:48:14.959716+00
2b82052d-b0a8-446f-82c4-b941588809b7	117cbe36-eae9-45cf-b54f-df358dbb49c1	The Gladly	ChIJkxpMR28NK4cRg84ZJeCWJ-U	2201 E Camelback Rd, Phoenix, AZ 85016, USA	33.5090973	-112.0339058	google_places	\N	\N	\N	2026-05-28 04:48:14.960789+00	2026-05-28 04:48:14.960789+00
11a00d18-8286-4e96-886b-2701f0cb6434	117cbe36-eae9-45cf-b54f-df358dbb49c1	Twin Peaks	ChIJjU7qYW8NK4cRSftDaIOIniU	2135 E Camelback Rd, Phoenix, AZ 85016, USA	33.5081019	-112.0358076	google_places	\N	\N	\N	2026-05-28 04:48:14.962185+00	2026-05-28 04:48:14.962185+00
cdc64d47-9332-4de6-911d-0dbdf6aa58ac	117cbe36-eae9-45cf-b54f-df358dbb49c1	El rinconcito venezolano	ChIJfxgyXZURK4cRRZ8oDzMuuf8	3909 S Central Ave, Phoenix, AZ 85040, USA	33.4116291	-112.0732253	google_places	2026-05-28 05:01:34.544059+00	\N	\N	2026-05-28 04:48:11.458889+00	2026-05-28 05:01:34.544059+00
635d3f05-210b-44db-9e44-e807ca6ff913	6d08439f-6aac-4bd2-bbba-99566b214b69	Farrelli's Pizza	ChIJWXaK9n5TkFQRkrMY9VVFz3M	5104 Grand Loop, Ruston, WA 98407, USA	47.2996187	-122.5054020	google_places	\N	\N	\N	2026-05-28 00:35:17.95226+00	2026-05-28 16:23:57.110548+00
483de931-da18-4605-946a-bfdbfd888a7c	6d08439f-6aac-4bd2-bbba-99566b214b69	Taco Street	ChIJP5Ez1CZTkFQRrrs7_c-svxI	5101 Yacht Club Rd, Tacoma, WA 98407, USA	47.2990172	-122.5071037	google_places	\N	\N	\N	2026-05-28 00:35:17.95823+00	2026-05-28 16:23:57.110548+00
48e37acc-bb5c-46b5-a063-1b1e2256929c	6d08439f-6aac-4bd2-bbba-99566b214b69	Rock The Dock Pub & Grill	ChIJ9d_hLKRVkFQRn6dP0XAtGPU	535 Dock St #118, Tacoma, WA 98402, USA	47.2594473	-122.4380926	google_places	\N	\N	\N	2026-05-28 00:35:18.280286+00	2026-05-28 16:23:57.110548+00
5722404d-359f-4baa-851c-4ee7c411e05c	6d08439f-6aac-4bd2-bbba-99566b214b69	Parkway Tavern	ChIJ4_0lWwdVkFQRg4kX2QRcn0k	313 N I St #1, Tacoma, WA 98403, USA	47.2631344	-122.4537461	google_places	\N	\N	\N	2026-05-28 00:35:18.282376+00	2026-05-28 16:23:57.110548+00
a62e01f2-98ea-4e40-851f-26f28903b467	6d08439f-6aac-4bd2-bbba-99566b214b69	The SandBar & Grill	ChIJ8TROHg1WkFQRT5CsHXzoLLA	1941 Marine View Dr, Tacoma, WA 98422, USA	47.2715960	-122.3734473	google_places	\N	\N	\N	2026-05-28 00:35:18.416587+00	2026-05-28 16:23:57.110548+00
ea7c1312-2cfc-44ff-bb38-cd3958d82224	6d08439f-6aac-4bd2-bbba-99566b214b69	Indochine On Pearl	ChIJ2V8W2p1UkFQRnAwkcSRVDd4	4612 N Pearl St, Tacoma, WA 98407, USA	47.2913906	-122.5161064	google_places	\N	\N	\N	2026-05-28 00:35:18.65871+00	2026-05-28 16:23:57.110548+00
9719c00b-78b4-4d85-9529-31a20559e866	6d08439f-6aac-4bd2-bbba-99566b214b69	Grit City Breakfast Bar and Grill	ChIJg8diOvNVkFQRN69YD7dgG80	3829 6th Ave, Tacoma, WA 98406, USA	47.2554670	-122.4882239	google_places	\N	\N	\N	2026-05-28 00:35:17.402133+00	2026-05-28 16:23:57.110548+00
211d0a9c-b785-4160-8f53-9f3fa1f63d25	6d08439f-6aac-4bd2-bbba-99566b214b69	Ben Dews Clubhouse Grill	ChIJoR8zsC2rkVQRQuY28OWmLPo	6501 6th Ave, Tacoma, WA 98406, USA	47.2557175	-122.5246441	google_places	\N	\N	\N	2026-05-28 00:35:17.402821+00	2026-05-28 16:23:57.110548+00
82734133-5b87-40f4-be92-231625c41be2	6d08439f-6aac-4bd2-bbba-99566b214b69	Cuerno Bravo Steakhouse	ChIJ20WJfARVkFQReoAHtr4khG4	616 St Helens Ave, Tacoma, WA 98402, USA	47.2579410	-122.4430373	google_places	\N	\N	\N	2026-05-28 00:35:17.629812+00	2026-05-28 16:23:57.110548+00
90be48d3-16db-40ad-875e-8ae5accef839	6d08439f-6aac-4bd2-bbba-99566b214b69	Hank's Bar & Pizza	ChIJYe8GtwZVkFQRmm2Jt1_6AlE	524 N K St, Tacoma, WA 98403, USA	47.2620814	-122.4584513	google_places	\N	\N	\N	2026-05-28 00:35:17.637764+00	2026-05-28 16:23:57.110548+00
b9c376f0-e4a7-4ea0-a7bb-ba82a85cb0bc	6d08439f-6aac-4bd2-bbba-99566b214b69	Zen Ramen & Sushi Burrito - Downtown Tacoma	ChIJSVIRm9lVkFQRMo3h2pa4xKc	322 Tacoma Ave S, Tacoma, WA 98402, USA	47.2602066	-122.4464438	google_places	\N	\N	\N	2026-05-28 00:35:17.640033+00	2026-05-28 16:23:57.110548+00
e40f7bf1-1f07-47c0-b207-013ffc0e8cee	6d08439f-6aac-4bd2-bbba-99566b214b69	7 Seas Brewery and Taproom	ChIJew4LgXBVkFQRaqtGuVSalSk	2101 Jefferson Ave, Tacoma, WA 98402, USA	47.2424444	-122.4390500	google_places	2026-05-28 16:24:27.526528+00	no_hh_found	050b7800-dc37-4ff5-b32e-ce692cd67d51	2026-05-27 21:09:48.41814+00	2026-05-28 16:24:27.526528+00
cae88f3f-77fe-4a8b-83da-a6dee7b40ed8	6d08439f-6aac-4bd2-bbba-99566b214b69	Tower Lanes Entertainment Center	ChIJL_M6-yyrkVQRlX54gZo8FrM	6323 6th Ave, Tacoma, WA 98406, USA	47.2565397	-122.5223031	google_places	2026-05-28 16:24:58.816714+00	no_hh_found	74de3472-713f-488d-887d-f72670bb5f80	2026-05-27 21:09:48.421545+00	2026-05-28 16:24:58.816714+00
9d55c42e-d3e0-455d-b92d-604f96bdd57a	6d08439f-6aac-4bd2-bbba-99566b214b69	Harbor City Tacoma Restaurant	ChIJbSA8VDr_kFQRuGfDaiR8ClI	4816 Pacific Ave, Tacoma, WA 98408, USA	47.2130567	-122.4343038	google_places	2026-05-28 16:27:59.047017+00	no_hh_found	8d62e9f3-6b90-4160-8a2d-15c38fd85504	2026-05-28 00:35:16.514449+00	2026-05-28 16:27:59.047017+00
5fb56adf-1fd6-4603-9c3e-19c6299f3953	6d08439f-6aac-4bd2-bbba-99566b214b69	Red Lobster	ChIJhUeLfDoAkVQRAx6YunUchO8	1929 S 72nd St, Tacoma, WA 98408, USA	47.1922180	-122.4610480	google_places	2026-05-28 02:54:35.822926+00	\N	\N	2026-05-28 00:01:36.606106+00	2026-05-28 02:54:35.822926+00
be9388b2-8ca3-4040-9fff-d832017071f2	6d08439f-6aac-4bd2-bbba-99566b214b69	Peaks & Pints Tacoma Craft Beer Bar, Bottle Shop & Restaurant	ChIJvbIeQO9UkFQRDiegk9A4gMk	3816 N 26th St B, Tacoma, WA 98407, USA	47.2707970	-122.4881940	google_places	\N	\N	\N	2026-05-28 00:35:17.955953+00	2026-05-28 16:23:57.110548+00
a4f45275-f71c-4df5-bed1-b5334abff70a	6d08439f-6aac-4bd2-bbba-99566b214b69	La Perla del Mar VIP	ChIJKVlHy3sBkVQRw51jNFiDSX4	6812 Tacoma Mall Blvd, Tacoma, WA 98409, USA	47.1947085	-122.4637186	google_places	2026-05-28 16:25:57.777451+00	confirmed_hh	45482768-dcac-40a6-a125-ae5260737790	2026-05-28 00:01:36.608329+00	2026-05-28 16:25:57.777451+00
\.


--
-- Data for Name: spatial_ref_sys; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.spatial_ref_sys (srid, auth_name, auth_srid, srtext, proj4text) FROM stdin;
\.


--
-- Data for Name: submitter_trust; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.submitter_trust (fingerprint, ip_hashes, submission_count, accuracy_count, inaccuracy_count, trust_score, first_seen, last_seen, banned, created_at, updated_at) FROM stdin;
4b9f5d14-4953-4dd3-973a-6d711f37bf58	{a6c5bd5d0954107238a94350970eeb4e}	1	0	0	0	2026-05-27 19:18:15.758967+00	2026-05-27 19:18:15.758967+00	f	2026-05-27 19:18:15.758967+00	2026-05-27 19:18:15.758967+00
test-fp	\N	0	0	5	-50	2026-05-28 01:17:46.31+00	2026-05-28 01:18:27.823852+00	t	2026-05-28 01:17:46.31149+00	2026-05-28 01:18:27.823+00
\.


--
-- Data for Name: tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.tags (id, slug, label, category, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: venue_tags; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.venue_tags (venue_id, tag_id, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: venues; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.venues (id, city_id, name, slug, address, lat, lng, timezone, neighborhood_id, type, chain_id, website_url, other_url, google_place_id, phone, status, flagged_at, flag_reason, flag_vote_count, promotion_tier, promotion_starts_at, promotion_ends_at, data_completeness, last_verified_at, claimed_by_user_id, created_at, updated_at, deleted_at, price_level, hero_image_url) FROM stdin;
f084ea27-3349-4f5e-89d9-76ca3e4d5664	6d08439f-6aac-4bd2-bbba-99566b214b69	WildFin American Grill	wildfin-american-grill	5115 Grand Loop, Tacoma, WA 98407, USA	47.2997269	-122.5048001	\N	68ca57a8-7330-4be6-86e0-59d4ce8e5189	\N	\N	https://www.wildfinamericangrill.com/tacoma/	\N	ChIJieLjwn5TkFQR8dR325LVbgg	(253) 267-1772	active	\N	\N	0	none	\N	\N	verified	2026-05-28 07:00:29.553+00	\N	2026-05-28 02:48:13.281053+00	2026-05-28 07:00:29.553+00	\N	2	\N
050b7800-dc37-4ff5-b32e-ce692cd67d51	6d08439f-6aac-4bd2-bbba-99566b214b69	7 Seas Brewery and Taproom	7-seas-brewery-and-taproom	2101 Jefferson Ave, Tacoma, WA 98402, USA	47.2424444	-122.4390500	\N	\N	\N	\N	http://www.7seasbrewing.com/	\N	ChIJew4LgXBVkFQRaqtGuVSalSk	(253) 572-7770	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 16:24:27.057274+00	2026-05-28 16:24:27.524874+00	\N	\N	/uploads/venues/050b7800-dc37-4ff5-b32e-ce692cd67d51.jpg
2e8a4ccb-03ae-4f09-80b9-11e31fe2a1e1	6d08439f-6aac-4bd2-bbba-99566b214b69	Matador Tacoma	matador-tacoma	721 Pacific Ave, Tacoma, WA 98402, USA	47.2566835	-122.4391313	\N	4c233d94-3543-4d4f-8a50-30ae8c2f1030	\N	\N	https://matadorrestaurants.com/locations/tacoma	\N	ChIJJQLIIKFVkFQRD81XZZfpDzU	(253) 627-7100	active	\N	\N	0	none	\N	\N	verified	2026-05-28 07:00:55.029+00	\N	2026-05-28 04:14:01.02358+00	2026-05-28 07:00:55.03+00	\N	2	/uploads/venues/2e8a4ccb-03ae-4f09-80b9-11e31fe2a1e1.jpg
74de3472-713f-488d-887d-f72670bb5f80	6d08439f-6aac-4bd2-bbba-99566b214b69	Tower Lanes Entertainment Center	tower-lanes-entertainment-center	6323 6th Ave, Tacoma, WA 98406, USA	47.2565397	-122.5223031	\N	\N	\N	\N	https://www.towerlanes.net/	\N	ChIJL_M6-yyrkVQRlX54gZo8FrM	(253) 564-8853	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 16:24:58.343937+00	2026-05-28 16:24:58.815506+00	\N	1	/uploads/venues/74de3472-713f-488d-887d-f72670bb5f80.jpg
86ae81ad-001f-4e55-ae51-b5cf9aab7bd4	6d08439f-6aac-4bd2-bbba-99566b214b69	Duke's Seafood Tacoma	duke-s-seafood-tacoma	3327 Ruston Way, Tacoma, WA 98402, USA	47.2825834	-122.4798449	\N	\N	\N	\N	https://www.dukesseafood.com/locations/tacoma?utm_source=gmb&utm_medium=organic&utm_campaign=gmb-tracking&utm_term=tacoma	\N	ChIJh6xeOvVUkFQRJfy6SlzyElQ	(253) 752-5444	active	\N	\N	0	none	\N	\N	verified	2026-05-28 07:01:12.878+00	\N	2026-05-28 04:14:18.769348+00	2026-05-28 07:01:12.878+00	\N	2	/uploads/venues/86ae81ad-001f-4e55-ae51-b5cf9aab7bd4.jpg
32cced2d-aa82-4c84-810f-79defafcab80	6d08439f-6aac-4bd2-bbba-99566b214b69	Wooden City Tacoma	wooden-city-tacoma	1102 Broadway Ste 102, Tacoma, WA 98402, USA	47.2529070	-122.4404120	\N	\N	\N	\N	http://woodencitytacoma.com/	\N	ChIJ5YkliQhVkFQRwj4AtgUheqs	(253) 503-0762	active	\N	\N	0	none	\N	\N	complete	2026-05-28 16:25:14.074+00	\N	2026-05-28 16:25:14.074991+00	2026-05-28 16:25:14.498013+00	\N	\N	/uploads/venues/32cced2d-aa82-4c84-810f-79defafcab80.jpg
8dfc3c14-8fe5-4ad2-84d3-c4e2d8fc5766	6d08439f-6aac-4bd2-bbba-99566b214b69	Tides Tavern	tides-tavern	2925 Harborview Dr, Gig Harbor, WA 98335, USA	47.3292704	-122.5783631	\N	\N	\N	\N	http://www.tidestavern.com/	\N	ChIJ5c9c3MJSkFQRq1gjFnXdVNU	(253) 858-3982	active	\N	\N	0	none	\N	\N	verified	2026-05-28 07:01:22.924+00	\N	2026-05-28 04:16:50.878146+00	2026-05-28 07:01:22.924+00	\N	2	/uploads/venues/8dfc3c14-8fe5-4ad2-84d3-c4e2d8fc5766.jpg
45482768-dcac-40a6-a125-ae5260737790	6d08439f-6aac-4bd2-bbba-99566b214b69	La Perla del Mar VIP	la-perla-del-mar-vip	6812 Tacoma Mall Blvd, Tacoma, WA 98409, USA	47.1947085	-122.4637186	\N	\N	\N	\N	https://laperladelmarvip.com/	\N	ChIJKVlHy3sBkVQRw51jNFiDSX4	(253) 267-0087	active	\N	\N	0	none	\N	\N	complete	2026-05-28 16:25:56.751+00	\N	2026-05-28 16:25:56.75239+00	2026-05-28 16:25:57.76258+00	\N	4	/uploads/venues/45482768-dcac-40a6-a125-ae5260737790.jpg
3fb4a64d-b265-4f51-aa7e-eb41696e739a	6d08439f-6aac-4bd2-bbba-99566b214b69	Side Piece Kitchen	side-piece-kitchen	4704 S Oakes St, Tacoma, WA 98409, USA	47.2139038	-122.4731413	\N	\N	\N	\N	http://www.sidepiecekitchen.com/home	\N	ChIJEy4U0GsBkVQRj5skZhmdHjQ	(253) 544-5469	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 16:26:22.475307+00	2026-05-28 16:26:22.956965+00	\N	2	/uploads/venues/3fb4a64d-b265-4f51-aa7e-eb41696e739a.jpg
efd18f5e-dc1d-4a95-8141-6e4aaf9c5d3b	6d08439f-6aac-4bd2-bbba-99566b214b69	The Church Cantina	the-church-cantina	5240 S Tacoma Way, Tacoma, WA 98409, USA	47.2083709	-122.4841907	\N	\N	\N	\N	https://m.facebook.com/The-Church-Cantina-1500987603340103/	\N	ChIJ8f21Oi4BkVQRj2rT5LGrpfw	(253) 292-0544	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 16:27:03.182753+00	2026-05-28 16:27:04.010062+00	\N	2	/uploads/venues/efd18f5e-dc1d-4a95-8141-6e4aaf9c5d3b.jpg
8d62e9f3-6b90-4160-8a2d-15c38fd85504	6d08439f-6aac-4bd2-bbba-99566b214b69	Harbor City Tacoma Restaurant	harbor-city-tacoma-restaurant	4816 Pacific Ave, Tacoma, WA 98408, USA	47.2130567	-122.4343038	\N	\N	\N	\N	https://harborcitytacoma.com/	\N	ChIJbSA8VDr_kFQRuGfDaiR8ClI	(253) 503-3398	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 16:27:58.650092+00	2026-05-28 16:27:59.04601+00	\N	2	/uploads/venues/8d62e9f3-6b90-4160-8a2d-15c38fd85504.jpg
b54309be-dfc2-4d0f-8343-211a2e608654	6d08439f-6aac-4bd2-bbba-99566b214b69	Kizuki Ramen & Izakaya (Tacoma Mall)	kizuki-ramen-izakaya-tacoma-mall	4502 S Steele St Suite 501A, Tacoma, WA 98409, USA	47.2165555	-122.4673336	\N	\N	\N	\N	https://www.kizuki.com/	\N	ChIJZW8KR8X_kFQRYQ4vTYaZae4	(877) 839-1418	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 16:29:05.430666+00	2026-05-28 16:29:05.811448+00	\N	2	/uploads/venues/b54309be-dfc2-4d0f-8343-211a2e608654.jpg
980af0d3-6bbc-4426-968d-9af26a33d24a	6d08439f-6aac-4bd2-bbba-99566b214b69	Loak Toung Thai	loak-toung-thai	3807 Center St, Tacoma, WA 98409, USA	47.2316011	-122.4865257	\N	\N	\N	\N	http://loaktoungthai.com/	\N	ChIJ71UpqUxVkFQRZHEY9vqCq8E	(253) 248-9813	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 16:30:18.841971+00	2026-05-28 16:30:19.776494+00	\N	1	/uploads/venues/980af0d3-6bbc-4426-968d-9af26a33d24a.jpg
ec8dd737-3038-48a6-8253-398551456eba	6d08439f-6aac-4bd2-bbba-99566b214b69	Cooper's Food and Drink	cooper-s-food-and-drink	5928 N 26th St, Tacoma, WA 98407, USA	47.2708665	-122.5183557	\N	68ca57a8-7330-4be6-86e0-59d4ce8e5189	\N	\N	https://coopersfoodanddrink.com/	\N	ChIJIbfpv8ZVkFQRpB0X4HwsrRU	(253) 503-0329	active	\N	\N	0	none	\N	\N	complete	2026-05-28 04:42:27.861+00	\N	2026-05-28 04:42:27.862475+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/ec8dd737-3038-48a6-8253-398551456eba.jpg
f1bd428d-77e0-4bd0-916d-71e8e23acd5c	117cbe36-eae9-45cf-b54f-df358dbb49c1	Peter Piper Pizza	peter-piper-pizza	6040 S Central Ave, Phoenix, AZ 85040, USA	33.3908690	-112.0746270	\N	\N	\N	\N	https://locations.peterpiperpizza.com/az/phoenix/6040-s-central-avenue?utm_source=Google&utm_medium=Rio	\N	ChIJYzWWbkgQK4cRbC414oNc97U	(602) 243-7183	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 04:50:10.790104+00	2026-05-28 04:50:11.063481+00	\N	2	/uploads/venues/f1bd428d-77e0-4bd0-916d-71e8e23acd5c.jpg
136d95f4-f4fe-4c68-9756-61e95d616593	6d08439f-6aac-4bd2-bbba-99566b214b69	Moctezuma's Mexican Restaurant & Tequila Bar	moctezuma-s-mexican-restaurant-tequila-bar	4102 S 56th St, Tacoma, WA 98409, USA	47.2058553	-122.4926243	\N	eb67d99c-2255-4bc4-8f00-9ca845d4895b	\N	\N	http://www.moctezumas.com/	\N	ChIJLyuk0gwAkVQRtoAeL9ftbOI	(253) 474-5593	active	\N	\N	0	none	\N	\N	complete	2026-05-28 07:01:50.55+00	\N	2026-05-28 04:19:40.53136+00	2026-05-28 07:01:50.551+00	\N	2	/uploads/venues/136d95f4-f4fe-4c68-9756-61e95d616593.jpg
47e57312-265e-4750-9fe4-2d4397281da2	6d08439f-6aac-4bd2-bbba-99566b214b69	The Cheesecake Factory	the-cheesecake-factory	4502 S Steele St Space 1300A, Tacoma, WA 98409, USA	47.2154281	-122.4686605	\N	eb67d99c-2255-4bc4-8f00-9ca845d4895b	\N	\N	https://locations.thecheesecakefactory.com/wa/tacoma-199.html?utm_source=Google&utm_medium=Maps&utm_campaign=Google+Places	\N	ChIJ9RbaA_7_kFQRtldrBPub5ic	(253) 474-1112	active	\N	\N	0	none	\N	\N	verified	2026-05-28 07:02:00.747+00	\N	2026-05-28 04:23:15.705943+00	2026-05-28 07:02:00.747+00	\N	2	/uploads/venues/47e57312-265e-4750-9fe4-2d4397281da2.jpg
ba69f35b-87d6-43ad-86b3-676405154f18	6d08439f-6aac-4bd2-bbba-99566b214b69	Copper & Salt Northwest Kitchen	copper-salt-northwest-kitchen	5125 Grand Loop, Ruston, WA 98407, USA	47.3000786	-122.5055707	\N	\N	\N	\N	https://www.copperandsaltnw.com/	\N	ChIJPbhV5n5TkFQR9NC_bLs4FLg	(253) 319-8290	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:24:25.018+00	\N	2026-05-28 05:24:25.019358+00	2026-05-28 05:24:25.43713+00	\N	\N	/uploads/venues/ba69f35b-87d6-43ad-86b3-676405154f18.jpg
a26ed922-1345-47f3-9ceb-2b2cf9cb0b94	6d08439f-6aac-4bd2-bbba-99566b214b69	Boran Royal Thai Cuisine	boran-royal-thai-cuisine	5108 Grand Loop, Ruston, WA 98407, USA	47.2998758	-122.5056451	\N	\N	\N	\N	https://www.boranroyalthaicuisine.com/	\N	ChIJa38vI5VTkFQRiTlomtvdPKw	(253) 212-9545	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:54:49.639+00	\N	2026-05-28 05:54:49.638844+00	2026-05-28 05:54:50.113856+00	\N	2	/uploads/venues/a26ed922-1345-47f3-9ceb-2b2cf9cb0b94.jpg
74c6c578-bcb2-4660-b260-7aa6832d7cae	6d08439f-6aac-4bd2-bbba-99566b214b69	Restaurante Los Amigos	restaurante-los-amigos	6402 S Tacoma Way, Tacoma, WA 98409, USA	47.1986278	-122.4846501	\N	eb67d99c-2255-4bc4-8f00-9ca845d4895b	\N	\N	\N	\N	ChIJSRfmR2sAkVQRr4dO-b-xZR4	(253) 475-4865	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 04:19:41.576204+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/74c6c578-bcb2-4660-b260-7aa6832d7cae.jpg
6f03ec34-412e-48c5-bf11-94661f730bc6	6d08439f-6aac-4bd2-bbba-99566b214b69	Stanley & Seafort's	stanley-seafort-s	115 E 34th St, Tacoma, WA 98404, USA	47.2307279	-122.4313898	\N	7df56d24-5b3c-4c74-9ed2-45515dc63f0b	\N	\N	https://www.stanleyandseaforts.com/	\N	ChIJiRNVe4j_kFQRGTdGxMPGF6Y	(253) 473-7300	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:12:01.874+00	\N	2026-05-28 05:12:01.875154+00	2026-05-28 05:57:16.813278+00	\N	3	/uploads/venues/6f03ec34-412e-48c5-bf11-94661f730bc6.jpg
b3bb868e-7be4-43c8-8cb5-4d180bbe156b	117cbe36-eae9-45cf-b54f-df358dbb49c1	Mariscos El Maviri	mariscos-el-maviri	702 W Broadway Rd, Phoenix, AZ 85041, USA	33.4073472	-112.0826149	\N	\N	\N	\N	http://ordermariscoselmaviri.mobile-webview2.com/	\N	ChIJtSVjkw4VK4cRH3u4EUPm9ws	(602) 380-4881	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 04:51:43.215465+00	2026-05-28 04:51:43.824709+00	\N	\N	/uploads/venues/b3bb868e-7be4-43c8-8cb5-4d180bbe156b.jpg
7f17585c-3db9-48fc-a95c-ad18fd7303ab	117cbe36-eae9-45cf-b54f-df358dbb49c1	El Tenampa Bar Nightclub	el-tenampa-bar-nightclub	1707 W Broadway Rd, Phoenix, AZ 85041, USA	33.4064455	-112.0954541	\N	\N	\N	\N	\N	\N	ChIJAzo19AcRK4cRO7WwxrF4XCY	(602) 348-5855	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 04:51:44.419446+00	2026-05-28 04:51:44.739201+00	\N	1	/uploads/venues/7f17585c-3db9-48fc-a95c-ad18fd7303ab.jpg
54e0af61-1d8f-491e-8ad7-82bded8cab79	117cbe36-eae9-45cf-b54f-df358dbb49c1	Poncho's Mexican Food and Cantina	poncho-s-mexican-food-and-cantina	7202 S Central Ave, Phoenix, AZ 85042, USA	33.3811211	-112.0736456	\N	\N	\N	\N	http://www.ponchosmexicanfood.com/	\N	ChIJWRmCOEAQK4cRAqbt-JZ4nZM	(602) 276-2437	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 04:55:03.519827+00	2026-05-28 04:55:03.96503+00	\N	2	/uploads/venues/54e0af61-1d8f-491e-8ad7-82bded8cab79.jpg
eb12b6de-509d-4132-a122-663a0f3d87a0	117cbe36-eae9-45cf-b54f-df358dbb49c1	Cocina Madrigal	cocina-madrigal	1530 E Wood St, Phoenix, AZ 85040, USA	33.4088003	-112.0474248	\N	\N	\N	\N	http://www.cocinamadrigal.com/	\N	ChIJqcv0fSoOK4cRSbR-rnW7jlU	(602) 243-9000	active	\N	\N	0	none	\N	\N	complete	2026-05-28 04:57:33.669+00	\N	2026-05-28 04:57:33.670769+00	2026-05-28 04:57:34.106601+00	\N	2	/uploads/venues/eb12b6de-509d-4132-a122-663a0f3d87a0.jpg
3f9ef141-8a71-4eb2-b538-74abd86bd596	117cbe36-eae9-45cf-b54f-df358dbb49c1	Hola Cabrito	hola-cabrito	4835 S 16th St, Phoenix, AZ 85040, USA	33.4022450	-112.0467977	\N	\N	\N	\N	https://holacabrito.com/	\N	ChIJ7WxT7dUPK4cRDI12rcsOQB8	(602) 513-8384	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 05:01:33.516631+00	2026-05-28 05:01:33.957661+00	\N	2	/uploads/venues/3f9ef141-8a71-4eb2-b538-74abd86bd596.jpg
a2abbcb1-1bca-420d-b470-54540603f882	117cbe36-eae9-45cf-b54f-df358dbb49c1	Chichis cabaret	chichis-cabaret	3420 S Central Ave, Phoenix, AZ 85040, USA	33.4152976	-112.0736883	\N	\N	\N	\N	\N	\N	ChIJOzrz77gRK4cR8tYGMd_gQn4	\N	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 05:01:34.706621+00	2026-05-28 05:01:35.082562+00	\N	\N	/uploads/venues/a2abbcb1-1bca-420d-b470-54540603f882.jpg
62ac51f5-97fd-46f7-aa8d-4aa956950ed0	117cbe36-eae9-45cf-b54f-df358dbb49c1	La Frontera #2	la-frontera-2	3501 W Lincoln St, Phoenix, AZ 85009, USA	33.4422332	-112.1350142	\N	\N	\N	\N	\N	\N	ChIJm_5Kb_oTK4cRtyiEm1HKg0A	(623) 326-6808	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 05:06:28.022025+00	2026-05-28 05:06:28.367888+00	\N	1	/uploads/venues/62ac51f5-97fd-46f7-aa8d-4aa956950ed0.jpg
284f62fe-9820-4784-8ec5-11e52a14929d	117cbe36-eae9-45cf-b54f-df358dbb49c1	BurritoLoco HotSos	burritoloco-hotsos	2446 W Buckeye Rd, Phoenix, AZ 85009, USA	33.4370864	-112.1127224	\N	\N	\N	\N	\N	\N	ChIJW-19CgATK4cRA_s3kTD_ZHs	(623) 224-3368	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 05:06:29.024735+00	2026-05-28 05:06:29.359391+00	\N	1	/uploads/venues/284f62fe-9820-4784-8ec5-11e52a14929d.jpg
64d7e3c1-c875-476a-befe-731f6e3ba12f	6d08439f-6aac-4bd2-bbba-99566b214b69	Tacoma Comedy Club	tacoma-comedy-club	933 Market St, Tacoma, WA 98402, USA	47.2540000	-122.4413583	\N	4c233d94-3543-4d4f-8a50-30ae8c2f1030	\N	\N	http://www.tacomacomedyclub.com/	\N	ChIJh0J1hApVkFQRM29mIx-BCZw	(253) 282-7203	active	\N	\N	0	none	\N	\N	complete	2026-05-28 07:00:46.496+00	\N	2026-05-28 02:54:34.140043+00	2026-05-28 07:00:46.496+00	\N	\N	\N
05c5e2f7-0a19-41cd-9641-e3eb3a6bdc99	6d08439f-6aac-4bd2-bbba-99566b214b69	The Tipsy Tomato Bar & Kitchen	the-tipsy-tomato-bar-kitchen	3878 Center St, Tacoma, WA 98409, USA	47.2310710	-122.4882577	\N	eb67d99c-2255-4bc4-8f00-9ca845d4895b	\N	\N	\N	\N	ChIJQZKXWbOqkVQRd8-YlNZnr_U	(253) 302-4101	active	\N	\N	0	none	\N	\N	stub	\N	\N	2026-05-28 04:38:55.499659+00	2026-05-28 05:57:16.813278+00	\N	1	/uploads/venues/05c5e2f7-0a19-41cd-9641-e3eb3a6bdc99.jpg
1eb6d9f2-2cc9-4554-8c85-14262d2b6b4f	6d08439f-6aac-4bd2-bbba-99566b214b69	Mandolin Sushi & Japanese steak house	mandolin-sushi-japanese-steak-house	3923 S 12th St, Tacoma, WA 98405, USA	47.2503320	-122.4900375	\N	7df08048-e317-46b6-bfc6-39453d925e4c	\N	\N	https://mandolinsushi.cfd/	\N	ChIJZydIoiVVkFQRj4U6bguFDhs	(253) 301-4969	active	\N	\N	0	none	\N	\N	complete	2026-05-28 04:48:48.428+00	\N	2026-05-28 04:48:48.42961+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/1eb6d9f2-2cc9-4554-8c85-14262d2b6b4f.jpg
8b7ad42b-54f1-42a4-86ea-0fa33a7e7cf5	6d08439f-6aac-4bd2-bbba-99566b214b69	The Cloverleaf	the-cloverleaf	6430 6th Ave, Tacoma, WA 98406, USA	47.2550236	-122.5241665	\N	68ca57a8-7330-4be6-86e0-59d4ce8e5189	\N	\N	http://www.cloverleafpizza.com/	\N	ChIJeylnSSyrkVQR65IBvWufyUY	(253) 565-1111	active	\N	\N	0	none	\N	\N	complete	2026-05-28 04:52:00.827+00	\N	2026-05-28 04:52:00.827281+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/8b7ad42b-54f1-42a4-86ea-0fa33a7e7cf5.jpg
f1960a89-c3dc-41f7-8793-f6af6ee2f178	6d08439f-6aac-4bd2-bbba-99566b214b69	Tacoma Pie	tacoma-pie	4417 6th Ave, Tacoma, WA 98406, USA	47.2554284	-122.4970993	\N	aef20968-e193-4ba8-97cb-96762bc4379b	\N	\N	http://tacomapie.com/	\N	ChIJSUvKgH2rkVQRHtpWk28RnNo	(253) 320-8734	active	\N	\N	0	none	\N	\N	complete	2026-05-28 04:57:30.684+00	\N	2026-05-28 04:57:30.685393+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/f1960a89-c3dc-41f7-8793-f6af6ee2f178.jpg
46c02e15-b0d5-404a-93b9-852c734bf4c1	6d08439f-6aac-4bd2-bbba-99566b214b69	Hob Nob Restaurant	hob-nob-restaurant	716 6th Ave, Tacoma, WA 98405, USA	47.2575027	-122.4479285	\N	4c233d94-3543-4d4f-8a50-30ae8c2f1030	\N	\N	http://hobnobtacoma.com/	\N	ChIJe9yIywlVkFQRxfPPQ1frDZ0	(253) 272-3200	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:05:06.067+00	\N	2026-05-28 05:05:06.068098+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/46c02e15-b0d5-404a-93b9-852c734bf4c1.jpg
bc36476a-7f26-4cf2-94d3-d34f6ef2acf4	6d08439f-6aac-4bd2-bbba-99566b214b69	Steel Creek Tacoma	steel-creek-tacoma	1114 Broadway, Tacoma, WA 98402, USA	47.2525978	-122.4403127	\N	4c233d94-3543-4d4f-8a50-30ae8c2f1030	\N	\N	http://steelcreekcountry.com/	\N	ChIJad1RrgpVkFQRylhJpMPGW0w	(253) 627-1229	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:06:20.223+00	\N	2026-05-28 05:06:20.224202+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/bc36476a-7f26-4cf2-94d3-d34f6ef2acf4.jpg
67e6dd9a-6128-4644-9524-74d6dc70bf90	6d08439f-6aac-4bd2-bbba-99566b214b69	Woobling Korean BBQ - Tacoma Mall	woobling-korean-bbq-tacoma-mall	4502 S Steele St #1510, Tacoma, WA 98409, USA	47.2149433	-122.4671490	\N	eb67d99c-2255-4bc4-8f00-9ca845d4895b	\N	\N	http://woobling.com/	\N	ChIJYTjY82YBkVQRF5Nq9pJtQ00	(253) 267-1876	active	\N	\N	0	none	\N	\N	complete	2026-05-28 07:02:26.874+00	\N	2026-05-28 04:31:16.47044+00	2026-05-28 07:02:26.874+00	\N	2	/uploads/venues/67e6dd9a-6128-4644-9524-74d6dc70bf90.jpg
c996fb9c-3ce1-4c70-8b49-993a9c2931e0	6d08439f-6aac-4bd2-bbba-99566b214b69	Ivar's Seafood Bar	ivar-s-seafood-bar	1820 S Mildred St, Tacoma, WA 98465, USA	47.2436714	-122.5269699	\N	68ca57a8-7330-4be6-86e0-59d4ce8e5189	\N	\N	http://www.ivars.com/	\N	ChIJ4xTJVNiqkVQRxJ7LXQthzXo	(253) 565-5196	active	\N	\N	0	none	\N	\N	complete	2026-05-28 07:02:51.9+00	\N	2026-05-28 04:38:54.421355+00	2026-05-28 07:02:51.9+00	\N	2	/uploads/venues/c996fb9c-3ce1-4c70-8b49-993a9c2931e0.jpg
0195a6b7-2921-4fbe-89a3-9a6124675efd	6d08439f-6aac-4bd2-bbba-99566b214b69	THEKOI Sushi & Sake	thekoi-sushi-sake	1552 Commerce St #100, Tacoma, WA 98402, USA	47.2473240	-122.4383340	\N	4c233d94-3543-4d4f-8a50-30ae8c2f1030	\N	\N	http://thekoisushi.com/	\N	ChIJc9q2J3RVkFQRgfAOjB5B-yc	(253) 272-0996	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:08:42.286+00	\N	2026-05-28 05:08:42.286716+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/0195a6b7-2921-4fbe-89a3-9a6124675efd.jpg
21cb5a4e-084b-4f9f-aa58-0436c13283f8	6d08439f-6aac-4bd2-bbba-99566b214b69	The Fish Peddler Restaurant on Foss Waterway	the-fish-peddler-restaurant-on-foss-waterway	1199 Dock St, Tacoma, WA 98402, USA	47.2498910	-122.4342987	\N	4c233d94-3543-4d4f-8a50-30ae8c2f1030	\N	\N	https://www.pacificseafood.com/contact-us/retail-locations/tacoma-fish-peddler/	\N	ChIJHfr1PJ5VkFQRnXzOqNp8L_8	(253) 627-2158	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:10:20.373+00	\N	2026-05-28 05:10:20.374021+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/21cb5a4e-084b-4f9f-aa58-0436c13283f8.jpg
342962f3-148e-4a1b-95c6-19e04f062cc4	6d08439f-6aac-4bd2-bbba-99566b214b69	Dirty Oscar's Annex	dirty-oscar-s-annex	2309 6th Ave, Tacoma, WA 98403, USA	47.2557089	-122.4676113	\N	aef20968-e193-4ba8-97cb-96762bc4379b	\N	\N	https://www.dirtyoscarsannex.com/	\N	ChIJ009IXRpVkFQR4rqVeHBSfyc	(253) 572-0588	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:45:18.117+00	\N	2026-05-28 05:45:18.116488+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/342962f3-148e-4a1b-95c6-19e04f062cc4.jpg
a011b25c-cf48-4f38-9a99-1c3ebe21b351	6d08439f-6aac-4bd2-bbba-99566b214b69	McMenamins Pub at Elks Temple	mcmenamins-pub-at-elks-temple	565 Broadway, Tacoma, WA 98402, USA	47.2579654	-122.4409506	\N	4c233d94-3543-4d4f-8a50-30ae8c2f1030	\N	\N	https://www.mcmenamins.com/elks-temple/mcmenamins-pub-at-elks-temple	\N	ChIJG4_tEtNVkFQR8miBHOlsVo0	(253) 300-8754	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:48:39.09+00	\N	2026-05-28 05:48:39.090873+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/a011b25c-cf48-4f38-9a99-1c3ebe21b351.jpg
7835dabe-de73-428b-98a7-bdab39639b8d	6d08439f-6aac-4bd2-bbba-99566b214b69	Cliff House Restaurant	cliff-house-restaurant	6300 Marine View Dr, Tacoma, WA 98422, USA	47.2975361	-122.4321644	\N	ac564746-6f07-46a4-a661-3ef8b593e238	\N	\N	http://cliffhousetacoma.com/	\N	ChIJDXABqBhUkFQRiV_vCb2I37g	(253) 927-0400	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:52:53.918+00	\N	2026-05-28 05:52:53.918899+00	2026-05-28 05:57:16.813278+00	\N	3	/uploads/venues/7835dabe-de73-428b-98a7-bdab39639b8d.jpg
7578a24e-e856-4423-828c-85e50e752295	6d08439f-6aac-4bd2-bbba-99566b214b69	Red Star Taco Bar	red-star-taco-bar	454 St Helens Ave, Tacoma, WA 98402, USA	47.2587530	-122.4435950	\N	4c233d94-3543-4d4f-8a50-30ae8c2f1030	\N	\N	https://www.redstartacobar.com/tacoma	\N	ChIJ8R8oD6dVkFQRBY-OiPgsFNw	(253) 545-9795	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:14:11.053+00	\N	2026-05-28 05:14:11.053813+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/7578a24e-e856-4423-828c-85e50e752295.jpg
47269131-e41b-4e1f-8309-fa42377fb3ee	6d08439f-6aac-4bd2-bbba-99566b214b69	Lobster Shop	lobster-shop	4015 Ruston Way, Tacoma, WA 98402, USA	47.2877620	-122.4894560	\N	aef20968-e193-4ba8-97cb-96762bc4379b	\N	\N	http://www.lobstershop.com/	\N	ChIJyR-0BolUkFQRvI1rH74SNbU	(253) 759-2165	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:23:45.875+00	\N	2026-05-28 05:23:45.875513+00	2026-05-28 05:57:16.813278+00	\N	3	/uploads/venues/47269131-e41b-4e1f-8309-fa42377fb3ee.jpg
edd135a1-86db-4245-ac88-9a462399e420	6d08439f-6aac-4bd2-bbba-99566b214b69	Cactus Restaurant Proctor	cactus-restaurant-proctor	2506 N Proctor St, Tacoma, WA 98406, USA	47.2702982	-122.4890604	\N	aef20968-e193-4ba8-97cb-96762bc4379b	\N	\N	https://www.cactusrestaurants.com/location/locations-proctor	\N	ChIJ_ZQUeRRVkFQRohTdOmDzA2E	(253) 458-9900	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:25:33.87+00	\N	2026-05-28 05:25:33.871237+00	2026-05-28 05:57:16.813278+00	\N	3	/uploads/venues/edd135a1-86db-4245-ac88-9a462399e420.jpg
36fccf79-e2a8-4d10-bba9-853a6fb993c5	6d08439f-6aac-4bd2-bbba-99566b214b69	Twisted Fork Saloon	twisted-fork-saloon	5005 Main St, Tacoma, WA 98407, USA	47.2983254	-122.5039835	\N	68ca57a8-7330-4be6-86e0-59d4ce8e5189	\N	\N	http://twistedfs.com/	\N	ChIJKYuJksFTkFQR0PwA8geyqwc	(253) 426-1641	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:56:40.713+00	\N	2026-05-28 05:56:40.713388+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/36fccf79-e2a8-4d10-bba9-853a6fb993c5.jpg
c2f25fe4-8378-42d0-b404-312d71156b57	6d08439f-6aac-4bd2-bbba-99566b214b69	Ram Restaurant & Brewery	ram-restaurant-brewery	3001 Ruston Way, Tacoma, WA 98402, USA	47.2797352	-122.4747478	\N	aef20968-e193-4ba8-97cb-96762bc4379b	\N	\N	https://theram.com/	\N	ChIJ4YLV-vVUkFQRMuhYvHycVz0	(253) 756-7886	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:35:08.413+00	\N	2026-05-28 05:35:08.413001+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/c2f25fe4-8378-42d0-b404-312d71156b57.jpg
2ed6e99b-59dd-47a7-8513-42e238c95e57	6d08439f-6aac-4bd2-bbba-99566b214b69	Woven Seafood & Chophouse	woven-seafood-chophouse	3017 Ruston Way, Tacoma, WA 98402, USA	47.2802023	-122.4757995	\N	aef20968-e193-4ba8-97cb-96762bc4379b	\N	\N	https://eatwoven.com/	\N	ChIJ_2IfXABVkFQRwEZBUQpsRBo	(253) 650-9500	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:36:06.195+00	\N	2026-05-28 05:36:06.196874+00	2026-05-28 05:57:16.813278+00	\N	\N	/uploads/venues/2ed6e99b-59dd-47a7-8513-42e238c95e57.jpg
206b4cb8-9441-4ad1-95af-59d1bd3a043a	6d08439f-6aac-4bd2-bbba-99566b214b69	Katie Downs Waterfront Tavern	katie-downs-waterfront-tavern	3211 Ruston Way, Tacoma, WA 98402, USA	47.2816327	-122.4788388	\N	aef20968-e193-4ba8-97cb-96762bc4379b	\N	\N	https://www.katiedowns.com/?utm_source=google&utm_medium=local	\N	ChIJWamQE_VUkFQRJaV5sgykO2s	(253) 756-0771	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:38:51.464+00	\N	2026-05-28 05:38:51.46493+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/206b4cb8-9441-4ad1-95af-59d1bd3a043a.jpg
7c9c5219-668d-4842-b458-92ed04599bd8	6d08439f-6aac-4bd2-bbba-99566b214b69	Cooks Tavern	cooks-tavern	3201 N 26th St, Tacoma, WA 98407, USA	47.2711890	-122.4779301	\N	aef20968-e193-4ba8-97cb-96762bc4379b	\N	\N	http://www.cookstavern.com/	\N	ChIJ8dnI8vpUkFQRTbY1noWVlU0	(253) 327-1777	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:41:03.942+00	\N	2026-05-28 05:41:03.943567+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/7c9c5219-668d-4842-b458-92ed04599bd8.jpg
14cba4a7-3820-4823-8f52-97208ce749ed	6d08439f-6aac-4bd2-bbba-99566b214b69	Harbor Lights	harbor-lights	2761 Ruston Way, Tacoma, WA 98402, USA	47.2792004	-122.4744305	\N	aef20968-e193-4ba8-97cb-96762bc4379b	\N	\N	https://www.anthonys.com/restaurant/harbor-lights/	\N	ChIJbXHrC_ZUkFQRHHhmyDgICok	(253) 752-8600	active	\N	\N	0	none	\N	\N	complete	2026-05-28 05:42:52.49+00	\N	2026-05-28 05:42:52.490431+00	2026-05-28 05:57:16.813278+00	\N	2	/uploads/venues/14cba4a7-3820-4823-8f52-97208ce749ed.jpg
ab76e992-6499-4593-8954-7963cc7e5d9f	6d08439f-6aac-4bd2-bbba-99566b214b69	Airport Tavern Music Hall	airport-tavern-music-hall	5406 S Tacoma Way, Tacoma, WA 98409, USA	47.2077879	-122.4841828	\N	eb67d99c-2255-4bc4-8f00-9ca845d4895b	\N	\N	https://www.airporttavern.com/	\N	ChIJ5b2eZA4AkVQRXtrJP_Yb324	(253) 212-0709	active	\N	\N	0	none	\N	\N	verified	2026-05-28 07:02:08.485+00	\N	2026-05-28 04:25:50.122997+00	2026-05-28 07:02:08.485+00	\N	1	/uploads/venues/ab76e992-6499-4593-8954-7963cc7e5d9f.jpg
\.


--
-- Data for Name: verification_attempts; Type: TABLE DATA; Schema: public; Owner: -
--

COPY public.verification_attempts (id, submission_id, source, url, fetched_at, ai_summary, supports_change, confidence, created_at, updated_at) FROM stdin;
\.


--
-- Data for Name: geocode_settings; Type: TABLE DATA; Schema: tiger; Owner: -
--

COPY tiger.geocode_settings (name, setting, unit, category, short_desc) FROM stdin;
\.


--
-- Data for Name: pagc_gaz; Type: TABLE DATA; Schema: tiger; Owner: -
--

COPY tiger.pagc_gaz (id, seq, word, stdword, token, is_custom) FROM stdin;
\.


--
-- Data for Name: pagc_lex; Type: TABLE DATA; Schema: tiger; Owner: -
--

COPY tiger.pagc_lex (id, seq, word, stdword, token, is_custom) FROM stdin;
\.


--
-- Data for Name: pagc_rules; Type: TABLE DATA; Schema: tiger; Owner: -
--

COPY tiger.pagc_rules (id, rule, is_custom) FROM stdin;
\.


--
-- Data for Name: topology; Type: TABLE DATA; Schema: topology; Owner: -
--

COPY topology.topology (id, name, srid, "precision", hasz) FROM stdin;
\.


--
-- Data for Name: layer; Type: TABLE DATA; Schema: topology; Owner: -
--

COPY topology.layer (topology_id, layer_id, schema_name, table_name, feature_column, feature_type, level, child_id) FROM stdin;
\.


--
-- Name: __drizzle_migrations_id_seq; Type: SEQUENCE SET; Schema: drizzle; Owner: -
--

SELECT pg_catalog.setval('drizzle.__drizzle_migrations_id_seq', 6, true);


--
-- Name: topology_id_seq; Type: SEQUENCE SET; Schema: topology; Owner: -
--

SELECT pg_catalog.setval('topology.topology_id_seq', 1, false);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: bam bam_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.bam
    ADD CONSTRAINT bam_pkey PRIMARY KEY (id);


--
-- Name: job job_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job
    ADD CONSTRAINT job_pkey PRIMARY KEY (name, id);


--
-- Name: job_common job_common_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job_common
    ADD CONSTRAINT job_common_pkey PRIMARY KEY (name, id);


--
-- Name: queue queue_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.queue
    ADD CONSTRAINT queue_pkey PRIMARY KEY (name);


--
-- Name: schedule schedule_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.schedule
    ADD CONSTRAINT schedule_pkey PRIMARY KEY (name, key);


--
-- Name: subscription subscription_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.subscription
    ADD CONSTRAINT subscription_pkey PRIMARY KEY (event, name);


--
-- Name: version version_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.version
    ADD CONSTRAINT version_pkey PRIMARY KEY (version);


--
-- Name: warning warning_pkey; Type: CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.warning
    ADD CONSTRAINT warning_pkey PRIMARY KEY (id);


--
-- Name: ai_usage_ledger ai_usage_ledger_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_ledger
    ADD CONSTRAINT ai_usage_ledger_pkey PRIMARY KEY (id);


--
-- Name: audit_log audit_log_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.audit_log
    ADD CONSTRAINT audit_log_pkey PRIMARY KEY (id);


--
-- Name: chains chains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chains
    ADD CONSTRAINT chains_pkey PRIMARY KEY (id);


--
-- Name: chains chains_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.chains
    ADD CONSTRAINT chains_slug_unique UNIQUE (slug);


--
-- Name: cities cities_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_pkey PRIMARY KEY (id);


--
-- Name: cities cities_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.cities
    ADD CONSTRAINT cities_slug_unique UNIQUE (slug);


--
-- Name: community_flags community_flags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.community_flags
    ADD CONSTRAINT community_flags_pkey PRIMARY KEY (id);


--
-- Name: edit_submissions edit_submissions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.edit_submissions
    ADD CONSTRAINT edit_submissions_pkey PRIMARY KEY (id);


--
-- Name: happy_hour_exceptions happy_hour_exceptions_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.happy_hour_exceptions
    ADD CONSTRAINT happy_hour_exceptions_pkey PRIMARY KEY (id);


--
-- Name: happy_hours happy_hours_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.happy_hours
    ADD CONSTRAINT happy_hours_pkey PRIMARY KEY (id);


--
-- Name: neighborhoods neighborhoods_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.neighborhoods
    ADD CONSTRAINT neighborhoods_pkey PRIMARY KEY (id);


--
-- Name: offerings offerings_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offerings
    ADD CONSTRAINT offerings_pkey PRIMARY KEY (id);


--
-- Name: seed_candidates seed_candidates_google_place_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_candidates
    ADD CONSTRAINT seed_candidates_google_place_id_unique UNIQUE (google_place_id);


--
-- Name: seed_candidates seed_candidates_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_candidates
    ADD CONSTRAINT seed_candidates_pkey PRIMARY KEY (id);


--
-- Name: submitter_trust submitter_trust_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.submitter_trust
    ADD CONSTRAINT submitter_trust_pkey PRIMARY KEY (fingerprint);


--
-- Name: tags tags_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_pkey PRIMARY KEY (id);


--
-- Name: tags tags_slug_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.tags
    ADD CONSTRAINT tags_slug_unique UNIQUE (slug);


--
-- Name: venue_tags venue_tags_venue_id_tag_id_pk; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_tags
    ADD CONSTRAINT venue_tags_venue_id_tag_id_pk PRIMARY KEY (venue_id, tag_id);


--
-- Name: venues venues_google_place_id_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_google_place_id_unique UNIQUE (google_place_id);


--
-- Name: venues venues_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_pkey PRIMARY KEY (id);


--
-- Name: verification_attempts verification_attempts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_attempts
    ADD CONSTRAINT verification_attempts_pkey PRIMARY KEY (id);


--
-- Name: job_common_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX job_common_i1 ON pgboss.job_common USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'created'::pgboss.job_state) AND (policy = 'short'::text));


--
-- Name: job_common_i2; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX job_common_i2 ON pgboss.job_common USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state = 'active'::pgboss.job_state) AND (policy = 'singleton'::text));


--
-- Name: job_common_i3; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX job_common_i3 ON pgboss.job_common USING btree (name, state, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'stately'::text));


--
-- Name: job_common_i4; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX job_common_i4 ON pgboss.job_common USING btree (name, singleton_on, COALESCE(singleton_key, ''::text)) WHERE ((state <> 'cancelled'::pgboss.job_state) AND (singleton_on IS NOT NULL));


--
-- Name: job_common_i5; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX job_common_i5 ON pgboss.job_common USING btree (name, start_after) INCLUDE (priority, created_on, id) WHERE (state < 'active'::pgboss.job_state);


--
-- Name: job_common_i6; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX job_common_i6 ON pgboss.job_common USING btree (name, COALESCE(singleton_key, ''::text)) WHERE ((state <= 'active'::pgboss.job_state) AND (policy = 'exclusive'::text));


--
-- Name: job_common_i7; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX job_common_i7 ON pgboss.job_common USING btree (name, group_id) WHERE ((state = 'active'::pgboss.job_state) AND (group_id IS NOT NULL));


--
-- Name: job_common_i8; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE UNIQUE INDEX job_common_i8 ON pgboss.job_common USING btree (name, singleton_key) WHERE ((state = ANY (ARRAY['active'::pgboss.job_state, 'retry'::pgboss.job_state, 'failed'::pgboss.job_state])) AND (policy = 'key_strict_fifo'::text));


--
-- Name: warning_i1; Type: INDEX; Schema: pgboss; Owner: -
--

CREATE INDEX warning_i1 ON pgboss.warning USING btree (created_on DESC);


--
-- Name: ai_usage_ledger_city_month_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_ledger_city_month_idx ON public.ai_usage_ledger USING btree (city_id, month);


--
-- Name: ai_usage_ledger_month_stage_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX ai_usage_ledger_month_stage_idx ON public.ai_usage_ledger USING btree (month, stage);


--
-- Name: audit_log_row_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX audit_log_row_idx ON public.audit_log USING btree (table_name, row_id);


--
-- Name: community_flags_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX community_flags_target_idx ON public.community_flags USING btree (target_type, target_id);


--
-- Name: edit_submissions_fingerprint_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX edit_submissions_fingerprint_idx ON public.edit_submissions USING btree (submitter_fingerprint);


--
-- Name: edit_submissions_parent_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX edit_submissions_parent_idx ON public.edit_submissions USING btree (parent_submission_id);


--
-- Name: edit_submissions_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX edit_submissions_status_idx ON public.edit_submissions USING btree (status);


--
-- Name: edit_submissions_target_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX edit_submissions_target_idx ON public.edit_submissions USING btree (target_type, target_id);


--
-- Name: happy_hours_natural_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX happy_hours_natural_uq ON public.happy_hours USING btree (venue_id, days_of_week, start_time, end_time, location_within_venue) WHERE (deleted_at IS NULL);


--
-- Name: happy_hours_venue_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX happy_hours_venue_idx ON public.happy_hours USING btree (venue_id);


--
-- Name: neighborhoods_city_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX neighborhoods_city_idx ON public.neighborhoods USING btree (city_id);


--
-- Name: neighborhoods_city_slug_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX neighborhoods_city_slug_uq ON public.neighborhoods USING btree (city_id, slug);


--
-- Name: neighborhoods_polygon_gix; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX neighborhoods_polygon_gix ON public.neighborhoods USING gist (polygon);


--
-- Name: offerings_happy_hour_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX offerings_happy_hour_idx ON public.offerings USING btree (happy_hour_id);


--
-- Name: venues_city_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX venues_city_idx ON public.venues USING btree (city_id);


--
-- Name: venues_city_slug_uq; Type: INDEX; Schema: public; Owner: -
--

CREATE UNIQUE INDEX venues_city_slug_uq ON public.venues USING btree (city_id, slug);


--
-- Name: venues_neighborhood_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX venues_neighborhood_idx ON public.venues USING btree (neighborhood_id);


--
-- Name: venues_status_idx; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX venues_status_idx ON public.venues USING btree (status);


--
-- Name: job_common_pkey; Type: INDEX ATTACH; Schema: pgboss; Owner: -
--

ALTER INDEX pgboss.job_pkey ATTACH PARTITION pgboss.job_common_pkey;


--
-- Name: job_common dlq_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job_common
    ADD CONSTRAINT dlq_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: job_common q_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.job_common
    ADD CONSTRAINT q_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE RESTRICT DEFERRABLE INITIALLY DEFERRED;


--
-- Name: queue queue_dead_letter_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.queue
    ADD CONSTRAINT queue_dead_letter_fkey FOREIGN KEY (dead_letter) REFERENCES pgboss.queue(name);


--
-- Name: schedule schedule_name_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.schedule
    ADD CONSTRAINT schedule_name_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE CASCADE;


--
-- Name: subscription subscription_name_fkey; Type: FK CONSTRAINT; Schema: pgboss; Owner: -
--

ALTER TABLE ONLY pgboss.subscription
    ADD CONSTRAINT subscription_name_fkey FOREIGN KEY (name) REFERENCES pgboss.queue(name) ON DELETE CASCADE;


--
-- Name: ai_usage_ledger ai_usage_ledger_city_id_cities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_ledger
    ADD CONSTRAINT ai_usage_ledger_city_id_cities_id_fk FOREIGN KEY (city_id) REFERENCES public.cities(id);


--
-- Name: ai_usage_ledger ai_usage_ledger_submission_id_edit_submissions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.ai_usage_ledger
    ADD CONSTRAINT ai_usage_ledger_submission_id_edit_submissions_id_fk FOREIGN KEY (submission_id) REFERENCES public.edit_submissions(id);


--
-- Name: edit_submissions edit_submissions_parent_submission_id_edit_submissions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.edit_submissions
    ADD CONSTRAINT edit_submissions_parent_submission_id_edit_submissions_id_fk FOREIGN KEY (parent_submission_id) REFERENCES public.edit_submissions(id);


--
-- Name: happy_hour_exceptions happy_hour_exceptions_happy_hour_id_happy_hours_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.happy_hour_exceptions
    ADD CONSTRAINT happy_hour_exceptions_happy_hour_id_happy_hours_id_fk FOREIGN KEY (happy_hour_id) REFERENCES public.happy_hours(id);


--
-- Name: happy_hours happy_hours_venue_id_venues_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.happy_hours
    ADD CONSTRAINT happy_hours_venue_id_venues_id_fk FOREIGN KEY (venue_id) REFERENCES public.venues(id);


--
-- Name: neighborhoods neighborhoods_city_id_cities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.neighborhoods
    ADD CONSTRAINT neighborhoods_city_id_cities_id_fk FOREIGN KEY (city_id) REFERENCES public.cities(id);


--
-- Name: neighborhoods neighborhoods_parent_id_neighborhoods_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.neighborhoods
    ADD CONSTRAINT neighborhoods_parent_id_neighborhoods_id_fk FOREIGN KEY (parent_id) REFERENCES public.neighborhoods(id);


--
-- Name: offerings offerings_happy_hour_id_happy_hours_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.offerings
    ADD CONSTRAINT offerings_happy_hour_id_happy_hours_id_fk FOREIGN KEY (happy_hour_id) REFERENCES public.happy_hours(id);


--
-- Name: seed_candidates seed_candidates_city_id_cities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_candidates
    ADD CONSTRAINT seed_candidates_city_id_cities_id_fk FOREIGN KEY (city_id) REFERENCES public.cities(id);


--
-- Name: seed_candidates seed_candidates_resulting_venue_id_venues_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.seed_candidates
    ADD CONSTRAINT seed_candidates_resulting_venue_id_venues_id_fk FOREIGN KEY (resulting_venue_id) REFERENCES public.venues(id);


--
-- Name: venue_tags venue_tags_tag_id_tags_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_tags
    ADD CONSTRAINT venue_tags_tag_id_tags_id_fk FOREIGN KEY (tag_id) REFERENCES public.tags(id);


--
-- Name: venue_tags venue_tags_venue_id_venues_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venue_tags
    ADD CONSTRAINT venue_tags_venue_id_venues_id_fk FOREIGN KEY (venue_id) REFERENCES public.venues(id);


--
-- Name: venues venues_chain_id_chains_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_chain_id_chains_id_fk FOREIGN KEY (chain_id) REFERENCES public.chains(id);


--
-- Name: venues venues_city_id_cities_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_city_id_cities_id_fk FOREIGN KEY (city_id) REFERENCES public.cities(id);


--
-- Name: venues venues_neighborhood_id_neighborhoods_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.venues
    ADD CONSTRAINT venues_neighborhood_id_neighborhoods_id_fk FOREIGN KEY (neighborhood_id) REFERENCES public.neighborhoods(id);


--
-- Name: verification_attempts verification_attempts_submission_id_edit_submissions_id_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.verification_attempts
    ADD CONSTRAINT verification_attempts_submission_id_edit_submissions_id_fk FOREIGN KEY (submission_id) REFERENCES public.edit_submissions(id);


--
-- PostgreSQL database dump complete
--

