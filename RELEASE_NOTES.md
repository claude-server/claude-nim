## Claude-NIM Proxy v1.0.0

Initial release — use any NVIDIA NIM model with Claude Code.

### Features
- VS Code extension with status bar, commands, SecretStorage
- Standalone CLI (`npx --yes claude-nim`)
- Anthropic Messages API to OpenAI-compatible translation
- 12 model-family adapters (DeepSeek, Llama, Qwen, Mistral, etc.)
- Web dashboard with real-time metrics
- Dynamic model switching via `/model` command
- `ANTHROPIC_CUSTOM_MODEL_OPTION` injection for Claude Code model picker
- AES-256-GCM encrypted API key storage
- 32 tests + 100-stream stress test
- GitHub Actions CI/CD

### Quick Start
```bash
npx --yes claude-nim
```

### Links
- [npm](https://www.npmjs.com/package/claude-nim)
- [GitHub](https://github.com/claude-nim/claude-nim)
