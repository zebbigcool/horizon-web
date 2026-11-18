// Instances: separate game folders (worlds, options, packs, player profile)
// in the browser's private file system. "Default" is the folder the game
// always used, so nothing moves for existing players; the others live next to
// it in `horizon-instances/<id>`, outside the folder the game reads.

const LIST_KEY = "horizon-instances";
const ACTIVE_KEY = "horizon-instance";
export const DEFAULT = "default";
const NAME_MAX = 32;

const read = (key) => {
    try {
        return localStorage.getItem(key);
    } catch {
        return null;
    }
};
const write = (key, value) => {
    try {
        localStorage.setItem(key, value);
    } catch {
        // Not remembered.
    }
};

const stored = () => {
    try {
        const list = JSON.parse(read(LIST_KEY) ?? "[]");
        return Array.isArray(list) ? list.filter((i) => i && typeof i.id === "string" && typeof i.name === "string") : [];
    } catch {
        return [];
    }
};

export const list = () => [{ id: DEFAULT, name: "Default" }, ...stored()];
export const activeId = () => {
    const id = read(ACTIVE_KEY);
    return id && list().some((i) => i.id === id) ? id : DEFAULT;
};
export const active = () => list().find((i) => i.id === activeId());
export const setActive = (id) => {
    if (list().some((i) => i.id === id)) write(ACTIVE_KEY, id);
};
export const supported = () => Boolean(navigator.storage?.getDirectory);

export const cleanName = (name) => String(name ?? "").replace(/\s+/g, " ").trim().slice(0, NAME_MAX);

/** The OPFS folder of an instance (the active one by default). */
export async function dir(id = activeId(), create = true) {
    const root = await navigator.storage.getDirectory();
    if (id === DEFAULT) return root.getDirectoryHandle("horizon", { create });
    const all = await root.getDirectoryHandle("horizon-instances", { create });
    return all.getDirectoryHandle(id, { create });
}

async function copyDir(from, to) {
    for await (const [name, handle] of from.entries()) {
        if (handle.kind === "directory") {
            await copyDir(handle, await to.getDirectoryHandle(name, { create: true }));
        } else {
            const out = await (await to.getFileHandle(name, { create: true })).createWritable();
            await (await handle.getFile()).stream().pipeTo(out);
        }
    }
}

/** Adds an instance (optionally a copy of another's files) and returns it. */
export async function create(name, copyFrom = null) {
    const clean = cleanName(name);
    if (!clean) throw new Error("Give the instance a name.");
    const id = `i${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const folder = await dir(id, true);
    if (copyFrom) await copyDir(await dir(copyFrom, true), folder);
    write(LIST_KEY, JSON.stringify([...stored(), { id, name: clean }]));
    return { id, name: clean };
}

export function rename(id, name) {
    const clean = cleanName(name);
    if (!clean) throw new Error("Give the instance a name.");
    if (id === DEFAULT) throw new Error("The default instance keeps its name.");
    write(LIST_KEY, JSON.stringify(stored().map((i) => (i.id === id ? { ...i, name: clean } : i))));
}

/** Deletes an instance and everything in it. The default one can't be deleted. */
export async function remove(id) {
    if (id === DEFAULT) throw new Error("The default instance can't be deleted.");
    write(LIST_KEY, JSON.stringify(stored().filter((i) => i.id !== id)));
    if (read(ACTIVE_KEY) === id) write(ACTIVE_KEY, DEFAULT);
    try {
        const root = await navigator.storage.getDirectory();
        await (await root.getDirectoryHandle("horizon-instances")).removeEntry(id, { recursive: true });
    } catch (e) {
        if (e.name !== "NotFoundError") throw e;
    }
}

export const clearInstances = () => {
    for (const key of [LIST_KEY, ACTIVE_KEY]) {
        try {
            localStorage.removeItem(key);
        } catch {
            // Nothing to clear.
        }
    }
};
