ALTER TABLE sms_messages ADD COLUMN bank_reference TEXT NULL;

CREATE INDEX idx_sms_messages_workspace_bank_reference
  ON sms_messages(workspace_id, bank_reference);
