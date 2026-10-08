use crate::vault::{ItemUrl, LoginItemInput};
use serde_json::Value;
use std::fs::File;
use std::io::Read;
use std::path::Path;
use thiserror::Error;
use zip::ZipArchive;

#[derive(Debug, Error)]
pub enum Import1PuxError {
    #[error("file error: {0}")]
    Io(#[from] std::io::Error),
    #[error("zip error: {0}")]
    Zip(#[from] zip::result::ZipError),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    #[error("no importable 1pux data found")]
    NoData,
}

#[derive(Clone, Debug)]
pub struct ImportPreview {
    pub login_items: Vec<LoginItemInput>,
    pub total_items: usize,
    pub unknown_items: usize,
}

pub fn preview_1pux_file(path: &Path) -> Result<ImportPreview, Import1PuxError> {
    let file = File::open(path)?;
    let mut archive = ZipArchive::new(file)?;
    let mut json_values = Vec::new();

    for index in 0..archive.len() {
        let mut entry = archive.by_index(index)?;
        if !entry.name().ends_with(".json") && !entry.name().ends_with(".data") {
            continue;
        }
        let mut contents = String::new();
        entry.read_to_string(&mut contents)?;
        if let Ok(value) = serde_json::from_str::<Value>(&contents) {
            json_values.push(value);
        }
    }

    let mut login_items = Vec::new();
    let mut total_items = 0;
    let mut unknown_items = 0;
    for value in json_values {
        for item in collect_items(&value) {
            total_items += 1;
            if let Some(login) = parse_login_item(item) {
                login_items.push(login);
            } else {
                unknown_items += 1;
            }
        }
    }

    if total_items == 0 {
        return Err(Import1PuxError::NoData);
    }

    Ok(ImportPreview {
        login_items,
        total_items,
        unknown_items,
    })
}

fn collect_items(value: &Value) -> Vec<&Value> {
    if let Some(items) = value.get("items").and_then(Value::as_array) {
        return items.iter().collect();
    }

    let mut collected = Vec::new();
    if let Some(accounts) = value.get("accounts").and_then(Value::as_array) {
        for account in accounts {
            if let Some(vaults) = account.get("vaults").and_then(Value::as_array) {
                for vault in vaults {
                    if let Some(items) = vault.get("items").and_then(Value::as_array) {
                        collected.extend(items.iter());
                    }
                }
            }
        }
    }
    collected
}

fn parse_login_item(item: &Value) -> Option<LoginItemInput> {
    let category = item
        .get("categoryUuid")
        .or_else(|| item.get("category"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_lowercase();
    if !category.is_empty() && !category.contains("login") && !category.contains("001") {
        return None;
    }

    let title = item
        .get("title")
        .and_then(Value::as_str)
        .unwrap_or("Imported Login")
        .to_string();
    let mut username = String::new();
    let mut password = String::new();
    let mut notes = item
        .get("notesPlain")
        .or_else(|| item.get("notes"))
        .and_then(Value::as_str)
        .unwrap_or_default()
        .to_string();
    let mut tags = Vec::new();

    if let Some(item_tags) = item.get("tags").and_then(Value::as_array) {
        tags = item_tags
            .iter()
            .filter_map(Value::as_str)
            .map(str::to_string)
            .collect();
    }

    if let Some(fields) = item.get("fields").and_then(Value::as_array) {
        for field in fields {
            let label = field
                .get("label")
                .or_else(|| field.get("name"))
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_lowercase();
            let designation = field
                .get("designation")
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_lowercase();
            let value = field_value(field);

            if designation == "username" || label == "username" || label == "email" {
                username = value;
            } else if designation == "password" || label == "password" {
                password = value;
            } else if !value.is_empty() {
                if !notes.is_empty() {
                    notes.push('\n');
                }
                notes.push_str(&format!("{label}: {value}"));
            }
        }
    }

    let urls = item
        .get("urls")
        .and_then(Value::as_array)
        .map(|urls| {
            urls.iter()
                .filter_map(|url| {
                    let address = url
                        .get("url")
                        .or_else(|| url.get("href"))
                        .and_then(Value::as_str)
                        .unwrap_or_default()
                        .trim();
                    if address.is_empty() {
                        return None;
                    }
                    let label = url
                        .get("label")
                        .or_else(|| url.get("name"))
                        .and_then(Value::as_str)
                        .unwrap_or("website")
                        .trim();
                    Some(ItemUrl {
                        label: if label.is_empty() { "website" } else { label }.to_string(),
                        url: address.to_string(),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let fallback_website = item
        .get("url")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let urls = if urls.is_empty() && !fallback_website.is_empty() {
        vec![ItemUrl {
            label: "website".to_string(),
            url: fallback_website.to_string(),
        }]
    } else {
        urls
    };
    let website = urls
        .first()
        .map(|item_url| item_url.url.clone())
        .unwrap_or_default();

    Some(LoginItemInput {
        item_type: "login".to_string(),
        title,
        username,
        password,
        website,
        urls,
        notes,
        tags,
        custom_fields: vec![],
        favorite: false,
    })
}

fn field_value(field: &Value) -> String {
    if let Some(value) = field.get("value").and_then(Value::as_str) {
        return value.to_string();
    }
    if let Some(value) = field
        .get("value")
        .and_then(|value| value.get("string"))
        .and_then(Value::as_str)
    {
        return value.to_string();
    }
    String::new()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    use zip::write::SimpleFileOptions;

    #[test]
    fn preview_1pux_file_extracts_login_items() {
        let path =
            std::env::temp_dir().join(format!("passless-import-{}.1pux", uuid::Uuid::new_v4()));
        let file = File::create(&path).expect("fixture should create");
        let mut zip = zip::ZipWriter::new(file);
        zip.start_file("export.data", SimpleFileOptions::default())
            .expect("entry should start");
        zip.write_all(
            br#"{
              "accounts": [{
                "vaults": [{
                  "items": [{
                    "title": "GitHub",
                    "categoryUuid": "001",
                    "urls": [{"url": "https://github.com"}],
                    "tags": ["code"],
                    "fields": [
                      {"designation": "username", "value": "octo@example.com"},
                      {"designation": "password", "value": "secret"}
                    ]
                  }]
                }]
              }]
            }"#,
        )
        .expect("fixture should write");
        zip.finish().expect("zip should finish");

        let preview = preview_1pux_file(&path).expect("preview should parse");

        assert_eq!(preview.total_items, 1);
        assert_eq!(preview.unknown_items, 0);
        assert_eq!(preview.login_items[0].title, "GitHub");
        assert_eq!(preview.login_items[0].username, "octo@example.com");
        assert_eq!(preview.login_items[0].password, "secret");
        assert_eq!(preview.login_items[0].website, "https://github.com");
        assert_eq!(preview.login_items[0].tags, vec!["code"]);

        let _ = std::fs::remove_file(path);
    }
}
