//! Badges: how a shared world tells the site's owner from someone who typed the same name,
//! and who the world's owner is, to colour their names in chat, the Tab list and the join
//! line.
//!
//! A name proves nothing (the profile is made from it), so the rooms service signs a
//! short-lived *badge* for a logged-in player: Ed25519 over a small JSON payload
//! (`v1.<payload hex>.<signature hex>`, web/rooms-service/src/accounts.js). The player's
//! page keeps it current ([`horizon_os::badge`]) and the game answers the host's
//! `horizon:badge` login query with it. The host checks the signature with the service's
//! public key (also from its page), that it hasn't run out, and that the badge's display
//! name is the name being joined with; only then does the badge colour anything.
//!
//! * The site owner's badge carries the nametag they picked: a rainbow (a colour per
//!   letter, so it is a still gradient) or one colour.
//! * The world's owner (the player whose world it is) is red while the world is shared
//!   (its folder was opened to guests: [`super::identity::world`]).
//!
//! A badge is good for ten minutes, so a host who saw one could replay it elsewhere for
//! that long; all it buys is a colour. Nothing here changes how anyone is admitted.
use ed25519_dalek::{Signature, VerifyingKey};
use horizon_os::time::{SystemTime, UNIX_EPOCH};
use serde_json::{Value, json};
use std::sync::Mutex;

pub const CHANNEL: &str = "horizon:badge";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Style {
    /// A still gradient through the colours of the rainbow, one per letter.
    Rainbow,
    /// One colour, `#rrggbb`.
    Color(String),
    /// The shared world's owner.
    Red,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Verified {
    /// The display name the badge was made for.
    pub display: String,
    /// How the site's owner's name is drawn; none for everyone else.
    pub style: Option<Style>,
}

/// The coloured players of the world being run: (UUID, name, style).
static STYLES: Mutex<Vec<(u128, String, Style)>> = Mutex::new(Vec::new());

fn locked<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    horizon_os::sync::lock(m).unwrap_or_else(|e| e.into_inner())
}

fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis() as u64)
}

fn hex_decode(text: &str) -> Option<Vec<u8>> {
    if text.len() % 2 != 0 || !text.is_ascii() {
        return None;
    }
    (0..text.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&text[i..i + 2], 16).ok())
        .collect()
}

fn is_color(text: &str) -> bool {
    text.len() == 7 && text.starts_with('#') && text[1..].bytes().all(|b| b.is_ascii_hexdigit())
}

/// The badge's payload when its signature is good for `key` and it hasn't run out at `now_ms`.
pub fn verify(badge: &str, key: &[u8; 32], now_ms: u64) -> Option<Verified> {
    let mut parts = badge.split('.');
    if parts.next()? != "v1" {
        return None;
    }
    let payload = hex_decode(parts.next()?)?;
    let signature: [u8; 64] = hex_decode(parts.next()?)?.try_into().ok()?;
    if parts.next().is_some() {
        return None;
    }
    VerifyingKey::from_bytes(key)
        .ok()?
        .verify_strict(&payload, &Signature::from_bytes(&signature))
        .ok()?;
    let v: Value = serde_json::from_slice(&payload).ok()?;
    if v["exp"].as_u64()? <= now_ms {
        return None;
    }
    let display = v["d"].as_str()?.to_owned();
    let style = if v["r"].as_str()? == "owner" {
        match v["n"]["mode"].as_str() {
            Some("rainbow") => Some(Style::Rainbow),
            Some("color") => v["n"]["color"]
                .as_str()
                .filter(|c| is_color(c))
                .map(|c| Style::Color(c.to_owned())),
            _ => None,
        }
    } else {
        None
    };
    Some(Verified { display, style })
}

/// `#rrggbb` for a fully saturated colour at `hue` degrees, a little lighter than pure so it
/// reads on the chat's dark background.
fn hue_color(hue: f32) -> String {
    let (saturation, lightness) = (1.0f32, 0.62f32);
    let chroma = (1.0 - (2.0 * lightness - 1.0).abs()) * saturation;
    let sector = hue / 60.0;
    let x = chroma * (1.0 - (sector % 2.0 - 1.0).abs());
    let (r, g, b) = match sector as u32 {
        0 => (chroma, x, 0.0),
        1 => (x, chroma, 0.0),
        2 => (0.0, chroma, x),
        3 => (0.0, x, chroma),
        4 => (x, 0.0, chroma),
        _ => (chroma, 0.0, x),
    };
    let m = lightness - chroma / 2.0;
    let byte = |v: f32| ((v + m) * 255.0).round() as u8;
    format!("#{:02x}{:02x}{:02x}", byte(r), byte(g), byte(b))
}

/// The name as a text component in `style`.
pub fn component(name: &str, style: &Style) -> Value {
    match style {
        Style::Rainbow => {
            let letters: Vec<char> = name.chars().collect();
            let count = letters.len().max(1) as f32;
            let extra: Vec<Value> = letters
                .iter()
                .enumerate()
                .map(|(i, c)| json!({ "text": c.to_string(), "color": hue_color(360.0 * i as f32 / count) }))
                .collect();
            json!({ "text": "", "extra": extra })
        }
        Style::Color(color) => json!({ "text": name, "color": color }),
        Style::Red => json!({ "text": name, "color": "red" }),
    }
}

fn remember(uuid: u128, name: &str, style: Style) {
    let mut styles = locked(&STYLES);
    styles.retain(|(u, ..)| *u != uuid);
    styles.push((uuid, name.to_owned(), style));
}

/// A guest's colour is the one its last badge earned: forget it before asking again.
pub fn forget(uuid: u128) {
    locked(&STYLES).retain(|(u, ..)| *u != uuid);
}

/// The key badges are checked with, from the page (none on native, or without one).
pub fn key() -> Option<[u8; 32]> {
    hex_decode(&horizon_os::badge::get().1)?.try_into().ok()
}

/// This player's own badge, as the answer to a world's query (none while logged out).
pub fn answer() -> Option<Vec<u8>> {
    let badge = horizon_os::badge::get().0;
    (!badge.is_empty()).then(|| badge.into_bytes())
}

/// A guest's answer to the badge query: colours its name when the badge is good and was made
/// for the name it joined with.
pub fn admit(uuid: u128, name: &str, data: &[u8], key: &[u8; 32]) {
    forget(uuid);
    let Ok(text) = std::str::from_utf8(data) else {
        return;
    };
    let Some(badge) = verify(text, key, now_ms()) else {
        return;
    };
    if badge.display == name
        && let Some(style) = badge.style
    {
        remember(uuid, name, style);
    }
}

/// The player whose world this is: red once the world is shared, unless their own badge
/// (when they are the site's owner) gives a colour of its own.
pub fn note_host(uuid: u128, name: &str) {
    let own = key().and_then(|key| verify(&horizon_os::badge::get().0, &key, now_ms()));
    let style = own
        .filter(|badge| badge.display == name)
        .and_then(|badge| badge.style)
        .unwrap_or(Style::Red);
    remember(uuid, name, style);
}

/// The coloured name to show for this player, while the world is shared.
pub fn styled(uuid: u128) -> Option<Value> {
    super::identity::world()?;
    let styles = locked(&STYLES);
    let (_, name, style) = styles.iter().find(|(u, ..)| *u == uuid)?;
    Some(component(name, style))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Made with WebCrypto's Ed25519, the way the rooms service signs them.
    const KEY: &str = "8cc51ac853f1a240b79b0ab8ca0b1e8cd6d1d8d3597254e3efb145af8dec476f";
    const OWNER: &str = "v1.7b2276223a312c2275223a225a6562222c2264223a225a6562222c2272223a226f776e6572222c226e223a7b226d6f6465223a227261696e626f77227d2c22657870223a343130323434343830303030307d.640618c1f4948974f332750c5774469cc15d43eaecdf48592737b3b97b643bd427d1e03b79f45af657735efd854cc5f3cebc9b5c86469ce6413e45e58d12cd0c";
    // A plain account that copied the display name "Zeb".
    const COPIER: &str = "v1.7b2276223a312c2275223a22616c696365222c2264223a225a6562222c2272223a2275736572222c226e223a6e756c6c2c22657870223a343130323434343830303030307d.6df18e9c3c56208f7a46a7bc725481c381546a40fd8702a8946192024163424bc64331a47b99a3c0c99e7aeefeea85247296f344afe1c6f0c10e8d17c6f0e508";
    // The owner's badge, long expired (it ran out at 1000 ms).
    const EXPIRED: &str = "v1.7b2276223a312c2275223a225a6562222c2264223a225a6562222c2272223a226f776e6572222c226e223a7b226d6f6465223a227261696e626f77227d2c22657870223a313030307d.4894e3bf39c1011bca535cdca37578253526d83ba7fb1ccf553cf8fc586b16bd6319b6ea779558732e1800324f84278e04b7fa996c99911f76763c5eb214ba0a";

    fn key() -> [u8; 32] {
        hex_decode(KEY).unwrap().try_into().unwrap()
    }

    #[test]
    fn the_owners_badge_gives_a_rainbow() {
        let badge = verify(OWNER, &key(), 1_000_000).unwrap();
        assert_eq!(badge.display, "Zeb");
        assert_eq!(badge.style, Some(Style::Rainbow));
    }

    #[test]
    fn copying_the_name_copies_no_colour() {
        let badge = verify(COPIER, &key(), 1_000_000).unwrap();
        assert_eq!(badge.display, "Zeb");
        assert_eq!(badge.style, None);
    }

    #[test]
    fn a_changed_expired_or_foreign_badge_is_refused() {
        let forged = OWNER.replacen("7b22", "7b23", 1);
        assert_eq!(verify(&forged, &key(), 1_000_000), None);
        assert_eq!(verify(EXPIRED, &key(), 1_000_000), None);
        assert!(verify(EXPIRED, &key(), 999).is_some());
        let mut other = key();
        other[0] ^= 1;
        assert_eq!(verify(OWNER, &other, 1_000_000), None);
        assert_eq!(verify("v2.00.00", &key(), 0), None);
        assert_eq!(verify("garbage", &key(), 0), None);
    }

    #[test]
    fn a_rainbow_name_has_a_colour_per_letter_from_red_on() {
        let c = component("Zeb", &Style::Rainbow);
        let extra = c["extra"].as_array().unwrap();
        let letters: Vec<&str> = extra.iter().map(|e| e["text"].as_str().unwrap()).collect();
        assert_eq!(letters, ["Z", "e", "b"]);
        assert_eq!(extra[0]["color"], "#ff3d3d");
        assert_ne!(extra[0]["color"], extra[1]["color"]);
        assert_ne!(extra[1]["color"], extra[2]["color"]);
    }

    #[test]
    fn the_owner_is_red_and_a_picked_colour_is_kept() {
        assert_eq!(
            component("Host", &Style::Red),
            json!({ "text": "Host", "color": "red" })
        );
        assert_eq!(
            component("Zeb", &Style::Color("#ff8a1f".into())),
            json!({ "text": "Zeb", "color": "#ff8a1f" })
        );
    }
}
