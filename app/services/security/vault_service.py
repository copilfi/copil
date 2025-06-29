# backend/app/services/security/vault_service.py
import boto3
from botocore.exceptions import ClientError
import logging
import base64
from typing import Dict

from app.core.config import settings

logger = logging.getLogger(__name__)

class VaultException(Exception):
    """Custom exception for vault service errors."""
    pass

class SecureVaultService:
    """
    A service for encrypting and decrypting data using AWS KMS.
    This service abstracts the direct interaction with AWS KMS.
    """

    def __init__(self, region_name: str = settings.AWS_REGION_NAME, key_id: str = settings.AWS_KMS_KEY_ID):
        if not key_id:
            logger.error("AWS_KMS_KEY_ID is not configured. Vault service is disabled.")
            raise ValueError("AWS KMS Key ID must be configured.")
        
        try:
            self.kms_client = boto3.client("kms", region_name=region_name)
            self.key_id = key_id
            logger.info(f"SecureVaultService initialized for KMS Key ID: {key_id[:10]}... in region {region_name}")
        except ClientError as e:
            logger.critical(f"Failed to initialize AWS KMS client: {e}", exc_info=True)
            raise VaultException("Could not initialize connection with AWS KMS.") from e

    def encrypt(self, data: bytes, encryption_context: Dict[str, str]) -> bytes:
        """
        Encrypts plaintext data using the configured KMS key.

        :param data: The plaintext data to encrypt (as bytes).
        :param encryption_context: A dictionary of key-value pairs that provides additional context
                                   to the encryption. This context must be provided for decryption.
                                   It's logged by AWS CloudTrail and can be used in IAM policies.
        :return: The encrypted ciphertext (as bytes).
        :raises VaultException: If encryption fails.
        """
        if not isinstance(data, bytes):
            raise TypeError("Data to be encrypted must be in bytes.")
            
        try:
            response = self.kms_client.encrypt(
                KeyId=self.key_id,
                Plaintext=data,
                EncryptionContext=encryption_context
            )
            logger.debug(f"Successfully encrypted data with context: {encryption_context}")
            # The response['CiphertextBlob'] is already in bytes
            return response['CiphertextBlob']
        except ClientError as e:
            logger.error(f"Encryption failed: {e}", exc_info=True)
            raise VaultException("Failed to encrypt data with AWS KMS.") from e

    def decrypt(self, ciphertext: bytes, encryption_context: Dict[str, str]) -> bytes:
        """
        Decrypts ciphertext using the configured KMS key.

        :param ciphertext: The encrypted data (as bytes).
        :param encryption_context: The same key-value pairs that were used during encryption.
                                   This ensures the integrity and context of the decryption request.
        :return: The decrypted plaintext data (as bytes).
        :raises VaultException: If decryption fails or context doesn't match.
        """
        if not isinstance(ciphertext, bytes):
            raise TypeError("Ciphertext to be decrypted must be in bytes.")
            
        try:
            response = self.kms_client.decrypt(
                KeyId=self.key_id,
                CiphertextBlob=ciphertext,
                EncryptionContext=encryption_context
            )
            logger.debug(f"Successfully decrypted data with context: {encryption_context}")
            # The response['Plaintext'] is already in bytes
            return response['Plaintext']
        except ClientError as e:
            error_code = e.response.get("Error", {}).get("Code")
            if error_code == "InvalidCiphertextException":
                logger.error(f"Decryption failed: The ciphertext is invalid or the encryption context does not match. Context: {encryption_context}")
                raise VaultException("Decryption failed due to invalid ciphertext or mismatched context.") from e
            
            logger.error(f"Decryption failed: {e}", exc_info=True)
            raise VaultException("Failed to decrypt data with AWS KMS.") from e

    # Convenience methods for handling base64 encoded strings, which are useful for storing in DB
    def encrypt_to_base64(self, data: bytes, context: Dict[str, str]) -> str:
        """Encrypts data and returns a base64 encoded string."""
        encrypted_bytes = self.encrypt(data, context)
        return base64.b64encode(encrypted_bytes).decode('utf-8')

    def decrypt_from_base64(self, b64_ciphertext: str, context: Dict[str, str]) -> bytes:
        """Decrypts a base64 encoded string and returns the original bytes."""
        try:
            ciphertext_bytes = base64.b64decode(b64_ciphertext)
            return self.decrypt(ciphertext_bytes, context)
        except (ValueError, TypeError) as e:
            logger.error(f"Invalid base64 string for decryption: {e}")
            raise VaultException("Invalid base64 format for ciphertext.") from e


# Singleton instance for use across the application
try:
    vault_service = SecureVaultService()
except ValueError:
    # This allows the application to start even if KMS is not configured,
    # but any service that depends on it will fail.
    vault_service = None
    logger.warning("Vault service is not available. Any feature requiring encryption will fail.") 