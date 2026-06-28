# Agent notes — world-cup-scoreboard

**This dev box is almost certainly the deployment.** The scoreboard's only
deployment is the Mac mini, and dev sessions run _on that same machine_. So the
code you're editing here is the code that drives the real LED panel and the
kitchen Nest Hub. Treat changes as live-affecting, not hypothetical.

## The running service

The daemon runs as a launchd agent, **not** from your worktree:

- Label: `io.aubron.worldcup`
- Plist: `~/Library/LaunchAgents/io.aubron.worldcup.plist`
- Runs: `node /Users/aubron/aubron/packages/world-cup-scoreboard/dist/index.js run`
  — i.e. the **main checkout's `dist/`**, not a worktree. Worktree builds do not
  affect the service until the code lands on the main checkout and is built there.
- Logs: `~/Library/Logs/worldcup.log`
- Secrets + config (WLED host, API key, ElevenLabs key, HA token/entity) live in
  the plist's `EnvironmentVariables`. **Never commit these** — they belong only
  in the plist (and your shell when testing).

## Always do this

1. **At the start of a session, check the service exists and is up:**

   ```sh
   launchctl print gui/$(id -u)/io.aubron.worldcup | awk '/state =|pid =/'
   ```

   If it's missing, the box may not be the deployment after all — confirm before
   assuming.

2. **After a logical chunk that changes runtime behaviour, rebuild and restart
   it** so the panel/Hub actually run your change:
   ```sh
   pnpm --filter @aubron/world-cup-scoreboard build   # refresh dist/ (main checkout)
   launchctl kickstart -k gui/$(id -u)/io.aubron.worldcup
   ```
   Then verify it came back — the `dist/index.js` mtime should be recent and the
   pid fresh:
   ```sh
   sleep 4
   PID=$(launchctl print gui/$(id -u)/io.aubron.worldcup | awk '/pid =/{print $3; exit}')
   echo "dist: $(stat -f '%Sm' dist/index.js) | pid $PID started $(ps -o lstart= -p "$PID")"
   tail -5 ~/Library/Logs/worldcup.log
   ```

A clean build/test pass is not "done" here — the service has to be restarted on
the fresh `dist/` for the change to be live. Leave the service running and
healthy at the end of a session.
