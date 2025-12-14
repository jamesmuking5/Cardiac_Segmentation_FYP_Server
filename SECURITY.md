# Security Documentation

## Overview
This document outlines security measures, identified vulnerabilities, and recommendations for the Visheart Cardiac Segmentation Server.

## Security Audit Summary

**Audit Date**: 2025-12-14

### Issues Found and Fixed

#### 1. **CRITICAL - Exposed AWS Credentials in Debug Routes** ✅ FIXED
**Location**: `src/routes/debug_routes.ts` (Line 48)

**Issue**: Hardcoded AWS presigned URL containing temporary AWS credentials (access key ID: `ASIAQB4Y5V67QHZAMQHH`) and security token exposed in source code.

**Risk**: 
- Expired credentials were committed to version control
- Anyone with repository access could view these credentials
- Sets a dangerous precedent for hardcoding credentials

**Fix Applied**: 
- Removed hardcoded presigned URL
- Changed endpoint to require URL as a query parameter
- Added validation to ensure URL is provided before processing

**Recommendation**: 
- Consider removing this debug endpoint entirely in production
- If needed for testing, generate presigned URLs dynamically using the S3 service
- Never commit real credentials or presigned URLs to source code

---

#### 2. **HIGH - JWT Secret Logging** ✅ FIXED
**Location**: `src/services/gpu_auth_client.ts` (Lines 93, 270)

**Issue**: JWT secrets were being logged to application logs in two places:
1. During GPU configuration initialization (debug logging)
2. During JWT secret validation error handling

**Risk**:
- Secrets exposed in log files could be accessed by attackers
- Log aggregation systems may persist these secrets indefinitely
- Compromised logs = compromised authentication system

**Fix Applied**:
- Commented out JWT secret logging in configuration display
- Removed secret logging in error handling, replaced with generic error message
- Added security comments to prevent future logging of secrets

---

#### 3. **HIGH - Weak Default Session Secret** ✅ FIXED
**Location**: `src/services/express_app.ts` (Line 56)

**Issue**: Session secret had a fallback to `'default_secret'` if environment variable was not set.

**Risk**:
- Default secrets are publicly known and easily guessable
- Attackers could forge session cookies if default secret is used
- Session hijacking and unauthorized access possible

**Fix Applied**:
- Removed fallback default secret
- Added validation to throw error if SESSION_SECRET is not configured
- Application will fail to start if critical security configuration is missing

---

### Issues Not Found (Good Security Practices)

✅ **No .env files committed** - `.env` and `.env.fyp` are properly gitignored

✅ **No private keys in repository** - No `.pem`, `.key`, `.p12`, `.pfx` files found

✅ **Environment variable usage** - All sensitive configuration uses environment variables:
- `MONGODB_URI`
- `SESSION_SECRET`
- `GPU_SERVER_AUTH_JWT_SECRET`
- `AWS_ACCESS_KEY_ID`
- `AWS_SECRET_ACCESS_KEY`
- `REDIS_PASSWORD`

✅ **Template file only** - `.env.template` contains placeholder values, not real secrets

✅ **Admin route protection** - `src/routes/admin_tools.ts` intentionally excludes JWT secrets from API responses

✅ **No hardcoded passwords** - Test files contain commented-out test passwords only

---

## Security Best Practices

### 1. Secret Management

**DO:**
- ✅ Store all secrets in environment variables
- ✅ Use `.env` files locally (never commit them)
- ✅ Use secure secret management services in production (AWS Secrets Manager, HashiCorp Vault)
- ✅ Rotate secrets regularly
- ✅ Use strong, randomly generated secrets (min 32 characters)

**DON'T:**
- ❌ Hardcode secrets in source code
- ❌ Commit `.env` files to version control
- ❌ Log secrets to files or console
- ❌ Use default or weak secrets
- ❌ Share secrets via insecure channels (email, chat, etc.)

### 2. AWS Credentials

**Current Setup:**
- AWS credentials stored in environment variables
- Presigned URLs generated dynamically via `src/services/s3_handler.ts` and `src/utils/s3_presigned_url.ts`

**Recommendations:**
- Use IAM roles for EC2 instances in production (no need for access keys)
- Implement credential rotation policy
- Use least-privilege IAM policies
- Enable CloudTrail for audit logging
- Consider using AWS Secrets Manager for credential storage

### 3. Session Security

**Current Configuration:**
```javascript
session({
  store: redisStore,           // Sessions stored in Redis
  secret: SESSION_SECRET,       // Must be set via environment variable
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: envType === 'production',  // HTTPS only in production
    httpOnly: true,                     // Prevents XSS attacks
    sameSite: 'lax',                   // CSRF protection
    maxAge: 1000 * 60 * 60 * 24,      // 1 day expiration
  }
})
```

**Recommendations:**
- ✅ Current configuration is secure
- Consider implementing session invalidation on password change
- Monitor for suspicious session activity
- Implement rate limiting on authentication endpoints

### 4. JWT Authentication (GPU Server)

**Current Setup:**
- Self-signed JWT tokens for GPU server authentication
- Configurable via database with fallback to environment variables
- Token refresh mechanism implemented

**Security Measures:**
- Secrets validated during startup (must not be default "change-this")
- Tokens have configurable lifetime
- Secrets excluded from API responses

**Recommendations:**
- Ensure JWT secrets are at least 256 bits (32 characters)
- Implement token rotation policy
- Monitor token usage for anomalies
- Consider mutual TLS for GPU server communication

### 5. Database Security

**MongoDB:**
- Connection string stored in environment variable
- Admin user credentials seeded on startup

**Redis:**
- Password protected
- Supports Redis Cloud and AWS ElastiCache
- Used for session storage only

**Recommendations:**
- Use strong database passwords
- Enable MongoDB authentication and encryption at rest
- Restrict database network access
- Regular backups with encryption
- Monitor for unauthorized access attempts

### 6. Debug Endpoints

**Current State:**
- Debug routes exist in `src/routes/debug_routes.ts`
- Contains hardcoded local IP address (192.168.0.2) for callback URL
- Should not be exposed in production

**Recommendations:**
- ⚠️ **CRITICAL**: Disable debug routes in production
- Add environment check to prevent debug route registration
- Remove hardcoded IP addresses, use environment variables instead
- Consider implementing feature flags for debug functionality
- Use separate debug build/deployment for testing

**Example Production Protection:**
```typescript
// In src/routes/debug_routes.ts or express_app.ts
if (process.env.NODE_ENV === 'production') {
  // Do not register debug routes in production
  console.warn('Debug routes are disabled in production');
} else {
  app.use('/debug', debugRoute);
}
```

### 7. File Upload Security

**Current Measures:**
- File type validation (medical imaging formats only)
- Size limits enforced
- Temporary directories for processing
- S3 storage with presigned URLs

**Recommendations:**
- ✅ Current validation is good
- Consider virus scanning for uploaded files
- Implement rate limiting on upload endpoints
- Monitor storage usage and cleanup old files

---

## Production Deployment Checklist

Before deploying to production, ensure:

- [ ] All environment variables are set and validated
- [ ] SESSION_SECRET is a strong, random 32+ character string
- [ ] GPU_SERVER_AUTH_JWT_SECRET is a strong, random 32+ character string
- [ ] AWS credentials use IAM roles (not access keys) where possible
- [ ] Debug routes are disabled or protected (check `src/routes/debug_routes.ts`)
- [ ] HTTPS is enabled (secure cookies)
- [ ] Database credentials are rotated and strong
- [ ] Redis password is set and strong
- [ ] CORS origins are properly configured for production domains
- [ ] Rate limiting is enabled on authentication endpoints
- [ ] Logging is configured to exclude secrets
- [ ] Security headers are configured (helmet.js)
- [ ] Regular security updates are scheduled
- [ ] No hardcoded IP addresses or URLs in code
- [ ] Run dependency audit: `pnpm audit` or `npm audit`
- [ ] Review git history for accidentally committed secrets

---

## Incident Response

If you discover a security issue:

1. **DO NOT** commit the fix to a public branch immediately
2. Report to the security team or repository owner
3. Assess the severity and scope of the issue
4. Rotate any compromised credentials immediately
5. Review logs for unauthorized access
6. Deploy fix through secure channels
7. Document the incident and lessons learned

---

## Regular Security Tasks

**Weekly:**
- Review authentication logs for anomalies
- Check for failed login attempts
- Monitor API rate limits and usage

**Monthly:**
- Update dependencies (npm audit, pip security checks)
- Review access control lists
- Check for unused user accounts

**Quarterly:**
- Rotate database credentials
- Rotate JWT secrets
- Security audit of new code
- Penetration testing

**Annually:**
- Full security audit
- Update security policies
- Review and update disaster recovery plans
- Security training for team members

---

## Recommended Security Tools

### Static Analysis
- **ESLint Security Plugin**: `eslint-plugin-security` - Detect security issues in code
- **npm audit / pnpm audit**: Check for known vulnerabilities in dependencies
- **Snyk**: Continuous vulnerability monitoring

### Secret Scanning
- **git-secrets**: Prevent committing secrets to git
- **TruffleHog**: Find secrets in git history
- **GitHub Secret Scanning**: Automatically enabled for public repos

### Runtime Security
- **helmet.js**: Security headers for Express (already in use)
- **express-rate-limit**: Prevent brute force attacks
- **express-validator**: Input validation and sanitization (already in use)

### Installation Example:
```bash
# Install security tools
pnpm add -D eslint-plugin-security
pnpm add helmet express-rate-limit

# Run security audit
pnpm audit
```

---

## Contact

For security concerns or to report vulnerabilities, please contact the repository maintainers.

**Last Updated**: 2025-12-14
