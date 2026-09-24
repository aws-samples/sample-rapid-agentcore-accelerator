# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""
IT Helpdesk Tools

Mock tools for an internal IT support agent demo.
In production, these would connect to Active Directory, ServiceNow, monitoring systems, etc.
"""

import uuid
from datetime import datetime
from strands import tool


# Mock system status data
SYSTEM_STATUS = {
    "email": {"name": "Email (Exchange Online)", "status": "operational", "last_incident": "2024-12-01"},
    "vpn": {"name": "Corporate VPN", "status": "operational", "last_incident": "2024-12-08"},
    "jira": {"name": "Jira", "status": "degraded", "last_incident": "2024-12-14", "note": "Slow response times, team investigating"},
    "confluence": {"name": "Confluence", "status": "operational", "last_incident": "2024-11-28"},
    "slack": {"name": "Slack", "status": "operational", "last_incident": "2024-12-05"},
    "github": {"name": "GitHub Enterprise", "status": "operational", "last_incident": "2024-12-02"},
    "aws-console": {"name": "AWS Console (SSO)", "status": "operational", "last_incident": "2024-11-30"},
    "wifi": {"name": "Office WiFi", "status": "outage", "last_incident": "2024-12-14", "note": "Building 3 WiFi AP replacement in progress, ETA 2 hours"},
}

# Mock employee data for password reset verification
MOCK_EMPLOYEES = {
    "jsmith": {"name": "John Smith", "email": "jsmith@example.com", "department": "Engineering"},
    "ajones": {"name": "Alice Jones", "email": "ajones@example.com", "department": "Marketing"},
    "bwilson": {"name": "Bob Wilson", "email": "bwilson@example.com", "department": "Finance"},
}


@tool
def check_system_status(system_name: str = "all") -> str:
    """
    Check the current status of internal IT systems and services.
    
    Use this to check whether systems are operational, degraded, or experiencing outages.
    
    Args:
        system_name: Name of the system to check (e.g., "vpn", "email", "jira") 
                     or "all" to get a full status overview.
    
    Returns:
        Current status of the requested system(s) including any active incidents.
    """
    system_name = system_name.lower().strip()
    
    if system_name == "all":
        lines = ["=== System Status Dashboard ===\n"]
        for key, sys in SYSTEM_STATUS.items():
            icon = "✅" if sys["status"] == "operational" else "⚠️" if sys["status"] == "degraded" else "🔴"
            line = f"{icon} {sys['name']}: {sys['status'].title()}"
            if sys.get("note"):
                line += f"\n   → {sys['note']}"
            lines.append(line)
        return "\n".join(lines)
    
    if system_name not in SYSTEM_STATUS:
        available = ", ".join(SYSTEM_STATUS.keys())
        return f"System '{system_name}' not found. Available systems: {available}"
    
    sys = SYSTEM_STATUS[system_name]
    icon = "✅" if sys["status"] == "operational" else "⚠️" if sys["status"] == "degraded" else "🔴"
    result = f"""{icon} {sys['name']}
Status: {sys['status'].title()}
Last Incident: {sys['last_incident']}"""
    
    if sys.get("note"):
        result += f"\nNote: {sys['note']}"
    
    return result


@tool
def reset_password(username: str, verification_code: str) -> str:
    """
    Initiate a password reset for an employee's corporate account.
    
    This sends a password reset link to the employee's registered email.
    Requires the employee's username and a verification code they received via SMS.
    
    Args:
        username: The employee's corporate username (e.g., "jsmith")
        verification_code: 6-digit verification code sent to employee's phone
    
    Returns:
        Confirmation of password reset initiation or error message.
    """
    username = username.lower().strip()
    
    if username not in MOCK_EMPLOYEES:
        return f"Username '{username}' not found in the directory. Please verify the username and try again."
    
    # Mock verification — in production this would validate against an MFA system
    if len(verification_code) != 6 or not verification_code.isdigit():
        return "Invalid verification code. Please provide the 6-digit code sent to your registered phone number."
    
    employee = MOCK_EMPLOYEES[username]
    reset_id = f"RST-{uuid.uuid4().hex[:8].upper()}"
    
    return f"""Password reset initiated successfully.

Reset ID: {reset_id}
User: {employee['name']} ({username})
Email: {employee['email']}

A password reset link has been sent to {employee['email']}.
The link expires in 30 minutes. If you don't receive it, check your spam folder.

Security note: If you did not request this reset, please contact IT Security immediately."""


@tool
def create_it_ticket(
    employee_email: str,
    category: str,
    description: str,
    priority: str = "medium",
) -> str:
    """
    Create an IT support ticket for issues that require hands-on assistance.
    
    Args:
        employee_email: Email of the employee reporting the issue
        category: Ticket category — "hardware", "software", "network", "access", or "other"
        description: Detailed description of the issue
        priority: Ticket priority — "low", "medium", "high", or "critical"
    
    Returns:
        Confirmation with ticket ID and expected response time.
    """
    ticket_id = f"IT-{uuid.uuid4().hex[:6].upper()}"
    
    valid_categories = ["hardware", "software", "network", "access", "other"]
    category = category.lower().strip()
    if category not in valid_categories:
        category = "other"
    
    priority = priority.lower().strip()
    valid_priorities = ["low", "medium", "high", "critical"]
    if priority not in valid_priorities:
        priority = "medium"
    
    response_times = {
        "low": "48 hours",
        "medium": "24 hours",
        "high": "4 hours",
        "critical": "1 hour",
    }
    
    assigned_team = {
        "hardware": "Desktop Support",
        "software": "Application Support",
        "network": "Network Operations",
        "access": "Identity & Access Management",
        "other": "General IT Support",
    }
    
    return f"""IT ticket created successfully!

Ticket ID: {ticket_id}
Category: {category.title()}
Priority: {priority.title()}
Assigned To: {assigned_team[category]}
Reporter: {employee_email}
Description: {description}

Expected response time: {response_times[priority]}
Track your ticket at: https://helpdesk.example.com/tickets/{ticket_id}"""


@tool
def get_vpn_config(operating_system: str) -> str:
    """
    Get VPN connection instructions for the specified operating system.
    
    Args:
        operating_system: The employee's OS — "windows", "mac", or "linux"
    
    Returns:
        Step-by-step VPN setup and connection instructions.
    """
    os_name = operating_system.lower().strip()
    
    configs = {
        "windows": """VPN Setup — Windows

1. Download the GlobalProtect client from https://vpn.example.com
2. Install the client (requires admin privileges)
3. Open GlobalProtect and enter portal address: vpn.example.com
4. Sign in with your corporate credentials (username@example.com)
5. Complete MFA verification on your phone
6. Click "Connect"

Troubleshooting:
- If connection fails, ensure you're not on a restricted network
- Try disconnecting/reconnecting WiFi first
- Check Windows Firewall isn't blocking GlobalProtect""",

        "mac": """VPN Setup — macOS

1. Download GlobalProtect from https://vpn.example.com
2. Open the .pkg file and follow the installer
3. Allow the system extension in System Settings → Privacy & Security
4. Open GlobalProtect from Applications
5. Enter portal: vpn.example.com
6. Sign in with your corporate credentials (username@example.com)
7. Complete MFA verification
8. Click "Connect"

Troubleshooting:
- If system extension is blocked, restart Mac and retry
- Check System Settings → VPN to ensure profile is active
- On macOS Ventura+, approve the network extension prompt""",

        "linux": """VPN Setup — Linux

1. Install openconnect: sudo apt install openconnect (Ubuntu/Debian)
   or: sudo dnf install openconnect (Fedora/RHEL)
2. Connect via terminal:
   sudo openconnect --protocol=gp vpn.example.com
3. Enter your corporate username and password
4. Complete MFA verification when prompted

Alternative (GUI):
- Install network-manager-openconnect-gnome
- Add VPN connection in Network Settings
- Set gateway to vpn.example.com, protocol to GlobalProtect

Troubleshooting:
- Ensure TUN/TAP device is available: ls /dev/net/tun
- Check DNS resolution: nslookup vpn.example.com
- Run with --verbose flag for debug output""",
    }
    
    if os_name not in configs:
        return f"Unsupported OS '{operating_system}'. Supported: Windows, Mac, Linux."
    
    return configs[os_name]
