-- Migration: Add aspirate_amount column to tbl_nursing_chart_meals
-- Purpose: Optional aspirate documentation (mL) per meal row, for Tube Feeding.
-- NULL = not documented; 0 = explicitly documented as zero.

ALTER TABLE tbl_nursing_chart_meals ADD COLUMN aspirate_amount numeric DEFAULT NULL;

COMMENT ON COLUMN tbl_nursing_chart_meals.aspirate_amount IS 'Aspirate volume in mL for this meal row (Tube Feeding). NULL means not documented; 0 means explicitly documented as zero.';
