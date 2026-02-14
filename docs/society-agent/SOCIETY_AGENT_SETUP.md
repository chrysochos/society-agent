# Society Agent Server - Quick Setup

## 🔑 API Key Configuration

1. **Get your Anthropic API key:**
    - Visit https://console.anthropic.com/settings/keys
    - Create a new API key or copy an existing one
2. **Add your API key to `.env`:**

    ```bash
    # Edit the .env file in the workspace root
    ANTHROPIC_API_KEY=sk-ant-api03-your-actual-key-here
    ```

3. **Start the server:**
    ```bash
    pnpm run server
    ```

## 🚀 Quick Start

```bash
# 1. Install dependencies (if not done already)
pnpm install

# 2. Build the frontend
cd webview-ui && pnpm run build:standalone && cd ..

# 3. Add your API key to .env file
# Edit .env and add: ANTHROPIC_API_KEY=sk-ant-api03-...

# 4. Start the server
pnpm run server

# 5. Open in browser
# Navigate to: http://localhost:3000
```

## 🌐 Access

- **Web UI:** http://localhost:3000
- **API:** http://localhost:3000/api
- **WebSocket:** ws://localhost:3000

## 📝 Usage

1. Open http://localhost:3000 in your browser
2. Type a purpose in the chat (e.g., "Create a simple Node.js Express API")
3. The supervisor agent will analyze and create a team
4. Workers execute tasks
5. View results and agent status in real-time

## 🔧 Development Mode

For auto-reload on code changes:

```bash
pnpm run server:dev
```

## ⚙️ Configuration

Edit `.env` to customize:

- `ANTHROPIC_API_KEY` - Your API key (required)
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)

## 📚 Documentation

See `SOCIETY_AGENT_README.md` for full documentation.
