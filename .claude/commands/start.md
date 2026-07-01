Start the desk-bot dev environment in a tmux session with backend and frontend in separate panes, then show how to view logs.

## Steps

1. Determine the project root dynamically:

```bash
PROJECT_ROOT=$(git rev-parse --show-toplevel)
```

2. Check if tmux session `desk-bot` already exists. If it does, report what's running and skip to step 5.

3. If not running, create a new tmux session:

```bash
tmux new-session -d -s desk-bot -x 220 -y 50
```

4. Set up two windows — one for each service:

**Window 0 — Backend** (Node.js on :8000):

```bash
tmux rename-window -t desk-bot:0 'backend'
tmux send-keys -t desk-bot:0 "cd $PROJECT_ROOT/backend && npm run dev 2>&1 | tee ../tmp/desk-bot-backend.log" Enter
```

**Window 1 — Frontend** (Vite on :5173):

```bash
tmux new-window -t desk-bot -n 'frontend'
tmux send-keys -t desk-bot:1 "cd $PROJECT_ROOT/frontend && npm run dev 2>&1 | tee ../tmp/desk-bot-frontend.log" Enter
```

5. Wait 3 seconds, then tail the last 30 lines of both log files to confirm both services started without errors:

```bash
sleep 3 && echo "=== BACKEND ===" && tail -30 "$PROJECT_ROOT/tmp/desk-bot-backend.log" && echo "=== FRONTEND ===" && tail -30 "$PROJECT_ROOT/tmp/desk-bot-frontend.log"
```

6. Report status to the user with these exact attachment commands so any Claude session can debug:

```
desk-bot is running in tmux session "desk-bot":
  - Window 0 (backend)  → tmux attach -t desk-bot:0   | logs: tail -f tmp/desk-bot-backend.log
  - Window 1 (frontend) → tmux attach -t desk-bot:1   | logs: tail -f tmp/desk-bot-frontend.log

URLs:
  - Frontend PWA  → http://localhost:5173
  - Backend API   → http://localhost:8000

Quick log commands (run from project root):
  tail -f tmp/desk-bot-backend.log    # backend (Express + agent loop)
  tail -f tmp/desk-bot-frontend.log   # frontend (Vite HMR)
```

7. If either service failed to start (errors in the log tail), report the specific error and suggest a fix.
