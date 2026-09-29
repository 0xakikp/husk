export type PodOwnership =
  | { status: "controlled"; kind: string; name: string; via?: string; note?: string }
  | { status: "none" }
  | { status: "unavailable"; error: string };

export type ControllerMetadata = {
  namespace: string;
  name: string;
  uid: string;
  controller?: { kind: string; name: string; uid: string };
};

// Project only identity and controlling owner references, not full Pod specs,
// annotations, env values or other potentially sensitive/large metadata.
export const CONTROLLER_COLUMNS = "custom-columns=NAMESPACE:.metadata.namespace,NAME:.metadata.name,UID:.metadata.uid,KIND:.metadata.ownerReferences[?(@.controller==true)].kind,OWNER:.metadata.ownerReferences[?(@.controller==true)].name,OWNER_UID:.metadata.ownerReferences[?(@.controller==true)].uid";

export function parseControllerMetadata(output: string): Map<string, ControllerMetadata> {
  const records = new Map<string, ControllerMetadata>();
  for (const line of output.trim().split("\n").filter(Boolean)) {
    const columns = line.trim().split(/\s+/);
    if (columns.length !== 6 || columns.some(column => column.includes(","))) {
      throw new Error("Controller metadata was incomplete or ambiguous.");
    }
    const [namespace, name, uid, kind, ownerName, ownerUid] = columns;
    if ([namespace, name, uid].some(value => value === "<none>")) {
      throw new Error("Resource identity was missing from controller metadata.");
    }
    const owner = [kind, ownerName, ownerUid];
    const absent = owner.every(value => value === "<none>");
    if (!absent && owner.some(value => value === "<none>")) {
      throw new Error("Controller identity was incomplete.");
    }
    const key = `${namespace}/${name}`;
    if (records.has(key)) throw new Error("Duplicate resource identity in controller metadata.");
    records.set(key, { namespace, name, uid, controller: absent ? undefined : { kind, name: ownerName, uid: ownerUid } });
  }
  return records;
}

export function podOwnershipLabel(ownership?: PodOwnership): { label: string; title: string } {
  if (ownership?.status === "controlled") {
    return {
      label: `${ownership.kind} · ${ownership.name}`,
      title: `Controller: ${ownership.kind} ${ownership.name}${ownership.via ? ` via ReplicaSet ${ownership.via}` : ""}.${ownership.note ? ` ${ownership.note}` : ""}`,
    };
  }
  if (ownership?.status === "none") {
    return { label: "No controller", title: "No controlling owner reference was present in this snapshot. This does not establish whether another external tool manages this Pod." };
  }
  return { label: "Ownership unavailable", title: ownership?.error || "Controller metadata has not been loaded." };
}
