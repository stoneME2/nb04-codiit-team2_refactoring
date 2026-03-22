/**
 * Security and business event types
 * Used as event field in structured logging
 *
 * @example
 * logger.warn({
 *   event: SecurityEventType.FORBIDDEN_ACCESS,
 *   userId: 'user123',
 *   storeId: 'store456',
 * }, 'Forbidden access attempt due to insufficient permissions');
 */
export enum SecurityEventType {
  /**
   * Unauthorized access attempt to protected resource
   * Triggered when: User attempts to access protected API without authentication
   */
  UNAUTHORIZED_ACCESS = 'UNAUTHORIZED_ACCESS',

  /**
   * Forbidden access attempt due to insufficient permissions
   * Triggered when: User attempts to access resource without proper authorization
   */
  FORBIDDEN_ACCESS = 'FORBIDDEN_ACCESS',

  /**
   * Duplicate resource creation attempt
   * Triggered when: User attempts to create resource that already exists
   */
  DUPLICATE_RESOURCE = 'DUPLICATE_RESOURCE',

  /**
   * Resource not found
   * Triggered when: User attempts to access non-existent resource
   */
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',

  /**
   * Business rule violation
   * Triggered when: User action violates business logic constraints
   */
  INVALID_BUSINESS_LOGIC = 'INVALID_BUSINESS_LOGIC',

  /**
   * Slow database query detected
   * Triggered when: Query execution time exceeds threshold (default: 1000ms)
   */
  SLOW_QUERY = 'SLOW_QUERY',

  /**
   * User authenticated successfully
   * Triggered when: User logs in with valid credentials
   */
  AUTHENTICATION_SUCCESS = 'AUTHENTICATION_SUCCESS',

  /**
   * Authentication failed due to invalid credentials
   * Triggered when: User provides incorrect email or password
   */
  AUTHENTICATION_FAILURE = 'AUTHENTICATION_FAILURE',

  /**
   * Access token refreshed successfully
   * Triggered when: Refresh token is used to obtain new access token
   */
  TOKEN_REFRESH_SUCCESS = 'TOKEN_REFRESH_SUCCESS',

  /**
   * Invalid authentication token provided
   * Triggered when: Token is malformed, revoked, or doesn't exist
   */
  TOKEN_INVALID = 'TOKEN_INVALID',

  /**
   * Authentication token has expired
   * Triggered when: Token validity period has elapsed
   */
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',

  /**
   * User logged out successfully
   * Triggered when: User explicitly logs out
   */
  LOGOUT_SUCCESS = 'LOGOUT_SUCCESS',

  /**
   * New user account created successfully
   * Triggered when: User completes registration process
   */
  USER_CREATED = 'USER_CREATED',

  /**
   * User profile updated
   * Triggered when: User modifies profile information (name, image, etc.)
   */
  USER_PROFILE_UPDATED = 'USER_PROFILE_UPDATED',

  /**
   * User password changed successfully
   * Triggered when: User updates password (security event)
   */
  USER_PASSWORD_CHANGED = 'USER_PASSWORD_CHANGED',

  /**
   * User account deleted
   * Triggered when: User completes account deletion process
   */
  USER_DELETED = 'USER_DELETED',

  /**
   * User grade upgraded
   * Triggered when: User cumulative purchase amount reaches upgrade threshold
   */
  USER_GRADE_UPGRADED = 'USER_GRADE_UPGRADED',

  /**
   * User grade downgraded
   * Triggered when: User grade expires or downgrade criteria met
   */
  USER_GRADE_DOWNGRADED = 'USER_GRADE_DOWNGRADED',

  /**
   * Global rate limit exceeded
   * Triggered when: IP exceeds global API request limit
   */
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',

  /**
   * Login rate limit exceeded (possible brute-force attempt)
   * Triggered when: IP exceeds failed login attempt limit
   */
  RATE_LIMIT_LOGIN_EXCEEDED = 'RATE_LIMIT_LOGIN_EXCEEDED',

  /**
   * Refresh token rate limit exceeded (possible infinite refresh loop)
   * Triggered when: IP exceeds refresh token request limit
   */
  RATE_LIMIT_REFRESH_EXCEEDED = 'RATE_LIMIT_REFRESH_EXCEEDED',

  // --- Refresh 세분화 이벤트 ---

  /**
   * Refresh cookie missing — 쿠키가 요청에 없음
   */
  TOKEN_REFRESH_COOKIE_MISSING = 'TOKEN_REFRESH_COOKIE_MISSING',

  /**
   * Refresh token JWT expired — JWT exp 초과
   */
  TOKEN_REFRESH_JWT_EXPIRED = 'TOKEN_REFRESH_JWT_EXPIRED',

  /**
   * Refresh token not found in Redis — Redis에 해시 없음 (로그아웃/만료)
   */
  TOKEN_REFRESH_REDIS_MISS = 'TOKEN_REFRESH_REDIS_MISS',

  /**
   * CAS rotation succeeded — 새 토큰 발급 및 Redis 교체 완료
   */
  TOKEN_REFRESH_ROTATED = 'TOKEN_REFRESH_ROTATED',

  /**
   * Grace period hit — 동시 요청이 캐시된 새 토큰 반환
   */
  TOKEN_REFRESH_GRACE_HIT = 'TOKEN_REFRESH_GRACE_HIT',
}
