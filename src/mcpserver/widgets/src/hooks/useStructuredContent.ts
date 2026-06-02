import { useState, useRef, useCallback } from "react";
import { useApp, type App } from "@modelcontextprotocol/ext-apps/react";

export interface StructuredContentResult<T> {
  data: T | null;
  app: App | null;
  sendChatMessage: (text: string) => void;
}

export function useStructuredContent<T>(): StructuredContentResult<T> {
  const [data, setData] = useState<T | null>(null);
  const appRef = useRef<App | null>(null);

  const { app } = useApp({
    appInfo: { name: "probation-tracker-widget", version: "1.0.0" },
    capabilities: {},
    onAppCreated: (createdApp) => {
      appRef.current = createdApp;
      createdApp.ontoolresult = (result) => {
        if (result.structuredContent) {
          setData(result.structuredContent as T);
        }
      };
    },
  });

  const sendChatMessage = useCallback((text: string) => {
    const currentApp = app ?? appRef.current;
    if (currentApp) {
      currentApp.sendMessage({
        role: "user",
        content: [{ type: "text", text }],
      } as any).then((res) => {
        console.info("sendMessage result:", res);
      }).catch((err) => {
        console.error("sendMessage failed:", err);
      });
    } else {
      console.warn("App not connected yet");
    }
  }, [app]);

  return { data, app: app ?? appRef.current, sendChatMessage };
}
