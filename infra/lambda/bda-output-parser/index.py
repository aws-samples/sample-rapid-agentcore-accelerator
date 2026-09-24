# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""
BDA Output Parser Lambda for Document Processing Pipeline

This Lambda function is triggered by EventBridge when a BDA job completes successfully.
It parses the BDA standard-output.json file and extracts markdown content into a
consolidated markdown file ready for RAG ingestion.
"""

import json
import os
import logging
from urllib.parse import urlparse
import boto3
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize S3 client
s3_client = boto3.client('s3')

# Environment variables
RAG_READY_BUCKET = os.environ.get('RAG_READY_BUCKET')
RAG_READY_PREFIX = os.environ.get('RAG_READY_PREFIX', 'processed/')


def lambda_handler(event, context):
    """
    Process EventBridge event for BDA job completion and extract markdown to RAG-ready bucket.
    
    Args:
        event: EventBridge event containing BDA job completion details
        context: Lambda context
        
    Returns:
        dict: Processing result with status and output location
    """
    logger.info(f"Received EventBridge event: source={event.get('source')}, output_bucket={event.get('detail', {}).get('output_s3_location', {}).get('s3_bucket', 'unknown')}")
    
    try:
        # Extract BDA output S3 location from EventBridge event
        # BDA EventBridge events use output_s3_location with s3_bucket and name fields
        detail = event.get('detail', {})
        output_location = detail.get('output_s3_location', {})
        bda_output_bucket = output_location.get('s3_bucket')
        bda_output_prefix = output_location.get('name')
        
        if not bda_output_bucket or not bda_output_prefix:
            logger.error("Missing output location in event. Expected 's3_bucket' and 'name' fields in detail.output_s3_location.")
            return {'status': 'error', 'message': 'Missing output S3 location in event'}
        
        logger.info(f"BDA output location: s3://{bda_output_bucket}/{bda_output_prefix}")

        # Get original input filename from event
        input_s3_object = detail.get('input_s3_object', {})
        input_object_name = input_s3_object.get('name', '')
        
        # Read standard-output.json from BDA output
        standard_output = read_standard_output(bda_output_bucket, bda_output_prefix)
        
        if not standard_output:
            logger.error("Failed to read standard-output.json")
            return {'status': 'error', 'message': 'Failed to read standard-output.json'}
        
        # Extract markdown content from BDA output
        markdown_content = extract_markdown(standard_output)
        
        # Determine output filename - preserve original document name with .md extension
        original_filename = get_original_filename(bda_output_prefix, standard_output, input_object_name)
        output_key = f"{RAG_READY_PREFIX}{original_filename}.md"
        
        # Write consolidated markdown to RAG-ready bucket
        write_markdown_to_s3(markdown_content, output_key)
        
        logger.info(f"Successfully wrote markdown to s3://{RAG_READY_BUCKET}/{output_key}")
        
        return {
            'status': 'success',
            'outputBucket': RAG_READY_BUCKET,
            'outputKey': output_key
        }
        
    except Exception as e:
        logger.error(f"Error processing BDA output: {str(e)}")
        raise


def read_standard_output(bucket: str, prefix: str) -> dict:
    """
    Read and parse the BDA standard output result file.
    
    Args:
        bucket: S3 bucket name
        prefix: S3 prefix where BDA output is stored (from EventBridge event)
        
    Returns:
        dict: Parsed result.json content, or None if not found
    """
    # BDA output structure: {prefix}/standard_output/0/result.json
    # The EventBridge event provides the path ending with /0
    # So the result file is at {prefix}/standard_output/0/result.json
    result_key = f"{prefix}/standard_output/0/result.json"
    
    try:
        logger.info(f"Reading s3://{bucket}/{result_key}")
        response = s3_client.get_object(Bucket=bucket, Key=result_key)
        content = response['Body'].read().decode('utf-8')
        return json.loads(content)
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        if error_code == 'NoSuchKey':
            logger.warning(f"result.json not found at {result_key}")
            # Try legacy path: standard-output.json directly under prefix
            try:
                alt_key = f"{prefix}/standard-output.json"
                logger.info(f"Trying alternate path: s3://{bucket}/{alt_key}")
                response = s3_client.get_object(Bucket=bucket, Key=alt_key)
                content = response['Body'].read().decode('utf-8')
                return json.loads(content)
            except ClientError:
                logger.error(f"BDA output file not found at any expected path")
                return None
        else:
            logger.error(f"Error reading BDA output: {error_code}")
            raise
    except json.JSONDecodeError as e:
        logger.error(f"Invalid JSON in standard-output.json: {str(e)}")
        return None


def extract_markdown(standard_output: dict) -> str:
    """
    Extract and consolidate markdown content from BDA standard output.
    
    BDA output structure has markdown in pages[].representation.markdown
    Each page contains the extracted markdown for that page.
    
    Args:
        standard_output: Parsed BDA result.json
        
    Returns:
        str: Consolidated markdown content
    """
    markdown_parts = []
    
    # Extract page-level markdown representations
    # BDA stores markdown in pages[].representation.markdown
    pages = standard_output.get('pages', [])
    
    # Sort pages by page_index to ensure correct order
    sorted_pages = sorted(pages, key=lambda p: p.get('page_index', 0))
    
    for page in sorted_pages:
        page_representation = page.get('representation', {})
        page_markdown = page_representation.get('markdown')
        if page_markdown:
            markdown_parts.append(page_markdown)
        elif page_representation.get('text'):
            markdown_parts.append(page_representation.get('text'))
    
    # If no pages found, try document-level representation (fallback)
    if not markdown_parts:
        document = standard_output.get('document', {})
        doc_representation = document.get('representation', {})
        doc_markdown = doc_representation.get('markdown')
        if doc_markdown:
            markdown_parts.append(doc_markdown)
        elif doc_representation.get('text'):
            markdown_parts.append(doc_representation.get('text'))
    
    # Join all parts with double newlines for page separation
    return '\n\n'.join(filter(None, markdown_parts))


def extract_entity_markdown(entity: dict, entity_type: str) -> str:
    """
    Extract markdown content from a single entity.
    
    Args:
        entity: Entity object from BDA output
        entity_type: Type of entity (TABLE, FIGURE, TEXT)
        
    Returns:
        str: Markdown content for the entity, or empty string
    """
    representation = entity.get('representation', {})
    
    if entity_type == 'TABLE':
        # For tables, prefer markdown representation, then CSV, then text
        table_md = representation.get('markdown')
        if table_md:
            return table_md
        
        # Fall back to CSV if available
        csv_content = representation.get('csv')
        if csv_content:
            # Wrap CSV in code block for readability
            return f"```csv\n{csv_content}\n```"
        
        return representation.get('text', '')
    
    elif entity_type == 'FIGURE':
        # For figures, include caption/summary
        parts = []
        
        # Add figure title if available
        title = entity.get('title')
        if title:
            parts.append(f"**Figure: {title}**")
        
        # Add summary/caption - this is the generative field output
        summary = entity.get('summary')
        if summary:
            parts.append(f"*{summary}*")
        
        # Add any text representation
        text = representation.get('text')
        if text:
            parts.append(text)
        
        return '\n'.join(parts) if parts else ''
    
    else:
        # For other entity types (TEXT), use markdown or text representation
        # Skip if already included in document-level representation
        return ''


def get_original_filename(bda_output_prefix: str, standard_output: dict, input_object_name: str = '') -> str:
    """
    Determine the original document filename from BDA output.
    
    Args:
        bda_output_prefix: S3 prefix where BDA output is stored
        standard_output: Parsed BDA standard-output.json
        input_object_name: Original input S3 object name from EventBridge event
        
    Returns:
        str: Original filename without extension
    """
    # First try to get from the EventBridge event input_s3_object.name
    if input_object_name:
        filename = os.path.basename(input_object_name)
        name_without_ext = os.path.splitext(filename)[0]
        if name_without_ext:
            return name_without_ext
    
    # Try to get from metadata in standard-output.json
    metadata = standard_output.get('metadata', {})
    s3_prefix = metadata.get('s3_prefix', '')
    
    if s3_prefix:
        # Extract filename from the original S3 path
        filename = os.path.basename(s3_prefix)
        name_without_ext = os.path.splitext(filename)[0]
        if name_without_ext:
            return name_without_ext
    
    # Fall back to extracting from the BDA output prefix
    # BDA output prefix typically contains the document name before the job ID
    prefix_parts = bda_output_prefix.rstrip('/').split('/')
    # Skip the last part (job ID subfolder like "0") and the UUID job ID
    if len(prefix_parts) >= 3:
        return prefix_parts[-3]  # e.g., "processed/docname/uuid/0" -> "docname"
    elif prefix_parts:
        return prefix_parts[-1]
    
    return 'document'


def write_markdown_to_s3(content: str, output_key: str) -> None:
    """
    Write markdown content to the RAG-ready S3 bucket.
    
    Args:
        content: Markdown content to write
        output_key: S3 key for the output file
    """
    try:
        s3_client.put_object(
            Bucket=RAG_READY_BUCKET,
            Key=output_key,
            Body=content.encode('utf-8'),
            ContentType='text/markdown'
        )
    except ClientError as e:
        logger.error(f"Error writing to S3: {str(e)}")
        raise
