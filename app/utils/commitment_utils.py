import hashlib
import json
from typing import Any, Dict


def generate_commitment_hash(data: Dict[str, Any]) -> str:
    """
    Generate a commitment hash for workflow data
    
    Args:
        data: Dictionary containing workflow data
        
    Returns:
        Hex string of the hash
    """
    # Convert data to JSON string with sorted keys for consistency
    json_str = json.dumps(data, sort_keys=True, separators=(',', ':'))
    
    # Create SHA256 hash
    hash_obj = hashlib.sha256(json_str.encode('utf-8'))
    
    return hash_obj.hexdigest()


def verify_commitment(data: Dict[str, Any], expected_hash: str) -> bool:
    """
    Verify that data matches the expected commitment hash
    
    Args:
        data: Dictionary containing workflow data
        expected_hash: Expected hash value
        
    Returns:
        True if hash matches, False otherwise
    """
    actual_hash = generate_commitment_hash(data)
    return actual_hash == expected_hash 