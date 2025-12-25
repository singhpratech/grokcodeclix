/**
 * Security Utilities
 *
 * Provides input validation, path traversal prevention, and security checks.
 */

import * as path from 'path';
import * as os from 'os';

// Dangerous patterns that should be flagged
const DANGEROUS_COMMANDS = [
  /rm\s+-rf\s+[\/~]/i,          // rm -rf with root or home
  /rm\s+-rf\s+\*/,               // rm -rf *
  />\s*\/dev\/sd/,               // Writing to disk devices
  /mkfs\./,                       // Formatting filesystems
  /dd\s+if=.*of=\/dev/,          // dd to device
  /chmod\s+-R\s+777/,            // Recursive 777
  /curl.*\|\s*sh/,               // Curl pipe to shell
  /wget.*\|\s*sh/,               // Wget pipe to shell
  /curl.*\|\s*bash/,
  /wget.*\|\s*bash/,
  /:(){.*};:/,                   // Fork bomb pattern
  />\s*\/etc\//,                 // Writing to /etc
  />\s*\/boot\//,                // Writing to /boot
  />\s*\/proc\//,                // Writing to /proc
  />\s*\/sys\//,                 // Writing to /sys
];

// Sensitive file patterns
const SENSITIVE_FILES = [
  /\.env$/,
  /\.env\./,
  /credentials/i,
  /secret/i,
  /password/i,
  /private_key/,
  /\.pem$/,
  /\.key$/,
  /id_rsa/,
  /id_ed25519/,
  /\.ssh\/config/,
  /\.netrc/,
  /\.npmrc/,
  /\.pypirc/,
];

// Blocked paths (never allow access)
const BLOCKED_PATHS = [
  '/etc/passwd',
  '/etc/shadow',
  '/etc/sudoers',
  '/etc/ssh/',
  '/root/.ssh/',
  '/proc/',
  '/sys/',
  '/dev/',
];

export interface SecurityCheckResult {
  allowed: boolean;
  reason?: string;
  severity?: 'low' | 'medium' | 'high' | 'critical';
  suggestion?: string;
}

/**
 * Validate a file path for security issues
 */
export function validatePath(filePath: string, allowedRoots?: string[]): SecurityCheckResult {
  // Resolve to absolute path
  const resolved = path.resolve(filePath);
  const normalized = path.normalize(resolved);

  // Check for path traversal attempts
  if (filePath.includes('..')) {
    // Allow if the resolved path is still within allowed roots
    if (allowedRoots && allowedRoots.length > 0) {
      const isWithinRoots = allowedRoots.some(root =>
        normalized.startsWith(path.resolve(root))
      );
      if (!isWithinRoots) {
        return {
          allowed: false,
          reason: 'Path traversal detected - path escapes allowed directories',
          severity: 'high',
        };
      }
    }
  }

  // Check blocked paths
  for (const blocked of BLOCKED_PATHS) {
    if (normalized.startsWith(blocked) || normalized === blocked.slice(0, -1)) {
      return {
        allowed: false,
        reason: `Access to ${blocked} is blocked for security`,
        severity: 'critical',
      };
    }
  }

  // Check for sensitive files (warning only)
  for (const pattern of SENSITIVE_FILES) {
    if (pattern.test(normalized)) {
      return {
        allowed: true,  // Allow but warn
        reason: 'This appears to be a sensitive file',
        severity: 'medium',
        suggestion: 'Be careful with files containing credentials or secrets',
      };
    }
  }

  return { allowed: true };
}

/**
 * Validate a bash command for dangerous patterns
 */
export function validateCommand(command: string): SecurityCheckResult {
  // Check for dangerous patterns
  for (const pattern of DANGEROUS_COMMANDS) {
    if (pattern.test(command)) {
      return {
        allowed: false,
        reason: 'Command matches a dangerous pattern',
        severity: 'critical',
        suggestion: 'This command could cause system damage. Please review carefully.',
      };
    }
  }

  // Check for commands that modify critical paths
  if (/>\s*(\/etc|\/boot|\/root|\/var\/log)/i.test(command)) {
    return {
      allowed: false,
      reason: 'Writing to system directories is blocked',
      severity: 'high',
    };
  }

  // Check for privilege escalation
  if (/sudo\s+-s|su\s+-|sudo\s+su/.test(command)) {
    return {
      allowed: true,
      reason: 'Command requires elevated privileges',
      severity: 'medium',
      suggestion: 'This command will prompt for sudo password',
    };
  }

  return { allowed: true };
}

/**
 * Validate a URL for security issues
 */
export function validateUrl(url: string): SecurityCheckResult {
  try {
    const parsed = new URL(url);

    // Only allow http/https
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return {
        allowed: false,
        reason: `Protocol ${parsed.protocol} is not allowed`,
        severity: 'medium',
      };
    }

    // Block localhost/internal IPs (SSRF prevention)
    const hostname = parsed.hostname.toLowerCase();
    const blockedHosts = ['localhost', '127.0.0.1', '0.0.0.0', '::1'];
    const internalPatterns = [
      /^10\./,
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
      /^192\.168\./,
      /^169\.254\./,
    ];

    if (blockedHosts.includes(hostname)) {
      return {
        allowed: false,
        reason: 'Localhost access is blocked',
        severity: 'high',
      };
    }

    for (const pattern of internalPatterns) {
      if (pattern.test(hostname)) {
        return {
          allowed: false,
          reason: 'Internal network access is blocked',
          severity: 'high',
        };
      }
    }

    return { allowed: true };
  } catch {
    return {
      allowed: false,
      reason: 'Invalid URL format',
      severity: 'low',
    };
  }
}

/**
 * Sanitize output for display (prevent terminal escape sequences)
 */
export function sanitizeOutput(output: string): string {
  // Remove potentially dangerous escape sequences but keep basic formatting
  return output
    // Remove cursor manipulation
    .replace(/\x1b\[\d*[ABCDJK]/g, '')
    // Remove window title changes
    .replace(/\x1b\]0;[^\x07]*\x07/g, '')
    // Remove scrolling region changes
    .replace(/\x1b\[\d*;\d*r/g, '')
    // Keep basic colors (safe)
    .replace(/\x1b\[(\d+;)*\d*[mK]/g, (match) => {
      // Only allow color codes 0-107
      const nums = match.slice(2, -1).split(';').map(Number);
      if (nums.every(n => n >= 0 && n <= 107)) {
        return match;
      }
      return '';
    });
}

/**
 * Get safe environment variables (filter out sensitive ones)
 */
export function getSafeEnv(): Record<string, string> {
  const sensitive = [
    'API_KEY', 'SECRET', 'TOKEN', 'PASSWORD', 'CREDENTIAL',
    'AWS_', 'GITHUB_TOKEN', 'NPM_TOKEN', 'PRIVATE_KEY',
  ];

  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(process.env)) {
    const isSensitive = sensitive.some(s => key.toUpperCase().includes(s));
    if (!isSensitive && value !== undefined) {
      result[key] = value;
    }
  }

  return result;
}

/**
 * Generate a safe temporary path
 */
export function getSafeTempPath(filename: string): string {
  const sanitized = filename.replace(/[^a-zA-Z0-9._-]/g, '_');
  return path.join(os.tmpdir(), 'grokcode', sanitized);
}
