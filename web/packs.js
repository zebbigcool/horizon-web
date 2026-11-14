// The launcher's pack library: resource packs, shader packs and content mods,
// kept in the browser's private file system (OPFS) under the folder the game
// page loads its saved files from (main.js), laid out as the game's own
// folders, so the game finds them when it starts: resourcepacks/*.zip,
// shaderpacks/*.hshader and horizon-mods/*.hmod. Which are switched on is
// chosen in the game (Options, Resource Packs / Shader Packs / Mods).

export const KINDS = {
    resource: { folder: "resourcepacks", ext: ".zip", max: 512 * 1024 * 1024 },
    shader: { folder: "shaderpacks", ext: ".hshader", max: 64 * 1024 * 1024 },
    mod: { folder: "horizon-mods", ext: ".hmod", max: 64 * 1024 * 1024 },
};

export const supported = () => Boolean(navigator.storage?.getDirectory);

async function dir(kind, create) {
    const root = await navigator.storage.getDirectory();
    const saved = await root.getDirectoryHandle("horizon", { create });
    return saved.getDirectoryHandle(KINDS[kind].folder, { create });
}

// A file name the game's folders accept: no path, no odd characters.
export function safeName(name) {
    const base = name.split(/[\\/]/).pop().trim().replace(/[^\w.\- ()+]/g, "_");
    return base.replace(/^\.+/, "");
}

export async function list(kind) {
    let folder;
    try {
        folder = await dir(kind, false);
    } catch (e) {
        if (e.name === "NotFoundError") return [];
        throw e;
    }
    const files = [];
    for await (const [name, handle] of folder.entries()) {
        if (handle.kind !== "file" || !name.toLowerCase().endsWith(KINDS[kind].ext)) continue;
        const file = await handle.getFile();
        files.push({ name, size: file.size });
    }
    return files.sort((a, b) => a.name.localeCompare(b.name));
}

// Adds files; returns { added: [names], problems: ["name: why"] }.
export async function add(kind, files) {
    const { ext, max } = KINDS[kind];
    const added = [];
    const problems = [];
    for (const file of files) {
        const name = safeName(file.name);
        if (!name.toLowerCase().endsWith(ext)) {
            problems.push(`${file.name}: not a ${ext} file`);
        } else if (file.size > max) {
            problems.push(`${file.name}: over ${Math.round(max / 1048576)} MB`);
        } else if (file.size === 0) {
            problems.push(`${file.name}: empty`);
        } else {
            try {
                const folder = await dir(kind, true);
                const handle = await folder.getFileHandle(name, { create: true });
                const writable = await handle.createWritable();
                await writable.write(file);
                await writable.close();
                added.push(name);
            } catch (e) {
                problems.push(`${file.name}: ${e.name === "QuotaExceededError" ? "the browser is out of storage" : e.message}`);
            }
        }
    }
    return { added, problems };
}

export async function remove(kind, name) {
    const folder = await dir(kind, false);
    await folder.removeEntry(name);
}
