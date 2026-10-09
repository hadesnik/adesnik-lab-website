#!/usr/bin/env python3
"""Daily health check for the Adesnik Lab website, with an emailed diagnosis on failure.

Run once a day by .github/workflows/site-monitor.yml. It loads
https://adesnik.berkeley.edu the way a visitor's browser would: DNS lookup, HTTPS
certificate, the home page and a few key pages, and the stylesheet. Then it checks that
what comes back really is the lab site, not a GitHub or Pantheon error page.

If anything fails it retries a couple of times (to ride out a momentary blip), then
gathers extra evidence to work out *why*: the repo's GitHub Pages settings, the last
deploy run, and GitHub's own status page. It then emails a plain-English diagnosis with
suggested fixes to hadesnik@berkeley.edu, subject "Adesnik web site outage".

Standard library only, so it runs anywhere with Python 3.9+:

    python3 scripts/check_site.py               # check; email only if the site is down
    python3 scripts/check_site.py --dry-run     # check; print the email instead of sending
    python3 scripts/check_site.py --test-email  # send a "[TEST]" email even if the site is up

Email goes out over SMTP, configured by environment variables (GitHub repo secrets in CI):

    SMTP_USERNAME   account to send from, e.g. a Gmail address
    SMTP_PASSWORD   its app password (Gmail: https://myaccount.google.com/apppasswords)
    SMTP_HOST       default smtp.gmail.com
    SMTP_PORT       default 465 (implicit TLS); 587 uses STARTTLS
    ALERT_TO        default hadesnik@berkeley.edu

GITHUB_TOKEN (set automatically in CI) lets it read the repo's Pages settings for the
diagnosis; run locally, it falls back to `gh auth token` if the GitHub CLI is logged in.

Exit status is 0 when the site is healthy and 1 when it is not (or when a requested email
could not be sent), so a red run in the Actions tab means the site was down.
"""

import argparse
import datetime as dt
import html
import json
import os
import re
import smtplib
import socket
import ssl
import subprocess
import sys
import textwrap
import time
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from email.message import EmailMessage
from typing import Optional

# --- What to check ---------------------------------------------------------------------

SITE_HOST = "adesnik.berkeley.edu"
SITE_URL = f"https://{SITE_HOST}"
# Pages a visitor is most likely to land on. Each must load and look like the lab site.
PAGES = ["/", "/research/", "/lab-members/", "/publications/", "/contact/"]
STYLESHEET = "/assets/css/styles.css"
# Every page title on the real site contains this (see src/_includes/layouts/base.njk).
# Error pages from GitHub, Pantheon, etc. don't, which is how we tell them apart.
EXPECTED_IN_TITLE = "Adesnik Lab"

REPO = "hadesnik/adesnik-lab-website"
REPO_URL = f"https://github.com/{REPO}"
PAGES_SETTINGS_URL = f"{REPO_URL}/settings/pages"
DEPLOY_RUNS_URL = f"{REPO_URL}/actions/workflows/deploy.yml"
MONITOR_RUNS_URL = f"{REPO_URL}/actions/workflows/site-monitor.yml"
# Campus DNS must point the domain here (a CNAME record) for GitHub to serve it.
GITHUB_PAGES_HOST = "hadesnik.github.io"
# The deployed build is also reachable here, independently of campus DNS. While the custom
# domain is configured, GitHub answers this URL with a redirect to SITE_URL instead.
PROJECT_URL = f"https://{GITHUB_PAGES_HOST}/adesnik-lab-website/"
# GitHub Pages' published IPv4 addresses.
GITHUB_PAGES_IPS = {"185.199.108.153", "185.199.109.153", "185.199.110.153", "185.199.111.153"}
# Pantheon (campus's default WordPress/Drupal host, where the old site lived) serves
# custom domains from this range, so seeing it means DNS was pointed back at Pantheon.
PANTHEON_IP_PREFIX = "23.185.0."

ALERT_SUBJECT = "Adesnik web site outage"
DEFAULT_ALERT_TO = "hadesnik@berkeley.edu"

TIMEOUT = 20  # seconds allowed per network request
SLOW_SECONDS = 10  # a page slower than this gets mentioned, but isn't counted as an outage
# GitHub renews its Let's Encrypt certificates weeks before expiry, so a certificate this
# close to expiring means renewal has stalled. We alert while there's still time to fix it.
CERT_WARN_DAYS = 10
USER_AGENT = f"AdesnikLabSiteMonitor/1.0 (+{REPO_URL})"


# --- Results ---------------------------------------------------------------------------


@dataclass
class Fetch:
    """What came back from one HTTP request."""

    url: str
    status: Optional[int] = None  # HTTP status code; None if there was no response at all
    error: str = ""  # why there was no response (timeout, refused, bad certificate…)
    title: str = ""  # the page's <title>, unescaped
    location: str = ""  # redirect target, when redirects aren't followed
    seconds: float = 0.0
    body: str = ""
    headers: dict = field(default_factory=dict)

    @property
    def looks_like_lab_site(self):
        # The old WordPress site's titles said "Adesnik Lab" too, so rule it out explicitly.
        return self.status == 200 and EXPECTED_IN_TITLE in self.title and "wp-content" not in self.body

    def describe(self):
        """One-line summary for the report, e.g. 'HTTP 404, "Site not found · GitHub Pages"'."""
        if self.status is None:
            return self.error
        text = f"HTTP {self.status}"
        if self.title:
            text += f', "{self.title}"'
        if self.location:
            text += f" -> {self.location}"
        if self.seconds > SLOW_SECONDS:
            text += f" (slow: {self.seconds:.0f} s)"
        return text


@dataclass
class Findings:
    """Everything one check learned. Filled in by run_checks() and gather_evidence()."""

    dns_error: str = ""
    dns_canonical: str = ""  # what the name ultimately points to (the CNAME target)
    dns_ips: list = field(default_factory=list)
    tls_error: str = ""
    cert_expires: Optional[dt.datetime] = None
    pages: dict = field(default_factory=dict)  # path -> Fetch
    stylesheet: Optional[Fetch] = None
    # Extra evidence, gathered only when something failed:
    project_url: Optional[Fetch] = None
    pages_config: Optional[dict] = None  # GitHub's Pages settings for the repo
    pages_config_error: str = ""
    last_deploy: Optional[dict] = None  # most recent deploy.yml run on main
    github_status: dict = field(default_factory=dict)  # GitHub component -> status

    @property
    def dns_points_at_github(self):
        return self.dns_canonical == GITHUB_PAGES_HOST or (
            bool(self.dns_ips) and set(self.dns_ips) <= GITHUB_PAGES_IPS
        )

    @property
    def cert_days_left(self):
        if self.cert_expires is None:
            return None
        return (self.cert_expires - dt.datetime.now(dt.timezone.utc)).days

    @property
    def cert_expiring(self):
        return self.cert_days_left is not None and self.cert_days_left < CERT_WARN_DAYS

    @property
    def failed_pages(self):
        return {p: r for p, r in self.pages.items() if not r.looks_like_lab_site}

    @property
    def healthy(self):
        return (
            not self.dns_error
            and not self.tls_error
            and not self.cert_expiring
            and bool(self.pages)
            and not self.failed_pages
            and self.stylesheet is not None
            and self.stylesheet.status == 200
        )


# --- Network probes ----------------------------------------------------------------------


class _DontFollowRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None  # urllib then hands the 3xx back to us as an HTTPError


def describe_network_error(exc):
    """Turn a urllib/socket exception into a short human-readable reason."""
    reason = getattr(exc, "reason", exc)  # URLError wraps the underlying error
    if isinstance(reason, ssl.SSLCertVerificationError):
        return f"HTTPS certificate rejected: {reason.verify_message or reason}"
    if isinstance(reason, (socket.timeout, TimeoutError)):
        return f"no response within {TIMEOUT} s"
    if isinstance(reason, ConnectionRefusedError):
        return "connection refused"
    if isinstance(reason, socket.gaierror):
        return f"DNS lookup failed ({reason})"
    return str(reason)


def fetch(url, follow_redirects=True):
    handlers = [] if follow_redirects else [_DontFollowRedirects]
    opener = urllib.request.build_opener(*handlers)
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    result = Fetch(url=url)
    start = time.monotonic()
    try:
        response = opener.open(request, timeout=TIMEOUT)
    except urllib.error.HTTPError as exc:
        response = exc  # a 4xx/5xx (or unfollowed redirect) still has a status, headers, body
    except (urllib.error.URLError, OSError) as exc:
        result.error = describe_network_error(exc)
        result.seconds = time.monotonic() - start
        return result
    with response:
        result.status = response.getcode()
        result.headers = {k.lower(): v for k, v in response.headers.items()}
        result.location = "" if follow_redirects else result.headers.get("location", "")
        try:
            result.body = response.read(500_000).decode("utf-8", "replace")
        except OSError:
            pass  # status and headers are enough to diagnose with
    result.seconds = time.monotonic() - start
    match = re.search(r"<title[^>]*>(.*?)</title>", result.body, re.IGNORECASE | re.DOTALL)
    if match:
        result.title = " ".join(html.unescape(match.group(1)).split())
    return result


def check_dns(findings):
    try:
        canonical, _aliases, ips = socket.gethostbyname_ex(SITE_HOST)
    except OSError as exc:
        findings.dns_error = str(exc)
        return
    findings.dns_canonical, findings.dns_ips = canonical, sorted(ips)


def check_certificate(findings):
    """Open an HTTPS connection ourselves so we can read the certificate's expiry date."""
    context = ssl.create_default_context()
    try:
        with socket.create_connection((SITE_HOST, 443), timeout=TIMEOUT) as sock:
            with context.wrap_socket(sock, server_hostname=SITE_HOST) as tls:
                cert = tls.getpeercert()
    except ssl.SSLCertVerificationError as exc:
        findings.tls_error = (exc.verify_message or str(exc)).rstrip(".")
        return
    except OSError as exc:
        findings.tls_error = describe_network_error(exc)
        return
    expires = ssl.cert_time_to_seconds(cert["notAfter"])
    findings.cert_expires = dt.datetime.fromtimestamp(expires, dt.timezone.utc)


def run_checks():
    """The visitor's-eye check. Stops at the first layer that fails, since nothing above a
    broken DNS lookup or certificate can load, and repeating the same error adds nothing."""
    findings = Findings()
    check_dns(findings)
    if findings.dns_error:
        return findings
    check_certificate(findings)
    if findings.tls_error:
        return findings
    findings.pages = {path: fetch(SITE_URL + path) for path in PAGES}
    findings.stylesheet = fetch(SITE_URL + STYLESHEET)
    return findings


def github_token():
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        return token
    try:  # local runs: borrow the GitHub CLI's login, if there is one
        out = subprocess.run(["gh", "auth", "token"], capture_output=True, text=True, timeout=10)
        return out.stdout.strip() if out.returncode == 0 else ""
    except (OSError, subprocess.SubprocessError):
        return ""


def get_json(url, headers=None):
    """GET a JSON URL. Returns (data, error); exactly one of them is set."""
    request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, **(headers or {})})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            return json.load(response), ""
    except urllib.error.HTTPError as exc:
        return None, f"HTTP {exc.code}"
    except (urllib.error.URLError, OSError, ValueError) as exc:
        return None, describe_network_error(exc)


def github_api(path, token):
    headers = {"Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return get_json("https://api.github.com" + path, headers)


def gather_evidence(findings):
    """After a failure, collect the extra facts diagnose() uses to explain it."""
    # Is the deployed build itself intact, regardless of campus DNS? And is the custom
    # domain configured? (200 = served here, so not attached to the domain; a redirect to
    # SITE_URL = attached; 404 = nothing deployed.)
    findings.project_url = fetch(PROJECT_URL, follow_redirects=False)

    token = github_token()
    findings.pages_config, error = github_api(f"/repos/{REPO}/pages", token)
    if error:
        findings.pages_config_error = error if token else f"{error} (no GitHub token available)"

    runs, _ = github_api(f"/repos/{REPO}/actions/workflows/deploy.yml/runs?branch=main&per_page=1", token)
    if runs and runs.get("workflow_runs"):
        findings.last_deploy = runs["workflow_runs"][0]

    # GitHub's public status page, to tell "GitHub is having an outage" from "our setup broke".
    status, _ = get_json("https://www.githubstatus.com/api/v2/components.json")
    for component in (status or {}).get("components", []):
        if component.get("name") in ("Pages", "Actions"):
            findings.github_status[component["name"]] = component.get("status", "unknown")


# --- Diagnosis ---------------------------------------------------------------------------

SET_DOMAIN_STEPS = [
    f'Open {PAGES_SETTINGS_URL}, type {SITE_HOST} into "Custom domain", and click Save. '
    "Or, from a terminal where the GitHub CLI (gh) is logged in:\n"
    f"    gh api -X PUT repos/{REPO}/pages -f cname={SITE_HOST}",
    "Wait for the DNS check on that page to turn green and for GitHub to issue the HTTPS "
    'certificate (a few minutes, occasionally up to an hour), then tick "Enforce HTTPS".',
]

# Needed when GitHub refuses the custom domain because another account has verified
# berkeley.edu, which covers its immediate subdomains (as happened in October 2026).
VERIFY_STEP = (
    'If GitHub refuses with "You must verify your domain", verify it for your account '
    f'first: at https://github.com/settings/pages click "Add a domain" and enter {SITE_HOST}. '
    "GitHub shows a TXT record; ask department IT to add it (their record name: "
    f"_github-pages-challenge-hadesnik.{SITE_HOST}). Once it is live, click Verify there, "
    "then do the previous step again. Verifying also stops anyone else claiming the domain."
)

DNS_RECORD = f"    {SITE_HOST}.  CNAME  {GITHUB_PAGES_HOST}."

ASK_IT_STEP = (
    "Ask the department IT contact who manages the lab's DNS record (MCB / Helen Wills "
    "Neuroscience Institute IT) to restore it. The record should be exactly:\n" + DNS_RECORD
)

STATUS_STEP = (
    "Check https://www.githubstatus.com. GitHub problems usually clear on their own within "
    "hours, so give it a while before changing anything."
)

REDEPLOY_STEP = (
    f"Re-run the deploy: open {DEPLOY_RUNS_URL} and click \"Run workflow\", or run\n"
    f"    gh workflow run deploy.yml -R {REPO}\n"
    "If the build step fails, its log (or `npm run build` locally) shows the error."
)


@dataclass
class Diagnosis:
    headline: str  # what a visitor experiences, in one sentence
    explanation: list = field(default_factory=list)  # paragraphs: what seems to be going on
    steps: list = field(default_factory=list)  # suggestions, most likely fix first


def diagnose(f):
    d = Diagnosis(headline="")
    cfg = f.pages_config or {}
    home = f.pages.get("/")

    # GitHub-side incidents go first: if GitHub itself is broken, nothing on our side needs fixing.
    troubled = {name: s for name, s in f.github_status.items() if s != "operational"}
    if troubled:
        listed = ", ".join(f"{name} ({s.replace('_', ' ')})" for name, s in troubled.items())
        d.explanation.append(
            f"GitHub's status page currently reports a problem with {listed}, so the outage "
            "is probably on GitHub's side and should clear without any action."
        )
        d.steps.append(STATUS_STEP)

    # DNS pointed somewhere other than GitHub: not an outage by itself, but the likely cause
    # of whatever failed below.
    if not f.dns_error and not f.dns_points_at_github:
        target = f.dns_canonical if f.dns_canonical != SITE_HOST else ", ".join(f.dns_ips)
        where = ""
        if any(ip.startswith(PANTHEON_IP_PREFIX) for ip in f.dns_ips):
            where = (" Those addresses belong to Pantheon, the campus WordPress host where the "
                     "old site lived, so the record has probably been reverted to its old setting.")
        d.explanation.append(
            f"{SITE_HOST} no longer points to GitHub Pages ({GITHUB_PAGES_HOST}); it now "
            f"points to {target}.{where}"
        )
        d.steps.append(ASK_IT_STEP)

    if f.dns_error:
        d.headline = f"{SITE_HOST} does not resolve, so browsers cannot find the site at all."
        d.explanation.append(
            f"The DNS lookup for {SITE_HOST} failed ({f.dns_error}). DNS for berkeley.edu is "
            "run by campus IT, so the record that points this name at GitHub has been deleted "
            "or broken, or campus DNS is having problems. The site itself is probably fine; "
            "it just can't be found."
        )
        d.steps.append(ASK_IT_STEP)
        d.steps.append(
            "Once the record is back it can take up to an hour to reach everyone. Then check "
            f"that {PAGES_SETTINGS_URL} still lists {SITE_HOST} as the custom domain."
        )

    elif f.tls_error:
        d.headline = ("Browsers refuse to open the site and show a \"Your connection is not "
                      "private\" (or similar) security warning.")
        error = f.tls_error.lower()
        caa_step = (
            "If GitHub reports that the certificate request failed, check that berkeley.edu's "
            "CAA DNS records still allow letsencrypt.org (department IT can confirm)."
        )
        if not f.dns_points_at_github:
            d.explanation.append(
                f"The server the name now points to has no valid certificate for {SITE_HOST} "
                f"({f.tls_error}). That's expected when DNS points at the wrong host; restoring "
                "the DNS record fixes this too."
            )
        elif "mismatch" in error or "not valid for" in error:
            d.explanation.append(
                f"The HTTPS certificate being served doesn't cover {SITE_HOST} ({f.tls_error}). "
                "When GitHub serves a certificate for some other name, it hasn't got one for "
                "this domain. Usually that's because the custom domain was removed from the "
                "repository's Pages settings, or was just re-added and the certificate is "
                "still being issued."
            )
            d.steps += SET_DOMAIN_STEPS
            d.steps.append(
                "If the domain is already set there, remove it, Save, add it back, and Save "
                "again. That makes GitHub request a fresh certificate."
            )
            d.steps.append(caa_step)
        elif "expired" in error:
            d.explanation.append(
                "The HTTPS certificate has expired. GitHub normally renews it automatically, "
                "so renewal has stalled, most often because the custom domain setting or the "
                "DNS record changed."
            )
            d.steps.append(
                f"At {PAGES_SETTINGS_URL}, remove the custom domain, Save, add {SITE_HOST} "
                "back, and Save. That forces a new certificate request."
            )
            d.steps.append(caa_step)
        else:
            d.explanation.append(
                f"Couldn't open a secure connection to the server ({f.tls_error}). DNS does "
                "point at GitHub, so this is most likely a problem on GitHub's side or a "
                "network problem between the checker and GitHub."
            )
            if STATUS_STEP not in d.steps:
                d.steps.append(STATUS_STEP)

    elif home is not None and not home.looks_like_lab_site:
        diagnose_home_page(f, d, home, cfg)

    elif f.failed_pages:
        broken = ", ".join(f"{path} ({r.describe()})" for path, r in f.failed_pages.items())
        d.headline = "The home page loads, but some pages are broken."
        d.explanation.append(
            f"These pages failed: {broken}. A page may have been renamed or removed in a "
            "recent commit, or the last deploy only partly succeeded."
        )
        d.steps.append(f"Check the recent commits at {REPO_URL}/commits/main for a renamed or deleted page.")
        d.steps.append(REDEPLOY_STEP)

    elif f.stylesheet is not None and f.stylesheet.status != 200:
        d.headline = "Pages load, but without their styling, so the site looks broken."
        d.explanation.append(
            f"The stylesheet {SITE_URL}{STYLESHEET} failed ({f.stylesheet.describe()}). It is "
            "copied from src/assets/css/ at build time, so it was probably moved or renamed, "
            "or the last deploy was incomplete."
        )
        d.steps.append(REDEPLOY_STEP)

    elif f.cert_expiring:
        when = f.cert_expires.strftime("%-d %b %Y")
        d.headline = (f"The site works today, but its HTTPS certificate expires on {when} "
                      f"({f.cert_days_left} days). After that, browsers will block it.")
        d.explanation.append(
            "GitHub renews this certificate automatically well before it expires, so renewal "
            "has stalled. That usually happens when the custom domain setting was removed or "
            "the DNS record changed."
        )
        d.steps += SET_DOMAIN_STEPS
        d.steps.append(
            "If the domain is already set there, remove it, Save, add it back, and Save again "
            "to force a fresh certificate."
        )

    # A failed latest deploy doesn't take the site down by itself (the previous build keeps
    # serving), but it explains missing pages, and it means recent edits aren't live.
    deploy = f.last_deploy
    if deploy and deploy.get("conclusion") not in ("success", None):
        d.explanation.append(
            f"Also, the most recent deploy ({deploy.get('created_at', '?')[:10]}, "
            f"\"{deploy.get('display_title', '')}\") ended in \"{deploy.get('conclusion')}\". "
            f"Its log is at {deploy.get('html_url', DEPLOY_RUNS_URL)}"
        )

    if not d.headline:  # shouldn't happen, but never send an alert without one
        d.headline = "The site failed one of its checks (see CHECK RESULTS below)."
    d.steps.append(
        "Not sure what to do? Open this repo in Claude Code and paste in this email. It "
        "contains everything needed to investigate."
    )
    return d


def diagnose_home_page(f, d, home, cfg):
    """The home page came back, but not as the lab site. Work out what it is instead."""
    cname = cfg.get("cname")
    title = home.title.lower()
    on_github = " With DNS pointing at GitHub, that is most likely a GitHub-side problem." if f.dns_points_at_github else ""

    if home.status is None:
        d.headline = f"The site doesn't respond ({home.error})."
        d.explanation.append(
            "DNS and the HTTPS certificate are fine, but the server never answered the "
            "request." + on_github
        )
        if STATUS_STEP not in d.steps:
            d.steps.append(STATUS_STEP)
        d.steps.append(REDEPLOY_STEP)

    elif home.status == 404 and "site not found" in title and "github" in title:
        d.headline = ("Visitors see GitHub's \"Site not found\" error page (HTTP 404) instead "
                      "of the lab website.")
        d.explanation.append(
            f"Campus DNS points {SITE_HOST} at GitHub correctly, but GitHub doesn't know which "
            "repository should answer for that name. That happens when the custom domain is "
            "missing from the repository's GitHub Pages settings."
        )
        pages_switched_off = f.pages_config is None and f.pages_config_error == "HTTP 404"
        if f.pages_config is not None and not cname:
            d.explanation.append(
                "Confirmed: the repository's Pages settings currently have no custom domain. "
                "One known way it disappears: when any GitHub account verifies berkeley.edu "
                "for GitHub Pages, GitHub immediately removes berkeley.edu's subdomains, "
                f"including {SITE_HOST}, from everyone else's sites."
            )
        elif pages_switched_off:
            d.explanation.append(
                "GitHub also reports that the repository has no Pages site at all, so GitHub "
                "Pages may have been switched off for it entirely."
            )
        elif cname and cname != SITE_HOST:
            d.explanation.append(
                f'The repository\'s Pages settings name "{cname}" as the custom domain, '
                f"not {SITE_HOST}."
            )
        elif cname == SITE_HOST:
            d.explanation.append(
                f"Oddly, the repository's Pages settings do list {SITE_HOST}, so this may be a "
                "GitHub-side glitch or a change that hasn't taken effect yet."
            )
        if f.project_url is not None and f.project_url.looks_like_lab_site:
            d.explanation.append(
                f"The site itself is intact: the latest build is still being served at "
                f"{PROJECT_URL}. It looks unstyled there, because it's built to live at the "
                f"root of {SITE_HOST}."
            )
        d.explanation.append(
            "Note: the line in deploy.yml that writes a CNAME file does not set the domain. "
            "GitHub ignores CNAME files for sites deployed by GitHub Actions; the domain is "
            "stored only in the repository settings."
        )
        if cname != SITE_HOST:
            d.explanation.append(
                f"Security: until {SITE_HOST} is verified for your own GitHub account, another "
                "account may be able to attach it to their Pages site and serve their content "
                "on the lab's address, so fix this promptly."
            )
        if pages_switched_off:
            d.steps.append(
                f'At {PAGES_SETTINGS_URL}, set "Build and deployment > Source" to "GitHub '
                'Actions", then re-run the deploy (see the Deploy runs link below).'
            )
        d.steps += [SET_DOMAIN_STEPS[0], VERIFY_STEP, SET_DOMAIN_STEPS[1]]

    elif home.status == 404 and "page not found" in title and "github" in title:
        d.headline = "Visitors see GitHub's \"Page not found\" error (HTTP 404) on the home page."
        d.explanation.append(
            "The domain is correctly attached to the lab's GitHub Pages site, but the site "
            "GitHub is serving has no home page. The last deploy probably published an empty "
            "or broken build."
        )
        d.steps.append(REDEPLOY_STEP)

    # Checked before the 5xx case because Pantheon's error pages can be 5xx too.
    elif "wp-content" in home.body or "pantheon" in (home.body + str(home.headers)).lower():
        d.headline = "The old WordPress site (or a Pantheon error page) is being served instead of the new site."
        d.explanation.append(
            f"The page that loads (\"{home.title}\") comes from the old hosting, so "
            f"{SITE_HOST} has been pointed back at it."
        )
        if ASK_IT_STEP not in d.steps:
            d.steps.append(ASK_IT_STEP)

    elif home.status >= 500:
        d.headline = f"The server returns an error (HTTP {home.status}) instead of the site."
        d.explanation.append("HTTP 5xx errors come from the hosting side, not the site's files." + on_github)
        if STATUS_STEP not in d.steps:
            d.steps.append(STATUS_STEP)
        d.steps.append(REDEPLOY_STEP)

    else:
        d.headline = (f"Something other than the lab website loads (HTTP {home.status}, page "
                      f"title \"{home.title or 'none'}\").")
        d.explanation.append(
            f"The address responds, but not with the lab site. Its page title doesn't contain "
            f"\"{EXPECTED_IN_TITLE}\" the way every real page does."
        )
        d.steps.append(f"Open {SITE_URL} in a browser to see what is being served.")
        d.steps.append(REDEPLOY_STEP)


# --- Report ------------------------------------------------------------------------------


def now_pacific():
    try:
        from zoneinfo import ZoneInfo

        return dt.datetime.now(ZoneInfo("America/Los_Angeles"))
    except Exception:  # no time zone database on this machine: fall back to UTC
        return dt.datetime.now(dt.timezone.utc)


def check_lines(f):
    """The table of raw results that ends the email."""
    rows = []

    def row(ok, name, detail):
        status = "  ok  " if ok is True else " FAIL " if ok is False else "  --  "
        rows.append(f"{status} {name:<20} {detail}")

    if f.dns_error:
        row(False, "DNS", f.dns_error)
    else:
        target = f" -> {f.dns_canonical}" if f.dns_canonical != SITE_HOST else ""
        row(True, "DNS", f"{SITE_HOST}{target} ({', '.join(f.dns_ips)})")
    if f.tls_error:
        row(False, "HTTPS cert", f.tls_error)
    elif f.cert_expires:
        row(not f.cert_expiring, "HTTPS cert",
            f"valid until {f.cert_expires:%Y-%m-%d} ({f.cert_days_left} days)")
    for path, r in f.pages.items():
        row(r.looks_like_lab_site, f"Page {path}", r.describe())
    if f.stylesheet is not None:
        row(f.stylesheet.status == 200, "Stylesheet", f.stylesheet.describe())

    # Evidence gathered after a failure: context, not pass/fail.
    if f.project_url is not None:
        row(None, "github.io copy", f"{PROJECT_URL}: {f.project_url.describe()}")
    if f.pages_config is not None:
        cfg = f.pages_config
        row(None, "Pages settings",
            f"custom domain: {cfg.get('cname') or '(none)'}; "
            f"HTTPS enforced: {'yes' if cfg.get('https_enforced') else 'no'}; "
            f"source: {cfg.get('build_type', '?')}")
    elif f.pages_config_error:
        row(None, "Pages settings", f"couldn't read them: {f.pages_config_error}")
    if f.last_deploy:
        dep = f.last_deploy
        row(None, "Last deploy",
            f"{dep.get('conclusion') or dep.get('status')}, {dep.get('created_at', '?')[:10]}, "
            f"\"{dep.get('display_title', '')}\"")
    if f.github_status:
        row(None, "GitHub status", ", ".join(f"{k}: {v}" for k, v in f.github_status.items()))
    return rows


def wrap(text, indent="  "):
    """Wrap a paragraph for a plain-text email. Lines already indented four spaces
    (commands, DNS records) are kept verbatim so they can be copied exactly."""
    out = []
    for line in text.split("\n"):
        if line.startswith("    "):
            out.append(indent + line)
        else:
            # Never break inside a word, so URLs (which contain hyphens) stay clickable.
            out.append(textwrap.fill(line, 78, initial_indent=indent, subsequent_indent=indent,
                                     break_long_words=False, break_on_hyphens=False))
    return "\n".join(out)


def build_report(f, attempts, test):
    when = now_pacific().strftime("%-I:%M %p %Z on %a %-d %b %Y")
    lines = []
    if test:
        lines += ["[TEST] This is a test of the website outage alert.", ""]

    if f.healthy:
        lines += [wrap(f"The daily check of {SITE_URL} at {when} found the site up and "
                       "working. No action is needed.", indent=""), ""]
    else:
        d = diagnose(f)
        tries = f"{attempts} attempts" if attempts > 1 else "1 attempt"
        lines += [wrap(f"The daily check of {SITE_URL} failed at {when} ({tries}).", indent=""), ""]
        lines += ["WHAT'S WRONG", wrap(d.headline), ""]
        lines += ["WHAT SEEMS TO BE GOING ON"]
        for paragraph in d.explanation:
            lines += [wrap(paragraph), ""]
        lines += ["HOW TO GET IT WORKING AGAIN"]
        for n, step in enumerate(d.steps, 1):
            first, *rest = wrap(step, indent="     ").split("\n")
            lines += [f"  {n}. " + first.lstrip()] + rest
            lines.append("")

    lines += ["CHECK RESULTS"] + check_lines(f) + [""]
    lines += [
        "LINKS",
        f"  Pages settings  {PAGES_SETTINGS_URL}",
        f"  Deploy runs     {DEPLOY_RUNS_URL}",
        f"  Monitor runs    {MONITOR_RUNS_URL}",
        "  GitHub status   https://www.githubstatus.com",
        "",
        "--",
        "Sent by scripts/check_site.py, run daily by the site-monitor GitHub Actions workflow.",
    ]
    return "\n".join(lines)


# --- Delivery ----------------------------------------------------------------------------


def send_email(subject, body):
    """Send via SMTP. Returns True on success; prints why not otherwise."""
    username = os.environ.get("SMTP_USERNAME", "")
    password = os.environ.get("SMTP_PASSWORD", "")
    if not (username and password):
        print("::error::SMTP_USERNAME / SMTP_PASSWORD are not set, so the alert email was NOT "
              "sent. Add them as repository secrets (see scripts/check_site.py).", file=sys.stderr)
        return False
    # `or` rather than a get() default: unset GitHub secrets arrive as empty strings.
    host = os.environ.get("SMTP_HOST") or "smtp.gmail.com"
    port = int(os.environ.get("SMTP_PORT") or 465)

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = username
    message["To"] = os.environ.get("ALERT_TO") or DEFAULT_ALERT_TO
    message.set_content(body)

    context = ssl.create_default_context()
    try:
        if port == 465:
            server = smtplib.SMTP_SSL(host, port, timeout=30, context=context)
        else:
            server = smtplib.SMTP(host, port, timeout=30)
            server.starttls(context=context)
        with server:
            server.login(username, password)
            server.send_message(message)
    except (smtplib.SMTPException, OSError) as exc:
        print(f"::error::Could not send the alert email via {host}:{port}: {exc}", file=sys.stderr)
        return False
    print(f"Alert email sent to {message['To']}.")
    return True


def write_job_summary(healthy, report):
    """Show the report on the workflow run's page in the Actions tab."""
    path = os.environ.get("GITHUB_STEP_SUMMARY")
    if not path:
        return
    with open(path, "a") as summary:
        summary.write(f"## {SITE_HOST} is {'up' if healthy else 'DOWN'}\n\n```text\n{report}\n```\n")


def main(argv=None):
    parser = argparse.ArgumentParser(description="Check that the Adesnik Lab website loads; email a diagnosis if not.")
    parser.add_argument("--dry-run", action="store_true", help="print the email instead of sending it")
    parser.add_argument("--test-email", action="store_true",
                        help='send the report even if the site is up, with "[TEST]" in the subject')
    parser.add_argument("--attempts", type=int, default=3, help="checks before declaring an outage (default 3)")
    parser.add_argument("--retry-delay", type=int, default=60, help="seconds between attempts (default 60)")
    args = parser.parse_args(argv)

    # Retry before alerting, so a momentary network blip doesn't send a false alarm.
    for attempt in range(1, args.attempts + 1):
        findings = run_checks()
        if findings.healthy or attempt == args.attempts:
            break
        print(f"Attempt {attempt}/{args.attempts} failed; retrying in {args.retry_delay} s.", flush=True)
        time.sleep(args.retry_delay)

    if not findings.healthy:
        gather_evidence(findings)
    report = build_report(findings, attempt, test=args.test_email)
    print(report)
    write_job_summary(findings.healthy, report)

    sent = True
    if not findings.healthy or args.test_email:
        subject = ("[TEST] " if args.test_email else "") + ALERT_SUBJECT
        if args.dry_run:
            print(f"\n(dry run: email with subject \"{subject}\" not sent)")
        else:
            sent = send_email(subject, report)
    return 0 if findings.healthy and sent else 1


if __name__ == "__main__":
    sys.exit(main())
