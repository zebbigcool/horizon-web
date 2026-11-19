//! Who a guest is, for a world that remembers its players (a LAN or shared
//! world). An offline login proves nothing: the profile is made from the name
//! (`offline_uuid`), so a player who joins under another name gets a new
//! player file, and anyone typing the first name gets the first file.
//!
//! A Horizon client keeps a random secret in `horizon-identity.key` in its game
//! folder. The host sends a login query (`horizon:identity`) with a salt kept in
//! the world folder; the client answers with `SHA-256(secret + salt)`, a token
//! only the holder of the secret can make, and no other world can reuse. The
//! host names the player after the token, so:
//!
//! * the same player under another name gets the same player file;
//! * a name belongs to the first identity that joined under it (and is freed
//!   when that identity joins under another name), so copying a name gets
//!   nothing: whoever doesn't hold that token is refused the name.
//!
//! A first claim of a name adopts the player file the old name-based login
//! saved under it. A client that doesn't answer (a vanilla one) still joins
//! under a free name, as before. The salt is sent to every guest, so a malicious
//! world could ask for another world's salt: the token it gets opens the
//! player's file in that world only.
use super::playerdata;
use crate::save::{put, read_dat, uuid_tag, write_dat};
use horizon_os::fs::{self, PathExt};
use horizon_protocol::crypto::{offline_uuid, random_bytes, uuid_string};
use sha2::{Digest, Sha256};
use std::{
    collections::BTreeMap,
    path::{Path, PathBuf},
    sync::Mutex,
};

pub const CHANNEL: &str = "horizon:identity";
const SECRET_FILE: &str = "horizon-identity.key";
const SALT_FILE: &str = "horizon-identity-salt";
const CLAIMS_FILE: &str = "horizon-identities.txt";
const SALT_LEN: usize = 16;
const SECRET_LEN: usize = 32;
const TOKEN_LEN: usize = 32;

/// The world folder guests are admitted to; set when the world is opened to guests.
static WORLD: Mutex<Option<PathBuf>> = Mutex::new(None);
/// One reader or writer of the claims file at a time.
static FILES: Mutex<()> = Mutex::new(());

fn locked<T>(m: &Mutex<T>) -> std::sync::MutexGuard<'_, T> {
    horizon_os::sync::lock(m).unwrap_or_else(|e| e.into_inner())
}

pub fn set_world(dir: PathBuf) {
    *locked(&WORLD) = Some(dir);
}

pub fn world() -> Option<PathBuf> {
    locked(&WORLD).clone()
}

/// `len` random bytes kept in `path`, made on first use.
fn kept_random(path: &Path, len: usize) -> Option<Vec<u8>> {
    if let Ok(bytes) = fs::read(path)
        && bytes.len() == len
    {
        return Some(bytes);
    }
    let mut bytes = vec![0u8; len];
    random_bytes(&mut bytes).ok()?;
    fs::write(path, &bytes).ok()?;
    Some(bytes)
}

/// The login query's data: this world's salt (none when the world's folder can't keep one).
pub fn request(world: &Path) -> Option<Vec<u8>> {
    kept_random(&world.join(SALT_FILE), SALT_LEN)
}

/// `SHA-256("horizon-identity-v1" + secret + salt)`.
pub fn token(secret: &[u8], salt: &[u8]) -> Vec<u8> {
    let mut h = Sha256::new();
    h.update(b"horizon-identity-v1");
    h.update(secret);
    h.update(salt);
    h.finalize().to_vec()
}

/// The client's answer to the query: its token for the world that sent `salt`.
pub fn answer(salt: &[u8]) -> Option<Vec<u8>> {
    if salt.len() != SALT_LEN {
        return None;
    }
    let dir = horizon_os::env::current_dir().ok()?;
    let secret = kept_random(&dir.join(SECRET_FILE), SECRET_LEN)?;
    Some(token(&secret, salt))
}

/// The player's UUID, made from the token (a version 4 UUID's bits).
pub fn uuid_of(token: &[u8]) -> u128 {
    let mut h = Sha256::new();
    h.update(b"horizon-identity-uuid-v1");
    h.update(token);
    let digest = h.finalize();
    let mut bytes = [0u8; 16];
    bytes.copy_from_slice(&digest[..16]);
    bytes[6] = (bytes[6] & 0x0f) | 0x40;
    bytes[8] = (bytes[8] & 0x3f) | 0x80;
    u128::from_be_bytes(bytes)
}

#[derive(Debug, PartialEq, Eq)]
pub enum Admission {
    Player(u128),
    /// The name belongs to another player.
    NameTaken,
}

fn read_claims(path: &Path) -> BTreeMap<String, String> {
    fs::read_to_string(path)
        .unwrap_or_default()
        .lines()
        .filter_map(|line| line.split_once('\t'))
        .map(|(name, uuid)| (name.to_owned(), uuid.to_owned()))
        .collect()
}

fn write_claims(path: &Path, claims: &BTreeMap<String, String>) {
    let text: String = claims
        .iter()
        .map(|(name, uuid)| format!("{name}\t{uuid}\n"))
        .collect();
    if let Err(e) = fs::write(path, text) {
        log::warn!("Horizon: the players' names are not saved: {e}");
    }
}

/// The first claim of a name adopts what the name-based login saved under it.
fn adopt_legacy(world: &Path, name: &str, uuid: u128) {
    let new_file = playerdata::path(world, uuid);
    if new_file.fs_is_file() {
        return;
    }
    let old_file = playerdata::path(world, offline_uuid(name));
    let Some(mut tag) = read_dat(&old_file) else {
        return;
    };
    put(&mut tag, "UUID", uuid_tag(playerdata::uuid_ints(uuid)));
    if write_dat(&new_file, tag).is_ok() {
        // Kept beside it, as a migration keeps the offline files, so nothing is lost.
        let _ = fs::rename(&old_file, old_file.with_extension("dat_claimed"));
    }
}

/// Who joins as `name`, given the token the client answered with (none from a client that didn't).
pub fn admit(world: &Path, name: &str, token: Option<&[u8]>) -> Admission {
    let _files = locked(&FILES);
    let path = world.join(CLAIMS_FILE);
    let mut claims = read_claims(&path);
    let key = name.to_ascii_lowercase();
    match token.filter(|t| t.len() == TOKEN_LEN) {
        None => {
            if claims.contains_key(&key) {
                return Admission::NameTaken;
            }
            Admission::Player(offline_uuid(name))
        }
        Some(token) => {
            let uuid = uuid_of(token);
            let id = uuid_string(uuid);
            match claims.get(&key) {
                Some(owner) if *owner != id => return Admission::NameTaken,
                Some(_) => {}
                None => adopt_legacy(world, name, uuid),
            }
            // One name per player: the one they leave is free again.
            claims.retain(|n, u| *u != id || *n == key);
            claims.insert(key, id);
            write_claims(&path, &claims);
            Admission::Player(uuid)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn folder(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!("horizon-identity-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn a_player_keeps_their_file_under_another_name_and_a_copied_name_is_refused() {
        let dir = folder("names");
        let salt = [7u8; SALT_LEN];
        let alice = token(&[1u8; SECRET_LEN], &salt);
        let mallory = token(&[2u8; SECRET_LEN], &salt);

        let Admission::Player(first) = admit(&dir, "Alice", Some(&alice)) else {
            panic!("Alice is admitted");
        };
        // Another name, the same token: the same player.
        assert_eq!(admit(&dir, "Alice2", Some(&alice)), Admission::Player(first));
        // The name Alice left is free; the one she holds is not.
        assert!(matches!(admit(&dir, "Alice", Some(&mallory)), Admission::Player(_)));
        assert_eq!(admit(&dir, "alice2", Some(&mallory)), Admission::NameTaken);
        // Nobody without a token takes a claimed name, whatever its case.
        assert_eq!(admit(&dir, "ALICE2", None), Admission::NameTaken);
        // A free name still joins without one, as an offline player.
        assert_eq!(admit(&dir, "Guest", None), Admission::Player(offline_uuid("Guest")));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn a_token_belongs_to_one_world() {
        let secret = [9u8; SECRET_LEN];
        assert_ne!(token(&secret, &[1u8; SALT_LEN]), token(&secret, &[2u8; SALT_LEN]));
    }
}
