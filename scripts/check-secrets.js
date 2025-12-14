#!/usr/bin/env node
/**
 * Security validation script for VisHeart Server
 * 
 * This script checks for common security misconfigurations:
 * - Weak or default secrets
 * - Missing required environment variables
 * - Insecure production configurations
 * 
 * Run this before deploying to production!
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// ANSI color codes for terminal output
const colors = {
  reset: '\x1b[0m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  bold: '\x1b[1m',
};

function log(message, color = 'reset') {
  console.log(`${colors[color]}${message}${colors.reset}`);
}

function logSection(title) {
  console.log('\n' + '='.repeat(60));
  log(title, 'bold');
  console.log('='.repeat(60) + '\n');
}

// Load environment variables from .env file
function loadEnvFile() {
  const envPath = path.join(__dirname, '..', '.env');
  
  if (!fs.existsSync(envPath)) {
    log('❌ ERROR: .env file not found!', 'red');
    log('   Create .env file by copying .env.example', 'yellow');
    return null;
  }
  
  const envContent = fs.readFileSync(envPath, 'utf8');
  const env = {};
  
  envContent.split('\n').forEach(line => {
    const trimmed = line.trim();
    if (trimmed && !trimmed.startsWith('#')) {
      const [key, ...valueParts] = trimmed.split('=');
      if (key && valueParts.length > 0) {
        env[key.trim()] = valueParts.join('=').trim();
      }
    }
  });
  
  return env;
}

// Check if a value appears to be a weak or default secret
function isWeakSecret(value, fieldName) {
  if (!value) return { weak: true, reason: 'Empty or missing' };
  
  const weakPatterns = [
    { pattern: /^change[-_]?this/i, reason: 'Default placeholder value' },
    { pattern: /^your[-_]?/i, reason: 'Placeholder value not replaced' },
    { pattern: /^default/i, reason: 'Default value' },
    { pattern: /^test/i, reason: 'Test value' },
    { pattern: /^password/i, reason: 'Common weak pattern' },
    { pattern: /^secret/i, reason: 'Common weak pattern' },
    { pattern: /^admin/i, reason: 'Common weak pattern' },
    { pattern: /^123/i, reason: 'Sequential numbers' },
  ];
  
  for (const { pattern, reason } of weakPatterns) {
    if (pattern.test(value)) {
      return { weak: true, reason };
    }
  }
  
  // Check minimum length for secrets
  if (fieldName.includes('SECRET') || fieldName.includes('PASSWORD')) {
    if (value.length < 16) {
      return { weak: true, reason: 'Too short (< 16 characters)' };
    }
    if (value.length < 32 && (fieldName.includes('SECRET'))) {
      return { weak: true, reason: 'Should be at least 32 characters' };
    }
  }
  
  return { weak: false };
}

// Validate all critical secrets
function validateSecrets(env) {
  logSection('🔐 Checking Critical Secrets');
  
  const criticalSecrets = [
    { name: 'SESSION_SECRET', required: true },
    { name: 'GPU_SERVER_AUTH_JWT_SECRET', required: true },
    { name: 'ADMIN_PASS', required: true },
    { name: 'REDIS_PASSWORD', required: true },
  ];
  
  let hasErrors = false;
  let hasWarnings = false;
  
  criticalSecrets.forEach(({ name, required }) => {
    const value = env[name];
    
    if (!value) {
      if (required) {
        log(`❌ ${name}: MISSING - This is required!`, 'red');
        hasErrors = true;
      } else {
        log(`⚠️  ${name}: Not set`, 'yellow');
        hasWarnings = true;
      }
      return;
    }
    
    const { weak, reason } = isWeakSecret(value, name);
    if (weak) {
      log(`❌ ${name}: WEAK - ${reason}`, 'red');
      hasErrors = true;
    } else {
      log(`✅ ${name}: OK`, 'green');
    }
  });
  
  return { hasErrors, hasWarnings };
}

// Validate AWS credentials
function validateAWSCredentials(env) {
  logSection('☁️  Checking AWS Credentials');
  
  const awsVars = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_BUCKET_NAME'];
  let hasErrors = false;
  
  awsVars.forEach(varName => {
    const value = env[varName];
    
    if (!value) {
      log(`⚠️  ${varName}: Not set`, 'yellow');
      return;
    }
    
    // Check for example/placeholder values
    if (value.includes('EXAMPLE') || value.includes('your-')) {
      log(`❌ ${varName}: Contains placeholder text`, 'red');
      hasErrors = true;
      return;
    }
    
    // Validate AWS_ACCESS_KEY_ID format
    if (varName === 'AWS_ACCESS_KEY_ID') {
      if (!/^AKIA[0-9A-Z]{16}$/.test(value)) {
        log(`⚠️  ${varName}: Format doesn't match typical AWS access key`, 'yellow');
      } else {
        log(`✅ ${varName}: Format looks correct`, 'green');
      }
    } else {
      log(`✅ ${varName}: Set`, 'green');
    }
  });
  
  return { hasErrors };
}

// Check for production-specific requirements
function validateProductionConfig(env) {
  logSection('🏭 Production Configuration Checks');
  
  const nodeEnv = env.NODE_ENV || 'development';
  log(`Environment: ${nodeEnv}`, nodeEnv === 'production' ? 'yellow' : 'blue');
  
  if (nodeEnv !== 'production') {
    log('ℹ️  Not in production mode - skipping production-specific checks', 'blue');
    return { hasErrors: false };
  }
  
  let hasErrors = false;
  
  // Check MongoDB URI for production
  if (env.MONGODB_URI) {
    if (env.MONGODB_URI.includes('localhost') || env.MONGODB_URI.includes('127.0.0.1')) {
      log('⚠️  MongoDB URI uses localhost in production - should use remote database', 'yellow');
    } else if (env.MONGODB_URI.includes('mongodb+srv://')) {
      log('✅ MongoDB URI uses Atlas connection', 'green');
    } else {
      log('✅ MongoDB URI configured for remote database', 'green');
    }
  }
  
  // Check CORS configuration
  if (!env.CORS_ORIGIN || env.CORS_ORIGIN === 'true') {
    log('❌ CORS_ORIGIN: Must be explicitly configured in production (no wildcards)', 'red');
    hasErrors = true;
  } else {
    log('✅ CORS_ORIGIN: Configured', 'green');
  }
  
  // Check GPU server SSL
  if (env.GPU_SERVER_SSL !== 'true') {
    log('⚠️  GPU_SERVER_SSL: Should use HTTPS in production', 'yellow');
  } else {
    log('✅ GPU_SERVER_SSL: Using HTTPS', 'green');
  }
  
  return { hasErrors };
}

// Check file permissions and git status
function checkFilesSecurity() {
  logSection('📁 File Security Checks');
  
  const envPath = path.join(__dirname, '..', '.env');
  const gitignorePath = path.join(__dirname, '..', '.gitignore');
  
  // Check if .env is in .gitignore
  if (fs.existsSync(gitignorePath)) {
    const gitignoreContent = fs.readFileSync(gitignorePath, 'utf8');
    if (gitignoreContent.includes('.env')) {
      log('✅ .env is in .gitignore', 'green');
    } else {
      log('❌ .env is NOT in .gitignore - CRITICAL SECURITY RISK!', 'red');
      return { hasErrors: true };
    }
  }
  
  // Check .env file permissions (Unix-like systems)
  if (process.platform !== 'win32' && fs.existsSync(envPath)) {
    const stats = fs.statSync(envPath);
    const mode = stats.mode.toString(8).slice(-3);
    
    if (mode === '600' || mode === '400') {
      log(`✅ .env file permissions: ${mode} (secure)`, 'green');
    } else {
      log(`⚠️  .env file permissions: ${mode} (consider chmod 600 .env)`, 'yellow');
    }
  }
  
  return { hasErrors: false };
}

// Main validation function
function runSecurityChecks() {
  log('\n╔════════════════════════════════════════════════════════════╗', 'blue');
  log('║     VisHeart Server - Security Configuration Check        ║', 'blue');
  log('╚════════════════════════════════════════════════════════════╝', 'blue');
  
  const env = loadEnvFile();
  if (!env) {
    process.exit(1);
  }
  
  const results = {
    secrets: validateSecrets(env),
    aws: validateAWSCredentials(env),
    production: validateProductionConfig(env),
    files: checkFilesSecurity(),
  };
  
  // Summary
  logSection('📊 Summary');
  
  const totalErrors = Object.values(results).reduce((sum, r) => sum + (r.hasErrors ? 1 : 0), 0);
  const totalWarnings = Object.values(results).reduce((sum, r) => sum + (r.hasWarnings ? 1 : 0), 0);
  
  if (totalErrors > 0) {
    log('\n❌ FAILED: Found critical security issues!', 'red');
    log('   Fix all errors before deploying to production.', 'red');
    log('\n   For detailed guidance, see SECURITY.md', 'yellow');
    process.exit(1);
  } else if (totalWarnings > 0) {
    log('\n⚠️  PASSED with warnings: Please review warnings above.', 'yellow');
    log('   For detailed guidance, see SECURITY.md', 'yellow');
    process.exit(0);
  } else {
    log('\n✅ PASSED: All security checks passed!', 'green');
    log('   Your configuration appears secure.', 'green');
    process.exit(0);
  }
}

// Run the checks
if (require.main === module) {
  runSecurityChecks();
}

module.exports = { runSecurityChecks, isWeakSecret, loadEnvFile };
