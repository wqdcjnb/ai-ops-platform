export const POSTGRES_ADDITIONS = `
CREATE TABLE IF NOT EXISTS data_migrations (name TEXT PRIMARY KEY, completed_at TEXT NOT NULL, summary JSONB NOT NULL);
CREATE TABLE IF NOT EXISTS external_providers (id TEXT PRIMARY KEY, configuration JSONB NOT NULL, revision INTEGER NOT NULL DEFAULT 1);
CREATE INDEX IF NOT EXISTS usage_person_time_idx ON usage_requests(owner_user_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS usage_model_time_idx ON usage_requests(actual_model, occurred_at DESC);
CREATE INDEX IF NOT EXISTS conversation_person_time_idx ON conversation_audit_records(person_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS conversation_retention_idx ON conversation_audit_records(retention_until);
CREATE INDEX IF NOT EXISTS conversation_duplicate_idx ON conversation_audit_records(person_id, key_id, prompt_hash, started_at DESC);
CREATE INDEX IF NOT EXISTS conversation_usage_request_idx ON conversation_usage_links(usage_request_id);
`
export const FINAL_SCHEMA = `
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  username TEXT NOT NULL UNIQUE,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('super_admin', 'employee')),
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS api_keys (
  id TEXT PRIMARY KEY,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  masked_value TEXT NOT NULL,
  secret_hash TEXT NOT NULL UNIQUE,
  secret_ciphertext TEXT NOT NULL,
  purpose TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'disabled', 'revoked')),
  last_used_at TEXT,
  secret_revealed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_one_active_key_per_person
  ON api_keys(owner_user_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS api_keys_owner_idx ON api_keys(owner_user_id, created_at DESC);
CREATE TABLE IF NOT EXISTS api_key_operations (
  idempotency_key TEXT PRIMARY KEY,
  person_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('create', 'reset')),
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS device_setup_tickets (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  owner_user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  api_key_id TEXT NOT NULL REFERENCES api_keys(id) ON DELETE CASCADE,
  target TEXT NOT NULL CHECK (target IN ('codex', 'workbuddy')),
  state TEXT NOT NULL CHECK (state IN ('pending', 'claimed', 'succeeded', 'failed', 'expired')),
  expires_at TEXT NOT NULL,
  claimed_at TEXT,
  completed_at TEXT,
  failure_code TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS device_setup_tickets_owner_idx ON device_setup_tickets(owner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS device_setup_tickets_expiry_idx ON device_setup_tickets(expires_at);
CREATE TABLE IF NOT EXISTS entity_deletions (
  idempotency_key TEXT PRIMARY KEY,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS usage_requests (
  request_id TEXT PRIMARY KEY,
  occurred_at TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  api_key_id TEXT NOT NULL,
  purpose_id TEXT NOT NULL,
  purpose_name TEXT NOT NULL,
  purpose_alias TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_display_name TEXT NOT NULL,
  actual_model TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  channel_name TEXT NOT NULL,
  channel_type TEXT NOT NULL CHECK (channel_type = 'official_api'),
  protocol TEXT NOT NULL CHECK (protocol IN ('chat_completions', 'responses')),
  streamed INTEGER NOT NULL CHECK (streamed IN (0, 1)),
  input_tokens INTEGER NOT NULL,
  output_tokens INTEGER NOT NULL,
  points DOUBLE PRECISION NOT NULL,
  first_token_ms INTEGER,
  total_latency_ms INTEGER NOT NULL,
  ai_ops_auth_ms INTEGER NOT NULL DEFAULT 0,
  context_compaction_ms INTEGER NOT NULL DEFAULT 0,
  upstream_first_token_ms INTEGER,
  upstream_total_ms INTEGER NOT NULL DEFAULT 0,
  context_original_chars INTEGER NOT NULL DEFAULT 0,
  context_forwarded_chars INTEGER NOT NULL DEFAULT 0,
  context_dropped_messages INTEGER NOT NULL DEFAULT 0,
  context_stripped_chars INTEGER NOT NULL DEFAULT 0,
  cost_type TEXT NOT NULL CHECK (cost_type = 'platform_estimate'),
  cost_amount_usd DOUBLE PRECISION NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'cancelled')),
  error_category TEXT,
  error_summary TEXT,
  route_alias TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  request_id_propagated INTEGER NOT NULL DEFAULT 0,
  client_name TEXT NOT NULL CHECK (client_name IN ('Codex Desktop', 'WorkBuddy')),
  client_mode TEXT NOT NULL CHECK (client_mode IN ('stream', 'non_stream'))
);
CREATE INDEX IF NOT EXISTS usage_requests_occurred_idx ON usage_requests(occurred_at DESC);
CREATE TABLE IF NOT EXISTS audit_events (
  sequence INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  id TEXT NOT NULL UNIQUE,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('success', 'failed', 'denied')),
  request_id TEXT,
  summary_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  previous_hash TEXT,
  event_hash TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_events_occurred_idx ON audit_events(occurred_at DESC);
CREATE TABLE IF NOT EXISTS audit_chain_checkpoints (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  event_count INTEGER NOT NULL,
  head_event_id TEXT,
  head_hash TEXT,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  csrf_token_hash TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  revoked_at TEXT
);
CREATE INDEX IF NOT EXISTS user_sessions_active_idx ON user_sessions(token_hash, expires_at) WHERE revoked_at IS NULL;
CREATE TABLE IF NOT EXISTS session_cleanup_runs (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('startup', 'login')),
  completed_at TEXT NOT NULL,
  deleted_expired INTEGER NOT NULL,
  deleted_revoked INTEGER NOT NULL,
  revoked_retention_hours INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_audit_records (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  captured_at TEXT NOT NULL,
  person_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  key_masked TEXT NOT NULL,
  purpose_id TEXT NOT NULL,
  purpose_label TEXT NOT NULL,
  model_id TEXT NOT NULL,
  model_label TEXT NOT NULL,
  policy_id TEXT NOT NULL,
  policy_label TEXT NOT NULL,
  policy_scope TEXT NOT NULL,
  policy_expires_at TEXT NOT NULL,
  capture_state TEXT NOT NULL CHECK (capture_state IN ('captured', 'metadata_only', 'expired')),
  redaction_status TEXT NOT NULL CHECK (redaction_status IN ('passed', 'review_required', 'not_applicable')),
  redaction_findings INTEGER NOT NULL,
  grouping_type TEXT NOT NULL CHECK (grouping_type IN ('conversation', 'independent_call')),
  grouping_reliable INTEGER NOT NULL CHECK (grouping_reliable IN (0, 1)),
  grouping_label TEXT NOT NULL,
  turns INTEGER NOT NULL,
  tool_calls INTEGER NOT NULL,
  total_tokens INTEGER NOT NULL,
  content_access_available INTEGER NOT NULL CHECK (content_access_available IN (0, 1)),
  endpoint TEXT,
  started_at TEXT,
  completed_at TEXT,
  audit_status TEXT,
  http_status INTEGER,
  prompt_body_ref TEXT,
  response_body_ref TEXT,
  prompt_bytes INTEGER,
  response_bytes INTEGER,
  retention_until TEXT,
  export_count INTEGER NOT NULL DEFAULT 0,
  streamed INTEGER NOT NULL DEFAULT 0,
  chunk_count INTEGER NOT NULL DEFAULT 0,
  termination_reason TEXT,
  prompt_hash TEXT,
  response_hash TEXT,
  capture_error TEXT,
  deleted_at TEXT
);
CREATE INDEX IF NOT EXISTS conversation_audit_records_captured_idx ON conversation_audit_records(captured_at DESC);
CREATE TABLE IF NOT EXISTS conversation_audit_contents (
  record_id TEXT PRIMARY KEY REFERENCES conversation_audit_records(id) ON DELETE CASCADE,
  prompt_ciphertext TEXT,
  response_ciphertext TEXT,
  chunks_ciphertext TEXT,
  byte_length INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversation_audit_operation_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('view', 'copy', 'export')),
  field_type TEXT NOT NULL,
  result TEXT NOT NULL CHECK (result IN ('success', 'failed', 'denied')),
  reason_length INTEGER NOT NULL,
  scope TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_access_events (
  id TEXT PRIMARY KEY,
  actor_user_id TEXT NOT NULL,
  record_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action = 'view'),
  reason_provided INTEGER NOT NULL,
  reason_length INTEGER NOT NULL,
  acknowledged_sensitive_scope INTEGER NOT NULL,
  occurred_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS conversation_audit_cleanup_runs (
  id INTEGER GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  triggered_by TEXT NOT NULL CHECK (triggered_by IN ('startup', 'scheduled')),
  completed_at TEXT NOT NULL,
  expired_records INTEGER NOT NULL,
  proof_records INTEGER NOT NULL,
  deleted_content_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversation_audit_expiry_proofs (
  record_id TEXT PRIMARY KEY,
  cleanup_run_id INTEGER NOT NULL,
  expired_at TEXT NOT NULL,
  no_content_was_stored INTEGER NOT NULL,
  notice TEXT NOT NULL,
  deleted_content_bytes INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS conversation_usage_links (
  record_id TEXT PRIMARY KEY,
  usage_request_id TEXT NOT NULL,
  link_source TEXT NOT NULL CHECK (link_source = 'gateway_capture')
);
CREATE TABLE IF NOT EXISTS conversation_audit_deletions (
  record_id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  actor_user_id TEXT NOT NULL,
  deleted_at TEXT NOT NULL,
  deleted_content_bytes INTEGER NOT NULL,
  audit_event_id TEXT NOT NULL
);
`
