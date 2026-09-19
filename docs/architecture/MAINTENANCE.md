# Maintaining the architecture atlas

The product owner requested an educational HLD that stays aligned with implementation.

After a meaningful architecture change:
1. Edit `architecture.json`: affected layer, actual status, code location and date.
2. Add a dated change entry. Link execution evidence for claims of working behavior.
3. Keep selected designs distinct from implemented integrations. Mark partial work explicitly.
4. Run `node docs/architecture/build-hld.cjs` from the project root.
5. Open `/docs/architecture/` and verify current/target views and the guided walkthrough.

The JSON is the shared source for the infographic and HLD. Do not independently edit generated HLD.md. This is manual maintenance during project work, not an autonomous scheduled monitor. Recheck older evidence before claiming current service availability.
