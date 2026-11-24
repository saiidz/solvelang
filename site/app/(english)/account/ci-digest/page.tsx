import type { Metadata } from "next";
import { CiDigestBoard } from "@/app/account/ci-digest/CiDigestBoard";

export const metadata: Metadata = {
  title: "Weekly CI health digest",
  description: "Your weekly CI health digest, built from the runner jobs served for your repositories: slowest runs, failed and cancelled minutes, and runs with mixed outcomes.",
  robots: { index: false, follow: false },
};

export default function CiDigestPage() {
  return <CiDigestBoard />;
}
