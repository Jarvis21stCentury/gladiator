/**
 * The footer.
 *
 * This used to be a full index: all six sections, each with its name, a serial
 * and a sentence describing it, in a three-column grid closing every page. That
 * earned its space when navigation was a masthead that scrolled away — it was
 * the only place the whole product was described in one view.
 *
 * A persistent sidebar made it redundant, and a redundant block of text at the
 * bottom of every page is exactly the crowding this pass is removing. What is
 * left is the one thing the sidebar does not say: what this is wired to.
 */
export function Colophon() {
  return (
    <footer className="sheet mt-auto pb-[var(--block)] pt-[var(--section)]">
      <p className="docket text-[0.6875rem] text-ink-faint">
        Gladiator · Canvas + Google Calendar
      </p>
    </footer>
  );
}
