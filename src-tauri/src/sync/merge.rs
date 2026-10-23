//! Three-way merge of the local vault, the remote state and the **base** (what both sides agreed on
//! after the last successful sync). Pure: no I/O, so every rule is unit-tested here.
//!
//! Per record key:
//! - only one side changed since the base → that side wins;
//! - both changed to the same content → nothing to do;
//! - both changed differently → last writer wins by modification time, device id breaking a tie;
//! - one side deleted and the other edited → **the edit wins** (a password manager must not lose a
//!   change because a stale device purged the item; the item comes back, trashed or not, as edited).
//!
//! Deletions travel as tombstones (`record: None`) and stay in the remote state.
//!
//! A local modification time is the record's own `updated_at` when that moved past the base;
//! otherwise (a change that does not bump `updated_at`, such as a tag restyle or a relation link) it
//! is the time this sync noticed it.

use super::records::Record;
use chrono::DateTime;
use serde::{Deserialize, Serialize};
use std::cmp::Ordering;
use std::collections::{BTreeMap, BTreeSet};

pub const STATE_FORMAT: u32 = 1;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct RemoteEntry {
    pub modified: String,
    pub device: String,
    /// `None` is a tombstone.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub record: Option<Record>,
}

/// The decrypted body of `vault.enc`.
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq, Eq)]
pub struct RemoteState {
    pub format: u32,
    #[serde(default)]
    pub entries: BTreeMap<String, RemoteEntry>,
}

impl Default for RemoteState {
    fn default() -> Self {
        RemoteState { format: STATE_FORMAT, entries: BTreeMap::new() }
    }
}

impl RemoteState {
    /// Attachment ids the state references (their blobs must exist on the remote).
    pub fn attachment_ids(&self) -> BTreeSet<String> {
        let mut ids = BTreeSet::new();
        for entry in self.entries.values() {
            if let Some(Record::Item(item)) = &entry.record {
                ids.extend(item.attachments.iter().map(|a| a.id.clone()));
            }
        }
        ids
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LocalRecord {
    pub record: Record,
    pub hash: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct BaseEntry {
    pub hash: String,
    pub modified: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub enum LocalOp {
    Upsert(String, Record),
    Delete(String),
}

impl LocalOp {
    pub fn key(&self) -> &str {
        match self {
            LocalOp::Upsert(key, _) | LocalOp::Delete(key) => key,
        }
    }
}

#[derive(Debug)]
pub struct MergeOutcome {
    pub remote: RemoteState,
    /// The remote state must be written back.
    pub remote_dirty: bool,
    /// Changes to make to the local vault, in apply order (vaults, tags, items; deletes reversed).
    pub local_ops: Vec<LocalOp>,
    /// The base after this sync, for every key that still exists (tombstoned keys drop out).
    pub base: BTreeMap<String, BaseEntry>,
    pub pushed: usize,
}

fn compare_stamps(a: &str, b: &str) -> Ordering {
    match (DateTime::parse_from_rfc3339(a), DateTime::parse_from_rfc3339(b)) {
        (Ok(a), Ok(b)) => a.cmp(&b),
        _ => a.cmp(b),
    }
}

fn local_stamp(record: &Record, base: Option<&BaseEntry>, now: &str) -> String {
    let updated = record.updated_at();
    let moved = DateTime::parse_from_rfc3339(updated).is_ok()
        && base.map_or(true, |b| compare_stamps(updated, &b.modified) == Ordering::Greater);
    if moved {
        updated.to_string()
    } else {
        now.to_string()
    }
}

pub fn merge(
    local: &BTreeMap<String, LocalRecord>,
    base: &BTreeMap<String, BaseEntry>,
    remote: &RemoteState,
    device: &str,
    now: &str,
    hash: impl Fn(&Record) -> String,
) -> MergeOutcome {
    let mut out_remote = remote.clone();
    out_remote.format = STATE_FORMAT;
    let mut out_base = BTreeMap::new();
    let mut upserts = Vec::new();
    let mut deletes = Vec::new();
    let mut remote_dirty = false;
    let mut pushed = 0;

    let keys: BTreeSet<&String> = local.keys().chain(remote.entries.keys()).collect();
    for key in keys {
        let l = local.get(key);
        let b = base.get(key);
        let r = remote.entries.get(key);
        let r_record = r.and_then(|entry| entry.record.as_ref());
        let lh = l.map(|l| l.hash.clone());
        let rh = r_record.map(&hash);
        let bh = b.map(|b| b.hash.clone());

        if lh == rh {
            // In agreement (both live and equal, or both gone).
            if let Some(l) = l {
                match r {
                    Some(entry) => {
                        out_base.insert(
                            key.clone(),
                            BaseEntry { hash: l.hash.clone(), modified: entry.modified.clone() },
                        );
                    }
                    None => unreachable!("lh == rh with a local record means a remote record"),
                }
            }
            continue;
        }

        let local_changed = lh != bh;
        let remote_changed = rh != bh;
        let local_wins = if !remote_changed {
            true
        } else if !local_changed {
            false
        } else {
            match (l, r_record) {
                (Some(l), Some(_)) => {
                    let ls = local_stamp(&l.record, b, now);
                    let entry = r.expect("remote record has an entry");
                    match compare_stamps(&ls, &entry.modified) {
                        Ordering::Greater => true,
                        Ordering::Less => false,
                        Ordering::Equal => device > entry.device.as_str(),
                    }
                }
                // Edit beats delete, whichever side deleted.
                (Some(_), None) => true,
                (None, Some(_)) => false,
                (None, None) => unreachable!("lh == rh handled above"),
            }
        };

        if local_wins {
            remote_dirty = true;
            pushed += 1;
            match l {
                Some(l) => {
                    let stamp = local_stamp(&l.record, b, now);
                    out_remote.entries.insert(
                        key.clone(),
                        RemoteEntry {
                            modified: stamp.clone(),
                            device: device.to_string(),
                            record: Some(l.record.clone()),
                        },
                    );
                    out_base.insert(key.clone(), BaseEntry { hash: l.hash.clone(), modified: stamp });
                }
                None => {
                    out_remote.entries.insert(
                        key.clone(),
                        RemoteEntry { modified: now.to_string(), device: device.to_string(), record: None },
                    );
                }
            }
        } else {
            let entry = r.expect("remote wins only when it has an entry");
            match &entry.record {
                Some(record) => {
                    upserts.push(LocalOp::Upsert(key.clone(), record.clone()));
                    out_base.insert(
                        key.clone(),
                        BaseEntry { hash: rh.clone().unwrap_or_default(), modified: entry.modified.clone() },
                    );
                }
                None => {
                    if l.is_some() {
                        deletes.push(LocalOp::Delete(key.clone()));
                    }
                }
            }
        }
    }

    upserts.sort_by_key(|op| match op {
        LocalOp::Upsert(_, record) => record.rank(),
        LocalOp::Delete(_) => 0,
    });
    deletes.sort_by_key(|op| std::cmp::Reverse(super::records::key_rank(op.key())));
    let mut local_ops = upserts;
    local_ops.extend(deletes);

    MergeOutcome { remote: out_remote, remote_dirty, local_ops, base: out_base, pushed }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sync::records::{ItemRecord, TagRecord, VaultRecord};

    fn item(id: &str, title: &str, updated: &str) -> Record {
        Record::Item(ItemRecord {
            id: id.into(),
            vault_id: "personal".into(),
            item_type: "login".into(),
            title: title.into(),
            favorite: false,
            archived: false,
            archived_by_vault: false,
            trashed: false,
            deleted_at: None,
            created_at: "2026-10-01T00:00:00Z".into(),
            updated_at: updated.into(),
            relations: None,
            icon_mode: "auto".into(),
            fields: vec![],
            urls: vec![],
            tags: vec![],
            attachments: vec![],
        })
    }

    fn h(record: &Record) -> String {
        serde_json::to_string(record).unwrap()
    }

    fn local(records: &[Record]) -> BTreeMap<String, LocalRecord> {
        records
            .iter()
            .map(|r| (r.key(), LocalRecord { record: r.clone(), hash: h(r) }))
            .collect()
    }

    fn remote(entries: &[(&str, &str, Option<Record>)]) -> RemoteState {
        let mut state = RemoteState::default();
        for (modified, device, record) in entries {
            let key = record.as_ref().map(|r| r.key()).unwrap_or_else(|| "item:gone".into());
            state.entries.insert(
                key,
                RemoteEntry { modified: (*modified).into(), device: (*device).into(), record: record.clone() },
            );
        }
        state
    }

    fn base_of(records: &[(&Record, &str)]) -> BTreeMap<String, BaseEntry> {
        records
            .iter()
            .map(|(r, m)| (r.key(), BaseEntry { hash: h(r), modified: (*m).into() }))
            .collect()
    }

    const NOW: &str = "2026-10-23T12:00:00Z";

    #[test]
    fn first_sync_pushes_local_and_pulls_remote() {
        let mine = item("a", "Mine", "2026-10-02T00:00:00Z");
        let theirs = item("b", "Theirs", "2026-10-03T00:00:00Z");
        let out = merge(
            &local(&[mine.clone()]),
            &BTreeMap::new(),
            &remote(&[("2026-10-03T00:00:00Z", "B", Some(theirs.clone()))]),
            "A",
            NOW,
            h,
        );
        assert!(out.remote_dirty);
        assert_eq!(out.remote.entries["item:a"].record, Some(mine));
        assert_eq!(out.local_ops, vec![LocalOp::Upsert("item:b".into(), theirs)]);
        assert_eq!(out.base.len(), 2);
    }

    #[test]
    fn unchanged_on_both_sides_does_nothing() {
        let x = item("a", "Same", "2026-10-02T00:00:00Z");
        let out = merge(
            &local(&[x.clone()]),
            &base_of(&[(&x, "2026-10-02T00:00:00Z")]),
            &remote(&[("2026-10-02T00:00:00Z", "B", Some(x.clone()))]),
            "A",
            NOW,
            h,
        );
        assert!(!out.remote_dirty);
        assert!(out.local_ops.is_empty());
        assert_eq!(out.base["item:a"].hash, h(&x));
    }

    #[test]
    fn only_remote_changed_takes_remote() {
        let old = item("a", "Old", "2026-10-02T00:00:00Z");
        let new = item("a", "New", "2026-10-05T00:00:00Z");
        let out = merge(
            &local(&[old.clone()]),
            &base_of(&[(&old, "2026-10-02T00:00:00Z")]),
            &remote(&[("2026-10-05T00:00:00Z", "B", Some(new.clone()))]),
            "A",
            NOW,
            h,
        );
        assert!(!out.remote_dirty);
        assert_eq!(out.local_ops, vec![LocalOp::Upsert("item:a".into(), new)]);
    }

    #[test]
    fn only_local_changed_pushes_even_if_its_clock_is_behind() {
        let old = item("a", "Old", "2026-10-02T00:00:00Z");
        // Local edit stamped earlier than the remote entry's time (skewed clock): still pushed,
        // because only this side changed since the base.
        let new = item("a", "New", "2026-10-01T00:00:00Z");
        let out = merge(
            &local(&[new.clone()]),
            &base_of(&[(&old, "2026-10-04T00:00:00Z")]),
            &remote(&[("2026-10-04T00:00:00Z", "B", Some(old.clone()))]),
            "A",
            NOW,
            h,
        );
        assert!(out.remote_dirty);
        assert!(out.local_ops.is_empty());
        let entry = &out.remote.entries["item:a"];
        assert_eq!(entry.record, Some(new));
        // updated_at did not move past the base, so the change is stamped with "now".
        assert_eq!(entry.modified, NOW);
    }

    #[test]
    fn concurrent_edits_last_writer_wins() {
        let base = item("a", "Base", "2026-10-02T00:00:00Z");
        let mine = item("a", "Mine", "2026-10-06T00:00:00Z");
        let theirs = item("a", "Theirs", "2026-10-05T00:00:00Z");
        let out = merge(
            &local(&[mine.clone()]),
            &base_of(&[(&base, "2026-10-02T00:00:00Z")]),
            &remote(&[("2026-10-05T00:00:00Z", "B", Some(theirs.clone()))]),
            "A",
            NOW,
            h,
        );
        assert_eq!(out.remote.entries["item:a"].record, Some(mine.clone()));
        assert!(out.local_ops.is_empty());

        // Mirror: the remote is newer.
        let theirs = item("a", "Theirs", "2026-10-07T00:00:00Z");
        let out = merge(
            &local(&[mine]),
            &base_of(&[(&base, "2026-10-02T00:00:00Z")]),
            &remote(&[("2026-10-07T00:00:00Z", "B", Some(theirs.clone()))]),
            "A",
            NOW,
            h,
        );
        assert!(!out.remote_dirty);
        assert_eq!(out.local_ops, vec![LocalOp::Upsert("item:a".into(), theirs)]);
    }

    #[test]
    fn equal_stamps_break_the_tie_by_device_id_the_same_way_on_both_sides() {
        let base = item("a", "Base", "2026-10-02T00:00:00Z");
        let from_a = item("a", "From A", "2026-10-06T00:00:00Z");
        let from_b = item("a", "From B", "2026-10-06T00:00:00Z");
        let b = base_of(&[(&base, "2026-10-02T00:00:00Z")]);
        let on_a = merge(
            &local(&[from_a.clone()]),
            &b,
            &remote(&[("2026-10-06T00:00:00Z", "B", Some(from_b.clone()))]),
            "A",
            NOW,
            h,
        );
        let on_b = merge(
            &local(&[from_b.clone()]),
            &b,
            &remote(&[("2026-10-06T00:00:00Z", "A", Some(from_a.clone()))]),
            "B",
            NOW,
            h,
        );
        // "B" > "A": B's version wins on both devices.
        assert_eq!(on_a.local_ops, vec![LocalOp::Upsert("item:a".into(), from_b.clone())]);
        assert_eq!(on_b.remote.entries["item:a"].record, Some(from_b));
    }

    #[test]
    fn local_purge_becomes_a_tombstone_and_remote_tombstone_deletes_locally() {
        let x = item("a", "X", "2026-10-02T00:00:00Z");
        let b = base_of(&[(&x, "2026-10-02T00:00:00Z")]);
        let out = merge(
            &BTreeMap::new(),
            &b,
            &remote(&[("2026-10-02T00:00:00Z", "B", Some(x.clone()))]),
            "A",
            NOW,
            h,
        );
        assert!(out.remote_dirty);
        assert_eq!(out.remote.entries["item:a"].record, None);
        assert!(out.base.is_empty());

        let mut tomb = RemoteState::default();
        tomb.entries.insert(
            "item:a".into(),
            RemoteEntry { modified: NOW.into(), device: "B".into(), record: None },
        );
        let out = merge(&local(&[x]), &b, &tomb, "A", NOW, h);
        assert_eq!(out.local_ops, vec![LocalOp::Delete("item:a".into())]);
        assert!(!out.remote_dirty);
    }

    #[test]
    fn an_edit_beats_a_concurrent_delete_on_either_side() {
        let x = item("a", "X", "2026-10-02T00:00:00Z");
        let edited = item("a", "Edited", "2026-10-03T00:00:00Z");
        let b = base_of(&[(&x, "2026-10-02T00:00:00Z")]);
        let mut tomb = RemoteState::default();
        tomb.entries.insert(
            "item:a".into(),
            RemoteEntry { modified: "2026-10-20T00:00:00Z".into(), device: "B".into(), record: None },
        );
        let out = merge(&local(&[edited.clone()]), &b, &tomb, "A", NOW, h);
        assert_eq!(out.remote.entries["item:a"].record, Some(edited.clone()));

        let out = merge(
            &BTreeMap::new(),
            &b,
            &remote(&[("2026-10-03T00:00:00Z", "B", Some(edited.clone()))]),
            "A",
            NOW,
            h,
        );
        assert_eq!(out.local_ops, vec![LocalOp::Upsert("item:a".into(), edited)]);
        assert!(!out.remote_dirty);
    }

    #[test]
    fn ops_apply_vaults_then_tags_then_items_and_delete_in_reverse() {
        let vault = Record::Vault(VaultRecord {
            id: "work".into(),
            name: "Work".into(),
            icon: "vault".into(),
            color: String::new(),
            archived: false,
            created_at: "2026-10-01T00:00:00Z".into(),
            updated_at: "2026-10-01T00:00:00Z".into(),
        });
        let tag = Record::Tag(TagRecord {
            vault_id: "work".into(),
            name: "Bank".into(),
            icon: "tag".into(),
            color: String::new(),
            created_at: "2026-10-01T00:00:00Z".into(),
            updated_at: "2026-10-01T00:00:00Z".into(),
        });
        let x = item("a", "X", "2026-10-02T00:00:00Z");
        let state = remote(&[
            ("2026-10-02T00:00:00Z", "B", Some(x.clone())),
            ("2026-10-01T00:00:00Z", "B", Some(tag.clone())),
            ("2026-10-01T00:00:00Z", "B", Some(vault.clone())),
        ]);
        let out = merge(&BTreeMap::new(), &BTreeMap::new(), &state, "A", NOW, h);
        let keys: Vec<_> = out.local_ops.iter().map(|op| op.key().to_string()).collect();
        assert_eq!(keys, vec!["vault:work", "tag:work:bank", "item:a"]);

        let mut tombs = RemoteState::default();
        for key in ["vault:work", "tag:work:bank", "item:a"] {
            tombs.entries.insert(key.into(), RemoteEntry { modified: NOW.into(), device: "B".into(), record: None });
        }
        let base = base_of(&[(&vault, "x"), (&tag, "x"), (&x, "x")]);
        let out = merge(&local(&[vault, tag, x]), &base, &tombs, "A", NOW, h);
        let keys: Vec<_> = out.local_ops.iter().map(|op| op.key().to_string()).collect();
        assert_eq!(keys, vec!["item:a", "tag:work:bank", "vault:work"]);
    }

    #[test]
    fn merging_twice_converges() {
        let base = item("a", "Base", "2026-10-02T00:00:00Z");
        let mine = item("a", "Mine", "2026-10-06T00:00:00Z");
        let new_local = item("c", "New", "2026-10-06T00:00:00Z");
        let theirs = item("b", "Theirs", "2026-10-05T00:00:00Z");
        let first = merge(
            &local(&[mine.clone(), new_local.clone()]),
            &base_of(&[(&base, "2026-10-02T00:00:00Z")]),
            &remote(&[
                ("2026-10-02T00:00:00Z", "B", Some(base.clone())),
                ("2026-10-05T00:00:00Z", "B", Some(theirs.clone())),
            ]),
            "A",
            NOW,
            h,
        );
        // Device A applies the pull, then syncs again against what it wrote.
        let after = local(&[mine, new_local, theirs]);
        let second = merge(&after, &first.base, &first.remote, "A", NOW, h);
        assert!(!second.remote_dirty);
        assert!(second.local_ops.is_empty());
    }
}
