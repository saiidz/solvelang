import type { Metadata } from "next";
import TotpQrEnhancer from "./TotpQrEnhancer";

export const metadata: Metadata = {
  title: "API Account",
  robots: {
    index: false,
    follow: false,
    noarchive: true,
    nocache: true,
  },
};

export default function ApiAccountLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <>
      {children}
      <TotpQrEnhancer />
    </>
  );
}
