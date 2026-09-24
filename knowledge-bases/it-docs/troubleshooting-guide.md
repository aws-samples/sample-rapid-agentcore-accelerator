# IT Troubleshooting Guide

## VPN Issues

### Cannot Connect to VPN
1. **Check your internet connection** — VPN requires a working internet connection first
2. **Restart the VPN client** — Quit GlobalProtect completely and reopen
3. **Check system status** — Visit status.acmecorp.com or ask IT Helpdesk bot
4. **Try a different network** — Some public WiFi networks block VPN protocols
5. **Clear VPN cache** (Mac): `rm -rf ~/Library/Application\ Support/PaloAltoNetworks`
6. **Clear VPN cache** (Windows): Delete `C:\Users\{you}\AppData\Local\Palo Alto Networks`
7. If still failing, submit an IT ticket with the error message shown

### VPN Connected But No Access to Internal Resources
1. Verify you're connected (green shield icon in GlobalProtect)
2. Try accessing https://intranet.acmecorp.com — if this loads, VPN is working
3. DNS issue: Try `nslookup yourapp.internal.acmecorp.com`
4. If DNS fails, flush DNS cache:
   - Mac: `sudo dscacheutil -flushcache && sudo killall -HUP mDNSResponder`
   - Windows: `ipconfig /flushdns`
5. Try disconnecting and reconnecting VPN

### VPN is Slow
- Bandwidth is shared — during peak hours (9-11 AM) speeds may be reduced
- Close bandwidth-heavy personal applications
- If consistently slow, try connecting to a different VPN gateway region
- File an IT ticket if speeds are below 5 Mbps consistently

## Email Issues

### Cannot Access Email (Outlook)
1. Check if you can access email via web: https://outlook.office365.com
2. If web works but desktop doesn't:
   - Restart Outlook
   - Clear Outlook cache: File → Account Settings → Repair
   - Remove and re-add your account
3. If neither works, check system status page for Exchange outages
4. Try from a different device to isolate the issue

### Not Receiving Emails
1. Check spam/junk folder
2. Verify sender is not blocked: Settings → Blocked senders
3. Check mailbox storage (limit: 50 GB) — archive old emails if near capacity
4. Check mail flow rules in Outlook Rules settings
5. Ask sender to resend — sometimes emails are delayed by spam filtering

## WiFi Issues

### Cannot Connect to Corporate WiFi
1. Forget the "AcmeCorp" network and reconnect
2. Ensure you're using your corporate credentials (same as email login)
3. Check if your device certificate is expired: Settings → WiFi → AcmeCorp → Certificate
4. For new devices: register at https://wifi.acmecorp.com first
5. Guest WiFi ("AcmeCorp-Guest") is available with limited access if corporate WiFi is down

### WiFi Keeps Disconnecting
- Move closer to an access point (away from elevator shafts, stairwells)
- Disable Bluetooth temporarily (can interfere on older devices)
- Update WiFi drivers (Windows: Device Manager → Network adapters → Update)
- If in Building 3, known dead zones exist on floors 2 and 4 — use ethernet

## Software Issues

### Software Center Not Loading
1. Restart your machine
2. Check VPN connection (Software Center requires corporate network)
3. Clear Software Center cache:
   - Windows: `C:\Windows\SysWOW64\CCM\ClientUX\SCClient.exe`
   - Mac: Re-enroll MDM profile in System Settings → Profiles
4. If still not working, IT can push software remotely via ticket

### Application Crashes Repeatedly
1. Check for updates (most crashes are fixed in latest versions)
2. Restart the application
3. Restart your computer
4. Check available disk space (minimum 10 GB free recommended)
5. Check Event Viewer (Windows) or Console.app (Mac) for error details
6. Uninstall and reinstall from Software Center
7. File IT ticket with: app name, version, error message, when it started

## Hardware Issues

### Laptop Running Slow
1. Restart (clears memory and temp files)
2. Check running processes: Task Manager (Win) / Activity Monitor (Mac)
3. Close unnecessary browser tabs (each tab uses memory)
4. Check disk space — keep at least 10% free
5. Check if Windows Update or macOS update is running in background
6. If persistent, file IT ticket for hardware diagnostics

### External Monitor Not Detected
1. Check cable connections (both ends)
2. Try a different cable or port
3. Restart with monitor connected
4. Update display drivers (Windows: Device Manager → Display adapters)
5. Mac: System Settings → Displays → Detect Displays (hold Option key)
6. Try a different monitor to isolate whether it's the laptop or monitor

### Laptop Won't Charge
1. Try a different outlet
2. Check the cable for damage
3. Try a different charger (borrow from a colleague)
4. Reset SMC (Mac): Shut down → hold Shift+Ctrl+Option+Power for 10 seconds
5. If still not charging, it's likely a hardware issue — file IT ticket for replacement

## Account & Access Issues

### Account Locked Out
- Accounts auto-unlock after 30 minutes
- For immediate unlock: call IT Helpdesk at ext. 4357 (HELP)
- If locked due to forgotten password, use the password reset process
- If locked due to suspected compromise, contact security@acmecorp.com

### Cannot Access a System/Application
1. Verify you have the correct role — check with your manager
2. For new employee access: your manager needs to submit an access request
3. For existing employees: submit IT ticket with category "access"
4. AWS access: Requires manager approval + security review (2 business days)
5. Production systems: Requires VP approval + security review (5 business days)
