"""MCP service package for Viralo's Model Context Protocol server.

This module provides the Model Context Protocol (MCP) server implementation for Viralo,
enabling external clients to interact with Viralo's core services through a unified
RESTful API.

The MCP server serves as a unified interface layer that:
- Handles authentication and token management
- Proxies calls to existing Viralo services
- Manages tool endpoints for clip operations, publishing, scheduling
- Provides workspace context and status monitoring

Key components:
- `auth.py`: OAuth2 token issuance and API key validation
- `client.py`: HTTP client for inter-service communication
- `tools/`: Specific tool implementations for each Viralo service
"""

# Import main server and auth components for easy access
from mcp_svc.server import app
from mcp_svc.auth import issue_token