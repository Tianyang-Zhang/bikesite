-- ============================================================================
-- BikeSite v2 · Phase 1 · Checkpoint 1 verification
-- ============================================================================
-- Run this in the Supabase SQL editor AFTER 01_schema.sql.
--
-- It is wrapped in a transaction that always ROLLS BACK, so it leaves no data
-- behind and is safe to run any number of times.
--
--   PASS  ->  the SECOND insert fails with:
--             ERROR: conflicting key value violates exclusion
--                    constraint "no_overlap"
--   FAIL  ->  both inserts succeed (the guarantee is missing -- stop and check
--             that 01_schema.sql applied without errors).
-- ============================================================================

begin;

insert into bikes (name, type, price_per_day)
values ('__checkpoint1_test_bike__', 'test', 0);

-- Booking #1 -- July 10-12 for the test bike. Succeeds.
insert into bookings (bike_id, start_date, end_date, renter_name, renter_contact)
select id, date '2026-07-10', date '2026-07-12', 'Alice', 'alice@example.test'
from bikes where name = '__checkpoint1_test_bike__';

-- Booking #2 -- SAME bike, dates July 11-13 (overlapping booking #1).
-- This statement MUST error. That error IS the checkpoint passing.
insert into bookings (bike_id, start_date, end_date, renter_name, renter_contact)
select id, date '2026-07-11', date '2026-07-13', 'Bob', 'bob@example.test'
from bikes where name = '__checkpoint1_test_bike__';

rollback;
