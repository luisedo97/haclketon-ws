#!/bin/sh
set -e

MODEL="${OLLAMA_MODEL:-gemma3:1b}"

echo "Starting Ollama server..."
ollama serve &
OLLAMA_PID=$!

echo "Waiting for Ollama to be ready..."
until ollama list > /dev/null 2>&1; do
  sleep 1
done

echo "Pulling model: $MODEL"
ollama pull "$MODEL"

echo "Ollama ready with model $MODEL"
wait $OLLAMA_PID
