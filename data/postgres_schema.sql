--
-- PostgreSQL database dump
--

\restrict kyHqm4efzxsXTxwslCScbgA9kZe1x2hLnKk0yRZmgUbdaFdsSyGGe1vJit2O4yb

-- Dumped from database version 16.13 (Homebrew)
-- Dumped by pg_dump version 16.13 (Homebrew)

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
-- Name: public; Type: SCHEMA; Schema: -; Owner: -
--

CREATE SCHEMA public;


--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: -
--

COMMENT ON SCHEMA public IS 'standard public schema';


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
-- Name: api_domains; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_domains (
    uuid character varying(128) NOT NULL,
    alias character varying(120) NOT NULL,
    host text NOT NULL
);


--
-- Name: api_builder_samples; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.api_builder_samples (
    id bigint NOT NULL,
    uuid character varying(128) NOT NULL,
    title character varying(120) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    method character varying(16) NOT NULL,
    api_json jsonb NOT NULL,
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    sort_order integer DEFAULT 0 NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: api_builder_samples_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.api_builder_samples_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: api_builder_samples_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.api_builder_samples_id_seq OWNED BY public.api_builder_samples.id;


--
-- Name: apis; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apis (
    uuid character varying(128) NOT NULL,
    name character varying(120) NOT NULL,
    method character varying(16) NOT NULL,
    status character varying(32) DEFAULT 'draft'::character varying NOT NULL,
    api_json jsonb NOT NULL,
    layout jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: apis_snapshot; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apis_snapshot (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    api_uuid character varying(128) NOT NULL,
    name character varying(120) NOT NULL,
    method character varying(16) NOT NULL,
    status character varying(32) NOT NULL,
    api_json jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: apps; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.apps (
    id integer NOT NULL,
    uuid character varying(8) NOT NULL,
    alias character varying(120) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    default_layout_uuid character varying(128)
);


--
-- Name: apps_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.apps_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: apps_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.apps_id_seq OWNED BY public.apps.id;


--
-- Name: docs_client_block; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.docs_client_block (
    id bigint NOT NULL,
    uuid character varying(128) NOT NULL,
    block_type character varying(128) NOT NULL,
    display_name character varying(120) NOT NULL,
    category character varying(64) DEFAULT 'custom'::character varying NOT NULL,
    source_kind character varying(64) DEFAULT 'mokelay-editor'::character varying NOT NULL,
    source_file text DEFAULT ''::text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    toolbox jsonb DEFAULT '{}'::jsonb NOT NULL,
    initial_props jsonb DEFAULT '{}'::jsonb NOT NULL,
    property_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    event_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    method_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    data_fields_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    examples jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw_meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: docs_client_block_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.docs_client_block_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: docs_client_block_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.docs_client_block_id_seq OWNED BY public.docs_client_block.id;


--
-- Name: docs_server_block; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.docs_server_block (
    id bigint NOT NULL,
    uuid character varying(128) NOT NULL,
    function_name character varying(128) NOT NULL,
    display_name character varying(120) NOT NULL,
    category character varying(64) DEFAULT 'custom'::character varying NOT NULL,
    source_kind character varying(64) NOT NULL,
    source_package character varying(128) NOT NULL,
    source_file text DEFAULT ''::text NOT NULL,
    executor_name character varying(128) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    requires_datasource boolean DEFAULT false NOT NULL,
    input_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    output_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    error_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    config_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    runtime_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    examples jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw_meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: docs_server_block_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.docs_server_block_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: docs_server_block_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.docs_server_block_id_seq OWNED BY public.docs_server_block.id;


--
-- Name: docs_server_controller; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.docs_server_controller (
    id bigint NOT NULL,
    uuid character varying(128) NOT NULL,
    function_name character varying(128) NOT NULL,
    display_name character varying(120) NOT NULL,
    category character varying(64) DEFAULT 'custom'::character varying NOT NULL,
    source_kind character varying(64) NOT NULL,
    source_package character varying(128) NOT NULL,
    source_file text DEFAULT ''::text NOT NULL,
    executor_name character varying(128) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    status character varying(32) DEFAULT 'active'::character varying NOT NULL,
    input_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    node_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    error_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    config_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    runtime_schema jsonb DEFAULT '[]'::jsonb NOT NULL,
    examples jsonb DEFAULT '[]'::jsonb NOT NULL,
    source_refs jsonb DEFAULT '[]'::jsonb NOT NULL,
    raw_meta jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: docs_server_controller_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.docs_server_controller_id_seq
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: docs_server_controller_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.docs_server_controller_id_seq OWNED BY public.docs_server_controller.id;


--
-- Name: datasources; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.datasources (
    id integer NOT NULL,
    uuid character varying(8) NOT NULL,
    alias character varying(120) NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    schema jsonb DEFAULT '[]'::jsonb NOT NULL
);


--
-- Name: datasources_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.datasources_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: datasources_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.datasources_id_seq OWNED BY public.datasources.id;


--
-- Name: enterprise; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.enterprise (
    id integer NOT NULL,
    uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(120) NOT NULL
);


--
-- Name: enterprise_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.enterprise_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: enterprise_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.enterprise_id_seq OWNED BY public.enterprise.id;


--
-- Name: layouts; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.layouts (
    id integer NOT NULL,
    uuid character varying(128) NOT NULL,
    name character varying(120) NOT NULL,
    layout_json jsonb DEFAULT '{}'::jsonb NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: layouts_id_seq; Type: SEQUENCE; Schema: public; Owner: -
--

CREATE SEQUENCE public.layouts_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


--
-- Name: layouts_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: -
--

ALTER SEQUENCE public.layouts_id_seq OWNED BY public.layouts.id;


--
-- Name: pages; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.pages (
    uuid uuid DEFAULT gen_random_uuid() NOT NULL,
    name character varying(120) NOT NULL,
    blocks jsonb DEFAULT '[]'::jsonb NOT NULL,
    app_uuid character varying(8),
    layout_uuid character varying(128),
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: employees; Type: TABLE; Schema: public; Owner: -
--

CREATE TABLE public.employees (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    enterprise_uuid uuid NOT NULL,
    name character varying(120) NOT NULL,
    email character varying(255) NOT NULL,
    password_hash text NOT NULL,
    plan character varying(32) DEFAULT 'free'::character varying NOT NULL,
    created_at timestamp with time zone DEFAULT now() NOT NULL,
    updated_at timestamp with time zone DEFAULT now() NOT NULL
);


--
-- Name: __drizzle_migrations id; Type: DEFAULT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations ALTER COLUMN id SET DEFAULT nextval('drizzle.__drizzle_migrations_id_seq'::regclass);


--
-- Name: api_builder_samples id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_builder_samples ALTER COLUMN id SET DEFAULT nextval('public.api_builder_samples_id_seq'::regclass);


--
-- Name: apps id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apps ALTER COLUMN id SET DEFAULT nextval('public.apps_id_seq'::regclass);


--
-- Name: docs_client_block id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docs_client_block ALTER COLUMN id SET DEFAULT nextval('public.docs_client_block_id_seq'::regclass);


--
-- Name: docs_server_block id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docs_server_block ALTER COLUMN id SET DEFAULT nextval('public.docs_server_block_id_seq'::regclass);


--
-- Name: docs_server_controller id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docs_server_controller ALTER COLUMN id SET DEFAULT nextval('public.docs_server_controller_id_seq'::regclass);


--
-- Name: datasources id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasources ALTER COLUMN id SET DEFAULT nextval('public.datasources_id_seq'::regclass);


--
-- Name: enterprise id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprise ALTER COLUMN id SET DEFAULT nextval('public.enterprise_id_seq'::regclass);


--
-- Name: layouts id; Type: DEFAULT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.layouts ALTER COLUMN id SET DEFAULT nextval('public.layouts_id_seq'::regclass);


--
-- Name: __drizzle_migrations __drizzle_migrations_pkey; Type: CONSTRAINT; Schema: drizzle; Owner: -
--

ALTER TABLE ONLY drizzle.__drizzle_migrations
    ADD CONSTRAINT __drizzle_migrations_pkey PRIMARY KEY (id);


--
-- Name: api_domains api_domains_host_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_domains
    ADD CONSTRAINT api_domains_host_unique UNIQUE (host);


--
-- Name: api_domains api_domains_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_domains
    ADD CONSTRAINT api_domains_pkey PRIMARY KEY (uuid);


--
-- Name: api_builder_samples api_builder_samples_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_builder_samples
    ADD CONSTRAINT api_builder_samples_pkey PRIMARY KEY (id);


--
-- Name: api_builder_samples api_builder_samples_uuid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.api_builder_samples
    ADD CONSTRAINT api_builder_samples_uuid_unique UNIQUE (uuid);


--
-- Name: apis apis_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apis
    ADD CONSTRAINT apis_pkey PRIMARY KEY (uuid);


--
-- Name: apis_snapshot apis_snapshot_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apis_snapshot
    ADD CONSTRAINT apis_snapshot_pkey PRIMARY KEY (id);


--
-- Name: apps apps_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apps
    ADD CONSTRAINT apps_pkey PRIMARY KEY (id);


--
-- Name: apps apps_uuid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.apps
    ADD CONSTRAINT apps_uuid_unique UNIQUE (uuid);


--
-- Name: docs_client_block docs_client_block_block_type_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docs_client_block
    ADD CONSTRAINT docs_client_block_block_type_unique UNIQUE (block_type);


--
-- Name: docs_client_block docs_client_block_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docs_client_block
    ADD CONSTRAINT docs_client_block_pkey PRIMARY KEY (id);


--
-- Name: docs_client_block docs_client_block_uuid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docs_client_block
    ADD CONSTRAINT docs_client_block_uuid_unique UNIQUE (uuid);


--
-- Name: docs_server_block docs_server_block_function_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docs_server_block
    ADD CONSTRAINT docs_server_block_function_name_unique UNIQUE (function_name);


--
-- Name: docs_server_block docs_server_block_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docs_server_block
    ADD CONSTRAINT docs_server_block_pkey PRIMARY KEY (id);


--
-- Name: docs_server_block docs_server_block_uuid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docs_server_block
    ADD CONSTRAINT docs_server_block_uuid_unique UNIQUE (uuid);


--
-- Name: docs_server_controller docs_server_controller_function_name_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docs_server_controller
    ADD CONSTRAINT docs_server_controller_function_name_unique UNIQUE (function_name);


--
-- Name: docs_server_controller docs_server_controller_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docs_server_controller
    ADD CONSTRAINT docs_server_controller_pkey PRIMARY KEY (id);


--
-- Name: docs_server_controller docs_server_controller_uuid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.docs_server_controller
    ADD CONSTRAINT docs_server_controller_uuid_unique UNIQUE (uuid);


--
-- Name: idx_docs_server_block_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_docs_server_block_category ON public.docs_server_block USING btree (category);


--
-- Name: idx_docs_server_block_requires_datasource; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_docs_server_block_requires_datasource ON public.docs_server_block USING btree (requires_datasource);


--
-- Name: idx_docs_server_block_source_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_docs_server_block_source_kind ON public.docs_server_block USING btree (source_kind);


--
-- Name: idx_docs_server_controller_category; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_docs_server_controller_category ON public.docs_server_controller USING btree (category);


--
-- Name: idx_docs_server_controller_source_kind; Type: INDEX; Schema: public; Owner: -
--

CREATE INDEX idx_docs_server_controller_source_kind ON public.docs_server_controller USING btree (source_kind);


--
-- Name: layouts layouts_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.layouts
    ADD CONSTRAINT layouts_pkey PRIMARY KEY (id);


--
-- Name: layouts layouts_uuid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.layouts
    ADD CONSTRAINT layouts_uuid_unique UNIQUE (uuid);


--
-- Name: datasources datasources_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasources
    ADD CONSTRAINT datasources_pkey PRIMARY KEY (id);


--
-- Name: datasources datasources_uuid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.datasources
    ADD CONSTRAINT datasources_uuid_unique UNIQUE (uuid);


--
-- Name: enterprise enterprise_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprise
    ADD CONSTRAINT enterprise_pkey PRIMARY KEY (id);


--
-- Name: enterprise enterprise_uuid_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.enterprise
    ADD CONSTRAINT enterprise_uuid_unique UNIQUE (uuid);


--
-- Name: pages pages_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.pages
    ADD CONSTRAINT pages_pkey PRIMARY KEY (uuid);


--
-- Name: employees employees_email_unique; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_email_unique UNIQUE (email);


--
-- Name: employees employees_pkey; Type: CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_pkey PRIMARY KEY (id);


--
-- Name: employees employees_enterprise_uuid_enterprise_uuid_fk; Type: FK CONSTRAINT; Schema: public; Owner: -
--

ALTER TABLE ONLY public.employees
    ADD CONSTRAINT employees_enterprise_uuid_enterprise_uuid_fk FOREIGN KEY (enterprise_uuid) REFERENCES public.enterprise(uuid);


--
-- PostgreSQL database dump complete
--

\unrestrict kyHqm4efzxsXTxwslCScbgA9kZe1x2hLnKk0yRZmgUbdaFdsSyGGe1vJit2O4yb
