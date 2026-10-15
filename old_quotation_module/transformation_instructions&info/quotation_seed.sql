-- Seed generated from the values in the original quotation.js. Run AFTER quotation_schema.sql.
-- Creates ONE active rate version.

INSERT INTO quotation_rate_versions (version_label,status,notes,published_at) VALUES ('2026 Rate Card (migrated from quotation.js)','active','Initial import of hardcoded values',NOW());
SET @v = LAST_INSERT_ID();

-- PARAMETERS
INSERT INTO quotation_parameters (version_id,param_key,group_code,label,value_type,value_number,value_text,unit,used_by,description,is_locked,sort_order) VALUES
(@v,'input_width_min','input','Bag width min','number',50,NULL,'mm','validation',NULL,0,0),
(@v,'input_width_max','input','Bag width max','number',1000,NULL,'mm','validation',NULL,0,1),
(@v,'input_height_min','input','Bag height min','number',50,NULL,'mm','validation',NULL,0,2),
(@v,'input_height_max','input','Bag height max','number',1000,NULL,'mm','validation',NULL,0,3),
(@v,'input_gusset_min','input','Gusset min','number',0,NULL,'mm','validation',NULL,0,4),
(@v,'input_gusset_max','input','Gusset max','number',500,NULL,'mm','validation',NULL,0,5),
(@v,'input_quantity_min','input','Quantity min','number',100,NULL,'pcs','validation',NULL,0,6),
(@v,'input_quantity_max','input','Quantity max','number',1000000,NULL,'pcs','validation',NULL,0,7),
(@v,'input_foil_size_min','input','Stamping/embossing size min','number',10,NULL,'mm','validation',NULL,0,8),
(@v,'input_foil_size_max','input','Stamping/embossing size max','number',500,NULL,'mm','validation',NULL,0,9),
(@v,'sheet_edge_allowance_m','layout','Sheet width allowance (gripper/trim)','number',0.035,NULL,'m','P1-P7,P12','Added to sheet width',0,10),
(@v,'sheet_height_allowance_m','layout','Sheet height allowance per bag','number',0.055,NULL,'m','P1-P7,P12',NULL,0,11),
(@v,'sheet_gusset_height_factor','layout','Gusset factor in sheet height','number',0.7,NULL,'x','P1-P7,P12','sheet height = h + factor*gusset + allowance',0,12),
(@v,'layout_selection_mode','layout','Multi-layout result mode','text',NULL,'average',NULL,'summary','average = mean of all suitable layouts (current behaviour); cheapest = lowest unit cost; first = first suitable layout',0,13),
(@v,'sqm_to_sqin','layout','Square inch per square metre','number',1550,NULL,'sq in/m2','P1,P4-P7','Unit conversion - do not change',1,14),
(@v,'spot_over_process_factor','printing','Spot colour cost factor vs process rate','number',1.2,NULL,'x','P2',NULL,0,15),
(@v,'ink_coverage_factor','ink','Ink usage factor','number',0.000002,NULL,'kg/sq in','P4',NULL,0,16),
(@v,'ink_min_kg','ink','Minimum ink order','number',2,NULL,'kg','P4',NULL,0,17),
(@v,'ink_min_trigger_low','ink','Ink minimum applies from (kg used)','number',0.01,NULL,'kg','P4',NULL,0,18),
(@v,'ink_min_trigger_high','ink','Ink minimum applies up to (kg used)','number',2,NULL,'kg','P4','Above this, kg is rounded up to a whole number',0,19),
(@v,'varnish_pricing_mode','varnish','Varnish pricing mode','text',NULL,'average',NULL,'P5','average = average of all varnish options (current behaviour); selected = use the option the user picked',0,20),
(@v,'varnish_min_cost','varnish','Varnish minimum per method','number',100,NULL,'RM','P5',NULL,0,21),
(@v,'lamination_pricing_mode','lamination','Lamination pricing mode','text',NULL,'average',NULL,'P6','average = average of Gloss and Matt (current behaviour); selected = use the option picked',0,22),
(@v,'lamination_min_cost','lamination','Lamination minimum per method','number',50,NULL,'RM','P6',NULL,0,23),
(@v,'spotuv_rate_per_sqin','spotuv','Spot UV rate','number',0.00045,NULL,'RM/sq in','P7',NULL,0,24),
(@v,'spotuv_min_cost','spotuv','Spot UV minimum','number',100,NULL,'RM','P7',NULL,0,25),
(@v,'stamp_area_padding_in','stamping','Foil area padding','number',0.5,NULL,'in','P8',NULL,0,26),
(@v,'mm_per_inch','stamping','mm per inch','number',25.4,NULL,'mm','P8',NULL,1,27),
(@v,'stamp_block_rate_per_cm2','stamping','Block charge rate','number',0.25,NULL,'RM/cm2','P8',NULL,0,28),
(@v,'stamp_block_min','stamping','Block charge minimum','number',30,NULL,'RM','P8',NULL,0,29),
(@v,'stamp_mylar_rate_per_sqin','stamping','Mylar cost rate','number',0.08,NULL,'RM/sq in','P8',NULL,0,30),
(@v,'stamp_mylar_min','stamping','Mylar cost minimum','number',30,NULL,'RM','P8',NULL,0,31),
(@v,'stamp_unit_factor','stamping','Stamping unit cost multiplier','number',2,NULL,'x','P8',NULL,0,32),
(@v,'stamp_default_foil_rate','stamping','Fallback foil rate','number',0.0025,NULL,'RM/sq in','P8',NULL,0,33),
(@v,'emboss_area_padding_cm','embossing','Emboss area padding','number',1,NULL,'cm','P9',NULL,0,34),
(@v,'emboss_min_total','embossing','Embossing minimum total','number',80,NULL,'RM','P9',NULL,0,35),
(@v,'texture_base_rate','texture','Texture base rate per sheet','number',0.05,NULL,'RM','P10',NULL,0,36),
(@v,'diecut_base_rate','diecut','Die cut base rate per sheet','number',0.05,NULL,'RM','P11',NULL,0,37),
(@v,'diecut_special_qty','diecut','Quantity that gets the "special" multiplier','number',1000,NULL,'pcs','P11','qty == this OR layout flagged efficient => value2 multiplier, otherwise value3',0,38),
(@v,'mould_existing_fee','mould','Existing mould fee','number',80,NULL,'RM','P12',NULL,0,39),
(@v,'mould_extra_height_m','mould','Mould extra height','number',0.015,NULL,'m','P12',NULL,0,40),
(@v,'mould_height_crease_factor','mould','Crease factor (height)','number',3,NULL,'x','P12',NULL,0,41),
(@v,'mould_width_crease_factor','mould','Crease factor (width)','number',6,NULL,'x','P12',NULL,0,42),
(@v,'mould_crease_rate','mould','Crease rule rate','number',30,NULL,'RM/m','P12',NULL,0,43),
(@v,'mould_plywood_rate','mould','Plywood rate','number',100,NULL,'RM/m2','P12',NULL,0,44),
(@v,'mould_plywood_base','mould','Plywood base fee','number',5,NULL,'RM','P12',NULL,0,45),
(@v,'board_eb_extra_m','board','EB extra board height','number',0.07,NULL,'m','P14',NULL,0,46),
(@v,'converting_year_multiplier','converting','Annual rate uplift','number',1.1,NULL,'x','P15','2026 uplift',0,47),
(@v,'converting_default_gusset_mm','converting','Gusset used when gusset = 0','number',115,NULL,'mm','P15',NULL,0,48),
(@v,'converting_glue_deduction_m','converting','Glue length deduction','number',0.02,NULL,'m','P15',NULL,0,49),
(@v,'packaging_cost_per_unit','packaging','Packaging cost per bag','number',0.04,NULL,'RM','P16',NULL,0,50),
(@v,'mockup_cost','other','Mock-up flat cost','number',40,NULL,'RM','P18',NULL,0,51),
(@v,'margin_default_index','margin','Fallback margin index','number',0.63,NULL,'x','summary','Used when no margin index supplied. selling = cost / index',0,52);

-- TIER SETS
INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description) VALUES (@v,'print_wastage','Print wastage (fraction)','equivalent_qty','wastage',NULL,NULL,'first_row','P1',NULL);
SET @ts = LAST_INSERT_ID();
INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3) VALUES
(@ts,100,199,2,NULL,NULL),
(@ts,200,299,1,NULL,NULL),
(@ts,300,399,0.7,NULL,NULL),
(@ts,400,499,0.5,NULL,NULL),
(@ts,500,599,0.45,NULL,NULL),
(@ts,600,699,0.4,NULL,NULL),
(@ts,700,799,0.35,NULL,NULL),
(@ts,800,899,0.32,NULL,NULL),
(@ts,900,999,0.3,NULL,NULL),
(@ts,1000,1200,0.28,NULL,NULL),
(@ts,1201,1400,0.26,NULL,NULL),
(@ts,1401,1600,0.24,NULL,NULL),
(@ts,1601,1800,0.22,NULL,NULL),
(@ts,1801,2000,0.2,NULL,NULL),
(@ts,2001,2500,0.18,NULL,NULL),
(@ts,2501,3000,0.16,NULL,NULL),
(@ts,3001,4000,0.14,NULL,NULL),
(@ts,4001,5000,0.12,NULL,NULL),
(@ts,5001,6000,0.1,NULL,NULL),
(@ts,6001,7000,0.085,NULL,NULL),
(@ts,7001,8000,0.075,NULL,NULL),
(@ts,8001,9000,0.065,NULL,NULL),
(@ts,9001,10000,0.06,NULL,NULL),
(@ts,10001,12000,0.055,NULL,NULL),
(@ts,12001,15000,0.05,NULL,NULL),
(@ts,15001,20000,0.045,NULL,NULL),
(@ts,20001,25000,0.042,NULL,NULL),
(@ts,25001,30000,0.04,NULL,NULL),
(@ts,30001,40000,0.035,NULL,NULL),
(@ts,40001,50000,0.03,NULL,NULL),
(@ts,50001,60000,0.03,NULL,NULL),
(@ts,60001,70000,0.03,NULL,NULL),
(@ts,70001,80000,0.03,NULL,NULL),
(@ts,80001,90000,0.03,NULL,NULL),
(@ts,90001,100000,0.03,NULL,NULL),
(@ts,100001,150000,0.03,NULL,NULL),
(@ts,150001,200000,0.03,NULL,NULL),
(@ts,200001,250000,0.03,NULL,NULL),
(@ts,250001,300000,0.03,NULL,NULL),
(@ts,300001,350000,0.03,NULL,NULL),
(@ts,350001,425000,0.03,NULL,NULL),
(@ts,425001,500000,0.03,NULL,NULL),
(@ts,500001,600000,0.03,NULL,NULL),
(@ts,600001,700000,0.03,NULL,NULL),
(@ts,700001,800000,0.03,NULL,NULL),
(@ts,800001,900000,0.03,NULL,NULL),
(@ts,900001,1000000,0.03,NULL,NULL);

INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description) VALUES (@v,'paper_wastage','Paper wastage (fraction)','equivalent_qty','wastage',NULL,NULL,'first_row','P1',NULL);
SET @ts = LAST_INSERT_ID();
INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3) VALUES
(@ts,100,199,0.3,NULL,NULL),
(@ts,200,299,0.29,NULL,NULL),
(@ts,300,399,0.28,NULL,NULL),
(@ts,400,499,0.27,NULL,NULL),
(@ts,500,599,0.25,NULL,NULL),
(@ts,600,699,0.23,NULL,NULL),
(@ts,700,799,0.21,NULL,NULL),
(@ts,800,899,0.2,NULL,NULL),
(@ts,900,999,0.19,NULL,NULL),
(@ts,1000,1200,0.18,NULL,NULL),
(@ts,1201,1400,0.16,NULL,NULL),
(@ts,1401,1600,0.14,NULL,NULL),
(@ts,1601,1800,0.13,NULL,NULL),
(@ts,1801,2000,0.12,NULL,NULL),
(@ts,2001,2500,0.1,NULL,NULL),
(@ts,2501,3000,0.09,NULL,NULL),
(@ts,3001,4000,0.08,NULL,NULL),
(@ts,4001,5000,0.07,NULL,NULL),
(@ts,5001,6000,0.06,NULL,NULL),
(@ts,6001,7000,0.05,NULL,NULL),
(@ts,7001,8000,0.05,NULL,NULL),
(@ts,8001,9000,0.05,NULL,NULL),
(@ts,9001,10000,0.05,NULL,NULL),
(@ts,10001,12000,0.05,NULL,NULL),
(@ts,12001,15000,0.05,NULL,NULL),
(@ts,15001,20000,0.047,NULL,NULL),
(@ts,20001,25000,0.047,NULL,NULL),
(@ts,25001,30000,0.045,NULL,NULL),
(@ts,30001,40000,0.04,NULL,NULL),
(@ts,40001,50000,0.035,NULL,NULL),
(@ts,50001,60000,0.03,NULL,NULL),
(@ts,60001,70000,0.03,NULL,NULL),
(@ts,70001,80000,0.03,NULL,NULL),
(@ts,80001,90000,0.03,NULL,NULL),
(@ts,90001,100000,0.03,NULL,NULL),
(@ts,100001,150000,0.03,NULL,NULL),
(@ts,150001,200000,0.03,NULL,NULL),
(@ts,200001,250000,0.03,NULL,NULL),
(@ts,250001,300000,0.03,NULL,NULL),
(@ts,300001,350000,0.03,NULL,NULL),
(@ts,350001,425000,0.03,NULL,NULL),
(@ts,425001,500000,0.03,NULL,NULL),
(@ts,500001,600000,0.03,NULL,NULL),
(@ts,600001,700000,0.03,NULL,NULL),
(@ts,700001,800000,0.03,NULL,NULL),
(@ts,800001,900000,0.03,NULL,NULL),
(@ts,900001,1000000,0.03,NULL,NULL);

INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description) VALUES (@v,'printing_rate','Printing rate per colour per sheet','equivalent_qty','rate',NULL,NULL,'first_row','P2','Cost = colours x rate x range_max of the tier');
SET @ts = LAST_INSERT_ID();
INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3) VALUES
(@ts,100,199,0.3,NULL,NULL),
(@ts,200,299,0.2,NULL,NULL),
(@ts,300,399,0.145,NULL,NULL),
(@ts,400,499,0.115,NULL,NULL),
(@ts,500,599,0.104,NULL,NULL),
(@ts,600,699,0.089,NULL,NULL),
(@ts,700,799,0.081,NULL,NULL),
(@ts,800,899,0.073,NULL,NULL),
(@ts,900,999,0.065,NULL,NULL),
(@ts,1000,1200,0.058,NULL,NULL),
(@ts,1201,1400,0.05,NULL,NULL),
(@ts,1401,1600,0.044,NULL,NULL),
(@ts,1601,1800,0.039,NULL,NULL),
(@ts,1801,2000,0.036,NULL,NULL),
(@ts,2001,2500,0.03,NULL,NULL),
(@ts,2501,3000,0.027,NULL,NULL),
(@ts,3001,4000,0.022,NULL,NULL),
(@ts,4001,5000,0.02,NULL,NULL),
(@ts,5001,6000,0.02,NULL,NULL),
(@ts,6001,7000,0.02,NULL,NULL),
(@ts,7001,8000,0.019,NULL,NULL),
(@ts,8001,9000,0.019,NULL,NULL),
(@ts,9001,10000,0.019,NULL,NULL),
(@ts,10001,12000,0.018,NULL,NULL),
(@ts,12001,15000,0.018,NULL,NULL),
(@ts,15001,20000,0.017,NULL,NULL),
(@ts,20001,25000,0.017,NULL,NULL),
(@ts,25001,30000,0.016,NULL,NULL),
(@ts,30001,40000,0.015,NULL,NULL),
(@ts,40001,50000,0.014,NULL,NULL),
(@ts,50001,60000,0.013,NULL,NULL),
(@ts,60001,70000,0.012,NULL,NULL),
(@ts,70001,80000,0.012,NULL,NULL),
(@ts,80001,90000,0.011,NULL,NULL),
(@ts,90001,100000,0.0105,NULL,NULL),
(@ts,100001,150000,0.01,NULL,NULL),
(@ts,150001,200000,0.01,NULL,NULL),
(@ts,200001,250000,0.0095,NULL,NULL),
(@ts,250001,300000,0.0093,NULL,NULL),
(@ts,300001,350000,0.0092,NULL,NULL),
(@ts,350001,425000,0.0091,NULL,NULL),
(@ts,425001,500000,0.0091,NULL,NULL),
(@ts,500001,600000,0.009,NULL,NULL),
(@ts,600001,700000,0.009,NULL,NULL),
(@ts,700001,800000,0.009,NULL,NULL),
(@ts,800001,900000,0.0089,NULL,NULL),
(@ts,900001,1000000,0.0085,NULL,NULL);

INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description) VALUES (@v,'spot_cost_1','Spot colour cost - 1 spot','equivalent_qty','cost',NULL,NULL,'first_row','P2',NULL);
SET @ts = LAST_INSERT_ID();
INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3) VALUES
(@ts,100,199,59.7,NULL,NULL),
(@ts,200,299,59.8,NULL,NULL),
(@ts,300,399,59.85,NULL,NULL),
(@ts,400,499,59.88,NULL,NULL),
(@ts,500,599,59.9,NULL,NULL),
(@ts,600,699,69.9,NULL,NULL),
(@ts,700,799,71.91,NULL,NULL),
(@ts,800,899,71.92,NULL,NULL),
(@ts,900,999,74.93,NULL,NULL),
(@ts,1000,1200,78,NULL,NULL),
(@ts,1201,1400,88.2,NULL,NULL),
(@ts,1401,1600,92.8,NULL,NULL),
(@ts,1601,1800,90,NULL,NULL),
(@ts,1801,2000,100,NULL,NULL),
(@ts,2001,2500,125,NULL,NULL),
(@ts,2501,3000,142.5,NULL,NULL),
(@ts,3001,4000,190,NULL,NULL),
(@ts,4001,5000,225,NULL,NULL),
(@ts,5001,6000,270,NULL,NULL),
(@ts,6001,7000,297.5,NULL,NULL),
(@ts,7001,8000,340,NULL,NULL),
(@ts,8001,9000,360,NULL,NULL),
(@ts,9001,10000,400,NULL,NULL),
(@ts,10001,12000,450,NULL,NULL),
(@ts,12001,15000,562.5,NULL,NULL),
(@ts,15001,20000,700,NULL,NULL),
(@ts,20001,25000,875,NULL,NULL),
(@ts,25001,30000,900,NULL,NULL),
(@ts,30001,40000,1000,NULL,NULL),
(@ts,40001,50000,1200,NULL,NULL),
(@ts,50001,60000,1440,NULL,NULL),
(@ts,60001,70000,1680,NULL,NULL),
(@ts,70001,80000,1920,NULL,NULL),
(@ts,80001,90000,2070,NULL,NULL),
(@ts,90001,100000,2300,NULL,NULL),
(@ts,100001,150000,3450,NULL,NULL),
(@ts,150001,200000,4600,NULL,NULL),
(@ts,200001,250000,5750,NULL,NULL),
(@ts,250001,300000,6900,NULL,NULL),
(@ts,300001,350000,8050,NULL,NULL),
(@ts,350001,425000,9350,NULL,NULL),
(@ts,425001,500000,11000,NULL,NULL),
(@ts,500001,600000,13200,NULL,NULL),
(@ts,600001,700000,15400,NULL,NULL),
(@ts,700001,800000,17600,NULL,NULL),
(@ts,800001,900000,18900,NULL,NULL),
(@ts,900001,1000000,20000,NULL,NULL);

INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description) VALUES (@v,'spot_cost_2','Spot colour cost - 2 spot','equivalent_qty','cost',NULL,NULL,'first_row','P2',NULL);
SET @ts = LAST_INSERT_ID();
INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3) VALUES
(@ts,100,199,119.4,NULL,NULL),
(@ts,200,299,119.6,NULL,NULL),
(@ts,300,399,119.7,NULL,NULL),
(@ts,400,499,119.76,NULL,NULL),
(@ts,500,599,119.8,NULL,NULL),
(@ts,600,699,139.8,NULL,NULL),
(@ts,700,799,143.82,NULL,NULL),
(@ts,800,899,143.84,NULL,NULL),
(@ts,900,999,149.85,NULL,NULL),
(@ts,1000,1200,156,NULL,NULL),
(@ts,1201,1400,176.4,NULL,NULL),
(@ts,1401,1600,185.6,NULL,NULL),
(@ts,1601,1800,180,NULL,NULL),
(@ts,1801,2000,200,NULL,NULL),
(@ts,2001,2500,250,NULL,NULL),
(@ts,2501,3000,285,NULL,NULL),
(@ts,3001,4000,380,NULL,NULL),
(@ts,4001,5000,450,NULL,NULL),
(@ts,5001,6000,540,NULL,NULL),
(@ts,6001,7000,595,NULL,NULL),
(@ts,7001,8000,680,NULL,NULL),
(@ts,8001,9000,720,NULL,NULL),
(@ts,9001,10000,800,NULL,NULL),
(@ts,10001,12000,900,NULL,NULL),
(@ts,12001,15000,1125,NULL,NULL),
(@ts,15001,20000,1400,NULL,NULL),
(@ts,20001,25000,1750,NULL,NULL),
(@ts,25001,30000,1800,NULL,NULL),
(@ts,30001,40000,2000,NULL,NULL),
(@ts,40001,50000,2400,NULL,NULL),
(@ts,50001,60000,2880,NULL,NULL),
(@ts,60001,70000,3360,NULL,NULL),
(@ts,70001,80000,3840,NULL,NULL),
(@ts,80001,90000,4140,NULL,NULL),
(@ts,90001,100000,4600,NULL,NULL),
(@ts,100001,150000,6900,NULL,NULL),
(@ts,150001,200000,9200,NULL,NULL),
(@ts,200001,250000,11500,NULL,NULL),
(@ts,250001,300000,13800,NULL,NULL),
(@ts,300001,350000,16100,NULL,NULL),
(@ts,350001,425000,18700,NULL,NULL),
(@ts,425001,500000,22000,NULL,NULL),
(@ts,500001,600000,26400,NULL,NULL),
(@ts,600001,700000,30800,NULL,NULL),
(@ts,700001,800000,35200,NULL,NULL),
(@ts,800001,900000,37800,NULL,NULL),
(@ts,900001,1000000,40000,NULL,NULL);

INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description) VALUES (@v,'spot_cost_3','Spot colour cost - 3 spot','equivalent_qty','cost',NULL,NULL,'first_row','P2','Original code had a typo at 50001-60000 (39600) and was missing 60001-600000; rebuilt as 3x the 1-spot table - VERIFY against the Excel');
SET @ts = LAST_INSERT_ID();
INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3) VALUES
(@ts,100,199,179.1,NULL,NULL),
(@ts,200,299,179.4,NULL,NULL),
(@ts,300,399,179.55,NULL,NULL),
(@ts,400,499,179.64,NULL,NULL),
(@ts,500,599,179.7,NULL,NULL),
(@ts,600,699,209.7,NULL,NULL),
(@ts,700,799,215.73,NULL,NULL),
(@ts,800,899,215.76,NULL,NULL),
(@ts,900,999,224.79,NULL,NULL),
(@ts,1000,1200,234,NULL,NULL),
(@ts,1201,1400,264.6,NULL,NULL),
(@ts,1401,1600,278.4,NULL,NULL),
(@ts,1601,1800,270,NULL,NULL),
(@ts,1801,2000,300,NULL,NULL),
(@ts,2001,2500,375,NULL,NULL),
(@ts,2501,3000,427.5,NULL,NULL),
(@ts,3001,4000,570,NULL,NULL),
(@ts,4001,5000,675,NULL,NULL),
(@ts,5001,6000,810,NULL,NULL),
(@ts,6001,7000,892.5,NULL,NULL),
(@ts,7001,8000,1020,NULL,NULL),
(@ts,8001,9000,1080,NULL,NULL),
(@ts,9001,10000,1200,NULL,NULL),
(@ts,10001,12000,1350,NULL,NULL),
(@ts,12001,15000,1687.5,NULL,NULL),
(@ts,15001,20000,2100,NULL,NULL),
(@ts,20001,25000,2625,NULL,NULL),
(@ts,25001,30000,2700,NULL,NULL),
(@ts,30001,40000,3000,NULL,NULL),
(@ts,40001,50000,3600,NULL,NULL),
(@ts,50001,60000,4320,NULL,NULL),
(@ts,60001,70000,5040,NULL,NULL),
(@ts,70001,80000,5760,NULL,NULL),
(@ts,80001,90000,6210,NULL,NULL),
(@ts,90001,100000,6900,NULL,NULL),
(@ts,100001,150000,10350,NULL,NULL),
(@ts,150001,200000,13800,NULL,NULL),
(@ts,200001,250000,17250,NULL,NULL),
(@ts,250001,300000,20700,NULL,NULL),
(@ts,300001,350000,24150,NULL,NULL),
(@ts,350001,425000,28050,NULL,NULL),
(@ts,425001,500000,33000,NULL,NULL),
(@ts,500001,600000,39600,NULL,NULL),
(@ts,600001,700000,46200,NULL,NULL),
(@ts,700001,800000,52800,NULL,NULL),
(@ts,800001,900000,56700,NULL,NULL),
(@ts,900001,1000000,60000,NULL,NULL);

INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description) VALUES (@v,'stamping','Stamping multiplier + minimum','quantity','multiplier','min_total',NULL,'first_row','P8',NULL);
SET @ts = LAST_INSERT_ID();
INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3) VALUES
(@ts,100,199,6,0,NULL),
(@ts,200,299,4,0,NULL),
(@ts,300,399,2.2,0,NULL),
(@ts,400,499,1.8,0,NULL),
(@ts,500,999,1.6,0,NULL),
(@ts,1000,1999,1.5,120,NULL),
(@ts,2000,2999,1.3,120,NULL),
(@ts,3000,3999,1,120,NULL),
(@ts,4000,4999,1,160,NULL),
(@ts,5000,6999,0.95,160,NULL),
(@ts,7000,9999,0.9,160,NULL),
(@ts,10000,14999,0.85,200,NULL),
(@ts,15000,19999,0.8,200,NULL),
(@ts,20000,29999,0.78,200,NULL),
(@ts,30000,49999,0.76,200,NULL),
(@ts,50000,74999,0.74,200,NULL),
(@ts,75000,99999,0.72,200,NULL),
(@ts,100000,149999,0.7,200,NULL),
(@ts,150000,199999,0.68,200,NULL),
(@ts,200000,399999,0.66,200,NULL),
(@ts,400000,1000000,0.63,200,NULL);

INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description) VALUES (@v,'emboss_impression','Embossing impression rate per piece','quantity','rate',NULL,NULL,'first_row','P9',NULL);
SET @ts = LAST_INSERT_ID();
INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3) VALUES
(@ts,100,199,0.6,NULL,NULL),
(@ts,200,299,0.36,NULL,NULL),
(@ts,300,399,0.28,NULL,NULL),
(@ts,400,499,0.25,NULL,NULL),
(@ts,500,999,0.16,NULL,NULL),
(@ts,1000,1999,0.14,NULL,NULL),
(@ts,2000,2999,0.08,NULL,NULL),
(@ts,3000,4999,0.07,NULL,NULL),
(@ts,5000,6999,0.06,NULL,NULL),
(@ts,7000,9999,0.056,NULL,NULL),
(@ts,10000,19999,0.056,NULL,NULL),
(@ts,20000,29999,0.05,NULL,NULL),
(@ts,30000,39999,0.049,NULL,NULL),
(@ts,40000,49999,0.048,NULL,NULL),
(@ts,50000,1000000,0.04,NULL,NULL);

INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description) VALUES (@v,'texture_emboss','Custom texture embossing','actual_sheet_qty','flat_total','rate_multiplier',NULL,'zero','P10','flat_total > 0 = fixed price; otherwise sheets x base_rate x multiplier. Sheets below first tier cost 0 (current behaviour)');
SET @ts = LAST_INSERT_ID();
INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3) VALUES
(@ts,100,1999,100,0,NULL),
(@ts,2000,9999,0,1,NULL),
(@ts,10000,49999,0,0.9,NULL),
(@ts,50000,NULL,0,0.85,NULL);

INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description) VALUES (@v,'die_cut','Die cut','actual_sheet_qty','flat_total','multiplier_special','multiplier_standard','zero','P11','special multiplier when qty = diecut_special_qty or layout.diecut_efficient; else standard');
SET @ts = LAST_INSERT_ID();
INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3) VALUES
(@ts,100,1999,90,0,0),
(@ts,2000,9999,0,1,0.9),
(@ts,10000,49999,0,0.9,0.8),
(@ts,50000,NULL,0,0.85,0.7);

INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description) VALUES (@v,'logistics','Logistics cost by quantity','quantity','cost',NULL,NULL,'first_row','P17',NULL);
SET @ts = LAST_INSERT_ID();
INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3) VALUES
(@ts,0,3000,250,NULL,NULL),
(@ts,3001,4000,300,NULL,NULL),
(@ts,4001,NULL,350,NULL,NULL);

INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description) VALUES (@v,'converting_rate','Converting rate per bag','bag_volume_m3','rate',NULL,NULL,'first_row','P15',NULL);
SET @ts = LAST_INSERT_ID();
INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3) VALUES
(@ts,0.0005,0.0035,0.11,NULL,NULL),
(@ts,0.0036,0.005,0.12,NULL,NULL),
(@ts,0.0051,0.008,0.13,NULL,NULL),
(@ts,0.0081,0.015,0.15,NULL,NULL),
(@ts,0.0151,0.02,0.16,NULL,NULL),
(@ts,0.02,0.025,0.17,NULL,NULL),
(@ts,0.0251,0.03,0.18,NULL,NULL),
(@ts,0.03,0.04,0.2,NULL,NULL),
(@ts,0.04,0.05,0.21,NULL,NULL),
(@ts,0.05,0.06,0.23,NULL,NULL),
(@ts,0.06,0.07,0.25,NULL,NULL),
(@ts,0.07,0.09,0.28,NULL,NULL);

INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description) VALUES (@v,'glue_rate','Glue rate per bag','glue_length_m','rate',NULL,NULL,'first_row','P15',NULL);
SET @ts = LAST_INSERT_ID();
INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3) VALUES
(@ts,0.2,0.5,0.015,NULL,NULL),
(@ts,0.51,0.65,0.02,NULL,NULL),
(@ts,0.66,0.8,0.025,NULL,NULL),
(@ts,0.8,1,0.03,NULL,NULL),
(@ts,1,1.25,0.04,NULL,NULL),
(@ts,1.26,1.5,0.05,NULL,NULL),
(@ts,1.51,2.5,0.065,NULL,NULL);

INSERT INTO quotation_tier_sets (version_id,set_key,label,lookup_basis,value1_label,value2_label,value3_label,below_min_behavior,used_by,description) VALUES (@v,'handling_rate','Handling rate per bag','bag_volume_m3','rate',NULL,NULL,'first_row','P15',NULL);
SET @ts = LAST_INSERT_ID();
INSERT INTO quotation_tier_rows (tier_set_id,range_min,range_max,value1,value2,value3) VALUES
(@ts,0.0005,0.0035,0.015,NULL,NULL),
(@ts,0.0036,0.005,0.02,NULL,NULL),
(@ts,0.0051,0.008,0.022,NULL,NULL),
(@ts,0.0081,0.015,0.025,NULL,NULL),
(@ts,0.0151,0.02,0.028,NULL,NULL),
(@ts,0.02,0.025,0.028,NULL,NULL),
(@ts,0.0251,0.03,0.03,NULL,NULL),
(@ts,0.03,0.04,0.035,NULL,NULL),
(@ts,0.04,0.05,0.035,NULL,NULL),
(@ts,0.05,0.06,0.04,NULL,NULL),
(@ts,0.06,0.07,0.05,NULL,NULL),
(@ts,0.07,0.09,0.06,NULL,NULL);

-- OPTION GROUPS + OPTIONS
INSERT INTO quotation_option_groups (version_id,group_key,label,attribute_schema) VALUES (@v,'paper','Paper','[{"key":"weight_kg_per_m2","label":"Weight (kg per m2, 0.19 = 190gsm)","type":"number"},{"key":"price_per_kg","label":"Price per kg (RM)","type":"number"}]');
SET @g = LAST_INSERT_ID();
INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order) VALUES
(@g,'Brown Kraft 100','Brown Kraft 100','{"weight_kg_per_m2":0.1,"price_per_kg":2.35}',0),
(@g,'Brown Kraft 120','Brown Kraft 120','{"weight_kg_per_m2":0.12,"price_per_kg":2.25}',1),
(@g,'Brown Kraft 140','Brown Kraft 140','{"weight_kg_per_m2":0.14,"price_per_kg":2.3}',2),
(@g,'Brown Kraft 170','Brown Kraft 170','{"weight_kg_per_m2":0.17,"price_per_kg":2.3}',3),
(@g,'White Kraft 100','White Kraft 100','{"weight_kg_per_m2":0.1,"price_per_kg":4.7}',4),
(@g,'White Kraft 120','White Kraft 120','{"weight_kg_per_m2":0.12,"price_per_kg":4.5}',5),
(@g,'White Kraft 150','White Kraft 150','{"weight_kg_per_m2":0.15,"price_per_kg":4.7}',6),
(@g,'White Kraft 180','White Kraft 180','{"weight_kg_per_m2":0.18,"price_per_kg":4.7}',7),
(@g,'Art Paper 157','Art Paper 157','{"weight_kg_per_m2":0.157,"price_per_kg":3.6}',8),
(@g,'Art Card 190','Art Card 190','{"weight_kg_per_m2":0.19,"price_per_kg":3.45}',9),
(@g,'Art Card 210','Art Card 210','{"weight_kg_per_m2":0.21,"price_per_kg":3.55}',10),
(@g,'Art Card 230','Art Card 230','{"weight_kg_per_m2":0.23,"price_per_kg":3.55}',11),
(@g,'Sack Kraft 100','Sack Kraft 100','{"weight_kg_per_m2":0.1,"price_per_kg":4.5}',12);

INSERT INTO quotation_option_groups (version_id,group_key,label,attribute_schema) VALUES (@v,'printing','Printing option','[{"key":"process_colors","label":"Process colours","type":"number"},{"key":"spot_colors","label":"Spot colours","type":"number"},{"key":"plate_cost","label":"Plate cost (RM)","type":"number"},{"key":"coverage","label":"Ink coverage","type":"number"},{"key":"spot_tier_set","label":"Spot cost table (tier set key)","type":"text"},{"key":"add_process_cost","label":"Add process cost on top of spot table","type":"boolean"}]');
SET @g = LAST_INSERT_ID();
INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order) VALUES
(@g,'Plain 0c x 0c','Plain 0c x 0c','{"process_colors":0,"spot_colors":0,"plate_cost":0,"coverage":0,"spot_tier_set":null,"add_process_cost":false}',0),
(@g,'process 4c x 0c','process 4c x 0c','{"process_colors":4,"spot_colors":0,"plate_cost":140,"coverage":0,"spot_tier_set":null,"add_process_cost":false}',1),
(@g,'1 spot up to 33%','1 spot up to 33%','{"process_colors":0,"spot_colors":1,"plate_cost":40,"coverage":0.33,"spot_tier_set":"spot_cost_1","add_process_cost":false}',2),
(@g,'1 spot up to 67%','1 spot up to 67%','{"process_colors":0,"spot_colors":1,"plate_cost":40,"coverage":0.67,"spot_tier_set":"spot_cost_1","add_process_cost":false}',3),
(@g,'1 spot up to 100%','1 spot up to 100%','{"process_colors":0,"spot_colors":1,"plate_cost":40,"coverage":1,"spot_tier_set":"spot_cost_1","add_process_cost":false}',4),
(@g,'2 spot up to 33%','2 spot up to 33%','{"process_colors":0,"spot_colors":2,"plate_cost":80,"coverage":0.33,"spot_tier_set":"spot_cost_2","add_process_cost":false}',5),
(@g,'2 spot up to 67%','2 spot up to 67%','{"process_colors":0,"spot_colors":2,"plate_cost":80,"coverage":0.67,"spot_tier_set":"spot_cost_2","add_process_cost":false}',6),
(@g,'2 spot up to 100%','2 spot up to 100%','{"process_colors":0,"spot_colors":2,"plate_cost":80,"coverage":1,"spot_tier_set":"spot_cost_2","add_process_cost":false}',7),
(@g,'3 spot up to 33%','3 spot up to 33%','{"process_colors":0,"spot_colors":3,"plate_cost":120,"coverage":0.33,"spot_tier_set":"spot_cost_3","add_process_cost":false}',8),
(@g,'3 spot up to 67%','3 spot up to 67%','{"process_colors":0,"spot_colors":3,"plate_cost":120,"coverage":0.67,"spot_tier_set":"spot_cost_3","add_process_cost":false}',9),
(@g,'3 spot up to 100%','3 spot up to 100%','{"process_colors":0,"spot_colors":3,"plate_cost":120,"coverage":1,"spot_tier_set":"spot_cost_3","add_process_cost":false}',10),
(@g,'5c=process 4cx0c+1c spot 33%','5c=process 4cx0c+1c spot 33%','{"process_colors":4,"spot_colors":1,"plate_cost":180,"coverage":1.18,"spot_tier_set":"spot_cost_1","add_process_cost":true}',11),
(@g,'6c=process 4cx0c+2c spot 33%','6c=process 4cx0c+2c spot 33%','{"process_colors":4,"spot_colors":2,"plate_cost":220,"coverage":1.18,"spot_tier_set":"spot_cost_2","add_process_cost":true}',12);

INSERT INTO quotation_option_groups (version_id,group_key,label,attribute_schema) VALUES (@v,'ink','Ink type','[{"key":"price_per_kg","label":"Price per kg (RM)","type":"number"}]');
SET @g = LAST_INSERT_ID();
INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order) VALUES
(@g,'normal','Normal Ink','{"price_per_kg":60}',0),
(@g,'metallic','Metallic Ink','{"price_per_kg":150}',1);

INSERT INTO quotation_option_groups (version_id,group_key,label,attribute_schema) VALUES (@v,'varnish','Varnish','[{"key":"charges","label":"Charges cost","type":"boolean"},{"key":"rate_per_sqin","label":"Rate (RM per sq in)","type":"number"},{"key":"per_sheet_fee","label":"Fee per sheet (RM)","type":"number"}]');
SET @g = LAST_INSERT_ID();
INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order) VALUES
(@g,'None','No Varnish','{"charges":false,"rate_per_sqin":0,"per_sheet_fee":0}',0),
(@g,'OPV','OPV Varnish','{"charges":true,"rate_per_sqin":0.00006,"per_sheet_fee":0.03}',1),
(@g,'Waterbase','Waterbase Varnish','{"charges":true,"rate_per_sqin":0.00008,"per_sheet_fee":0}',2);

INSERT INTO quotation_option_groups (version_id,group_key,label,attribute_schema) VALUES (@v,'lamination','Lamination','[{"key":"charges","label":"Charges cost","type":"boolean"},{"key":"rate_per_sqin","label":"Rate (RM per sq in)","type":"number"}]');
SET @g = LAST_INSERT_ID();
INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order) VALUES
(@g,'None','No Lamination','{"charges":false,"rate_per_sqin":0}',0),
(@g,'Gloss','Gloss Lamination','{"charges":true,"rate_per_sqin":0.0004}',1),
(@g,'Matt','Matt Lamination','{"charges":true,"rate_per_sqin":0.00042}',2);

INSERT INTO quotation_option_groups (version_id,group_key,label,attribute_schema) VALUES (@v,'foil','Foil type','[{"key":"rate_per_sqin","label":"Rate (RM per sq in)","type":"number"}]');
SET @g = LAST_INSERT_ID();
INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order) VALUES
(@g,'gold','Gold Foil','{"rate_per_sqin":0.0015}',0),
(@g,'silver','Silver Foil','{"rate_per_sqin":0.0015}',1),
(@g,'matt_gold','Matte Gold Foil','{"rate_per_sqin":0.0025}',2),
(@g,'matt_silver','Matte Silver Foil','{"rate_per_sqin":0.0025}',3),
(@g,'copper','Copper Foil','{"rate_per_sqin":0.0025}',4),
(@g,'black','Black Foil','{"rate_per_sqin":0.0025}',5),
(@g,'red','Red Foil','{"rate_per_sqin":0.0025}',6),
(@g,'blue','Blue Foil','{"rate_per_sqin":0.0025}',7),
(@g,'green','Green Foil','{"rate_per_sqin":0.0025}',8),
(@g,'maroon','Maroon Foil','{"rate_per_sqin":0.0025}',9),
(@g,'white','White Foil','{"rate_per_sqin":0.004}',10),
(@g,'rainbow','Rainbow Foil','{"rate_per_sqin":0.004}',11),
(@g,'hologram','Holographic Foil','{"rate_per_sqin":0.0035}',12),
(@g,'special','Special Foil','{"rate_per_sqin":0.003}',13);

INSERT INTO quotation_option_groups (version_id,group_key,label,attribute_schema) VALUES (@v,'embossing_type','Embossing type','[{"key":"block_rate_per_cm2","label":"Block rate (RM per cm2)","type":"number"}]');
SET @g = LAST_INSERT_ID();
INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order) VALUES
(@g,'Standard Embossing','Standard Embossing','{"block_rate_per_cm2":0.35}',0),
(@g,'Deep Embossing','Deep Embossing','{"block_rate_per_cm2":5}',1),
(@g,'Multi-level Embossing','Multi-level Embossing','{"block_rate_per_cm2":5}',2),
(@g,'Debossing','Debossing','{"block_rate_per_cm2":0.35}',3),
(@g,'3D','3D','{"block_rate_per_cm2":5}',4);

INSERT INTO quotation_option_groups (version_id,group_key,label,attribute_schema) VALUES (@v,'texture','Texture type','[{"key":"charged","label":"Charged","type":"boolean"}]');
SET @g = LAST_INSERT_ID();
INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order) VALUES
(@g,'standard','Standard Texture','{"charged":false}',0),
(@g,'custom','Custom Texture','{"charged":true}',1);

INSERT INTO quotation_option_groups (version_id,group_key,label,attribute_schema) VALUES (@v,'handle','Handle type','[{"key":"price_per_pair","label":"Price per pair (RM)","type":"number"},{"key":"is_pth","label":"Paper twist handle","type":"boolean"},{"key":"needs_board","label":"Needs reinforcement board","type":"boolean"}]');
SET @g = LAST_INSERT_ID();
INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order) VALUES
(@g,'round_pp_tipping','Round PP Tipping','{"price_per_pair":0.075,"is_pth":false,"needs_board":false}',0),
(@g,'round_poly_tipping','Round Polyester Tipping','{"price_per_pair":0.079,"is_pth":false,"needs_board":false}',1),
(@g,'flat_polyester','Flat Polyester','{"price_per_pair":0.2,"is_pth":false,"needs_board":false}',2),
(@g,'flat_satin','Flat Satin 1-side','{"price_per_pair":0.144,"is_pth":false,"needs_board":false}',3),
(@g,'flat_gross_grain','Flat Gross Grain','{"price_per_pair":0.15,"is_pth":false,"needs_board":false}',4),
(@g,'pp_twisted','PP Twisted','{"price_per_pair":0.152,"is_pth":false,"needs_board":false}',5),
(@g,'pth_white','PTH White (Paper Twist Handle)','{"price_per_pair":0.085,"is_pth":true,"needs_board":true}',6),
(@g,'pth_brown','PTH Brown (Paper Twist Handle)','{"price_per_pair":0.075,"is_pth":true,"needs_board":true}',7),
(@g,'pth_black','PTH Black (Paper Twist Handle)','{"price_per_pair":0.095,"is_pth":true,"needs_board":true}',8),
(@g,'pth_other','PTH Other Colors','{"price_per_pair":0.1,"is_pth":true,"needs_board":true}',9),
(@g,'paper_yarn_round','Paper Yarn Round Knots','{"price_per_pair":0.225,"is_pth":false,"needs_board":false}',10),
(@g,'paper_rope_flat_button','Paper Rope Flat-Button','{"price_per_pair":0.24,"is_pth":false,"needs_board":false}',11);

INSERT INTO quotation_option_groups (version_id,group_key,label,attribute_schema) VALUES (@v,'board','Reinforcement board','[{"key":"weight_kg_per_m2","label":"Weight (kg per m2)","type":"number"},{"key":"price_per_kg","label":"Price per kg (RM)","type":"number"},{"key":"eb_extra","label":"Adds EB extra height","type":"boolean"},{"key":"note","label":"Note","type":"text"}]');
SET @g = LAST_INSERT_ID();
INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order) VALUES
(@g,'eb_bb_350','EB+BB Duplex 350gsm','{"weight_kg_per_m2":0.35,"price_per_kg":2.6,"eb_extra":true,"note":"Standard reinforcement (EB + bottom board)"}',0),
(@g,'eb_bb_450','EB+BB Duplex 450gsm','{"weight_kg_per_m2":0.45,"price_per_kg":2.8,"eb_extra":true,"note":"Heavy-duty reinforcement (EB + bottom board)"}',1),
(@g,'eb_bb_250','EB+BB BrownBoard 250gsm','{"weight_kg_per_m2":0.25,"price_per_kg":2.8,"eb_extra":true,"note":"Economy reinforcement (EB + bottom board)"}',2),
(@g,'bb_350','BB Only Duplex 350gsm','{"weight_kg_per_m2":0.35,"price_per_kg":2.6,"eb_extra":false,"note":"Bottom board only – for PTH handles"}',3),
(@g,'bb_450','BB Only Duplex 450gsm','{"weight_kg_per_m2":0.45,"price_per_kg":2.8,"eb_extra":false,"note":"Heavy bottom board only – for PTH handles"}',4),
(@g,'bb_250','BB Only BrownBoard 250gsm','{"weight_kg_per_m2":0.25,"price_per_kg":2.8,"eb_extra":false,"note":"Economy bottom board only – for PTH handles"}',5),
(@g,'nil','Nil (No Board)','{"weight_kg_per_m2":0,"price_per_kg":0,"eb_extra":false,"note":"No reinforcement board"}',6);

INSERT INTO quotation_option_groups (version_id,group_key,label,attribute_schema) VALUES (@v,'margin','Margin index','[{"key":"index","label":"Margin index (cost / index = selling)","type":"number"}]');
SET @g = LAST_INSERT_ID();
INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order) VALUES
(@g,'0.63','0.63','{"index":0.63}',0),
(@g,'0.675','0.675','{"index":0.675}',1),
(@g,'0.7','0.7','{"index":0.7}',2),
(@g,'0.72','0.72','{"index":0.72}',3),
(@g,'0.74','0.74','{"index":0.74}',4),
(@g,'0.75','0.75','{"index":0.75}',5),
(@g,'0.775','0.775','{"index":0.775}',6),
(@g,'0.8','0.8','{"index":0.8}',7),
(@g,'0.82','0.82','{"index":0.82}',8),
(@g,'0.84','0.84','{"index":0.84}',9),
(@g,'0.86','0.86','{"index":0.86}',10),
(@g,'0.88','0.88','{"index":0.88}',11),
(@g,'0.89','0.89','{"index":0.89}',12),
(@g,'0.9','0.9','{"index":0.9}',13);

INSERT INTO quotation_option_groups (version_id,group_key,label,attribute_schema) VALUES (@v,'layout','Sheet layout','[{"key":"width_mult","label":"Sheet width multiplier","type":"number"},{"key":"height_mult","label":"Sheet height multiplier","type":"number"},{"key":"bags_per_sheet","label":"Bags per sheet","type":"number"},{"key":"die_y_mult","label":"Mould Y multiplier","type":"number"},{"key":"plywood_mult","label":"Plywood multiplier","type":"number"},{"key":"diecut_efficient","label":"Gets special die-cut multiplier","type":"boolean"},{"key":"valid_ranges","label":"Valid sheet size boxes [wmin,wmax,hmin,hmax] in m","type":"json"}]');
SET @g = LAST_INSERT_ID();
INSERT INTO quotation_options (group_id,option_key,label,attributes,sort_order) VALUES
(@g,'1X1Y','1X1Y','{"width_mult":2,"height_mult":1,"bags_per_sheet":1,"die_y_mult":1,"plywood_mult":1,"diecut_efficient":false,"valid_ranges":[[0.533,1.025,0.318,0.698]]}',0),
(@g,'0.5X2Y','0.5X2Y','{"width_mult":1,"height_mult":2,"bags_per_sheet":1,"die_y_mult":2,"plywood_mult":1,"diecut_efficient":false,"valid_ranges":[[0.318,0.698,0.533,1.025]]}',1),
(@g,'0.5X1Y','0.5X1Y','{"width_mult":1,"height_mult":1,"bags_per_sheet":0.5,"die_y_mult":1,"plywood_mult":0.5,"diecut_efficient":false,"valid_ranges":[[0.318,0.698,0.533,1.025],[0.533,1.025,0.318,0.698]]}',2),
(@g,'1X2Y','1X2Y','{"width_mult":2,"height_mult":2,"bags_per_sheet":2,"die_y_mult":2,"plywood_mult":2,"diecut_efficient":true,"valid_ranges":[[0.3,0.698,0.42,1.025],[0.42,1.025,0.3,0.698]]}',3);

-- COST COMPONENTS
INSERT INTO quotation_cost_components (version_id,code,label,report_group,toggle_field,handler,sort_order) VALUES
(@v,'P1','Paper Cost','Material',NULL,'paper',0),
(@v,'P2','Printing Cost','Printing',NULL,'printing',1),
(@v,'P3','Plate Cost','Printing',NULL,'plate',2),
(@v,'P4','Ink Cost','Printing',NULL,'ink',3),
(@v,'P5','Varnish Cost','Finishing','varnish','varnish',4),
(@v,'P6','Lamination Cost','Finishing','lamination','lamination',5),
(@v,'P7','Spot UV Cost','Finishing','spotUV','spotuv',6),
(@v,'P8','Stamping Cost','Finishing','stamping','stamping',7),
(@v,'P9','Embossing Cost','Finishing','embossing','embossing',8),
(@v,'P10','Texture Embossing','Finishing','textureEmbossing','texture',9),
(@v,'P11','Die Cut Cost','Finishing','dieCut','diecut',10),
(@v,'P12','DC Moulding Cost','Finishing','dcMoulding','mould',11),
(@v,'P13','Handles','Accessories','handles','handles',12),
(@v,'P14','Reinforcement Board','Accessories','reinforcementBoard','board',13),
(@v,'P15','Converting Labor','Conversion','convertingLabor','converting',14),
(@v,'P16','Packaging Cost','Other','packaging','packaging',15),
(@v,'P17','Logistics Cost','Other',NULL,'logistics',16),
(@v,'P18','Mock Up Cost','Other','mockUp','mockup',17);
