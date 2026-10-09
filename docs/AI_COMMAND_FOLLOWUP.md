# Command follow-up in Chat and Task

**Auto follow-up** is on by default and can be switched off per conversation above the input. It applies only to commands explicitly launched with **Run command** from that chat. It does not watch commands manually typed in a terminal. Chat offers one-command analysis; Task additionally tracks the objective, reviewed changes and verification evidence.

1. Review the suggested command and its terminal/workspace. Existing execution approvals still apply.
2. Click **Run command**. Husk waits for the matching shell-integration completion event, output and exit status.
3. A collapsible **Terminal result** appears in the originating conversation. AI explains the result and suggests the next step. This observer request has no tools or edit permissions; its proposals are not executed.
4. Review any next command and click Run yourself, or type a correction in the same chat. Sending feedback cancels automatic analysis in progress, preserves the command evidence, and starts the normal chat reply. Unsent drafts and attachments are not consumed by automatic analysis.

## Stop and interrupt

- **Stop follow-up** cancels the observer request. **Stop Task** also stops Task work and clears outstanding terminal approvals. The Task Stop button remains available with the Task card collapsed.
- Neither button silently terminates a shell command. **Interrupt command… → Send Ctrl+C** is a separate, explicit action bound to that command's original terminal and connection. Husk refuses stale interrupts. Ctrl+C is not rollback; a program can ignore it or leave work already performed intact.
- Terminal/chat/workspace/host changes, paused Tasks, lost provenance, or unconfirmed completion stop automatic continuation. After 90 seconds without confirmed completion, the observer pauses; it does not kill the command. A later confirmed result may still be recorded, but is not automatically analyzed.
- **Analyze result** explicitly requests a one-time explanation of a retained result, once the original scope is available and the chat has no unsent draft. It works while the same Task is **paused**, and with **Auto follow-up off**. It does not resume Task, enable automatic follow-ups or rerun the command. Stop still cancels the explanation. Stopped/completed/replaced Tasks and changed targets remain blocked with a specific reason.
- Restarting Husk never restores a live observer or replays commands. The older, explicitly started **Terminal steps** diagnostic loop is separate; normal Run follow-ups do not start it.

## Data and limitations

Confirmed, checked command results are saved with the existing local chat history, even when automatic sharing is off. The saved excerpt is bounded, labelled with its command/terminal/exit status, and expandable. Automatic analysis includes only that result, the applicable Task objective and bounded text from the same conversation—not live scrollback, editor files, unrelated commands, attachments or images. Existing provider settings determine where AI requests are sent.

Secret-pattern matches pause sharing and prevent the result from being automatically saved; only a generic notice is saved. Review/redact an excerpt manually to continue. Secret detection is a safeguard, not a guarantee that output is non-sensitive. Terminal captures and model context are bounded; omissions are disclosed. A zero exit status does not prove the entire Task is finished.

## Packaged-app smoke checks

Use a disposable local folder, a fresh shell with Husk integration and an API or signed-in provider. Do not use production credentials or hosts.

1. Ask for `printf 'follow-up test\n'` in a shell code block. Click Run in ordinary Chat, then repeat inside Task. Expect one saved result and one automatic analysis, with no next command executed.
2. Turn Auto follow-up off and run it again: save the result locally, but make no model request. Analyze result should work explicitly. Repeat with Task paused: clicking Analyze must produce one explanation while the Task badge stays paused. Turning Auto follow-up off during that explicit explanation must not cancel it; Stop must still cancel it. Turning the toggle back on must not replay a previous result.
3. Run `sleep 5` from chat and click Stop follow-up (or Stop Task). Its eventual result may be saved; no automatic analysis may start. Repeat with Interrupt command and confirm Ctrl+C. Canceling the confirmation must send nothing.
4. While analysis streams, type “That was the wrong command; explain it without running anything” and send. The correction must take priority, old deltas must stop, and earlier command evidence must remain in context.
5. Switch terminal/chat/host before completion. The original result must not appear in another conversation or trigger an automatic request from it. Return and explicitly Analyze result if appropriate.
6. Run a harmless command that prints a fake `password=example-secret-only`. The result must not be saved or sent automatically. Test an unrelated manually typed copy of the same command: it must not satisfy an old waiting observation.
7. Pause/stop Task with a terminal approval open, then try its old approval. Nothing should run. Collapse the Task card and verify Stop remains visible.
8. Test narrow/light/dark layouts, keyboard toggle/confirmation, long output, a nonzero exit, absent shell markers and application restart. No guessed success, duplicate analysis or replay is allowed.
