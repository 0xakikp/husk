import { shq } from "../lib/shellQuote";
import type { Workflow } from "./store";
import type { LinkedScript } from "./library";

/** This is a transient run preview, never a copied script or saved workflow.
 * Split literal braces so the workflow placeholder parser cannot reinterpret
 * a filename such as {{check}}.sh as runtime inputs. */
export function linkedScriptWorkflow(script: LinkedScript): Workflow {
  return {
    id: script.id, name: script.name, stopOnError: true,
    steps: [shq(script.path).replace(/\{\{/g, "{''{")],
  };
}
