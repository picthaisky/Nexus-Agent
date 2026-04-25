import os
import logging
from typing import Optional, List, Dict, Any
from openai import OpenAI
from pydantic import BaseModel

logger = logging.getLogger(__name__)

class InferenceConfig(BaseModel):
    local_base_url: str = "http://localhost:8000/v1"
    local_api_key: str = "EMPTY"  # vLLM default
    local_model: str = "meta-llama/Meta-Llama-3-8B-Instruct"
    
    cloud_base_url: str = "https://api.openai.com/v1"
    cloud_api_key: Optional[str] = None
    cloud_model: str = "gpt-4o-mini"
    
    use_cloud_fallback: bool = True

class InferenceEngine:
    """
    Handles model inference with local vLLM primarily,
    and falls back to Cloud API (OpenAI/Anthropic) when local is unavailable or under heavy load.
    """
    def __init__(self, config: InferenceConfig = InferenceConfig()):
        self.config = config
        
        # Local Client (vLLM)
        self.local_client = OpenAI(
            base_url=self.config.local_base_url,
            api_key=self.config.local_api_key
        )
        
        # Cloud Client (Fallback)
        self.cloud_client = None
        if self.config.use_cloud_fallback:
            api_key = self.config.cloud_api_key or os.environ.get("OPENAI_API_KEY")
            if api_key:
                self.cloud_client = OpenAI(
                    base_url=self.config.cloud_base_url,
                    api_key=api_key
                )
            else:
                logger.warning("Cloud fallback enabled but no OPENAI_API_KEY provided.")

    def generate(self, messages: List[Dict[str, str]], temperature: float = 0.7, max_tokens: int = 1024) -> str:
        """
        Send a chat completion request to the inference engine.
        Try local vLLM first, then fallback to cloud if failed.
        """
        try:
            # Try Local inference first
            response = self.local_client.chat.completions.create(
                model=self.config.local_model,
                messages=messages, # type: ignore
                temperature=temperature,
                max_tokens=max_tokens
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            logger.error(f"Local inference failed: {str(e)}")
            if self.config.use_cloud_fallback and self.cloud_client:
                logger.info("Falling back to Cloud API...")
                return self._generate_cloud(messages, temperature, max_tokens)
            else:
                raise RuntimeError("Local inference failed and no cloud fallback available.") from e
                
    def _generate_cloud(self, messages: List[Dict[str, str]], temperature: float = 0.7, max_tokens: int = 1024) -> str:
        try:
            response = self.cloud_client.chat.completions.create( # type: ignore
                model=self.config.cloud_model,
                messages=messages, # type: ignore
                temperature=temperature,
                max_tokens=max_tokens
            )
            return response.choices[0].message.content or ""
        except Exception as e:
            logger.error(f"Cloud inference failed: {str(e)}")
            raise
