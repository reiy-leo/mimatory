//! Where an item's website may be filled — 1Password 8's three autofill behaviours, per address:
//!
//! - `domain` (default, "Fill anywhere on this website"): the page's registrable domain (eTLD+1, from the
//!   Public Suffix List compiled into the `psl` crate) equals the address's, so every subdomain of it
//!   matches, and so does a domain in the same bundled related-domain group (`RELATED_DOMAINS`).
//!   An address whose host *is* a public suffix (`github.io`, `co.uk`) or an IP address has no wider
//!   site, so it matches only that host. The port does not matter.
//! - `exact` ("Only fill on this exact host"): host **and** explicit port equal; `www` is a different host.
//! - `never` ("Never fill on this website"): the address is ignored when deciding whether the item fills.
//!   It is still a website of the item — searchable and openable — just never a reason to offer it.
//!
//! Hosts are compared in their ASCII (punycode) form, which is what both `url` and a browser's
//! `location.origin` produce, so `bücher.de` and `xn--bcher-kva.de` are one site.

use serde::Serialize;
use url::{Host, Url};

pub const MODE_DOMAIN: &str = "domain";
pub const MODE_EXACT: &str = "exact";
pub const MODE_NEVER: &str = "never";

/// Domains known to share one sign-in, after Apple's `websites-with-shared-credential-backends.json`
/// (github.com/apple/password-manager-resources, MIT). Deliberately small: a group here means a password
/// saved for one is offered on the other, so only organisations whose account system is plainly one.
const RELATED_DOMAINS: &[&[&str]] = &[
    &["apple.com", "icloud.com"],
    &["google.com", "youtube.com"],
    &["live.com", "microsoft.com", "office.com", "outlook.com", "skype.com", "xbox.com"],
];

/// The one stored form of a mode: anything unknown (an older build's value, a typo) means the default.
pub fn normalized_mode(mode: &str) -> &'static str {
    match mode.trim() {
        MODE_EXACT => MODE_EXACT,
        MODE_NEVER => MODE_NEVER,
        _ => MODE_DOMAIN,
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Site {
    /// Lowercase ASCII host without a trailing dot; IPv6 in brackets.
    pub host: String,
    /// The explicit port, `None` when absent or the scheme's default.
    pub port: Option<u16>,
    pub is_ip: bool,
}

/// Parses a stored address or a page origin. A bare `example.com/login` is read as https.
pub fn parse_site(value: &str) -> Option<Site> {
    let value = value.trim();
    if value.is_empty() {
        return None;
    }
    let url = if value.contains("://") || has_opaque_scheme(value) {
        Url::parse(value).ok()?
    } else {
        Url::parse(&format!("https://{value}")).ok()?
    };
    let (host, is_ip) = match url.host()? {
        Host::Domain(domain) => (domain.trim_end_matches('.').to_ascii_lowercase(), false),
        Host::Ipv4(address) => (address.to_string(), true),
        Host::Ipv6(address) => (format!("[{address}]"), true),
    };
    if host.is_empty() {
        return None;
    }
    Some(Site { host, port: url.port(), is_ip })
}

/// `mailto:a@b.c`, `tel:…` — a scheme with no authority, as opposed to `host:8443`.
fn has_opaque_scheme(value: &str) -> bool {
    let Some((scheme, rest)) = value.split_once(':') else {
        return false;
    };
    scheme.chars().next().is_some_and(|c| c.is_ascii_alphabetic())
        && scheme.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
        && !rest.starts_with(|c: char| c.is_ascii_digit())
}

/// eTLD+1 of a host, or the host itself when it is an IP, a public suffix, or has no listed suffix
/// above it — the widest set of hosts `domain` mode may treat as one site.
pub fn registrable_domain(site: &Site) -> String {
    if site.is_ip {
        return site.host.clone();
    }
    psl::domain_str(&site.host).unwrap_or(&site.host).to_string()
}

fn related_group(domain: &str) -> Option<&'static [&'static str]> {
    RELATED_DOMAINS.iter().copied().find(|group| group.contains(&domain))
}

/// Whether one stored address, under its mode, covers the page.
pub fn address_matches(stored: &str, mode: &str, page: &Site) -> bool {
    let Some(stored) = parse_site(stored) else {
        return false;
    };
    match normalized_mode(mode) {
        MODE_NEVER => false,
        MODE_EXACT => stored.host == page.host && stored.port == page.port,
        _ => {
            if stored.is_ip || page.is_ip {
                return stored.host == page.host;
            }
            let stored_domain = registrable_domain(&stored);
            // The address is itself a public suffix (`github.io`): nothing wider than that host.
            if stored_domain == stored.host && psl::domain_str(&stored.host).is_none() {
                return stored.host == page.host;
            }
            let page_domain = registrable_domain(page);
            stored_domain == page_domain
                || related_group(&stored_domain).is_some_and(|group| group.contains(&page_domain.as_str()))
        }
    }
}

/// What the editor's Autofill Behavior box says about an address, mode-independent; the frontend
/// picks the sentence for the chosen mode. Display forms are Unicode (`bücher.de`).
#[derive(Clone, Debug, Serialize, PartialEq, Eq)]
pub struct WebsiteScope {
    /// The host with its explicit port (`account.apple.com`, `localhost:8443`): what `exact` fills on.
    pub host: String,
    /// The site `domain` fills on (`apple.com`); equals `host` without the port when there is no wider site.
    pub domain: String,
    /// Whether `domain` also fills on bundled related domains, so the box may say so truthfully.
    pub related: bool,
    /// Whether `domain` mode reaches subdomains at all (false for an IP or a public-suffix host).
    pub subdomains: bool,
}

pub fn describe(value: &str) -> Option<WebsiteScope> {
    let site = parse_site(value)?;
    let unicode = |host: &str| {
        if host.starts_with('[') {
            return host.to_string();
        }
        let (display, result) = idna::domain_to_unicode(host);
        if result.is_ok() {
            display
        } else {
            host.to_string()
        }
    };
    let domain = registrable_domain(&site);
    let subdomains = !site.is_ip && psl::domain_str(&site.host).is_some();
    let host = match site.port {
        Some(port) => format!("{}:{port}", unicode(&site.host)),
        None => unicode(&site.host),
    };
    Some(WebsiteScope {
        related: subdomains && related_group(&domain).is_some(),
        domain: unicode(&domain),
        host,
        subdomains,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn page(value: &str) -> Site {
        parse_site(value).expect("page parses")
    }

    #[test]
    fn parses_bare_hosts_full_urls_and_origins_alike() {
        let site = page("https://User:pw@Account.Apple.com./sign-in?x=1#y");
        assert_eq!(site.host, "account.apple.com");
        assert_eq!(site.port, None);
        assert_eq!(page("github.com:8443/session").port, Some(8443));
        assert_eq!(page("https://example.com:443").port, None);
        assert_eq!(page("http://example.com:80").port, None);
        assert!(parse_site("   ").is_none());
        assert!(parse_site("https://").is_none());
        assert!(parse_site("mailto:a@b.c").is_none());
    }

    #[test]
    fn domain_mode_fills_on_every_host_of_the_registrable_domain() {
        let stored = "https://account.apple.com";
        assert!(address_matches(stored, MODE_DOMAIN, &page("https://appleid.apple.com")));
        assert!(address_matches(stored, MODE_DOMAIN, &page("https://apple.com")));
        assert!(address_matches(stored, MODE_DOMAIN, &page("https://developer.apple.com:8443")));
        assert!(!address_matches(stored, MODE_DOMAIN, &page("https://apple.com.evil.net")));
        assert!(!address_matches(stored, MODE_DOMAIN, &page("https://notapple.com")));
        // An unknown mode is the default.
        assert!(address_matches(stored, "", &page("https://apple.com")));
    }

    #[test]
    fn domain_mode_includes_the_bundled_related_domains_only() {
        assert!(address_matches("https://appleid.apple.com", MODE_DOMAIN, &page("https://www.icloud.com")));
        assert!(address_matches("outlook.com", MODE_DOMAIN, &page("https://login.live.com")));
        assert!(!address_matches("github.com", MODE_DOMAIN, &page("https://gitlab.com")));
        // Related domains are a `domain`-mode widening, never an `exact` one.
        assert!(!address_matches("apple.com", MODE_EXACT, &page("https://icloud.com")));
    }

    #[test]
    fn public_suffix_list_edge_cases() {
        // co.uk is a suffix: two different companies under it are two sites.
        assert!(address_matches("https://www.bbc.co.uk", MODE_DOMAIN, &page("https://account.bbc.co.uk")));
        assert!(!address_matches("https://bbc.co.uk", MODE_DOMAIN, &page("https://itv.co.uk")));
        // github.io is a (private-section) suffix: each user's pages are their own site.
        assert!(address_matches("https://rei.github.io", MODE_DOMAIN, &page("https://rei.github.io/app")));
        assert!(!address_matches("https://rei.github.io", MODE_DOMAIN, &page("https://evil.github.io")));
        // An address that *is* a suffix covers only itself, never every site under it.
        assert!(address_matches("https://github.io", MODE_DOMAIN, &page("https://github.io")));
        assert!(!address_matches("https://github.io", MODE_DOMAIN, &page("https://evil.github.io")));
        assert!(!address_matches("co.uk", MODE_DOMAIN, &page("https://bbc.co.uk")));
    }

    #[test]
    fn exact_mode_compares_host_and_port() {
        let stored = "https://appleid.apple.com/";
        assert!(address_matches(stored, MODE_EXACT, &page("https://appleid.apple.com/account")));
        assert!(!address_matches(stored, MODE_EXACT, &page("https://apple.com")));
        assert!(!address_matches(stored, MODE_EXACT, &page("https://www.appleid.apple.com")));
        assert!(!address_matches("apple.com", MODE_EXACT, &page("https://www.apple.com")));
        assert!(address_matches("localhost:8443", MODE_EXACT, &page("https://localhost:8443")));
        assert!(!address_matches("localhost:8443", MODE_EXACT, &page("https://localhost:9000")));
        assert!(!address_matches("localhost:8443", MODE_EXACT, &page("https://localhost")));
        // A default port is no port.
        assert!(address_matches("https://example.com:443", MODE_EXACT, &page("https://example.com")));
    }

    #[test]
    fn never_mode_never_matches() {
        assert!(!address_matches("https://apple.com", MODE_NEVER, &page("https://apple.com")));
        assert_eq!(normalized_mode("never"), MODE_NEVER);
        assert_eq!(normalized_mode("bogus"), MODE_DOMAIN);
    }

    #[test]
    fn ip_hosts_match_only_themselves() {
        assert!(address_matches("192.168.1.1", MODE_DOMAIN, &page("http://192.168.1.1:8080")));
        assert!(!address_matches("192.168.1.1", MODE_DOMAIN, &page("http://192.168.1.2")));
        assert!(!address_matches("10.0.0.1", MODE_DOMAIN, &page("https://0.1")));
        assert!(address_matches("http://[::1]:3000", MODE_EXACT, &page("http://[::1]:3000")));
        assert!(!address_matches("http://[::1]:3000", MODE_EXACT, &page("http://[::1]:3001")));
        assert!(address_matches("[::1]", MODE_DOMAIN, &page("http://[::1]:3001")));
    }

    #[test]
    fn single_label_hosts_are_their_own_site() {
        assert!(address_matches("http://localhost:3000", MODE_DOMAIN, &page("http://localhost:4000")));
        assert!(!address_matches("intranet", MODE_DOMAIN, &page("http://other")));
    }

    #[test]
    fn punycode_and_unicode_are_one_host() {
        assert!(address_matches("https://bücher.de", MODE_EXACT, &page("https://xn--bcher-kva.de")));
        assert!(address_matches("https://shop.bücher.de", MODE_DOMAIN, &page("https://xn--bcher-kva.de")));
        let scope = describe("https://shop.xn--bcher-kva.de").expect("describes");
        assert_eq!(scope.domain, "bücher.de");
        assert_eq!(scope.host, "shop.bücher.de");
    }

    #[test]
    fn describe_reports_what_each_mode_would_fill_on() {
        assert_eq!(
            describe("https://account.apple.com"),
            Some(WebsiteScope {
                host: "account.apple.com".into(),
                domain: "apple.com".into(),
                related: true,
                subdomains: true,
            })
        );
        let github = describe("https://github.com/login").expect("describes");
        assert_eq!((github.domain.as_str(), github.related, github.subdomains), ("github.com", false, true));
        let local = describe("localhost:8443").expect("describes");
        assert_eq!((local.host.as_str(), local.subdomains), ("localhost:8443", false));
        let ip = describe("10.0.0.1").expect("describes");
        assert_eq!((ip.domain.as_str(), ip.subdomains), ("10.0.0.1", false));
        assert!(describe("").is_none());
    }
}
