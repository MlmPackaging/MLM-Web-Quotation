// quotation-engine.js  (server side, CommonJS)
// Same calculation as the old quotation.js, but every rate / constant / table
// comes from a `config` object loaded from the database (see quotation-config-service.js).
//
//   calculateQuotation(formInput, config)  -> same result shape the old engine returned
//   getClientConfig(config)                -> what the browser needs to build dropdowns + live preview
//
// The engine is pure and synchronous: load the config once (cached), then calculate.

"use strict";

const round = Math.round;

// ---------------------------------------------------------------- config access
function param(cfg, key) {
  const v = cfg.params[key];
  if (v === undefined || v === null) throw new Error(`Missing quotation parameter: ${key}`);
  return v;
}

function group(cfg, key) {
  const g = cfg.options[key];
  if (!g) throw new Error(`Missing option group: ${key}`);
  return g;
}

function option(cfg, groupKey, optionKey) {
  return group(cfg, groupKey).byKey[String(optionKey)] || null;
}

// Floor lookup: the row with the largest range_min <= x.
// Below the first row: 'first_row' uses the first row, 'zero' returns null (cost 0).
function lookupTier(cfg, setKey, x) {
  const set = cfg.tiers[setKey];
  if (!set) throw new Error(`Missing tier set: ${setKey}`);
  let hit = null;
  for (const row of set.rows) {
    if (x >= row.min) hit = row;
    else break;
  }
  if (!hit && set.below === "first_row") hit = set.rows[0];
  return hit;
}

// ---------------------------------------------------------------- input
function isOn(v) {
  if (typeof v === "string") return v !== "" && v !== "None";
  return Boolean(v);
}

function normalizeInput(f) {
  return {
    width: Number(f.width),
    height: Number(f.height),
    gusset: Number(f.gusset),
    quantity: Number(f.quantity),
    paperName: f.paperName,
    printingOption: f.printingOption,
    inkType: f.inkType || "normal",
    marginIndex: Number(f.marginIndex),
    varnish: f.varnish || "None",
    lamination: f.lamination || "None",
    spotUV: Boolean(f.spotUV),
    stamping: Boolean(f.stamping),
    embossing: Boolean(f.embossing),
    textureEmbossing: Boolean(f.textureEmbossing),
    dieCut: Boolean(f.dieCut),
    foilType: f.foilType,
    stampingHeight: Number(f.stampingHeight),
    stampingWidth: Number(f.stampingWidth),
    embossingHeight: Number(f.embossingHeight),
    embossingWidth: Number(f.embossingWidth),
    embossingType: f.embossingType,
    textureType: String(f.textureType || "standard").toLowerCase(),
    dcMoulding: f.dcMoulding || "None",
    handles: Boolean(f.handles),
    handleType: f.handleType || null,
    reinforcementBoard: Boolean(f.reinforcementBoard),
    boardType: f.boardType || null,
    convertingLabor: Boolean(f.convertingLabor),
    packaging: Boolean(f.packaging),
    mockUp: Boolean(f.mockUp),
  };
}

function validateInput(cfg, input) {
  const p = (k) => param(cfg, k);
  const errors = [];
  if (!input.width || input.width < p("input_width_min") || input.width > p("input_width_max"))
    errors.push(`Width must be between ${p("input_width_min")}mm and ${p("input_width_max")}mm`);
  if (!input.height || input.height < p("input_height_min") || input.height > p("input_height_max"))
    errors.push(`Height must be between ${p("input_height_min")}mm and ${p("input_height_max")}mm`);
  if (input.gusset == null || Number.isNaN(input.gusset) || input.gusset < p("input_gusset_min") || input.gusset > p("input_gusset_max"))
    errors.push(`Gusset must be between ${p("input_gusset_min")}mm and ${p("input_gusset_max")}mm`);
  if (!input.quantity || input.quantity < p("input_quantity_min") || input.quantity > p("input_quantity_max"))
    errors.push(`Quantity must be between ${p("input_quantity_min").toLocaleString("en-US")} and ${p("input_quantity_max").toLocaleString("en-US")} pieces`);
  if (!input.paperName || !option(cfg, "paper", input.paperName)) errors.push("Invalid paper type selected");
  if (!input.printingOption || !option(cfg, "printing", input.printingOption)) errors.push("Invalid printing option selected");
  return errors;
}

// ---------------------------------------------------------------- layouts
function calcSheetSize(cfg, { width, height, gusset }, layout) {
  const w = Number(width) / 1000;
  const h = Number(height) / 1000;
  const g = Number(gusset) / 1000;
  const sheetWidth = layout.width_mult * (w + g) + param(cfg, "sheet_edge_allowance_m");
  const sheetHeight = layout.height_mult * (h + param(cfg, "sheet_gusset_height_factor") * g + param(cfg, "sheet_height_allowance_m"));
  return { sheetWidth: Number(sheetWidth.toFixed(3)), sheetHeight: Number(sheetHeight.toFixed(3)) };
}

function layoutFits(layout, sw, sh) {
  return (layout.valid_ranges || []).some(([wmin, wmax, hmin, hmax]) => sw >= wmin && sw <= wmax && sh >= hmin && sh <= hmax);
}

function findSuitableLayouts(cfg, dims) {
  const out = [];
  for (const layout of group(cfg, "layout").list) {
    if (!layout.is_active) continue;
    const { sheetWidth, sheetHeight } = calcSheetSize(cfg, dims, layout);
    if (layoutFits(layout, sheetWidth, sheetHeight)) out.push({ layout: layout.key, sheetWidth, sheetHeight, validation: { valid: true } });
  }
  return out;
}

// ---------------------------------------------------------------- cost handlers (P1..P18)
// Each handler receives ctx and returns a number. Switch-gating (toggle_field) is done by the caller.
const handlers = {
  paper(c) {
    const pw = lookupTier(c.cfg, "print_wastage", c.eq).v1;
    const aw = lookupTier(c.cfg, "paper_wastage", c.eq).v1;
    const weight = c.sheetWidth * c.sheetHeight * c.paper.weight_kg_per_m2 * c.sheetsNeeded * (1 + pw + aw);
    return round(weight * c.paper.price_per_kg);
  },

  printing(c) {
    const o = c.printing;
    const rateRow = () => lookupTier(c.cfg, "printing_rate", c.eq);
    if (o.spot_tier_set && c.cfg.tiers[o.spot_tier_set]) {
      let cost = round(lookupTier(c.cfg, o.spot_tier_set, c.eq).v1);
      if (o.add_process_cost) {
        const r = rateRow();
        cost = round(cost + o.process_colors * r.v1 * (r.max ?? r.min));
      }
      return cost;
    }
    const r = rateRow();
    const upper = r.max ?? r.min;
    return round(o.process_colors * r.v1 * upper + o.spot_colors * r.v1 * param(c.cfg, "spot_over_process_factor") * upper);
  },

  plate(c) {
    return round(c.printing.plate_cost || 0);
  },

  ink(c) {
    const inkWeight = c.sheetWidth * c.sheetHeight * param(c.cfg, "sqm_to_sqin") * (c.printing.coverage || 0) * c.sheetsNeeded * param(c.cfg, "ink_coverage_factor");
    const kg = inkWeight >= param(c.cfg, "ink_min_trigger_low") && inkWeight <= param(c.cfg, "ink_min_trigger_high") ? param(c.cfg, "ink_min_kg") : Math.ceil(inkWeight);
    const ink = option(c.cfg, "ink", c.input.inkType) || group(c.cfg, "ink").list[0];
    return round(kg * ink.price_per_kg);
  },

  varnish(c) {
    const sq = param(c.cfg, "sqm_to_sqin");
    const min = param(c.cfg, "varnish_min_cost");
    const cost = (o) => Math.max(min, Math.ceil(c.sheetWidth * c.sheetHeight * sq * o.rate_per_sqin * c.sheetsNeeded + c.sheetsNeeded * (o.per_sheet_fee || 0)));
    if (param(c.cfg, "varnish_pricing_mode") === "selected") {
      const o = option(c.cfg, "varnish", c.input.varnish);
      return o && o.charges ? round(cost(o)) : 0;
    }
    const methods = group(c.cfg, "varnish").list.filter((o) => o.charges && o.is_active);
    return methods.length ? round(methods.reduce((s, o) => s + cost(o), 0) / methods.length) : 0;
  },

  lamination(c) {
    const sq = param(c.cfg, "sqm_to_sqin");
    const min = param(c.cfg, "lamination_min_cost");
    const cost = (o) => Math.max(min, round(c.sheetWidth * c.sheetHeight * sq * o.rate_per_sqin * c.sheetsNeeded));
    if (param(c.cfg, "lamination_pricing_mode") === "selected") {
      const o = option(c.cfg, "lamination", c.input.lamination);
      return o && o.charges ? round(cost(o)) : 0;
    }
    const methods = group(c.cfg, "lamination").list.filter((o) => o.charges && o.is_active);
    return methods.length ? round(methods.reduce((s, o) => s + cost(o), 0) / methods.length) : 0;
  },

  spotuv(c) {
    const base = c.sheetWidth * c.sheetHeight * param(c.cfg, "sqm_to_sqin") * param(c.cfg, "spotuv_rate_per_sqin") * c.sheetsNeeded;
    return round(Math.max(param(c.cfg, "spotuv_min_cost"), round(base)));
  },

  stamping(c) {
    const H = c.input.stampingHeight;
    const W = c.input.stampingWidth;
    const mm = param(c.cfg, "mm_per_inch");
    const pad = param(c.cfg, "stamp_area_padding_in");
    const widthIn = W / mm + pad;
    const heightIn = H / mm + pad;
    const areaIn2 = widthIn * heightIn;
    const areaCm2 = (W / 10) * (H / 10);
    const foil = option(c.cfg, "foil", c.input.foilType);
    const rate = foil ? foil.rate_per_sqin : param(c.cfg, "stamp_default_foil_rate");
    const tier = lookupTier(c.cfg, "stamping", c.qty);
    const mult = tier ? tier.v1 : 1.0;
    const minTotal = tier ? tier.v2 || 0 : 0;
    const blockCharge = Math.max(param(c.cfg, "stamp_block_rate_per_cm2") * areaCm2, param(c.cfg, "stamp_block_min"));
    const mylarCost = Math.max(param(c.cfg, "stamp_mylar_rate_per_sqin") * areaIn2, param(c.cfg, "stamp_mylar_min"));
    const unit = rate * areaIn2 * mult * param(c.cfg, "stamp_unit_factor");
    const cost = Math.max(unit * c.qty, minTotal);
    return round(cost + blockCharge + mylarCost);
  },

  embossing(c) {
    const H = c.input.embossingHeight;
    const W = c.input.embossingWidth;
    const pad = param(c.cfg, "emboss_area_padding_cm");
    const area = (H / 10 + pad) * (W / 10 + pad);
    const type = option(c.cfg, "embossing_type", c.input.embossingType) || group(c.cfg, "embossing_type").list[0];
    const block = area * type.block_rate_per_cm2;
    const impression = lookupTier(c.cfg, "emboss_impression", c.qty).v1;
    return Math.max(param(c.cfg, "emboss_min_total"), round(block + impression * c.qty));
  },

  texture(c) {
    const tex = option(c.cfg, "texture", c.input.textureType);
    if (!tex || !tex.charged) return 0;
    const actual = c.qty / c.bagsPerSheet;
    const row = lookupTier(c.cfg, "texture_emboss", actual);
    if (!row) return 0;
    if (row.v1 > 0) return round(row.v1);
    return round(actual * param(c.cfg, "texture_base_rate") * row.v2);
  },

  diecut(c) {
    const actual = c.qty / c.bagsPerSheet;
    const row = lookupTier(c.cfg, "die_cut", actual);
    if (!row) return 0;
    if (row.v1 > 0) return round(row.v1);
    const special = c.qty === param(c.cfg, "diecut_special_qty") || c.layout.diecut_efficient;
    return round(actual * param(c.cfg, "diecut_base_rate") * (special ? row.v2 : row.v3));
  },

  mould(c) {
    if (c.input.dcMoulding === "Old") return round(param(c.cfg, "mould_existing_fee"));
    if (c.input.dcMoulding !== "New") return 0;
    const w = c.input.width / 1000;
    const h = c.input.height / 1000;
    const g = c.input.gusset / 1000;
    const X = 2 * (w + g) + param(c.cfg, "sheet_edge_allowance_m");
    const Y = h + param(c.cfg, "sheet_gusset_height_factor") * g + param(c.cfg, "mould_extra_height_m") + param(c.cfg, "sheet_height_allowance_m");
    const dieHeight = X * param(c.cfg, "mould_height_crease_factor") * c.layout.die_y_mult;
    const dieWidth = Y * param(c.cfg, "mould_width_crease_factor") * c.layout.die_y_mult;
    const crease = (dieWidth + dieHeight) * param(c.cfg, "mould_crease_rate");
    const plywood = X * Y * param(c.cfg, "mould_plywood_rate") + param(c.cfg, "mould_plywood_base");
    return round(crease + plywood * c.layout.plywood_mult);
  },

  handles(c) {
    if (!c.input.handleType) return 0;
    const h = option(c.cfg, "handle", c.input.handleType) || group(c.cfg, "handle").list[0];
    return round(h.price_per_pair * c.qty);
  },

  board(c) {
    if (!c.input.boardType) return 0;
    const b = option(c.cfg, "board", c.input.boardType);
    if (!b || !b.weight_kg_per_m2) return 0;
    const X = c.input.width / 1000;
    const Y = b.eb_extra ? c.input.gusset / 1000 + param(c.cfg, "board_eb_extra_m") : c.input.gusset / 1000;
    return round(X * Y * b.weight_kg_per_m2 * b.price_per_kg * c.qty);
  },

  converting(c) {
    const { height, width, gusset } = c.input;
    const g = gusset > 0 ? gusset : param(c.cfg, "converting_default_gusset_mm");
    const volume = (height * width * g) / 1_000_000_000;
    const glueLen = height / 1000 + 2 * (width / 1000) + g / 1000 - param(c.cfg, "converting_glue_deduction_m");
    const conv = lookupTier(c.cfg, "converting_rate", volume).v1;
    const glue = lookupTier(c.cfg, "glue_rate", glueLen).v1;
    const handling = lookupTier(c.cfg, "handling_rate", volume).v1;
    return round((conv + glue + handling) * param(c.cfg, "converting_year_multiplier") * c.qty);
  },

  packaging(c) {
    return round(param(c.cfg, "packaging_cost_per_unit") * c.qty);
  },

  logistics(c) {
    return round(lookupTier(c.cfg, "logistics", c.qty).v1);
  },

  mockup(c) {
    return round(param(c.cfg, "mockup_cost"));
  },
};

// ---------------------------------------------------------------- one layout
function calculateForLayout(cfg, input, layoutOpt) {
  const qty = input.quantity;
  const { sheetWidth, sheetHeight } = calcSheetSize(cfg, input, layoutOpt);
  const bagsPerSheet = layoutOpt.bags_per_sheet;

  const ctx = {
    cfg, input, qty, layout: layoutOpt, sheetWidth, sheetHeight, bagsPerSheet,
    eq: qty / bagsPerSheet,
    sheetsNeeded: qty / bagsPerSheet,
    paper: option(cfg, "paper", input.paperName),
    printing: option(cfg, "printing", input.printingOption),
  };

  const costs = {};
  let totalCost = 0;
  for (const comp of cfg.components) {
    let value = 0;
    const gated = comp.toggle_field && !isOn(input[comp.toggle_field]);
    if (comp.is_active && !gated) {
      const fn = handlers[comp.handler];
      if (!fn) throw new Error(`No calculator named '${comp.handler}' for ${comp.code}`);
      // PHASE 2 hook: if (comp.formula_expression) value = cfg.evaluate(comp.formula_expression, ctx)
      value = fn(ctx);
    }
    costs[comp.code] = round(value);
    totalCost += value;
  }

  const unitCost = totalCost / qty;
  const marginIndex = Number(input.marginIndex || param(cfg, "margin_default_index"));
  const unitSellingPrice = unitCost / marginIndex;
  const totalSellingPrice = unitSellingPrice * qty;

  return {
    layout: layoutOpt.key,
    sheetSize: { width: sheetWidth, height: sheetHeight },
    bagsPerSheet,
    sheetsNeeded: ctx.sheetsNeeded,
    costs,
    summary: {
      totalCost: round(totalCost),
      unitCost: Number(unitCost.toFixed(4)),
      unitSellingPrice: Number(unitSellingPrice.toFixed(4)),
      totalSellingPrice: round(totalSellingPrice),
    },
  };
}

// ---------------------------------------------------------------- public API
function calculateQuotation(formInput, cfg) {
  const input = normalizeInput(formInput);
  const errors = validateInput(cfg, input);
  if (errors.length) throw new Error(`Input validation failed: ${errors.join(", ")}`);

  const suitable = findSuitableLayouts(cfg, input);
  if (!suitable.length) throw new Error("No suitable layout found for the given dimensions. Please adjust the bag size.");

  const layoutCalcs = suitable.map((l) => calculateForLayout(cfg, input, option(cfg, "layout", l.layout)));
  const mode = param(cfg, "layout_selection_mode");

  let finalResult;
  if (layoutCalcs.length === 1 || mode === "first") {
    finalResult = layoutCalcs[0];
  } else if (mode === "cheapest") {
    finalResult = layoutCalcs.reduce((a, b) => (b.summary.unitCost < a.summary.unitCost ? b : a));
  } else {
    const avg = (fn) => layoutCalcs.reduce((s, c) => s + fn(c), 0) / layoutCalcs.length;
    const avgCosts = {};
    for (const key of Object.keys(layoutCalcs[0].costs)) avgCosts[key] = Number(avg((c) => c.costs[key]).toFixed(2));
    finalResult = {
      layout: "AUTO_SELECTED_AVERAGE",
      sheetSize: { width: "Multiple", height: "Multiple", details: layoutCalcs.map((c) => ({ layout: c.layout, sheetSize: c.sheetSize })) },
      bagsPerSheet: "Multiple",
      sheetsNeeded: "Multiple",
      costs: avgCosts,
      summary: {
        totalCost: Number(avg((c) => c.summary.totalCost).toFixed(2)),
        unitCost: Number(avg((c) => c.summary.unitCost).toFixed(4)),
        unitSellingPrice: Number(avg((c) => c.summary.unitSellingPrice).toFixed(4)),
        totalSellingPrice: Number(avg((c) => c.summary.totalSellingPrice).toFixed(2)),
      },
      allLayouts: layoutCalcs,
    };
  }

  const marginIndex = Number(input.marginIndex || param(cfg, "margin_default_index"));
  return {
    rateVersionId: cfg.versionId,
    input: {
      dimensions: { width: input.width, height: input.height, gusset: input.gusset },
      paper: input.paperName,
      printing: input.printingOption,
      quantity: input.quantity,
      finishing: {
        varnish: input.varnish, lamination: input.lamination, spotUV: input.spotUV, stamping: input.stamping,
        embossing: input.embossing, textureEmbossing: input.textureEmbossing, dieCut: input.dieCut, dcMoulding: input.dcMoulding,
      },
    },
    layoutSelection: { suitableLayouts: suitable.map((l) => l.layout), selectedLayout: finalResult.layout, allLayoutDetails: suitable },
    calculations: finalResult,
    summary: { ...finalResult.summary, marginIndex },
    validation: { layout: { valid: true, suitableCount: suitable.length }, input: { valid: true, errors: [] } },
  };
}

// What the browser needs. Field names match the old getPaperTypes()/getHandleTypes()/... output
// so quotation-form.js needs very few edits.
function getClientConfig(cfg) {
  const act = (g) => group(cfg, g).list.filter((o) => o.is_active);
  const p = (k) => param(cfg, k);
  return {
    versionId: cfg.versionId,
    paperTypes: act("paper").map((o) => ({ name: o.key, gsm: o.weight_kg_per_m2, pricePerKg: o.price_per_kg })),
    printingOptions: act("printing").map((o) => ({ name: o.key, processColors: o.process_colors, spotColors: o.spot_colors })),
    marginIndices: act("margin").map((o) => o.index),
    handleTypes: act("handle").map((o) => ({ id: o.key, label: o.label, pricePerPair: o.price_per_pair, pth: o.is_pth, needsBB: o.needs_board })),
    boardTypes: act("board").map((o) => ({ id: o.key, label: o.label, gsm: o.weight_kg_per_m2, pricePerKg: o.price_per_kg, ebExtra: o.eb_extra, note: o.note })),
    foilTypes: act("foil").map((o) => ({ value: o.key, label: o.label })),
    embossingTypes: act("embossing_type").map((o) => o.key),
    textureTypes: act("texture").map((o) => ({ value: o.key, label: o.label })),
    inkTypes: act("ink").map((o) => ({ value: o.key, label: `${o.label} (RM${o.price_per_kg}/kg)` })),
    varnishTypes: act("varnish").map((o) => ({ value: o.key, label: o.label })),
    laminationTypes: act("lamination").map((o) => ({ value: o.key, label: o.label })),
    costLabels: Object.fromEntries(cfg.components.map((c) => [c.code, c.label])),
    limits: {
      width: [p("input_width_min"), p("input_width_max")],
      height: [p("input_height_min"), p("input_height_max")],
      gusset: [p("input_gusset_min"), p("input_gusset_max")],
      quantity: [p("input_quantity_min"), p("input_quantity_max")],
      foilSize: [p("input_foil_size_min"), p("input_foil_size_max")],
    },
    layoutGeometry: {
      edgeAllowance: p("sheet_edge_allowance_m"),
      heightAllowance: p("sheet_height_allowance_m"),
      gussetFactor: p("sheet_gusset_height_factor"),
      layouts: act("layout").map((o) => ({ key: o.key, widthMult: o.width_mult, heightMult: o.height_mult, bagsPerSheet: o.bags_per_sheet, validRanges: o.valid_ranges })),
    },
    display: {
      convertingYearMultiplier: p("converting_year_multiplier"),
      convertingDefaultGusset: p("converting_default_gusset_mm"),
      convertingGlueDeduction: p("converting_glue_deduction_m"),
    },
  };
}

module.exports = { calculateQuotation, getClientConfig, lookupTier, handlers };
