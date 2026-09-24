# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""
Knowledge Base Retrieval Tool for Strands Agent

Wraps the Bedrock Knowledge Bases Retrieve API to query a knowledge base
and return relevant document chunks.
"""

import boto3
from strands import tool


def _get_bedrock_agent_runtime_client(region: str = None):
    """Get the Bedrock Agent Runtime client."""
    return boto3.client("bedrock-agent-runtime", region_name=region)


def create_kb_retrieval_tool(knowledge_base_id: str):
    """
    Factory function to create a knowledge base retrieval tool with a pre-configured KB ID.
    
    Args:
        knowledge_base_id: The ID of the knowledge base to query.
    
    Returns:
        A Strands tool function for retrieving from the specified knowledge base.
    """
    @tool
    def retrieve_from_knowledge_base(
        query: str,
        number_of_results: int = 5,
    ) -> str:
        """
        Retrieve relevant information from the IT knowledge base.
        
        Use this tool to search for IT policies, troubleshooting guides, software
        documentation, setup instructions, and security procedures.
        
        Args:
            query: The search query to find relevant information.
            number_of_results: Maximum number of results to return (default: 5).
        
        Returns:
            A formatted string containing the retrieved document chunks with their
            relevance scores and source locations.
        """
        return _retrieve_from_kb(query, knowledge_base_id, number_of_results)
    
    return retrieve_from_knowledge_base


def _retrieve_from_kb(
    query: str,
    knowledge_base_id: str,
    number_of_results: int = 5,
) -> str:
    """Internal function to retrieve from knowledge base."""
    client = _get_bedrock_agent_runtime_client()
    
    try:
        response = client.retrieve(
            knowledgeBaseId=knowledge_base_id,
            retrievalQuery={"text": query},
            retrievalConfiguration={
                "vectorSearchConfiguration": {
                    "numberOfResults": number_of_results
                }
            }
        )
        
        results = response.get("retrievalResults", [])
        
        if not results:
            return "No relevant information found in the knowledge base."
        
        formatted_results = []
        for i, result in enumerate(results, 1):
            content = result.get("content", {})
            text = content.get("text", "No text content")
            score = result.get("score", 0)
            location = result.get("location", {})
            
            source = "Unknown source"
            if location.get("type") == "S3":
                source = location.get("s3Location", {}).get("uri", source)
            elif location.get("type") == "WEB":
                source = location.get("webLocation", {}).get("url", source)
            
            formatted_results.append(
                f"[Result {i}] (Score: {score:.3f})\n"
                f"Source: {source}\n"
                f"Content: {text}\n"
            )
        
        return "\n---\n".join(formatted_results)
        
    except Exception as e:
        return f"Error retrieving from knowledge base: {str(e)}"
