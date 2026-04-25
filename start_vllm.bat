@echo off
echo Starting local vLLM inference server...
echo Make sure you have activated your Python environment and installed vllm (pip install vllm)
echo The server will be exposed as an OpenAI-compatible API on http://localhost:8000/v1

:: You can change the model name to any HuggingFace model supported by vLLM
set MODEL_NAME=meta-llama/Meta-Llama-3-8B-Instruct
set HOST=0.0.0.0
set PORT=8000

python -m vllm.entrypoints.openai.api_server --model %MODEL_NAME% --host %HOST% --port %PORT% --gpu-memory-utilization 0.9 --max-model-len 4096
