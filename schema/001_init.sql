-- ============================================================================
-- OSEM Clinical + Inventory System — Postgres schema (Supabase-ready)
-- Draft v6 — hygiene episodes confirmed as self/assisted (not AM/PM), now
-- enforced as at most one of each per chart entry. Staff position upgraded
-- from a guessed seed list to a real tbl_positions table (17 confirmed
-- values, 3 of which I didn't know existed: Occupational Therapist, Speech
-- Therapist, Healthcare Worker).
--
-- Read alongside OSEM_Schema_Notes.md.
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()
create extension if not exists "pg_trgm";    -- fuzzy resident-name search

-- ============================================================================
-- 1. ENUMS
-- ============================================================================

-- tbl_staff.role: coarse category for the audit-trail roster, used to
-- scope which staff show up in role-restricted staff-picker dropdowns
-- (e.g. nursing chart entries only offer STAFF, stock entries only offer
-- MODERATOR, ADMIN shows up everywhere). Started as a 7-value clinical
-- job-title list; collapsed to these 3 once it became clear the app only
-- ever needed this coarse a distinction -- tbl_positions is what carries
-- the real job title. Still a separate enum type from id_rights (login
-- access) even though the labels now match -- see id_rights below for why
-- they must stay decoupled.
create type staff_role as enum ('ADMIN', 'MODERATOR', 'STAFF');

-- tbl_staff.department: which clinical department the roster entry
-- belongs to. Added directly in Supabase after the initial rollout.
create type staff_dept as enum ('Nursing', 'Medical', 'Physiotherapy');

-- tbl_user_accounts.rights: login access level. Deliberately just 3 tiers,
-- decoupled from staff_role -- a login's rights and a roster entry's job
-- title are different concepts and must stay on separate enum types (they
-- used to share staff_role, which meant relabeling one silently relabeled
-- the other -- see git history on this file for how that went).
create type id_rights as enum ('ADMIN', 'MODERATOR', 'STAFF');

create type physio_setting_type as enum ('IP', 'OP');

-- One row per single storage-location balance change. Positive quantity_delta
-- = stock increased there; negative = decreased. This is the single event
-- vocabulary the whole inventory system runs on.
create type stock_movement_type as enum (
  'receive',             -- goods received from a supplier
  'transfer_out',        -- half of a branch-to-branch transfer: leaves a location
  'transfer_in',         -- half of a branch-to-branch transfer: arrives at a location
  'charge_deduction',    -- consumed / charged to a resident
  'adjustment'           -- manual stock-count correction (+/-)
);

create type stock_transfer_status as enum ('in_transit', 'confirmed', 'rejected', 'cancelled');
create type stock_request_status as enum ('draft', 'submitted', 'ordered', 'received', 'cancelled');

-- ============================================================================
-- 2. BRANCHES & STAFF
-- ============================================================================

-- Column names are PascalCase (BranchID/BranchName/...) -- renamed directly
-- in Supabase after the initial rollout, out of step with the rest of the
-- schema's snake_case convention. The app aliases them back to id/name/etc.
-- in its select() calls (see lib/lookups.ts, lib/current-user.ts) rather
-- than assume this table's naming everywhere else.
create table tbl_branches (
  "BranchID"      bigint generated always as identity primary key,
  "BranchName"    text not null,
  "BranchCode"    text not null unique,
  "BranchContact" text,
  "BranchAddress" text,
  "BranchLocale"  text,
  "Active"        text,   -- 'YES'/'NO', not boolean
  "Function"      text,   -- department code, e.g. 'NUR'
  staff_seq       bigint not null default 0,  -- next tbl_staff running number for this branch, see fn_generate_staff_id
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- Staff positions: real data from tbl_Position (17 rows), not a guess.
-- Replaces an earlier reconstructed list, which was missing Occupational
-- Therapist, Speech Therapist, and Healthcare Worker, and had "Rehab
-- Assistant" where the real table says "Rehab Assistance". Defined here,
-- before tbl_staff, since tbl_staff references it.
create table tbl_positions (
  id    bigint generated always as identity primary key,
  name  text not null unique
);

-- RLS for tbl_positions is enabled further below, right after
-- tbl_user_accounts and the auth_*() helper functions exist (auth_role()
-- queries tbl_user_accounts) -- see "MIGRATION FIX" note after
-- tbl_user_accounts.

insert into tbl_positions (name) values
  ('Medical Officer'),
  ('Specialist'),
  ('Consultant'),
  ('Medical Assistant'),
  ('Pharmacist'),
  ('Physiotherapist'),
  ('Assist. Physiotherapist'),
  ('Rehab Assistance'),
  ('Occupational Therapist'),
  ('Speech Therapist'),
  ('Staff Nurse'),
  ('Assist. Nurse'),
  ('Caregiver'),
  ('Healthcare Worker'),
  ('Head Nurse'),
  ('Assist. Head Nurse'),
  ('Nursing Director');

-- Clinical/operational roster: who did what, for audit trails and
-- attribution only (reviewed_by / created_by / registered_by columns
-- throughout this schema reference this table). Deliberately has nothing
-- to do with app login -- a person can be in this roster with no login at
-- all, or have a login that isn't tied to a roster entry.
-- PK is "StaffID", a text code "<BranchCode>-<running number within
-- branch>" (e.g. "AMN-1"), not a bigint identity -- auto-generated by
-- fn_generate_staff_id() below, never assigned by the app.
create table tbl_staff (
  "StaffID"     text primary key,
  branch_id     bigint not null references tbl_branches ("BranchID"),
  staff_name    text not null,
  position_id   bigint not null references tbl_positions (id),
  role          staff_role not null,
  department    staff_dept not null,
  status        text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_staff_branch on tbl_staff (branch_id);

-- Generates "StaffID" on insert: "<BranchCode>-<next running number for
-- that branch>", atomically via tbl_branches.staff_seq (the UPDATE ...
-- RETURNING row-locks the branch row, so concurrent inserts don't collide).
create or replace function fn_generate_staff_id() returns trigger
language plpgsql as $$
declare
  v_code text;
  v_next bigint;
begin
  if new."StaffID" is not null then
    return new;
  end if;
  update tbl_branches set staff_seq = staff_seq + 1
    where "BranchID" = new.branch_id
    returning staff_seq, "BranchCode" into v_next, v_code;
  new."StaffID" := v_code || '-' || v_next;
  return new;
end;
$$;

create trigger trg_generate_staff_id
before insert on tbl_staff
for each row execute function fn_generate_staff_id();

-- Login accounts. This -- not tbl_staff -- is what RLS reads: who can sign
-- in, which branch they're scoped to, what they're allowed to do. Logins
-- can be shared by multiple people at a branch, so this is NOT assumed to
-- identify who actually performed any given action -- forms that need that
-- (progress notes, resident admission, etc.) carry their own explicit
-- staff-picker field instead.
create table tbl_user_accounts (
  id            bigint generated always as identity primary key,
  auth_user_id  uuid not null unique references auth.users (id) on delete cascade,
  email         text not null,
  username      text not null,
  branch_id     bigint not null references tbl_branches ("BranchID"),
  rights        id_rights not null,
  status        text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index idx_user_accounts_branch on tbl_user_accounts (branch_id);

-- MIGRATION FIX: auth_account_id()/auth_branch_id()/auth_role() moved here
-- from section 14 (and tbl_positions' RLS block moved here from right after
-- tbl_positions) — both need tbl_user_accounts to exist first, and every RLS
-- policy in this file from here on needs these functions to exist first.
-- Running the file top-to-bottom in its original order failed at
-- tbl_positions' policies with "function auth_role() does not exist".
create or replace function auth_account_id() returns bigint
language sql stable security definer as $$
  select id from tbl_user_accounts where auth_user_id = auth.uid();
$$;

create or replace function auth_branch_id() returns bigint
language sql stable security definer as $$
  select branch_id from tbl_user_accounts where auth_user_id = auth.uid();
$$;

create or replace function auth_role() returns id_rights
language sql stable security definer as $$
  select rights from tbl_user_accounts where auth_user_id = auth.uid();
$$;

alter table tbl_user_accounts enable row level security;
create policy user_accounts_read on tbl_user_accounts for select
  using (auth_user_id = auth.uid() or auth_role() = 'ADMIN');
create policy user_accounts_write on tbl_user_accounts for all
  using (auth_role() = 'ADMIN') with check (auth_role() = 'ADMIN');

alter table tbl_positions enable row level security;
create policy tbl_positions_read on tbl_positions for select using (auth.role() = 'authenticated');
create policy tbl_positions_write on tbl_positions for all
  using (auth_role() = 'ADMIN') with check (auth_role() = 'ADMIN');

-- ============================================================================
-- 2B. LOOKUP VALUES — one generic, admin-editable table standing in for the
--     small reference tables Access had that are still simple flat lists
--     with no content confirmed yet (tbl_MealType etc. are now their own
--     dedicated tables — see notes doc for what's still outstanding).
--     Values here are suggestions the app offers in dropdowns — the
--     underlying columns stay plain text/free-form so nothing breaks if a
--     value isn't listed yet.
-- ============================================================================

create table tbl_lookup_values (
  id          bigint generated always as identity primary key,
  list_name   text not null,
  value       text not null,
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  unique (list_name, value)
);

alter table tbl_lookup_values enable row level security;
create policy lookup_values_read on tbl_lookup_values for select using (auth.role() = 'authenticated');
create policy lookup_values_write on tbl_lookup_values for all
  using (auth_role() = 'ADMIN') with check (auth_role() = 'ADMIN');

-- ============================================================================
-- 2C. DEDICATED REFERENCE TABLES
--     These six had real, structured content once exported (not just a flat
--     value list) — nationality has ISO codes, diagnosis has an English +
--     Malay name — so they get proper tables with real foreign keys from
--     tbl_residents / tbl_products, rather than living in tbl_lookup_values.
-- ============================================================================

create table tbl_nationalities (
  id                bigint generated always as identity primary key,
  alpha_2_code      text,
  alpha_3_code      text,
  country_name      text not null,
  nationality_label text not null   -- what's actually shown/stored, e.g. 'Malaysian'
);

create table tbl_diet_types (
  id    bigint generated always as identity primary key,
  name  text not null unique
);

create table tbl_feeding_types (
  id    bigint generated always as identity primary key,
  name  text not null unique
);

create table tbl_diagnosis_options (
  id      bigint generated always as identity primary key,
  name_en text not null unique,
  name_ms text
);

create table tbl_product_categories (
  id                bigint generated always as identity primary key,
  category_name     text not null unique,
  category_display  text
);

create table tbl_uoms (
  id    bigint generated always as identity primary key,
  code  text not null unique
);

-- Reference tables: everyone authenticated can read; only admin can edit.
do $$
declare t text;
begin
  foreach t in array array[
    'tbl_nationalities','tbl_diet_types','tbl_feeding_types',
    'tbl_diagnosis_options','tbl_product_categories','tbl_uoms'
  ]
  loop
    execute format('alter table %1$s enable row level security;', t);
    execute format('create policy %1$s_read on %1$s for select using (auth.role() = ''authenticated'');', t);
    execute format('create policy %1$s_write on %1$s for all using (auth_role() = ''ADMIN'') with check (auth_role() = ''ADMIN'');', t);
  end loop;
end $$;

-- Seed data, exported directly from the live Access tables.
-- tbl_nationalities seed (249 rows)
insert into tbl_nationalities (alpha_2_code, alpha_3_code, country_name, nationality_label) values
  ('MY', 'MYS', 'Malaysia', 'Malaysian'),
  ('AF', 'AFG', 'Afghanistan', 'Afghan'),
  ('AX', 'ALA', '?land Islands', '?land Island'),
  ('AL', 'ALB', 'Albania', 'Albanian'),
  ('DZ', 'DZA', 'Algeria', 'Algerian'),
  ('AS', 'ASM', 'American Samoa', 'American Samoan'),
  ('AD', 'AND', 'Andorra', 'Andorran'),
  ('AO', 'AGO', 'Angola', 'Angolan'),
  ('AI', 'AIA', 'Anguilla', 'Anguillan'),
  ('AQ', 'ATA', 'Antarctica', 'Antarctic'),
  ('AG', 'ATG', 'Antigua and Barbuda', 'Antiguan or Barbudan'),
  ('AR', 'ARG', 'Argentina', 'Argentine'),
  ('AM', 'ARM', 'Armenia', 'Armenian'),
  ('AW', 'ABW', 'Aruba', 'Aruban'),
  ('AU', 'AUS', 'Australia', 'Australian'),
  ('AT', 'AUT', 'Austria', 'Austrian'),
  ('AZ', 'AZE', 'Azerbaijan', 'Azerbaijani'),
  ('BS', 'BHS', 'Bahamas', 'Bahamian'),
  ('BH', 'BHR', 'Bahrain', 'Bahraini'),
  ('BD', 'BGD', 'Bangladesh', 'Bangladeshi'),
  ('BB', 'BRB', 'Barbados', 'Barbadian'),
  ('BY', 'BLR', 'Belarus', 'Belarusian'),
  ('BE', 'BEL', 'Belgium', 'Belgian'),
  ('BZ', 'BLZ', 'Belize', 'Belizean'),
  ('BJ', 'BEN', 'Benin', 'Beninese'),
  ('BM', 'BMU', 'Bermuda', 'Bermudian'),
  ('BT', 'BTN', 'Bhutan', 'Bhutanese'),
  ('BO', 'BOL', 'Bolivia (Plurinational State of)', 'Bolivian'),
  ('BQ', 'BES', 'Bonaire', 'Sint Eustatius and Saba'),
  ('BA', 'BIH', 'Bosnia and Herzegovina', 'Bosnian or Herzegovinian'),
  ('BW', 'BWA', 'Botswana', 'Motswana'),
  ('BV', 'BVT', 'Bouvet Island', 'Bouvet Island'),
  ('BR', 'BRA', 'Brazil', 'Brazilian'),
  ('IO', 'IOT', 'British Indian Ocean Territory', 'BIOT'),
  ('BN', 'BRN', 'Brunei Darussalam', 'Bruneian'),
  ('BG', 'BGR', 'Bulgaria', 'Bulgarian'),
  ('BF', 'BFA', 'Burkina Faso', 'Burkinab¨¦'),
  ('BI', 'BDI', 'Burundi', 'Burundian'),
  ('CV', 'CPV', 'Cabo Verde', 'Cabo Verdean'),
  ('KH', 'KHM', 'Cambodia', 'Cambodian'),
  ('CM', 'CMR', 'Cameroon', 'Cameroonian'),
  ('CA', 'CAN', 'Canada', 'Canadian'),
  ('KY', 'CYM', 'Cayman Islands', 'Caymanian'),
  ('CF', 'CAF', 'Central African Republic', 'Central African'),
  ('TD', 'TCD', 'Chad', 'Chadian'),
  ('CL', 'CHL', 'Chile', 'Chilean'),
  ('CN', 'CHN', 'China', 'Chinese'),
  ('CX', 'CXR', 'Christmas Island', 'Christmas Island'),
  ('CC', 'CCK', 'Cocos (Keeling Islands)', 'Cocos Island'),
  ('CO', 'COL', 'Colombia', 'Colombian'),
  ('KM', 'COM', 'Comoros', 'Comoran'),
  ('CG', 'COG', 'Congo (Republic of the)', 'Congolese'),
  ('CD', 'COD', 'Congo (Democratic Republic of the)', 'Congolese'),
  ('CK', 'COK', 'Cook Islands', 'Cook Island'),
  ('CR', 'CRI', 'Costa Rica', 'Costa Rican'),
  ('CI', 'CIV', 'C?te d''Ivoire', 'Ivorian'),
  ('HR', 'HRV', 'Croatia', 'Croatian'),
  ('CU', 'CUB', 'Cuba', 'Cuban'),
  ('CW', 'CUW', 'Cura?ao', 'Cura?aoan'),
  ('CY', 'CYP', 'Cyprus', 'Cypriot'),
  ('CZ', 'CZE', 'Czech Republic', 'Czech'),
  ('DK', 'DNK', 'Denmark', 'Danish'),
  ('DJ', 'DJI', 'Djibouti', 'Djiboutian'),
  ('DM', 'DMA', 'Dominica', 'Dominican'),
  ('DO', 'DOM', 'Dominican Republic', 'Dominican'),
  ('EC', 'ECU', 'Ecuador', 'Ecuadorian'),
  ('EG', 'EGY', 'Egypt', 'Egyptian'),
  ('SV', 'SLV', 'El Salvador', 'Salvadoran'),
  ('GQ', 'GNQ', 'Equatorial Guinea', 'Equatorial Guinean'),
  ('ER', 'ERI', 'Eritrea', 'Eritrean'),
  ('EE', 'EST', 'Estonia', 'Estonian'),
  ('ET', 'ETH', 'Ethiopia', 'Ethiopian'),
  ('FK', 'FLK', 'Falkland Islands (Malvinas)', 'Falkland Island'),
  ('FO', 'FRO', 'Faroe Islands', 'Faroese'),
  ('FJ', 'FJI', 'Fiji', 'Fijian'),
  ('FI', 'FIN', 'Finland', 'Finnish'),
  ('FR', 'FRA', 'France', 'French'),
  ('GF', 'GUF', 'French Guiana', 'French Guianese'),
  ('PF', 'PYF', 'French Polynesia', 'French Polynesian'),
  ('TF', 'ATF', 'French Southern Territories', 'French Southern Territories'),
  ('GA', 'GAB', 'Gabon', 'Gabonese'),
  ('GM', 'GMB', 'Gambia', 'Gambian'),
  ('GE', 'GEO', 'Georgia', 'Georgian'),
  ('DE', 'DEU', 'Germany', 'German'),
  ('GH', 'GHA', 'Ghana', 'Ghanaian'),
  ('GI', 'GIB', 'Gibraltar', 'Gibraltar'),
  ('GR', 'GRC', 'Greece', 'Greek'),
  ('GL', 'GRL', 'Greenland', 'Greenlandic'),
  ('GD', 'GRD', 'Grenada', 'Grenadian'),
  ('GP', 'GLP', 'Guadeloupe', 'Guadeloupe'),
  ('GU', 'GUM', 'Guam', 'Guamanian'),
  ('GT', 'GTM', 'Guatemala', 'Guatemalan'),
  ('GG', 'GGY', 'Guernsey', 'Channel Island'),
  ('GN', 'GIN', 'Guinea', 'Guinean'),
  ('GW', 'GNB', 'Guinea-Bissau', 'Bissau-Guinean'),
  ('GY', 'GUY', 'Guyana', 'Guyanese'),
  ('HT', 'HTI', 'Haiti', 'Haitian'),
  ('HM', 'HMD', 'Heard Island and McDonald Islands', 'Heard Island or McDonald Islands'),
  ('VA', 'VAT', 'Vatican City State', 'Vatican'),
  ('HN', 'HND', 'Honduras', 'Honduran'),
  ('HK', 'HKG', 'Hong Kong', 'Hong Kong'),
  ('HU', 'HUN', 'Hungary', 'Hungarian'),
  ('IS', 'ISL', 'Iceland', 'Icelandic'),
  ('IN', 'IND', 'India', 'Indian'),
  ('ID', 'IDN', 'Indonesia', 'Indonesian'),
  ('IR', 'IRN', 'Iran', 'Iranian'),
  ('IQ', 'IRQ', 'Iraq', 'Iraqi'),
  ('IE', 'IRL', 'Ireland', 'Irish'),
  ('IM', 'IMN', 'Isle of Man', 'Manx'),
  ('IL', 'ISR', 'Israel', 'Israeli'),
  ('IT', 'ITA', 'Italy', 'Italian'),
  ('JM', 'JAM', 'Jamaica', 'Jamaican'),
  ('JP', 'JPN', 'Japan', 'Japanese'),
  ('JE', 'JEY', 'Jersey', 'Channel Island'),
  ('JO', 'JOR', 'Jordan', 'Jordanian'),
  ('KZ', 'KAZ', 'Kazakhstan', 'Kazakhstani'),
  ('KE', 'KEN', 'Kenya', 'Kenyan'),
  ('KI', 'KIR', 'Kiribati', 'I-Kiribati'),
  ('KP', 'PRK', 'Korea (Democratic People''s Republic of)', 'North Korean'),
  ('KR', 'KOR', 'Korea (Republic of)', 'South Korean'),
  ('KW', 'KWT', 'Kuwait', 'Kuwaiti'),
  ('KG', 'KGZ', 'Kyrgyzstan', 'Kyrgyzstani'),
  ('LA', 'LAO', 'Lao People''s Democratic Republic', 'Lao'),
  ('LV', 'LVA', 'Latvia', 'Latvian'),
  ('LB', 'LBN', 'Lebanon', 'Lebanese'),
  ('LS', 'LSO', 'Lesotho', 'Basotho'),
  ('LR', 'LBR', 'Liberia', 'Liberian'),
  ('LY', 'LBY', 'Libya', 'Libyan'),
  ('LI', 'LIE', 'Liechtenstein', 'Liechtenstein'),
  ('LT', 'LTU', 'Lithuania', 'Lithuanian'),
  ('LU', 'LUX', 'Luxembourg', 'Luxembourg'),
  ('MO', 'MAC', 'Macao', 'Macanese'),
  ('MK', 'MKD', 'Macedonia (the former Yugoslav Republic of)', 'Macedonian'),
  ('MG', 'MDG', 'Madagascar', 'Malagasy'),
  ('MW', 'MWI', 'Malawi', 'Malawian'),
  ('MV', 'MDV', 'Maldives', 'Maldivian'),
  ('ML', 'MLI', 'Mali', 'Malian'),
  ('MT', 'MLT', 'Malta', 'Maltese'),
  ('MH', 'MHL', 'Marshall Islands', 'Marshallese'),
  ('MQ', 'MTQ', 'Martinique', 'Martiniquais'),
  ('MR', 'MRT', 'Mauritania', 'Mauritanian'),
  ('MU', 'MUS', 'Mauritius', 'Mauritian'),
  ('YT', 'MYT', 'Mayotte', 'Mahoran'),
  ('MX', 'MEX', 'Mexico', 'Mexican'),
  ('FM', 'FSM', 'Micronesia (Federated States of)', 'Micronesian'),
  ('MD', 'MDA', 'Moldova (Republic of)', 'Moldovan'),
  ('MC', 'MCO', 'Monaco', 'Mon¨¦gasque'),
  ('MN', 'MNG', 'Mongolia', 'Mongolian'),
  ('ME', 'MNE', 'Montenegro', 'Montenegrin'),
  ('MS', 'MSR', 'Montserrat', 'Montserratian'),
  ('MA', 'MAR', 'Morocco', 'Moroccan'),
  ('MZ', 'MOZ', 'Mozambique', 'Mozambican'),
  ('MM', 'MMR', 'Myanmar', 'Burmese'),
  ('NA', 'NAM', 'Namibia', 'Namibian'),
  ('NR', 'NRU', 'Nauru', 'Nauruan'),
  ('NP', 'NPL', 'Nepal', 'Nepali'),
  ('NL', 'NLD', 'Netherlands', 'Dutch'),
  ('NC', 'NCL', 'New Caledonia', 'New Caledonian'),
  ('NZ', 'NZL', 'New Zealand', 'New Zealand'),
  ('NI', 'NIC', 'Nicaragua', 'Nicaraguan'),
  ('NE', 'NER', 'Niger', 'Nigerien'),
  ('NG', 'NGA', 'Nigeria', 'Nigerian'),
  ('NU', 'NIU', 'Niue', 'Niuean'),
  ('NF', 'NFK', 'Norfolk Island', 'Norfolk Island'),
  ('MP', 'MNP', 'Northern Mariana Islands', 'Northern Marianan'),
  ('NO', 'NOR', 'Norway', 'Norwegian'),
  ('OM', 'OMN', 'Oman', 'Omani'),
  ('PK', 'PAK', 'Pakistan', 'Pakistani'),
  ('PW', 'PLW', 'Palau', 'Palauan'),
  ('PS', 'PSE', 'Palestine', 'State of'),
  ('PA', 'PAN', 'Panama', 'Panamanian'),
  ('PG', 'PNG', 'Papua New Guinea', 'Papua New Guinean'),
  ('PY', 'PRY', 'Paraguay', 'Paraguayan'),
  ('PE', 'PER', 'Peru', 'Peruvian'),
  ('PH', 'PHL', 'Philippines', 'Philippine'),
  ('PN', 'PCN', 'Pitcairn', 'Pitcairn Island'),
  ('PL', 'POL', 'Poland', 'Polish'),
  ('PT', 'PRT', 'Portugal', 'Portuguese'),
  ('PR', 'PRI', 'Puerto Rico', 'Puerto Rican'),
  ('QA', 'QAT', 'Qatar', 'Qatari'),
  ('RE', 'REU', 'R¨¦union', 'R¨¦unionese'),
  ('RO', 'ROU', 'Romania', 'Romanian'),
  ('RU', 'RUS', 'Russian Federation', 'Russian'),
  ('RW', 'RWA', 'Rwanda', 'Rwandan'),
  ('BL', 'BLM', 'Saint Barth¨¦lemy', 'Barth¨¦lemois'),
  ('SH', 'SHN', 'Saint Helena', 'Ascension and Tristan da Cunha'),
  ('KN', 'KNA', 'Saint Kitts and Nevis', 'Kittitian or Nevisian'),
  ('LC', 'LCA', 'Saint Lucia', 'Saint Lucian'),
  ('MF', 'MAF', 'Saint Martin (French part)', 'Saint-Martinoise'),
  ('PM', 'SPM', 'Saint Pierre and Miquelon', 'Saint-Pierrais or Miquelonnais'),
  ('VC', 'VCT', 'Saint Vincent and the Grenadines', 'Saint Vincentian'),
  ('WS', 'WSM', 'Samoa', 'Samoan'),
  ('SM', 'SMR', 'San Marino', 'Sammarinese'),
  ('ST', 'STP', 'Sao Tome and Principe', 'S?o Tom¨¦an'),
  ('SA', 'SAU', 'Saudi Arabia', 'Saudi'),
  ('SN', 'SEN', 'Senegal', 'Senegalese'),
  ('RS', 'SRB', 'Serbia', 'Serbian'),
  ('SC', 'SYC', 'Seychelles', 'Seychellois'),
  ('SL', 'SLE', 'Sierra Leone', 'Sierra Leonean'),
  ('SG', 'SGP', 'Singapore', 'Singaporean'),
  ('SX', 'SXM', 'Sint Maarten (Dutch part)', 'Sint Maarten'),
  ('SK', 'SVK', 'Slovakia', 'Slovak'),
  ('SI', 'SVN', 'Slovenia', 'Slovenian'),
  ('SB', 'SLB', 'Solomon Islands', 'Solomon Island'),
  ('SO', 'SOM', 'Somalia', 'Somali'),
  ('ZA', 'ZAF', 'South Africa', 'South African'),
  ('GS', 'SGS', 'South Georgia and the South Sandwich Islands', 'South Georgia or South Sandwich Islands'),
  ('SS', 'SSD', 'South Sudan', 'South Sudanese'),
  ('ES', 'ESP', 'Spain', 'Spanish'),
  ('LK', 'LKA', 'Sri Lanka', 'Sri Lankan'),
  ('SD', 'SDN', 'Sudan', 'Sudanese'),
  ('SR', 'SUR', 'Suriname', 'Surinamese'),
  ('SJ', 'SJM', 'Svalbard and Jan Mayen', 'Svalbard'),
  ('SZ', 'SWZ', 'Swaziland', 'Swazi'),
  ('SE', 'SWE', 'Sweden', 'Swedish'),
  ('CH', 'CHE', 'Switzerland', 'Swiss'),
  ('SY', 'SYR', 'Syrian Arab Republic', 'Syrian'),
  ('TW', 'TWN', 'Taiwan', 'Province of China'),
  ('TJ', 'TJK', 'Tajikistan', 'Tajikistani'),
  ('TZ', 'TZA', 'Tanzania', 'United Republic of'),
  ('TH', 'THA', 'Thailand', 'Thai'),
  ('TL', 'TLS', 'Timor-Leste', 'Timorese'),
  ('TG', 'TGO', 'Togo', 'Togolese'),
  ('TK', 'TKL', 'Tokelau', 'Tokelauan'),
  ('TO', 'TON', 'Tonga', 'Tongan'),
  ('TT', 'TTO', 'Trinidad and Tobago', 'Trinidadian or Tobagonian'),
  ('TN', 'TUN', 'Tunisia', 'Tunisian'),
  ('TR', 'TUR', 'Turkey', 'Turkish'),
  ('TM', 'TKM', 'Turkmenistan', 'Turkmen'),
  ('TC', 'TCA', 'Turks and Caicos Islands', 'Turks and Caicos Island'),
  ('TV', 'TUV', 'Tuvalu', 'Tuvaluan'),
  ('UG', 'UGA', 'Uganda', 'Ugandan'),
  ('UA', 'UKR', 'Ukraine', 'Ukrainian'),
  ('AE', 'ARE', 'United Arab Emirates', 'Emirati'),
  ('GB', 'GBR', 'United Kingdom of Great Britain and Northern Ireland', 'British'),
  ('UM', 'UMI', 'United States Minor Outlying Islands', 'American'),
  ('US', 'USA', 'United States of America', 'American'),
  ('UY', 'URY', 'Uruguay', 'Uruguayan'),
  ('UZ', 'UZB', 'Uzbekistan', 'Uzbekistani'),
  ('VU', 'VUT', 'Vanuatu', 'Ni-Vanuatu'),
  ('VE', 'VEN', 'Venezuela (Bolivarian Republic of)', 'Venezuelan'),
  ('VN', 'VNM', 'Vietnam', 'Vietnamese'),
  ('VG', 'VGB', 'Virgin Islands (British)', 'British Virgin Island'),
  ('VI', 'VIR', 'Virgin Islands (U.S.)', 'U.S. Virgin Island'),
  ('WF', 'WLF', 'Wallis and Futuna', 'Wallis and Futuna'),
  ('EH', 'ESH', 'Western Sahara', 'Sahrawi'),
  ('YE', 'YEM', 'Yemen', 'Yemeni'),
  ('ZM', 'ZMB', 'Zambia', 'Zambian'),
  ('ZW', 'ZWE', 'Zimbabwe', 'Zimbabwean');

-- tbl_diet_types seed (11 rows)
insert into tbl_diet_types (name) values
  ('Normal Diet'),
  ('Chicken Normal Diet'),
  ('Fish Normal Diet'),
  ('Soft Diet'),
  ('Chicken Soft Diet'),
  ('Fish Soft Diet'),
  ('Blended Diet'),
  ('Liquid Diet'),
  ('Vege Normal Diet'),
  ('Vege Soft Diet'),
  ('Vege Blended Diet');

-- tbl_feeding_types seed (4 rows)
insert into tbl_feeding_types (name) values
  ('Self Feeding'),
  ('Assisted Feeding'),
  ('Ryles Tube Feeding'),
  ('PEG Tube Feeding');

-- tbl_diagnosis_options seed (25 rows)
insert into tbl_diagnosis_options (name_en, name_ms) values
  ('NIL', 'Tiada'),
  ('Diabetes', 'Kencing Manis'),
  ('Hypertension', 'Darah Tinggi'),
  ('Dyslipidemia', 'Kolesterol Tinggi'),
  ('Kidney Disease', 'Penyakit Buah Pinggang'),
  ('Heart Disease', 'Penyakit Jantung'),
  ('Lung Disease', 'Penyakit Paru-paru'),
  ('Asthma', 'Asma'),
  ('Stroke', 'Strok'),
  ('Seizure, Epilepsy', 'Sawan, Epilepsi'),
  ('Liver Disease', 'Penyakit Hati'),
  ('Cancer', 'Kanser'),
  ('Parkinson''s Disease', 'Penyakit Parkinson'),
  ('Alzheimer''s Disease', 'Penyakit Alzheimer Penyakit Alzheimer'),
  ('Dementia', 'Demensia'),
  ('Thyroid Disorder', 'Penyakit Tiroid'),
  ('Bone Fracture', 'Tulang Patah'),
  ('HIV', 'HIV'),
  ('Tuberculosis (TB)', 'Tuberkulosis (TB)'),
  ('Hepatitis', 'Hepatitis'),
  ('MRSA', 'MRSA'),
  ('ESBL', 'ESBL'),
  ('MRO', 'MRO'),
  ('CRE', 'CRE'),
  ('Others', 'Lain-lain');

-- tbl_product_categories seed (5 rows)
insert into tbl_product_categories (category_name, category_display) values
  ('Consumables', 'Floor Consumables'),
  ('Dressing Items', 'Floor Dressing Items'),
  ('Medicine', 'Floor Medicine'),
  ('Others', 'Transit Items'),
  ('Service', 'Service');

-- tbl_uoms seed (10 rows)
insert into tbl_uoms (code) values
  ('EA'),
  ('BOX'),
  ('PACK'),
  ('ROLL'),
  ('BOTTLE'),
  ('TUBE'),
  ('SET'),
  ('TAB'),
  ('STRIP'),
  ('PIECE');

-- ============================================================================
-- 3. RESIDENTS (core clinical subject)
-- ============================================================================

create table tbl_residents (
  id                          bigint generated always as identity primary key,
  branch_id                   bigint not null references tbl_branches ("BranchID"),
  resident_name               text not null,
  ic_number                   text,
  age                         int,
  nationality_id               bigint references tbl_nationalities (id),
  gender                      text check (gender in ('M','F')),
  marital_status              text check (marital_status in ('Single','Married','Windowed','Divorced')),
  status                      text not null default 'ACTIVE'
                                check (status in ('ACTIVE','DISCHARGED','DECEASED','TRANSFERRED OUT')),
  category                    text,
  care_type                   text check (care_type in ('24-Hour Care','Daycare')),
  admission_date              date,
  discharge_date              date,
  transfer_from               text check (transfer_from in ('Home','Hospital','Nursing Home','Others')),
  accompanied_by              text check (accompanied_by in ('Self','Family','Friends','Social Worker','Paramedic','Others')),
  emergency_contact           text,
  allergy                     text,
  past_medical_condition      text,   -- supplementary free-text notes; coded diagnoses now live in tbl_resident_diagnoses
  medication_reconciliation_log text, -- comparison log of med changes (withheld / dose-changed) from admission to latest
  current_medication_list     text,
  mobility                    text check (mobility in ('Walking Independent','Walking Aid','Wheelchair','Bedbound')),
  feeding_type_id              bigint references tbl_feeding_types (id),  -- was a text field; tbl_FeedingType has 4 values (incl. PEG), the old hardcoded dropdown only offered 3
  hygiene                     text check (hygiene in ('Self Toileting','Urinal','Bedpan','Commode Chair','Pampers')),
  diet_type_id                 bigint references tbl_diet_types (id),
  languages                   text[], -- optional; Access has a tbl_Languages lookup, not yet exported
  care_goal                   text[]  -- multi-select in Access (ListBox) — see notes doc on which value set is current
                                check (care_goal <@ array['Nursing/ADL care','Rehabilitation','Wound Care','Paliative Care','Others']::text[]),
  tca_notes                   text,  -- free text, e.g. 'MOPD 1/12/2026, SOPD 21/11/2026' -- not a single date
  assessment_and_summary      text,
  reviewed_by                 text references tbl_staff ("StaffID"),
  created_at                  timestamptz not null default now(),
  updated_at                  timestamptz not null default now()
);
create index idx_residents_branch on tbl_residents (branch_id);
create index idx_residents_status on tbl_residents (branch_id, status);
create index idx_residents_name on tbl_residents using gin (resident_name gin_trgm_ops);

-- Structured, multi-select diagnosis list (Access has a multi-select listbox
-- bound to tbl_DiagnosisOptions) — separate from past_medical_condition,
-- which stays free text for narrative detail a fixed list can't capture.
create table tbl_resident_diagnoses (
  id                  bigint generated always as identity primary key,
  branch_id           bigint not null references tbl_branches ("BranchID"),  -- auto-filled, see trigger
  resident_id         bigint not null references tbl_residents (id) on delete cascade,
  diagnosis_option_id bigint not null references tbl_diagnosis_options (id),
  remark              text,
  created_at          timestamptz not null default now(),
  unique (resident_id, diagnosis_option_id)
);

create or replace function fn_fill_resident_diagnosis_branch() returns trigger
language plpgsql as $$
begin
  if new.branch_id is null then
    select branch_id into new.branch_id from tbl_residents where id = new.resident_id;
  end if;
  return new;
end;
$$;

create trigger trg_fill_resident_diagnosis_branch
before insert on tbl_resident_diagnoses
for each row execute function fn_fill_resident_diagnosis_branch();

-- ============================================================================
-- 3B. NURSING CHART VOCABULARY TABLES
--     The dropdown export revealed most of these are ListBox (multi-select)
--     fields in Access, not single-choice — and two of my earlier guesses
--     were wrong (bowel_output / pass_urine are amount-and-texture
--     descriptors, not "By Self"/"With Assistance" — that phrase actually
--     belongs to a separate hygiene-care assistance level, see below).
-- ============================================================================

create table tbl_meal_types (
  id    bigint generated always as identity primary key,
  name  text not null unique
);

create table tbl_meal_portions (
  id    bigint generated always as identity primary key,
  name  text not null unique
);

create table tbl_feeding_times (
  id            bigint generated always as identity primary key,
  time_of_day   time not null unique
);

-- Union of tbl_SelfToileting + tbl_AssistedHygieneCare, exactly as Access's
-- own lbxHygiene control combines them.
create table tbl_hygiene_care_activities (
  id        bigint generated always as identity primary key,
  category  text not null check (category in ('Self Toileting','Assisted Hygiene')),
  activity  text not null,
  unique (category, activity)
);

create table tbl_activities (
  id    bigint generated always as identity primary key,
  name  text not null unique
);

create table tbl_disturbance_levels (
  id           bigint generated always as identity primary key,
  level        int not null unique,   -- 0-4
  description  text not null
);

create table tbl_psycho_social_behaviours (
  id    bigint generated always as identity primary key,
  name  text not null unique
);

create table tbl_active_complaints (
  id      bigint generated always as identity primary key,
  name_en text not null unique,
  name_ms text
);

create table tbl_bowel_output_types (
  id    bigint generated always as identity primary key,
  name  text not null unique   -- amount/texture, e.g. 'Watery Stool', 'Large Amount'
);

create table tbl_pass_urine_types (
  id    bigint generated always as identity primary key,
  name  text not null unique   -- amount, e.g. 'Fully Soaked', 'Stain'
);

create table tbl_gcs_eye_responses (
  id           bigint generated always as identity primary key,
  score        int not null unique,
  description  text not null
);

create table tbl_gcs_verbal_responses (
  id           bigint generated always as identity primary key,
  score        int not null unique,
  description  text not null
);

create table tbl_gcs_motor_responses (
  id           bigint generated always as identity primary key,
  score        int not null unique,
  description  text not null
);

create table tbl_avpu_options (
  id     bigint generated always as identity primary key,
  code   text not null unique,   -- A / V / P / U
  label  text not null           -- Alert / Verbal / Pain / Unresponsive
);

-- Reference tables: everyone authenticated can read; only admin can edit.
do $$
declare t text;
begin
  foreach t in array array[
    'tbl_meal_types','tbl_meal_portions','tbl_feeding_times','tbl_hygiene_care_activities',
    'tbl_activities','tbl_disturbance_levels','tbl_psycho_social_behaviours','tbl_active_complaints',
    'tbl_bowel_output_types','tbl_pass_urine_types','tbl_gcs_eye_responses','tbl_gcs_verbal_responses',
    'tbl_gcs_motor_responses','tbl_avpu_options'
  ]
  loop
    execute format('alter table %1$s enable row level security;', t);
    execute format('create policy %1$s_read on %1$s for select using (auth.role() = ''authenticated'');', t);
    execute format('create policy %1$s_write on %1$s for all using (auth_role() = ''ADMIN'') with check (auth_role() = ''ADMIN'');', t);
  end loop;
end $$;

-- Seed data, exported directly from the live Access tables.

-- tbl_meal_portions seed (6 rows)
insert into tbl_meal_portions (name) values
  ('Full'),
  ('Half'),
  ('Quarter'),
  ('None'),
  ('Refused'),
  ('Others:');

-- tbl_meal_types seed (8 rows)
insert into tbl_meal_types (name) values
  ('Breakfast'),
  ('Morning Tea'),
  ('Lunch'),
  ('Evening Tea'),
  ('Dinner'),
  ('Supper'),
  ('Tube Feeding'),
  ('Others:');

-- tbl_feeding_times seed (6 rows)
insert into tbl_feeding_times (time_of_day) values
  ('06:00:00'),
  ('09:00:00'),
  ('12:00:00'),
  ('15:00:00'),
  ('18:00:00'),
  ('22:00:00');

-- tbl_hygiene_care_activities seed (14 rows: 9 Self Toileting + 5 Assisted Hygiene)
insert into tbl_hygiene_care_activities (category, activity) values
  ('Self Toileting', 'Shower'),
  ('Self Toileting', 'BO @ Toilet'),
  ('Self Toileting', 'PU @ Toilet'),
  ('Self Toileting', 'BO @ Commode'),
  ('Self Toileting', 'PU @ Commode'),
  ('Self Toileting', 'PU @ Urinal'),
  ('Self Toileting', 'PU @ Bedpan'),
  ('Self Toileting', 'Change Diapers'),
  ('Self Toileting', 'In/Out Catheter'),
  ('Assisted Hygiene', 'Sponging'),
  ('Assisted Hygiene', 'Grooming'),
  ('Assisted Hygiene', 'Oral Care'),
  ('Assisted Hygiene', 'Skin Care'),
  ('Assisted Hygiene', 'Eye Care');

-- tbl_activities seed (9 rows)
insert into tbl_activities (name) values
  ('Sleep - On Bed'),
  ('Awake - On Bed'),
  ('Living Room'),
  ('Dining Area'),
  ('Family & Friends visits'),
  ('Went Out'),
  ('Therapy Session'),
  ('Hospitalized'),
  ('Others');

-- tbl_disturbance_levels seed (5 rows)
insert into tbl_disturbance_levels (level, description) values
  (0, 'L0: No disturbance'),
  (1, 'L1: Ocassionally sound'),
  (2, 'L2: Frequently sound but others can sleep'),
  (3, 'L3: Frequently sound but others cannot sleep'),
  (4, 'L4: Persistently sound and disturbing');

-- tbl_psycho_social_behaviours seed (6 rows)
insert into tbl_psycho_social_behaviours (name) values
  ('Self talking'),
  ('Delirious'),
  ('Insomnia'),
  ('Self harm'),
  ('Aggressive'),
  ('Others');

-- tbl_active_complaints seed (11 rows)
insert into tbl_active_complaints (name_en, name_ms) values
  ('Fever / Chills', 'Demam / Menggigil'),
  ('Headache', 'Sakit Kepala'),
  ('Cough', 'Batuk'),
  ('Running nose', 'Selsema'),
  ('Shortness of Breath', 'Sesak Nafas'),
  ('Chest Pain', 'Sakit Dada'),
  ('Abdominal Pain', 'Sakit Perut'),
  ('Vomiting', 'Muntah'),
  ('Diarrhoea', 'Cirit'),
  ('Constipation', 'Sembelit'),
  ('Others:', 'Lain-lain:');

-- tbl_bowel_output_types seed (9 rows)
insert into tbl_bowel_output_types (name) values
  ('Large Amount'),
  ('Small Amount'),
  ('Moderate Amount'),
  ('Stain'),
  ('Normal/Soft Stool'),
  ('Hard Stool'),
  ('Watery Stool'),
  ('Loose Stool'),
  ('None');

-- tbl_pass_urine_types seed (4 rows)
insert into tbl_pass_urine_types (name) values
  ('Fully Soaked'),
  ('Half Soaked'),
  ('Stain'),
  ('Empty');

-- tbl_gcs_eye_responses seed (4 rows)
insert into tbl_gcs_eye_responses (score, description) values
  (4, '4 - Spontaneous'),
  (3, '3 - To Sound'),
  (2, '2 - To Pressure'),
  (1, '1 - None');

-- tbl_gcs_verbal_responses seed (5 rows)
insert into tbl_gcs_verbal_responses (score, description) values
  (5, '5 - Orientated'),
  (4, '4 - Confused'),
  (3, '3 - Words'),
  (2, '2 - Sounds'),
  (1, '1 - None');

-- tbl_gcs_motor_responses seed (6 rows)
insert into tbl_gcs_motor_responses (score, description) values
  (6, '6 - Obey commands'),
  (5, '5 - Localising'),
  (4, '4 - Normal flexion'),
  (3, '3 - Abnormal flexion'),
  (2, '2 - Extension'),
  (1, '1 - None');

-- tbl_avpu_options seed (4 rows)
insert into tbl_avpu_options (code, label) values
  ('A', 'Alert'),
  ('V', 'Verbal'),
  ('P', 'Pain'),
  ('U', 'Unresponsive');

-- ============================================================================
-- 4. NURSING CHART (frequent vitals + daily care documentation)
-- ============================================================================

-- Vital sign readings live in tbl_vital, not here -- see section 4B below.
-- Was columns on this table originally; split out since a resident can
-- have several vitals readings between full nursing chart entries and
-- the dashboard only ever needs "last N vitals", not a full chart entry.
create table tbl_nursing_chart_entries (
  id                    bigint generated always as identity primary key,
  branch_id             bigint not null references tbl_branches ("BranchID"),
  resident_id           bigint not null references tbl_residents (id),
  entry_timestamp       timestamptz not null default now(),
  tube_feeding          text check (tube_feeding in ('Oral Feed','Tube Feeding')),  -- feeding route, not a yes/no
  -- meals and hygiene episodes are repeating groups — see tbl_nursing_chart_meals
  -- and tbl_nursing_chart_hygiene_episodes below, not columns on this table.
  bowel_output_ids      bigint[],  -- multi-select against tbl_bowel_output_types (amount/texture, e.g. 'Watery Stool')
  pass_urine_ids        bigint[],  -- multi-select against tbl_pass_urine_types (amount, e.g. 'Fully Soaked')
  fluid_input           numeric,
  fluid_output          numeric,
  cbd_drainage          text,
  activity_ids                bigint[],  -- multi-select against tbl_activities
  disturbance_level_ids       bigint[],  -- multi-select against tbl_disturbance_levels
  psycho_social_behaviour_ids bigint[],  -- multi-select against tbl_psycho_social_behaviours
  active_complaint_ids         bigint[],  -- multi-select against tbl_active_complaints
  respiration_rate       numeric,
  gcs_eye_id              bigint references tbl_gcs_eye_responses (id),
  gcs_verbal_id           bigint references tbl_gcs_verbal_responses (id),
  gcs_motor_id            bigint references tbl_gcs_motor_responses (id),
  avpu_id                 bigint references tbl_avpu_options (id),
  intervention            text,
  doctors_plan             text,
  reviewed_by             text references tbl_staff ("StaffID"),
  created_by              text references tbl_staff ("StaffID"),
  created_at              timestamptz not null default now()
);
create index idx_nce_resident on tbl_nursing_chart_entries (resident_id, entry_timestamp desc);
create index idx_nce_branch on tbl_nursing_chart_entries (branch_id, entry_timestamp desc);

-- ============================================================================
-- 4B. VITAL SIGN READINGS (own table -- see note above)
-- ============================================================================

create table tbl_vital (
  id                  bigint generated always as identity primary key,
  branch_id           bigint not null references tbl_branches ("BranchID"),
  resident_id         bigint not null references tbl_residents (id),
  entry_timestamp     timestamptz not null default now(),
  systolic_bp         numeric,
  diastolic_bp        numeric,
  heart_rate          numeric,
  temperature         numeric,
  spo2                numeric,
  spo2_condition      text check (spo2_condition in (
                        'under RA','under 1LPM O2','under 2LPM O2','under 3LPM O2','under 4LPM O2',
                        'under 5LPM O2','under 6LPM O2','under 7LPM O2','under 8LPM O2',
                        'under 9LPM O2','under 10LPM O2')),
  dxt                 numeric,
  dxt_remark          text check (dxt_remark in ('Fasting','Post-Meal 1hr','Post-Meal 2hr','Post-Meal >4hr')),
  insulin_adjustment  text,
  reviewed_by         text references tbl_staff ("StaffID"),
  created_at          timestamptz not null default now()
);
create index idx_vital_resident on tbl_vital (resident_id, entry_timestamp desc);
create index idx_vital_branch on tbl_vital (branch_id, entry_timestamp desc);

-- Meals: Access has up to 6 meal slots per chart entry (meal type + portion
-- + time each), not one meal_portion field — this is a repeating group, so
-- it gets its own table, one row per meal actually logged.
create table tbl_nursing_chart_meals (
  id               bigint generated always as identity primary key,
  branch_id        bigint not null references tbl_branches ("BranchID"),  -- auto-filled, see trigger
  chart_entry_id   bigint not null references tbl_nursing_chart_entries (id) on delete cascade,
  meal_type_id     bigint references tbl_meal_types (id),
  meal_portion_id  bigint references tbl_meal_portions (id),
  feeding_time_id  bigint references tbl_feeding_times (id),
  created_at       timestamptz not null default now()
);
create index idx_ncm_chart_entry on tbl_nursing_chart_meals (chart_entry_id);

create or replace function fn_fill_chart_meal_branch() returns trigger
language plpgsql as $$
begin
  if new.branch_id is null then
    select branch_id into new.branch_id from tbl_nursing_chart_entries where id = new.chart_entry_id;
  end if;
  return new;
end;
$$;

create trigger trg_fill_chart_meal_branch
before insert on tbl_nursing_chart_meals
for each row execute function fn_fill_chart_meal_branch();

-- Hygiene episodes: confirmed — the two controls capture toileting/hygiene
-- activities done by the resident BY SELF vs activities done WITH
-- ASSISTANCE, as two separate multi-select activity lists per chart entry
-- (not a time split). At most one episode of each kind per entry.
create table tbl_nursing_chart_hygiene_episodes (
  id                bigint generated always as identity primary key,
  branch_id         bigint not null references tbl_branches ("BranchID"),  -- auto-filled, see trigger
  chart_entry_id    bigint not null references tbl_nursing_chart_entries (id) on delete cascade,
  assistance_level  text not null check (assistance_level in ('By Self','With Assistance')),
  activity_ids      bigint[],  -- multi-select against tbl_hygiene_care_activities
  created_at        timestamptz not null default now(),
  unique (chart_entry_id, assistance_level)
);
create index idx_nch_chart_entry on tbl_nursing_chart_hygiene_episodes (chart_entry_id);

create or replace function fn_fill_chart_hygiene_branch() returns trigger
language plpgsql as $$
begin
  if new.branch_id is null then
    select branch_id into new.branch_id from tbl_nursing_chart_entries where id = new.chart_entry_id;
  end if;
  return new;
end;
$$;

create trigger trg_fill_chart_hygiene_branch
before insert on tbl_nursing_chart_hygiene_episodes
for each row execute function fn_fill_chart_hygiene_branch();

-- ============================================================================
-- 5. PROGRESS NOTES (doctor / general clinical note — one shared table)
-- ============================================================================

-- past_med_condition / current_medication_regime / tca_notes were dropped
-- (see git history) -- they duplicated tbl_residents.past_medical_condition
-- / .current_medication_list / .tca_notes, which is the single source of
-- truth for that resident-level info; the progress-notes UI reads it from
-- there instead of re-entering it per note.
create table tbl_progress_notes (
  id                       bigint generated always as identity primary key,
  branch_id                bigint not null references tbl_branches ("BranchID"),
  resident_id              bigint not null references tbl_residents (id),
  entry_timestamp          timestamptz not null default now(),
  progress_note            text,
  physical_examination     text,
  medical_plan             text,
  monitoring_plan          text,
  feeding_plan             text,
  dressing_plan            text,
  nursing_plan             text,
  physio_plan              text,
  reviewed_by              text references tbl_staff ("StaffID"),
  created_by               text references tbl_staff ("StaffID"),
  created_at               timestamptz not null default now()
);
create index idx_pn_resident on tbl_progress_notes (resident_id, entry_timestamp desc);

-- ============================================================================
-- 6. PHYSIOTHERAPY
--    Outpatient physio clients are NOT always OSEM residents — confirmed by
--    tbl_PhysioOPParticular in your Access backend having its own PatientID,
--    demographics, etc., entirely separate from tbl_ResidentList. So OP
--    patients get their own table, and progress notes point to EITHER a
--    resident (IP) OR an OP patient, never both. See notes doc for the open
--    question this raises about tbl_PhyBranches.
-- ============================================================================

create table tbl_physio_op_patients (
  id              bigint generated always as identity primary key,
  branch_id       bigint not null references tbl_branches ("BranchID"),
  patient_name    text not null,
  ic_number       text,
  age             int,
  contact         text,
  gender          text check (gender in ('M','F')),
  marital_status  text check (marital_status in ('Single','Married','Windowed','Divorced')),
  nationality_id  bigint references tbl_nationalities (id),
  remark          text,
  reviewed_by     text references tbl_staff ("StaffID"),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- SOAP-style physiotherapy progress notes (IP + OP combined into one table).
create table tbl_physio_progress_notes (
  id                     bigint generated always as identity primary key,
  branch_id              bigint not null references tbl_branches ("BranchID"),
  care_setting           physio_setting_type not null,  -- IP or OP
  resident_id            bigint references tbl_residents (id),          -- set when care_setting = 'IP'
  op_patient_id          bigint references tbl_physio_op_patients (id), -- set when care_setting = 'OP'
  entry_timestamp        timestamptz not null default now(),
  department             text,
  ip_sub_type            text check (
                           care_setting <> 'IP' or ip_sub_type is null or ip_sub_type in (
                             'Basic Physio','Full Physio','Patient Refused','Patient Went Out',
                             'Patient Hospitalized/Under Quarantine','Not Performed'
                           )
                         ),
  credit_hour            numeric,   -- typically 25 / 50 / 100 (minutes) per your dropdown, not hard-constrained
  subjective             text,
  objective              text,
  analysis               text,
  plan_and_intervention  text,
  evaluation             text,
  completion             text,
  therapist_id           text references tbl_staff ("StaffID"),
  created_at             timestamptz not null default now(),
  check (
    (resident_id is not null and op_patient_id is null)
    or (resident_id is null and op_patient_id is not null)
  )
);
create index idx_ppn_resident on tbl_physio_progress_notes (resident_id, entry_timestamp desc);
create index idx_ppn_op_patient on tbl_physio_progress_notes (op_patient_id, entry_timestamp desc);

-- ============================================================================
-- 6B. PHYSIOTHERAPY INPATIENT ASSESSMENT + PROGRESS NOTE
--    Structured, scored inpatient assessment (manual muscle testing per
--    limb/region/side, body chart, functional/balance/coordination grading,
--    auto-computed score) -- deliberately separate from the flat SOAP-style
--    tbl_physio_progress_notes above, which can't represent this. One
--    combined form for both the first assessment and every later progress
--    note; each save is an independent historical snapshot (insert-only,
--    never updated).
-- ============================================================================

create table physio_assessments (
  id                   bigint generated always as identity primary key,
  branch_id            bigint not null references tbl_branches ("BranchID"),
  resident_id          bigint not null references tbl_residents (id),
  entry_timestamp      timestamptz not null default now(),
  treatment_type       text check (treatment_type in ('Basic','Full','Assessment','Housecall','Neuro','Backpain')),
  credit_hours         numeric,
  chief_complaint      text,
  current_history      text,
  past_medical_history text,
  social_history       text,
  impression           text,   -- Physiotherapist Impression / Analysis
  plan_intervention    text,
  evaluation           text,
  treatment_compliance text check (treatment_compliance in ('100%','75%','50%','25%')),
  total_score          numeric,  -- computed server-side at insert time, never client-editable
  documented_by        text not null references tbl_staff ("StaffID"),
  created_at           timestamptz not null default now()
);
create index idx_physio_assess_resident on physio_assessments (resident_id, entry_timestamp desc);
create index idx_physio_assess_branch on physio_assessments (branch_id, entry_timestamp desc);

-- One row per (limb, region, movement, side) actually assessed -- manual
-- muscle testing chart, normalized rather than one column per movement.
create table physio_examinations (
  id             bigint generated always as identity primary key,
  branch_id      bigint not null references tbl_branches ("BranchID"),  -- auto-filled, see trigger
  assessment_id  bigint not null references physio_assessments (id) on delete cascade,
  limb           text not null check (limb in ('lower','upper')),
  region         text not null,   -- 'Hip','Knee','Ankle','Foot','Trunk','Shoulder','Elbow','Forearm','Wrist','Fingers'
  movement       text not null,   -- e.g. 'Flexors','Lateral Rotation'
  side           text not null check (side in ('R','L')),
  power          int check (power between 0 and 5),
  tone           int check (tone between 0 and 4),
  rom            int check (rom between 0 and 4),
  reflexes       int check (reflexes between 0 and 4),
  created_at     timestamptz not null default now(),
  unique (assessment_id, limb, region, movement, side)
);
create index idx_physio_exam_assessment on physio_examinations (assessment_id);

create table physio_body_chart_findings (
  id             bigint generated always as identity primary key,
  branch_id      bigint not null references tbl_branches ("BranchID"),  -- auto-filled, see trigger
  assessment_id  bigint not null references physio_assessments (id) on delete cascade,
  region         text not null,                   -- e.g. 'Neck','Right Shoulder','Lower Back'
  side           text check (side in ('R','L')),   -- null for midline regions
  comment        text not null,
  created_at     timestamptz not null default now()
);
create index idx_physio_body_chart_assessment on physio_body_chart_findings (assessment_id);

create table physio_functional_assessments (
  id                    bigint generated always as identity primary key,
  branch_id             bigint not null references tbl_branches ("BranchID"),  -- auto-filled, see trigger
  assessment_id         bigint not null unique references physio_assessments (id) on delete cascade,
  supine_to_side_lying  int check (supine_to_side_lying between 0 and 4),
  side_lying_to_sitting int check (side_lying_to_sitting between 0 and 4),
  sitting_to_standing   int check (sitting_to_standing between 0 and 4),
  sit_at_edge_of_bed    int check (sit_at_edge_of_bed between 0 and 4),
  ambulation            int check (ambulation between 0 and 4)
);

-- No Right/Left -- balance is assessed as a whole, not per side.
create table physio_balance_assessments (
  id               bigint generated always as identity primary key,
  branch_id        bigint not null references tbl_branches ("BranchID"),  -- auto-filled, see trigger
  assessment_id    bigint not null unique references physio_assessments (id) on delete cascade,
  sitting_static   int check (sitting_static between 0 and 3),
  sitting_dynamic  int check (sitting_dynamic between 0 and 3),
  standing_static  int check (standing_static between 0 and 3),
  standing_dynamic int check (standing_dynamic between 0 and 3)
);

create table physio_coordination_assessments (
  id                bigint generated always as identity primary key,
  branch_id         bigint not null references tbl_branches ("BranchID"),  -- auto-filled, see trigger
  assessment_id     bigint not null unique references physio_assessments (id) on delete cascade,
  upper_limb_right  int check (upper_limb_right between 0 and 4),
  upper_limb_left   int check (upper_limb_left between 0 and 4),
  lower_limb_right  int check (lower_limb_right between 0 and 4),
  lower_limb_left   int check (lower_limb_left between 0 and 4)
);

-- Same "auto-fill branch_id from the parent" pattern as fn_fill_chart_meal_branch.
create or replace function fn_fill_physio_child_branch() returns trigger
language plpgsql as $$
begin
  if new.branch_id is null then
    select branch_id into new.branch_id from physio_assessments where id = new.assessment_id;
  end if;
  return new;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'physio_examinations','physio_body_chart_findings','physio_functional_assessments',
    'physio_balance_assessments','physio_coordination_assessments'
  ]
  loop
    execute format(
      'create trigger trg_fill_%1$s_branch before insert on %1$s
       for each row execute function fn_fill_physio_child_branch();', t
    );
  end loop;
end $$;

-- ============================================================================
-- 7. HOSPITAL REFERRALS
-- ============================================================================

create table tbl_hospital_referrals (
  id                    bigint generated always as identity primary key,
  branch_id             bigint not null references tbl_branches ("BranchID"),
  resident_id           bigint not null references tbl_residents (id),
  referral_datetime     timestamptz not null default now(),
  chief_complaints      text,
  vital_signs           text,
  mobility              text,
  feeding               text,
  hygiene               text,
  reviewed_by           text references tbl_staff ("StaffID"),
  created_at            timestamptz not null default now()
);
create index idx_hr_resident on tbl_hospital_referrals (resident_id, referral_datetime desc);

-- ============================================================================
-- 8. INCIDENT REPORTING (falls)
-- ============================================================================

create table tbl_fall_incidents (
  id                  bigint generated always as identity primary key,
  branch_id           bigint not null references tbl_branches ("BranchID"),
  resident_id         bigint references tbl_residents (id),
  resident_name_text  text,
  incident_timestamp  timestamptz not null default now(),
  report_category     text,
  location_text       text,
  how_it_happened     text,
  injury_type         text,
  injury_area         text,
  intervention        text,
  systolic_bp         numeric,
  diastolic_bp        numeric,
  heart_rate          numeric,
  temperature         numeric,
  spo2                numeric,
  dxt                 numeric,
  responsive          boolean,
  staff_injury        boolean,
  injured_staff_name  text,
  witness             text,
  reported_by         text references tbl_staff ("StaffID"),
  created_at          timestamptz not null default now()
);

-- ============================================================================
-- 9. INVENTORY
--    Product catalog is now SHARED across branches (Panadol is Panadol
--    everywhere) — only *where it's stocked* is branch-specific, via
--    tbl_storage_locations / tbl_product_stock. This is what makes clean
--    inter-branch transfer possible.
-- ============================================================================

create table tbl_suppliers (
  id             bigint generated always as identity primary key,
  name           text not null,
  contact_person text,
  phone          text,
  email          text,
  notes          text,
  created_at     timestamptz not null default now()
);

create table tbl_storage_locations (
  id            bigint generated always as identity primary key,
  branch_id     bigint not null references tbl_branches ("BranchID"),
  name          text not null,        -- e.g. 'Store', 'Floor', 'Transit'
  is_transit    boolean not null default false,
  created_at    timestamptz not null default now(),
  unique (branch_id, name)
);

create table tbl_products (
  id              bigint generated always as identity primary key,
  barcode         text,
  name            text not null,
  description     text,
  unit_id         bigint references tbl_uoms (id),
  category_id     bigint references tbl_product_categories (id),
  supplier_id     bigint references tbl_suppliers (id),   -- default/preferred supplier
  unit_price      numeric(12,2),
  selling_price   numeric(12,2),
  status          text not null default 'ACTIVE' check (status in ('ACTIVE','INACTIVE')),
  registered_by   text references tbl_staff ("StaffID"),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index idx_products_barcode on tbl_products (barcode) where barcode is not null;

-- Current balance snapshot per product per storage location.
-- branch_id is denormalized from the storage location, purely for RLS speed.
create table tbl_product_stock (
  id                  bigint generated always as identity primary key,
  branch_id           bigint not null references tbl_branches ("BranchID"),
  product_id          bigint not null references tbl_products (id),
  storage_location_id bigint not null references tbl_storage_locations (id),
  quantity_in_stock   numeric not null default 0,
  max_quantity        numeric,
  updated_at          timestamptz not null default now(),
  unique (product_id, storage_location_id)
);

-- Append-only ledger. ONE row = ONE storage location's balance change.
-- This is the audit trail for every unit that moves, for any reason.
create table tbl_stock_movements (
  id                    bigint generated always as identity primary key,
  branch_id             bigint not null references tbl_branches ("BranchID"),  -- branch owning storage_location_id
  storage_location_id   bigint not null references tbl_storage_locations (id),
  product_id            bigint not null references tbl_products (id),
  movement_type         stock_movement_type not null,
  quantity_delta        numeric not null,   -- positive = increase, negative = decrease
  reference_type        text,               -- 'stock_transfer' | 'stock_request' | 'charging' | 'manual'
  reference_id          bigint,
  invoice_no            text,
  transaction_date      timestamptz not null default now(),
  registered_by         text references tbl_staff ("StaffID"),
  remarks               text,
  created_at            timestamptz not null default now()
);
create index idx_sm_product on tbl_stock_movements (product_id, transaction_date desc);
create index idx_sm_branch on tbl_stock_movements (branch_id, transaction_date desc);
create index idx_sm_reference on tbl_stock_movements (reference_type, reference_id);

-- Inter-branch transfer, two-step: dispatch decrements the sending branch
-- immediately (goods have physically left); confirm increments the
-- receiving branch only once someone there confirms arrival. Stock "in
-- transit" between those two events is visible via status = 'in_transit'
-- and won't double-count on either side.
create table tbl_stock_transfers (
  id                        bigint generated always as identity primary key,
  from_branch_id            bigint not null references tbl_branches ("BranchID"),
  to_branch_id              bigint not null references tbl_branches ("BranchID"),
  product_id                bigint not null references tbl_products (id),
  quantity                  numeric not null check (quantity > 0),
  from_storage_location_id  bigint not null references tbl_storage_locations (id),
  to_storage_location_id    bigint references tbl_storage_locations (id),  -- chosen at dispatch or confirm
  status                    stock_transfer_status not null default 'in_transit',
  dispatched_by             text references tbl_staff ("StaffID"),
  dispatched_at             timestamptz not null default now(),
  confirmed_by              text references tbl_staff ("StaffID"),
  confirmed_at              timestamptz,
  notes                     text,
  created_at                timestamptz not null default now(),
  check (from_branch_id <> to_branch_id)
);
create index idx_transfers_to_branch on tbl_stock_transfers (to_branch_id, status);
create index idx_transfers_from_branch on tbl_stock_transfers (from_branch_id, status);

-- Nurse-generated restock list → purchaser sets final quantity → routed to
-- whichever channel fits the item (WhatsApp to pharmacy for medicine, Bukku
-- PO to distributors for common consumables, Shopee for low-qty items).
-- The app doesn't place orders on these channels — it just tracks the list.
create table tbl_stock_requests (
  id             bigint generated always as identity primary key,
  branch_id      bigint not null references tbl_branches ("BranchID"),
  request_date   date not null default current_date,
  requested_by   text references tbl_staff ("StaffID"),   -- nurse who drafted it
  status         stock_request_status not null default 'draft',
  notes          text,
  created_at     timestamptz not null default now()
);

create table tbl_stock_request_details (
  id                          bigint generated always as identity primary key,
  branch_id                   bigint not null references tbl_branches ("BranchID"),  -- auto-filled, see trigger
  stock_request_id            bigint not null references tbl_stock_requests (id) on delete cascade,
  product_id                  bigint not null references tbl_products (id),
  storage_location_id         bigint references tbl_storage_locations (id),
  quantity_in_stock_snapshot  numeric,
  max_quantity                numeric,
  suggested_qty_to_order      numeric,     -- system-suggested = max - current
  final_order_qty             numeric,     -- purchaser's adjusted quantity
  order_channel                text,        -- 'WhatsApp-Pharmacy' | 'Bukku-PO' | 'Shopee' | 'Other'
  supplier_id                 bigint references tbl_suppliers (id),
  ordered_by                  text references tbl_staff ("StaffID"),
  ordered_date                date,
  last_receival_date          date,
  last_receival_qty           numeric,
  remarks                     text,
  created_at                  timestamptz not null default now()
);

create or replace function fn_fill_request_detail_branch() returns trigger
language plpgsql as $$
begin
  if new.branch_id is null then
    select branch_id into new.branch_id from tbl_stock_requests where id = new.stock_request_id;
  end if;
  return new;
end;
$$;

create trigger trg_fill_request_detail_branch
before insert on tbl_stock_request_details
for each row execute function fn_fill_request_detail_branch();

-- ============================================================================
-- 10. BILLING — resident charges for consumed inventory
-- ============================================================================

create table tbl_charging_summary (
  id                   bigint generated always as identity primary key,
  branch_id            bigint not null references tbl_branches ("BranchID"),
  resident_id          bigint not null references tbl_residents (id),
  sale_date            date not null default current_date,
  product_id           bigint not null references tbl_products (id),
  storage_location_id  bigint references tbl_storage_locations (id),  -- optional: where it was deducted from
  quantity             numeric not null,
  unit                 text,
  unit_price           numeric(12,2) not null,
  total_amount         numeric(12,2) generated always as (quantity * unit_price) stored,
  registered_by        text references tbl_staff ("StaffID"),
  created_at           timestamptz not null default now()
);
create index idx_cs_resident on tbl_charging_summary (resident_id, sale_date desc);
create index idx_cs_branch on tbl_charging_summary (branch_id, sale_date desc);

-- If a storage location was specified for the charge, deduct it from stock
-- automatically — same self-updating pattern as transfers and receiving.
-- If storage_location_id is left null, the sale is still recorded but no
-- specific location is decremented (see notes doc — recommend always
-- setting this once the app has a location picker on the charging screen).
create or replace function fn_charging_deduct_stock() returns trigger
language plpgsql as $$
begin
  if new.storage_location_id is not null then
    insert into tbl_stock_movements (
      branch_id, storage_location_id, product_id, movement_type,
      quantity_delta, reference_type, reference_id, registered_by
    ) values (
      new.branch_id, new.storage_location_id, new.product_id, 'charge_deduction',
      -new.quantity, 'charging', new.id, new.registered_by
    );
  end if;
  return new;
end;
$$;

create trigger trg_charging_deduct_stock
after insert on tbl_charging_summary
for each row execute function fn_charging_deduct_stock();

-- ============================================================================
-- 11. AUDIT LOG (generic, trigger-driven)
-- ============================================================================

create table tbl_audit_log (
  id           bigint generated always as identity primary key,
  table_name   text not null,
  -- text, not bigint -- every audited table has a bigint id PK except
  -- tbl_staff, whose PK is a text code ("StaffID", e.g. "AMN-1").
  record_id    text not null,
  action       text not null,
  changed_by   uuid,
  changed_at   timestamptz not null default now(),
  old_data     jsonb,
  new_data     jsonb
);
create index idx_audit_table_record on tbl_audit_log (table_name, record_id, changed_at desc);

create or replace function fn_audit_trigger() returns trigger
language plpgsql security definer as $$
declare
  v_record_id text;
begin
  if tg_table_name = 'tbl_staff' then
    v_record_id := coalesce(new."StaffID", old."StaffID");
  else
    v_record_id := coalesce(new.id, old.id)::text;
  end if;
  insert into tbl_audit_log (table_name, record_id, action, changed_by, old_data, new_data)
  values (
    tg_table_name,
    v_record_id,
    tg_op,
    auth.uid(),
    case when tg_op in ('UPDATE','DELETE') then to_jsonb(old) else null end,
    case when tg_op in ('UPDATE','INSERT') then to_jsonb(new) else null end
  );
  return coalesce(new, old);
end;
$$;

do $$
declare t text;
begin
  foreach t in array array[
    'tbl_residents','tbl_nursing_chart_entries','tbl_nursing_chart_meals','tbl_nursing_chart_hygiene_episodes',
    'tbl_vital',
    'tbl_progress_notes','tbl_physio_progress_notes',
    'tbl_physio_op_patients','tbl_resident_diagnoses','tbl_hospital_referrals','tbl_fall_incidents',
    'tbl_products','tbl_product_stock','tbl_stock_movements','tbl_stock_transfers',
    'tbl_stock_requests','tbl_stock_request_details','tbl_charging_summary','tbl_staff',
    'physio_assessments','physio_examinations','physio_body_chart_findings',
    'physio_functional_assessments','physio_balance_assessments','physio_coordination_assessments'
  ]
  loop
    execute format(
      'create trigger trg_audit_%1$s after insert or update or delete on %1$s
       for each row execute function fn_audit_trigger();', t
    );
  end loop;
end $$;

-- ============================================================================
-- 12. HELPER VIEWS
-- ============================================================================

create view v_latest_progress_note with (security_invoker = true) as
select distinct on (resident_id) *
from tbl_progress_notes
order by resident_id, entry_timestamp desc;

-- Stock balance + reorder suggestion per branch/storage location.
create view v_stock_balance with (security_invoker = true) as
select
  p.id as product_id, p.barcode, p.name as product_name,
  sl.id as storage_location_id, sl.branch_id, sl.name as storage_location,
  coalesce(ps.quantity_in_stock, 0) as quantity_in_stock,
  ps.max_quantity,
  coalesce(ps.max_quantity, 0) - coalesce(ps.quantity_in_stock, 0) as qty_to_order,
  u.code as unit, pc.category_name as category, s.name as supplier_name
from tbl_products p
left join tbl_product_stock ps on ps.product_id = p.id
left join tbl_storage_locations sl on sl.id = ps.storage_location_id
left join tbl_suppliers s on s.id = p.supplier_id
left join tbl_uoms u on u.id = p.unit_id
left join tbl_product_categories pc on pc.id = p.category_id;

-- Total stock per product per branch, across that branch's storage locations.
create view v_product_branch_stock with (security_invoker = true) as
select p.id as product_id, p.barcode, p.name, sl.branch_id,
       coalesce(sum(ps.quantity_in_stock), 0) as total_quantity_in_stock
from tbl_products p
join tbl_product_stock ps on ps.product_id = p.id
join tbl_storage_locations sl on sl.id = ps.storage_location_id
group by p.id, p.barcode, p.name, sl.branch_id;

-- Transfers awaiting confirmation at the receiving branch.
create view v_pending_transfers with (security_invoker = true) as
select * from tbl_stock_transfers where status = 'in_transit';

-- ============================================================================
-- 13. TRIGGERS — apply stock_movements to balances; drive the transfer workflow
-- ============================================================================

create or replace function fn_apply_stock_movement() returns trigger
language plpgsql as $$
begin
  insert into tbl_product_stock (branch_id, product_id, storage_location_id, quantity_in_stock)
  values (new.branch_id, new.product_id, new.storage_location_id, new.quantity_delta)
  on conflict (product_id, storage_location_id)
  do update set quantity_in_stock = tbl_product_stock.quantity_in_stock + new.quantity_delta,
                updated_at = now();
  return new;
end;
$$;

create trigger trg_apply_stock_movement
after insert on tbl_stock_movements
for each row execute function fn_apply_stock_movement();

-- Dispatch: as soon as a transfer is created, the sending branch's stock
-- drops immediately (the goods have physically left).
create or replace function fn_transfer_dispatch() returns trigger
language plpgsql as $$
begin
  insert into tbl_stock_movements (
    branch_id, storage_location_id, product_id, movement_type,
    quantity_delta, reference_type, reference_id, registered_by, remarks
  ) values (
    new.from_branch_id, new.from_storage_location_id, new.product_id, 'transfer_out',
    -new.quantity, 'stock_transfer', new.id, new.dispatched_by, new.notes
  );
  return new;
end;
$$;

create trigger trg_transfer_dispatch
after insert on tbl_stock_transfers
for each row execute function fn_transfer_dispatch();

-- Confirm: when status flips to 'confirmed', the receiving branch's stock
-- increases. to_storage_location_id must be set at (or before) confirmation.
create or replace function fn_transfer_confirm() returns trigger
language plpgsql as $$
begin
  if new.status = 'confirmed' and old.status <> 'confirmed' then
    if new.to_storage_location_id is null then
      raise exception 'to_storage_location_id must be set before confirming a transfer';
    end if;
    insert into tbl_stock_movements (
      branch_id, storage_location_id, product_id, movement_type,
      quantity_delta, reference_type, reference_id, registered_by, remarks
    ) values (
      new.to_branch_id, new.to_storage_location_id, new.product_id, 'transfer_in',
      new.quantity, 'stock_transfer', new.id, new.confirmed_by, new.notes
    );
    new.confirmed_at := coalesce(new.confirmed_at, now());
  end if;
  return new;
end;
$$;

create trigger trg_transfer_confirm
before update on tbl_stock_transfers
for each row execute function fn_transfer_confirm();

-- ============================================================================
-- 14. ROW LEVEL SECURITY
-- ============================================================================
-- auth_account_id() / auth_branch_id() / auth_role() are defined earlier,
-- right after tbl_user_accounts (section 2) — every policy in this file
-- depends on them, and several (e.g. tbl_positions, tbl_lookup_values) are
-- enabled before this section even starts. See "MIGRATION FIX" note after
-- tbl_user_accounts.

-- Standard single-branch scoping for tables with one branch_id column.
do $$
declare t text;
begin
  foreach t in array array[
    'tbl_residents','tbl_nursing_chart_entries','tbl_nursing_chart_meals','tbl_nursing_chart_hygiene_episodes',
    'tbl_vital',
    'tbl_progress_notes','tbl_physio_progress_notes',
    'tbl_physio_op_patients','tbl_resident_diagnoses','tbl_hospital_referrals','tbl_fall_incidents',
    'tbl_product_stock','tbl_stock_movements','tbl_stock_requests','tbl_stock_request_details',
    'tbl_charging_summary','tbl_storage_locations',
    'physio_assessments','physio_examinations','physio_body_chart_findings',
    'physio_functional_assessments','physio_balance_assessments','physio_coordination_assessments'
  ]
  loop
    execute format('alter table %1$s enable row level security;', t);
    execute format(
      $f$create policy branch_scope_%1$s on %1$s
        using (
          auth_role() in ('ADMIN','MODERATOR')
          or branch_id = auth_branch_id()
        )
        with check (
          auth_role() in ('ADMIN','MODERATOR')
          or branch_id = auth_branch_id()
        );$f$, t);
  end loop;
end $$;

-- Shared catalog tables: everyone authenticated can read; only
-- ADMIN/MODERATOR can write (rights is a 3-tier access level now, not a job
-- title, so there's no more pharmacist-specific carve-out here -- grant a
-- real pharmacist MODERATOR rights if they need to manage products).
alter table tbl_products enable row level security;
create policy products_read on tbl_products for select using (auth.role() = 'authenticated');
create policy products_write on tbl_products for insert with check (auth_role() in ('ADMIN','MODERATOR'));
create policy products_update on tbl_products for update
  using (auth_role() in ('ADMIN','MODERATOR'))
  with check (auth_role() in ('ADMIN','MODERATOR'));

alter table tbl_suppliers enable row level security;
create policy suppliers_read on tbl_suppliers for select using (auth.role() = 'authenticated');
create policy suppliers_write on tbl_suppliers for all
  using (auth_role() in ('ADMIN','MODERATOR'))
  with check (auth_role() in ('ADMIN','MODERATOR'));

-- Cross-branch table: visible to staff at either end of the transfer, plus ADMIN/MODERATOR.
alter table tbl_stock_transfers enable row level security;
create policy transfers_scope on tbl_stock_transfers
  using (
    auth_role() in ('ADMIN','MODERATOR')
    or from_branch_id = auth_branch_id()
    or to_branch_id = auth_branch_id()
  )
  with check (
    auth_role() in ('ADMIN','MODERATOR')
    or from_branch_id = auth_branch_id()
    or to_branch_id = auth_branch_id()
  );

-- staff and branches: read for all authenticated staff, write restricted to admin.
alter table tbl_staff enable row level security;
create policy staff_read on tbl_staff for select using (auth.role() = 'authenticated');
create policy staff_write on tbl_staff for all using (auth_role() = 'ADMIN') with check (auth_role() = 'ADMIN');

alter table tbl_branches enable row level security;
create policy branches_read on tbl_branches for select using (auth.role() = 'authenticated');
create policy branches_write on tbl_branches for all using (auth_role() = 'ADMIN') with check (auth_role() = 'ADMIN');

-- ============================================================================
-- End of draft v2
-- ============================================================================
