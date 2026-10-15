-- =====================================================================
-- Quotation rate-card schema (MySQL 8+)
-- Everything the quotation calculation needs lives in these tables.
-- Every table is scoped by version_id so admins can edit a DRAFT rate
-- card and publish it, while old quotations stay reproducible.
-- =====================================================================

-- 1. VERSIONS ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS quotation_rate_versions (
  version_id     INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  version_label  VARCHAR(100) NOT NULL,                       -- e.g. '2026 Rate Card'
  status         ENUM('draft','active','archived') NOT NULL DEFAULT 'draft',
  notes          TEXT NULL,
  created_by     VARCHAR(255) NULL,
  created_at     TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  published_at   DATETIME NULL,
  INDEX idx_qrv_status (status)
);

-- 2. PARAMETERS : single named values (constants, rates, limits) ------
CREATE TABLE IF NOT EXISTS quotation_parameters (
  param_id      INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  version_id    INT UNSIGNED NOT NULL,
  param_key     VARCHAR(100) NOT NULL,                        -- code reads this, e.g. 'varnish_min_cost'
  group_code    VARCHAR(50)  NOT NULL,                        -- admin UI grouping: layout, paper, printing, ...
  label         VARCHAR(150) NOT NULL,
  value_type    ENUM('number','text','boolean') NOT NULL DEFAULT 'number',
  value_number  DECIMAL(20,8) NULL,
  value_text    VARCHAR(255) NULL,
  unit          VARCHAR(30)  NULL,                            -- 'RM', 'm', 'RM/sq in', 'x'
  min_allowed   DECIMAL(20,8) NULL,                           -- admin-form validation
  max_allowed   DECIMAL(20,8) NULL,
  used_by       VARCHAR(100) NULL,                            -- cost component(s), e.g. 'P5'
  description   VARCHAR(500) NULL,
  is_locked     TINYINT(1) NOT NULL DEFAULT 0,                -- 1 = unit constant, hide/readonly in admin
  sort_order    INT NOT NULL DEFAULT 0,
  updated_by    VARCHAR(255) NULL,
  updated_at    TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_qp_version_key (version_id, param_key),
  INDEX idx_qp_group (version_id, group_code),
  CONSTRAINT fk_qp_version FOREIGN KEY (version_id) REFERENCES quotation_rate_versions(version_id) ON DELETE CASCADE
);

-- 3. TIER SETS + ROWS : every "if qty is between A and B use X" table --
CREATE TABLE IF NOT EXISTS quotation_tier_sets (
  tier_set_id   INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  version_id    INT UNSIGNED NOT NULL,
  set_key       VARCHAR(100) NOT NULL,                        -- 'print_wastage', 'spot_cost_1', ...
  label         VARCHAR(150) NOT NULL,
  lookup_basis  VARCHAR(50)  NOT NULL,                        -- 'equivalent_qty','quantity','bag_volume_m3','glue_length_m','actual_sheet_qty'
  value1_label  VARCHAR(50)  NOT NULL DEFAULT 'value',
  value2_label  VARCHAR(50)  NULL,
  value3_label  VARCHAR(50)  NULL,
  below_min_behavior ENUM('first_row','zero') NOT NULL DEFAULT 'first_row', -- basis below the first range_min: use first row, or charge 0
  used_by       VARCHAR(100) NULL,
  description   VARCHAR(500) NULL,
  UNIQUE KEY uq_qts_version_key (version_id, set_key),
  CONSTRAINT fk_qts_version FOREIGN KEY (version_id) REFERENCES quotation_rate_versions(version_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quotation_tier_rows (
  tier_row_id   INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  tier_set_id   INT UNSIGNED NOT NULL,
  range_min     DECIMAL(18,6) NOT NULL,                       -- row applies when basis >= range_min
  range_max     DECIMAL(18,6) NULL,                           -- upper bound (printing needs it as a number); NULL = open ended
  value1        DECIMAL(18,6) NOT NULL,
  value2        DECIMAL(18,6) NULL,
  value3        DECIMAL(18,6) NULL,
  UNIQUE KEY uq_qtr_set_min (tier_set_id, range_min),
  CONSTRAINT fk_qtr_set FOREIGN KEY (tier_set_id) REFERENCES quotation_tier_sets(tier_set_id) ON DELETE CASCADE
);

-- 4. OPTIONS : everything the user picks from a dropdown --------------
CREATE TABLE IF NOT EXISTS quotation_option_groups (
  group_id      INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  version_id    INT UNSIGNED NOT NULL,
  group_key     VARCHAR(50)  NOT NULL,                        -- paper, printing, handle, board, foil, ink, ...
  label         VARCHAR(100) NOT NULL,
  attribute_schema JSON NOT NULL,                             -- [{"key":"gsm","label":"GSM (kg/m2)","type":"number"}, ...] -> admin UI builds its form from this
  UNIQUE KEY uq_qog_version_key (version_id, group_key),
  CONSTRAINT fk_qog_version FOREIGN KEY (version_id) REFERENCES quotation_rate_versions(version_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS quotation_options (
  option_id     INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  group_id      INT UNSIGNED NOT NULL,
  option_key    VARCHAR(100) NOT NULL,                        -- stored in quotations, e.g. 'Art Card 190', 'gold'
  label         VARCHAR(150) NOT NULL,
  attributes    JSON NOT NULL,                                -- rate/size/flags for this option
  sort_order    INT NOT NULL DEFAULT 0,
  is_active     TINYINT(1) NOT NULL DEFAULT 1,                -- hide from dropdown without deleting
  UNIQUE KEY uq_qo_group_key (group_id, option_key),
  CONSTRAINT fk_qo_group FOREIGN KEY (group_id) REFERENCES quotation_option_groups(group_id) ON DELETE CASCADE
);

-- 5. COST COMPONENTS : P1..P18 registry (phase 2 hook for formulas) ---
CREATE TABLE IF NOT EXISTS quotation_cost_components (
  component_id       INT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  version_id         INT UNSIGNED NOT NULL,
  code               VARCHAR(10)  NOT NULL,                   -- 'P1'
  label              VARCHAR(100) NOT NULL,                   -- 'Paper Cost'
  report_group       VARCHAR(50)  NULL,                       -- 'Material','Printing','Finishing','Conversion','Other' (PDF / reports)
  toggle_field       VARCHAR(50)  NULL,                       -- form field that switches it on, e.g. 'spotUV'; NULL = always
  handler            VARCHAR(50)  NOT NULL,                   -- built-in JS calculator name
  formula_expression TEXT NULL,                               -- PHASE 2: safe expression; when set it overrides handler
  is_active          TINYINT(1) NOT NULL DEFAULT 1,
  sort_order         INT NOT NULL DEFAULT 0,
  UNIQUE KEY uq_qcc_version_code (version_id, code),
  CONSTRAINT fk_qcc_version FOREIGN KEY (version_id) REFERENCES quotation_rate_versions(version_id) ON DELETE CASCADE
);

-- 6. Link saved quotations to the rate card that priced them ----------
-- (run once; ignore the error if the column already exists)
ALTER TABLE quotations ADD COLUMN rate_version_id INT UNSIGNED NULL AFTER total_amount;
