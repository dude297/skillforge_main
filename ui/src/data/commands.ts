// Host commands the operator runs by hand. Approvals, promotion and rollback never go through the browser.
// Values can originate from the agent (skill names), so every argument is validated and shell-quoted here, in one
// place: a crafted name must never turn into an extra command in the operator's terminal. Pure: no DOM, no env.
const SAFE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;

export const shq = (v: string | number) => {
  const s = String(v);
  return SAFE.test(s) ? s : `'${s.replaceAll("'", `'"'"'`)}'`;
};
const BY = "<your name>"; // placeholder the operator replaces; readable, not quoted
const by = (name?: string) => (name ? shq(name) : BY);
const ids = (v: number | number[]) => (Array.isArray(v) ? v : [v]).map((i) => shq(Math.trunc(i))).join(" ");

// --expect binds the command to the change that was REVIEWED: action ids restart after a scenario reset, and the
// operator's shell may point at another database. The CLI refuses on any mismatch.
const expect = (fps?: string[]) => (fps?.length ? ` --expect ${fps.filter((f) => /^[0-9a-f]{8}$/.test(f)).join(",")}` : "");
export const approveCommand = (actionId: number | number[], name?: string, fps?: string[]) => `python3 -m app approve ${ids(actionId)} --by ${by(name)}${expect(fps)}`;
export const rejectCommand = (actionId: number | number[], name?: string, fps?: string[]) => `python3 -m app reject ${ids(actionId)} --by ${by(name)}${expect(fps)}`;
export const promoteCommand = (skill: string, version: number, name?: string) =>
  `python3 -m app skill approve ${shq(skill)} ${shq(Math.trunc(version))} --by ${by(name)}`;
export const rollbackCommand = (skill: string, name?: string) => `python3 -m app skill rollback ${shq(skill)} --by ${by(name)}`;
export const disableCommand = (skill: string, name?: string) => `python3 -m app skill disable ${shq(skill)} --by ${by(name)}`;
