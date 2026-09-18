import type { Metadata } from "next";
import "@copilotkit/react-core/v2/styles.css";
import "./styles.css";
export const metadata: Metadata = { title: "Copilot SDK + AG-UI", description: "One CopilotKit frontend, two native Copilot SDK backends." };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="en"><body>{children}</body></html>;
}
