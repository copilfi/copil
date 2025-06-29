"""
Custom exceptions for the application.
"""

class GrantViolationError(Exception):
    """
    Raised when a workflow action violates the rules defined in its execution_grant.
    """
    def __init__(self, message: str):
        self.message = message
        super().__init__(self.message) 