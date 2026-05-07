import os
import subprocess
from langchain_core.tools import tool

@tool
def execute_cli_command(command: str) -> str:
    """
    Executes a given CLI command in the shell and returns its output.
    Useful for running scripts, tests, or interacting with the OS.
    """
    try:
        result = subprocess.run(
            command,
            shell=True,
            check=True,
            capture_output=True,
            text=True
        )
        return result.stdout
    except subprocess.CalledProcessError as e:
        return f"Command failed with error code {e.returncode}.\nSTDOUT: {e.stdout}\nSTDERR: {e.stderr}"

@tool
def read_file(file_path: str) -> str:
    """
    Reads the contents of a file.
    """
    if not os.path.exists(file_path):
        return f"Error: File {file_path} does not exist."
    try:
        with open(file_path, 'r', encoding='utf-8') as f:
            return f.read()
    except Exception as e:
        return f"Error reading file: {str(e)}"

@tool
def write_file(file_path: str, content: str) -> str:
    """
    Writes content to a file. Overwrites if the file exists.
    """
    try:
        os.makedirs(os.path.dirname(os.path.abspath(file_path)), exist_ok=True)
        with open(file_path, 'w', encoding='utf-8') as f:
            f.write(content)
        return f"Successfully wrote to {file_path}"
    except Exception as e:
        return f"Error writing file: {str(e)}"
