//! `/kick`, `/ban` and `/unban` in a shared world (one opened to guests; not a dedicated server), for the two
//! kinds of player who may moderate it without being an operator:
//!
//! * the world's owner (the window's own player), in their own world only;
//! * the site's owner (the rooms service account "Zeb", proved by a signed badge: `lan/badge.rs`), in every
//!   shared world.
//!
//! Nobody can kick or ban the site's owner, and nobody but the host can touch the host. Everyone else's
//! commands go on to the usual dispatch (operators keep vanilla's `/kick`). Bans are kept in the world's
//! folder (`lan/bans.rs`) and checked when a guest logs in (`lan/conn.rs`). The commands are typed by hand:
//! they aren't in the command tree, so they don't tab-complete.
use super::{Game, lan::LanHost};
use horizon_client::{
    lan::{badge, bans, data::component_nbt, identity},
    text::Text,
};
use horizon_protocol::crypto::offline_uuid;
use horizon_protocol::packets::play::{self, Clientbound as C};

pub(super) const WORLD_MOD_COMMANDS: [&str; 3] = ["kick", "ban", "unban"];

#[derive(Debug, PartialEq, Eq)]
enum Request<'a> {
    Kick(&'a str, Option<String>),
    Ban(&'a str, Option<String>),
    Unban(&'a str),
}

/// The words of a command (the command first) as a request, or the line to answer with when they are wrong.
fn parse<'a>(words: &[&'a str]) -> Result<Request<'a>, &'static str> {
    let words: Vec<&str> = words.iter().copied().filter(|w| !w.is_empty()).collect();
    let (Some(&command), Some(&name)) = (words.first(), words.get(1)) else {
        return Err("Usage: /kick <player> [reason], /ban <player> [reason], /unban <player>");
    };
    let reason = (words.len() > 2).then(|| words[2..].join(" "));
    match command {
        "kick" => Ok(Request::Kick(name, reason)),
        "ban" => Ok(Request::Ban(name, reason)),
        "unban" => Ok(Request::Unban(name)),
        _ => Err("Unknown command"),
    }
}

impl Game<'_> {
    /// A guest's `/kick`, `/ban` or `/unban` when the guest may moderate this world: true when it was
    /// handled here, false for the usual dispatch.
    pub(super) fn guest_world_mod_command(
        &mut self,
        host: &mut LanHost,
        conn: u32,
        words: &[&str],
    ) -> bool {
        if self.server_lists.is_some() {
            return false;
        }
        let Some(world) = identity::world() else {
            return false;
        };
        let Some((sender, sender_name)) = host.hub.guest(conn).map(|g| (g.uuid, g.name.clone()))
        else {
            return false;
        };
        let is_host = host.hub.singleplayer_owner == Some(sender);
        if !is_host && !badge::is_site_owner(sender) {
            return false;
        }
        let line = match parse(words) {
            Err(line) => line.to_owned(),
            Ok(Request::Unban(name)) => match bans::unban(&world, name) {
                Some(was) => format!("Unbanned {was}."),
                None => format!("{name} is not banned."),
            },
            Ok(Request::Kick(name, reason)) => {
                self.moderate(host, &world, sender, &sender_name, name, reason, false)
            }
            Ok(Request::Ban(name, reason)) => {
                self.moderate(host, &world, sender, &sender_name, name, reason, true)
            }
        };
        host.hub.send_to(
            conn,
            &C::SystemChat(play::SystemChat {
                content: component_nbt(&Text::literal(line).component()),
                overlay: false,
            }),
        );
        true
    }

    /// Kicks (and, with `ban`, bans) the player called `name`; what to answer.
    #[allow(clippy::too_many_arguments)]
    fn moderate(
        &mut self,
        host: &mut LanHost,
        world: &std::path::Path,
        sender: u128,
        sender_name: &str,
        name: &str,
        reason: Option<String>,
        ban: bool,
    ) -> String {
        let online = host
            .hub
            .guests
            .iter()
            .find(|g| g.name.eq_ignore_ascii_case(name))
            .map(|g| (g.conn, g.uuid, g.name.clone()));
        // Someone who isn't here is banned by the name-based profile (all a name proves).
        let (conn, uuid, name) = match online {
            Some(found) => found,
            None if ban => (u32::MAX, offline_uuid(name), name.to_owned()),
            None => return "No player was found.".to_owned(),
        };
        if badge::is_site_owner(uuid) {
            return format!("{name} can't be kicked or banned from a shared world.");
        }
        if host.hub.singleplayer_owner == Some(uuid) {
            return format!("{name} owns this world.");
        }
        if uuid == sender {
            return "You can't do that to yourself.".to_owned();
        }
        let why = reason.map(|r| format!(": {r}")).unwrap_or_default();
        if ban && !bans::ban(world, uuid, &name) {
            return format!("{name} is already banned.");
        }
        if conn != u32::MAX {
            let verb = if ban { "banned from" } else { "kicked from" };
            let message = format!("You were {verb} this world by {sender_name}{why}");
            let tag = horizon_world::nbt::Tag::compound([(
                "text",
                horizon_world::nbt::Tag::String(message.as_str().into()),
            )]);
            host.hub.kick(conn, tag);
        }
        let done = if ban { "Banned" } else { "Kicked" };
        format!("{done} {name}{why}.")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_words_become_a_request_with_the_rest_as_the_reason() {
        assert_eq!(
            parse(&["ban", "Mallory", "no", "griefing"]),
            Ok(Request::Ban("Mallory", Some("no griefing".into())))
        );
        assert_eq!(
            parse(&["kick", "Mallory"]),
            Ok(Request::Kick("Mallory", None))
        );
        assert_eq!(parse(&["unban", "Mallory"]), Ok(Request::Unban("Mallory")));
        assert!(parse(&["ban"]).is_err());
    }
}
