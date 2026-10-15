"use strict";

const pgPool = require("../db");
const { assembleConfig } = require("../old_quotation_module/transformation_instructions&info/quotation-config-service");
const { calculateQuotation } = require("../old_quotation_module/transformation_instructions&info/quotation-engine");

function activeOptions(config, groupKey) {
  return config.options[groupKey]?.list.filter((option) => option.is_active) || [];
}

function listRateCardOptions(config, groupKey) {
  return activeOptions(config, groupKey).map((option) => ({
    option_key: option.key,
    label: option.label,
    ...option,
  }));
}

function calculateQuotationEstimates(v, config) {
  const paper = activeOptions(config, "paper").find((option) => option.key === v.paper_option_key);
  const printing = activeOptions(config, "printing").find((option) => option.key === v.printing_option_key);
  const handle = activeOptions(config, "handle").find((option) => option.key === v.handle_option_key);
  if (!paper || !printing || !handle) {
    throw new Error("A selected material, printing detail or handle is no longer available in the active rate card. Refresh the page and try again.");
  }
  const boardType = activeOptions(config, "board").find((option) => option.key === "bb_350");
  return v.quantities.map((quantity) => {
    const result = calculateQuotation({
      width: v.width_mm,
      height: v.height_mm,
      gusset: v.gusset_mm,
      quantity,
      paperName: paper.key,
      printingOption: printing.key,
      inkType: "normal",
      handles: true,
      handleType: handle.key,
      reinforcementBoard: Boolean(handle?.needs_board && boardType),
      boardType: handle?.needs_board && boardType ? boardType.key : null,
      convertingLabor: true,
      packaging: true,
    }, config);
    return {
      quantity,
      unit_price: result.summary.unitSellingPrice,
      total_price: result.summary.totalSellingPrice,
      calculation_details: result,
    };
  });
}

async function loadActiveQuotationRateConfig(database = pgPool) {
  const versionResult = await database.query(
    `SELECT * FROM quotation_rate_versions
     WHERE status = 'active'
     ORDER BY published_at DESC NULLS LAST, version_id DESC
     LIMIT 1`,
  );
  const version = versionResult.rows[0];
  if (!version) throw new Error("No active quotation rate version found. Run quotation_seed.postgresql.sql.");

  const versionId = version.version_id;
  const [parameters, tierSets, tierRows, groups, options, components] = await Promise.all([
    database.query("SELECT * FROM quotation_parameters WHERE version_id = $1", [versionId]),
    database.query("SELECT * FROM quotation_tier_sets WHERE version_id = $1", [versionId]),
    database.query(
      `SELECT r.* FROM quotation_tier_rows r
       JOIN quotation_tier_sets s ON s.tier_set_id = r.tier_set_id
       WHERE s.version_id = $1`,
      [versionId],
    ),
    database.query("SELECT * FROM quotation_option_groups WHERE version_id = $1", [versionId]),
    database.query(
      `SELECT o.* FROM quotation_options o
       JOIN quotation_option_groups g ON g.group_id = o.group_id
       WHERE g.version_id = $1`,
      [versionId],
    ),
    database.query("SELECT * FROM quotation_cost_components WHERE version_id = $1", [versionId]),
  ]);

  return assembleConfig({
    version,
    parameters: parameters.rows,
    tierSets: tierSets.rows,
    tierRows: tierRows.rows,
    groups: groups.rows,
    options: options.rows,
    components: components.rows,
  });
}

module.exports = {
  loadActiveQuotationRateConfig,
  calculateQuotationEstimates,
  listRateCardOptions,
};
