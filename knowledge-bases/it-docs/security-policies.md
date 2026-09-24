# IT Security Policies

## Password Requirements

### Corporate Account Passwords
- Minimum 12 characters
- Must include: uppercase, lowercase, number, and special character
- Cannot reuse last 10 passwords
- Expires every 90 days (you'll receive reminders at 14, 7, and 3 days before expiry)
- Account locks after 5 failed attempts (auto-unlocks after 30 minutes)

### Password Reset Process
1. Go to https://password.acmecorp.com or contact IT Helpdesk
2. Verify identity with MFA (SMS code to registered phone)
3. Set new password meeting requirements above
4. Password change takes effect immediately across all corporate systems

## Multi-Factor Authentication (MFA)

### Required for:
- VPN access
- AWS console login
- GitHub Enterprise
- Email (first login on new device)
- Admin panels and sensitive systems

### Supported MFA Methods:
- **Authenticator app** (preferred) — 1Password, Google Authenticator, or Microsoft Authenticator
- **SMS** — Backup method, less secure
- **Hardware key** — YubiKey available for high-security roles (request via IT ticket)

### Setting Up MFA:
1. Log in to https://myaccount.acmecorp.com
2. Navigate to Security → Multi-Factor Authentication
3. Follow the setup wizard for your preferred method
4. Save backup codes in 1Password

## Device Security

### Required on All Corporate Devices:
- Full disk encryption (BitLocker on Windows, FileVault on Mac)
- Corporate antivirus (CrowdStrike Falcon — auto-installed)
- Auto-lock after 5 minutes of inactivity
- Latest OS security patches (auto-update enabled)

### Lost or Stolen Devices:
1. Report immediately to IT Security: security@acmecorp.com or call ext. 5555
2. Device will be remotely wiped within 1 hour of report
3. File a police report if stolen
4. IT will provision a replacement device within 24 hours

## Data Handling

### Classification Levels:
- **Public** — Can be shared externally (marketing materials, public docs)
- **Internal** — For employees only (internal memos, non-sensitive reports)
- **Confidential** — Need-to-know basis (customer data, financial reports, HR records)
- **Restricted** — Highest sensitivity (encryption keys, security audit results)

### Rules:
- Never store Confidential/Restricted data on personal devices
- Use corporate-approved cloud storage (S3, SharePoint) only
- Encrypt Confidential/Restricted data at rest and in transit
- Report suspected data leaks to security@acmecorp.com immediately

## Acceptable Use

### Corporate Network:
- Work-related use is primary
- Limited personal use is acceptable (no streaming, gaming, or high-bandwidth personal activities)
- All traffic is monitored and logged for security purposes
- No attempt to bypass security controls, proxy restrictions, or network monitoring

### Email Security:
- Do not open attachments from unknown senders
- Report phishing attempts to phishing@acmecorp.com (or use the "Report Phishing" button in Outlook)
- Never send passwords, API keys, or credentials via email
- Use encrypted email for Confidential/Restricted information
