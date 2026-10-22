import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = {
  title: "Forma Next POS",
  description: "Next.js only cashier, inventory and sales demo"
};
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
