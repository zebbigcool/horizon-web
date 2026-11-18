// The launcher's player profile: name, skin and cape, written where the game
// reads them when it starts (the saved-files folder in the browser's OPFS):
// horizon-player.txt, horizon-skin.png and horizon-cape.png. It takes effect
// the next time the game starts, so set it before joining a world or server.

import * as instances from "./instances.js";

export const CHARACTERS = ["steve", "alex", "ari", "efe", "kai", "makena", "noor", "sunny", "zuri"];
export const supported = () => Boolean(navigator.storage?.getDirectory);

const PLAYER = "horizon-player.txt";
const SKIN = "horizon-skin.png";
const CAPE = "horizon-cape.png";
const SKIN_SIZES = [[64, 64], [64, 32]];
const CAPE_SIZES = [[64, 32], [22, 17]];

// One to sixteen printable ASCII characters, no spaces (what servers accept).
export const validName = (name) => /^[\x21-\x7e]{1,16}$/.test(name);

const dir = () => instances.dir();

async function readFile(name) {
    try {
        return await (await (await dir()).getFileHandle(name)).getFile();
    } catch (e) {
        if (e.name === "NotFoundError") return null;
        throw e;
    }
}

async function writeFile(name, data) {
    const handle = await (await dir()).getFileHandle(name, { create: true });
    const out = await handle.createWritable();
    await out.write(data);
    await out.close();
}

async function removeFile(name) {
    try {
        await (await dir()).removeEntry(name);
    } catch (e) {
        if (e.name !== "NotFoundError") throw e;
    }
}

export function parse(text) {
    const out = {};
    for (const line of text.split(/\r?\n/)) {
        const at = line.indexOf(":");
        if (at > 0) out[line.slice(0, at)] = line.slice(at + 1);
    }
    return out;
}

export async function load() {
    const profile = { name: "", skin: "steve", slim: false, cape: false, skinFile: null, capeFile: null };
    const text = await readFile(PLAYER);
    if (text) {
        const p = parse(await text.text());
        if (validName(p.name ?? "")) profile.name = p.name;
        if (p.skin) profile.skin = p.skin;
        profile.slim = p.slim === "true";
        profile.cape = p.cape === "true";
    }
    profile.skinFile = await readFile(SKIN);
    profile.capeFile = await readFile(CAPE);
    if (profile.skin === "custom" && !profile.skinFile) profile.skin = "steve";
    if (profile.cape && !profile.capeFile) profile.cape = false;
    return profile;
}

export async function save({ name, skin, slim, cape }) {
    if (!validName(name)) throw new Error("A name is 1 to 16 characters, with no spaces.");
    await writeFile(PLAYER, `name:${name}\nskin:${skin}\nslim:${Boolean(slim)}\ncape:${Boolean(cape)}\n`);
}

// A PNG's pixel size, or null when the browser can't read it as an image.
export async function imageSize(file) {
    try {
        const bitmap = await createImageBitmap(file);
        const size = [bitmap.width, bitmap.height];
        bitmap.close();
        return size;
    } catch {
        return null;
    }
}

const fits = (size, allowed) => size && allowed.some(([w, h]) => w === size[0] && h === size[1]);

async function importImage(file, target, allowed, what) {
    if (!fits(await imageSize(file), allowed)) {
        throw new Error(`That isn't a ${what} image (${allowed.map((s) => s.join("×")).join(" or ")} pixels).`);
    }
    await writeFile(target, file);
}

export const importSkin = (file) => importImage(file, SKIN, SKIN_SIZES, "skin");
export const importCape = (file) => importImage(file, CAPE, CAPE_SIZES, "cape");
export const removeSkin = () => removeFile(SKIN);
export const removeCape = () => removeFile(CAPE);
