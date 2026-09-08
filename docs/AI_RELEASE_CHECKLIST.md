# AI release checks

Automated checks run for pull requests and main pushes on macOS, Linux and Windows. Release builds depend on these checks: TypeScript, Vitest, the production frontend/startup-bundle check, and native Rust tests.

The regression suite uses mocked providers, temporary filesystem fixtures, DOM components and an IndexedDB test implementation. It does not contact a paid model, SSH host or third-party integration. Before publishing, also run these smoke checks in the packaged application using a disposable workspace and test SSH host, never production data.

1. Start and type in a fresh terminal, change directory, and select **Use current terminal workspace**. Check that the chat uses that directory. Switch tabs and restore a closed terminal from its chat.
2. Try an API model and each installed signed-in CLI. Stop while starting and while streaming, then immediately send a new request. Late output must not change the new reply or run another action.
3. Ask to create a small script with workspace edits disabled: nothing may be written. Enable edits and ask again: review the complete diff, apply it, then Undo. Enable auto-apply and check that only eligible local proposals apply; full overwrites and protected files must still need review.
4. Propose an edit, then change the file yourself, switch the chat's workspace, or revoke edit access. Applying the stale proposal must fail without replacing your changes.
5. In Task Mode, run a passing and a failing verification command. A later unrelated passing command must not hide the failure. Apply another edit: the previous checks must become stale. Pause terminal steps before a delayed planner response arrives; no next command may run.
6. Approve a terminal command only after checking its target. If the focused terminal, directory or SSH host changes while approval is open, Husk must refuse and ask for a fresh review. Test destructive commands only as proposals; discard them.
7. On the test SSH host, edit a small UTF-8 file and Undo. Attempt to read/edit a file larger than 256 KiB and a binary file: they must fail rather than become partial editable text. On connection timeout, verify the remote file before retrying; an already-completed remote action cannot be rolled back by cancellation.
8. Switch between two chats with different attachments, proposed edits and integration approvals. No attachment or review from the other chat should appear. Check that an integration returning an error stays failed and retryable, not completed.
9. Open Settings in its separate window. Change provider and a test API key, then return to the chat. Confirm selection/key refresh and that named providers do not inherit a previous provider's endpoint. Check a custom Local model survives restart.
10. Attach a screenshot to a vision-capable API model and ask about its contents. CLI chat must clearly refuse image attachments. In a throwaway text attachment, include a fake secret and exceed the context budget: review both warnings and ensure the chosen omissions/consent are preserved.
11. Open an older installation's chat archive, stream a response, immediately close normally and reopen. Verify chats, drafts and titles survive, incomplete tasks restore paused, and a storage failure produces a visible retry warning. Abrupt OS/process termination can still lose the last uncommitted batch.

Automated tests and these checks reduce release risk; they are not a guarantee that every provider version, remote shell or operating-system configuration is supported.
