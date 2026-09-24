# ============================================================================
# SAMPLE CODE - NOT FOR PRODUCTION USE
# This is sample code intended for demonstration and prototyping purposes only.
# It should be reviewed, tested, and validated before any production deployment.
# ============================================================================

import json
import os
import logging
import fnmatch
from typing import Dict, List, Set, Any
import boto3
from botocore.exceptions import ClientError

# Configure logging
logger = logging.getLogger()
logger.setLevel(logging.INFO)

# Initialize AWS clients
codecommit = boto3.client('codecommit')
codepipeline = boto3.client('codepipeline')
ssm = boto3.client('ssm')


def handler(event: Dict[str, Any], context: Any) -> Dict[str, Any]:
    """
    Lambda handler for monorepo pipeline triggering.
    
    Receives CodeCommit push events, calculates changed files since last commit,
    matches changed paths against registered pipelines, and triggers relevant pipelines.
    """
    try:
        detail = event.get('detail', {})
        logger.info(f"Received event: repository={detail.get('repositoryName')}, branch={detail.get('referenceName')}, commit={detail.get('commitId')}")
        repo_name = detail.get('repositoryName')
        branch = detail.get('referenceName')
        current_commit = detail.get('commitId')
        
        if not all([repo_name, branch, current_commit]):
            raise ValueError(f"Missing required event fields: repo={repo_name}, branch={branch}, commit={current_commit}")
        
        logger.info(f"Processing repository: {repo_name}, branch: {branch}, commit: {current_commit}")
        
        # Get last processed commit from SSM
        stack_name = os.environ.get('STACK_NAME', 'default')
        repo_name_env = os.environ.get('REPOSITORY_NAME', repo_name)
        branch_env = os.environ.get('BRANCH_NAME', branch)
        param_name = f"/MonoRepoTrigger/{stack_name}/{repo_name_env}/{branch_env}/LastCommit"
        last_commit = get_last_commit(param_name, repo_name, current_commit)
        
        logger.info(f"Last processed commit: {last_commit}")
        
        # Get changed files between commits
        changed_files = get_changed_files(repo_name, last_commit, current_commit)
        logger.info(f"Changed files: {changed_files}")
        
        # Load pipeline mappings from environment
        pipeline_mappings = load_pipeline_mappings()
        logger.info(f"Pipeline mappings: {pipeline_mappings}")
        
        # Determine which pipelines to trigger using glob patterns
        pipelines_to_trigger = determine_pipelines_to_trigger(changed_files, pipeline_mappings)
        logger.info(f"Pipelines to trigger: {pipelines_to_trigger}")
        
        # Trigger pipelines
        triggered_pipelines, errors = trigger_pipelines(pipelines_to_trigger)
        
        # Update last commit parameter
        update_last_commit(param_name, current_commit)
        
        # Prepare response
        response = {
            'statusCode': 200,
            'body': {
                'repository': repo_name,
                'branch': branch,
                'commitId': current_commit,
                'previousCommitId': last_commit,
                'changedFiles': changed_files,
                'triggeredPipelines': triggered_pipelines,
                'skippedPipelines': list(set(pipeline_mappings.keys()) - set(triggered_pipelines)),
                'errors': errors
            }
        }
        
        logger.info(f"Processing complete: repository={response['body'].get('repository')}, triggered={len(response['body'].get('triggeredPipelines', []))}, skipped={len(response['body'].get('skippedPipelines', []))}")
        return response
        
    except Exception as e:
        logger.error(f"Error processing event: {str(e)}", exc_info=True)
        return {
            'statusCode': 500,
            'body': {
                'error': str(e)
            }
        }


def get_last_commit(param_name: str, repo_name: str, current_commit: str) -> str:
    """Get the last processed commit from SSM parameter."""
    try:
        response = ssm.get_parameter(Name=param_name)
        last_commit = response['Parameter']['Value']
        
        # If parameter exists but is 'none' (initial value), get parent commit
        if not last_commit or last_commit == 'none':
            return get_parent_commit(repo_name, current_commit)
        
        return last_commit
        
    except ClientError as e:
        if e.response['Error']['Code'] == 'ParameterNotFound':
            logger.info(f"Parameter {param_name} not found, this is the first run")
            return get_parent_commit(repo_name, current_commit)
        else:
            raise


def get_parent_commit(repo_name: str, commit_id: str) -> str:
    """Get the parent commit of the given commit."""
    try:
        response = codecommit.get_commit(
            repositoryName=repo_name,
            commitId=commit_id
        )
        
        parents = response['commit'].get('parents', [])
        if parents:
            parent_commit = parents[0]
            logger.info(f"Using parent commit as baseline: {parent_commit}")
            return parent_commit
        else:
            # This is the initial commit, return empty string to compare against nothing
            logger.info("This is the initial commit, no parent available")
            return ""
            
    except ClientError as e:
        logger.error(f"Error getting parent commit: {e}")
        return ""


def get_changed_files(repo_name: str, before_commit: str, after_commit: str) -> List[str]:
    """Get list of changed files between two commits."""
    try:
        # If before_commit is empty (initial commit), get all files in the current commit
        if not before_commit:
            response = codecommit.get_folder(
                repositoryName=repo_name,
                commitSpecifier=after_commit,
                folderPath='/'
            )
            
            changed_files = []
            # Get all files recursively
            def collect_files(folder_path: str):
                try:
                    folder_response = codecommit.get_folder(
                        repositoryName=repo_name,
                        commitSpecifier=after_commit,
                        folderPath=folder_path
                    )
                    
                    for file_info in folder_response.get('files', []):
                        changed_files.append(file_info['absolutePath'])
                    
                    for subfolder in folder_response.get('subFolders', []):
                        collect_files(subfolder['absolutePath'])
                        
                except ClientError:
                    # Skip folders that can't be accessed
                    pass
            
            collect_files('/')
            return changed_files
        
        # Get differences between commits
        response = codecommit.get_differences(
            repositoryName=repo_name,
            beforeCommitSpecifier=before_commit,
            afterCommitSpecifier=after_commit
        )
        
        changed_files = []
        for diff in response.get('differences', []):
            # Handle different types of changes
            if 'beforeBlob' in diff and 'afterBlob' in diff:
                # Modified file
                changed_files.append(diff['afterBlob']['path'])
            elif 'afterBlob' in diff:
                # Added file
                changed_files.append(diff['afterBlob']['path'])
            elif 'beforeBlob' in diff:
                # Deleted file
                changed_files.append(diff['beforeBlob']['path'])
        
        return changed_files
        
    except ClientError as e:
        logger.error(f"Error getting changed files: {e}")
        return []


def extract_changed_paths(changed_files: List[str]) -> Set[str]:
    """Extract unique directory paths from changed files."""
    changed_paths = set()
    
    for file_path in changed_files:
        # Split path into components and build directory paths
        parts = file_path.split('/')
        
        # Add all parent directory paths
        for i in range(1, len(parts)):
            dir_path = '/'.join(parts[:i]) + '/'
            changed_paths.add(dir_path)
    
    return changed_paths


def load_pipeline_mappings() -> Dict[str, List[str]]:
    """Load pipeline-to-pattern mappings from environment variable."""
    try:
        mappings_json = os.environ.get('PIPELINE_MAPPINGS', '{}')
        return json.loads(mappings_json)
    except (json.JSONDecodeError, KeyError) as e:
        logger.error(f"Error loading pipeline mappings: {e}")
        return {}


def determine_pipelines_to_trigger(changed_files: List[str], pipeline_mappings: Dict[str, List[str]]) -> Set[str]:
    """Determine which pipelines should be triggered based on changed files and glob patterns."""
    pipelines_to_trigger = set()
    
    for pipeline_name, trigger_patterns in pipeline_mappings.items():
        for pattern in trigger_patterns:
            # Check if any changed file matches the glob pattern
            matching_files = [f for f in changed_files if fnmatch.fnmatch(f, pattern)]
            if matching_files:
                pipelines_to_trigger.add(pipeline_name)
                logger.info(f"Pipeline {pipeline_name} triggered by pattern '{pattern}' matching files: {matching_files}")
                break
    
    return pipelines_to_trigger


def trigger_pipelines(pipelines_to_trigger: Set[str]) -> tuple[List[str], List[str]]:
    """Trigger the specified pipelines and return results."""
    triggered_pipelines = []
    errors = []
    
    for pipeline_name in pipelines_to_trigger:
        try:
            logger.info(f"Starting pipeline: {pipeline_name}")
            codepipeline.start_pipeline_execution(name=pipeline_name)
            triggered_pipelines.append(pipeline_name)
            logger.info(f"Successfully started pipeline: {pipeline_name}")
            
        except ClientError as e:
            error_msg = f"{pipeline_name}: {str(e)}"
            errors.append(error_msg)
            logger.error(f"Failed to start pipeline {pipeline_name}: {e}")
    
    return triggered_pipelines, errors


def update_last_commit(param_name: str, commit_id: str) -> None:
    """Update the last processed commit in SSM parameter."""
    try:
        ssm.put_parameter(
            Name=param_name,
            Value=commit_id,
            Type='String',
            Overwrite=True
        )
        logger.info(f"Updated last commit parameter {param_name} to {commit_id}")
        
    except ClientError as e:
        logger.error(f"Failed to update last commit parameter: {e}")
        # Don't raise - this is not critical for pipeline triggering