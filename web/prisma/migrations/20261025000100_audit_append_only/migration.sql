-- Journal d'audit en ajout seul : toute modification ou suppression est refusée.
-- TRUNCATE reste permis (réinitialisation des bases de test).
CREATE OR REPLACE FUNCTION audit_event_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Le journal d''audit est en ajout seul : % interdit sur AuditEvent.', TG_OP;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_event_append_only
BEFORE UPDATE OR DELETE ON "AuditEvent"
FOR EACH ROW EXECUTE FUNCTION audit_event_append_only();
