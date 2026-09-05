"""Repository-only negative tests; no compiler, provider, or candidate binary runs."""
import io
import json
import hashlib
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
            subprocess.run(["git", "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--allow-empty", "-qm", "fixture"], cwd=repo, check=True)
            destination = root / "keep"
            destination.mkdir()
            marker = destination / "marker"
            marker.write_text("must survive")
            fakebin = root / "bin"
            fakebin.mkdir()
            cargo = fakebin / "cargo"
            cargo.write_text('#!/bin/sh\necho \'{"packages":[{"name":"solvec","version":"0.1.0"}]}\'\n')
            cargo.chmod(0o755)
            env = dict(os.environ, PATH=f"{fakebin}:{os.environ['PATH']}", SOLVELANG_RELEASE_DIST=str(destination))
            result = subprocess.run(["bash", str(SCRIPTS / "build-release-candidate.sh")], cwd=repo, env=env, capture_output=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertTrue(marker.exists(), "candidate regeneration erased existing destination")

    def test_archive_links_and_extra_entries_are_rejected_before_smoke(self):
        for member_name, kind in [("../outside", "file"), ("solvec", "symlink"), ("extra", "file")]:
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
                (root / "provenance.json").write_text(json.dumps({
                    "schema_version": "1.0.0", "kind": "solvelang_release_candidate", "publishable": False,
                    "source_commit": "a" * 40, "source_date_epoch": 1, "target": "x86_64-unknown-linux-gnu",
                    "os": "linux", "arch": "x86_64", "version": "0.1.0", "artifact": artifact.name,
                    "sha256": digest, "workflow": {},
                }))
                result = subprocess.run(["bash", str(SCRIPTS / "verify-release-candidate.sh"), str(root)], capture_output=True)
                self.assertNotEqual(result.returncode, 0)
                self.assertIn(b"archive must contain exactly one regular executable solvec", result.stderr)


if __name__ == "__main__":
    unittest.main()
