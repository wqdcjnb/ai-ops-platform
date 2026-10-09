import { resolve } from 'node:path'
import { PostgresDatabase } from '../postgres.js'
import { migrateLegacySqlite } from '../storage-migration.js'
import {
  auditHash, bytesFor, decryptJson, decryptPlatformApiKey, encryptJson, encryptPlatformApiKey,
  hashPlatformApiKey, hashPlatformPassword, hashValue, jsonText,
} from './crypto.js'
import { FINAL_SCHEMA, POSTGRES_ADDITIONS } from './schema.js'
import { DEVICE_SETUP_TICKET_RETENTION_HOURS, REVOKED_SESSION_RETENTION_HOURS, SYSTEM_AUDIT_RETENTION_DAYS } from './types.js'
import type {
  AuditChainVerification,
  AuditCleanupResult,
  AuditCleanupTrigger,
  ConversationAuditCleanupStatus,
  ConversationAuditPurgeResult,
  DeviceSetupTicketCleanupResult,
  DeviceSetupTicketCleanupTrigger,
  PlatformApiKeyCreate,
  PlatformApiKeyReset,
  PlatformApiKeyResetResult,
  PlatformApiKeySeed,
  PlatformAuditEventSeed,
  PlatformAuthSessionCreate,
  PlatformConversationAccessCreate,
  PlatformConversationAuditCaptureInput,
  PlatformConversationAuditCompletion,
  PlatformConversationAuditContent,
  PlatformConversationAuditDeleteResult,
  PlatformConversationAuditOperation,
  PlatformConversationAuditRecord,
  PlatformConversationUsageLink,
  PlatformDatabaseOptions,
  PlatformDeviceSetupClaimResult,
  PlatformDeviceSetupState,
  PlatformDeviceSetupTicket,
  PlatformDeviceSetupTicketCreate,
  PlatformGatewayKey,
  PlatformPersonCreate,
  PlatformPersonDeleteResult,
  PlatformPersonDisableResult,
  PlatformPersonEnableResult,
  PlatformPersonPasswordResetResult,
  PlatformUsageConversationLink,
  PlatformUsageRequestSeed,
  PlatformUser,
  PlatformUserRole,
  PlatformUserSeed,
  SessionCleanupResult,
  SessionCleanupTrigger,
} from './types.js'

export class PlatformDatabase {
  readonly db: PostgresDatabase
  private readonly now: () => Date
  private readonly legacyFilename: string

  constructor(options: PlatformDatabaseOptions = {}) {
    this.db = new PostgresDatabase(options.connectionString)
    this.now = options.now ?? (() => new Date())
    this.legacyFilename = options.filename ?? process.env.PLATFORM_DB_PATH ?? resolve(process.cwd(), 'data', 'platform.sqlite')
  }

  async initialize() {
    await this.db.transaction(async () => {
      await this.db.lock('ai-ops:schema-migration')
      await this.db.exec(FINAL_SCHEMA)
      await this.db.exec(POSTGRES_ADDITIONS)
      await migrateLegacySqlite(this.db, this.legacyFilename)
      const sample = await this.db.prepare('SELECT secret_ciphertext AS ciphertext FROM api_keys WHERE secret_ciphertext IS NOT NULL LIMIT 1').get()
      if(sample && decryptPlatformApiKey(sample.ciphertext) === null) throw new Error('Stored Keys cannot be decrypted. Restore the original encryption secret; migration rolled back.')
      await this.db.query('INSERT INTO schema_migrations(version, name, applied_at) VALUES (2, $1, $2) ON CONFLICT (version) DO NOTHING', ['postgres_v1', this.now().toISOString()])
    })
    await this.cleanupAuthSessions('startup')
    await this.cleanupDeviceSetupTickets('startup')
    await this.cleanupConversationAuditMetadata('startup')
  }

  async seedUser(seed: PlatformUserSeed, now = this.now()) {
    return this.db.transaction(async () => {

      const timestamp = now.toISOString()
      await this.db.prepare('INSERT INTO users(id, username, display_name, role, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET username = excluded.username, display_name = excluded.display_name, role = excluded.role, password_hash = excluded.password_hash, status = excluded.status, updated_at = excluded.updated_at').run(
        seed.id, seed.username, seed.displayName, seed.role, hashPlatformPassword(seed.password), seed.status ?? 'active', timestamp, timestamp,
      )

    })
  }

  async seedApiKey(seed: PlatformApiKeySeed, now = this.now()) {
    return this.db.transaction(async () => {

      const timestamp = now.toISOString()
      const hash = seed.secretHash ?? (seed.secretValue ? hashPlatformApiKey(seed.secretValue) : null)
      const cipher = seed.secretValue ? encryptPlatformApiKey(seed.secretValue) : null
      if(!hash || !cipher) throw new Error('API_KEY_SECRET_REQUIRED')
      await this.db.prepare('INSERT INTO api_keys(id, owner_user_id, masked_value, secret_hash, secret_ciphertext, purpose, status, last_used_at, secret_revealed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET masked_value = excluded.masked_value, secret_hash = excluded.secret_hash, secret_ciphertext = excluded.secret_ciphertext, purpose = excluded.purpose, status = excluded.status, last_used_at = excluded.last_used_at, updated_at = excluded.updated_at').run(
        seed.id, seed.ownerUserId, seed.maskedValue, hash, cipher, seed.purpose, seed.status, seed.lastUsedAt ?? null, null, timestamp, timestamp,
      )

    })
  }

  async createPerson(person: PlatformPersonCreate, auditEvent?: PlatformAuditEventSeed, now = this.now()) {
    return this.db.transaction(async () => {

      const timestamp = now.toISOString()
      {
        await this.db.prepare('INSERT INTO users(id, username, display_name, role, password_hash, status, created_at, updated_at) VALUES (?, ?, ?, \'employee\', ?, \'active\', ?, ?)').run(
          person.id, person.username, person.displayName, hashPlatformPassword(person.password), timestamp, timestamp,
        )
        if(auditEvent) (await this.appendAuditEvent(auditEvent, now))
        return (await this.findPerson(person.id))
      }

    })
  }

  async listPeople() {
    return (await this.db.prepare('SELECT id, username, display_name AS displayName, status, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE role = \'employee\' ORDER BY created_at DESC, id DESC').all()) as Array<{
      id: string
      username: string
      displayName: string
      status: 'active' | 'disabled'
      createdAt: string
      updatedAt: string
    }>
  }

  async findPerson(id: string) {
    return (await this.db.prepare('SELECT id, username, display_name AS displayName, status, created_at AS createdAt, updated_at AS updatedAt FROM users WHERE id = ? AND role = \'employee\' LIMIT 1').get(id)) as Awaited<ReturnType<PlatformDatabase['listPeople']>>[number] | undefined ?? null
  }

  private async deletionFor(key: string) {
    return (await this.db.prepare('SELECT entity_type AS entityType, entity_id AS entityId, deleted_at AS deletedAt FROM entity_deletions WHERE idempotency_key = ?').get(key)) as { entityType: string; entityId: string; deletedAt: string } | undefined
  }

  async disablePerson(personId: string, auditEvent: PlatformAuditEventSeed, now = this.now()): Promise<PlatformPersonDisableResult | null> {
    return this.db.transaction(async () => {
      await this.db.lock('person:' + personId)

      const existingAudit = (await this.db.prepare('SELECT resource_id AS resourceId FROM audit_events WHERE id = ?').get(auditEvent.id)) as { resourceId: string | null } | undefined
      const person = (await this.findPerson(personId))
      if(existingAudit && existingAudit.resourceId !== personId) throw new Error('IDEMPOTENCY_KEY_REUSED')
      if(!person) return null
      if(existingAudit) return { state: 'disabled', idempotent: true, person: { ...person, status: 'disabled' }, keysDisabled: 0 }
      if(person.status === 'disabled') return { state: 'already_disabled', idempotent: false, person, keysDisabled: 0 }
      {
        const timestamp = now.toISOString()
        await this.db.prepare('UPDATE users SET status = \'disabled\', updated_at = ? WHERE id = ?').run(timestamp, personId)
        const keysDisabled = Number((await this.db.prepare('UPDATE api_keys SET status = \'disabled\', updated_at = ? WHERE owner_user_id = ? AND status = \'active\'').run(timestamp, personId)).changes)
        await this.appendAuditEvent(auditEvent, now)
        return { state: 'disabled', idempotent: false, person: { ...person, status: 'disabled', updatedAt: timestamp }, keysDisabled }
      }

    })
  }

  async enablePerson(personId: string, auditEvent: PlatformAuditEventSeed, now = this.now()): Promise<PlatformPersonEnableResult | null> {
    return this.db.transaction(async () => {
      await this.db.lock('person:' + personId)

      const existingAudit = (await this.db.prepare('SELECT resource_id AS resourceId FROM audit_events WHERE id = ?').get(auditEvent.id)) as { resourceId: string | null } | undefined
      const person = (await this.findPerson(personId))
      if(existingAudit && existingAudit.resourceId !== personId) throw new Error('IDEMPOTENCY_KEY_REUSED')
      if(!person) return null
      if(existingAudit) return { state: 'enabled', idempotent: true, person: { ...person, status: 'active' }, keysEnabled: 0 }
      if(person.status === 'active') return { state: 'already_enabled', idempotent: false, person, keysEnabled: 0 }
      {
        const timestamp = now.toISOString()
        await this.db.prepare('UPDATE users SET status = \'active\', updated_at = ? WHERE id = ?').run(timestamp, personId)
        const active = (await this.db.prepare('SELECT id FROM api_keys WHERE owner_user_id = ? AND status = \'active\' LIMIT 1').get(personId))
        const keysEnabled = active ? 0 : Number((await this.db.prepare('UPDATE api_keys SET status = \'active\', updated_at = ? WHERE owner_user_id = ? AND status = \'disabled\'').run(timestamp, personId)).changes)
        await this.appendAuditEvent(auditEvent, now)
        return { state: 'enabled', idempotent: false, person: { ...person, status: 'active', updatedAt: timestamp }, keysEnabled }
      }

    })
  }

  async resetPersonPassword(personId: string, auditEvent: PlatformAuditEventSeed, now = this.now()): Promise<PlatformPersonPasswordResetResult | null> {
    return this.db.transaction(async () => {
      await this.db.lock('person:' + personId)

      const prior = (await this.db.prepare('SELECT resource_id AS resourceId FROM audit_events WHERE id = ?').get(auditEvent.id)) as { resourceId: string | null } | undefined
      const person = (await this.findPerson(personId))
      if(prior && prior.resourceId !== personId) throw new Error('IDEMPOTENCY_KEY_REUSED')
      if(!person) return null
      if(prior) return { idempotent: true, person: { id: person.id, displayName: person.displayName } }
      {
        await this.db.prepare('UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?').run(hashPlatformPassword('123456'), now.toISOString(), personId)
        await this.appendAuditEvent(auditEvent, now)
        return { idempotent: false, person: { id: person.id, displayName: person.displayName } }
      }

    })
  }

  async deletePerson(personId: string, auditEvent: PlatformAuditEventSeed, now = this.now()): Promise<PlatformPersonDeleteResult | null> {
    return this.db.transaction(async () => {
      await this.db.lock('person:' + personId)

      const prior = (await this.deletionFor(auditEvent.id))
      if(prior && (prior.entityType !== 'person' || prior.entityId !== personId)) throw new Error('IDEMPOTENCY_KEY_REUSED')
      if(prior) return { state: 'deleted', idempotent: true, person: { id: personId, displayName: '' } }
      const person = (await this.findPerson(personId))
      if(!person) return null
      if(person.status !== 'disabled') return { state: 'not_disabled', idempotent: false, person: { id: person.id, displayName: person.displayName } }
      {
        const timestamp = now.toISOString()
        await this.db.prepare('DELETE FROM users WHERE id = ?').run(personId)
        await this.db.prepare('INSERT INTO entity_deletions(idempotency_key, entity_type, entity_id, deleted_at) VALUES (?, \'person\', ?, ?)').run(auditEvent.id, personId, timestamp)
        await this.appendAuditEvent(auditEvent, now)
        return { state: 'deleted', idempotent: false, person: { id: person.id, displayName: person.displayName } }
      }

    })
  }

  async listApiKeys(ownerUserId?: string) {
    return (await this.db.prepare('SELECT k.id, k.owner_user_id AS ownerUserId, k.masked_value AS maskedValue, k.purpose, k.status, k.last_used_at AS lastUsedAt, k.secret_revealed_at AS secretRevealedAt, k.created_at AS createdAt, k.updated_at AS updatedAt, u.display_name AS ownerName FROM api_keys k JOIN users u ON u.id = k.owner_user_id WHERE (?::text IS NULL OR k.owner_user_id = ?) ORDER BY k.created_at DESC, k.id DESC').all(ownerUserId ?? null, ownerUserId ?? null)) as Array<{
      id: string
      ownerUserId: string
      maskedValue: string
      purpose: string
      status: 'active' | 'disabled' | 'revoked'
      lastUsedAt: string | null
      secretRevealedAt: string | null
      createdAt: string
      updatedAt: string
      ownerName: string
    }>
  }

  async listApiKeysForOwner(ownerUserId: string) {
    return this.listApiKeys(ownerUserId)
  }

  async findApiKeyOperation(idempotencyKey: string) {
    return (await this.db.prepare('SELECT person_id AS personId, key_id AS keyId, action FROM api_key_operations WHERE idempotency_key = ?').get(idempotencyKey)) as { personId: string; keyId: string; action: 'create' | 'reset' } | undefined ?? null
  }

  async createApiKey(key: PlatformApiKeyCreate, auditEvent?: PlatformAuditEventSeed, now = this.now()) {
    return this.db.transaction(async () => {
      await this.db.lock('person:' + key.ownerUserId)

      const timestamp = now.toISOString()
      const secretHash = key.secretHash ?? (key.secretValue ? hashPlatformApiKey(key.secretValue) : null)
      const secretCiphertext = key.secretValue ? encryptPlatformApiKey(key.secretValue) : null
      if(!secretHash || !secretCiphertext) throw new Error('API_KEY_SECRET_REQUIRED')
      {
        await this.db.prepare('INSERT INTO api_keys(id, owner_user_id, masked_value, secret_hash, secret_ciphertext, purpose, status, last_used_at, secret_revealed_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          key.id, key.ownerUserId, key.maskedValue, secretHash, secretCiphertext, key.purpose, key.status ?? 'active', key.lastUsedAt ?? null, key.secretRevealedAt ?? null, key.createdAt ?? timestamp, timestamp,
        )
        if(key.idempotencyKey) (await this.db.prepare('INSERT INTO api_key_operations(idempotency_key, person_id, key_id, action, created_at) VALUES (?, ?, ?, \'create\', ?)').run(key.idempotencyKey, key.ownerUserId, key.id, timestamp))
        if(auditEvent) (await this.appendAuditEvent(auditEvent, now))
        return (await this.listApiKeys()).find((item) => item.id === key.id) ?? null
      }

    })
  }

  async readApiKeySecret(keyId: string) {
    const row = (await this.db.prepare('SELECT secret_ciphertext AS secretCiphertext FROM api_keys WHERE id = ? LIMIT 1').get(keyId)) as { secretCiphertext: string } | undefined
    return row ? decryptPlatformApiKey(row.secretCiphertext) : null
  }

  async resetApiKey(keyId: string, replacement: PlatformApiKeyReset, auditEvent: PlatformAuditEventSeed, now = this.now()): Promise<PlatformApiKeyResetResult | null> {
    return this.db.transaction(async () => {
      await this.db.lock('key:' + keyId)

      const prior = (await this.db.prepare('SELECT resource_id AS resourceId FROM audit_events WHERE id = ?').get(auditEvent.id)) as { resourceId: string | null } | undefined
      const key = (await this.listApiKeys()).find((item) => item.id === keyId) ?? null
      if(prior && prior.resourceId !== keyId) throw new Error('IDEMPOTENCY_KEY_REUSED')
      if(!key) return null
      if(prior) return { state: 'reset', idempotent: true, key, secret: (await this.readApiKeySecret(keyId)) }
      if(key.status === 'disabled' || key.status === 'revoked') return { state: 'already_disabled', idempotent: false, key, secret: null }
      {
        const timestamp = now.toISOString()
        await this.db.prepare('UPDATE api_keys SET masked_value = ?, secret_hash = ?, secret_ciphertext = ?, status = \'active\', secret_revealed_at = ?, updated_at = ? WHERE id = ?').run(
          replacement.maskedValue, replacement.secretHash, encryptPlatformApiKey(replacement.secretValue), timestamp, timestamp, keyId,
        )
        await this.db.prepare('INSERT INTO api_key_operations(idempotency_key, person_id, key_id, action, created_at) VALUES (?, ?, ?, \'reset\', ?)').run(auditEvent.id, key.ownerUserId, keyId, timestamp)
        await this.appendAuditEvent(auditEvent, now)
        const updated = (await this.listApiKeys()).find((item) => item.id === keyId)
        if(!updated) throw new Error('API_KEY_RESET_MISSING')
        return { state: 'reset', idempotent: false, key: updated, secret: replacement.secretValue }
      }

    })
  }

  private async expireDeviceSetupTickets(now = this.now()) {
    const timestamp = now.toISOString()
    return Number((await this.db.prepare("UPDATE device_setup_tickets SET state = 'expired', completed_at = COALESCE(completed_at, ?) WHERE state IN ('pending', 'claimed') AND expires_at <= ?").run(timestamp, timestamp)).changes)
  }

  async cleanupDeviceSetupTickets(triggeredBy: DeviceSetupTicketCleanupTrigger, now = this.now()): Promise<DeviceSetupTicketCleanupResult> {
    const completedAt = now.toISOString()
    const expiredTickets = (await this.expireDeviceSetupTickets(now))
    const deleteBefore = new Date(now.getTime() - DEVICE_SETUP_TICKET_RETENTION_HOURS * 3_600_000).toISOString()
    const deletedTickets = Number((await this.db.prepare('DELETE FROM device_setup_tickets WHERE expires_at <= ?').run(deleteBefore)).changes)
    return { triggeredBy, completedAt, expiredTickets, deletedTickets }
  }

  private async readDeviceSetupTicket(id: string) {
    return (await this.db.prepare('SELECT id, owner_user_id AS ownerUserId, api_key_id AS apiKeyId, target, state, expires_at AS expiresAt, claimed_at AS claimedAt, completed_at AS completedAt, failure_code AS failureCode, created_at AS createdAt FROM device_setup_tickets WHERE id = ? LIMIT 1').get(id)) as PlatformDeviceSetupTicket | undefined ?? null
  }

  async createDeviceSetupTicket(ticket: PlatformDeviceSetupTicketCreate, now = this.now()) {
    await this.cleanupDeviceSetupTickets('create', now)
    const timestamp = now.toISOString()
    await this.db.prepare("INSERT INTO device_setup_tickets(id, token_hash, owner_user_id, api_key_id, target, state, expires_at, claimed_at, completed_at, failure_code, created_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, NULL, NULL, NULL, ?)").run(
      ticket.id,
      ticket.tokenHash,
      ticket.ownerUserId,
      ticket.apiKeyId,
      ticket.target,
      ticket.expiresAt,
      timestamp,
    )
    return (await this.readDeviceSetupTicket(ticket.id))
  }

  async findDeviceSetupTicketForOwner(id: string, ownerUserId: string, now = this.now()) {
    await this.expireDeviceSetupTickets(now)
    return (await this.db.prepare('SELECT id, owner_user_id AS ownerUserId, api_key_id AS apiKeyId, target, state, expires_at AS expiresAt, claimed_at AS claimedAt, completed_at AS completedAt, failure_code AS failureCode, created_at AS createdAt FROM device_setup_tickets WHERE id = ? AND owner_user_id = ? LIMIT 1').get(id, ownerUserId)) as PlatformDeviceSetupTicket | undefined ?? null
  }

  async claimDeviceSetupTicket(tokenHash: string, now = this.now()): Promise<PlatformDeviceSetupClaimResult> {
    return this.db.transaction(async () => {
      await this.db.lock('ticket:' + tokenHash)

      await this.expireDeviceSetupTickets(now)
      const timestamp = now.toISOString()
      {
        const row = (await this.db.prepare("SELECT t.id, t.owner_user_id AS ownerUserId, t.api_key_id AS apiKeyId, t.target, t.state, t.expires_at AS expiresAt, t.claimed_at AS claimedAt, t.completed_at AS completedAt, t.failure_code AS failureCode, t.created_at AS createdAt, k.status AS keyStatus, u.status AS userStatus FROM device_setup_tickets t JOIN api_keys k ON k.id = t.api_key_id JOIN users u ON u.id = t.owner_user_id WHERE t.token_hash = ? LIMIT 1").get(tokenHash)) as (PlatformDeviceSetupTicket & { keyStatus: 'active' | 'disabled' | 'revoked'; userStatus: 'active' | 'disabled' }) | undefined
        if(!row) {
          return { state: 'not_found', ticket: null, secret: null }
        }
        const ticket: PlatformDeviceSetupTicket = {
          id: row.id,
          ownerUserId: row.ownerUserId,
          apiKeyId: row.apiKeyId,
          target: row.target,
          state: row.state,
          expiresAt: row.expiresAt,
          claimedAt: row.claimedAt,
          completedAt: row.completedAt,
          failureCode: row.failureCode,
          createdAt: row.createdAt,
        }
        if(ticket.state === 'expired' || ticket.expiresAt <= timestamp) {
          if(ticket.state !== 'expired') (await this.db.prepare("UPDATE device_setup_tickets SET state = 'expired', completed_at = COALESCE(completed_at, ?) WHERE id = ?").run(timestamp, ticket.id))
          return { state: 'expired', ticket: { ...ticket, state: 'expired', completedAt: ticket.completedAt ?? timestamp }, secret: null }
        }
        if(ticket.state !== 'pending') {
          return { state: ticket.state === 'claimed' ? 'already_claimed' : 'expired', ticket, secret: null }
        }
        if(row.keyStatus !== 'active' || row.userStatus !== 'active') {
          await this.db.prepare("UPDATE device_setup_tickets SET state = 'failed', completed_at = ?, failure_code = 'KEY_UNAVAILABLE' WHERE id = ?").run(timestamp, ticket.id)
          return { state: 'unavailable', ticket: { ...ticket, state: 'failed', completedAt: timestamp, failureCode: 'KEY_UNAVAILABLE' }, secret: null }
        }
        const secret = (await this.readApiKeySecret(ticket.apiKeyId))
        if(!secret) {
          await this.db.prepare("UPDATE device_setup_tickets SET state = 'failed', completed_at = ?, failure_code = 'SECRET_UNAVAILABLE' WHERE id = ?").run(timestamp, ticket.id)
          return { state: 'unavailable', ticket: { ...ticket, state: 'failed', completedAt: timestamp, failureCode: 'SECRET_UNAVAILABLE' }, secret: null }
        }
        await this.db.prepare("UPDATE device_setup_tickets SET state = 'claimed', claimed_at = ? WHERE id = ? AND state = 'pending'").run(timestamp, ticket.id)
        return { state: 'claimed', ticket: { ...ticket, state: 'claimed', claimedAt: timestamp }, secret }
      }

    })
  }

  async completeDeviceSetupTicket(tokenHash: string, succeeded: boolean, now = this.now(), failureCode = 'LOCAL_CONFIG_WRITE_FAILED') {
    return this.db.transaction(async () => {
      await this.db.lock('ticket:' + tokenHash)

      await this.expireDeviceSetupTickets(now)
      const row = (await this.db.prepare('SELECT id, state, expires_at AS expiresAt FROM device_setup_tickets WHERE token_hash = ? LIMIT 1').get(tokenHash)) as { id: string; state: PlatformDeviceSetupState; expiresAt: string } | undefined
      if(!row) return null
      if(row.state === 'succeeded' || row.state === 'failed' || row.state === 'expired') return (await this.readDeviceSetupTicket(row.id))
      if(row.state !== 'claimed' || row.expiresAt <= now.toISOString()) return null
      const timestamp = now.toISOString()
      await this.db.prepare("UPDATE device_setup_tickets SET state = ?, completed_at = ?, failure_code = ? WHERE id = ? AND state = 'claimed'").run(
        succeeded ? 'succeeded' : 'failed',
        timestamp,
        succeeded ? null : failureCode,
        row.id,
      )
      return (await this.readDeviceSetupTicket(row.id))

    })
  }

  async findGatewayKey(secret: string, now = this.now()): Promise<PlatformGatewayKey | null> {
    const row = (await this.db.prepare('SELECT k.id, k.owner_user_id AS ownerUserId, u.display_name AS ownerName, k.masked_value AS maskedValue, k.purpose FROM api_keys k JOIN users u ON u.id = k.owner_user_id WHERE k.secret_hash = ? AND k.status = \'active\' AND u.status = \'active\' LIMIT 1').get(hashPlatformApiKey(secret))) as Omit<PlatformGatewayKey, 'status'> | undefined
    if(!row) return null
    await this.db.prepare('UPDATE api_keys SET last_used_at = ?, updated_at = ? WHERE id = ?').run(now.toISOString(), now.toISOString(), row.id)
    return { ...row, status: 'active' }
  }

  async seedUsageRequest(seed: PlatformUsageRequestSeed) {
    await this.insertUsageRequest(seed)
  }

  async recordGatewayUsage(seed: PlatformUsageRequestSeed, auditEvent: PlatformAuditEventSeed, now = this.now()) {
    return this.db.transaction(async () => {

      {
        await this.insertUsageRequest(seed)
        const record = (await this.db.prepare('SELECT id FROM conversation_audit_records WHERE request_id = ?').get(seed.requestId)) as { id: string } | undefined
        if(record) (await this.db.prepare('INSERT INTO conversation_usage_links(record_id, usage_request_id, link_source) VALUES (?, ?, \'gateway_capture\') ON CONFLICT (record_id) DO UPDATE SET usage_request_id = excluded.usage_request_id, link_source = excluded.link_source').run(record.id, seed.requestId))
        await this.appendAuditEvent(auditEvent, now)
      }

    })
  }

  private async insertUsageRequest(seed: PlatformUsageRequestSeed) {
    const context = seed.context ?? { originalChars: 0, forwardedChars: 0, droppedMessages: 0, strippedChars: 0 }
    const latency = seed.latency
    await this.db.prepare('INSERT INTO usage_requests(request_id, occurred_at, owner_user_id, api_key_id, purpose_id, purpose_name, purpose_alias, model_id, model_display_name, actual_model, channel_id, channel_name, channel_type, protocol, streamed, input_tokens, output_tokens, points, first_token_ms, total_latency_ms, ai_ops_auth_ms, context_compaction_ms, upstream_first_token_ms, upstream_total_ms, context_original_chars, context_forwarded_chars, context_dropped_messages, context_stripped_chars, cost_type, cost_amount_usd, status, error_category, error_summary, route_alias, retry_count, request_id_propagated, client_name, client_mode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (request_id) DO UPDATE SET occurred_at = excluded.occurred_at, owner_user_id = excluded.owner_user_id, api_key_id = excluded.api_key_id, purpose_id = excluded.purpose_id, purpose_name = excluded.purpose_name, purpose_alias = excluded.purpose_alias, model_id = excluded.model_id, model_display_name = excluded.model_display_name, actual_model = excluded.actual_model, channel_id = excluded.channel_id, channel_name = excluded.channel_name, channel_type = excluded.channel_type, protocol = excluded.protocol, streamed = excluded.streamed, input_tokens = excluded.input_tokens, output_tokens = excluded.output_tokens, points = excluded.points, first_token_ms = excluded.first_token_ms, total_latency_ms = excluded.total_latency_ms, ai_ops_auth_ms = excluded.ai_ops_auth_ms, context_compaction_ms = excluded.context_compaction_ms, upstream_first_token_ms = excluded.upstream_first_token_ms, upstream_total_ms = excluded.upstream_total_ms, context_original_chars = excluded.context_original_chars, context_forwarded_chars = excluded.context_forwarded_chars, context_dropped_messages = excluded.context_dropped_messages, context_stripped_chars = excluded.context_stripped_chars, cost_type = excluded.cost_type, cost_amount_usd = excluded.cost_amount_usd, status = excluded.status, error_category = excluded.error_category, error_summary = excluded.error_summary, route_alias = excluded.route_alias, retry_count = excluded.retry_count, request_id_propagated = excluded.request_id_propagated, client_name = excluded.client_name, client_mode = excluded.client_mode').run(
      seed.requestId, seed.occurredAt, seed.ownerUserId, seed.apiKeyId, seed.purpose.id, seed.purpose.name, seed.purpose.alias, seed.model.id, seed.model.displayName, seed.model.actualModel, seed.channel.id, seed.channel.name, seed.channel.type, seed.protocol ?? 'chat_completions', Number(Boolean(seed.streamed)), seed.tokens.input, seed.tokens.output, seed.points, latency.firstTokenMs, latency.totalMs, latency.aiOpsAuthMs ?? 0, latency.contextCompactionMs ?? 0, latency.upstreamFirstTokenMs ?? null, latency.upstreamTotalMs ?? 0, context.originalChars, context.forwardedChars, context.droppedMessages, context.strippedChars, seed.cost.type, seed.cost.amountUsd, seed.status, seed.error?.category ?? null, seed.error?.summary ?? null, seed.routeAlias, seed.retryCount ?? 0, Number(Boolean(seed.requestIdPropagated)), seed.client.name, seed.client.mode,
    )
  }

  async listUsageRequests() {
    return (await this.db.prepare('SELECT r.request_id AS requestId, r.occurred_at AS occurredAt, r.owner_user_id AS personId, COALESCE(u.display_name, \'已删除员工\') AS personName, r.api_key_id AS keyId, COALESCE(k.masked_value, \'已删除 Key\') AS maskedValue, r.purpose_id AS purposeId, r.purpose_name AS purposeName, r.purpose_alias AS purposeAlias, r.model_id AS modelId, r.model_display_name AS modelDisplayName, r.actual_model AS actualModel, r.channel_id AS channelId, r.channel_name AS channelName, r.protocol, r.streamed, r.input_tokens AS inputTokens, r.output_tokens AS outputTokens, r.points, r.first_token_ms AS firstTokenMs, r.total_latency_ms AS totalLatencyMs, r.ai_ops_auth_ms AS aiOpsAuthMs, r.context_compaction_ms AS contextCompactionMs, r.upstream_first_token_ms AS upstreamFirstTokenMs, r.upstream_total_ms AS upstreamTotalMs, r.context_original_chars AS contextOriginalChars, r.context_forwarded_chars AS contextForwardedChars, r.context_dropped_messages AS contextDroppedMessages, r.context_stripped_chars AS contextStrippedChars, r.cost_amount_usd AS costAmountUsd, r.status, r.error_category AS errorCategory, r.error_summary AS errorSummary, r.route_alias AS routeAlias, r.retry_count AS retryCount, r.request_id_propagated AS requestIdPropagated, r.client_name AS clientName, r.client_mode AS clientMode FROM usage_requests r LEFT JOIN users u ON u.id = r.owner_user_id LEFT JOIN api_keys k ON k.id = r.api_key_id ORDER BY r.occurred_at DESC, r.request_id DESC').all()) as Array<{
      requestId: string; occurredAt: string; personId: string; personName: string; keyId: string; maskedValue: string
      purposeId: string; purposeName: string; purposeAlias: string; modelId: string; modelDisplayName: string; actualModel: string
      channelId: string; channelName: string; protocol: 'chat_completions' | 'responses'; streamed: number
      inputTokens: number; outputTokens: number; points: number; firstTokenMs: number | null; totalLatencyMs: number
      aiOpsAuthMs: number; contextCompactionMs: number; upstreamFirstTokenMs: number | null; upstreamTotalMs: number
      contextOriginalChars: number; contextForwardedChars: number; contextDroppedMessages: number; contextStrippedChars: number
      costAmountUsd: number; status: 'succeeded' | 'failed' | 'cancelled'; errorCategory: 'rate_limit' | 'timeout' | 'authentication' | 'server' | 'cancelled' | null; errorSummary: string | null
      routeAlias: string; retryCount: number; requestIdPropagated: number; clientName: 'Codex Desktop' | 'WorkBuddy'; clientMode: 'stream' | 'non_stream'
    }>
  }

  async appendAuditEvent(seed: PlatformAuditEventSeed, now = this.now()) {
    return this.db.transaction(async () => {
      await this.db.lock('ai-ops:audit-chain')

      const prior = (await this.db.prepare('SELECT id FROM audit_events WHERE id = ?').get(seed.id))
      if(prior) return
      const checkpoint = (await this.db.prepare('SELECT event_count AS eventCount, head_hash AS headHash FROM audit_chain_checkpoints WHERE id = 1').get()) as { eventCount: number; headHash: string | null } | undefined
      const previousHash = checkpoint?.headHash ?? null
      const occurredAt = now.toISOString()
      const summaryJson = jsonText(seed.summary)
      const eventHash = auditHash({
        id: seed.id,
        actorUserId: seed.actorUserId ?? null,
        action: seed.action,
        resourceType: seed.resourceType,
        resourceId: seed.resourceId ?? null,
        result: seed.result,
        requestId: seed.requestId ?? null,
        summaryJson,
        occurredAt,
      }, previousHash)
      await this.db.prepare('INSERT INTO audit_events(id, actor_user_id, action, resource_type, resource_id, result, request_id, summary_json, occurred_at, previous_hash, event_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        seed.id, seed.actorUserId ?? null, seed.action, seed.resourceType, seed.resourceId ?? null, seed.result, seed.requestId ?? null, summaryJson, occurredAt, previousHash, eventHash,
      )
      const eventCount = (checkpoint?.eventCount ?? 0) + 1
      await this.db.prepare('INSERT INTO audit_chain_checkpoints(id, event_count, head_event_id, head_hash, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET event_count = excluded.event_count, head_event_id = excluded.head_event_id, head_hash = excluded.head_hash, updated_at = excluded.updated_at').run(eventCount, seed.id, eventHash, occurredAt)

    })
  }

  async seedAuditEvent(seed: PlatformAuditEventSeed, now = this.now()) {
    await this.appendAuditEvent(seed, now)
  }

  async listAuditEvents() {
    const rows = (await this.db.prepare('SELECT e.id, e.actor_user_id AS actorUserId, u.display_name AS actorName, u.role AS actorRole, e.action, e.resource_type AS resourceType, e.resource_id AS resourceId, e.result, e.request_id AS requestId, e.summary_json AS summaryJson, e.occurred_at AS occurredAt FROM audit_events e LEFT JOIN users u ON u.id = e.actor_user_id ORDER BY e.sequence DESC').all()) as Array<{
      id: string; actorUserId: string | null; actorName: string | null; actorRole: PlatformUserRole | null; action: string; resourceType: string; resourceId: string | null; result: 'success' | 'failed' | 'denied'; requestId: string | null; summaryJson: string; occurredAt: string
    }>
    return rows.map((row) => {
      let summary: Record<string, unknown> = {}
      try { summary = JSON.parse(row.summaryJson) as Record<string, unknown> } catch { }
      return { ...row, summary }
    })
  }

  async cleanupAuditEvents(triggeredBy: AuditCleanupTrigger, now = this.now()): Promise<AuditCleanupResult> {
    return this.db.transaction(async () => {
      await this.db.lock('ai-ops:audit-chain')

      const completedAt = now.toISOString()
      const cutoffAt = new Date(now.getTime() - SYSTEM_AUDIT_RETENTION_DAYS * 86_400_000).toISOString()
      {
        const deletedEvents = Number((await this.db.prepare('DELETE FROM audit_events WHERE occurred_at < ?').run(cutoffAt)).changes)
        if(deletedEvents > 0) await this.rebuildAuditCheckpoint(completedAt)
        const retainedEvents = Number(((await this.db.prepare('SELECT COUNT(*) AS count FROM audit_events').get()) as { count: number }).count)
        return { triggeredBy, completedAt, cutoffAt, deletedEvents, retainedEvents }
      }

    })
  }

  async clearAuditEvents() {
    return this.db.transaction(async () => {
      await this.db.lock('ai-ops:audit-chain')

      {
        await this.db.exec('DELETE FROM audit_events; DELETE FROM audit_chain_checkpoints;')
      }

    })
  }

  private async rebuildAuditCheckpoint(updatedAt: string) {
    const rows = (await this.db.prepare('SELECT sequence, id, actor_user_id AS actorUserId, action, resource_type AS resourceType, resource_id AS resourceId, result, request_id AS requestId, summary_json AS summaryJson, occurred_at AS occurredAt FROM audit_events ORDER BY sequence ASC').all()) as Array<{
      sequence: number; id: string; actorUserId: string | null; action: string; resourceType: string; resourceId: string | null; result: string; requestId: string | null; summaryJson: string; occurredAt: string
    }>
    let previousHash: string | null = null
    for(const row of rows) {
      const eventHash = auditHash(row, previousHash)
      await this.db.prepare('UPDATE audit_events SET previous_hash = ?, event_hash = ? WHERE sequence = ?').run(previousHash, eventHash, row.sequence)
      previousHash = eventHash
    }
    if(!rows.length) {
      await this.db.prepare('DELETE FROM audit_chain_checkpoints WHERE id = 1').run()
      return
    }
    const head = rows[rows.length - 1]!
    await this.db.prepare('INSERT INTO audit_chain_checkpoints(id, event_count, head_event_id, head_hash, updated_at) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET event_count = excluded.event_count, head_event_id = excluded.head_event_id, head_hash = excluded.head_hash, updated_at = excluded.updated_at').run(rows.length, head.id, previousHash, updatedAt)
  }

  async verifyAuditChain(now = this.now()): Promise<AuditChainVerification> {
    return this.db.transaction(async () => {
      const rows = (await this.db.prepare('SELECT sequence, id, actor_user_id AS actorUserId, action, resource_type AS resourceType, resource_id AS resourceId, result, request_id AS requestId, summary_json AS summaryJson, occurred_at AS occurredAt, previous_hash AS previousHash, event_hash AS eventHash FROM audit_events ORDER BY sequence ASC').all()) as Array<{
        sequence: number; id: string; actorUserId: string | null; action: string; resourceType: string; resourceId: string | null; result: string; requestId: string | null; summaryJson: string; occurredAt: string; previousHash: string | null; eventHash: string | null
      }>
      let previousHash: string | null = null
      let firstInvalidEventId: string | null = null
      for(const row of rows) {
        const expected = auditHash(row, previousHash)
        if(row.previousHash !== previousHash || row.eventHash !== expected) {
          firstInvalidEventId = row.id
          break
        }
        previousHash = expected
      }
      const checkpoint = (await this.db.prepare('SELECT event_count AS eventCount, head_event_id AS headEventId, head_hash AS headHash, updated_at AS updatedAt FROM audit_chain_checkpoints WHERE id = 1').get()) as { eventCount: number; headEventId: string | null; headHash: string | null; updatedAt: string } | undefined
      const hashChainVerified = firstInvalidEventId === null
      const checkpointVerified = rows.length === 0
        ? !checkpoint
        : Boolean(checkpoint && checkpoint.eventCount === rows.length && checkpoint.headEventId === rows[rows.length - 1]!.id && checkpoint.headHash === previousHash)
      return {
        algorithm: 'sha256',
        verified: hashChainVerified && checkpointVerified,
        hashChainVerified,
        checkpointVerified,
        checkedAt: now.toISOString(),
        checkpointUpdatedAt: checkpoint?.updatedAt ?? null,
        eventCount: rows.length,
        firstInvalidEventId,
      }
    }, true)
  }

  async startConversationAuditCapture(input: PlatformConversationAuditCaptureInput) {
    return this.db.transaction(async () => {
      await this.db.lock('conversation-start:' + input.keyId)

      const existing = (await this.db.prepare('SELECT id FROM conversation_audit_records WHERE request_id = ?').get(input.requestId)) as { id: string } | undefined
      if(existing) return (await this.getConversationAuditRecordById(existing.id))
      const prompt = input.prompt ?? null
      const promptHash = prompt === null ? null : hashValue(prompt)
      const retryCutoff = new Date(new Date(input.startedAt).getTime() - 10_000).toISOString()
      if(promptHash) {
        const duplicate = (await this.db.prepare('SELECT id FROM conversation_audit_records WHERE person_id = ? AND key_id = ? AND prompt_hash = ? AND started_at >= ? AND COALESCE(audit_status, \'streaming\') <> \'failed\' ORDER BY started_at DESC LIMIT 1').get(
          input.personId, input.keyId, promptHash, retryCutoff,
        )) as { id: string } | undefined
        if(duplicate) return null
      }
      const capturedAt = input.startedAt
      const retentionUntil = input.retentionUntil ?? new Date(new Date(capturedAt).getTime() + 30 * 86_400_000).toISOString()
      const promptAvailable = prompt !== null
      {
        const values = [
          input.id, input.requestId, capturedAt, input.personId, input.keyId, input.keyMasked,
          input.purpose, input.purpose, input.model, input.model, 'gateway-default', '网关对话审计',
          'ai_ops', retentionUntil, promptAvailable ? 'captured' : 'metadata_only',
          promptAvailable ? 'passed' : 'not_applicable', 0, input.groupingType ?? 'independent_call',
          Number(Boolean(input.groupingReliable)), input.groupingLabel ?? '独立调用', 0, 0, 0,
          Number(promptAvailable), input.endpoint, input.startedAt, null, 'streaming', input.httpStatus ?? null,
          promptAvailable ? 'prompt:' + input.id : null, null, promptAvailable ? bytesFor(prompt) : null,
          null, retentionUntil, 0, Number(input.streamed), 0, null, promptHash, null, null, null,
        ]
        await this.db.prepare('INSERT INTO conversation_audit_records(id, request_id, captured_at, person_id, key_id, key_masked, purpose_id, purpose_label, model_id, model_label, policy_id, policy_label, policy_scope, policy_expires_at, capture_state, redaction_status, redaction_findings, grouping_type, grouping_reliable, grouping_label, turns, tool_calls, total_tokens, content_access_available, endpoint, started_at, completed_at, audit_status, http_status, prompt_body_ref, response_body_ref, prompt_bytes, response_bytes, retention_until, export_count, streamed, chunk_count, termination_reason, prompt_hash, response_hash, capture_error, deleted_at) VALUES (' + new Array(42).fill('?').join(', ') + ')').run(...values)
        if(promptAvailable) (await this.db.prepare('INSERT INTO conversation_audit_contents(record_id, prompt_ciphertext, response_ciphertext, chunks_ciphertext, byte_length) VALUES (?, ?, NULL, NULL, ?)').run(input.id, encryptJson(prompt), bytesFor(prompt)))
        return (await this.getConversationAuditRecordById(input.id))
      }

    })
  }

  async completeConversationAuditCapture(requestId: string, completion: PlatformConversationAuditCompletion) {
    return this.db.transaction(async () => {

      const record = (await this.db.prepare('SELECT id, prompt_bytes AS promptBytes FROM conversation_audit_records WHERE request_id = ? AND audit_status = \'streaming\' AND capture_state <> \'expired\' FOR UPDATE').get(requestId)) as { id: string; promptBytes: number | null } | undefined
      if(!record) return null
      const response = completion.response ?? null
      const chunks = completion.responseChunks ?? []
      const responseAvailable = response !== null
      const responseBytes = completion.responseBytes ?? (responseAvailable ? bytesFor(response) : null)
      {
        const existing = (await this.db.prepare('SELECT prompt_ciphertext AS promptCiphertext, chunks_ciphertext AS chunksCiphertext, byte_length AS byteLength FROM conversation_audit_contents WHERE record_id = ?').get(record.id)) as { promptCiphertext: string | null; chunksCiphertext: string | null; byteLength: number } | undefined
        const mergedChunks = chunks.length ? chunks : (Array.isArray(decryptJson(existing?.chunksCiphertext)) ? decryptJson(existing?.chunksCiphertext) as unknown[] : [])
        if(existing || responseAvailable || mergedChunks.length) {
          await this.db.prepare('INSERT INTO conversation_audit_contents(record_id, prompt_ciphertext, response_ciphertext, chunks_ciphertext, byte_length) VALUES (?, ?, ?, ?, ?) ON CONFLICT(record_id) DO UPDATE SET response_ciphertext = excluded.response_ciphertext, chunks_ciphertext = excluded.chunks_ciphertext, byte_length = excluded.byte_length').run(
            record.id, existing?.promptCiphertext ?? null, responseAvailable ? encryptJson(response) : null, mergedChunks.length ? encryptJson(mergedChunks) : null, (existing?.byteLength ?? 0) + (responseBytes ?? 0),
          )
        }
        await this.db.prepare('UPDATE conversation_audit_records SET completed_at = ?, audit_status = ?, http_status = ?, capture_state = ?, content_access_available = ?, response_body_ref = ?, response_bytes = ?, turns = ?, tool_calls = ?, total_tokens = ?, chunk_count = ?, termination_reason = ?, response_hash = ?, capture_error = ? WHERE id = ?').run(
          completion.completedAt, completion.status, completion.httpStatus ?? null, responseAvailable || record.promptBytes ? 'captured' : 'metadata_only', Number(Boolean(responseAvailable || record.promptBytes)), responseAvailable ? 'response:' + record.id : null, responseBytes, completion.turns ?? 0, completion.toolCalls ?? 0, completion.totalTokens ?? 0, mergedChunks.length, completion.terminationReason ?? null, responseAvailable ? hashValue(response) : null, completion.captureError ?? null, record.id,
        )
        return (await this.getConversationAuditRecordById(record.id))
      }

    })
  }

  private async readConversationRecord(id: string) {
    return (await this.db.prepare('SELECT r.id, r.request_id AS requestId, r.captured_at AS capturedAt, r.person_id AS personId, COALESCE(u.display_name, \'已删除员工\') AS personName, r.key_id AS keyId, r.key_masked AS keyMasked, r.purpose_id AS purposeId, r.purpose_label AS purposeLabel, r.model_id AS modelId, r.model_label AS modelLabel, usage.actual_model AS actualModel, r.policy_id AS policyId, r.policy_label AS policyLabel, r.policy_scope AS policyScope, r.policy_expires_at AS policyExpiresAt, r.capture_state AS state, r.redaction_status AS redactionStatus, r.redaction_findings AS redactionFindings, r.grouping_type AS groupingType, r.grouping_reliable AS groupingReliable, r.grouping_label AS groupingLabel, r.turns, r.tool_calls AS toolCalls, r.total_tokens AS totalTokens, r.content_access_available AS contentAccessAvailable, r.endpoint, r.started_at AS startedAt, r.completed_at AS completedAt, r.audit_status AS auditStatus, r.http_status AS httpStatus, r.prompt_body_ref AS promptBodyRef, r.response_body_ref AS responseBodyRef, r.prompt_bytes AS promptBytes, r.response_bytes AS responseBytes, r.retention_until AS retentionUntil, r.export_count AS exportCount, r.streamed, r.chunk_count AS chunkCount, r.termination_reason AS terminationReason, r.prompt_hash AS promptHash, r.response_hash AS responseHash, r.capture_error AS captureError, r.deleted_at AS deletedAt FROM conversation_audit_records r LEFT JOIN users u ON u.id = r.person_id LEFT JOIN conversation_usage_links l ON l.record_id = r.id LEFT JOIN usage_requests usage ON usage.request_id = l.usage_request_id WHERE r.id = ? LIMIT 1').get(id)) as PlatformConversationAuditRecord | undefined
  }

  async checkpointConversationChunks(recordId: string, chunks: unknown[]) {
    // Update only a live record. A checkpoint can never recreate deleted or
    // expired conversation content.
    await this.db.prepare("UPDATE conversation_audit_contents SET chunks_ciphertext=? WHERE record_id=? AND EXISTS (SELECT 1 FROM conversation_audit_records r WHERE r.id=record_id AND r.audit_status='streaming' AND r.capture_state='captured')").run(encryptJson(chunks), recordId)
  }

  async getConversationAuditRecordById(id: string) {
    return (await this.readConversationRecord(id)) ?? null
  }

  async listConversationAuditRecords() {
    return (await this.db.prepare('SELECT r.id, r.request_id AS requestId, r.captured_at AS capturedAt, r.person_id AS personId, COALESCE(u.display_name, \'已删除员工\') AS personName, r.key_id AS keyId, r.key_masked AS keyMasked, r.purpose_id AS purposeId, r.purpose_label AS purposeLabel, r.model_id AS modelId, r.model_label AS modelLabel, usage.actual_model AS actualModel, r.policy_id AS policyId, r.policy_label AS policyLabel, r.policy_scope AS policyScope, r.policy_expires_at AS policyExpiresAt, r.capture_state AS state, r.redaction_status AS redactionStatus, r.redaction_findings AS redactionFindings, r.grouping_type AS groupingType, r.grouping_reliable AS groupingReliable, r.grouping_label AS groupingLabel, r.turns, r.tool_calls AS toolCalls, r.total_tokens AS totalTokens, r.content_access_available AS contentAccessAvailable, r.endpoint, r.started_at AS startedAt, r.completed_at AS completedAt, r.audit_status AS auditStatus, r.http_status AS httpStatus, r.prompt_body_ref AS promptBodyRef, r.response_body_ref AS responseBodyRef, r.prompt_bytes AS promptBytes, r.response_bytes AS responseBytes, r.retention_until AS retentionUntil, r.export_count AS exportCount, r.streamed, r.chunk_count AS chunkCount, r.termination_reason AS terminationReason, r.prompt_hash AS promptHash, r.response_hash AS responseHash, r.capture_error AS captureError, r.deleted_at AS deletedAt FROM conversation_audit_records r LEFT JOIN users u ON u.id = r.person_id LEFT JOIN conversation_usage_links l ON l.record_id = r.id LEFT JOIN usage_requests usage ON usage.request_id = l.usage_request_id ORDER BY r.captured_at DESC, r.id DESC').all()) as PlatformConversationAuditRecord[]
  }

  async getConversationAuditContent(recordId: string): Promise<PlatformConversationAuditContent | null> {
    const record = (await this.readConversationRecord(recordId))
    if(!record || record.deletedAt || record.contentAccessAvailable !== 1) return null
    const content = (await this.db.prepare('SELECT prompt_ciphertext AS promptCiphertext, response_ciphertext AS responseCiphertext, chunks_ciphertext AS chunksCiphertext FROM conversation_audit_contents WHERE record_id = ?').get(recordId)) as { promptCiphertext: string | null; responseCiphertext: string | null; chunksCiphertext: string | null } | undefined
    if(!content) return null
    const prompt = decryptJson(content.promptCiphertext)
    const response = decryptJson(content.responseCiphertext)
    const chunks = decryptJson(content.chunksCiphertext)
    return {
      prompt,
      response,
      chunks: Array.isArray(chunks) ? chunks : [],
      promptAvailable: prompt !== null,
      responseAvailable: response !== null,
      promptBytes: record.promptBytes,
      responseBytes: record.responseBytes,
      promptHash: record.promptHash,
      responseHash: record.responseHash,
    }
  }

  async recordConversationAuditOperation(operation: PlatformConversationAuditOperation, now = this.now(), auditEvent?: PlatformAuditEventSeed) {
    return this.db.transaction(async () => {

      {
        await this.db.prepare('INSERT INTO conversation_audit_operation_events(id, actor_user_id, record_id, request_id, key_id, action, field_type, result, reason_length, scope, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          operation.id, operation.actorUserId, operation.recordId, operation.requestId, operation.keyId, operation.action, operation.fieldType, operation.result, operation.reasonLength, operation.scope, now.toISOString(),
        )
        if(auditEvent) (await this.appendAuditEvent(auditEvent, now))
      }

    })
  }

  async listConversationAuditOperations(recordId?: string) {
    return (await this.db.prepare('SELECT e.id, e.actor_user_id AS actorUserId, COALESCE(u.display_name, \'已删除用户\') AS actorName, e.record_id AS recordId, e.request_id AS requestId, e.key_id AS keyId, e.action, e.field_type AS fieldType, e.result, e.reason_length AS reasonLength, e.scope, e.occurred_at AS occurredAt FROM conversation_audit_operation_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE (?::text IS NULL OR e.record_id = ?) ORDER BY e.occurred_at DESC, e.id DESC LIMIT 50').all(recordId ?? null, recordId ?? null)) as unknown as Array<PlatformConversationAuditOperation & { actorName: string; occurredAt: string }>
  }

  async recordConversationAccess(event: PlatformConversationAccessCreate, now = this.now(), auditEvent?: PlatformAuditEventSeed) {
    return this.db.transaction(async () => {

      {
        await this.db.prepare('INSERT INTO conversation_access_events(id, actor_user_id, record_id, request_id, action, reason_provided, reason_length, acknowledged_sensitive_scope, occurred_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
          event.id, event.actorUserId, event.recordId, event.requestId, event.action, Number(event.reasonProvided), event.reasonLength, Number(event.acknowledgedSensitiveScope), now.toISOString(),
        )
        if(auditEvent) (await this.appendAuditEvent(auditEvent, now))
        return { id: event.id, occurredAt: now.toISOString() }
      }

    })
  }

  async listConversationAccessEvents(recordId?: string) {
    return (await this.db.prepare('SELECT e.id, e.actor_user_id AS actorUserId, COALESCE(u.display_name, \'已删除用户\') AS actorName, e.record_id AS recordId, e.request_id AS requestId, e.action, e.reason_provided AS reasonProvided, e.reason_length AS reasonLength, e.acknowledged_sensitive_scope AS acknowledgedSensitiveScope, e.occurred_at AS occurredAt FROM conversation_access_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE (?::text IS NULL OR e.record_id = ?) ORDER BY e.occurred_at DESC, e.id DESC LIMIT 20').all(recordId ?? null, recordId ?? null)) as Array<{
      id: string; actorUserId: string; actorName: string; recordId: string; requestId: string; action: 'view'; reasonProvided: number; reasonLength: number; acknowledgedSensitiveScope: number; occurredAt: string
    }>
  }

  async incrementConversationAuditExportCount(recordId: string) {
    await this.db.prepare('UPDATE conversation_audit_records SET export_count = export_count + 1 WHERE id = ?').run(recordId)
  }

  async deleteConversationAuditRecord(recordId: string, auditEvent: PlatformAuditEventSeed, now = this.now()): Promise<PlatformConversationAuditDeleteResult | null> {
    return this.db.transaction(async () => {
      await this.db.lock('conversation-delete:' + recordId)
      await this.db.prepare('SELECT id FROM conversation_audit_records WHERE id = ? FOR UPDATE').get(recordId)

      const prior = (await this.db.prepare('SELECT request_id AS requestId, deleted_at AS deletedAt, deleted_content_bytes AS deletedContentBytes, audit_event_id AS auditEventId FROM conversation_audit_deletions WHERE record_id = ?').get(recordId)) as { requestId: string; deletedAt: string; deletedContentBytes: number; auditEventId: string } | undefined
      if(prior) return { id: recordId, requestId: prior.requestId, deletedAt: prior.deletedAt, deletedContentBytes: prior.deletedContentBytes, auditEventId: prior.auditEventId, idempotent: true }
      const record = (await this.readConversationRecord(recordId))
      if(!record || record.contentAccessAvailable !== 1) return null
      const content = (await this.db.prepare('SELECT byte_length AS byteLength FROM conversation_audit_contents WHERE record_id = ?').get(recordId)) as { byteLength: number } | undefined
      const deletedAt = now.toISOString()
      {
        const deletedContentBytes = content?.byteLength ?? 0
        await this.db.prepare('DELETE FROM conversation_audit_contents WHERE record_id = ?').run(recordId)
        await this.db.prepare('DELETE FROM conversation_audit_operation_events WHERE record_id = ?').run(recordId)
        await this.db.prepare('DELETE FROM conversation_access_events WHERE record_id = ?').run(recordId)
        await this.db.prepare('DELETE FROM conversation_usage_links WHERE record_id = ?').run(recordId)
        await this.db.prepare('DELETE FROM conversation_audit_expiry_proofs WHERE record_id = ?').run(recordId)
        await this.db.prepare('DELETE FROM conversation_audit_records WHERE id = ?').run(recordId)
        await this.db.prepare('INSERT INTO conversation_audit_deletions(record_id, request_id, actor_user_id, deleted_at, deleted_content_bytes, audit_event_id) VALUES (?, ?, ?, ?, ?, ?)').run(recordId, record.requestId, auditEvent.actorUserId ?? 'user-super-admin', deletedAt, deletedContentBytes, auditEvent.id)
        await this.appendAuditEvent(auditEvent, now)
        return { id: recordId, requestId: record.requestId, deletedAt, deletedContentBytes, auditEventId: auditEvent.id, idempotent: false }
      }

    })
  }

  async getConversationUsageLink(recordId: string): Promise<PlatformConversationUsageLink | null> {
    return (await this.db.prepare('SELECT usage_request_id AS usageRequestId, link_source AS linkSource FROM conversation_usage_links WHERE record_id = ?').get(recordId)) as PlatformConversationUsageLink | undefined ?? null
  }

  async getUsageConversationLink(usageRequestId: string): Promise<PlatformUsageConversationLink | null> {
    return (await this.db.prepare('SELECT record_id AS recordId, link_source AS linkSource FROM conversation_usage_links WHERE usage_request_id = ?').get(usageRequestId)) as PlatformUsageConversationLink | undefined ?? null
  }

  async purgeConversationAuditRecordsBefore(cutoff: Date | string): Promise<ConversationAuditPurgeResult> {
    return this.db.transaction(async () => {

      const parsed = cutoff instanceof Date ? cutoff : new Date(cutoff)
      if(Number.isNaN(parsed.getTime())) throw new Error('CONVERSATION_AUDIT_PURGE_CUTOFF_INVALID')
      const cutoffAt = parsed.toISOString()
      const records = (await this.db.prepare('SELECT id FROM conversation_audit_records WHERE captured_at < ?').all(cutoffAt)) as Array<{ id: string }>
      if(!records.length) return { cutoffAt, deletedRecords: 0, deletedContents: 0, deletedOperationEvents: 0, deletedAccessEvents: 0, deletedUsageLinks: 0, deletedExpiryProofs: 0 }
      const placeholders = records.map(() => '?').join(',')
      const ids = records.map((item) => item.id)
      {
        const deletedOperationEvents = Number((await this.db.prepare('DELETE FROM conversation_audit_operation_events WHERE record_id IN (' + placeholders + ')').run(...ids)).changes)
        const deletedAccessEvents = Number((await this.db.prepare('DELETE FROM conversation_access_events WHERE record_id IN (' + placeholders + ')').run(...ids)).changes)
        const deletedUsageLinks = Number((await this.db.prepare('DELETE FROM conversation_usage_links WHERE record_id IN (' + placeholders + ')').run(...ids)).changes)
        const deletedExpiryProofs = Number((await this.db.prepare('DELETE FROM conversation_audit_expiry_proofs WHERE record_id IN (' + placeholders + ')').run(...ids)).changes)
        const deletedContents = Number((await this.db.prepare('DELETE FROM conversation_audit_contents WHERE record_id IN (' + placeholders + ')').run(...ids)).changes)
        const deletedRecords = Number((await this.db.prepare('DELETE FROM conversation_audit_records WHERE id IN (' + placeholders + ')').run(...ids)).changes)
        return { cutoffAt, deletedRecords, deletedContents, deletedOperationEvents, deletedAccessEvents, deletedUsageLinks, deletedExpiryProofs }
      }

    })
  }

  async cleanupConversationAuditMetadata(triggeredBy: 'startup' | 'scheduled', now = this.now()) {
    return this.db.transaction(async () => {
      await this.db.lock('ai-ops:conversation-retention')

      const completedAt = now.toISOString()
      const candidates = (await this.db.prepare('SELECT id FROM conversation_audit_records WHERE retention_until <= ? AND capture_state = \'captured\' FOR UPDATE SKIP LOCKED').all(completedAt)) as Array<{ id: string }>
      if(!candidates.length) return { triggeredBy, completedAt, expiredRecords: 0, proofRecords: 0, deletedContentBytes: 0 }
      {
        const run = (await this.db.prepare('INSERT INTO conversation_audit_cleanup_runs(triggered_by, completed_at, expired_records, proof_records, deleted_content_bytes) VALUES (?, ?, 0, ?, 0) RETURNING id').run(triggeredBy, completedAt, candidates.length)) as { lastInsertRowid: number }
        let deletedContentBytes = 0
        for(const item of candidates) {
          const bytes = (await this.db.prepare('SELECT byte_length AS byteLength FROM conversation_audit_contents WHERE record_id = ?').get(item.id)) as { byteLength: number } | undefined
          deletedContentBytes += bytes?.byteLength ?? 0
          await this.db.prepare('DELETE FROM conversation_audit_contents WHERE record_id = ?').run(item.id)
          await this.db.prepare('UPDATE conversation_audit_records SET capture_state = \'expired\', content_access_available = 0 WHERE id = ?').run(item.id)
          await this.db.prepare('INSERT INTO conversation_audit_expiry_proofs(record_id, cleanup_run_id, expired_at, no_content_was_stored, notice, deleted_content_bytes) VALUES (?, ?, ?, 1, ?, ?) ON CONFLICT (record_id) DO UPDATE SET cleanup_run_id = excluded.cleanup_run_id, expired_at = excluded.expired_at, no_content_was_stored = excluded.no_content_was_stored, notice = excluded.notice, deleted_content_bytes = excluded.deleted_content_bytes').run(item.id, Number(run.lastInsertRowid), completedAt, '正文已按 30 天策略删除。', bytes?.byteLength ?? 0)
        }
        await this.db.prepare('UPDATE conversation_audit_cleanup_runs SET expired_records = ?, deleted_content_bytes = ? WHERE id = ?').run(candidates.length, deletedContentBytes, Number(run.lastInsertRowid))
        return { triggeredBy, completedAt, expiredRecords: candidates.length, proofRecords: candidates.length, deletedContentBytes }
      }

    })
  }

  async getConversationAuditCleanupStatus(): Promise<ConversationAuditCleanupStatus> {
    const proofRecords = Number(((await this.db.prepare('SELECT COUNT(*) AS count FROM conversation_audit_expiry_proofs').get()) as { count: number }).count)
    const lastRun = (await this.db.prepare('SELECT triggered_by AS triggeredBy, completed_at AS completedAt, expired_records AS expiredRecords, proof_records AS proofRecords FROM conversation_audit_cleanup_runs ORDER BY id DESC LIMIT 1').get()) as ConversationAuditCleanupStatus['lastRun'] | undefined
    return { proofRecords, lastRun: lastRun ?? null }
  }

  async createAuthSession(session: PlatformAuthSessionCreate, now = this.now()) {
    await this.db.prepare('INSERT INTO user_sessions(id, user_id, token_hash, csrf_token_hash, expires_at, created_at, revoked_at) VALUES (?, ?, ?, ?, ?, ?, NULL)').run(session.id, session.userId, session.tokenHash, session.csrfTokenHash, session.expiresAt, now.toISOString())
  }

  async findAuthSession(tokenHash: string, now = this.now()) {
    const row = (await this.db.prepare('SELECT s.id AS sessionId, s.csrf_token_hash AS csrfTokenHash, s.expires_at AS expiresAt, u.id AS userId, u.username, u.display_name AS displayName, u.role, u.status FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = \'active\' LIMIT 1').get(tokenHash, now.toISOString())) as {
      sessionId: string; csrfTokenHash: string; expiresAt: string; userId: string; username: string; displayName: string; role: PlatformUserRole; status: 'active' | 'disabled'
    } | undefined
    if(!row) return null
    return { id: row.sessionId, csrfTokenHash: row.csrfTokenHash, expiresAt: row.expiresAt, user: { id: row.userId, username: row.username, displayName: row.displayName, role: row.role, roleLabel: '', status: row.status } }
  }

  async isAuthSessionCsrfValid(tokenHash: string, csrfTokenHash: string, now = this.now()) {
    return Boolean((await this.db.prepare('SELECT 1 FROM user_sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.csrf_token_hash = ? AND s.revoked_at IS NULL AND s.expires_at > ? AND u.status = \'active\' LIMIT 1').get(tokenHash, csrfTokenHash, now.toISOString())))
  }

  async revokeAuthSession(tokenHash: string, now = this.now()) {
    await this.db.prepare('UPDATE user_sessions SET revoked_at = COALESCE(revoked_at, ?) WHERE token_hash = ?').run(now.toISOString(), tokenHash)
  }

  async cleanupAuthSessions(triggeredBy: SessionCleanupTrigger, now = this.now()): Promise<SessionCleanupResult> {
    return this.db.transaction(async () => {

      const completedAt = now.toISOString()
      const revokedBefore = new Date(now.getTime() - REVOKED_SESSION_RETENTION_HOURS * 3_600_000).toISOString()
      {
        const deletedExpired = Number((await this.db.prepare('DELETE FROM user_sessions WHERE expires_at <= ?').run(completedAt)).changes)
        const deletedRevoked = Number((await this.db.prepare('DELETE FROM user_sessions WHERE revoked_at IS NOT NULL AND revoked_at <= ?').run(revokedBefore)).changes)
        await this.db.prepare('INSERT INTO session_cleanup_runs(triggered_by, completed_at, deleted_expired, deleted_revoked, revoked_retention_hours) VALUES (?, ?, ?, ?, ?)').run(triggeredBy, completedAt, deletedExpired, deletedRevoked, REVOKED_SESSION_RETENTION_HOURS)
        return { triggeredBy, completedAt, deletedExpired, deletedRevoked, revokedRetentionHours: REVOKED_SESSION_RETENTION_HOURS }
      }

    })
  }

  async tableCounts() {
    const count = async (table: string) => Number(((await this.db.prepare('SELECT COUNT(*) AS count FROM ' + table).get()) as { count: number }).count)
    return {
      users: await count('users'),
      apiKeys: await count('api_keys'),
      deviceSetupTickets: await count('device_setup_tickets'),
      entityDeletions: await count('entity_deletions'),
      auditEvents: await count('audit_events'),
      usageRequests: await count('usage_requests'),
      conversationAccessEvents: await count('conversation_access_events'),
      conversationAuditRecords: await count('conversation_audit_records'),
      conversationAuditDeletions: await count('conversation_audit_deletions'),
      conversationAuditCleanupRuns: await count('conversation_audit_cleanup_runs'),
      conversationAuditExpiryProofs: await count('conversation_audit_expiry_proofs'),
      conversationUsageLinks: await count('conversation_usage_links'),
      userSessions: await count('user_sessions'),
      sessionCleanupRuns: await count('session_cleanup_runs'),
    }
  }

  async findUserByUsername(username: string) {
    return (await this.db.prepare('SELECT id, username, display_name AS displayName, role, status FROM users WHERE username = ? LIMIT 1').get(username)) as PlatformUser | undefined ?? null
  }

  async findUserByRole(role: PlatformUserRole) {
    return (await this.db.prepare('SELECT id, username, display_name AS displayName, role, status FROM users WHERE role = ? AND status = \'active\' ORDER BY created_at, id LIMIT 1').get(role)) as PlatformUser | undefined ?? null
  }

  async userExists(userId: string) {
    return Boolean((await this.db.prepare('SELECT 1 FROM users WHERE id = ? LIMIT 1').get(userId)))
  }

  async passwordMatches(username: string, password: string) {
    const row = (await this.db.prepare('SELECT password_hash AS passwordHash FROM users WHERE username = ? AND status = \'active\' LIMIT 1').get(username)) as { passwordHash: string } | undefined
    return Boolean(row && row.passwordHash === hashPlatformPassword(password))
  }

  async close() {
    await this.db.close()
  }
}

export async function createPlatformDatabase(options: PlatformDatabaseOptions = {}) {
  const database = new PlatformDatabase(options)
  try { await database.initialize(); return database } catch(error) { await database.close(); throw error }
}
