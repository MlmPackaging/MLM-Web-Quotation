// quotation.js
// Quotation Calculation Engine - COMPLETE VERSION WITH AUTO LAYOUT SELECTION
// Based on Offset Quotation-Fixing Project Excel Formulas
// P13, P14, P15 updated with accurate volume-based & handle-type-based formulas (V2 Excel)

// ==================== COMPLETE DATA TABLES ====================

const printWastageTable = [
  { min: 100, max: 199, value: 2.00 },
  { min: 200, max: 299, value: 1.00 },
  { min: 300, max: 399, value: 0.70 },
  { min: 400, max: 499, value: 0.50 },
  { min: 500, max: 599, value: 0.45 },
  { min: 600, max: 699, value: 0.40 },
  { min: 700, max: 799, value: 0.35 },
  { min: 800, max: 899, value: 0.32 },
  { min: 900, max: 999, value: 0.30 },
  { min: 1000, max: 1200, value: 0.28 },
  { min: 1201, max: 1400, value: 0.26 },
  { min: 1401, max: 1600, value: 0.24 },
  { min: 1601, max: 1800, value: 0.22 },
  { min: 1801, max: 2000, value: 0.20 },
  { min: 2001, max: 2500, value: 0.18 },
  { min: 2501, max: 3000, value: 0.16 },
  { min: 3001, max: 4000, value: 0.14 },
  { min: 4001, max: 5000, value: 0.12 },
  { min: 5001, max: 6000, value: 0.10 },
  { min: 6001, max: 7000, value: 0.085 },
  { min: 7001, max: 8000, value: 0.075 },
  { min: 8001, max: 9000, value: 0.065 },
  { min: 9001, max: 10000, value: 0.06 },
  { min: 10001, max: 12000, value: 0.055 },
  { min: 12001, max: 15000, value: 0.05 },
  { min: 15001, max: 20000, value: 0.045 },
  { min: 20001, max: 25000, value: 0.042 },
  { min: 25001, max: 30000, value: 0.04 },
  { min: 30001, max: 40000, value: 0.035 },
  { min: 40001, max: 50000, value: 0.03 },
  { min: 50001, max: 60000, value: 0.03 },
  { min: 60001, max: 70000, value: 0.03 },
  { min: 70001, max: 80000, value: 0.03 },
  { min: 80001, max: 90000, value: 0.03 },
  { min: 90001, max: 100000, value: 0.03 },
  { min: 100001, max: 150000, value: 0.03 },
  { min: 150001, max: 200000, value: 0.03 },
  { min: 200001, max: 250000, value: 0.03 },
  { min: 250001, max: 300000, value: 0.03 },
  { min: 300001, max: 350000, value: 0.03 },
  { min: 350001, max: 425000, value: 0.03 },
  { min: 425001, max: 500000, value: 0.03 },
  { min: 500001, max: 600000, value: 0.03 },
  { min: 600001, max: 700000, value: 0.03 },
  { min: 700001, max: 800000, value: 0.03 },
  { min: 800001, max: 900000, value: 0.03 },
  { min: 900001, max: 1000000, value: 0.03 }
];

const paperWastageTable = [
  { min: 100, max: 199, value: 0.30 },
  { min: 200, max: 299, value: 0.29 },
  { min: 300, max: 399, value: 0.28 },
  { min: 400, max: 499, value: 0.27 },
  { min: 500, max: 599, value: 0.25 },
  { min: 600, max: 699, value: 0.23 },
  { min: 700, max: 799, value: 0.21 },
  { min: 800, max: 899, value: 0.20 },
  { min: 900, max: 999, value: 0.19 },
  { min: 1000, max: 1200, value: 0.18 },
  { min: 1201, max: 1400, value: 0.16 },
  { min: 1401, max: 1600, value: 0.14 },
  { min: 1601, max: 1800, value: 0.13 },
  { min: 1801, max: 2000, value: 0.12 },
  { min: 2001, max: 2500, value: 0.10 },
  { min: 2501, max: 3000, value: 0.09 },
  { min: 3001, max: 4000, value: 0.08 },
  { min: 4001, max: 5000, value: 0.07 },
  { min: 5001, max: 6000, value: 0.06 },
  { min: 6001, max: 7000, value: 0.05 },
  { min: 7001, max: 8000, value: 0.05 },
  { min: 8001, max: 9000, value: 0.05 },
  { min: 9001, max: 10000, value: 0.05 },
  { min: 10001, max: 12000, value: 0.05 },
  { min: 12001, max: 15000, value: 0.05 },
  { min: 15001, max: 20000, value: 0.047 },
  { min: 20001, max: 25000, value: 0.047 },
  { min: 25001, max: 30000, value: 0.045 },
  { min: 30001, max: 40000, value: 0.04 },
  { min: 40001, max: 50000, value: 0.035 },
  { min: 50001, max: 60000, value: 0.03 },
  { min: 60001, max: 70000, value: 0.03 },
  { min: 70001, max: 80000, value: 0.03 },
  { min: 80001, max: 90000, value: 0.03 },
  { min: 90001, max: 100000, value: 0.03 },
  { min: 100001, max: 150000, value: 0.03 },
  { min: 150001, max: 200000, value: 0.03 },
  { min: 200001, max: 250000, value: 0.03 },
  { min: 250001, max: 300000, value: 0.03 },
  { min: 300001, max: 350000, value: 0.03 },
  { min: 350001, max: 425000, value: 0.03 },
  { min: 425001, max: 500000, value: 0.03 },
  { min: 500001, max: 600000, value: 0.03 },
  { min: 600001, max: 700000, value: 0.03 },
  { min: 700001, max: 800000, value: 0.03 },
  { min: 800001, max: 900000, value: 0.03 },
  { min: 900001, max: 1000000, value: 0.03 }
];

const printingRateTable = [
  { min: 100, max: 199, rate: 0.3 },
  { min: 200, max: 299, rate: 0.2 },
  { min: 300, max: 399, rate: 0.145 },
  { min: 400, max: 499, rate: 0.115 },
  { min: 500, max: 599, rate: 0.104 },
  { min: 600, max: 699, rate: 0.089 },
  { min: 700, max: 799, rate: 0.081 },
  { min: 800, max: 899, rate: 0.073 },
  { min: 900, max: 999, rate: 0.065 },
  { min: 1000, max: 1200, rate: 0.058 },
  { min: 1201, max: 1400, rate: 0.05 },
  { min: 1401, max: 1600, rate: 0.044 },
  { min: 1601, max: 1800, rate: 0.039 },
  { min: 1801, max: 2000, rate: 0.036 },
  { min: 2001, max: 2500, rate: 0.03 },
  { min: 2501, max: 3000, rate: 0.027 },
  { min: 3001, max: 4000, rate: 0.022 },
  { min: 4001, max: 5000, rate: 0.02 },
  { min: 5001, max: 6000, rate: 0.02 },
  { min: 6001, max: 7000, rate: 0.02 },
  { min: 7001, max: 8000, rate: 0.019 },
  { min: 8001, max: 9000, rate: 0.019 },
  { min: 9001, max: 10000, rate: 0.019 },
  { min: 10001, max: 12000, rate: 0.018 },
  { min: 12001, max: 15000, rate: 0.018 },
  { min: 15001, max: 20000, rate: 0.017 },
  { min: 20001, max: 25000, rate: 0.017 },
  { min: 25001, max: 30000, rate: 0.016 },
  { min: 30001, max: 40000, rate: 0.015 },
  { min: 40001, max: 50000, rate: 0.014 },
  { min: 50001, max: 60000, rate: 0.013 },
  { min: 60001, max: 70000, rate: 0.012 },
  { min: 70001, max: 80000, rate: 0.012 },
  { min: 80001, max: 90000, rate: 0.011 },
  { min: 90001, max: 100000, rate: 0.0105 },
  { min: 100001, max: 150000, rate: 0.01 },
  { min: 150001, max: 200000, rate: 0.01 },
  { min: 200001, max: 250000, rate: 0.0095 },
  { min: 250001, max: 300000, rate: 0.0093 },
  { min: 300001, max: 350000, rate: 0.0092 },
  { min: 350001, max: 425000, rate: 0.0091 },
  { min: 425001, max: 500000, rate: 0.0091 },
  { min: 500001, max: 600000, rate: 0.009 },
  { min: 600001, max: 700000, rate: 0.009 },
  { min: 700001, max: 800000, rate: 0.009 },
  { min: 800001, max: 900000, rate: 0.0089 },
  { min: 900001, max: 1000000, rate: 0.0085 }
];

const spotColorTables = {
  "1 spot up to 33%": [
    { min: 100, max: 199, cost: 59.70 },
    { min: 200, max: 299, cost: 59.80 },
    { min: 300, max: 399, cost: 59.85 },
    { min: 400, max: 499, cost: 59.88 },
    { min: 500, max: 599, cost: 59.90 },
    { min: 600, max: 699, cost: 69.90 },
    { min: 700, max: 799, cost: 71.91 },
    { min: 800, max: 899, cost: 71.92 },
    { min: 900, max: 999, cost: 74.93 },
    { min: 1000, max: 1200, cost: 78.00 },
    { min: 1201, max: 1400, cost: 88.20 },
    { min: 1401, max: 1600, cost: 92.80 },
    { min: 1601, max: 1800, cost: 90.00 },
    { min: 1801, max: 2000, cost: 100.00 },
    { min: 2001, max: 2500, cost: 125.00 },
    { min: 2501, max: 3000, cost: 142.50 },
    { min: 3001, max: 4000, cost: 190.00 },
    { min: 4001, max: 5000, cost: 225.00 },
    { min: 5001, max: 6000, cost: 270.00 },
    { min: 6001, max: 7000, cost: 297.50 },
    { min: 7001, max: 8000, cost: 340.00 },
    { min: 8001, max: 9000, cost: 360.00 },
    { min: 9001, max: 10000, cost: 400.00 },
    { min: 10001, max: 12000, cost: 450.00 },
    { min: 12001, max: 15000, cost: 562.50 },
    { min: 15001, max: 20000, cost: 700.00 },
    { min: 20001, max: 25000, cost: 875.00 },
    { min: 25001, max: 30000, cost: 900.00 },
    { min: 30001, max: 40000, cost: 1000.00 },
    { min: 40001, max: 50000, cost: 1200.00 },
    { min: 50001, max: 60000, cost: 1440.00 },
    { min: 60001, max: 70000, cost: 1680.00 },
    { min: 70001, max: 80000, cost: 1920.00 },
    { min: 80001, max: 90000, cost: 2070.00 },
    { min: 90001, max: 100000, cost: 2300.00 },
    { min: 100001, max: 150000, cost: 3450.00 },
    { min: 150001, max: 200000, cost: 4600.00 },
    { min: 200001, max: 250000, cost: 5750.00 },
    { min: 250001, max: 300000, cost: 6900.00 },
    { min: 300001, max: 350000, cost: 8050.00 },
    { min: 350001, max: 425000, cost: 9350.00 },
    { min: 425001, max: 500000, cost: 11000.00 },
    { min: 500001, max: 600000, cost: 13200.00 },
    { min: 600001, max: 700000, cost: 15400.00 },
    { min: 700001, max: 800000, cost: 17600.00 },
    { min: 800001, max: 900000, cost: 18900.00 },
    { min: 900001, max: 1000000, cost: 20000.00 }
  ],
  "2 spot up to 67%": [
    { min: 100, max: 199, cost: 119.40 },
    { min: 200, max: 299, cost: 119.60 },
    { min: 300, max: 399, cost: 119.70 },
    { min: 400, max: 499, cost: 119.76 },
    { min: 500, max: 599, cost: 119.80 },
    { min: 600, max: 699, cost: 139.80 },
    { min: 700, max: 799, cost: 143.82 },
    { min: 800, max: 899, cost: 143.84 },
    { min: 900, max: 999, cost: 149.85 },
    { min: 1000, max: 1200, cost: 156.00 },
    { min: 1201, max: 1400, cost: 176.40 },
    { min: 1401, max: 1600, cost: 185.60 },
    { min: 1601, max: 1800, cost: 180.00 },
    { min: 1801, max: 2000, cost: 200.00 },
    { min: 2001, max: 2500, cost: 250.00 },
    { min: 2501, max: 3000, cost: 285.00 },
    { min: 3001, max: 4000, cost: 380.00 },
    { min: 4001, max: 5000, cost: 450.00 },
    { min: 5001, max: 6000, cost: 540.00 },
    { min: 6001, max: 7000, cost: 595.00 },
    { min: 7001, max: 8000, cost: 680.00 },
    { min: 8001, max: 9000, cost: 720.00 },
    { min: 9001, max: 10000, cost: 800.00 },
    { min: 10001, max: 12000, cost: 900.00 },
    { min: 12001, max: 15000, cost: 1125.00 },
    { min: 15001, max: 20000, cost: 1400.00 },
    { min: 20001, max: 25000, cost: 1750.00 },
    { min: 25001, max: 30000, cost: 1800.00 },
    { min: 30001, max: 40000, cost: 2000.00 },
    { min: 40001, max: 50000, cost: 2400.00 },
    { min: 50001, max: 60000, cost: 2880.00 },
    { min: 60001, max: 70000, cost: 3360.00 },
    { min: 70001, max: 80000, cost: 3840.00 },
    { min: 80001, max: 90000, cost: 4140.00 },
    { min: 90001, max: 100000, cost: 4600.00 },
    { min: 100001, max: 150000, cost: 6900.00 },
    { min: 150001, max: 200000, cost: 9200.00 },
    { min: 200001, max: 250000, cost: 11500.00 },
    { min: 250001, max: 300000, cost: 13800.00 },
    { min: 300001, max: 350000, cost: 16100.00 },
    { min: 350001, max: 425000, cost: 18700.00 },
    { min: 425001, max: 500000, cost: 22000.00 },
    { min: 500001, max: 600000, cost: 26400.00 },
    { min: 600001, max: 700000, cost: 30800.00 },
    { min: 700001, max: 800000, cost: 35200.00 },
    { min: 800001, max: 900000, cost: 37800.00 },
    { min: 900001, max: 1000000, cost: 40000.00 }
  ],
  "3 spot up to 33%": [
    { min: 100, max: 199, cost: 179.10 },
    { min: 200, max: 299, cost: 179.40 },
    { min: 300, max: 399, cost: 179.55 },
    { min: 400, max: 499, cost: 179.64 },
    { min: 500, max: 599, cost: 179.70 },
    { min: 600, max: 699, cost: 209.70 },
    { min: 700, max: 799, cost: 215.73 },
    { min: 800, max: 899, cost: 215.76 },
    { min: 900, max: 999, cost: 224.78 },
    { min: 1000, max: 1200, cost: 234.00 },
    { min: 1201, max: 1400, cost: 264.60 },
    { min: 1401, max: 1600, cost: 278.40 },
    { min: 1601, max: 1800, cost: 270.00 },
    { min: 1801, max: 2000, cost: 300.00 },
    { min: 2001, max: 2500, cost: 375.00 },
    { min: 2501, max: 3000, cost: 427.50 },
    { min: 3001, max: 4000, cost: 570.00 },
    { min: 4001, max: 5000, cost: 675.00 },
    { min: 5001, max: 6000, cost: 810.00 },
    { min: 6001, max: 7000, cost: 892.50 },
    { min: 7001, max: 8000, cost: 1020.00 },
    { min: 8001, max: 9000, cost: 1080.00 },
    { min: 9001, max: 10000, cost: 1200.00 },
    { min: 10001, max: 12000, cost: 1350.00 },
    { min: 12001, max: 15000, cost: 1687.50 },
    { min: 15001, max: 20000, cost: 2100.00 },
    { min: 20001, max: 25000, cost: 2625.00 },
    { min: 25001, max: 30000, cost: 2700.00 },
    { min: 30001, max: 40000, cost: 3000.00 },
    { min: 40001, max: 50000, cost: 3600.00 },
    { min: 50001, max: 60000, cost: 39600.00 },
    { min: 600001, max: 700000, cost: 46200.00 },
    { min: 700001, max: 800000, cost: 52800.00 },
    { min: 800001, max: 900000, cost: 56700.00 },
    { min: 900001, max: 1000000, cost: 60000.00 }
  ]
};

// ==================== PRINTING CONFIGS ====================

const printingConfigs = {
  "Plain 0c x 0c": { processColors: 0, spotColors: 0, plateCost: 0, useSpotTable: false },
  "process 4c x 0c": { processColors: 4, spotColors: 0, plateCost: 140, useSpotTable: false },
  "1 spot up to 33%": { processColors: 0, spotColors: 1, plateCost: 40, useSpotTable: true, tableKey: "1 spot up to 33%" },
  "1 spot up to 67%": { processColors: 0, spotColors: 1, plateCost: 40, useSpotTable: true, tableKey: "1 spot up to 33%" },
  "1 spot up to 100%": { processColors: 0, spotColors: 1, plateCost: 40, useSpotTable: true, tableKey: "1 spot up to 33%" },
  "2 spot up to 33%": { processColors: 0, spotColors: 2, plateCost: 80, useSpotTable: true, tableKey: "2 spot up to 67%" },
  "2 spot up to 67%": { processColors: 0, spotColors: 2, plateCost: 80, useSpotTable: true, tableKey: "2 spot up to 67%" },
  "2 spot up to 100%": { processColors: 0, spotColors: 2, plateCost: 80, useSpotTable: true, tableKey: "2 spot up to 67%" },
  "3 spot up to 33%": { processColors: 0, spotColors: 3, plateCost: 120, useSpotTable: true, tableKey: "3 spot up to 33%" },
  "3 spot up to 67%": { processColors: 0, spotColors: 3, plateCost: 120, useSpotTable: true, tableKey: "3 spot up to 33%" },
  "3 spot up to 100%": { processColors: 0, spotColors: 3, plateCost: 120, useSpotTable: true, tableKey: "3 spot up to 33%" },
  "5c=process 4cx0c+1c spot 33%": { processColors: 4, spotColors: 1, plateCost: 180, useSpotTable: true, tableKey: "1 spot up to 33%" },
  "6c=process 4cx0c+2c spot 33%": { processColors: 4, spotColors: 2, plateCost: 220, useSpotTable: true, tableKey: "2 spot up to 67%" }
};

const coverageMap = {
  "Plain 0c x 0c": 0,
  "process 4c x 0c": 0,
  "1 spot up to 33%": 0.33,
  "1 spot up to 67%": 0.67,
  "1 spot up to 100%": 1.0,
  "2 spot up to 33%": 0.33,
  "2 spot up to 67%": 0.67,
  "2 spot up to 100%": 1.0,
  "3 spot up to 33%": 0.33,
  "3 spot up to 67%": 0.67,
  "3 spot up to 100%": 1.0,
  "5c=process 4cx0c+1c spot 33%": 1.18,
  "6c=process 4cx0c+2c spot 33%": 1.18
};

const paperTypes = [
  { name: "Brown Kraft 100", gsm: 0.10, pricePerKg: 2.35 },
  { name: "Brown Kraft 120", gsm: 0.12, pricePerKg: 2.25 },
  { name: "Brown Kraft 140", gsm: 0.14, pricePerKg: 2.30 },
  { name: "Brown Kraft 170", gsm: 0.17, pricePerKg: 2.30 },
  { name: "White Kraft 100", gsm: 0.10, pricePerKg: 4.70 },
  { name: "White Kraft 120", gsm: 0.12, pricePerKg: 4.50 },
  { name: "White Kraft 150", gsm: 0.15, pricePerKg: 4.70 },
  { name: "White Kraft 180", gsm: 0.18, pricePerKg: 4.70 },
  { name: "Art Paper 157", gsm: 0.157, pricePerKg: 3.60 },
  { name: "Art Card 190", gsm: 0.19, pricePerKg: 3.45 },
  { name: "Art Card 210", gsm: 0.21, pricePerKg: 3.55 },
  { name: "Art Card 230", gsm: 0.23, pricePerKg: 3.55 },
  { name: "Sack Kraft 100", gsm: 0.10, pricePerKg: 4.50 }
];

const inkPrices = { normal: 60, metallic: 150 };

// ==================== P13: HANDLES - PRICE DATABASE ====================
// Source: Excel rows 610-621 / 649-660
// Formula: pricePerPair = (length_cm × diameter_mm) / (defaultLength × defaultDiameter) × pricePerMetre
// For PTH handles: pricePerPair = flat rate per unit

const handleTypes = [
  // id, label, pricePerPair (RM), pthType, requiresReinforcement
  // pricePerPair calculated from Excel: length*dia/(stdLen*stdDia)*priceRM
  { id: "round_pp_tipping",       label: "Round PP Tipping",         pricePerPair: 0.0375,  pth: false, needsBB: false },
  // 30cm × 5mm / (30 × 4) × 0.06 = 0.075  → but this is per-piece not per-pair. Excel shows F610*qty.
  // F610 = B610*E610/K610/L610*M610 = 30*5/30/4*0.06 = 0.075 per PAIR. Let's store that directly.
  { id: "round_pp_tipping",       label: "Round PP Tipping (30cm/5mm Gold)",     pricePerPair: 0.075,  pth: false, needsBB: false },
  { id: "round_poly_tipping",     label: "Round Polyester Tipping (30cm/5mm)",   pricePerPair: 0.079,  pth: false, needsBB: false },
  { id: "flat_polyester",         label: "Flat Polyester (40cm/20mm)",            pricePerPair: 0.200,  pth: false, needsBB: false },
  { id: "flat_satin",             label: "Flat Satin 1-side (40cm/25mm)",         pricePerPair: 0.144,  pth: false, needsBB: false },
  { id: "flat_gross_grain",       label: "Flat Gross Grain (40cm/20mm)",          pricePerPair: 0.150,  pth: false, needsBB: false },
  { id: "pp_twisted",             label: "PP Twisted (40cm/6mm)",                 pricePerPair: 0.152,  pth: false, needsBB: false },
  { id: "pth_white",              label: "PTH White (Paper Twist Handle)",        pricePerPair: 0.085,  pth: true,  needsBB: true  },
  { id: "pth_brown",              label: "PTH Brown (Paper Twist Handle)",        pricePerPair: 0.075,  pth: true,  needsBB: true  },
  { id: "pth_black",              label: "PTH Black (Paper Twist Handle)",        pricePerPair: 0.095,  pth: true,  needsBB: true  },
  { id: "pth_other",              label: "PTH Other Colors",                      pricePerPair: 0.100,  pth: true,  needsBB: true  },
  { id: "paper_yarn_round",       label: "Paper Yarn Round Knots (50cm/5mm)",     pricePerPair: 0.225,  pth: false, needsBB: false },
  { id: "paper_rope_flat_button", label: "Paper Rope Flat-Button (40cm/15mm)",   pricePerPair: 0.240,  pth: false, needsBB: false },
];

// Re-export clean list for UI (deduplicated)
const handleTypeOptions = [
  { id: "round_pp_tipping",       label: "Round PP Tipping",                      pricePerPair: 0.075,  pth: false, needsBB: false },
  { id: "round_poly_tipping",     label: "Round Polyester Tipping",               pricePerPair: 0.079,  pth: false, needsBB: false },
  { id: "flat_polyester",         label: "Flat Polyester",                         pricePerPair: 0.200,  pth: false, needsBB: false },
  { id: "flat_satin",             label: "Flat Satin 1-side",                      pricePerPair: 0.144,  pth: false, needsBB: false },
  { id: "flat_gross_grain",       label: "Flat Gross Grain",                       pricePerPair: 0.150,  pth: false, needsBB: false },
  { id: "pp_twisted",             label: "PP Twisted",                             pricePerPair: 0.152,  pth: false, needsBB: false },
  { id: "pth_white",              label: "PTH White (Paper Twist Handle)",         pricePerPair: 0.085,  pth: true,  needsBB: true  },
  { id: "pth_brown",              label: "PTH Brown (Paper Twist Handle)",         pricePerPair: 0.075,  pth: true,  needsBB: true  },
  { id: "pth_black",              label: "PTH Black (Paper Twist Handle)",         pricePerPair: 0.095,  pth: true,  needsBB: true  },
  { id: "pth_other",              label: "PTH Other Colors",                       pricePerPair: 0.100,  pth: true,  needsBB: true  },
  { id: "paper_yarn_round",       label: "Paper Yarn Round Knots",                 pricePerPair: 0.225,  pth: false, needsBB: false },
  { id: "paper_rope_flat_button", label: "Paper Rope Flat-Button",                 pricePerPair: 0.240,  pth: false, needsBB: false },
];

// ==================== P14: REINFORCEMENT BOARD - DATA ====================
// Source: Excel rows 685-718
// Formula: unitCost = X_m × Y_m × gsm × pricePerKg
// X = width/1000 (bag width in m)  Y = height/1000 + 0.07 (bag height + gusset extra, in m)
// For EB+BB: Y = gusset/1000 + 0.07  — wait, re-reading Excel:
//   E687 = C687 (Width in m), F687 = D687 + 0.07 (Gusset/1000 + 0.07)
//   So board dimensions: width = bag_width_m, height = bag_gusset_m + 0.07
//   For PTH handles (BB Only): F703 = D703 (no extra 0.07 added)

const reinforcementBoardTypes = [
  // id, label, gsm (density kg/m²), pricePerKg, includesEB (adds 0.07 to Y), note
  { id: "eb_bb_350",  label: "EB+BB Duplex 350gsm",    gsm: 0.35, pricePerKg: 2.6, ebExtra: true,  note: "Standard reinforcement (EB + bottom board)"    },
  { id: "eb_bb_450",  label: "EB+BB Duplex 450gsm",    gsm: 0.45, pricePerKg: 2.8, ebExtra: true,  note: "Heavy-duty reinforcement (EB + bottom board)"   },
  { id: "eb_bb_250",  label: "EB+BB BrownBoard 250gsm",gsm: 0.25, pricePerKg: 2.8, ebExtra: true,  note: "Economy reinforcement (EB + bottom board)"      },
  { id: "bb_350",     label: "BB Only Duplex 350gsm",   gsm: 0.35, pricePerKg: 2.6, ebExtra: false, note: "Bottom board only – for PTH handles"            },
  { id: "bb_450",     label: "BB Only Duplex 450gsm",   gsm: 0.45, pricePerKg: 2.8, ebExtra: false, note: "Heavy bottom board only – for PTH handles"      },
  { id: "bb_250",     label: "BB Only BrownBoard 250gsm",gsm:0.25, pricePerKg: 2.8, ebExtra: false, note: "Economy bottom board only – for PTH handles"    },
  { id: "nil",        label: "Nil (No Board)",           gsm: 0,    pricePerKg: 0,   ebExtra: false, note: "No reinforcement board"                        },
];

// ==================== P15: CONVERTING LABOR - RATE TABLES ====================
// Source: Excel rows 745-774
// Year 2026 multiplier: 1.1 (K741 = 1.1 × base 2024 rate)
//
// Converting Rate (F): lookup by bagVolume_m3 in convertingRateTable  → rate per bag
// Glue Rate (H): lookup by glueLength_m in glueRateTable              → rate per bag  
// Handling Rate (I): lookup by bagVolume_m3 in handlingRateTable      → rate per bag
// totalRate2024 = convertingRate + glueRate + handlingRate
// totalRate2026 = totalRate2024 × 1.1
// P15 = ROUND(totalRate2026 × qty)
//
// bagVolume_m3   = height_mm × width_mm × gusset_mm / 1,000,000,000
//   (note: Excel uses actual gusset value entered, not adjusted)
// glueLength_m   = (height_mm/1000) + 2×(width_mm/1000) + (gusset_mm/1000) - 0.02

const CONVERTING_YEAR_MULTIPLIER = 1.1; // 2026 uplift

const convertingRateTable = [
  { min: 0.0005, max: 0.0035, rate: 0.11 },
  { min: 0.0036, max: 0.005,  rate: 0.12 },
  { min: 0.0051, max: 0.008,  rate: 0.13 },
  { min: 0.0081, max: 0.015,  rate: 0.15 },
  { min: 0.0151, max: 0.02,   rate: 0.16 },
  { min: 0.02,   max: 0.025,  rate: 0.17 },
  { min: 0.0251, max: 0.03,   rate: 0.18 },
  { min: 0.03,   max: 0.04,   rate: 0.20 },
  { min: 0.04,   max: 0.05,   rate: 0.21 },
  { min: 0.05,   max: 0.06,   rate: 0.23 },
  { min: 0.06,   max: 0.07,   rate: 0.25 },
  { min: 0.07,   max: 0.09,   rate: 0.28 },
];

const glueRateTable = [
  { min: 0.2,  max: 0.5,  rate: 0.015 },
  { min: 0.51, max: 0.65, rate: 0.020 },
  { min: 0.66, max: 0.8,  rate: 0.025 },
  { min: 0.8,  max: 1.0,  rate: 0.030 },
  { min: 1.0,  max: 1.25, rate: 0.040 },
  { min: 1.26, max: 1.5,  rate: 0.050 },
  { min: 1.51, max: 2.5,  rate: 0.065 },
];

const handlingRateTable = [
  { min: 0.0005, max: 0.0035, rate: 0.015 },
  { min: 0.0036, max: 0.005,  rate: 0.020 },
  { min: 0.0051, max: 0.008,  rate: 0.022 },
  { min: 0.0081, max: 0.015,  rate: 0.025 },
  { min: 0.0151, max: 0.02,   rate: 0.028 },
  { min: 0.02,   max: 0.025,  rate: 0.028 },
  { min: 0.0251, max: 0.03,   rate: 0.030 },
  { min: 0.03,   max: 0.04,   rate: 0.035 },
  { min: 0.04,   max: 0.05,   rate: 0.035 },
  { min: 0.05,   max: 0.06,   rate: 0.040 },
  { min: 0.06,   max: 0.07,   rate: 0.050 },
  { min: 0.07,   max: 0.09,   rate: 0.060 },
];

// ==================== SPOT COLOR COST LOOKUP ====================

function getSpotColorCost(qty, tableKey) {
  const table = spotColorTables[tableKey];
  if (!table) return null;
  for (const row of table) {
    if (qty >= row.min && qty <= row.max) return row.cost;
  }
  return table[table.length - 1].cost;
}

// ==================== UTILITY FUNCTIONS ====================

function findUpperBoundary(qty, table) {
  for (const r of table) {
    if (qty >= r.min && qty <= r.max) return r.max;
  }
  return table[table.length - 1].max;
}

function findRate(qty, table) {
  for (const r of table) {
    if (qty >= r.min && qty <= r.max) return r.rate || r.value;
  }
  return table[table.length - 1].rate || table[table.length - 1].value;
}

function findValue(qty, table) {
  for (const r of table) {
    if (qty >= r.min && qty <= r.max) return r.value;
  }
  return table[table.length - 1].value;
}

function findPaper(name) {
  return paperTypes.find((p) => p.name === name) || paperTypes[0];
}

function customRound(value) {
  return Math.round(value);
}

// ==================== P13: HANDLE COST HELPER ====================

function getHandleInfo(handleTypeId) {
  return handleTypeOptions.find(h => h.id === handleTypeId) || handleTypeOptions[0];
}

// P13 = pricePerPair × qty
// pricePerPair comes from handleTypeOptions based on user's handle selection
function calculateP13(qty, handleTypeId) {
  if (!handleTypeId) return 0;
  const handle = getHandleInfo(handleTypeId);
  return customRound(handle.pricePerPair * qty);
}

// ==================== P14: REINFORCEMENT BOARD COST HELPER ====================
// Formula from Excel:
//   X = width_m (bag width)
//   Y = gusset_m + 0.07  (EB+BB types)  OR  gusset_m  (BB-only for PTH)
//   unitCost = X × Y × gsm × pricePerKg
//   P14 = unitCost × qty

function calculateP14(qty, width_mm, gusset_mm, boardTypeId) {
  if (!boardTypeId || boardTypeId === "nil") return 0;
  const board = reinforcementBoardTypes.find(b => b.id === boardTypeId);
  if (!board || board.gsm === 0) return 0;

  const X = width_mm / 1000;               // width in metres
  const Y = board.ebExtra
    ? (gusset_mm / 1000) + 0.07            // EB+BB: gusset + 0.07m extra
    : (gusset_mm / 1000);                  // BB-only: just gusset

  const unitCost = X * Y * board.gsm * board.pricePerKg;
  return customRound(unitCost * qty);
}

// ==================== P15: CONVERTING LABOR COST HELPER ====================
// Formula from Excel (2026 version):
//   bagVolume   = H × W × G / 1,000,000,000 (m³)
//   glueLength  = H/1000 + 2×(W/1000) + G/1000 - 0.02 (m)
//   convRate    = lookup(bagVolume, convertingRateTable)
//   glueRate    = lookup(glueLength, glueRateTable)
//   handlingRate= lookup(bagVolume, handlingRateTable)
//   ratePerBag2026 = (convRate + glueRate + handlingRate) × 1.1
//   P15 = ROUND(ratePerBag2026 × qty)

function calculateP15(qty, height_mm, width_mm, gusset_mm) {
  // Use gusset = 115 minimum if actual gusset is 0 (from Excel row 745 default D745=115)
  const effectiveGusset = gusset_mm > 0 ? gusset_mm : 115;

  const bagVolume = (height_mm * width_mm * effectiveGusset) / 1_000_000_000; // m³

  const glueLength = (height_mm / 1000) + 2 * (width_mm / 1000) + (effectiveGusset / 1000) - 0.02; // m

  const convRate     = findRate(bagVolume, convertingRateTable);
  const glueRate     = findRate(glueLength, glueRateTable);
  const handlingRate = findRate(bagVolume, handlingRateTable);

  const ratePerBag2026 = (convRate + glueRate + handlingRate) * CONVERTING_YEAR_MULTIPLIER;

  return customRound(ratePerBag2026 * qty);
}

// ==================== LAYOUT CALCULATIONS ====================

function calcSheetSize({ width, height, gusset, layout }) {
  const w = Number(width) / 1000;
  const h = Number(height) / 1000;
  const g = Number(gusset) / 1000;

  let sheetWidth, sheetHeight;

  switch (layout) {
    case "0.5X2Y":
      sheetWidth = 1 * (w + g) + 0.035;
      sheetHeight = 2 * (h + 0.7 * g + 0.055);
      break;
    case "0.5X1Y":
      sheetWidth = w + g + 0.035;
      sheetHeight = h + 0.7 * g + 0.055;
      break;
    case "1X2Y":
      sheetWidth = 2 * (w + g) + 0.035;
      sheetHeight = 2 * (h + 0.7 * g + 0.055);
      break;
    case "1X1Y":
    default:
      sheetWidth = 2 * (w + g) + 0.035;
      sheetHeight = h + 0.7 * g + 0.055;
  }

  return {
    sheetWidth: Number(sheetWidth.toFixed(3)),
    sheetHeight: Number(sheetHeight.toFixed(3))
  };
}

function findSuitableLayouts({ width, height, gusset }) {
  const layouts = ["1X1Y", "0.5X2Y", "0.5X1Y", "1X2Y"];
  const suitableLayouts = [];

  for (const layout of layouts) {
    const { sheetWidth, sheetHeight } = calcSheetSize({ width, height, gusset, layout });
    const validation = validateLayout({ sheetWidth, sheetHeight, layout });

    if (validation.valid) {
      suitableLayouts.push({ layout, sheetWidth, sheetHeight, validation });
    }
  }

  return suitableLayouts;
}

function validateLayout({ sheetWidth, sheetHeight, layout }) {
  const sw = sheetWidth;
  const sh = sheetHeight;

  const ok1x1   = sw >= 0.533 && sw <= 1.025 && sh >= 0.318 && sh <= 0.698;
  const ok05x2y = sw >= 0.318 && sw <= 0.698 && sh >= 0.533 && sh <= 1.025;
  const ok05x1y = (sw >= 0.318 && sw <= 0.698 && sh >= 0.533 && sh <= 1.025) ||
                  (sw >= 0.533 && sw <= 1.025 && sh >= 0.318 && sh <= 0.698);
  const ok1x2y  = (sw >= 0.3  && sw <= 0.698 && sh >= 0.42  && sh <= 1.025) ||
                  (sw >= 0.42  && sw <= 1.025 && sh >= 0.3   && sh <= 0.698);

  switch (layout) {
    case "1X1Y":  return ok1x1   ? { valid: true } : { valid: false, error: "1X1Y layout out of range" };
    case "0.5X2Y":return ok05x2y ? { valid: true } : { valid: false, error: "0.5X2Y layout out of range" };
    case "0.5X1Y":return ok05x1y ? { valid: true } : { valid: false, error: "0.5X1Y layout out of range" };
    case "1X2Y":  return ok1x2y  ? { valid: true } : { valid: false, error: "1X2Y layout out of range" };
    default:      return { valid: true };
  }
}

function validateInput(input) {
  const errors = [];
  if (!input.width  || input.width  < 50  || input.width  > 1000) errors.push("Width must be between 50mm and 1000mm");
  if (!input.height || input.height < 50  || input.height > 1000) errors.push("Height must be between 50mm and 1000mm");
  if (input.gusset == null || input.gusset < 0 || input.gusset > 500) errors.push("Gusset must be between 0mm and 500mm");
  if (!input.quantity || input.quantity < 100 || input.quantity > 1000000) errors.push("Quantity must be between 100 and 1,000,000 pieces");
  if (!input.paperName || !paperTypes.find((p) => p.name === input.paperName)) errors.push("Invalid paper type selected");
  if (!input.printingOption || !printingConfigs[input.printingOption]) errors.push("Invalid printing option selected");
  return errors;
}

function getBagsPerSheet(layout) {
  switch (layout) {
    case "1X1Y":  return 1;
    case "0.5X2Y":return 1;
    case "0.5X1Y":return 0.5;
    case "1X2Y":  return 2;
    default:      return 1;
  }
}

function getEquivalentQuantityForWastage(quantity, layout) {
  return quantity / getBagsPerSheet(layout);
}

// ==================== VARNISH HELPERS ====================

function calculateOPVCost(sheetWidth, sheetHeight, sheetsNeeded) {
  return (sheetWidth * sheetHeight * 1550 * sheetsNeeded * 0.0000015 * 40) + (sheetsNeeded * 0.03);
}

function calculateWBCost(sheetWidth, sheetHeight, sheetsNeeded) {
  return sheetWidth * sheetHeight * 1550 * 0.00008 * sheetsNeeded;
}

// ==================== SINGLE LAYOUT CALCULATION ====================

function calculateForLayout(input, layout) {
  const qty = Number(input.quantity);
  const paper = findPaper(input.paperName);

  const { sheetWidth, sheetHeight } = calcSheetSize({
    width: input.width, height: input.height, gusset: input.gusset, layout
  });

  const bagsPerSheet = getBagsPerSheet(layout);
  const equivalentQtyForWastage = getEquivalentQuantityForWastage(qty, layout);
  const sheetsNeeded = qty / bagsPerSheet;

  // --- P1: PAPER COST ---
  const printWastage = findValue(equivalentQtyForWastage, printWastageTable);
  const paperWastage = findValue(equivalentQtyForWastage, paperWastageTable);
  const paperArea = sheetWidth * sheetHeight;
  const totalPaperWeight = paperArea * paper.gsm * sheetsNeeded * (1 + printWastage + paperWastage);
  const P1 = customRound(totalPaperWeight * paper.pricePerKg);

  // --- P2: PRINTING COST ---
  const printingOption = input.printingOption;
  const config = printingConfigs[printingOption];
  let P2 = 0;

  if (config.useSpotTable && config.tableKey) {
    const spotCost = getSpotColorCost(equivalentQtyForWastage, config.tableKey);
    if (spotCost !== null) {
      P2 = customRound(spotCost);
      if (printingOption === "5c=process 4cx0c+1c spot 33%" || printingOption === "6c=process 4cx0c+2c spot 33%") {
        const printingRate = findRate(equivalentQtyForWastage, printingRateTable);
        const upperBoundaryQty = findUpperBoundary(equivalentQtyForWastage, printingRateTable);
        const processCost = config.processColors * printingRate * upperBoundaryQty;
        P2 = customRound(P2 + processCost);
      }
    } else {
      const printingRate = findRate(equivalentQtyForWastage, printingRateTable);
      const upperBoundaryQty = findUpperBoundary(equivalentQtyForWastage, printingRateTable);
      const processCost = config.processColors * printingRate * upperBoundaryQty;
      const spotCostCalc = config.spotColors * printingRate * 1.2 * upperBoundaryQty;
      P2 = customRound(processCost + spotCostCalc);
    }
  } else {
    const printingRate = findRate(equivalentQtyForWastage, printingRateTable);
    const upperBoundaryQty = findUpperBoundary(equivalentQtyForWastage, printingRateTable);
    const processCost = config.processColors * printingRate * upperBoundaryQty;
    const spotCostCalc = config.spotColors * printingRate * 1.2 * upperBoundaryQty;
    P2 = customRound(processCost + spotCostCalc);
  }

  // --- P3: PLATE COST ---
  const P3 = customRound(config.plateCost || 0);

  // --- P4: INK COST ---
  const coverage = coverageMap[printingOption] || 0;
  const inkWeight = sheetWidth * sheetHeight * 1550 * coverage * sheetsNeeded * 0.000002;
  let roundedInkKg;
  if (inkWeight >= 0.01 && inkWeight <= 2) roundedInkKg = 2;
  else roundedInkKg = Math.ceil(inkWeight);
  const inkType = input.inkType || "normal";
  const inkPrice = inkPrices[inkType] || inkPrices.normal;
  const P4 = customRound(roundedInkKg * inkPrice);

  // --- P5: PROTECTION VARNISH ---
  let P5 = 0;
  const varnish = input.varnish || "None";
  if (varnish !== "None") {
    const opvCostWithMin = Math.max(100, Math.ceil(calculateOPVCost(sheetWidth, sheetHeight, sheetsNeeded)));
    const wbCostWithMin  = Math.max(100, Math.ceil(calculateWBCost(sheetWidth, sheetHeight, sheetsNeeded)));
    P5 = customRound((opvCostWithMin + wbCostWithMin) / 2);
  }

  // --- P6: LAMINATION ---
  let P6 = 0;
  const lamination = input.lamination || "None";
  if (lamination !== "None" && lamination !== "Plain without Lamination") {
    const glossCostWithMin = Math.max(50, customRound(sheetWidth * sheetHeight * 1550 * 0.0004  * sheetsNeeded));
    const mattCostWithMin  = Math.max(50, customRound(sheetWidth * sheetHeight * 1550 * 0.00042 * sheetsNeeded));
    P6 = customRound((glossCostWithMin + mattCostWithMin) / 2);
  }

  // --- P7: SPOT UV ---
  let P7 = 0;
  if (input.spotUV === true) {
    const baseSpotUVCost = sheetWidth * sheetHeight * 1550 * 0.00045 * sheetsNeeded;
    P7 = customRound(Math.max(100, customRound(baseSpotUVCost)));
  }

  // --- P8: STAMPING ---
  let P8 = 0;
  if (input.stamping === true && input.stampingSize) {
    const [stampingHeight, stampingWidth] = input.stampingSize.split('x').map(v => parseFloat(v));
    const widthIn  = (stampingWidth  / 25.4) + 0.5;
    const heightIn = (stampingHeight / 25.4) + 0.5;
    const areaIn2  = widthIn * heightIn;
    const areaCm2  = (stampingWidth / 10) * (stampingHeight / 10);

    const foilRates = {
      gold: 0.0015, silver: 0.0015,
      matt_gold: 0.0025, matt_silver: 0.0025,
      copper: 0.0025, black: 0.0025, red: 0.0025,
      green: 0.0025, blue: 0.0025, maroon: 0.0025,
      special: 0.0030, white: 0.0040, rainbow: 0.0040, hologram: 0.0035
    };
    const rate = foilRates[input.foilType] || 0.0025;

    const stampingTiers = [
      { min: 100,    max: 199,    mult: 6.0,  minTotal: 0   },
      { min: 200,    max: 299,    mult: 4.0,  minTotal: 0   },
      { min: 300,    max: 399,    mult: 2.2,  minTotal: 0   },
      { min: 400,    max: 499,    mult: 1.8,  minTotal: 0   },
      { min: 500,    max: 999,    mult: 1.6,  minTotal: 0   },
      { min: 1000,   max: 1999,   mult: 1.5,  minTotal: 120 },
      { min: 2000,   max: 2999,   mult: 1.3,  minTotal: 120 },
      { min: 3000,   max: 3999,   mult: 1.0,  minTotal: 120 },
      { min: 4000,   max: 4999,   mult: 1.0,  minTotal: 160 },
      { min: 5000,   max: 6999,   mult: 0.95, minTotal: 160 },
      { min: 7000,   max: 9999,   mult: 0.90, minTotal: 160 },
      { min: 10000,  max: 14999,  mult: 0.85, minTotal: 200 },
      { min: 15000,  max: 19999,  mult: 0.80, minTotal: 200 },
      { min: 20000,  max: 29999,  mult: 0.78, minTotal: 200 },
      { min: 30000,  max: 49999,  mult: 0.76, minTotal: 200 },
      { min: 50000,  max: 74999,  mult: 0.74, minTotal: 200 },
      { min: 75000,  max: 99999,  mult: 0.72, minTotal: 200 },
      { min: 100000, max: 149999, mult: 0.70, minTotal: 200 },
      { min: 150000, max: 199999, mult: 0.68, minTotal: 200 },
      { min: 200000, max: 399999, mult: 0.66, minTotal: 200 },
      { min: 400000, max: 1000000,mult: 0.63, minTotal: 200 },
    ];

    const tier = stampingTiers.find(r => qty >= r.min && qty <= r.max) || { mult: 1.0, minTotal: 0 };
    const blockCharge  = Math.max(0.25 * areaCm2, 30);
    const mylarCost    = Math.max(0.08 * areaIn2, 30);
    const stampingUnit = rate * areaIn2 * tier.mult * 2;
    const stampingCost = Math.max(stampingUnit * qty, tier.minTotal);
    P8 = Math.round(stampingCost + blockCharge + mylarCost);
  }

  // --- P9: EMBOSSING ---
  let P9 = 0;
  if (input.embossed === true && input.embossSize) {
    const [embossHeight, embossWidth] = input.embossSize.split('x').map(v => parseFloat(v));
    const heightCm = (embossHeight / 10) + 1;
    const widthCm  = (embossWidth  / 10) + 1;
    const areaCm2  = heightCm * widthCm;
    const blockCost = input.embossType === "3D" ? areaCm2 * 5 : areaCm2 * 0.35;

    const impressionRateTiers = [
      { min: 100,    max: 199,    rate: 0.600 },
      { min: 200,    max: 299,    rate: 0.360 },
      { min: 300,    max: 399,    rate: 0.280 },
      { min: 400,    max: 499,    rate: 0.250 },
      { min: 500,    max: 999,    rate: 0.160 },
      { min: 1000,   max: 1999,   rate: 0.140 },
      { min: 2000,   max: 2999,   rate: 0.080 },
      { min: 3000,   max: 4999,   rate: 0.070 },
      { min: 5000,   max: 6999,   rate: 0.060 },
      { min: 7000,   max: 9999,   rate: 0.056 },
      { min: 10000,  max: 19999,  rate: 0.056 },
      { min: 20000,  max: 29999,  rate: 0.050 },
      { min: 30000,  max: 39999,  rate: 0.049 },
      { min: 40000,  max: 49999,  rate: 0.048 },
      { min: 50000,  max: 1000000,rate: 0.040 },
    ];

    let impressionRate = 0.600;
    for (const tier of impressionRateTiers) {
      if (qty >= tier.min && qty <= tier.max) { impressionRate = tier.rate; break; }
    }
    P9 = Math.max(80, Math.round(blockCost + impressionRate * qty));
  }

  // --- P10: TEXTURE EMBOSSING ---
  let P10 = 0;
  if (input.textureEmboss === true && input.textureType === "custom") {
    const actualQtyTextured = qty / bagsPerSheet;
    const baseRate = 0.05;
    if      (actualQtyTextured >= 100   && actualQtyTextured <= 1999)  P10 = 100;
    else if (actualQtyTextured >= 2000  && actualQtyTextured <= 9999)  P10 = Math.round(actualQtyTextured * baseRate * 1.0);
    else if (actualQtyTextured >= 10000 && actualQtyTextured <= 49999) P10 = Math.round(actualQtyTextured * baseRate * 0.9);
    else if (actualQtyTextured >= 50000)                               P10 = Math.round(actualQtyTextured * baseRate * 0.85);
  }

  // --- P11: DIE CUT ---
  let P11 = 0;
  if (input.dieCut === true) {
    const actualQtyDieCut = qty / bagsPerSheet;
    const baseRate = 0.05;
    if (actualQtyDieCut >= 100 && actualQtyDieCut <= 1999) {
      P11 = 90;
    } else if (actualQtyDieCut >= 2000 && actualQtyDieCut <= 9999) {
      const mult = (qty === 1000 || layout === "1X2Y") ? 1.0 : 0.9;
      P11 = Math.round(actualQtyDieCut * baseRate * mult);
    } else if (actualQtyDieCut >= 10000 && actualQtyDieCut <= 49999) {
      const mult = (qty === 1000 || layout === "1X2Y") ? 0.9 : 0.8;
      P11 = Math.round(actualQtyDieCut * baseRate * mult);
    } else if (actualQtyDieCut >= 50000) {
      const mult = (qty === 1000 || layout === "1X2Y") ? 0.85 : 0.7;
      P11 = Math.round(actualQtyDieCut * baseRate * mult);
    }
  }

  // --- P12: DIE CUT MOULDING ---
  let P12 = 0;
  if (input.newMould === true) {
    const w = input.width  / 1000;
    const h = input.height / 1000;
    const g = input.gusset / 1000;
    const p12_1X = 2 * (w + g) + 0.035;
    const p12_1Y = h + 0.7 * g + 0.015 + 0.055;
    const [, yPart] = layout.split('X');
    const yMult = parseFloat(yPart.replace('Y', ''));
    const dieHeight = p12_1X * 3 * yMult;
    const dieWidth  = p12_1Y * 6 * yMult;
    const creaseCost = (dieWidth + dieHeight) * 30;
    const basePlywood = (p12_1X * p12_1Y * 100) + 5;
    const plywoodMult = layout === "1X2Y" ? 2 : layout === "0.5X1Y" ? 0.5 : 1;
    P12 = Math.round(creaseCost + basePlywood * plywoodMult);
  } else if (input.existingMould === true) {
    P12 = 80;
  }

  // ==================== P13: HANDLES COST (UPDATED) ====================
  // Formula: pricePerPair (RM) × qty
  // pricePerPair varies by handle type selected by user
  let P13 = 0;
  if (input.handles === true && input.handleType) {
    P13 = calculateP13(qty, input.handleType);
  }

  // ==================== P14: REINFORCEMENT BOARD (UPDATED) ====================
  // Formula: boardWidth_m × boardHeight_m × gsm × pricePerKg × qty
  // boardHeight = gusset_m + 0.07 (EB+BB types) or gusset_m (BB-only for PTH handles)
  // User selects board grade; system auto-selects dimensions from bag size
  let P14 = 0;
  if (input.reinforcementBoard === true && input.boardType) {
    P14 = calculateP14(qty, input.width, input.gusset, input.boardType);
  }

  // ==================== P15: CONVERTING LABOR (UPDATED) ====================
  // Formula: (convertingRate + glueRate + handlingRate) × 1.1 (2026 uplift) × qty
  // All rates looked up by bag volume (m³) and glue length (m), derived from H×W×G
  let P15 = 0;
  if (input.convertingLabor === true) {
    P15 = calculateP15(qty, input.height, input.width, input.gusset);
  }

  // --- P16: PACKAGING ---
  const P16 = customRound(input.packaging ? 0.04 * qty : 0);

  // --- P17: LOGISTICS ---
  let P17 = qty <= 3000 ? 250 : qty <= 4000 ? 300 : 350;
  P17 = customRound(P17);

  // --- P18: MOCK UP ---
  const P18 = customRound(input.mockUp ? 40 : 0);

  const totalCost = P1+P2+P3+P4+P5+P6+P7+P8+P9+P10+P11+P12+P13+P14+P15+P16+P17+P18;
  const unitCost = totalCost / qty;
  const marginIndex = Number(input.marginIndex || 0.63);
  const unitSellingPrice = unitCost / marginIndex;
  const totalSellingPrice = unitSellingPrice * qty;

  return {
    layout,
    sheetSize: { width: sheetWidth, height: sheetHeight },
    bagsPerSheet,
    sheetsNeeded,
    costs: {
      P1: customRound(P1),
      P2: customRound(P2),
      P3: customRound(P3),
      P4: customRound(P4),
      P5: customRound(P5),
      P6: customRound(P6),
      P7: customRound(P7),
      P8: customRound(P8),
      P9: customRound(P9),
      P10: customRound(P10),
      P11: customRound(P11),
      P12: customRound(P12),
      P13: customRound(P13),
      P14: customRound(P14),
      P15: customRound(P15),
      P16: customRound(P16),
      P17: customRound(P17),
      P18: customRound(P18),
    },
    summary: {
      totalCost: customRound(totalCost),
      unitCost: Number(unitCost.toFixed(4)),
      unitSellingPrice: Number(unitSellingPrice.toFixed(4)),
      totalSellingPrice: customRound(totalSellingPrice)
    }
  };
}

// ==================== COMPLETE CALCULATION ENGINE ====================

export function calculateQuotation(input) {
  const validationErrors = validateInput(input);
  if (validationErrors.length > 0) {
    throw new Error(`Input validation failed: ${validationErrors.join(', ')}`);
  }

  const suitableLayouts = findSuitableLayouts({
    width: input.width, height: input.height, gusset: input.gusset
  });

  if (suitableLayouts.length === 0) {
    throw new Error("No suitable layout found for the given dimensions. Please adjust the bag size.");
  }

  const layoutCalculations = suitableLayouts.map(layoutInfo =>
    calculateForLayout({ ...input, layout: layoutInfo.layout }, layoutInfo.layout)
  );

  let finalResult;
  if (layoutCalculations.length === 1) {
    finalResult = layoutCalculations[0];
  } else {
    const avgCosts = {};
    const costKeys = Object.keys(layoutCalculations[0].costs);
    for (const key of costKeys) {
      avgCosts[key] = Number(
        (layoutCalculations.reduce((sum, c) => sum + c.costs[key], 0) / layoutCalculations.length).toFixed(2)
      );
    }
    const avgTotal  = layoutCalculations.reduce((s,c) => s + c.summary.totalCost, 0) / layoutCalculations.length;
    const avgUnit   = layoutCalculations.reduce((s,c) => s + c.summary.unitCost, 0) / layoutCalculations.length;
    const avgUSP    = layoutCalculations.reduce((s,c) => s + c.summary.unitSellingPrice, 0) / layoutCalculations.length;
    const avgTSP    = layoutCalculations.reduce((s,c) => s + c.summary.totalSellingPrice, 0) / layoutCalculations.length;

    finalResult = {
      layout: "AUTO_SELECTED_AVERAGE",
      sheetSize: { width: "Multiple", height: "Multiple",
        details: layoutCalculations.map(c => ({ layout: c.layout, sheetSize: c.sheetSize }))
      },
      bagsPerSheet: "Multiple",
      sheetsNeeded: "Multiple",
      costs: avgCosts,
      summary: {
        totalCost: Number(avgTotal.toFixed(2)),
        unitCost: Number(avgUnit.toFixed(4)),
        unitSellingPrice: Number(avgUSP.toFixed(4)),
        totalSellingPrice: Number(avgTSP.toFixed(2))
      },
      allLayouts: layoutCalculations
    };
  }

  const marginIndex = Number(input.marginIndex || 0.63);

  return {
    input: {
      dimensions: { width: input.width, height: input.height, gusset: input.gusset },
      paper: input.paperName,
      printing: input.printingOption,
      quantity: Number(input.quantity),
      finishing: {
        varnish: input.varnish || "None",
        lamination: input.lamination || "None",
        spotUV: input.spotUV || false,
        stamping: input.stamping || false,
        embossing: input.embossing || false,
        textureEmbossing: input.textureEmbossing || false,
        dieCut: input.dieCut || false,
        dcMoulding: input.dcMoulding || "None"
      }
    },
    layoutSelection: {
      suitableLayouts: suitableLayouts.map(l => l.layout),
      selectedLayout: finalResult.layout,
      allLayoutDetails: suitableLayouts
    },
    calculations: finalResult,
    summary: { ...finalResult.summary, marginIndex },
    validation: {
      layout: { valid: true, suitableCount: suitableLayouts.length },
      input:  { valid: true, errors: [] }
    }
  };
}

// ==================== HELPER EXPORTS ====================

export function getPaperTypes() {
  return paperTypes.map(p => ({ name: p.name, gsm: p.gsm, pricePerKg: p.pricePerKg }));
}

export function getPrintingOptions() {
  return Object.keys(printingConfigs).map(key => ({
    name: key,
    processColors: printingConfigs[key].processColors,
    spotColors: printingConfigs[key].spotColors
  }));
}

export function getMarginIndices() {
  return [0.63, 0.675, 0.7, 0.72, 0.74, 0.75, 0.775, 0.8, 0.82, 0.84, 0.86, 0.88, 0.89, 0.9];
}

export function getHandleTypes() {
  return handleTypeOptions;
}

export function getReinforcementBoardTypes() {
  return reinforcementBoardTypes;
}

export function validateQuotationInput(input) {
  return validateInput(input);
}

// CommonJS support
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    calculateQuotation,
    getPaperTypes,
    getPrintingOptions,
    getMarginIndices,
    getHandleTypes,
    getReinforcementBoardTypes,
    validateQuotationInput
  };
}