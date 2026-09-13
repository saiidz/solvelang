"""Repository-only release guard tests; no provider or production binary runs."""
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tarfile
import tempfile
import unittest

SCRIPTS = Path(__file__).resolve().parent


class CandidateGuards(unittest.TestCase):
    def test_existing_destination_is_never_deleted(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            repo = root / "repo"
            repo.mkdir()
            (repo / "solvec").mkdir()
            subprocess.run(["git", "init", "-q", str(repo)], check=True)
            subprocess.run(
                [
                    "git",
                    "-c",
                    "user.name=Fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "commit",
                    "--allow-empty",
                    "-qm",
                    "fixture",
                ],
                cwd=repo,
                check=True,
            )
            destination = root / "keep"
            destination.mkdir()
            marker = destination / "marker"
            marker.write_text("must survive")
            fakebin = root / "bin"
            fakebin.mkdir()
            cargo = fakebin / "cargo"
            cargo.write_text(
                '#!/bin/sh\necho \'{"packages":[{"name":"solvec","version":"0.1.0"}]}\'\n'
            )
            cargo.chmod(0o755)
            env = dict(
                os.environ,
                PATH=f"{fakebin}:{os.environ['PATH']}",
                SOLVELANG_RELEASE_DIST=str(destination),
            )
            result = subprocess.run(
                ["bash", str(SCRIPTS / "build-release-candidate.sh")],
                cwd=repo,
                env=env,
                capture_output=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(marker.exists(), "candidate regeneration erased existing destination")

    def test_archive_links_and_extra_entries_are_rejected_before_smoke(self):
        for member_name, kind in [
            ("../outside", "file"),
            ("solvec", "symlink"),
            ("extra", "file"),
        ]:
            with self.subTest(member=member_name, kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                artifact = root / "solvelang-0.1.0-linux-x86_64.tar.gz"
                with tarfile.open(artifact, "w:gz") as archive:
                    member = tarfile.TarInfo(member_name)
                    if kind == "symlink":
                        member.type = tarfile.SYMTYPE
                        member.linkname = "/bin/true"
                        archive.addfile(member)
                    else:
                        payload = b"fixture"
                        member.size = len(payload)
                        archive.addfile(member, io.BytesIO(payload))
                digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
                (root / "SHA256SUMS").write_text(f"{digest}  {artifact.name}\n")
                (root / "provenance.json").write_text(
                    json.dumps(
                        {
                            "schema_version": "1.0.0",
                            "kind": "solvelang_release_candidate",
                            "publishable": False,
                            "source_commit": "a" * 40,
                            "source_date_epoch": 1,
                            "target": "x86_64-unknown-linux-gnu",
                            "os": "linux",
                            "arch": "x86_64",
                            "version": "0.1.0",
                            "artifact": artifact.name,
                            "sha256": digest,
                            "workflow": {},
                        }
                    )
                )
                result = subprocess.run(
                    ["bash", str(SCRIPTS / "verify-release-candidate.sh"), str(root)],
                    capture_output=True,
                )
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(
                    b"archive must contain exactly one regular executable solvec",
                    result.stderr,
                )

    def test_packaged_version_must_match_provenance(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            artifact = root / "solvelang-0.1.0-linux-x86_64.tar.gz"
            payload = b"#!/bin/sh\nif [ \"$1\" = version ]; then echo 'solvec 9.9.9'; exit 0; fi\nif [ \"$1\" = help ]; then exit 0; fi\nexit 2\n"
            with tarfile.open(artifact, "w:gz") as archive:
                member = tarfile.TarInfo("solvec")
                member.mode = 0o755
                member.size = len(payload)
                archive.addfile(member, io.BytesIO(payload))
            digest = hashlib.sha256(artifact.read_bytes()).hexdigest()
            (root / "SHA256SUMS").write_text(f"{digest}  {artifact.name}\n")
            (root / "provenance.json").write_text(
                json.dumps(
                    {
                        "schema_version": "1.0.0",
                        "kind": "solvelang_release_candidate",
                        "publishable": False,
                        "source_commit": "a" * 40,
                        "source_date_epoch": 1,
                        "target": "x86_64-unknown-linux-gnu",
                        "os": "linux",
                        "arch": "x86_64",
                        "version": "0.1.0",
                        "artifact": artifact.name,
                        "sha256": digest,
                        "workflow": {},
                    }
                )
            )
            result = subprocess.run(
                ["bash", str(SCRIPTS / "verify-release-candidate.sh"), str(root)],
                capture_output=True,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(
                b"packaged solvec version does not match provenance version",
                result.stderr,
            )


class TaggedReleaseSourceGuards(unittest.TestCase):
    def make_repo(self, root: Path, version: str = "0.3.0") -> Path:
        repo = root / "repo"
        repo.mkdir()
        (repo / "solvec").mkdir()
        (repo / "solvec" / "Cargo.toml").write_text(
            f'[package]\nname = "solvec"\nversion = "{version}"\nedition = "2021"\n'
        )
        subprocess.run(["git", "init", "-q", str(repo)], check=True)
        subprocess.run(["git", "add", "solvec/Cargo.toml"], cwd=repo, check=True)
        subprocess.run(
            [
                "git",
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "commit",
                "-qm",
                "fixture",
            ],
            cwd=repo,
            check=True,
        )
        return repo

    def run_verifier(self, repo: Path, tag: str, expected_sha: str | None = None):
        command = ["bash", str(SCRIPTS / "verify-release-tag-source.sh"), tag]
        if expected_sha is not None:
            command.append(expected_sha)
        return subprocess.run(command, cwd=repo, capture_output=True, text=True)

    def create_annotated_tag(self, repo: Path, tag: str):
        subprocess.run(
            [
                "git",
                "-c",
                "user.name=Fixture",
                "-c",
                "user.email=fixture@example.invalid",
                "tag",
                "-a",
                tag,
                "-m",
                "fixture release",
            ],
            cwd=repo,
            check=True,
        )

    def test_annotated_exact_version_tag_is_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self.make_repo(Path(tmp))
            self.create_annotated_tag(repo, "v0.3.0")
            sha = subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=repo, text=True).strip()
            result = self.run_verifier(repo, "v0.3.0", sha)
            self.assertEqual(result.returncode, 0, result.stderr)
            evidence = json.loads(result.stdout)
            self.assertEqual(evidence["kind"], "solvelang_tagged_release_source")
            self.assertFalse(evidence["publishable"])
            self.assertEqual(evidence["tag"], "v0.3.0")
            self.assertEqual(evidence["source_commit"], sha)
            self.assertEqual(evidence["version"], "0.3.0")
            self.assertRegex(evidence["tag_object"], r"^[0-9a-f]{40}$")

    def test_lightweight_tag_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self.make_repo(Path(tmp))
            subprocess.run(["git", "tag", "v0.3.0"], cwd=repo, check=True)
            result = self.run_verifier(repo, "v0.3.0")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("annotated tag", result.stderr)

    def test_version_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self.make_repo(Path(tmp))
            self.create_annotated_tag(repo, "v0.4.0")
            result = self.run_verifier(repo, "v0.4.0")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("tag/version mismatch", result.stderr)

    def test_head_mismatch_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self.make_repo(Path(tmp))
            self.create_annotated_tag(repo, "v0.3.0")
            (repo / "later.txt").write_text("later")
            subprocess.run(["git", "add", "later.txt"], cwd=repo, check=True)
            subprocess.run(
                [
                    "git",
                    "-c",
                    "user.name=Fixture",
                    "-c",
                    "user.email=fixture@example.invalid",
                    "commit",
                    "-qm",
                    "later",
                ],
                cwd=repo,
                check=True,
            )
            result = self.run_verifier(repo, "v0.3.0")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("HEAD does not match", result.stderr)

    def test_dirty_worktree_is_rejected(self):
        with tempfile.TemporaryDirectory() as tmp:
            repo = self.make_repo(Path(tmp))
            self.create_annotated_tag(repo, "v0.3.0")
            (repo / "untracked.txt").write_text("dirty")
            result = self.run_verifier(repo, "v0.3.0")
            self.assertNotEqual(result.returncode, 0)
            self.assertIn("clean worktree", result.stderr)


if __name__ == "__main__":
    unittest.main()
