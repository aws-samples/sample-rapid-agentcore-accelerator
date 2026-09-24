# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""
Customer Support Tools

Simple mock tools for a customer support agent demo.
In production, these would connect to real backend systems.
"""

import uuid
from datetime import datetime, timedelta
from strands import tool


# Mock data for demo purposes
MOCK_ORDERS = {
    "ORD-12345": {
        "status": "shipped",
        "items": ["Wireless Headphones", "USB-C Cable"],
        "total": 89.99,
        "shipping_date": "2024-12-10",
        "estimated_delivery": "2024-12-15",
        "tracking_number": "1Z999AA10123456784",
    },
    "ORD-67890": {
        "status": "processing",
        "items": ["Smart Watch"],
        "total": 299.99,
        "shipping_date": None,
        "estimated_delivery": "2024-12-18",
        "tracking_number": None,
    },
    "ORD-11111": {
        "status": "delivered",
        "items": ["Laptop Stand", "Keyboard", "Mouse"],
        "total": 159.97,
        "shipping_date": "2024-12-05",
        "estimated_delivery": "2024-12-08",
        "tracking_number": "1Z999AA10123456785",
    },
}

MOCK_PRODUCTS = {
    "WH-1000": {
        "name": "Wireless Headphones",
        "price": 79.99,
        "in_stock": True,
        "description": "Premium noise-canceling wireless headphones with 30-hour battery life.",
        "warranty": "1 year",
    },
    "SW-2000": {
        "name": "Smart Watch",
        "price": 299.99,
        "in_stock": True,
        "description": "Feature-rich smartwatch with health tracking and GPS.",
        "warranty": "2 years",
    },
    "LS-3000": {
        "name": "Laptop Stand",
        "price": 49.99,
        "in_stock": False,
        "description": "Ergonomic aluminum laptop stand with adjustable height.",
        "warranty": "1 year",
    },
}


@tool
def lookup_order(order_id: str) -> str:
    """
    Look up the status and details of a customer order.
    
    Args:
        order_id: The order ID to look up (e.g., ORD-12345)
    
    Returns:
        Order details including status, items, and shipping information.
    """
    order_id = order_id.upper().strip()
    
    if order_id not in MOCK_ORDERS:
        return f"Order {order_id} not found. Please verify the order ID and try again."
    
    order = MOCK_ORDERS[order_id]
    
    result = f"""Order: {order_id}
Status: {order['status'].title()}
Items: {', '.join(order['items'])}
Total: ${order['total']:.2f}
Estimated Delivery: {order['estimated_delivery']}"""
    
    if order['tracking_number']:
        result += f"\nTracking Number: {order['tracking_number']}"
    
    if order['status'] == 'processing':
        result += "\n\nNote: This order is being prepared and will ship soon."
    
    return result


@tool
def get_product_info(product_id: str) -> str:
    """
    Get information about a product including price, availability, and description.
    
    Args:
        product_id: The product ID to look up (e.g., WH-1000)
    
    Returns:
        Product details including name, price, stock status, and warranty info.
    """
    product_id = product_id.upper().strip()
    
    if product_id not in MOCK_PRODUCTS:
        return f"Product {product_id} not found. Please check the product ID."
    
    product = MOCK_PRODUCTS[product_id]
    stock_status = "In Stock" if product['in_stock'] else "Out of Stock"
    
    return f"""Product: {product['name']} ({product_id})
Price: ${product['price']:.2f}
Availability: {stock_status}
Description: {product['description']}
Warranty: {product['warranty']}"""


@tool
def create_support_ticket(
    customer_email: str,
    issue_summary: str,
    priority: str = "normal"
) -> str:
    """
    Create a support ticket for issues that need escalation or follow-up.
    
    Args:
        customer_email: Customer's email address for follow-up
        issue_summary: Brief description of the issue
        priority: Ticket priority - "low", "normal", or "high"
    
    Returns:
        Confirmation with the ticket ID and expected response time.
    """
    # Generate a mock ticket ID
    ticket_id = f"TKT-{uuid.uuid4().hex[:8].upper()}"
    
    priority = priority.lower()
    if priority not in ["low", "normal", "high"]:
        priority = "normal"
    
    response_times = {
        "low": "48 hours",
        "normal": "24 hours",
        "high": "4 hours",
    }
    
    return f"""Support ticket created successfully!

Ticket ID: {ticket_id}
Priority: {priority.title()}
Email: {customer_email}
Issue: {issue_summary}

A support specialist will contact you within {response_times[priority]}."""
