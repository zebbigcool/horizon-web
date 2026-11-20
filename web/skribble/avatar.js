// The little round faces: a colour, eyes, a mouth and an accessory, each picked from a
// short list. avatar([colour, eyes, mouth, accessory]) is an SVG string. The counts
// match AVATAR in rooms-service/src/draw.js.
export const COUNTS = [16, 12, 12, 10];
const COLOURS = ["#ffd23f", "#ff8a3d", "#ff5d73", "#f06bd0", "#b27cff", "#6c7bff", "#3fa7ff", "#2fd3d0", "#3fd98a", "#9be04a", "#c9a27e", "#8b6b4a", "#e8e8ef", "#9aa3b5", "#ffb3c7", "#f5e6a8"];
const ink = "#1d1630";

const EYES = [
    `<circle cx="35" cy="42" r="5" fill="${ink}"/><circle cx="65" cy="42" r="5" fill="${ink}"/>`,
    `<circle cx="35" cy="42" r="9" fill="#fff"/><circle cx="65" cy="42" r="9" fill="#fff"/><circle cx="37" cy="43" r="4.5" fill="${ink}"/><circle cx="63" cy="43" r="4.5" fill="${ink}"/>`,
    `<path d="M27 45q8-12 16 0M57 45q8-12 16 0" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`,
    `<circle cx="35" cy="42" r="11" fill="#fff" stroke="${ink}" stroke-width="2"/><circle cx="65" cy="42" r="11" fill="#fff" stroke="${ink}" stroke-width="2"/><circle cx="35" cy="42" r="4" fill="${ink}"/><circle cx="65" cy="42" r="4" fill="${ink}"/>`,
    `<path d="M27 43h16M57 43h16" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`,
    `<circle cx="35" cy="45" r="4.5" fill="${ink}"/><circle cx="65" cy="45" r="4.5" fill="${ink}"/><path d="M26 34l18 6M74 34l-18 6" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M29 37l12 12M41 37l-12 12M59 37l12 12M71 37l-12 12" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`,
    `<circle cx="50" cy="42" r="14" fill="#fff" stroke="${ink}" stroke-width="2"/><circle cx="50" cy="42" r="6" fill="${ink}"/>`,
    `<circle cx="35" cy="42" r="8" fill="${ink}"/><circle cx="65" cy="42" r="8" fill="${ink}"/><circle cx="32" cy="39" r="3" fill="#fff"/><circle cx="62" cy="39" r="3" fill="#fff"/>`,
    `<circle cx="35" cy="42" r="5" fill="${ink}"/><path d="M57 44q8-11 16 0" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`,
    `<circle cx="38" cy="43" r="2.5" fill="${ink}"/><circle cx="62" cy="43" r="2.5" fill="${ink}"/>`,
    `<path d="M35 49c-9-6-9-14-3-14 2 0 3 1 3 3 0-2 1-3 3-3 6 0 6 8-3 14zM65 49c-9-6-9-14-3-14 2 0 3 1 3 3 0-2 1-3 3-3 6 0 6 8-3 14z" fill="#e8344f"/>`,
];
const MOUTHS = [
    `<path d="M33 64q17 16 34 0" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M30 62h40q-3 20-20 20t-20-20z" fill="${ink}"/><path d="M38 76q12 8 24 0q-12-4-24 0z" fill="#ff6f7d"/>`,
    `<path d="M36 70h28" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`,
    `<ellipse cx="50" cy="70" rx="7" ry="9" fill="${ink}"/>`,
    `<path d="M33 64q17 14 34 0" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/><path d="M44 70h12v8q-6 6-12 0z" fill="#ff6f7d" stroke="${ink}" stroke-width="2"/>`,
    `<path d="M34 76q16-16 32 0" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M30 63h40q-2 15-20 15t-20-15z" fill="#fff" stroke="${ink}" stroke-width="3"/><path d="M40 63v14M50 63v15M60 63v14" stroke="${ink}" stroke-width="2"/>`,
    `<path d="M36 70q14 2 30-8" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round"/>`,
    `<path d="M32 66q9 10 18 0q9 10 18 0" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<path d="M32 70l7-7 7 7 7-7 7 7 7-7" fill="none" stroke="${ink}" stroke-width="4" stroke-linecap="round" stroke-linejoin="round"/>`,
    `<circle cx="50" cy="70" r="3.5" fill="${ink}"/>`,
    `<ellipse cx="50" cy="71" rx="13" ry="8" fill="${ink}"/><ellipse cx="50" cy="75" rx="7" ry="3.5" fill="#ff6f7d"/>`,
];
const ACCESSORIES = [
    "",
    `<rect x="31" y="2" width="38" height="22" rx="3" fill="#2b2540"/><rect x="21" y="21" width="58" height="7" rx="3" fill="#2b2540"/><rect x="31" y="16" width="38" height="5" fill="#e8344f"/>`,
    `<path d="M26 22l4-18 12 12 8-14 8 14 12-12 4 18z" fill="#ffc83d" stroke="#c98a00" stroke-width="2" stroke-linejoin="round"/>`,
    `<path d="M66 14l16-8v22zM66 14L50 6v22z" fill="#ff5d9e" stroke="#c4306f" stroke-width="2" stroke-linejoin="round" transform="translate(6 4)"/><circle cx="72" cy="18" r="5" fill="#c4306f"/>`,
    `<circle cx="35" cy="42" r="13" fill="none" stroke="${ink}" stroke-width="3"/><circle cx="65" cy="42" r="13" fill="none" stroke="${ink}" stroke-width="3"/><path d="M48 42h4" stroke="${ink}" stroke-width="3"/>`,
    `<path d="M9 30q41-26 82 0v8q-41-24-82 0z" fill="#ff5d73"/>`,
    `<path d="M20 22q-8-10-2-18 6 6 12 10zM80 22q8-10 2-18-6 6-12 10z" fill="#c33"/>`,
    `<path d="M50 6V-6" stroke="${ink}" stroke-width="3"/><circle cx="50" cy="-8" r="5" fill="#ff5d73"/>`,
    `<g transform="translate(70 12)"><circle r="3" fill="#ffd23f"/><g fill="#ff7bbd"><circle cx="0" cy="-6" r="4"/><circle cx="6" cy="0" r="4"/><circle cx="0" cy="6" r="4"/><circle cx="-6" cy="0" r="4"/></g><circle r="3" fill="#ffd23f"/></g>`,
    `<path d="M18 28q4-22 32-22t32 22z" fill="#3f6bff"/><path d="M60 28h30q0 6-30 6z" fill="#2c4bd0"/>`,
];

export function avatar(av = [0, 0, 0, 0]) {
    const [c, e, m, a] = COUNTS.map((n, i) => Math.min(n - 1, Math.max(0, Math.round(Number(av[i]) || 0))));
    return `<svg viewBox="-6 -16 112 122" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="50" cy="50" r="46" fill="${COLOURS[c]}" stroke="${ink}" stroke-width="4"/>${EYES[e]}${MOUTHS[m]}${ACCESSORIES[a]}</svg>`;
}

export const randomAvatar = () => COUNTS.map((n) => Math.floor(Math.random() * n));
