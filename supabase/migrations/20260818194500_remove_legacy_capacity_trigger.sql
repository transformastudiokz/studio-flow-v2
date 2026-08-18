-- enforce_booking_rules already performs the authoritative capacity check and
-- includes both CRM and OneFit reservations. The older trigger counted
-- absent/late-cancelled rows as occupied and could reject otherwise valid
-- client bookings with a conflicting result.
drop trigger if exists enforce_session_capacity on public.bookings;
drop function if exists public.check_session_capacity();
