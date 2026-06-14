#!/usr/bin/env -S uv run --script
# /// script
# requires-python = ">=3.11"
# ///
"""Manage Seisan red-team report files and metadata."""

from __future__ import annotations

import argparse
import json
import re
import shutil
import subprocess
import sys
from dataclasses import dataclass
from datetime import datetime
from pathlib import Path

SCHEMA_VERSION = 1
ACTIVE_DIR = "active"
RESOLVED_DIR = "resolved"
VALID_RESOLUTIONS = ("Fixed", "Risk Accepted", "Not Valid")


@dataclass(frozen=True)
class Report:
    id: str
    severity: str
    title: str
    date: str
    commit: str
    status: str
    file: str
    resolution: str | None = None


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--repo-root",
        type=Path,
        default=None,
        help="Repository root. Defaults to the nearest ancestor containing .git or red-team.",
    )
    subparsers = parser.add_subparsers(dest="command", required=True)

    new_parser = subparsers.add_parser("new", help="Create an active report and update metadata.")
    new_parser.add_argument("--severity", required=True)
    new_parser.add_argument("--title", required=True)
    new_parser.add_argument("--summary", required=True)
    new_parser.add_argument("--date", default=None)
    new_parser.add_argument("--commit", default=None)

    resolve_parser = subparsers.add_parser(
        "resolve", help="Move an active report to resolved and update metadata."
    )
    resolve_parser.add_argument("id", help="Report ID, for example RT-1.")
    resolve_parser.add_argument("--resolution", required=True, choices=VALID_RESOLUTIONS)
    resolve_parser.add_argument(
        "--details",
        default="TODO: describe how this was resolved and verified.",
        help="Text for the ## Resolution section.",
    )
    resolve_parser.add_argument("--datetime", default=None, help="Filename timestamp override.")

    subparsers.add_parser("sync", help="Rebuild metadata from active and resolved markdown files.")
    subparsers.add_parser("validate", help="Validate metadata and report file consistency.")
    subparsers.add_parser("list", help="List reports from metadata.")

    args = parser.parse_args()
    repo_root = find_repo_root(args.repo_root)
    red_team = repo_root / "red-team"

    try:
        if args.command == "new":
            report = create_report(
                red_team=red_team,
                severity=args.severity,
                title=args.title,
                summary=args.summary,
                date=args.date or current_date(),
                commit=args.commit or current_commit(repo_root),
            )
            print(red_team / report.file)
        elif args.command == "resolve":
            report = resolve_report(
                red_team=red_team,
                report_id=normalize_report_id(args.id),
                resolution=args.resolution,
                details=args.details,
                filename_timestamp=args.datetime or filename_timestamp(),
            )
            print(red_team / report.file)
        elif args.command == "sync":
            metadata = sync_metadata(red_team)
            print(f"synced {len(metadata['issues'])} issues")
        elif args.command == "validate":
            metadata = sync_metadata(red_team)
            validate_metadata(red_team, metadata)
            print(f"validated {len(metadata['issues'])} issues")
        elif args.command == "list":
            metadata = load_or_sync_metadata(red_team)
            for issue in metadata["issues"]:
                print(f"{issue['id']}\t{issue['status']}\t{issue['severity']}\t{issue['title']}")
    except ReportError as error:
        print(f"error: {error}", file=sys.stderr)
        return 1

    return 0


class ReportError(Exception):
    pass


def find_repo_root(explicit: Path | None) -> Path:
    if explicit is not None:
        return explicit.resolve()

    current = Path.cwd().resolve()
    for candidate in (current, *current.parents):
        if (candidate / ".git").exists() or (candidate / "red-team").exists():
            return candidate
    raise ReportError("could not find repository root")


def ensure_structure(red_team: Path) -> None:
    (red_team / ACTIVE_DIR).mkdir(parents=True, exist_ok=True)
    (red_team / RESOLVED_DIR).mkdir(parents=True, exist_ok=True)


def metadata_path(red_team: Path) -> Path:
    return red_team / "metadata.json"


def load_metadata(red_team: Path) -> dict:
    path = metadata_path(red_team)
    if not path.exists():
        return {
            "schemaVersion": SCHEMA_VERSION,
            "activeDir": ACTIVE_DIR,
            "resolvedDir": RESOLVED_DIR,
            "nextId": next_id_from_reports(red_team),
            "issues": [],
        }
    return json.loads(path.read_text())


def write_metadata(red_team: Path, metadata: dict) -> None:
    metadata_path(red_team).write_text(json.dumps(metadata, indent=2) + "\n")


def load_or_sync_metadata(red_team: Path) -> dict:
    if metadata_path(red_team).exists():
        return load_metadata(red_team)
    return sync_metadata(red_team)


def create_report(
    red_team: Path,
    severity: str,
    title: str,
    summary: str,
    date: str,
    commit: str,
) -> Report:
    ensure_structure(red_team)
    metadata = load_metadata(red_team)
    numeric_id = int(metadata.get("nextId") or next_id_from_reports(red_team))
    report_id = f"RT-{numeric_id}"
    timestamp = timestamp_from_date(date) or filename_timestamp()
    file_name = f"{report_id.lower()}-{slugify(title)}-{timestamp}.md"
    relative_file = f"{ACTIVE_DIR}/{file_name}"
    path = red_team / relative_file
    if path.exists():
        raise ReportError(f"report already exists: {path}")

    path.write_text(
        "\n".join(
            [
                f"# {report_id} - {severity} - {title}",
                "",
                f"Date: {date}",
                f"Commit: {commit}",
                "",
                summary,
                "",
                "## Reproduce Steps",
                "",
                "TODO: document the live local API requests and observed results.",
                "",
                "## Root Cause Analysis",
                "",
                "TODO: document why the vulnerability exists.",
                "",
            ]
        )
    )

    metadata = sync_metadata(red_team)
    metadata["nextId"] = max(metadata["nextId"], numeric_id + 1)
    write_metadata(red_team, metadata)
    return parse_report(path, red_team)


def resolve_report(
    red_team: Path,
    report_id: str,
    resolution: str,
    details: str,
    filename_timestamp: str,
) -> Report:
    ensure_structure(red_team)
    metadata = load_or_sync_metadata(red_team)
    issue = find_issue(metadata, report_id)
    if issue is None:
        raise ReportError(f"unknown report id: {report_id}")
    if issue["status"] != "active":
        raise ReportError(f"report is not active: {report_id}")

    source = red_team / issue["file"]
    if not source.exists():
        raise ReportError(f"active report is missing: {source}")

    text = source.read_text()
    text = upsert_resolution_field(text, resolution)
    text = upsert_resolution_section(text, details)

    title_slug = slugify(issue["title"])
    severity_slug = slugify(issue["severity"])
    destination_name = f"{report_id.lower()}-{severity_slug}-{title_slug}-{filename_timestamp}.md"
    destination = red_team / RESOLVED_DIR / destination_name
    if destination.exists():
        raise ReportError(f"resolved report already exists: {destination}")

    destination.write_text(text)
    source.unlink()
    metadata = sync_metadata(red_team)
    return parse_report(destination, red_team)


def sync_metadata(red_team: Path) -> dict:
    ensure_structure(red_team)
    reports = [
        *scan_reports(red_team / ACTIVE_DIR, red_team, "active"),
        *scan_reports(red_team / RESOLVED_DIR, red_team, "resolved"),
    ]
    reports.sort(key=lambda report: report_number(report.id))
    metadata = {
        "schemaVersion": SCHEMA_VERSION,
        "activeDir": ACTIVE_DIR,
        "resolvedDir": RESOLVED_DIR,
        "nextId": (max((report_number(report.id) for report in reports), default=0) + 1),
        "issues": [report_to_metadata(report) for report in reports],
    }
    write_metadata(red_team, metadata)
    validate_metadata(red_team, metadata)
    return metadata


def validate_metadata(red_team: Path, metadata: dict) -> None:
    if metadata.get("schemaVersion") != SCHEMA_VERSION:
        raise ReportError("metadata schemaVersion is invalid")
    seen_ids: set[str] = set()
    for issue in metadata.get("issues", []):
        report_id = normalize_report_id(issue["id"])
        if report_id in seen_ids:
            raise ReportError(f"duplicate report id: {report_id}")
        seen_ids.add(report_id)
        if re.match(r"^RT-0\d", report_id):
            raise ReportError(f"zero-padded report id is not allowed: {report_id}")
        path = red_team / issue["file"]
        if not path.exists():
            raise ReportError(f"metadata references missing report: {path}")
        report = parse_report(path, red_team)
        if report.id != report_id:
            raise ReportError(f"metadata id mismatch for {path}")
        if issue["status"] != report.status:
            raise ReportError(f"metadata status mismatch for {path}")
        if issue["severity"] != report.severity:
            raise ReportError(f"metadata severity mismatch for {path}")
        if issue["title"] != report.title:
            raise ReportError(f"metadata title mismatch for {path}")
        if report.status == "active" and report.resolution is not None:
            raise ReportError(f"active report must not have Resolution field: {path}")
        if report.status == "resolved" and report.resolution not in VALID_RESOLUTIONS:
            raise ReportError(f"resolved report has invalid Resolution field: {path}")


def scan_reports(directory: Path, red_team: Path, status: str) -> list[Report]:
    if not directory.exists():
        return []
    return [
        parse_report(path, red_team, expected_status=status)
        for path in directory.glob("*.md")
        if path.name != ".gitkeep"
    ]


def parse_report(path: Path, red_team: Path, expected_status: str | None = None) -> Report:
    text = path.read_text()
    lines = text.splitlines()
    if not lines:
        raise ReportError(f"empty report: {path}")

    heading = re.match(r"^#\s+(RT-\d+)\s+-\s+(.+?)\s+-\s+(.+)$", lines[0])
    if not heading:
        raise ReportError(f"invalid report heading: {path}")

    report_id = normalize_report_id(heading.group(1))
    severity = heading.group(2).strip()
    title = heading.group(3).strip()
    date = first_field(lines, "Date")
    commit = first_field(lines, "Commit")
    resolution = optional_field(lines, "Resolution")
    status = expected_status or status_from_path(path, red_team)
    relative = path.relative_to(red_team).as_posix()

    if "## Reproduce Steps" not in text:
        raise ReportError(f"missing Reproduce Steps section: {path}")
    if "## Root Cause Analysis" not in text:
        raise ReportError(f"missing Root Cause Analysis section: {path}")
    if status == "active" and re.search(r"Suggested fix|Suggested Fix|### Suggested", text):
        raise ReportError(f"active report includes suggested-fix text: {path}")

    return Report(
        id=report_id,
        severity=severity,
        title=title,
        date=date,
        commit=commit,
        status=status,
        file=relative,
        resolution=resolution,
    )


def status_from_path(path: Path, red_team: Path) -> str:
    parent = path.parent.relative_to(red_team).parts[0]
    if parent not in (ACTIVE_DIR, RESOLVED_DIR):
        raise ReportError(f"report is outside active/resolved: {path}")
    return "active" if parent == ACTIVE_DIR else "resolved"


def report_to_metadata(report: Report) -> dict:
    result = {
        "id": report.id,
        "status": report.status,
        "severity": report.severity,
        "title": report.title,
        "file": report.file,
        "date": report.date,
        "commit": report.commit,
    }
    if report.resolution is not None:
        result["resolution"] = report.resolution
    return result


def find_issue(metadata: dict, report_id: str) -> dict | None:
    for issue in metadata.get("issues", []):
        if normalize_report_id(issue["id"]) == report_id:
            return issue
    return None


def upsert_resolution_field(text: str, resolution: str) -> str:
    lines = text.splitlines()
    commit_index = next((index for index, line in enumerate(lines) if line.startswith("Commit:")), None)
    if commit_index is None:
        raise ReportError("report is missing Commit field")

    resolution_line = f"Resolution: {resolution}"
    existing_index = next(
        (index for index, line in enumerate(lines) if line.startswith("Resolution:")),
        None,
    )
    if existing_index is not None:
        lines[existing_index] = resolution_line
    else:
        lines.insert(commit_index + 1, resolution_line)
    return "\n".join(lines).rstrip() + "\n"


def upsert_resolution_section(text: str, details: str) -> str:
    if "## Resolution" in text:
        return text
    return text.rstrip() + "\n\n## Resolution\n\n" + details.rstrip() + "\n"


def first_field(lines: list[str], field: str) -> str:
    value = optional_field(lines, field)
    if value is None:
        raise ReportError(f"missing {field} field")
    return value


def optional_field(lines: list[str], field: str) -> str | None:
    prefix = f"{field}:"
    for line in lines:
        if line.startswith(prefix):
            return line[len(prefix) :].strip()
    return None


def current_date() -> str:
    return datetime.now().astimezone().strftime("%Y-%m-%d %H:%M:%S %Z")


def filename_timestamp() -> str:
    return datetime.now().astimezone().strftime("%Y%m%d-%H%M%S")


def timestamp_from_date(value: str) -> str | None:
    try:
        parsed = datetime.strptime(" ".join(value.split(" ")[:2]), "%Y-%m-%d %H:%M:%S")
    except ValueError:
        return None
    return parsed.strftime("%Y%m%d-%H%M%S")


def current_commit(repo_root: Path) -> str:
    try:
        return subprocess.check_output(
            ["git", "rev-parse", "HEAD"],
            cwd=repo_root,
            text=True,
            stderr=subprocess.DEVNULL,
        ).strip()
    except (subprocess.CalledProcessError, FileNotFoundError):
        return "unknown"


def next_id_from_reports(red_team: Path) -> int:
    numbers: list[int] = []
    for directory in (red_team / ACTIVE_DIR, red_team / RESOLVED_DIR):
        if not directory.exists():
            continue
        for path in directory.glob("*.md"):
            match = re.match(r"^rt-(\d+)-", path.name)
            if match:
                numbers.append(int(match.group(1)))
    return max(numbers, default=0) + 1


def normalize_report_id(value: str) -> str:
    match = re.fullmatch(r"(?i)RT-(\d+)", value.strip())
    if not match:
        raise ReportError(f"invalid report id: {value}")
    number = int(match.group(1))
    if number < 1:
        raise ReportError(f"invalid report id: {value}")
    return f"RT-{number}"


def report_number(report_id: str) -> int:
    return int(normalize_report_id(report_id).split("-", 1)[1])


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "report"


if __name__ == "__main__":
    raise SystemExit(main())
