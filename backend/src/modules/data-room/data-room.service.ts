import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Readable } from 'stream';
import * as crypto from 'crypto';
import { DataRoomConnectionEntity } from '../../database/entities/data-room-connection.entity';
import { EncryptionService } from './encryption.service';
import {
  DriveFile,
  GoogleDriveService,
  TokenSet,
} from './google-drive.service';

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

interface StoredTokens {
  accessToken: string;
  refreshToken: string;
  /** ISO-8601 string. */
  expiry: string;
  scope: string;
}

interface StatePayload {
  caseId: string;
  nonce: string;
  ts: number;
}

/**
 * Orchestrates per-case Google Drive connections:
 *
 * - signs/verifies HMAC `state` for the OAuth callback (CSRF + caseId binding)
 * - encrypts/decrypts tokens via {@link EncryptionService}
 * - delegates Drive ops to {@link GoogleDriveService}
 * - manages refresh-on-near-expiry + retry-on-401 via {@link withFreshTokens}
 *
 * Concurrent refreshes for the same connection are de-duplicated through
 * `refreshInFlight` to avoid burning single-use refresh tokens (Drive rotates
 * refresh tokens; a duplicate refresh hard-breaks the connection).
 */
@Injectable()
export class DataRoomService {
  private readonly logger = new Logger(DataRoomService.name);
  private readonly refreshInFlight = new Map<
    string,
    Promise<DataRoomConnectionEntity>
  >();

  constructor(
    @InjectRepository(DataRoomConnectionEntity)
    private readonly repo: Repository<DataRoomConnectionEntity>,
    private readonly encryption: EncryptionService,
    private readonly googleDrive: GoogleDriveService,
  ) {}

  // ----------------------------- HMAC state -----------------------------

  /** Signing key — reuses DATAROOM_ENCRYPTION_KEY (already required + 32 bytes). */
  private stateKey(): Buffer {
    const hex = process.env.DATAROOM_ENCRYPTION_KEY;
    if (!hex) {
      throw new Error('DATAROOM_ENCRYPTION_KEY is not set.');
    }
    return Buffer.from(hex, 'hex');
  }

  /**
   * HMAC-SHA256 over `caseId|nonce|ts`. Returns a single base64url string of
   * the form base64url(`caseId.nonce.ts.hmacHex`). Compact and URL-safe so it
   * survives Google's `state` round-trip without escaping.
   */
  signState({ caseId, nonce, ts }: StatePayload): string {
    const message = `${caseId}|${nonce}|${ts}`;
    const hmac = crypto
      .createHmac('sha256', this.stateKey())
      .update(message)
      .digest('hex');
    const composed = `${caseId}.${nonce}.${ts}.${hmac}`;
    return Buffer.from(composed, 'utf8').toString('base64url');
  }

  /**
   * Reverse {@link signState}. Throws `BadRequestException('invalid_state')`
   * for any tamper, parse failure, expired-ts, or HMAC mismatch.
   */
  verifyState(state: string): { caseId: string } {
    let decoded: string;
    try {
      decoded = Buffer.from(state, 'base64url').toString('utf8');
    } catch {
      throw new BadRequestException('invalid_state');
    }
    const parts = decoded.split('.');
    if (parts.length !== 4) {
      throw new BadRequestException('invalid_state');
    }
    const [caseId, nonce, tsStr, hmacHex] = parts;
    const ts = Number(tsStr);
    if (!caseId || !nonce || !Number.isFinite(ts) || !hmacHex) {
      throw new BadRequestException('invalid_state');
    }

    const expected = crypto
      .createHmac('sha256', this.stateKey())
      .update(`${caseId}|${nonce}|${ts}`)
      .digest();
    let actual: Buffer;
    try {
      actual = Buffer.from(hmacHex, 'hex');
    } catch {
      throw new BadRequestException('invalid_state');
    }
    if (
      actual.length !== expected.length ||
      !crypto.timingSafeEqual(actual, expected)
    ) {
      throw new BadRequestException('invalid_state');
    }

    const age = Date.now() - ts;
    if (age < 0 || age > STATE_TTL_MS) {
      throw new BadRequestException('invalid_state');
    }

    return { caseId };
  }

  // --------------------------- OAuth flow ---------------------------

  /** Build the Google consent URL for a given case. */
  getAuthUrl(caseId: string): string {
    const nonce = crypto.randomBytes(32).toString('base64url');
    const ts = Date.now();
    const state = this.signState({ caseId, nonce, ts });
    const url = this.googleDrive.getAuthUrl(state);
    this.logger.log(`auth_url caseId=${caseId}`);
    return url;
  }

  /**
   * Verify state, exchange code, encrypt tokens, upsert the connection row.
   * Re-connecting an existing case overwrites the old row's credentials but
   * preserves `folderId`/`folderName` so the user doesn't have to re-pick.
   */
  async handleCallback({
    code,
    state,
  }: {
    code: string;
    state: string;
  }): Promise<{ caseId: string }> {
    const { caseId } = this.verifyState(state);
    const tokens = await this.googleDrive.exchangeCode(code);
    await this.persistTokens(caseId, tokens);
    this.logger.log(`callback_success caseId=${caseId}`);
    return { caseId };
  }

  private async persistTokens(
    caseId: string,
    tokens: TokenSet,
  ): Promise<DataRoomConnectionEntity> {
    const stored: StoredTokens = {
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiry: tokens.expiry.toISOString(),
      scope: tokens.scope,
    };
    const cipher = this.encryption.encrypt(JSON.stringify(stored));

    const existing = await this.repo.findOneBy({ caseId });
    if (existing) {
      existing.credentialsCipher = cipher.ciphertext;
      existing.credentialsIv = cipher.iv;
      existing.credentialsAuthTag = cipher.authTag;
      existing.status = 'active';
      // Preserve folderId/folderName so reconnect-after-broken keeps the folder.
      return this.repo.save(existing);
    }

    const conn = this.repo.create({
      caseId,
      provider: 'google_drive',
      credentialsCipher: cipher.ciphertext,
      credentialsIv: cipher.iv,
      credentialsAuthTag: cipher.authTag,
      folderId: null,
      folderName: null,
      status: 'active',
    });
    return this.repo.save(conn);
  }

  // --------------------------- Read paths ---------------------------

  /** May return `null` so the controller can distinguish "no connection" cleanly. */
  async getConnection(caseId: string): Promise<DataRoomConnectionEntity | null> {
    return this.repo.findOneBy({ caseId });
  }

  private async requireConnection(
    caseId: string,
  ): Promise<DataRoomConnectionEntity> {
    const conn = await this.repo.findOneBy({ caseId });
    if (!conn) {
      throw new NotFoundException('connection_not_found');
    }
    return conn;
  }

  // ------------------------- Folder selection -------------------------

  async setFolder(
    caseId: string,
    folderId: string,
  ): Promise<DataRoomConnectionEntity> {
    const conn = await this.requireConnection(caseId);
    const folder = await this.withFreshTokens(conn, (token) =>
      this.googleDrive.getFolder(token, folderId),
    );
    if (folder.mimeType !== 'application/vnd.google-apps.folder') {
      throw new BadRequestException('not_a_folder');
    }
    conn.folderId = folder.id;
    conn.folderName = folder.name;
    const saved = await this.repo.save(conn);
    this.logger.log(`folder_set caseId=${caseId} folderId=${folder.id}`);
    return saved;
  }

  // --------------------------- File ops ---------------------------

  async listFiles(caseId: string): Promise<DriveFile[]> {
    const conn = await this.requireConnection(caseId);
    if (!conn.folderId) {
      throw new BadRequestException('folder_not_set');
    }
    const files = await this.withFreshTokens(conn, (token) =>
      this.googleDrive.listFiles(token, conn.folderId as string),
    );
    this.logger.log(`list_files caseId=${caseId} count=${files.length}`);
    return files;
  }

  async getFileForDownload(
    caseId: string,
    fileId: string,
  ): Promise<{ stream: Readable; name: string; mimeType: string; size: string }> {
    const conn = await this.requireConnection(caseId);
    return this.withFreshTokens(conn, async (token) => {
      const meta = await this.googleDrive.getFileMetadata(token, fileId);
      const stream = await this.googleDrive.downloadFile(token, fileId);
      this.logger.log(`download caseId=${caseId} fileId=${fileId} size=${meta.size}`);
      return { stream, ...meta };
    });
  }

  async uploadFromStream(
    caseId: string,
    name: string,
    mimeType: string,
    stream: Readable,
  ): Promise<DriveFile> {
    const conn = await this.requireConnection(caseId);
    if (!conn.folderId) {
      throw new BadRequestException('folder_not_set');
    }
    const file = await this.withFreshTokens(conn, (token) =>
      this.googleDrive.uploadFile(
        token,
        conn.folderId as string,
        name,
        mimeType,
        stream,
      ),
    );
    this.logger.log(`upload caseId=${caseId} fileId=${file.id} size=${file.size ?? '?'}`);
    return file;
  }

  // ----------------------- Picker access token -----------------------

  /**
   * Returns the connection's current access token (refreshed if near expiry)
   * along with its absolute expiry. Used by the frontend Google Drive Picker,
   * which talks to Drive directly from the browser using the user's token.
   *
   * Security: this exposes a short-lived (~1h) Google OAuth access token to
   * the case owner's browser. That's the standard pattern for Picker — the
   * controller MUST gate this with `requireOwner`.
   */
  async getAccessToken(
    caseId: string,
  ): Promise<{ accessToken: string; expiresAt: string }> {
    const conn = await this.requireConnection(caseId);
    const fresh = await this.ensureFreshTokens(conn);
    const tokens = this.decryptTokens(fresh);
    this.logger.log(`access_token_issued caseId=${caseId}`);
    return { accessToken: tokens.accessToken, expiresAt: tokens.expiry };
  }

  // --------------------------- Disconnect ---------------------------

  /**
   * Best-effort revoke; always deletes the row regardless of revoke outcome.
   * Per the plan: "always deletes the row regardless".
   */
  async disconnect(caseId: string): Promise<void> {
    const conn = await this.repo.findOneBy({ caseId });
    if (!conn) {
      // Idempotent — nothing to do.
      return;
    }
    try {
      const tokens = this.decryptTokens(conn);
      await this.googleDrive.revokeToken(tokens.refreshToken);
    } catch (err) {
      this.logger.warn(`revoke_failed caseId=${caseId} error=${(err as Error).message}`);
    }
    await this.repo.delete({ caseId });
    this.logger.log(`disconnect caseId=${caseId}`);
  }

  // ----------------- Token decrypt / refresh helpers -----------------

  private decryptTokens(conn: DataRoomConnectionEntity): StoredTokens {
    const json = this.encryption.decrypt({
      ciphertext: conn.credentialsCipher,
      iv: conn.credentialsIv,
      authTag: conn.credentialsAuthTag,
    });
    return JSON.parse(json) as StoredTokens;
  }

  /**
   * Run `fn` with a guaranteed-fresh access token. If Google rejects the call
   * with 401 (token revoked mid-flight, clock skew, etc.), forces a refresh
   * once and retries. Any other error propagates unchanged.
   */
  private async withFreshTokens<T>(
    connection: DataRoomConnectionEntity,
    fn: (accessToken: string) => Promise<T>,
  ): Promise<T> {
    const fresh = await this.ensureFreshTokens(connection);
    const tokens = this.decryptTokens(fresh);
    try {
      return await fn(tokens.accessToken);
    } catch (err) {
      if (!this.isAuthError(err)) {
        throw err;
      }
      this.logger.warn(`401_retry caseId=${fresh.caseId}`);
      const refreshed = await this.refreshIfNeeded(fresh, true);
      const retryTokens = this.decryptTokens(refreshed);
      try {
        return await fn(retryTokens.accessToken);
      } catch (retryErr) {
        // Per the plan: "if still 401, mark broken". A second 401 means the
        // refresh succeeded technically but the resulting token is still
        // unauthorized — Drive permissions revoked, scope changed, account
        // disabled. Surface as broken so the UI can prompt reconnect.
        if (this.isAuthError(retryErr)) {
          this.logger.warn(`refresh_then_401 caseId=${refreshed.caseId}`);
          refreshed.status = 'broken';
          await this.repo.save(refreshed);
          throw new ServiceUnavailableException('connection_broken');
        }
        throw retryErr;
      }
    }
  }

  private isAuthError(err: unknown): boolean {
    if (!err || typeof err !== 'object') return false;
    const e = err as { code?: number; status?: number; response?: { status?: number } };
    return (
      e.code === 401 ||
      e.status === 401 ||
      e.response?.status === 401
    );
  }

  /**
   * Returns a connection whose access token is valid for at least ~60 more
   * seconds. Refreshes inline if not. The 60s buffer absorbs clock skew + the
   * latency of the next Drive call so we don't dispatch with a token that
   * expires in flight.
   */
  private async ensureFreshTokens(
    connection: DataRoomConnectionEntity,
  ): Promise<DataRoomConnectionEntity> {
    const tokens = this.decryptTokens(connection);
    if (new Date(tokens.expiry).getTime() > Date.now() + 60_000) {
      return connection;
    }
    return this.refreshIfNeeded(connection);
  }

  /**
   * De-duplicates concurrent refreshes by connection id. If a refresh is
   * already in flight for this connection, all callers await the same
   * promise. `force=true` skips the cache and starts a new refresh — used by
   * the 401-retry path so a stale "fresh" cached promise can't loop.
   */
  private refreshIfNeeded(
    connection: DataRoomConnectionEntity,
    force = false,
  ): Promise<DataRoomConnectionEntity> {
    const key = connection.id;
    if (!force) {
      const existing = this.refreshInFlight.get(key);
      if (existing) return existing;
    }
    const p = this.doRefresh(connection).finally(() =>
      this.refreshInFlight.delete(key),
    );
    this.refreshInFlight.set(key, p);
    return p;
  }

  private async doRefresh(
    connection: DataRoomConnectionEntity,
  ): Promise<DataRoomConnectionEntity> {
    const tokens = this.decryptTokens(connection);
    try {
      const fresh = await this.googleDrive.refreshAccessToken(
        tokens.refreshToken,
      );
      const newCipher = this.encryption.encrypt(
        JSON.stringify({
          accessToken: fresh.accessToken,
          // googleapis may rotate the refresh token; if absent, keep the old.
          refreshToken: fresh.refreshToken ?? tokens.refreshToken,
          expiry: fresh.expiry.toISOString(),
          scope: tokens.scope,
        } satisfies StoredTokens),
      );
      connection.credentialsCipher = newCipher.ciphertext;
      connection.credentialsIv = newCipher.iv;
      connection.credentialsAuthTag = newCipher.authTag;
      connection.status = 'active';
      return await this.repo.save(connection);
    } catch (err) {
      this.logger.warn(
        `refresh_failed caseId=${connection.caseId} error=${(err as Error).message}`,
      );
      connection.status = 'broken';
      await this.repo.save(connection);
      throw new ServiceUnavailableException('connection_broken');
    }
  }

  // ------------------------- Role helpers -------------------------

  /**
   * Throw if `role` is `'guest'`. Centralised here so controllers all enforce
   * write-access identically.
   */
  static requireOwner(role: string | undefined): void {
    if (role === 'guest') {
      throw new ForbiddenException('write_requires_owner');
    }
  }
}
