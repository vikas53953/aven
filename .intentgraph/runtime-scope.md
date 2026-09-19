# Local IntentGraph runtime scope

Original intent: make the code understandable through an index and graph, and make team work, feedback, evidence and acceptance visible. The index should be useful to humans and agents. Never substitute an agent's claim of success for the owner's intended experience.

This delivery adds the local service, index and graph, reported team activity, source inspection and last observed changes, shared baselines, evidence and serialized release checks. It does not replace the approved Aven avatar family or change the chat interface.

Observable criteria:

1. An actual source file and its parsed symbols can be found, selected and inspected in the index and graph. Unresolved relationships remain explicitly unresolved.
2. Actual file changes refresh the index and retain before/after text without inventing the editing agent's identity.
3. Registered sessions, tasks and two-way feedback remain available after service restart. These registrations do not claim to launch or authenticate models.
4. Missing, stale, failed or unverified reviews cannot release a checkpoint. Reference changes invalidate approval; source changes require fresh evidence and review.
5. Explicitly instrumented execution can report parent/child spans across async calls. Static code links do not imply runtime execution.
6. The UI remains usable with keyboard navigation and narrow windows. User visual acceptance remains a separate decision.

This is a proposed runtime baseline, not a retroactive owner approval. Real AI connections, device execution, automatic agent scheduling and repository hooks need additional integration. The local release gate cannot block direct filesystem or Git operations outside its boundary.
