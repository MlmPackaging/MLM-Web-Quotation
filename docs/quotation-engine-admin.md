# Quotation engine administration

The staff quotation-engine workspace is available at `/html/quotation-engine.html`. It reads and writes the PostgreSQL rate-card tables used by the current customer quotation page. Apply the updated `quotation_schema.postgresql.sql` before using the editor so the audit-log table exists.

## Version workflow

- Published versions are read-only. Choose **Create draft from this version** to copy any active or archived snapshot into a new draft.
- Edit a draft's parameters, calculation-tier values, and option records. These changes do not affect customer quotations until published.
- Saving a parameter keeps other unsaved edits on the page in place; those edits remain unsaved until their own save action is used.
- **Publish draft** archives the current active version and makes the draft active.
- Select an archived version to preview its full rate card in the same editor. **Restore this version** makes that immutable snapshot active again; it does not create a new rate version.
- Each parameter, tier cell, and option has a history viewer. Reverting a history entry clones the current active rate card, applies the old value, and publishes the clone as a new version. This retains both the current and reverted states in version history.

Audit records are written transactionally to `quotation_rate_audit_log` with the authenticated staff account and event timestamp. Staff identity is taken from the verified admin token and active staff record, not from browser-submitted audit fields.

The editor exposes database-driven inputs used by the calculation engine. Calculation handler logic itself remains server-side code; the `formula_expression` column is descriptive and is not evaluated as executable formulas.
