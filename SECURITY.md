# Security Policy

## Overview

This document outlines security best practices and policies for the VisHeart Cardiac Segmentation Server. This application handles sensitive medical imaging data and requires careful attention to security configuration.

## Reporting Security Vulnerabilities

If you discover a security vulnerability, please report it by:
1. **DO NOT** open a public GitHub issue
2. Email the maintainers directly
3. Include detailed information about the vulnerability and steps to reproduce

## Critical Security Configuration

### 1. Environment Variables - Required Secrets

The following secrets **MUST** be properly configured before deploying to production:

#### SESSION_SECRET
- **Purpose**: Used to sign session cookies for user authentication
- **Requirements**: 
  - Minimum 32 characters
  - Use cryptographically secure random string
  - Never use default value `default_secret`
- **Generation**: 
  ```bash
  node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
  ```
- **Risk if compromised**: Attackers can hijack user sessions and impersonate any user

#### GPU_SERVER_AUTH_JWT_SECRET
- **Purpose**: Used to sign JWT tokens for GPU server authentication
- **Requirements**:
  - Minimum 32 characters
  - Use cryptographically secure random string
  - Never use default value `change-this`
- **Generation**: Same as SESSION_SECRET above
- **Risk if compromised**: Unauthorized access to GPU segmentation services, potential data manipulation

#### ADMIN_PASS
- **Purpose**: Default password for the admin account created on first startup
- **Requirements**:
  - Minimum 8 characters
  - Must contain at least 1 number
  - Must contain at least 1 special character
  - **Change immediately after first login**
- **Risk if compromised**: Full administrative access to the system, including all user data and projects

### 2. AWS Credentials

#### AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY
- **Purpose**: Authenticate with AWS S3 for file storage
- **Requirements**:
  - Use IAM user with minimal required permissions (S3 read/write only)
  - Enable MFA on the IAM user
  - Rotate credentials regularly (every 90 days recommended)
  - Never commit to version control
- **Risk if compromised**: Unauthorized access to all stored medical imaging files and patient data

### 3. MongoDB Connection String

#### MONGODB_URI
- **Security Requirements**:
  - Use strong, unique passwords for MongoDB users
  - Enable MongoDB authentication
  - Use connection string with credentials only in .env file
  - For production, use MongoDB Atlas with IP whitelisting
  - Enable encryption at rest
  - Enable encryption in transit (SSL/TLS)
- **Example Secure Format**: `mongodb+srv://username:password@cluster.mongodb.net/visheart?retryWrites=true&w=majority`
- **Risk if compromised**: Full access to all application data including user credentials, projects, and segmentation masks

### 4. Redis Credentials

#### REDIS_PASSWORD
- **Purpose**: Authentication for Redis session store
- **Requirements**:
  - Use strong password (minimum 20 characters)
  - Enable Redis AUTH
  - For production, use Redis Cloud or AWS ElastiCache with encryption
- **Risk if compromised**: Session hijacking, unauthorized access to user sessions

## File Security

### .env File Protection

The `.env` file contains all sensitive credentials and **MUST NEVER** be committed to version control.

**Verification checklist:**
- ✅ `.env` is listed in `.gitignore`
- ✅ `.env` is listed in `.dockerignore`
- ✅ Only `.env.template` (without actual values) is committed
- ✅ Check git history: `git log --all --full-history -- .env`

**If .env was accidentally committed:**
1. Remove the file from git history using `git filter-branch` or `BFG Repo-Cleaner`
2. Rotate ALL credentials immediately
3. Force push the cleaned history
4. Notify all team members to pull the cleaned repository

### Logs Directory

Log files may contain sensitive information and should not be committed:
- ✅ `/logs/` directory is in `.gitignore`
- ✅ Ensure logs do not contain secrets, tokens, or passwords
- ✅ Implement log rotation with secure deletion

## Code Security Best Practices

### 1. Never Log Secrets

**❌ Bad:**
```typescript
logger.info(`JWT Secret: ${jwtSecret}`);
logger.info(`Password: ${password}`);
```

**✅ Good:**
```typescript
logger.info(`JWT Secret configured: ${!!jwtSecret}`);
logger.info(`Password validation: ${isValidPassword}`);
```

### 2. Validate Secrets at Startup

The application validates critical secrets at startup and will:
- Log warnings in development if default/weak secrets are detected
- **Throw errors and refuse to start** in production if secrets are not properly configured

### 3. Production Environment Detection

The application uses `NODE_ENV=production` to enable stricter security controls:
- Secure cookies only
- Mandatory strong secrets
- Reduced logging verbosity
- CORS restrictions

## Docker Security

### Dockerfile Best Practices
- ✅ `.env` excluded via `.dockerignore`
- ✅ Use secrets management (Docker secrets, Kubernetes secrets)
- ✅ Run container as non-root user
- ✅ Scan images for vulnerabilities regularly

### Environment Variables in Docker
**Never pass secrets via:**
- `ENV` directives in Dockerfile
- Command-line `-e` flags (visible in `docker ps`)

**Instead use:**
- Docker secrets: `docker secret create`
- Environment file: `docker run --env-file .env`
- Kubernetes secrets
- AWS Systems Manager Parameter Store
- HashiCorp Vault

## Database Security

### MongoDB Security Checklist
- ✅ Enable authentication
- ✅ Use role-based access control (RBAC)
- ✅ Encrypt data at rest
- ✅ Encrypt data in transit (TLS/SSL)
- ✅ Regular backups with encryption
- ✅ IP whitelisting
- ✅ Audit logging enabled

### Redis Security Checklist
- ✅ Require password authentication
- ✅ Disable dangerous commands (FLUSHALL, CONFIG, etc.)
- ✅ Use TLS/SSL for connections
- ✅ Bind to localhost or private network only
- ✅ Enable persistence with encryption

## API Security

### Authentication
- Session-based authentication with Redis store
- Role-based access control (Guest, User, Admin)
- Session expiration (24 hours default)
- HttpOnly cookies to prevent XSS attacks
- SameSite cookie attribute to prevent CSRF

### GPU Server Communication
- JWT-based authentication between servers
- Automatic token refresh (8-minute intervals)
- Token expiration (10-minute lifetime)
- Tokens never exposed to clients

### CORS Configuration
- Development: Allow all origins for ease of development
- Production: Strict whitelist of allowed origins via `CORS_ORIGIN` environment variable

## Medical Data Security (HIPAA/GDPR Considerations)

### Data Storage
- All medical imaging files stored in encrypted S3 buckets
- Presigned URLs for temporary, time-limited access
- No patient-identifying information in filenames
- Automatic cleanup of temporary files

### Access Control
- User-based project isolation
- Guest users automatically deleted after inactivity period
- Admin-only access to user management
- Audit logging of all data access

### Data Retention
- Configurable guest inactivity threshold
- Soft delete vs hard delete policies
- Compliance with data retention regulations

## Deployment Security Checklist

Before deploying to production:

- [ ] All environment secrets configured with strong, unique values
- [ ] `NODE_ENV=production` set
- [ ] `.env` file never committed to git
- [ ] AWS IAM credentials use least-privilege access
- [ ] MongoDB authentication enabled with strong password
- [ ] Redis password authentication enabled
- [ ] SSL/TLS certificates configured for HTTPS
- [ ] CORS whitelist configured (no wildcards)
- [ ] Firewall rules configured (restrict access to necessary ports only)
- [ ] Regular security updates applied to dependencies
- [ ] Security monitoring and alerting configured
- [ ] Regular backups scheduled and tested
- [ ] Incident response plan documented

## Dependency Security

### Regular Updates
```bash
# Check for vulnerabilities
npm audit

# Check for outdated packages
npm outdated

# Update dependencies
npm update
```

### Automated Security Scanning
- GitHub Dependabot enabled for automatic dependency updates
- Regular security audits of npm packages
- Pin dependency versions in production

## Incident Response

If a security breach is suspected:

1. **Immediate Actions**
   - Rotate all credentials immediately
   - Disable compromised accounts
   - Review access logs
   - Isolate affected systems

2. **Investigation**
   - Determine scope of breach
   - Identify attack vector
   - Document timeline

3. **Remediation**
   - Patch vulnerabilities
   - Update security controls
   - Restore from clean backups if necessary

4. **Post-Incident**
   - Notify affected parties as required by law
   - Update security procedures
   - Conduct post-mortem review

## Security Testing

### Regular Testing Schedule
- Weekly: Automated dependency scanning
- Monthly: Manual security review
- Quarterly: Penetration testing
- Annually: Full security audit

### Test Environments
- Use separate credentials for test/dev environments
- Never use production secrets in test environments
- Regularly reset test environment credentials

## Additional Resources

- [OWASP Top 10](https://owasp.org/www-project-top-ten/)
- [MongoDB Security Checklist](https://www.mongodb.com/docs/manual/administration/security-checklist/)
- [Docker Security Best Practices](https://docs.docker.com/develop/security-best-practices/)
- [AWS Security Best Practices](https://aws.amazon.com/security/best-practices/)

## Contact

For security-related questions or concerns, please contact the project maintainers.

---

**Last Updated**: December 14, 2024
**Version**: 1.0
