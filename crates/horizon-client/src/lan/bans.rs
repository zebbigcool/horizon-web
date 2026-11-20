//! A shared world's own ban list: who its owner (or the site's owner) banned from it. One line per
//! player in `horizon-bans.txt` in the world folder, `<uuid>\t<name>`. Players are banned by their
//! identity ([`super::identity`]), so changing the name doesn't get a banned player back in; a
//! guest without an identity token (a vanilla client) has the name-based profile, so its name does.
//! The site's owner is never refused (the caller checks [`super::badge::is_site_owner`]).
use horizon_os::fs;
use horizon_protocol::crypto::uuid_string;
use std::path::Path;

const FILE: &str = "horizon-bans.txt";

fn read(world: &Path) -> Vec<(String, String)> {
    fs::read_to_string(world.join(FILE))
        .unwrap_or_default()
        .lines()
        .filter_map(|l| l.split_once('\t'))
        .map(|(u, n)| (u.to_owned(), n.to_owned()))
        .collect()
}

fn write(world: &Path, bans: &[(String, String)]) {
    let text: String = bans.iter().map(|(u, n)| format!("{u}\t{n}\n")).collect();
    if let Err(e) = fs::write(world.join(FILE), text) {
        log::warn!("Horizon: the world's bans are not saved: {e}");
    }
}

/// Bans the player; false when they already were.
pub fn ban(world: &Path, uuid: u128, name: &str) -> bool {
    let id = uuid_string(uuid);
    let mut bans = read(world);
    if bans.iter().any(|(u, _)| *u == id) {
        return false;
    }
    bans.push((id, name.to_owned()));
    write(world, &bans);
    true
}

/// Lifts the ban of the player called `name` (any case); the name it was made under when there was one.
pub fn unban(world: &Path, name: &str) -> Option<String> {
    let mut bans = read(world);
    let at = bans
        .iter()
        .position(|(_, n)| n.eq_ignore_ascii_case(name))?;
    let (_, banned) = bans.remove(at);
    write(world, &bans);
    Some(banned)
}

pub fn is_banned(world: &Path, uuid: u128) -> bool {
    let id = uuid_string(uuid);
    read(world).iter().any(|(u, _)| *u == id)
}

/// The names of the banned players.
pub fn names(world: &Path) -> Vec<String> {
    read(world).into_iter().map(|(_, n)| n).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_ban_holds_until_it_is_lifted() {
        let dir = std::env::temp_dir().join(format!("horizon-bans-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(!is_banned(&dir, 7));
        assert!(ban(&dir, 7, "Mallory"));
        assert!(!ban(&dir, 7, "Mallory2"), "already banned");
        assert!(is_banned(&dir, 7));
        assert!(!is_banned(&dir, 8));
        assert_eq!(names(&dir), ["Mallory"]);
        assert_eq!(unban(&dir, "mallory").as_deref(), Some("Mallory"));
        assert_eq!(unban(&dir, "mallory"), None);
        assert!(!is_banned(&dir, 7));
    }
}
