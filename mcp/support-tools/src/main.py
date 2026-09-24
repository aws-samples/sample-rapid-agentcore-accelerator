# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""
Customer Support MCP Server

A sample MCP server that exposes customer support tools for use by AI agents.
Runs on AgentCore Runtime with stateless streamable-http transport.
"""

from mcp.server.fastmcp import FastMCP

# Initialize FastMCP server with stateless HTTP transport
# Host 0.0.0.0 required for container networking, port 8000 for MCP protocol
mcp = FastMCP(
    "Customer Support MCP Server",
    host="0.0.0.0",
    port=8000,
    stateless_http=True,
)

# Sample FAQ data
FAQ_DATA = {
    "returns": {
        "question": "What is your return policy?",
        "answer": "We offer a 30-day return policy for all unused items in original packaging. "
                  "To initiate a return, contact support with your order number."
    },
    "shipping": {
        "question": "How long does shipping take?",
        "answer": "Standard shipping takes 5-7 business days. Express shipping (2-3 days) "
                  "and overnight options are available at checkout."
    },
    "warranty": {
        "question": "What warranty do you offer?",
        "answer": "All products come with a 1-year manufacturer warranty covering defects. "
                  "Extended warranty options are available for purchase."
    },
    "payment": {
        "question": "What payment methods do you accept?",
        "answer": "We accept all major credit cards (Visa, MasterCard, Amex), PayPal, "
                  "and Apple Pay. Payment plans available for orders over $500."
    },
    "tracking": {
        "question": "How do I track my order?",
        "answer": "Once shipped, you'll receive an email with tracking information. "
                  "You can also check order status in your account dashboard."
    },
}

# Sample ticket data
TICKET_DATA = {
    "TKT-001": {"status": "open", "subject": "Damaged item received", "priority": "high"},
    "TKT-002": {"status": "in_progress", "subject": "Refund request", "priority": "medium"},
    "TKT-003": {"status": "resolved", "subject": "Shipping delay inquiry", "priority": "low"},
    "TKT-004": {"status": "open", "subject": "Product exchange", "priority": "medium"},
    "TKT-005": {"status": "closed", "subject": "Account access issue", "priority": "high"},
}


@mcp.tool()
def get_support_ticket_status(ticket_id: str) -> dict:
    """
    Get the status of a customer support ticket.
    
    Args:
        ticket_id: The support ticket ID (e.g., TKT-001)
    
    Returns:
        Dictionary with ticket status, subject, and priority
    """
    ticket_id = ticket_id.upper()
    
    if ticket_id in TICKET_DATA:
        ticket = TICKET_DATA[ticket_id]
        return {
            "ticket_id": ticket_id,
            "status": ticket["status"],
            "subject": ticket["subject"],
            "priority": ticket["priority"],
            "message": f"Ticket {ticket_id} is currently {ticket['status']}."
        }
    else:
        return {
            "ticket_id": ticket_id,
            "status": "not_found",
            "message": f"No ticket found with ID {ticket_id}. Please verify the ticket number."
        }


@mcp.tool()
def search_faq(query: str) -> list:
    """
    Search the customer support FAQ for relevant answers.
    
    Args:
        query: Search query to find relevant FAQ entries
    
    Returns:
        List of matching FAQ entries with questions and answers
    """
    query_lower = query.lower()
    results = []
    
    # Simple keyword matching
    for key, faq in FAQ_DATA.items():
        if (query_lower in key.lower() or 
            query_lower in faq["question"].lower() or 
            query_lower in faq["answer"].lower()):
            results.append({
                "topic": key,
                "question": faq["question"],
                "answer": faq["answer"]
            })
    
    if not results:
        return [{
            "message": f"No FAQ entries found matching '{query}'. "
                      "Try searching for: returns, shipping, warranty, payment, or tracking."
        }]
    
    return results


if __name__ == "__main__":
    print("Starting Customer Support MCP Server...")
    print("Server will be available at http://0.0.0.0:8000/mcp")
    mcp.run(transport="streamable-http")
