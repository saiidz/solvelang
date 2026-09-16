import assert from "node:assert/strict";
import test from "node:test";
import { sha256Text } from "../dist/src/context-pack.js";
import { gitBlobSha1 } from "./run-context-repository-evals.mjs";
import {
  answerKeyCommitment,
  digest,
  runHeldoutSelection,
  scoreHeldoutSelection,
  validatePublicHoldout,
} from "./context-heldout-eval.mjs";

const source = (path, text) => ({ path, text, sha256: sha256Text(text), gitBlobSha1: gitBlobSha1(text) });
