-- Ephemeral connection/review controls. Never include credentials in backups.
CREATE TABLE kite_sessions (
 workspace_id TEXT PRIMARY KEY REFERENCES workspaces(id),
 client_id TEXT NOT NULL, token_cipher TEXT NOT NULL, expires_at INTEGER NOT NULL,
 last_synced TEXT
);
CREATE TABLE kite_auth (
 state_hash TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 expires_at INTEGER NOT NULL
);
CREATE TABLE kite_previews (
 id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id),
 client_id TEXT NOT NULL, fetched_at TEXT NOT NULL, expires_at INTEGER NOT NULL,
 data_json TEXT NOT NULL, applied INTEGER NOT NULL DEFAULT 0 CHECK(applied IN (0,1)),
 choices_json TEXT
);
-- A single atomic trigger validates every target before modifying any holding.
CREATE TRIGGER kite_apply BEFORE UPDATE OF applied ON kite_previews
WHEN OLD.applied=0 AND NEW.applied=1 BEGIN
 SELECT CASE WHEN OLD.expires_at < unixepoch()*1000 THEN RAISE(ABORT,'Preview expired; fetch again') END;
 SELECT CASE WHEN EXISTS (
  SELECT 1 FROM json_each(NEW.choices_json) c
  WHERE json_extract(c.value,'$.investmentId') IS NOT NULL AND NOT EXISTS (
   SELECT 1 FROM investments i WHERE i.id=json_extract(c.value,'$.investmentId')
   AND i.workspace_id=NEW.workspace_id AND i.investment_type='equity'
   AND i.ledger_version=json_extract(c.value,'$.version')
   AND (i.valuation_date IS NULL OR i.valuation_date<=date(NEW.fetched_at,'+330 minutes'))
   AND NOT EXISTS(SELECT 1 FROM investment_payments p WHERE p.investment_id=i.id AND p.included_in_value=0)
  )
 ) THEN RAISE(ABORT,'Holding changed or has outstanding payments; refresh/reconcile first') END;
 SELECT CASE WHEN EXISTS(SELECT 1 FROM json_each(NEW.choices_json) c JOIN investments i ON i.workspace_id=NEW.workspace_id WHERE (instr(COALESCE(i.notes,''),json_extract(c.value,'$.marker'))>0 AND i.id<>json_extract(c.value,'$.targetId')) OR (i.id=json_extract(c.value,'$.targetId') AND instr(COALESCE(i.notes,''),'[kite:')>0 AND instr(COALESCE(i.notes,''),json_extract(c.value,'$.marker'))=0)) THEN RAISE(ABORT,'Security mapping changed; refresh first') END;
 INSERT INTO investments(id,workspace_id,investment_type,name,institution,invested_minor,current_value_minor,quantity,average_cost_minor,current_price_minor,basis_kind,valuation_date,notes)
 SELECT json_extract(c.value,'$.targetId'),NEW.workspace_id,'equity',json_extract(c.value,'$.name'),'Zerodha',json_extract(c.value,'$.cost'),json_extract(c.value,'$.value'),json_extract(c.value,'$.quantity'),json_extract(c.value,'$.average'),json_extract(c.value,'$.price'),'recorded',date(NEW.fetched_at,'+330 minutes'),json_extract(c.value,'$.marker')
 FROM json_each(NEW.choices_json) c WHERE json_extract(c.value,'$.investmentId') IS NULL;
 INSERT INTO investment_valuations(id,investment_id,valuation_date,invested_minor,value_minor,basis_kind,source,quantity)
 SELECT NEW.id||':'||json_extract(c.value,'$.targetId'),json_extract(c.value,'$.targetId'),date(NEW.fetched_at,'+330 minutes'),json_extract(c.value,'$.cost'),json_extract(c.value,'$.value'),'recorded','Zerodha portfolio snapshot; price timestamp not supplied; fetched '||NEW.fetched_at,json_extract(c.value,'$.quantity') FROM json_each(NEW.choices_json) c;
 UPDATE investments SET
 invested_minor=(SELECT json_extract(c.value,'$.cost') FROM json_each(NEW.choices_json) c WHERE json_extract(c.value,'$.targetId')=investments.id),
 current_value_minor=(SELECT json_extract(c.value,'$.value') FROM json_each(NEW.choices_json) c WHERE json_extract(c.value,'$.targetId')=investments.id),
 quantity=(SELECT json_extract(c.value,'$.quantity') FROM json_each(NEW.choices_json) c WHERE json_extract(c.value,'$.targetId')=investments.id),
 average_cost_minor=(SELECT json_extract(c.value,'$.average') FROM json_each(NEW.choices_json) c WHERE json_extract(c.value,'$.targetId')=investments.id),
 current_price_minor=(SELECT json_extract(c.value,'$.price') FROM json_each(NEW.choices_json) c WHERE json_extract(c.value,'$.targetId')=investments.id),
 notes=CASE WHEN instr(COALESCE(notes,''),(SELECT json_extract(c.value,'$.marker') FROM json_each(NEW.choices_json) c WHERE json_extract(c.value,'$.targetId')=investments.id))>0 THEN notes ELSE COALESCE(notes,'')||char(10)||(SELECT json_extract(c.value,'$.marker') FROM json_each(NEW.choices_json) c WHERE json_extract(c.value,'$.targetId')=investments.id) END,
 basis_kind='recorded',valuation_date=date(NEW.fetched_at,'+330 minutes'),ledger_version=ledger_version+1,updated_at=CURRENT_TIMESTAMP
 WHERE workspace_id=NEW.workspace_id AND id IN(SELECT json_extract(value,'$.targetId') FROM json_each(NEW.choices_json));
 UPDATE kite_sessions SET last_synced=NEW.fetched_at WHERE workspace_id=NEW.workspace_id;
END;
-- Restoring a backup invalidates transient broker sessions and pending reviews.
CREATE TRIGGER kite_clear_on_restore BEFORE INSERT ON recovery_payloads BEGIN
 DELETE FROM kite_auth WHERE workspace_id=NEW.workspace_id;
 DELETE FROM kite_sessions WHERE workspace_id=NEW.workspace_id;
 DELETE FROM kite_previews WHERE workspace_id=NEW.workspace_id;
END;
