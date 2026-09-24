# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

"""
Document Processing Lambda for Bedrock Data Automation (BDA)

This Lambda function processes S3 events from SQS and invokes the BDA
InvokeDataAutomationAsync API to process documents into markdown format.
"""

import json
import os
import logging
import uuid
from urllib.parse import unquote_plus
import boto3
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize clients
bda_runtime = boto3.client('bedrock-data-automation-runtime')

# Environment variables
BDA_PROJECT_ARN = os.environ.get('BDA_PROJECT_ARN')
BDA_OUTPUT_BUCKET = os.environ.get('BDA_OUTPUT_BUCKET')
BDA_OUTPUT_PREFIX = os.environ.get('BDA_OUTPUT_PREFIX', 'bda-output/')
SUPPLEMENTAL_BUCKET = os.environ.get('SUPPLEMENTAL_BUCKET')
DATA_AUTOMATION_PROFILE_ARN = os.environ.get('DATA_AUTOMATION_PROFILE_ARN')


def lambda_handler(event, context):
    """
    Process SQS messages containing S3 events and invoke BDA for document processing.
    
    Args:
        event: SQS event containing S3 event records
        context: Lambda context
        
    Returns:
        dict: Processing results with batch item failures for partial batch response
    """
    logger.info(f"Received event with {len(event.get('Records', []))} records")
    
    batch_item_failures = []
    
    for record in event.get('Records', []):
        message_id = record.get('messageId')
        try:
            # Parse S3 event from SQS message body
            s3_event = json.loads(record.get('body', '{}'))
            
            # Handle S3 event records
            for s3_record in s3_event.get('Records', []):
                process_s3_record(s3_record)
                
        except Exception as e:
            logger.error(f"Error processing message {message_id}: {str(e)}")
            # Add to batch item failures to allow SQS retry
            batch_item_failures.append({'itemIdentifier': message_id})
    
    # Return batch item failures for partial batch response
    return {'batchItemFailures': batch_item_failures}


def process_s3_record(s3_record):
    """
    Process a single S3 event record by invoking BDA.
    
    Args:
        s3_record: S3 event record containing bucket and object information
        
    Raises:
        Exception: If BDA invocation fails
    """
    bucket_name = s3_record.get('s3', {}).get('bucket', {}).get('name')
    object_key = s3_record.get('s3', {}).get('object', {}).get('key')
    
    if not bucket_name or not object_key:
        logger.warning("Missing bucket name or object key in S3 record")
        return
    
    # URL-decode the object key (S3 events URL-encode special characters like spaces and apostrophes)
    object_key = unquote_plus(object_key)
    
    # Construct S3 URI for input
    input_s3_uri = f"s3://{bucket_name}/{object_key}"
    
    # Construct output S3 URI - use object key basename with BDA output prefix
    # Don't add trailing slash - BDA will create its own subfolder structure
    object_basename = os.path.basename(object_key)
    object_name_without_ext = os.path.splitext(object_basename)[0]
    output_s3_uri = f"s3://{BDA_OUTPUT_BUCKET}/{BDA_OUTPUT_PREFIX}{object_name_without_ext}"
    
    logger.info(f"Processing document: {input_s3_uri}")
    logger.info(f"Output location: {output_s3_uri}")
    
    try:
        # Invoke BDA async processing
        response = invoke_bda_async(input_s3_uri, output_s3_uri)
        invocation_arn = response.get('invocationArn')
        logger.info(f"BDA invocation started: {invocation_arn}")
        
    except ClientError as e:
        error_code = e.response.get('Error', {}).get('Code', 'Unknown')
        error_message = e.response.get('Error', {}).get('Message', str(e))
        logger.error(f"BDA API error ({error_code}): {error_message}")
        # Re-raise to trigger SQS retry
        raise
    except Exception as e:
        logger.error(f"Unexpected error invoking BDA: {str(e)}")
        # Re-raise to trigger SQS retry
        raise


def invoke_bda_async(input_s3_uri, output_s3_uri):
    """
    Invoke the BDA InvokeDataAutomationAsync API.
    
    Args:
        input_s3_uri: S3 URI of the input document
        output_s3_uri: S3 URI for the output location
        
    Returns:
        dict: BDA API response containing invocationArn
    """
    # Build request parameters
    # dataAutomationProfileArn is required for cross-region inference
    request_params = {
        'inputConfiguration': {
            's3Uri': input_s3_uri
        },
        'outputConfiguration': {
            's3Uri': output_s3_uri
        },
        'dataAutomationProfileArn': DATA_AUTOMATION_PROFILE_ARN,
        'clientToken': str(uuid.uuid4()),
        # Enable EventBridge notifications for job completion events
        # This is required for the BDA Output Parser Lambda to be triggered
        'notificationConfiguration': {
            'eventBridgeConfiguration': {
                'eventBridgeEnabled': True
            }
        }
    }
    
    # Add project configuration if provided
    # Note: Don't specify stage - let it use the project's default stage
    if BDA_PROJECT_ARN:
        request_params['dataAutomationConfiguration'] = {
            'dataAutomationProjectArn': BDA_PROJECT_ARN
        }
    
    logger.info(f"Invoking BDA: output_bucket={request_params.get('outputConfiguration', {}).get('s3Uri', 'N/A').split('/')[2] if 's3Uri' in str(request_params.get('outputConfiguration', {})) else 'N/A'}")
    
    response = bda_runtime.invoke_data_automation_async(**request_params)
    
    return response
