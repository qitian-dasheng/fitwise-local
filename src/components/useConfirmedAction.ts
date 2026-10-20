import { useRef, useState } from "react";
import type { ActionResult } from "../store/appStore";

// Keep the ID for an unchanged failed request; a changed form starts a new command.
export function useConfirmedAction() {
  const inFlight = useRef(false);
  const commands = useRef(new Map<string, string>());
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function run(key: string, action: (commandId: string) => Promise<ActionResult>): Promise<ActionResult> {
    if (inFlight.current) return { error: "正在保存上一项操作。" };
    const commandId = commands.current.get(key) ?? crypto.randomUUID();
    commands.current.set(key, commandId);
    inFlight.current = true;
    setBusy(true);
    setMessage("");
    try {
      const result = await action(commandId);
      if (result.error) setMessage(result.error);
      else commands.current.delete(key);
      return result;
    } catch (cause) {
      const error = cause instanceof Error ? cause.message : String(cause);
      setMessage(error);
      return { error };
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }
  return { run, busy, message, setMessage };
}
