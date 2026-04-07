import asyncio
import subprocess
import json
import os
from pathlib import Path

from mcp.server import Server
from mcp.server.stdio import stdio_server
from mcp.types import Tool, TextContent
from dotenv import load_dotenv

# -----------------------------
# Paths
# -----------------------------
PROJECT_ROOT = Path(__file__).parent
TS_ROOT = PROJECT_ROOT / "TYPESCRIPT"
SEMANTIC_MAP_PATH = TS_ROOT / "data" / "semantic_map.json"

load_dotenv(TS_ROOT / ".env")

# -----------------------------
# MCP Server
# -----------------------------
server = Server("AutoGenie-mcp")

@server.list_tools()
async def list_tools():
    return [
        Tool(
            name="pipeline_run",
            description="Run AutoGenie pipeline and return semantic analysis JSON",
            inputSchema={
                "type": "object",
                "properties": {
                    "prompt": {"type": "string"}
                },
                "required": ["prompt"]
            }
        )
    ]

@server.call_tool()
async def call_tool(name, arguments):
    if name != "pipeline_run":
        return [TextContent(type="text", text="Unknown tool")]

    prompt = arguments.get("prompt")

    process = await asyncio.create_subprocess_exec(
        "node",
        "dist/index.js",
        prompt,
        cwd=str(TS_ROOT),
        env={**os.environ, "AutoGenie_MODE": "stage3_direct"},
        stdin=asyncio.subprocess.DEVNULL,
        stdout=asyncio.subprocess.DEVNULL,
        stderr=asyncio.subprocess.DEVNULL
    )

    await process.wait()

    if not SEMANTIC_MAP_PATH.exists():
        return [TextContent(type="text", text="semantic_map.json not found")]

    with open(SEMANTIC_MAP_PATH, "r", encoding="utf-8") as f:
        data = json.load(f)

    return [TextContent(type="text", text=json.dumps(data, indent=2))]

async def main():
    async with stdio_server() as (read, write):
        await server.run(
            read_stream=read,
            write_stream=write,
            initialization_options=server.create_initialization_options()
        )

if __name__ == "__main__":
    asyncio.run(main())
