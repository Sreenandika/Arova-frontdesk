-- Immutability triggers to ensure append-only guarantees (INC-0318)

CREATE OR REPLACE FUNCTION prevent_row_modification()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Table % is strictly append-only: updates and deletes are prohibited.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION prevent_table_truncation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'Table % is strictly append-only: truncation is prohibited.', TG_TABLE_NAME;
END;
$$ LANGUAGE plpgsql;

-- Apply to ticket_events
DROP TRIGGER IF EXISTS trg_prevent_ticket_events_mod ON ticket_events;
CREATE TRIGGER trg_prevent_ticket_events_mod
BEFORE UPDATE OR DELETE ON ticket_events
FOR EACH ROW EXECUTE FUNCTION prevent_row_modification();

DROP TRIGGER IF EXISTS trg_prevent_ticket_events_trunc ON ticket_events;
CREATE TRIGGER trg_prevent_ticket_events_trunc
BEFORE TRUNCATE ON ticket_events
FOR EACH STATEMENT EXECUTE FUNCTION prevent_table_truncation();

-- Apply to ticket_messages
DROP TRIGGER IF EXISTS trg_prevent_ticket_messages_mod ON ticket_messages;
CREATE TRIGGER trg_prevent_ticket_messages_mod
BEFORE UPDATE OR DELETE ON ticket_messages
FOR EACH ROW EXECUTE FUNCTION prevent_row_modification();

DROP TRIGGER IF EXISTS trg_prevent_ticket_messages_trunc ON ticket_messages;
CREATE TRIGGER trg_prevent_ticket_messages_trunc
BEFORE TRUNCATE ON ticket_messages
FOR EACH STATEMENT EXECUTE FUNCTION prevent_table_truncation();

-- Apply to internal_notes
DROP TRIGGER IF EXISTS trg_prevent_internal_notes_mod ON internal_notes;
CREATE TRIGGER trg_prevent_internal_notes_mod
BEFORE UPDATE OR DELETE ON internal_notes
FOR EACH ROW EXECUTE FUNCTION prevent_row_modification();

DROP TRIGGER IF EXISTS trg_prevent_internal_notes_trunc ON internal_notes;
CREATE TRIGGER trg_prevent_internal_notes_trunc
BEFORE TRUNCATE ON internal_notes
FOR EACH STATEMENT EXECUTE FUNCTION prevent_table_truncation();
